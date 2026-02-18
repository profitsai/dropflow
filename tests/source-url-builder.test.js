/**
 * Unit tests for buildSourceUrl logic from monitor.js
 */
import { describe, it, expect } from 'vitest';

// Extracted from monitor.js
function buildSourceUrl(customLabel, ebayDomain) {
  if (!customLabel) return '';
  const label = customLabel.trim();
  const EBAY_TO_AMAZON_DOMAIN = {
    'com': 'www.amazon.com', 'ca': 'www.amazon.ca', 'co.uk': 'www.amazon.co.uk',
    'com.au': 'www.amazon.com.au', 'de': 'www.amazon.de', 'fr': 'www.amazon.fr',
    'it': 'www.amazon.it', 'es': 'www.amazon.es', 'nl': 'www.amazon.nl'
  };
  const amazonDomain = EBAY_TO_AMAZON_DOMAIN[ebayDomain] || 'www.amazon.com';

  if (/^B0[A-Z0-9]{8}$/i.test(label)) {
    return `https://${amazonDomain}/dp/${label.toUpperCase()}`;
  }
  if (/^\d{9}[\dX]$/i.test(label)) {
    return `https://${amazonDomain}/dp/${label.toUpperCase()}`;
  }
  if (/^97[89]\d{10}$/.test(label)) {
    return `https://${amazonDomain}/dp/${label}`;
  }
  if (/^[A-Z0-9]{10}$/i.test(label) && /[A-Z]/i.test(label)) {
    return `https://${amazonDomain}/dp/${label.toUpperCase()}`;
  }
  if (/^\d{10,}$/.test(label) && !/^97[89]/.test(label)) {
    return `https://www.aliexpress.com/item/${label}.html`;
  }
  return '';
}

describe('buildSourceUrl', () => {
  it('builds Amazon URL from ASIN (B0...)', () => {
    expect(buildSourceUrl('B0ABC12345', 'com')).toBe('https://www.amazon.com/dp/B0ABC12345');
  });

  it('builds Amazon AU URL from ASIN', () => {
    expect(buildSourceUrl('B0ABC12345', 'com.au')).toBe('https://www.amazon.com.au/dp/B0ABC12345');
  });

  it('builds Amazon UK URL from ASIN', () => {
    expect(buildSourceUrl('B0ABC12345', 'co.uk')).toBe('https://www.amazon.co.uk/dp/B0ABC12345');
  });

  it('handles lowercase ASIN', () => {
    expect(buildSourceUrl('b0abc12345', 'com')).toBe('https://www.amazon.com/dp/B0ABC12345');
  });

  it('builds AliExpress URL from numeric ID', () => {
    expect(buildSourceUrl('1005006123456', 'com')).toBe('https://www.aliexpress.com/item/1005006123456.html');
  });

  it('builds Amazon URL from ISBN-10', () => {
    expect(buildSourceUrl('031045526X', 'com')).toBe('https://www.amazon.com/dp/031045526X');
  });

  it('builds Amazon URL from ISBN-13', () => {
    expect(buildSourceUrl('9780310455264', 'com')).toBe('https://www.amazon.com/dp/9780310455264');
  });

  it('does NOT treat ISBN-13 as AliExpress ID', () => {
    const url = buildSourceUrl('9780310455264', 'com');
    expect(url).not.toContain('aliexpress');
  });

  it('returns empty for unrecognized format', () => {
    expect(buildSourceUrl('hello', 'com')).toBe('');
  });

  it('returns empty for null/empty', () => {
    expect(buildSourceUrl('', 'com')).toBe('');
    expect(buildSourceUrl(null, 'com')).toBe('');
  });

  it('defaults to amazon.com for unknown eBay domain', () => {
    expect(buildSourceUrl('B0ABC12345', 'xyz')).toBe('https://www.amazon.com/dp/B0ABC12345');
  });
});
