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
    
    const { orderId, quantity, shippingAddress, sourceVariant } = message.data;
    console.log('[DropFlow] Executing auto-order:', orderId, 'qty:', quantity, 'variant:', sourceVariant);

    executeOrder(orderId, quantity, shippingAddress, sourceVariant)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));

    return true; // async response
  });

  async function executeOrder(orderId, quantity, shippingAddress, sourceVariant) {
    try {
      // Step 0: Select correct variant before anything else
      if (sourceVariant) {
        const variantResult = await selectVariants(sourceVariant);
        console.log('[DropFlow] Variant selection result:', variantResult);
        if (!variantResult.success) {
          // Pause for manual selection — don't order the wrong variant
          chrome.runtime.sendMessage({
            type: 'AUTO_ORDER_PROGRESS',
            data: { orderId, status: 'variant_mismatch', message: 'Could not select variant automatically. Please select manually: ' + variantResult.warnings.join('; ') }
          });
          return { error: 'Variant selection failed — paused for manual selection', warnings: variantResult.warnings };
        }
        if (variantResult.warnings.length) {
          console.warn('[DropFlow] Variant warnings:', variantResult.warnings);
        }
        await sleep(1000);
      }

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

  // ── Variant Selection ──────────────────────────────────────────────

  function fuzzyMatch(a, b) {
    if (!a || !b) return false;
    const na = a.toLowerCase().trim();
    const nb = b.toLowerCase().trim();
    return na === nb || na.includes(nb) || nb.includes(na);
  }

  function getVariantOptions(sourceVariant) {
    if (!sourceVariant) return [];
    if (sourceVariant.sourceVariantText) {
      return sourceVariant.sourceVariantText.split(/\s*[\/|,;]\s*/).map(s => s.trim()).filter(Boolean);
    }
    if (sourceVariant.specifics && typeof sourceVariant.specifics === 'object') {
      const vals = Object.values(sourceVariant.specifics).filter(Boolean);
      if (vals.length) return vals;
    }
    if (sourceVariant.ebayVariant) {
      return sourceVariant.ebayVariant.split(/[,;]/).map(p => {
        const ci = p.indexOf(':');
        return ci >= 0 ? p.slice(ci + 1).trim() : p.trim();
      }).filter(Boolean);
    }
    return [];
  }

  function findBestMatch(optionValue, candidates) {
    if (!optionValue || !candidates.length) return null;
    const target = optionValue.toLowerCase().trim();
    for (const c of candidates) {
      if (c.text.toLowerCase().trim() === target) return { element: c.element, matchType: 'exact' };
    }
    for (const c of candidates) {
      if (fuzzyMatch(c.text, optionValue)) return { element: c.element, matchType: 'fuzzy' };
    }
    return null;
  }

  async function selectVariants(sourceVariant) {
    const options = getVariantOptions(sourceVariant);
    if (!options.length) return { success: true, selected: [], warnings: [] };

    const selected = [];
    const warnings = [];

    const allSkuItems = document.querySelectorAll(
      '.sku-item, [class*="sku-item"], [class*="skuItem"], ' +
      '.sku-property-item button, [class*="sku-property"] button'
    );

    const candidates = [];
    for (const el of allSkuItems) {
      let text = el.textContent?.trim() || '';
      if (!text) {
        const img = el.querySelector('img');
        text = img?.alt?.trim() || img?.title?.trim() || '';
      }
      if (!text) text = el.getAttribute('title')?.trim() || '';
      if (text) candidates.push({ element: el, text });
    }

    for (const option of options) {
      const match = findBestMatch(option, candidates);
      if (match) {
        match.element.click();
        selected.push(`${option} (${match.matchType})`);
        await sleep(500);
      } else {
        warnings.push(`No match found for variant option "${option}"`);
      }
    }

    if (warnings.length && !selected.length) {
      return { success: false, selected, warnings };
    }
    return { success: true, selected, warnings };
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
