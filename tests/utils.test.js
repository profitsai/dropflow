import { describe, it, expect } from 'vitest';
import {
  extractAsin,
  extractAmazonDomain,
  amazonToEbayDomain,
  truncate,
  formatPrice,
  parseAmazonLinks,
  parseAliExpressLinks,
  extractAliExpressProductId,
  uid,
} from '../extension/lib/utils.js';

describe('extractAsin', () => {
  it('extracts from /dp/ URL', () => {
    expect(extractAsin('https://amazon.com/dp/B08N5WRWNW')).toBe('B08N5WRWNW');
  });
  it('extracts from /gp/product/ URL', () => {
    expect(extractAsin('https://amazon.com/gp/product/B08N5WRWNW/ref=x')).toBe('B08N5WRWNW');
  });
  it('returns null for non-Amazon URL', () => {
    expect(extractAsin('https://ebay.com/itm/123')).toBeNull();
  });
});

describe('extractAmazonDomain', () => {
  it('extracts .com', () => {
    expect(extractAmazonDomain('https://amazon.com/dp/X')).toBe('com');
  });
  it('extracts .co.uk', () => {
    expect(extractAmazonDomain('https://amazon.co.uk/dp/X')).toBe('co.uk');
  });
});

describe('amazonToEbayDomain', () => {
  it('maps known domains', () => {
    expect(amazonToEbayDomain('com')).toBe('com');
    expect(amazonToEbayDomain('co.uk')).toBe('co.uk');
    expect(amazonToEbayDomain('de')).toBe('de');
  });
  it('defaults to com for unknown', () => {
    expect(amazonToEbayDomain('co.jp')).toBe('com');
  });
});

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 80)).toBe('hello');
  });
  it('truncates long strings with ellipsis', () => {
    const long = 'a'.repeat(100);
    const result = truncate(long, 20);
    expect(result.length).toBe(20);
    expect(result.endsWith('...')).toBe(true);
  });
  it('handles empty/null', () => {
    expect(truncate('')).toBe('');
    expect(truncate(null)).toBe('');
  });
});

describe('formatPrice', () => {
  it('formats USD', () => {
    expect(formatPrice(9.9, 'USD')).toBe('$9.90');
  });
  it('formats GBP', () => {
    expect(formatPrice(15, 'GBP')).toBe('£15.00');
  });
});

describe('parseAmazonLinks', () => {
  it('parses newline-separated links', () => {
    const result = parseAmazonLinks('https://amazon.com/dp/A\nhttps://amazon.com/dp/B');
    expect(result).toHaveLength(2);
  });
  it('filters non-Amazon', () => {
    const result = parseAmazonLinks('https://ebay.com\nhttps://amazon.com/dp/A');
    expect(result).toHaveLength(1);
  });
});

describe('parseAliExpressLinks', () => {
  it('parses aliexpress links', () => {
    const result = parseAliExpressLinks('https://aliexpress.com/item/123.html');
    expect(result).toHaveLength(1);
  });
});

describe('extractAliExpressProductId', () => {
  it('extracts numeric ID', () => {
    expect(extractAliExpressProductId('https://aliexpress.com/item/1005001234567.html')).toBe('1005001234567');
  });
  it('handles slug prefix', () => {
    expect(extractAliExpressProductId('https://aliexpress.com/item/Cool-Widget/1005001234567.html')).toBe('1005001234567');
  });
  it('returns null for bad URL', () => {
    expect(extractAliExpressProductId('https://amazon.com/dp/X')).toBeNull();
  });
});

describe('uid', () => {
  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uid()));
    expect(ids.size).toBe(100);
  });
});
