/**
 * DropFlow AliExpress Auto-Order Content Script
 * 
 * Injected on an AliExpress product page to:
 * 1. Set the correct quantity
 * 2. Click "Buy Now" to go to checkout
 * 3. Fill shipping address (if possible)
 * 4. STOP before final payment — notify user to review & confirm
 * 
 * This script does NOT complete payment automatically for safety.
 */

(function() {
  'use strict';

  // Avoid double-injection
  if (window.__dropflow_auto_order_injected) return;
  window.__dropflow_auto_order_injected = true;

  console.log('[DropFlow] AliExpress auto-order script loaded');

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'DROPFLOW_AUTO_ORDER_EXECUTE') return;
    
    const { orderId, quantity, shippingAddress } = message.data;
    console.log('[DropFlow] Executing auto-order:', orderId, 'qty:', quantity);

    executeOrder(orderId, quantity, shippingAddress)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));

    return true; // async response
  });

  async function executeOrder(orderId, quantity, shippingAddress) {
    try {
      // Step 1: Set quantity
      await setQuantity(quantity);
      await sleep(1000);

      // Step 2: Click Buy Now
      await clickBuyNow();

      // Step 3: Wait for checkout page to load
      // The page will navigate to checkout — the background script 
      // should detect this and inject address filling if needed
      
      // Notify that we've initiated the purchase flow
      chrome.runtime.sendMessage({
        type: 'AUTO_ORDER_PROGRESS',
        data: { orderId, status: 'checkout_initiated', message: 'Navigating to checkout...' }
      });

      return { success: true, message: 'Buy Now clicked, navigating to checkout' };
    } catch (err) {
      console.error('[DropFlow] Auto-order error:', err);
      return { error: err.message };
    }
  }

  async function setQuantity(qty) {
    if (!qty || qty <= 1) return;

    // Try the quantity input field
    const qtyInput = document.querySelector(
      'input[type="number"][class*="quantity"], ' +
      '.product-quantity input, ' +
      '[class*="count--count"] input, ' +
      '.next-number-picker-input input, ' +
      'span.next-input input'
    );

    if (qtyInput) {
      // Clear and set value
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      ).set;
      nativeInputValueSetter.call(qtyInput, String(qty));
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
      qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[DropFlow] Quantity set to:', qty);
    } else {
      // Fallback: click the + button multiple times
      const plusBtn = document.querySelector(
        '[class*="quantity"] button:last-child, ' +
        '.next-number-picker-handler-up, ' +
        'button[class*="add"], ' +
        'span[class*="increase"]'
      );
      if (plusBtn) {
        for (let i = 1; i < qty; i++) {
          plusBtn.click();
          await sleep(300);
        }
        console.log('[DropFlow] Clicked + button', qty - 1, 'times');
      }
    }
  }

  async function clickBuyNow() {
    // Try various selectors for the Buy Now button on AliExpress
    const buyNowSelectors = [
      'button[class*="buy-now"]',
      'button[class*="buynow"]', 
      'button[class*="buyNow"]',
      '[class*="action--buyNow"]',
      '[data-pl="buy-now"] button',
      '.product-action button.comet-v2-btn-important',
      'button.addcart-buynow-btn',
      // Text-based fallback
    ];

    for (const sel of buyNowSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        console.log('[DropFlow] Clicked Buy Now button via:', sel);
        return;
      }
    }

    // Text-based fallback: find button containing "Buy Now"
    const allButtons = document.querySelectorAll('button, a[role="button"]');
    for (const btn of allButtons) {
      const text = btn.textContent?.trim().toLowerCase();
      if (text === 'buy now' || text === 'buy it now') {
        btn.click();
        console.log('[DropFlow] Clicked Buy Now button via text match');
        return;
      }
    }

    throw new Error('Could not find Buy Now button on page');
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
