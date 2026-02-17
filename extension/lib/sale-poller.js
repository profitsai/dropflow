/**
 * DropFlow eBay Sale Poller
 * Polls eBay Seller Hub Orders page to detect new sales.
 * Creates auto-order entries for each new sale detected.
 */

import { TRACKED_PRODUCTS, AUTO_ORDER_SETTINGS } from './storage-keys.js';
import { createOrder, getOrders, getAutoOrderSettings } from './auto-order.js';

// Storage key for known eBay order IDs (to detect new ones)
export const KNOWN_EBAY_ORDERS = 'knownEbayOrders';
export const SALE_POLL_LAST_RUN = 'salePollLastRun';
export const SALE_POLL_STATS = 'salePollStats';
export const SALE_POLL_ALARM = 'dropflow-sale-poll';

/**
 * Run one poll cycle: open Seller Hub orders, scrape, detect new, create orders.
 * Called by the alarm handler in the service worker.
 * @returns {{ newOrders: number, errors: string[] }}
 */
export async function runSalePollCycle() {
  const errors = [];
  let newOrderCount = 0;

  console.log('[DropFlow SalePoller] Starting poll cycle...');

  try {
    // 1. Check if polling is enabled
    const settings = await getAutoOrderSettings();
    if (!settings.enabled) {
      console.log('[DropFlow SalePoller] Auto-ordering disabled, skipping poll.');
      return { newOrders: 0, errors: [] };
    }

    // 2. Open eBay Seller Hub orders page in background
    const ordersUrl = 'https://www.ebay.com/sh/ord?filter=status:ALL_ORDERS&limit=25&sort=creation_date';
    let tab;
    try {
      tab = await chrome.tabs.create({ url: ordersUrl, active: false });
    } catch (e) {
      errors.push('Failed to open orders page: ' + e.message);
      return { newOrders: 0, errors };
    }

    // 3. Wait for page load
    await waitForTabLoad(tab.id, 30000);
    // Extra settle time for dynamic content
    await sleep(5000);

    // 4. Inject orders scraper and scrape
    let scrapedOrders = [];
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-scripts/ebay/orders-scraper.js']
      });
      await sleep(1000);

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'DROPFLOW_SCRAPE_EBAY_ORDERS'
      });
      scrapedOrders = response?.orders || [];
    } catch (e) {
      errors.push('Scrape failed: ' + e.message);
    }

    // 5. Close the tab
    try { await chrome.tabs.remove(tab.id); } catch (_) {}

    if (scrapedOrders.length === 0) {
      console.log('[DropFlow SalePoller] No orders found on page.');
      await updatePollStats(0, errors);
      return { newOrders: 0, errors };
    }

    console.log(`[DropFlow SalePoller] Scraped ${scrapedOrders.length} orders from Seller Hub.`);

    // 6. Compare against known orders
    const knownData = await chrome.storage.local.get(KNOWN_EBAY_ORDERS);
    const knownOrderIds = new Set(knownData[KNOWN_EBAY_ORDERS] || []);

    // Also check existing auto-orders to avoid duplicates
    const existingAutoOrders = await getOrders();
    const existingEbayOrderIds = new Set(existingAutoOrders.map(o => o.ebayOrderId).filter(Boolean));

    const newSales = scrapedOrders.filter(o =>
      o.orderId &&
      !knownOrderIds.has(o.orderId) &&
      !existingEbayOrderIds.has(o.orderId)
    );

    if (newSales.length === 0) {
      console.log('[DropFlow SalePoller] No new sales detected.');
      // Still update known orders with all scraped IDs
      const allIds = [...knownOrderIds, ...scrapedOrders.map(o => o.orderId).filter(Boolean)];
      await chrome.storage.local.set({ [KNOWN_EBAY_ORDERS]: [...new Set(allIds)] });
      await updatePollStats(0, errors);
      return { newOrders: 0, errors };
    }

    console.log(`[DropFlow SalePoller] Found ${newSales.length} NEW sales!`);

    // 7. Load tracked products for matching
    const tpData = await chrome.storage.local.get(TRACKED_PRODUCTS);
    const trackedProducts = tpData[TRACKED_PRODUCTS] || [];

    // 8. Process each new sale
    for (const sale of newSales) {
      try {
        // Match to tracked product by eBay item ID or SKU/Custom Label
        const match = matchSaleToProduct(sale, trackedProducts);

        // Resolve variant info if the sale has variant details
        const variantInfo = resolveVariant(sale, match);

        const saleData = {
          ebayItemId: sale.itemId || '',
          ebayOrderId: sale.orderId,
          ebayTitle: sale.title || match?.ebayTitle || '',
          soldPrice: sale.price || 0,
          soldCurrency: 'USD',
          quantity: sale.quantity || 1,
          buyerName: sale.buyerName || '',
          buyerAddress: null,
          sourceType: match?.sourceType || 'unknown',
          sourceUrl: match?.sourceUrl || '',
          // Include variant info for the auto-order content script
          sourceVariant: variantInfo || null
        };

        const order = await createOrder(saleData);
        newOrderCount++;

        console.log(`[DropFlow SalePoller] Created order ${order.id} for eBay order ${sale.orderId}`);

        // Send notification
        chrome.notifications.create(`new-sale-${sale.orderId}`, {
          type: 'basic',
          iconUrl: '/icons/icon128.png',
          title: '🎉 DropFlow: New eBay Sale!',
          message: `${sale.title || 'Item'} sold for $${sale.price || '?'} to ${sale.buyerName || 'buyer'}`,
          priority: 2
        });
      } catch (e) {
        errors.push(`Order ${sale.orderId}: ${e.message}`);
      }
    }

    // 9. Update known orders
    const allIds = [
      ...knownOrderIds,
      ...scrapedOrders.map(o => o.orderId).filter(Boolean)
    ];
    // Keep last 500 to avoid unbounded growth
    const trimmed = [...new Set(allIds)].slice(-500);
    await chrome.storage.local.set({ [KNOWN_EBAY_ORDERS]: trimmed });

    await updatePollStats(newOrderCount, errors);

  } catch (e) {
    errors.push('Poll cycle error: ' + e.message);
    console.error('[DropFlow SalePoller] Error:', e);
  }

  return { newOrders: newOrderCount, errors };
}

