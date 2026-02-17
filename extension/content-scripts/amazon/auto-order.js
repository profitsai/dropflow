/**
 * DropFlow Amazon Auto-Order Content Script
 * 
 * Injected on an Amazon product page to:
 * 1. Set the correct quantity
 * 2. Click "Add to Cart" or "Buy Now"
 * 3. STOP before final payment — notify user to review & confirm
 * 
 * This script does NOT complete payment automatically for safety.
 */

(function() {
  'use strict';

  if (window.__dropflow_auto_order_injected) return;
  window.__dropflow_auto_order_injected = true;

  console.log('[DropFlow] Amazon auto-order script loaded');

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'DROPFLOW_AUTO_ORDER_EXECUTE') return;

    const { orderId, quantity, shippingAddress } = message.data;
    console.log('[DropFlow] Executing auto-order:', orderId, 'qty:', quantity);

    executeOrder(orderId, quantity, shippingAddress)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));

    return true;
  });

  async function executeOrder(orderId, quantity, shippingAddress) {
    try {
      // Step 1: Set quantity
      await setQuantity(quantity);
      await sleep(1000);

      // Step 2: Click Add to Cart (safer than Buy Now for dropshipping)
      await clickAddToCart();

      chrome.runtime.sendMessage({
        type: 'AUTO_ORDER_PROGRESS',
        data: { orderId, status: 'cart_added', message: 'Product added to cart. Please review and proceed to checkout.' }
      });

      return { success: true, message: 'Added to cart successfully' };
    } catch (err) {
      console.error('[DropFlow] Auto-order error:', err);
      return { error: err.message };
    }
  }

  async function setQuantity(qty) {
    if (!qty || qty <= 1) return;

    // Amazon uses a dropdown for quantity
    const qtySelect = document.querySelector('#quantity, select[name="quantity"]');
    if (qtySelect) {
      qtySelect.value = String(qty);
      qtySelect.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[DropFlow] Quantity set to:', qty);
      return;
    }

    // Some pages use a text input
    const qtyInput = document.querySelector('input[name="quantity"], input#quantity');
    if (qtyInput) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      ).set;
      nativeInputValueSetter.call(qtyInput, String(qty));
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
      qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[DropFlow] Quantity input set to:', qty);
    }
  }

  async function clickAddToCart() {
    const addToCartSelectors = [
      '#add-to-cart-button',
      'input[name="submit.add-to-cart"]',
      '#add-to-cart-button-ubb',
      'span#submit\\.add-to-cart input',
      'input#add-to-cart-button'
    ];

    for (const sel of addToCartSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        console.log('[DropFlow] Clicked Add to Cart via:', sel);
        return;
      }
    }

    // Fallback: Buy Now
    const buyNow = document.querySelector('#buy-now-button, input[name="submit.buy-now"]');
    if (buyNow) {
      buyNow.click();
      console.log('[DropFlow] Clicked Buy Now (fallback)');
      return;
    }

    throw new Error('Could not find Add to Cart or Buy Now button');
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
