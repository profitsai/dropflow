/**
 * DropFlow Auto-Orders Page
 * UI for managing auto-orders from eBay sales.
 */

import {
  GET_ALL_ORDERS, CREATE_ORDER, UPDATE_ORDER_STATUS, CANCEL_ORDER,
  START_AUTO_ORDER, CONFIRM_ORDER_PAYMENT,
  GET_AUTO_ORDER_SETTINGS, SAVE_AUTO_ORDER_SETTINGS,
  AUTO_ORDER_PROGRESS
} from '../../lib/message-types.js';

// === State ===
let orders = [];
let settings = {};

// === Init ===
document.addEventListener('DOMContentLoaded', async () => {
  // Set up tab switching via event listeners (MV3 CSP compliant)
  document.querySelectorAll('.tab[data-tab]').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Button listeners
  document.getElementById('btn-create-order').addEventListener('click', () => createNewOrder());
  document.getElementById('btn-save-settings').addEventListener('click', () => saveSettings());

  // Event delegation for order action buttons
  document.getElementById('orders-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'start') startOrder(id);
    else if (action === 'cancel') cancelOrd(id);
    else if (action === 'confirm') confirmPayment(id);
    else if (action === 'shipped') markShipped(id);
    else if (action === 'tracking') addTracking(id);
    else if (action === 'delivered') markDelivered(id);
  });

  await loadOrders();
  await loadSettings();
  
  // Listen for progress updates
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === AUTO_ORDER_PROGRESS) {
      showStatus(`Order ${msg.data.orderId?.slice(0, 8)}...: ${msg.data.message}`);
      loadOrders(); // refresh
    }
  });
});

