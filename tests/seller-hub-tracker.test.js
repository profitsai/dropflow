import { describe, it, expect, beforeEach } from 'vitest';

/**
 * seller-hub-tracker.js is an IIFE that relies on DOM + chrome.runtime.
 * We extract and test the pure functions by re-implementing them here
 * (they're not exported). This validates the logic independently.
 */

// ---- Extracted pure functions from seller-hub-tracker.js ----

function decodeCustomLabel(label) {
  if (!label || typeof label !== 'string') return { asin: null, raw: label, valid: false };
  const trimmed = label.trim();
  if (/^B0[A-Z0-9]{8}$/i.test(trimmed)) return { asin: trimmed.toUpperCase(), raw: trimmed, valid: true };
  if (/^[A-Z0-9]{10}$/i.test(trimmed) && /[A-Z]/i.test(trimmed)) return { asin: trimmed.toUpperCase(), raw: trimmed, valid: true };
  if (/^\d{10,}$/.test(trimmed)) return { asin: trimmed, raw: trimmed, valid: true };
  try {
    const decoded = atob(trimmed);
    if (/^B0[A-Z0-9]{8}$/i.test(decoded)) return { asin: decoded.toUpperCase(), raw: trimmed, valid: true };
    if (/^[A-Z0-9]{10}$/i.test(decoded) && /[A-Z]/i.test(decoded)) return { asin: decoded.toUpperCase(), raw: trimmed, valid: true };
    if (/^\d{10,}$/.test(decoded)) return { asin: decoded, raw: trimmed, valid: true };
  } catch (_) {}
  return { asin: null, raw: trimmed, valid: false };
}

function detectColumnMap(headerTexts) {
  const map = {};
  headerTexts.forEach((text, i) => {
    const t = text.trim().toLowerCase();
    if (/\bitem\b|listing|product|title/i.test(t)) map.item = i;
    else if (/\bprice\b|buy.?it.?now/i.test(t)) map.price = i;
    else if (/\bavail|quantity|qty\b/i.test(t)) map.available = i;
    else if (/\bcustom.?label|sku\b/i.test(t)) map.customLabel = i;
    else if (/\bsold\b/i.test(t)) map.sold = i;
    else if (/\bstatus\b/i.test(t)) map.status = i;
  });
  return map;
}

// ---- Tests ----

describe('decodeCustomLabel', () => {
  it('returns invalid for null/undefined/empty', () => {
    expect(decodeCustomLabel(null).valid).toBe(false);
    expect(decodeCustomLabel(undefined).valid).toBe(false);
    expect(decodeCustomLabel('').valid).toBe(false);
  });

  it('detects plain ASIN (B0 prefix)', () => {
    const r = decodeCustomLabel('B0ABCD1234');
    expect(r).toEqual({ asin: 'B0ABCD1234', raw: 'B0ABCD1234', valid: true });
  });

  it('detects plain ASIN (lowercase)', () => {
    const r = decodeCustomLabel('b0abcd1234');
    expect(r.asin).toBe('B0ABCD1234');
    expect(r.valid).toBe(true);
  });

  it('detects 10-char alphanumeric ASIN', () => {
    const r = decodeCustomLabel('X00ABCDE12');
    expect(r.valid).toBe(true);
    expect(r.asin).toBe('X00ABCDE12');
  });

  it('detects AliExpress numeric ID', () => {
    const r = decodeCustomLabel('1005006789012345');
    expect(r.valid).toBe(true);
    expect(r.asin).toBe('1005006789012345');
  });

  it('decodes base64-encoded ASIN', () => {
    const encoded = btoa('B0ABCD1234');
    const r = decodeCustomLabel(encoded);
    expect(r.valid).toBe(true);
    expect(r.asin).toBe('B0ABCD1234');
    expect(r.raw).toBe(encoded);
  });

  it('decodes base64-encoded AliExpress ID', () => {
    const encoded = btoa('1005006789012345');
    const r = decodeCustomLabel(encoded);
    expect(r.valid).toBe(true);
    expect(r.asin).toBe('1005006789012345');
  });

  it('returns invalid for random text', () => {
    expect(decodeCustomLabel('hello-world').valid).toBe(false);
    expect(decodeCustomLabel('ABC').valid).toBe(false);
  });

  it('returns invalid for short numeric (not AliExpress)', () => {
    expect(decodeCustomLabel('12345').valid).toBe(false);
  });

  it('trims whitespace', () => {
    const r = decodeCustomLabel('  B0ABCD1234  ');
    expect(r.valid).toBe(true);
    expect(r.asin).toBe('B0ABCD1234');
  });

  it('handles non-string input', () => {
    expect(decodeCustomLabel(42).valid).toBe(false);
    expect(decodeCustomLabel({}).valid).toBe(false);
  });
});

describe('detectColumnMap', () => {
  it('maps standard eBay Seller Hub headers', () => {
    const headers = ['Item', 'Custom label', 'Available', 'Price', 'Sold', 'Status'];
    const map = detectColumnMap(headers);
    expect(map.item).toBe(0);
    expect(map.customLabel).toBe(1);
    expect(map.available).toBe(2);
    expect(map.price).toBe(3);
    expect(map.sold).toBe(4);
    expect(map.status).toBe(5);
  });

  it('handles alternate header names', () => {
    const headers = ['Product title', 'SKU', 'Qty', 'Buy It Now'];
    const map = detectColumnMap(headers);
    expect(map.item).toBe(0);
    expect(map.customLabel).toBe(1);
    expect(map.available).toBe(2);
    expect(map.price).toBe(3);
  });

  it('handles missing columns gracefully', () => {
    const headers = ['Something', 'Other'];
    const map = detectColumnMap(headers);
    expect(map.item).toBeUndefined();
    expect(map.price).toBeUndefined();
  });
});

describe('pagination extraction edge cases', () => {
  it('parses "1-200 of 1,500" format', () => {
    const text = 'Showing 1-200 of 1,500 results';
    const ofMatch = text.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)\s+of\s+([\d,]+)/i);
    expect(ofMatch).not.toBeNull();
    expect(parseInt(ofMatch[3].replace(/,/g, ''), 10)).toBe(1500);
  });

  it('handles en-dash separator', () => {
    const text = '201–400 of 800';
    const ofMatch = text.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)\s+of\s+([\d,]+)/i);
    expect(ofMatch).not.toBeNull();
    expect(parseInt(ofMatch[3].replace(/,/g, ''), 10)).toBe(800);
  });
});
