/**
 * DropFlow AliExpress Checkout Address Filler
 * 
 * Injected on AliExpress checkout/order confirmation pages to:
 * 1. Fill shipping address fields with buyer's eBay shipping address
 * 2. Stop before clicking "Place Order" — user must confirm manually
 * 
 * Triggered by the service worker after the auto-order script navigates
 * from the product page to checkout.
 */

(function () {
  'use strict';

  if (window.__dropflow_checkout_address_injected) return;
  window.__dropflow_checkout_address_injected = true;

  console.log('[DropFlow Checkout] Address filler loaded on', location.href);

  // Listen for address data from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'DROPFLOW_FILL_CHECKOUT_ADDRESS') return;

    const { orderId, shippingAddress } = message.data;
    console.log('[DropFlow Checkout] Filling address for order:', orderId);

    fillCheckoutAddress(orderId, shippingAddress)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));

    return true; // async
  });

  // Also auto-fill if address data was stored before navigation
  chrome.storage.local.get('__dropflow_pending_checkout').then(result => {
    const pending = result.__dropflow_pending_checkout;
    if (pending && pending.shippingAddress && (!pending.expiresAt || Date.now() < pending.expiresAt)) {
      console.log('[DropFlow Checkout] Found pending checkout data, auto-filling...');
      // Wait for page to be ready
      waitForCheckoutReady().then(() => {
        fillCheckoutAddress(pending.orderId, pending.shippingAddress).then(result => {
          console.log('[DropFlow Checkout] Auto-fill result:', result);
          // Clear pending data
          chrome.storage.local.remove('__dropflow_pending_checkout');
          // Notify background
          chrome.runtime.sendMessage({
            type: 'AUTO_ORDER_PROGRESS',
            data: {
              orderId: pending.orderId,
              status: 'address_filled',
              message: result.error
                ? `Address fill error: ${result.error}`
                : 'Shipping address filled on checkout page. Review and place order manually.'
            }
          });
        });
      });
    }
  });

  /**
   * Main address filling logic.
   */
  async function fillCheckoutAddress(orderId, address) {
    if (!address || !address.fullName) {
      return { error: 'No shipping address provided' };
    }

    try {
      await waitForCheckoutReady();

      // Check if there's already an address and we need to edit it
      const editResult = await tryClickEditAddress();

      if (editResult === 'form_opened' || editResult === 'no_address') {
        // Fill the address form
        await fillAddressForm(address);
        await sleep(500);

        // Try to save/confirm the address
        await trySaveAddress();

        chrome.runtime.sendMessage({
          type: 'AUTO_ORDER_PROGRESS',
          data: {
            orderId,
            status: 'address_filled',
            message: 'Shipping address filled. Review and place order manually.'
          }
        });

        return { success: true, message: 'Address filled successfully' };
      } else if (editResult === 'address_exists') {
        // Address already exists — check if it matches
        return { success: true, message: 'An address already exists on checkout. Please verify it matches the buyer.' };
      }

      return { error: 'Could not find address form on checkout page' };
    } catch (err) {
      console.error('[DropFlow Checkout] Error filling address:', err);
      return { error: err.message };
    }
  }

  /**
   * Wait for the checkout page to be ready (address section visible).
   */
  async function waitForCheckoutReady(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // Check for common checkout page indicators
      const indicators = document.querySelectorAll(
        '[class*="address"], [class*="shipping"], [class*="checkout"], ' +
        'form[class*="address"], [data-pl="address"], [class*="Address"]'
      );
      if (indicators.length > 0) return true;

      // Also check for "Add new address" or "Edit" links
      const addNew = findButtonByText(['add new address', 'add address', 'new address', 'edit']);
      if (addNew) return true;

      await sleep(500);
    }
    // Proceed anyway — the page might have a different structure
    return true;
  }

  /**
   * Try to click "Edit" or "Add new address" to open the address form.
   */
  async function tryClickEditAddress() {
    // Check if there's already a filled address on the page
    const addressSection = document.querySelector(
      '[class*="address-info"], [class*="shipping-address"], ' +
      '[class*="AddressInfo"], [class*="addressInfo"]'
    );

    // Look for "Add new address" button
    const addNewBtn = findButtonByText([
      'add new address', 'add a new address', 'add address',
      'new address', 'use a new address'
    ]);
    if (addNewBtn) {
      addNewBtn.click();
      console.log('[DropFlow Checkout] Clicked "Add new address"');
      await sleep(1500);
      return 'form_opened';
    }

    // Look for "Edit" or "Change" button near address
    const editBtn = findButtonByText(['edit', 'change', 'modify']);
    if (editBtn) {
      editBtn.click();
      console.log('[DropFlow Checkout] Clicked "Edit" address');
      await sleep(1500);
      return 'form_opened';
    }

    // Check if the form fields are already visible (no existing address)
    const nameInput = findInputByLabel(['full name', 'contact name', 'name', 'recipient']);
    if (nameInput) {
      return 'no_address';
    }

    // If there's an address section with text, address may already exist
    if (addressSection && addressSection.textContent.trim().length > 20) {
      return 'address_exists';
    }

    return 'no_address';
  }

  /**
   * Fill all address form fields.
   */
  async function fillAddressForm(address) {
    // Country — must be set first as it can change available fields
    if (address.country) {
      await fillCountry(address.country);
      await sleep(800);
    }

    // Full name / Contact name
    await fillField(
      ['full name', 'contact name', 'name', 'recipient', 'receiver'],
      address.fullName
    );

    // Phone
    if (address.phone) {
      await fillField(
        ['phone', 'mobile', 'telephone', 'contact number', 'cel'],
        address.phone
      );
    }

    // Address line 1
    await fillField(
      ['address line 1', 'street address', 'address', 'street', 'address1', 'detailed address'],
      address.addressLine1
    );

    // Address line 2 (apartment, suite, etc.)
    if (address.addressLine2) {
      await fillField(
        ['address line 2', 'apartment', 'suite', 'unit', 'apt', 'address2'],
        address.addressLine2
      );
    }

    // State / Province
    if (address.state) {
      await fillStateProvince(address.state);
    }

    // City
    if (address.city) {
      await fillField(
        ['city', 'town', 'locality'],
        address.city
      );
      // City might also be a dropdown on AliExpress
      await trySelectDropdown(['city', 'town'], address.city);
    }

    // Postal / ZIP code
    if (address.postalCode) {
      await fillField(
        ['zip', 'postal', 'postcode', 'zip code', 'postal code', 'post code'],
        address.postalCode
      );
    }

    console.log('[DropFlow Checkout] Address form filled');
  }

  /**
   * Fill a text input field found by label text matching.
   */
  async function fillField(labelTexts, value) {
    if (!value) return false;

    const input = findInputByLabel(labelTexts);
    if (input) {
      await setInputValue(input, value);
      return true;
    }

    // Fallback: try placeholder text
    const inputByPlaceholder = findInputByPlaceholder(labelTexts);
    if (inputByPlaceholder) {
      await setInputValue(inputByPlaceholder, value);
      return true;
    }

    // Fallback: try name/id attributes
    const inputByAttr = findInputByAttribute(labelTexts);
    if (inputByAttr) {
      await setInputValue(inputByAttr, value);
      return true;
    }

    console.warn('[DropFlow Checkout] Could not find field for:', labelTexts[0]);
    return false;
  }

  /**
   * Set input value using React-compatible method.
   */
  async function setInputValue(input, value) {
    input.focus();
    await sleep(100);

    // Use native setter to work with React controlled inputs
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }

    // Dispatch events to trigger React/Vue state updates
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    // Also try simulating typing for stubborn frameworks
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: value
    }));

    input.blur();
    await sleep(200);
    console.log('[DropFlow Checkout] Set field value:', value.substring(0, 20) + '...');
  }

  /**
   * Find an input element by matching associated label text.
   */
  function findInputByLabel(labelTexts) {
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
      const labelText = label.textContent.trim().toLowerCase();
      for (const search of labelTexts) {
        if (labelText.includes(search.toLowerCase())) {
          // Try the label's "for" attribute
          if (label.htmlFor) {
            const input = document.getElementById(label.htmlFor);
            if (input) return input;
          }
          // Try finding input inside the label
          const input = label.querySelector('input, textarea');
          if (input) return input;
          // Try the next sibling or parent's next input
          const container = label.closest('.form-group, .field, [class*="form-item"], [class*="FormItem"]') || label.parentElement;
          if (container) {
            const input = container.querySelector('input:not([type="hidden"]), textarea');
            if (input) return input;
          }
        }
      }
    }
    return null;
  }

  /**
   * Find an input by placeholder text.
   */
  function findInputByPlaceholder(searchTexts) {
    const inputs = document.querySelectorAll('input, textarea');
    for (const input of inputs) {
      const ph = (input.placeholder || '').toLowerCase();
      for (const search of searchTexts) {
        if (ph.includes(search.toLowerCase())) return input;
      }
    }
    return null;
  }

  /**
   * Find input by name/id/data attribute matching.
   */
  function findInputByAttribute(searchTexts) {
    for (const search of searchTexts) {
      const normalized = search.replace(/\s+/g, '').toLowerCase();
      const selectors = [
        `input[name*="${normalized}" i]`,
        `input[id*="${normalized}" i]`,
        `input[data-testid*="${normalized}" i]`,
        `textarea[name*="${normalized}" i]`
      ];
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          if (el) return el;
        } catch (e) { /* invalid selector */ }
      }
    }
    return null;
  }

  /**
   * Fill country using dropdown/select.
   */
  async function fillCountry(country) {
    // Try select element
    const select = document.querySelector(
      'select[name*="country" i], select[id*="country" i], ' +
      'select[class*="country" i], select[data-name*="country" i]'
    );
    if (select) {
      await selectOptionByText(select, country);
      return;
    }

    // AliExpress often uses custom dropdown — look for country selector
    const countryTrigger = findButtonByText([country]) ||
      document.querySelector(
        '[class*="country"] [class*="select"], [class*="Country"] [class*="trigger"], ' +
        '[data-pl="country"] [role="combobox"], [class*="country-select"]'
      );
    if (countryTrigger) {
      countryTrigger.click();
      await sleep(800);
      // Find and click the matching option
      await selectCustomDropdownOption(country);
    }
  }

  /**
   * Fill state/province — could be dropdown or text input.
   */
  async function fillStateProvince(state) {
    // Try select element
    const select = document.querySelector(
      'select[name*="state" i], select[name*="province" i], ' +
      'select[id*="state" i], select[id*="province" i]'
    );
    if (select) {
      await selectOptionByText(select, state);
      return;
    }

    // Try custom dropdown
    const trigger = document.querySelector(
      '[class*="state"] [class*="select"], [class*="province"] [class*="select"], ' +
      '[data-pl="state"] [role="combobox"], [class*="State"] [class*="trigger"]'
    );
    if (trigger) {
      trigger.click();
      await sleep(800);
      await selectCustomDropdownOption(state);
      return;
    }

    // Fallback: text input
    await fillField(['state', 'province', 'region'], state);
  }

  /**
   * Try to select from a custom (non-native) dropdown.
   */
  async function trySelectDropdown(labelTexts, value) {
    // Look for dropdown triggers near matching labels
    for (const text of labelTexts) {
      const trigger = document.querySelector(
        `[class*="${text}" i] [role="combobox"], ` +
        `[class*="${text}" i] [class*="select"], ` +
        `[data-pl="${text}"] [role="combobox"]`
      );
      if (trigger) {
        trigger.click();
        await sleep(800);
        await selectCustomDropdownOption(value);
        return true;
      }
    }
    return false;
  }

  /**
   * Select an option from a native <select> by text matching.
   */
  async function selectOptionByText(select, text) {
    const normalizedText = text.toLowerCase().trim();
    const options = select.querySelectorAll('option');

    for (const opt of options) {
      const optText = opt.textContent.toLowerCase().trim();
      if (optText === normalizedText || optText.includes(normalizedText) || normalizedText.includes(optText)) {
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[DropFlow Checkout] Selected option:', opt.textContent.trim());
        return true;
      }
    }
    console.warn('[DropFlow Checkout] Option not found in select:', text);
    return false;
  }

  /**
   * Select from a custom dropdown (list of items in DOM).
   */
  async function selectCustomDropdownOption(text) {
    const normalizedText = text.toLowerCase().trim();

    // Look for dropdown items/options
    const optionSelectors = [
      '[role="option"]', '[role="listbox"] li', '[class*="dropdown"] li',
      '[class*="option"]', '[class*="select-item"]', '[class*="MenuItem"]',
      '.next-menu-item', '[class*="list-item"]'
    ];

    for (const sel of optionSelectors) {
      const options = document.querySelectorAll(sel);
      for (const opt of options) {
        const optText = opt.textContent.toLowerCase().trim();
        if (optText === normalizedText || optText.includes(normalizedText)) {
          opt.click();
          console.log('[DropFlow Checkout] Clicked custom option:', opt.textContent.trim());
          await sleep(300);
          return true;
        }
      }
    }

    // Try typing into a search/filter input in the dropdown
    const searchInput = document.querySelector(
      '[role="listbox"] input, [class*="dropdown"] input, ' +
      '[class*="search"] input, [class*="filter"] input'
    );
    if (searchInput) {
      await setInputValue(searchInput, text);
      await sleep(500);
      // Click the first result
      for (const sel of optionSelectors) {
        const firstOpt = document.querySelector(sel);
        if (firstOpt && firstOpt.offsetParent !== null) {
          firstOpt.click();
          console.log('[DropFlow Checkout] Selected search result:', firstOpt.textContent.trim());
          return true;
        }
      }
    }

    console.warn('[DropFlow Checkout] Could not select custom option:', text);
    return false;
  }

  /**
   * Try to save/confirm the address after filling.
   */
  async function trySaveAddress() {
    const saveBtn = findButtonByText([
      'save', 'confirm', 'save address', 'confirm address',
      'use this address', 'deliver here', 'ok'
    ]);
    if (saveBtn) {
      saveBtn.click();
      console.log('[DropFlow Checkout] Clicked save/confirm address');
      await sleep(1000);
      return true;
    }
    return false;
  }

  /**
   * Find a button/link by text content.
   */
  function findButtonByText(texts) {
    const candidates = document.querySelectorAll(
      'button, a[role="button"], [role="button"], a.btn, span[class*="btn"], ' +
      'div[class*="btn"], [class*="Button"]'
    );
    for (const el of candidates) {
      const elText = el.textContent.trim().toLowerCase();
      for (const text of texts) {
        if (elText === text.toLowerCase() || elText.includes(text.toLowerCase())) {
          if (el.offsetParent !== null) return el;
        }
      }
    }
    return null;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