// === Tab Switching ===
function switchTab(tabName) {
  document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${tabName}`).style.display = 'block';
  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');
};

// === Orders ===
async function loadOrders() {
  const resp = await chrome.runtime.sendMessage({ type: GET_ALL_ORDERS });
  orders = resp?.orders || [];
  renderOrders();
}

function renderOrders() {
  const container = document.getElementById('orders-list');
  
  if (orders.length === 0) {
    container.innerHTML = '<div class="empty">No orders yet. Create one from an eBay sale or wait for auto-detection.</div>';
    return;
  }

  // Sort by newest first
  const sorted = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  container.innerHTML = sorted.map(order => {
    const profit = order.soldPrice && order.sourcePrice 
      ? (order.soldPrice - order.sourcePrice).toFixed(2)
      : '?';
    
    const actions = getOrderActions(order);

    return `
      <div class="card">
        <div class="card-header">
          <span class="card-title" title="${esc(order.ebayTitle)}">${esc(order.ebayTitle) || 'Unknown Item'}</span>
          <span class="badge badge-${order.status}">${order.status.replace(/_/g, ' ')}</span>
        </div>
        <div class="card-details">
          <div>eBay Item: ${esc(order.ebayItemId)} | Order: ${esc(order.ebayOrderId) || 'N/A'}</div>
          <div>Sold: $${order.soldPrice} | Source: $${order.sourcePrice} | Profit: $${profit}</div>
          <div>Qty: ${order.quantity} | Source: ${order.sourceType} | Created: ${new Date(order.createdAt).toLocaleDateString()}</div>
          ${order.sourceTrackingNumber ? `<div>Tracking: ${esc(order.sourceTrackingNumber)}</div>` : ''}
          ${order.errorMessage ? `<div style="color:red;">Error: ${esc(order.errorMessage)}</div>` : ''}
        </div>
        <div class="card-actions">${actions}</div>
      </div>
    `;
  }).join('');
}

function getOrderActions(order) {
  const id = order.id;
  let html = '';
  
  switch (order.status) {
    case 'pending':
      html += `<button class="btn btn-primary" data-action="start" data-id="${id}">🛒 Order Now</button>`;
      html += `<button class="btn btn-danger" data-action="cancel" data-id="${id}">Cancel</button>`;
      break;
    case 'processing':
      html += `<span style="font-size:12px;color:#666;">Processing...</span>`;
      break;
    case 'awaiting_payment':
      html += `<button class="btn btn-success" data-action="confirm" data-id="${id}">✅ Confirm Payment</button>`;
      html += `<button class="btn btn-danger" data-action="cancel" data-id="${id}">Cancel</button>`;
      break;
    case 'ordered':
      html += `<button class="btn btn-secondary" data-action="shipped" data-id="${id}">📦 Mark Shipped</button>`;
      html += `<button class="btn btn-secondary" data-action="tracking" data-id="${id}">Add Tracking</button>`;
      break;
    case 'shipped':
      html += `<button class="btn btn-success" data-action="delivered" data-id="${id}">✅ Mark Delivered</button>`;
      break;
    default:
      break;
  }
  
  return html;
}

// === Actions ===
async function startOrder(orderId) {
  showStatus('Starting auto-order...');
  const resp = await chrome.runtime.sendMessage({ type: START_AUTO_ORDER, orderId });
  if (resp?.error) showStatus(`Error: ${resp.error}`, true);
  else showStatus('Order process started — check the source site tab.');
  await loadOrders();
};

async function confirmPayment(orderId) {
  const sourceOrderId = prompt('Enter the source order/confirmation number (optional):') || '';
  const resp = await chrome.runtime.sendMessage({ 
    type: CONFIRM_ORDER_PAYMENT, orderId, sourceOrderId 
  });
  if (resp?.error) showStatus(`Error: ${resp.error}`, true);
  else showStatus('Payment confirmed!');
  await loadOrders();
};

async function cancelOrd(orderId) {
  if (!confirm('Cancel this order?')) return;
  await chrome.runtime.sendMessage({ type: CANCEL_ORDER, orderId });
  await loadOrders();
};

async function markShipped(orderId) {
  await chrome.runtime.sendMessage({ 
    type: UPDATE_ORDER_STATUS, orderId, updates: { status: 'shipped' } 
  });
  await loadOrders();
};

async function markDelivered(orderId) {
  await chrome.runtime.sendMessage({ 
    type: UPDATE_ORDER_STATUS, orderId, updates: { status: 'delivered' } 
  });
  await loadOrders();
};

async function addTracking(orderId) {
  const tracking = prompt('Enter tracking number:');
  if (!tracking) return;
  const carrier = prompt('Carrier (e.g. USPS, FedEx, Yanwen):') || '';
  await chrome.runtime.sendMessage({ 
    type: UPDATE_ORDER_STATUS, orderId, 
    updates: { sourceTrackingNumber: tracking, sourceShippingCarrier: carrier } 
  });
  await loadOrders();
};

// === Create Order ===
async function createNewOrder() {
  const saleData = {
    ebayItemId: document.getElementById('new-ebay-item-id').value.trim(),
    ebayOrderId: document.getElementById('new-ebay-order-id').value.trim(),
    soldPrice: parseFloat(document.getElementById('new-sold-price').value) || 0,
    quantity: parseInt(document.getElementById('new-quantity').value) || 1,
    sourceUrl: document.getElementById('new-source-url').value.trim(),
    buyerName: document.getElementById('new-buyer-name').value.trim(),
    buyerAddress: { addressLine1: document.getElementById('new-buyer-address').value.trim() }
  };

  if (!saleData.ebayItemId) {
    alert('eBay Item ID is required');
    return;
  }

  const resp = await chrome.runtime.sendMessage({ type: CREATE_ORDER, saleData });
  if (resp?.error) {
    showStatus(`Error: ${resp.error}`, true);
  } else {
    showStatus('Order created!');
    switchTab('orders');
    await loadOrders();
  }
};

// === Settings ===
async function loadSettings() {
  const resp = await chrome.runtime.sendMessage({ type: GET_AUTO_ORDER_SETTINGS });
  settings = resp?.settings || {};
  
  document.getElementById('set-require-confirm').checked = settings.requireManualConfirm !== false;
  document.getElementById('set-notify-ready').checked = settings.notifyOnReady !== false;
  document.getElementById('set-max-price').value = settings.maxAutoOrderPrice || 100;
  
  const addr = settings.defaultShippingAddress || {};
  document.getElementById('addr-name').value = addr.fullName || '';
  document.getElementById('addr-phone').value = addr.phone || '';
  document.getElementById('addr-line1').value = addr.addressLine1 || '';
  document.getElementById('addr-line2').value = addr.addressLine2 || '';
  document.getElementById('addr-city').value = addr.city || '';
  document.getElementById('addr-state').value = addr.state || '';
  document.getElementById('addr-postal').value = addr.postalCode || '';
  document.getElementById('addr-country').value = addr.country || '';
}

async function saveSettings() {
  const updated = {
    requireManualConfirm: document.getElementById('set-require-confirm').checked,
    notifyOnReady: document.getElementById('set-notify-ready').checked,
    maxAutoOrderPrice: parseFloat(document.getElementById('set-max-price').value) || 100,
    defaultShippingAddress: {
      fullName: document.getElementById('addr-name').value.trim(),
      phone: document.getElementById('addr-phone').value.trim(),
      addressLine1: document.getElementById('addr-line1').value.trim(),
      addressLine2: document.getElementById('addr-line2').value.trim(),
      city: document.getElementById('addr-city').value.trim(),
      state: document.getElementById('addr-state').value.trim(),
      postalCode: document.getElementById('addr-postal').value.trim(),
      country: document.getElementById('addr-country').value.trim()
    }
  };

  await chrome.runtime.sendMessage({ type: SAVE_AUTO_ORDER_SETTINGS, settings: updated });
  showStatus('Settings saved!');
};

// === Helpers ===
function showStatus(msg, isError = false) {
  const bar = document.getElementById('status-bar');
  bar.textContent = msg;
  bar.style.display = 'block';
  bar.style.background = isError ? '#f8d7da' : '#e8f5e9';
  setTimeout(() => { bar.style.display = 'none'; }, 5000);
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
