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

    const { orderId, quantity, shippingAddress, sourceVariant } = message.data;
    console.log('[DropFlow] Executing auto-order:', orderId, 'qty:', quantity, 'variant:', sourceVariant);

    executeOrder(orderId, quantity, shippingAddress, sourceVariant)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));

    return true;
  });

  async function executeOrder(orderId, quantity, shippingAddress, sourceVariant) {
    try {
      // Step 0: Select correct variant before anything else
      if (sourceVariant) {
        const variantResult = await selectVariants(sourceVariant);
        console.log('[DropFlow] Variant selection result:', variantResult);
        if (!variantResult.success) {
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

    for (const option of options) {
      let matched = false;

      // Button/swatch selectors
      const buttons = document.querySelectorAll(
        '[id^="variation_"] li, [id^="variation_"] .a-button-text, ' +
        '.swatchAvailable, .swatchSelect, ' +
        '#twister .a-button:not(.a-button-unavailable)'
      );

      const candidates = [];
      for (const el of buttons) {
        let text = el.textContent?.trim() || '';
        if (!text) {
          const img = el.querySelector('img');
          text = img?.alt?.trim() || img?.title?.trim() || '';
        }
        if (!text) text = el.getAttribute('title')?.trim() || '';
        if (text) candidates.push({ element: el, text });
      }

      const match = findBestMatch(option, candidates);
      if (match) {
        match.element.click();
        selected.push(`${option} (${match.matchType})`);
        matched = true;
        await sleep(500);
      }

      if (!matched) {
        // Try dropdown selectors
        const dropdowns = document.querySelectorAll(
          '[id^="variation_"] select, #native_dropdown_selected_size_name, ' +
          'select[name*="variation"], select[id*="variation"]'
        );

        for (const dropdown of dropdowns) {
          for (const opt of dropdown.querySelectorAll('option')) {
            if (fuzzyMatch(opt.textContent?.trim() || '', option)) {
              dropdown.value = opt.value;
              dropdown.dispatchEvent(new Event('change', { bubbles: true }));
              selected.push(`${option} (dropdown)`);
              matched = true;
              await sleep(500);
              break;
            }
          }
          if (matched) break;
        }
      }

      if (!matched) {
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
