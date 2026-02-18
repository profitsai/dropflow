/**
 * DropFlow Auto-Order Manager
 * 
 * Handles creating, tracking, and executing orders from source suppliers
 * (AliExpress/Amazon) when eBay sales occur.
 * 
 * Flow:
 * 1. Sale detected (webhook/manual) → order created with status 'pending'
 * 2. User triggers ordering → opens source product page, selects variant, fills address
 * 3. Stops before payment → status 'awaiting_payment' (manual confirm required)
 * 4. User confirms → status 'ordered'
 * 5. Tracking updates → status 'shipped' / 'delivered'
 */

import { AUTO_ORDERS, AUTO_ORDER_SETTINGS, TRACKED_PRODUCTS, DEFAULTS } from './storage-keys.js';
import { uid } from './utils.js';

// === Order Status Constants ===
export const ORDER_STATUS = {
  PENDING: 'pending',               // Sale detected, order not yet placed
  PROCESSING: 'processing',         // Currently navigating source site
  AWAITING_PAYMENT: 'awaiting_payment', // Cart filled, waiting for manual payment confirm
  ORDERED: 'ordered',               // Payment confirmed, order placed
  SHIPPED: 'shipped',               // Source supplier shipped
  DELIVERED: 'delivered',           // Delivered to buyer
  CANCELLED: 'cancelled',          // Order cancelled
  FAILED: 'failed'                 // Ordering failed (error)
};

// === Storage Helpers ===

export async function getOrders() {
  const result = await chrome.storage.local.get(AUTO_ORDERS);
  return result[AUTO_ORDERS] || [];
}

export async function saveOrders(orders) {
  await chrome.storage.local.set({ [AUTO_ORDERS]: orders });
}

export async function getAutoOrderSettings() {
  const result = await chrome.storage.local.get(AUTO_ORDER_SETTINGS);
  return result[AUTO_ORDER_SETTINGS] || DEFAULTS[AUTO_ORDER_SETTINGS];
}

export async function saveAutoOrderSettings(settings) {
  await chrome.storage.local.set({ [AUTO_ORDER_SETTINGS]: settings });
}

// === Order CRUD ===

/**
 * Create a new order from an eBay sale.
 * @param {Object} saleData - { ebayItemId, ebayOrderId, buyerName, buyerAddress, 
 *                               quantity, soldPrice, soldCurrency }
 * @returns {Object} The created order
 */
export async function createOrder(saleData) {
  const orders = await getOrders();

  // Prevent duplicate orders for the same eBay sale
  if (saleData.ebayOrderId) {
    const existing = orders.find(o => o.ebayOrderId === saleData.ebayOrderId);
    if (existing) {
      console.warn(`[DropFlow] Duplicate order prevented: ebayOrderId ${saleData.ebayOrderId} already has order ${existing.id} (status: ${existing.status})`);
      return existing;
    }
  }

  // Look up source product from tracked products
  const tracked = await chrome.storage.local.get(TRACKED_PRODUCTS);
  const trackedProducts = tracked[TRACKED_PRODUCTS] || [];
  const sourceProduct = trackedProducts.find(p => p.ebayItemId === saleData.ebayItemId);

  const order = {
    id: uid(),
    status: ORDER_STATUS.PENDING,
    
    // eBay sale info
    ebayItemId: saleData.ebayItemId,
    ebayOrderId: saleData.ebayOrderId || '',
    ebayTitle: saleData.ebayTitle || sourceProduct?.ebayTitle || '',
    soldPrice: saleData.soldPrice || 0,
    soldCurrency: saleData.soldCurrency || 'USD',
    quantity: saleData.quantity || 1,
    
    // Buyer shipping info
    buyerName: saleData.buyerName || '',
    buyerAddress: saleData.buyerAddress || null,
    
    // Source product info (from tracked products)
    sourceType: sourceProduct?.sourceType || saleData.sourceType || 'unknown',
    sourceUrl: sourceProduct?.sourceUrl || saleData.sourceUrl || '',
    sourceId: sourceProduct?.sourceId || '',
    sourceDomain: sourceProduct?.sourceDomain || '',
    sourcePrice: sourceProduct?.sourcePrice || 0,
    sourceCurrency: sourceProduct?.sourceCurrency || 'USD',
    
    // Variant info (from sale polling)
    sourceVariant: saleData.sourceVariant || null,

    // Ordering state
    sourceOrderId: '',
    sourceTrackingNumber: '',
    sourceShippingCarrier: '',
    errorMessage: '',
    
    // Timestamps
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    orderedAt: null,
    shippedAt: null,
    deliveredAt: null
  };

  orders.push(order);
  await saveOrders(orders);
  return order;
}

/**
 * Update an order's status and optional fields.
 */
