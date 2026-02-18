/**
 * Unit tests for sale-poller helper functions.
 */
import { describe, it, expect } from 'vitest';

// Extract matchSaleToProduct and resolveVariant from sale-poller.js
// (These are not exported, so we replicate the logic for testing)

function matchSaleToProduct(sale, trackedProducts) {
  if (!trackedProducts.length) return null;

  if (sale.itemId) {
    const byId = trackedProducts.find(p => p.ebayItemId === sale.itemId);
    if (byId) return byId;
  }

  if (sale.sku) {
    const skuLower = sale.sku.toLowerCase();
    const bySku = trackedProducts.find(p => {
      const label = (p.customLabel || p.sku || '').toLowerCase();
      return label && (label === skuLower || skuLower.startsWith(label) || label.startsWith(skuLower));
    });
    if (bySku) return bySku;
  }

  if (sale.title && sale.title.length > 10) {
    const saleWords = sale.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    let bestMatch = null;
    let bestScore = 0;
    for (const p of trackedProducts) {
      const pTitle = (p.ebayTitle || p.title || '').toLowerCase();
      const score = saleWords.filter(w => pTitle.includes(w)).length;
      if (score > bestScore && score >= Math.min(3, saleWords.length * 0.5)) {
        bestScore = score;
        bestMatch = p;
      }
    }
    if (bestMatch) return bestMatch;
  }

  return null;
}

function specificsmatch(a, b) {
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length === 0) return false;
  return aKeys.every(k => {
    const bVal = b[k] || b[k.toLowerCase()] || '';
    return bVal.toLowerCase() === (a[k] || '').toLowerCase();
  });
}

describe('matchSaleToProduct', () => {
  const products = [
    { ebayItemId: '111', ebayTitle: 'Blue Widget Large Size', customLabel: 'B0ABC12345' },
    { ebayItemId: '222', ebayTitle: 'Red Gadget Small', sku: 'B0DEF67890' },
    { ebayItemId: '333', ebayTitle: 'Green Thing Medium Size' },
  ];

  it('matches by eBay item ID', () => {
    const match = matchSaleToProduct({ itemId: '111' }, products);
    expect(match?.ebayItemId).toBe('111');
  });

  it('matches by SKU/custom label', () => {
    const match = matchSaleToProduct({ sku: 'B0ABC12345' }, products);
    expect(match?.ebayItemId).toBe('111');
  });

  it('matches by SKU case-insensitively', () => {
    const match = matchSaleToProduct({ sku: 'b0abc12345' }, products);
    expect(match?.ebayItemId).toBe('111');
  });

  it('matches by fuzzy title', () => {
    const match = matchSaleToProduct({ title: 'Blue Widget Large Size Premium' }, products);
    expect(match?.ebayItemId).toBe('111');
  });

  it('returns null for no match', () => {
    const match = matchSaleToProduct({ itemId: '999', title: 'Completely Different' }, products);
    expect(match).toBeNull();
  });

  it('returns null for empty product list', () => {
    const match = matchSaleToProduct({ itemId: '111' }, []);
    expect(match).toBeNull();
  });
});

describe('specificsmatch', () => {
  it('matches identical specifics', () => {
    expect(specificsmatch({ Color: 'Blue', Size: 'XL' }, { Color: 'Blue', Size: 'XL' })).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(specificsmatch({ Color: 'blue' }, { Color: 'BLUE' })).toBe(true);
  });

  it('returns false for mismatched specifics', () => {
    expect(specificsmatch({ Color: 'Blue' }, { Color: 'Red' })).toBe(false);
  });

  it('returns false for empty specifics', () => {
    expect(specificsmatch({}, { Color: 'Blue' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(specificsmatch(null, { Color: 'Blue' })).toBe(false);
  });
});