/**
 * Match an eBay sale to a tracked product.
 * Tries: 1) eBay item ID, 2) SKU/Custom Label prefix match
 */
function matchSaleToProduct(sale, trackedProducts) {
  if (!trackedProducts.length) return null;

  // Direct match by eBay item ID
  if (sale.itemId) {
    const byId = trackedProducts.find(p => p.ebayItemId === sale.itemId);
    if (byId) return byId;
  }

  // Match by SKU/Custom Label
  if (sale.sku) {
    const skuLower = sale.sku.toLowerCase();
    const bySku = trackedProducts.find(p => {
      const label = (p.customLabel || p.sku || '').toLowerCase();
      return label && (label === skuLower || skuLower.startsWith(label) || label.startsWith(skuLower));
    });
    if (bySku) return bySku;
  }

  // Fuzzy match by title (if no other match found)
  if (sale.title && sale.title.length > 10) {
    const saleWords = sale.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    let bestMatch = null;
    let bestScore = 0;
    for (const p of trackedProducts) {
      const pTitle = (p.ebayTitle || p.title || '').toLowerCase();
      const score = saleWords.filter(w => pTitle.includes(w)).length;
      if (score > bestScore && score >= Math.min(3, saleWords.length * 0.5)) {
        bestScore = score;
        bestMatch = p;
      }
    }
    if (bestMatch) return bestMatch;
  }

  return null;
}

/**
 * Resolve variant/SKU info for a sale.
 * Maps eBay variant text (e.g. "Color: Blue, Size: XL") to source product variant.
 *
 * Returns { sourceVariantId, sourceVariantText, specifics } or null.
 */