export async function updateOrder(orderId, updates) {
  const orders = await getOrders();
  const idx = orders.findIndex(o => o.id === orderId);
  if (idx === -1) return { error: 'Order not found' };

  const order = orders[idx];
  Object.assign(order, updates, { updatedAt: new Date().toISOString() });
  
  // Set timestamp fields based on status changes
  if (updates.status === ORDER_STATUS.ORDERED && !order.orderedAt) {
    order.orderedAt = new Date().toISOString();
  }
  if (updates.status === ORDER_STATUS.SHIPPED && !order.shippedAt) {
    order.shippedAt = new Date().toISOString();
  }
  if (updates.status === ORDER_STATUS.DELIVERED && !order.deliveredAt) {
    order.deliveredAt = new Date().toISOString();
  }

  orders[idx] = order;
  await saveOrders(orders);
  return order;
}

/**
 * Cancel an order.
 */
export async function cancelOrder(orderId) {
  return updateOrder(orderId, { status: ORDER_STATUS.CANCELLED });
}

/**
 * Get orders filtered by status.
 */
export async function getOrdersByStatus(status) {
  const orders = await getOrders();
  return orders.filter(o => o.status === status);
}

/**
 * Get pending orders that need to be fulfilled.
 */
export async function getPendingOrders() {
  const orders = await getOrders();
  return orders.filter(o => 
    o.status === ORDER_STATUS.PENDING || 
    o.status === ORDER_STATUS.AWAITING_PAYMENT
  );
}

// === Auto-Order Execution ===

/**
 * Execute auto-ordering for a specific order.
 * Opens the source product page and prepares the cart.
 * Does NOT complete payment — stops for manual confirmation.
 * 
 * @param {string} orderId 
 * @param {Function} progressCallback - (orderId, status, message) => void
 * @returns {Object} result
 */
export async function executeAutoOrder(orderId, progressCallback) {
  const orders = await getOrders();
  const order = orders.find(o => o.id === orderId);
  if (!order) return { error: 'Order not found' };
  if (!order.sourceUrl) return { error: 'No source URL found for this product' };

  const settings = await getAutoOrderSettings();

  // Check max price limit
  if (settings.maxAutoOrderPrice && order.sourcePrice > settings.maxAutoOrderPrice) {
    await updateOrder(orderId, {
      status: ORDER_STATUS.FAILED,
      errorMessage: `Source price $${order.sourcePrice} exceeds max auto-order price $${settings.maxAutoOrderPrice}`
    });
    return { error: `Source price exceeds max auto-order limit ($${settings.maxAutoOrderPrice})` };
  }

  try {
    await updateOrder(orderId, { status: ORDER_STATUS.PROCESSING });
    progressCallback?.(orderId, 'processing', 'Opening source product page...');

    // Open the source product page in a new tab
    const tab = await chrome.tabs.create({ url: order.sourceUrl, active: true });

    // Wait for the page to fully load (with timeout to prevent listener leak)
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(); // resolve anyway to continue
      }, 30000);
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Give the page a moment to render dynamic content
    await new Promise(r => setTimeout(r, 3000));

    // Inject the auto-order content script to handle cart/checkout
    const scriptFile = order.sourceType === 'aliexpress'
      ? 'content-scripts/aliexpress/auto-order.js'
      : 'content-scripts/amazon/auto-order.js';

    progressCallback?.(orderId, 'processing', 'Preparing order on source site...');

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [scriptFile]
    });

    // Send order details to the content script
    const shippingAddress = order.buyerAddress || settings.defaultShippingAddress;

    // Store pending checkout data so the checkout content script can auto-fill
    // the address after Buy Now navigates to the checkout page.
    // Includes TTL (10 min) so stale data is ignored if checkout never loads.
    await chrome.storage.local.set({
      '__dropflow_pending_checkout': {
        orderId: order.id,
        shippingAddress,
        sourceVariant: order.sourceVariant || null,
        tabId: tab.id,
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000
      }
    });

    await chrome.tabs.sendMessage(tab.id, {
      type: 'DROPFLOW_AUTO_ORDER_EXECUTE',
      data: {
        orderId: order.id,
        quantity: order.quantity,
        shippingAddress,
        sourceUrl: order.sourceUrl,
        sourceVariant: order.sourceVariant || null
      }
    });

    // Update status — now waiting for manual payment confirmation
    await updateOrder(orderId, { status: ORDER_STATUS.AWAITING_PAYMENT });
    progressCallback?.(orderId, 'awaiting_payment', 
      'Order prepared! Review the cart and confirm payment manually.');

    // Send notification
    if (settings.notifyOnReady) {
      chrome.notifications.create(`order-ready-${orderId}`, {
        type: 'basic',
        iconUrl: '/icons/icon128.png',
        title: 'DropFlow: Order Ready for Payment',
        message: `Order for "${order.ebayTitle}" is ready. Please review and confirm payment.`,
        priority: 2
      });
    }

    return { success: true, orderId, tabId: tab.id, status: 'awaiting_payment' };
  } catch (err) {
    await updateOrder(orderId, { 
      status: ORDER_STATUS.FAILED, 
      errorMessage: err.message 
    });
    progressCallback?.(orderId, 'failed', `Error: ${err.message}`);
    return { error: err.message };
  }
}

/**
 * Confirm that payment was made for an order.
 */
export async function confirmOrderPayment(orderId, sourceOrderId = '') {
  return updateOrder(orderId, { 
    status: ORDER_STATUS.ORDERED,
    sourceOrderId
  });
}
