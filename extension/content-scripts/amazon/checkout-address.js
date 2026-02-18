/**
 * DropFlow Amazon Checkout Address Filler
 *
 * Injected on Amazon checkout pages to fill the buyer's shipping address.
 * Reads pending checkout data from `__dropflow_pending_checkout` in
 * chrome.storage.local, which contains `buyerAddress` with fields:
 *   name, street1, street2, city, state, postalCode, country
 *
 * Safety: if the expected form selectors are not found the script reports
 * `address_fill_failed` and never submits — avoids shipping to wrong address.
 */

(function () {
  'use strict';

  if (window.__dropflow_amazon_checkout_injected) return;
  window.__dropflow_amazon_checkout_injected = true;

  console.log('[DropFlow AmazonCheckout] Address filler loaded on', location.href);

  // ── Constants ────────────────────────────────────────────────────

  const FIELD_IDS = {
    fullName:   'address-ui-widgets-enterAddressFullName',
    line1:      'address-ui-widgets-enterAddressLine1',
    line2:      'address-ui-widgets-enterAddressLine2',
    city:       'address-ui-widgets-enterAddressCity',
    state:      'address-ui-widgets-enterAddressStateOrRegion',
    postalCode: 'address-ui-widgets-enterAddressPostalCode',
    country:    'address-ui-widgets-enterAddressCountryCode',
    phone:      'address-ui-widgets-enterAddressPhoneNumber',
  };

  const USE_ADDRESS_SELECTORS = [
    'input[name="address-ui-widgets-saveOriginalOrSuggestedAddress"]',
    '#address-ui-widgets-form input[type="submit"]',
    '#orderSummaryPrimaryActionBtn input',
    'input[aria-labelledby*="address-ui-widgets-saveOriginalOrSuggestedAddress"]',
    '.ship-to-this-address a',
    'a[name="shipToThisAddress"]',
  ];

  const CHANGE_ADDRESS_SELECTORS = [
    '#addressChangeLinkId',
    'a[id*="addressChangeLinkId"]',
    '#change-shipping-address a',
    '#shipping-address-change a',
    'a[data-action="select-address"]',
  ];

  const ADD_NEW_ADDRESS_SELECTORS = [
    '#add-new-address-popover-link',
    'a#add-new-address-popover-link',
    '#addressBookEntryAdd a',
    'a[id*="add-new-address"]',
  ];

  // ── Message listener ─────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'DROPFLOW_FILL_CHECKOUT_ADDRESS') return;
    const { orderId, buyerAddress } = message.data || {};
    handleAddressFill(orderId, buyerAddress)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  });

  // ── Auto-fill from pending checkout data ─────────────────────────

  chrome.storage.local.get('__dropflow_pending_checkout').then(result => {
    const pending = result.__dropflow_pending_checkout;
    if (!pending || !pending.buyerAddress) return;
    if (pending.expiresAt && Date.now() >= pending.expiresAt) return;

    console.log('[DropFlow AmazonCheckout] Found pending checkout, auto-filling…');
    waitForCheckoutPage().then(() => {
      handleAddressFill(pending.orderId, pending.buyerAddress).then(r => {
        console.log('[DropFlow AmazonCheckout] Auto-fill result:', r);
        chrome.storage.local.remove('__dropflow_pending_checkout');
      });
    });
  });

  // ── Core logic (exported for testing) ────────────────────────────

  /**
   * Orchestrate the entire address-fill flow.
   */
  async function handleAddressFill(orderId, address) {
    if (!address || !address.name) {
      return reportFailure(orderId, 'No buyer address provided');
    }

    try {
      await waitForCheckoutPage();

      // 1. Check if a saved address already matches
      const existing = readExistingAddress();
      if (existing && addressMatches(existing, address)) {
        reportProgress(orderId, 'address_ok', 'Saved address already matches buyer address.');
        return { success: true, message: 'Address already matches' };
      }

      // 2. Need to add/change address — open the form
      const formOpened = await openAddressForm();
      if (!formOpened) {
        return reportFailure(orderId, 'Could not open address form — checkout layout unexpected');
      }

      // 3. Verify form fields exist
      await sleep(1000);
      const missing = verifyFormFields();
      if (missing.length > 0) {
        return reportFailure(orderId,
          `Address form missing expected fields: ${missing.join(', ')}. ` +
          `Found ids: ${getVisibleInputIds().join(', ') || '(none)'}`
        );
      }

      // 4. Fill the form
      fillAddressForm(address);

      // 5. Click "Use this address"
      await sleep(500);
      const submitted = clickUseThisAddress();
      if (!submitted) {
        reportProgress(orderId, 'address_filled',
          'Address fields filled but could not click submit. Please click "Use this address" manually.');
        return { success: true, message: 'Filled but manual submit needed' };
      }

      reportProgress(orderId, 'address_filled', 'Shipping address filled and submitted on Amazon checkout.');
      return { success: true, message: 'Address filled successfully' };
    } catch (err) {
      console.error('[DropFlow AmazonCheckout]', err);
      return reportFailure(orderId, err.message);
    }
  }

  // ── Address form interactions ────────────────────────────────────

  function readExistingAddress() {
    const container = document.querySelector(
      '#shipping-address-default, .ship-to-this-address, ' +
      '#address-book-entry-0, [data-testid="shipping-address"]'
    );
    if (!container) return null;
    const text = container.textContent || '';
    if (text.trim().length < 10) return null;
    return { raw: text.trim() };
  }

  function addressMatches(existing, buyer) {
    if (!existing || !existing.raw) return false;
    const raw = existing.raw.toLowerCase();
    const checks = [buyer.name, buyer.street1, buyer.postalCode].filter(Boolean);
    return checks.every(v => raw.includes(v.toLowerCase()));
  }

  async function openAddressForm() {
    // If form fields are already visible, no need to click anything
    if (document.getElementById(FIELD_IDS.fullName)) return true;

    // Try "Change" first (existing address)
    for (const sel of CHANGE_ADDRESS_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        el.click();
        await sleep(1500);
        break;
      }
    }

    // Try "Add new address"
    for (const sel of ADD_NEW_ADDRESS_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        el.click();
        await sleep(1500);
        break;
      }
    }

    // Wait a bit for form to appear
    await waitForElement(FIELD_IDS.fullName, 5000);
    return !!document.getElementById(FIELD_IDS.fullName);
  }

  function verifyFormFields() {
    const required = ['fullName', 'line1', 'city', 'postalCode'];
    return required.filter(key => !document.getElementById(FIELD_IDS[key]));
  }

  function fillAddressForm(address) {
    setField(FIELD_IDS.fullName, address.name);
    setField(FIELD_IDS.line1, address.street1);
    setField(FIELD_IDS.line2, address.street2 || '');
    setField(FIELD_IDS.city, address.city);
    setField(FIELD_IDS.postalCode, address.postalCode);

    // State — could be input or select
    const stateEl = document.getElementById(FIELD_IDS.state);
    if (stateEl) {
      if (stateEl.tagName === 'SELECT') {
        selectOption(stateEl, address.state);
      } else {
        setField(FIELD_IDS.state, address.state);
      }
    }

    // Country dropdown (or input)
    const countryEl = document.getElementById(FIELD_IDS.country);
    if (countryEl && address.country) {
      if (countryEl.tagName === 'SELECT') selectOption(countryEl, address.country);
      else setField(FIELD_IDS.country, address.country);
    }

    // Phone (optional)
    if (address.phone) {
      setField(FIELD_IDS.phone, address.phone);
    }
  }

  function setField(id, value) {
    const el = document.getElementById(id);
    if (!el || value == null) return;

    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  function selectOption(selectEl, text) {
    if (!text) return;
    const norm = text.toLowerCase().trim();
    for (const opt of selectEl.options) {
      const t = opt.textContent.toLowerCase().trim();
      const v = opt.value.toLowerCase().trim();
      if (t === norm || v === norm || t.includes(norm) || norm.includes(t)) {
        selectEl.value = opt.value;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  }

  function clickUseThisAddress() {
    for (const sel of USE_ADDRESS_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        el.click();
        console.log('[DropFlow AmazonCheckout] Clicked "Use this address" via', sel);
        return true;
      }
    }

    // Fallback: search by button text
    const btns = document.querySelectorAll('button, input[type="submit"], a[role="button"], span.a-button-text');
    for (const btn of btns) {
      const t = (btn.textContent || btn.value || '').toLowerCase();
      if (t.includes('use this address') || t.includes('deliver to this address') || t.includes('ship to this address')) {
        if (isVisible(btn)) {
          btn.click();
          console.log('[DropFlow AmazonCheckout] Clicked submit via text match:', t.trim());
          return true;
        }
      }
    }
    return false;
  }

  // ── Helpers ──────────────────────────────────────────────────────

  function isVisible(el) {
    return el && (el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0);
  }

  function getVisibleInputIds() {
    return [...document.querySelectorAll('input[id], select[id]')]
      .filter(isVisible)
      .map(el => el.id)
      .filter(Boolean);
  }

  async function waitForCheckoutPage(timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (document.querySelector('#checkoutDisplayPage, #spc-orders, .checkout-page, #sc-buy-box, form[action*="checkout"]')) return;
      if (document.getElementById(FIELD_IDS.fullName)) return;
      await sleep(500);
    }
  }

  async function waitForElement(id, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (document.getElementById(id)) return;
      await sleep(300);
    }
  }

  function reportProgress(orderId, status, message) {
    console.log(`[DropFlow AmazonCheckout] ${status}: ${message}`);
    chrome.runtime.sendMessage({
      type: 'AUTO_ORDER_PROGRESS',
      data: { orderId, status, message }
    });
  }

  function reportFailure(orderId, message) {
    console.error('[DropFlow AmazonCheckout] address_fill_failed:', message);
    chrome.runtime.sendMessage({
      type: 'AUTO_ORDER_PROGRESS',
      data: { orderId, status: 'address_fill_failed', message }
    });
    return { error: message };
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      handleAddressFill,
      readExistingAddress,
      addressMatches,
      openAddressForm,
      verifyFormFields,
      fillAddressForm,
      setField,
      selectOption,
      clickUseThisAddress,
      FIELD_IDS,
    };
  }
})();