function resolveVariant(sale, trackedProduct) {
  if (!sale.variant && !sale.sku) return null;
  if (!trackedProduct) return { ebayVariant: sale.variant || '', sku: sale.sku || '' };

  const variantMap = trackedProduct.variantMap || trackedProduct.skuMap || null;
  if (!variantMap) {
    // No mapping available — pass raw variant info
    return {
      ebayVariant: sale.variant || '',
      sku: sale.sku || '',
      sourceUrl: trackedProduct.sourceUrl || ''
    };
  }

  // Parse eBay variant text into specifics: "Color: Blue, Size: XL" → { Color: "Blue", Size: "XL" }
  const specifics = {};
  if (sale.variant) {
    const parts = sale.variant.split(/[,;]/).map(s => s.trim());
    for (const part of parts) {
      const [key, ...valParts] = part.split(':');
      if (key && valParts.length) {
        specifics[key.trim()] = valParts.join(':').trim();
      }
    }
  }

  // Try to find matching source variant in the map
  // variantMap is expected to be: { [ebayVariantKey]: { sourceVariantId, sourceUrl, sourceText } }
  // Or an array: [{ ebaySpecifics: {...}, sourceVariantId, sourceUrl }]
  if (Array.isArray(variantMap)) {
    for (const mapping of variantMap) {
      if (mapping.ebaySpecifics && specificsmatch(specifics, mapping.ebaySpecifics)) {
        return {
          sourceVariantId: mapping.sourceVariantId || '',
          sourceVariantText: mapping.sourceText || '',
          sourceUrl: mapping.sourceUrl || trackedProduct.sourceUrl || '',
          specifics
        };
      }
      // Also try SKU match
      if (sale.sku && mapping.sku === sale.sku) {
        return {
          sourceVariantId: mapping.sourceVariantId || '',
          sourceVariantText: mapping.sourceText || '',
          sourceUrl: mapping.sourceUrl || trackedProduct.sourceUrl || '',
          specifics
        };
      }
    }
  } else if (typeof variantMap === 'object') {
    // Key-based lookup
    const variantKey = sale.variant || sale.sku || '';
    if (variantMap[variantKey]) {
      const m = variantMap[variantKey];
      return {
        sourceVariantId: m.sourceVariantId || '',
        sourceVariantText: m.sourceText || '',
        sourceUrl: m.sourceUrl || trackedProduct.sourceUrl || '',
        specifics
      };
    }
    // Try specifics-based key: "Blue / XL"
    const specVals = Object.values(specifics);
    const specKey = specVals.join(' / ');
    if (variantMap[specKey]) {
      const m = variantMap[specKey];
      return {
        sourceVariantId: m.sourceVariantId || '',
        sourceVariantText: m.sourceText || '',
        sourceUrl: m.sourceUrl || trackedProduct.sourceUrl || '',
        specifics
      };
    }
  }

  // No mapping found — return raw info
  return {
    ebayVariant: sale.variant || '',
    sku: sale.sku || '',
    sourceUrl: trackedProduct.sourceUrl || '',
    specifics
  };
}

/**
 * Check if two specifics objects match (case-insensitive).
 */
function specificsmatch(a, b) {
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length === 0) return false;
  return aKeys.every(k => {
    const bVal = b[k] || b[k.toLowerCase()] || '';
    return bVal.toLowerCase() === (a[k] || '').toLowerCase();
  });
}

/**
 * Start the sale polling alarm.
 */
export async function startSalePolling(intervalMinutes = 5) {
  chrome.alarms.create(SALE_POLL_ALARM, {
    delayInMinutes: 0.5, // First check in 30 seconds
    periodInMinutes: intervalMinutes
  });
  console.log(`[DropFlow SalePoller] Alarm set: every ${intervalMinutes} minutes`);
}

/**
 * Stop the sale polling alarm.
 */
export async function stopSalePolling() {
  await chrome.alarms.clear(SALE_POLL_ALARM);
  console.log('[DropFlow SalePoller] Alarm cleared');
}

// === Helpers ===

function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // resolve anyway to continue
    }, timeoutMs);

    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function updatePollStats(newOrders, errors) {
  const now = new Date().toISOString();
  await chrome.storage.local.set({
    [SALE_POLL_LAST_RUN]: now,
    [SALE_POLL_STATS]: {
      lastRun: now,
      lastNewOrders: newOrders,
      lastErrors: errors.length,
      errorMessages: errors.slice(0, 5)
    }
  });
}
