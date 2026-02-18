/**
 * Unit tests for sale-poller helper functions.
 * matchSaleToProduct and resolveVariant/specificsmatch are private functions,
 * so we replicate them here for unit testing.
 */
import { describe, it, expect } from 'vitest';

// === Replicated private functions from sale-poller.js ===

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

function resolveVariant(sale, trackedProduct) {
  if (!sale.variant && !sale.sku) return null;
  if (!trackedProduct) return { ebayVariant: sale.variant || '', sku: sale.sku || '' };

  const variantMap = trackedProduct.variantMap || trackedProduct.skuMap || null;
  if (!variantMap) {
    return {
      ebayVariant: sale.variant || '',
      sku: sale.sku || '',
      sourceUrl: trackedProduct.sourceUrl || ''
    };
  }

  const specifics = {};
  if (sale.variant) {
    const parts = sale.variant.split(/[,;]/).map(s => s.trim());
    for (const part of parts) {
      const [key, ...valParts] = part.split(':');
      if (key && valParts.length) {
        specifics[key.trim()] = valParts.join(':').trim();
      }
    }
  }

  if (Array.isArray(variantMap)) {
    for (const mapping of variantMap) {
      if (mapping.ebaySpecifics && specificsmatch(specifics, mapping.ebaySpecifics)) {
        return {
          sourceVariantId: mapping.sourceVariantId || '',
          sourceVariantText: mapping.sourceText || '',
          sourceUrl: mapping.sourceUrl || trackedProduct.sourceUrl || '',
          specifics
        };
      }
      if (sale.sku && mapping.sku === sale.sku) {
        return {
          sourceVariantId: mapping.sourceVariantId || '',
          sourceVariantText: mapping.sourceText || '',
          sourceUrl: mapping.sourceUrl || trackedProduct.sourceUrl || '',
          specifics
        };
      }
    }
  } else if (typeof variantMap === 'object') {
    const variantKey = sale.variant || sale.sku || '';
    if (variantMap[variantKey]) {
      const m = variantMap[variantKey];
      return {
        sourceVariantId: m.sourceVariantId || '',
        sourceVariantText: m.sourceText || '',
        sourceUrl: m.sourceUrl || trackedProduct.sourceUrl || '',
        specifics
      };
    }
    const specVals = Object.values(specifics);
    const specKey = specVals.join(' / ');
    if (variantMap[specKey]) {
      const m = variantMap[specKey];
      return {
        sourceVariantId: m.sourceVariantId || '',
        sourceVariantText: m.sourceText || '',
        sourceUrl: m.sourceUrl || trackedProduct.sourceUrl || '',
        specifics
      };
    }
  }

  return {
    ebayVariant: sale.variant || '',
    sku: sale.sku || '',
    sourceUrl: trackedProduct.sourceUrl || '',
    specifics
  };
}

// ============================================================
// matchSaleToProduct
// ============================================================
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

  it('matches SKU via sku field (not just customLabel)', () => {
    const match = matchSaleToProduct({ sku: 'B0DEF67890' }, products);
    expect(match?.ebayItemId).toBe('222');
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

  it('prefers item ID match over SKU', () => {
    const match = matchSaleToProduct({ itemId: '111', sku: 'B0DEF67890' }, products);
    expect(match?.ebayItemId).toBe('111');
  });

  it('falls back from item ID to SKU when item ID not found', () => {
    const match = matchSaleToProduct({ itemId: '999', sku: 'B0DEF67890' }, products);
    expect(match?.ebayItemId).toBe('222');
  });

  it('matches SKU prefix (sale SKU starts with product label)', () => {
    const match = matchSaleToProduct({ sku: 'B0ABC12345-BLUE-XL' }, products);
    expect(match?.ebayItemId).toBe('111');
  });

  it('does not fuzzy match short titles', () => {
    const match = matchSaleToProduct({ title: 'Short' }, products);
    expect(match).toBeNull();
  });

  it('picks highest scoring fuzzy match', () => {
    const match = matchSaleToProduct({ title: 'Green Thing Medium Size Extra' }, products);
    expect(match?.ebayItemId).toBe('333');
  });
});

