/**
 * @vitest-environment jsdom
 */

/**
 * Tests for Amazon checkout address filling logic.
 *
 * We re-implement the pure functions extracted from checkout-address.js
 * in a testable way (the IIFE + DOM-dependent code can't be imported
 * directly). We test the logic via a simulated DOM environment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Helpers extracted from the module (mirror of implementation) ───

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

function addressMatches(existing, buyer) {
  if (!existing || !existing.raw) return false;
  const raw = existing.raw.toLowerCase();
  const checks = [buyer.name, buyer.street1, buyer.postalCode].filter(Boolean);
  return checks.every(v => raw.includes(v.toLowerCase()));
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
  for (const opt of Array.from(selectEl.options)) {
    const t = opt.textContent.toLowerCase().trim();
    const v = opt.value.toLowerCase().trim();
    if (t === norm || v === norm || t.includes(norm) || norm.includes(t)) {
      selectEl.value = opt.value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
  }
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
  const stateEl = document.getElementById(FIELD_IDS.state);
  if (stateEl) {
    if (stateEl.tagName === 'SELECT') selectOption(stateEl, address.state);
    else setField(FIELD_IDS.state, address.state);
  }
  const countryEl = document.getElementById(FIELD_IDS.country);
  if (countryEl && address.country) {
    if (countryEl.tagName === 'SELECT') selectOption(countryEl, address.country);
    else setField(FIELD_IDS.country, address.country);
  }
  if (address.phone) setField(FIELD_IDS.phone, address.phone);
}

// ── Helpers for DOM setup ──────────────────────────────────────────

function createInput(id) {
  const el = document.createElement('input');
  el.id = id;
  el.type = 'text';
  document.body.appendChild(el);
  return el;
}

function createSelect(id, options) {
  const el = document.createElement('select');
  el.id = id;
  for (const [value, text] of options) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    el.appendChild(opt);
  }
  document.body.appendChild(el);
  return el;
}

const SAMPLE_ADDRESS = {
  name: 'John Smith',
  street1: '123 Main St',
  street2: 'Apt 4B',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62704',
  country: 'US',
  phone: '555-123-4567',
};

// ── Tests ──────────────────────────────────────────────────────────

describe('Amazon Checkout Address', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // 1
  it('addressMatches returns true when existing address contains buyer details', () => {
    const existing = { raw: 'John Smith, 123 Main St, Springfield IL 62704' };
    expect(addressMatches(existing, SAMPLE_ADDRESS)).toBe(true);
  });

  // 2
  it('addressMatches returns false when name does not match', () => {
    const existing = { raw: 'Jane Doe, 123 Main St, Springfield IL 62704' };
    expect(addressMatches(existing, SAMPLE_ADDRESS)).toBe(false);
  });

  // 3
  it('addressMatches returns false for null existing', () => {
    expect(addressMatches(null, SAMPLE_ADDRESS)).toBe(false);
    expect(addressMatches({ raw: '' }, SAMPLE_ADDRESS)).toBe(false);
  });

  // 4
  it('verifyFormFields reports missing fields when DOM is empty', () => {
    const missing = verifyFormFields();
    expect(missing).toEqual(['fullName', 'line1', 'city', 'postalCode']);
  });

  // 5
  it('verifyFormFields returns empty array when all required fields exist', () => {
    createInput(FIELD_IDS.fullName);
    createInput(FIELD_IDS.line1);
    createInput(FIELD_IDS.city);
    createInput(FIELD_IDS.postalCode);
    expect(verifyFormFields()).toEqual([]);
  });

  // 6
  it('setField fills an input and dispatches events', () => {
    const input = createInput('test-field');
    const events = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    setField('test-field', 'hello');
    expect(input.value).toBe('hello');
    expect(events).toContain('input');
    expect(events).toContain('change');
  });

  // 7
  it('fillAddressForm fills all fields into DOM inputs', () => {
    // Create all form fields
    for (const id of Object.values(FIELD_IDS)) {
      createInput(id);
    }

    fillAddressForm(SAMPLE_ADDRESS);

    expect(document.getElementById(FIELD_IDS.fullName).value).toBe('John Smith');
    expect(document.getElementById(FIELD_IDS.line1).value).toBe('123 Main St');
    expect(document.getElementById(FIELD_IDS.line2).value).toBe('Apt 4B');
    expect(document.getElementById(FIELD_IDS.city).value).toBe('Springfield');
    expect(document.getElementById(FIELD_IDS.state).value).toBe('IL');
    expect(document.getElementById(FIELD_IDS.postalCode).value).toBe('62704');
    expect(document.getElementById(FIELD_IDS.phone).value).toBe('555-123-4567');
  });

  // 8
  it('fillAddressForm selects state from a <select> dropdown', () => {
    // Create inputs except state — state is a select
    for (const [key, id] of Object.entries(FIELD_IDS)) {
      if (key === 'state') continue;
      createInput(id);
    }
    createSelect(FIELD_IDS.state, [
      ['', 'Select state'],
      ['IL', 'Illinois'],
      ['CA', 'California'],
      ['NY', 'New York'],
    ]);

    fillAddressForm(SAMPLE_ADDRESS);
    expect(document.getElementById(FIELD_IDS.state).value).toBe('IL');
  });

  // 9
  it('selectOption picks option by partial text match', () => {
    const sel = createSelect('test-sel', [
      ['', 'Choose...'],
      ['US', 'United States'],
      ['CA', 'Canada'],
    ]);
    selectOption(sel, 'united states');
    expect(sel.value).toBe('US');
  });

  // 10
  it('fillAddressForm handles missing optional fields gracefully', () => {
    createInput(FIELD_IDS.fullName);
    createInput(FIELD_IDS.line1);
    createInput(FIELD_IDS.city);
    createInput(FIELD_IDS.postalCode);
    // No line2, state, country, phone inputs

    const addr = { name: 'Jane', street1: '456 Oak Ave', city: 'Portland', state: 'OR', postalCode: '97201' };
    // Should not throw
    fillAddressForm(addr);
    expect(document.getElementById(FIELD_IDS.fullName).value).toBe('Jane');
    expect(document.getElementById(FIELD_IDS.line1).value).toBe('456 Oak Ave');
  });

  // 11
  it('setField does nothing for non-existent element', () => {
    // Should not throw
    setField('nonexistent-id', 'value');
  });

  // 12
  it('addressMatches is case-insensitive', () => {
    const existing = { raw: 'JOHN SMITH, 123 MAIN ST, SPRINGFIELD IL 62704' };
    expect(addressMatches(existing, SAMPLE_ADDRESS)).toBe(true);
  });
});