// ============================================================
// specificsmatch
// ============================================================
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
    expect(specificsmatch({ Color: 'Blue' }, null)).toBe(false);
  });

  it('matches when a has fewer keys than b (subset)', () => {
    expect(specificsmatch({ Color: 'Blue' }, { Color: 'Blue', Size: 'XL' })).toBe(true);
  });

  it('returns false when a has keys not in b', () => {
    expect(specificsmatch({ Color: 'Blue', Material: 'Cotton' }, { Color: 'Blue' })).toBe(false);
  });
});

// ============================================================
// resolveVariant
// ============================================================
describe('resolveVariant', () => {
  it('returns null when sale has no variant and no sku', () => {
    expect(resolveVariant({}, { sourceUrl: 'https://example.com' })).toBeNull();
  });

  it('returns raw info when no tracked product', () => {
    const result = resolveVariant({ variant: 'Color: Blue', sku: 'SKU1' }, null);
    expect(result).toEqual({ ebayVariant: 'Color: Blue', sku: 'SKU1' });
  });

  it('returns raw info when product has no variant map', () => {
    const result = resolveVariant(
      { variant: 'Color: Blue' },
      { sourceUrl: 'https://ali.com/item/1' }
    );
    expect(result.ebayVariant).toBe('Color: Blue');
    expect(result.sourceUrl).toBe('https://ali.com/item/1');
  });

  it('resolves variant from array variant map by specifics', () => {
    const product = {
      sourceUrl: 'https://ali.com/item/1',
      variantMap: [
        { ebaySpecifics: { Color: 'Blue', Size: 'XL' }, sourceVariantId: 'V1', sourceText: 'Blue XL' },
        { ebaySpecifics: { Color: 'Red', Size: 'M' }, sourceVariantId: 'V2', sourceText: 'Red M' }
      ]
    };
    const result = resolveVariant({ variant: 'Color: Blue, Size: XL' }, product);
    expect(result.sourceVariantId).toBe('V1');
    expect(result.sourceVariantText).toBe('Blue XL');
  });

  it('resolves variant from array variant map by SKU', () => {
    const product = {
      sourceUrl: 'https://ali.com/item/1',
      variantMap: [
        { sku: 'SKU-BLUE', sourceVariantId: 'V1', sourceText: 'Blue' }
      ]
    };
    const result = resolveVariant({ sku: 'SKU-BLUE' }, product);
    expect(result.sourceVariantId).toBe('V1');
  });

  it('resolves variant from object variant map by variant key', () => {
    const product = {
      sourceUrl: 'https://ali.com/item/1',
      variantMap: {
        'Color: Blue': { sourceVariantId: 'V1', sourceText: 'Blue' }
      }
    };
    const result = resolveVariant({ variant: 'Color: Blue' }, product);
    expect(result.sourceVariantId).toBe('V1');
  });

  it('resolves variant from object variant map by specifics values key', () => {
    const product = {
      sourceUrl: 'https://ali.com/item/1',
      variantMap: {
        'Blue / XL': { sourceVariantId: 'V1', sourceText: 'Blue XL' }
      }
    };
    const result = resolveVariant({ variant: 'Color: Blue, Size: XL' }, product);
    expect(result.sourceVariantId).toBe('V1');
  });

  it('falls back to raw info when no map entry matches', () => {
    const product = {
      sourceUrl: 'https://ali.com/item/1',
      variantMap: { 'Color: Red': { sourceVariantId: 'V2' } }
    };
    const result = resolveVariant({ variant: 'Color: Green' }, product);
    expect(result.ebayVariant).toBe('Color: Green');
    expect(result.sourceUrl).toBe('https://ali.com/item/1');
  });

  it('parses variant specifics with colons in values', () => {
    const product = {
      sourceUrl: 'https://ali.com/item/1',
      variantMap: [
        { ebaySpecifics: { Size: '10:00 AM' }, sourceVariantId: 'V1' }
      ]
    };
    const result = resolveVariant({ variant: 'Size: 10:00 AM' }, product);
    expect(result.sourceVariantId).toBe('V1');
  });
});
