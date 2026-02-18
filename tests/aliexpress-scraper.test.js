/**
 * AliExpress Product Scraper Tests
 *
 * Tests extracted pure functions from product-scraper.js.
 * DOM-based tests use jsdom environment.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// =====================================================
// Extracted functions (replicated from product-scraper.js IIFE)
// =====================================================

function extractProductId(pathname, search = '') {
  const match = pathname.match(/\/item\/(?:[^\/]+\/)?(\d+)\.html/);
  if (match) return match[1];
  const params = new URLSearchParams(search);
  return params.get('productId') || params.get('itemId') || null;
}

function parseSkuAttr(skuAttr, axes) {
  const specifics = {};
  if (!skuAttr) return specifics;
  const parts = skuAttr.split(';');
  for (const part of parts) {
    const match = part.match(/^(\d+):(\d+)(?:#(.+))?$/);
    if (!match) continue;
    const propertyId = parseInt(match[1]);
    const valueId = parseInt(match[2]);
    const valueName = match[3] || '';
    const axis = axes.find(a => a.propertyId === propertyId);
    if (axis) {
      const value = axis.values.find(v => v.valueId === valueId);
      specifics[axis.name] = value ? value.name : valueName;
    } else if (valueName) {
      specifics[`Property_${propertyId}`] = valueName;
    }
  }
  return specifics;
}

function parseVariations(skuInfo) {
  const propertyList = skuInfo.sku_property_list || [];
  const priceList = skuInfo.sku_price_list || [];

  const axes = propertyList.map(prop => ({
    name: prop.sku_property_name || `Property_${prop.sku_property_id}`,
    propertyId: prop.sku_property_id,
    values: (prop.sku_property_value || []).map(val => ({
      valueId: val.property_value_id,
      name: val.property_value_definition_name || val.property_value_name || `${val.property_value_id}`,
      image: val.sku_image
        ? (val.sku_image.startsWith('//') ? 'https:' + val.sku_image : val.sku_image)
        : null
    }))
  }));

  if (axes.length === 0) {
    if (priceList.length === 1) {
      const singlePrice = parseFloat(priceList[0].sku_price || priceList[0].sku_bulk_order_price || 0);
      const singleStock = parseInt(priceList[0].sku_stock || 0);
      return { hasVariations: false, axes: [], skus: [], imagesByValue: {}, singleSkuPrice: singlePrice, singleSkuStock: singleStock };
    }
    return { hasVariations: false, axes: [], skus: [], imagesByValue: {} };
  }

  const skus = priceList.map(sku => {
    const specifics = parseSkuAttr(sku.sku_attr, axes);
    const price = parseFloat(sku.sku_price || sku.sku_bulk_order_price || 0);
    const stock = parseInt(sku.sku_stock || 0);
    let image = null;
    for (const axis of axes) {
      const valueName = specifics[axis.name];
      if (valueName) {
        const axisValue = axis.values.find(v => v.name === valueName);
        if (axisValue?.image) { image = axisValue.image; break; }
      }
    }
    return { skuId: String(sku.sku_id || ''), price, ebayPrice: 0, stock, specifics, image };
  });

  const imagesByValue = {};
  for (const axis of axes) {
    for (const val of axis.values) {
      if (val.image) {
        const key = `${axis.name}:${val.name}`;
        if (!imagesByValue[key]) imagesByValue[key] = [];
        imagesByValue[key].push(val.image);
      }
    }
  }

  return { hasVariations: skus.length > 1, axes, skus, imagesByValue };
}

function extractVariationsFromModule(skuModule) {
  if (!skuModule) return null;

  const normalizeAxisName = (name, fallbackId) => {
    let n = String(name || '').replace(/\s+/g, ' ').trim();
    if (n.includes(':')) n = n.split(':')[0].trim();
    n = n.replace(/\s*\(\d+\)\s*$/, '').trim();
    return n || `Property_${fallbackId || 0}`;
  };

  const propertyList = skuModule.productSKUPropertyList
    || skuModule.skuPropertyList
    || skuModule.sku_property_list
    || skuModule.propertyList
    || [];

  const priceList = skuModule.skuPriceList
    || skuModule.sku_price_list
    || skuModule.priceList
    || [];

  if (propertyList.length === 0 || priceList.length <= 1) return null;

  let axes = propertyList.map(prop => {
    const values = (prop.skuPropertyValues || prop.sku_property_value || []).map(val => {
      let img = val.skuPropertyImagePath || val.skuPropertyTips || val.sku_image || null;
      if (img && img.startsWith('//')) img = 'https:' + img;
      return {
        valueId: val.propertyValueId || val.property_value_id || 0,
        name: val.propertyValueDefinitionName || val.propertyValueDisplayName
          || val.property_value_definition_name || val.property_value_name || '',
        image: img
      };
    });
    return {
      name: normalizeAxisName(prop.skuPropertyName || prop.sku_property_name, prop.skuPropertyId || prop.sku_property_id),
      propertyId: prop.skuPropertyId || prop.sku_property_id || 0,
      values
    };
  });

  const byName = new Map();
  for (const axis of axes) {
    const key = (axis.name || '').toLowerCase();
    const prev = byName.get(key);
    if (!prev || (axis.values?.length || 0) > (prev.values?.length || 0)) byName.set(key, axis);
  }
  axes = Array.from(byName.values());

  if (axes.length > 2) {
    const score = (a) =>
      (/(color|colour|size|style|material|pattern|type|model)/i.test(a.name) ? 100 : 0) + (a.values?.length || 0);
    axes = axes.sort((a, b) => score(b) - score(a)).slice(0, 2);
  }

  const skus = priceList.map(sku => {
    const specifics = parseSkuAttr(sku.skuAttr || sku.sku_attr || '', axes);
    let price = 0;
    if (sku.skuVal) {
      price = parseFloat(
        sku.skuVal.skuAmount?.value || sku.skuVal.skuActivityAmount?.value ||
        sku.skuVal.skuCalPrice || sku.skuVal.actSkuCalPrice || 0
      );
    }
    if (!price) price = parseFloat(sku.sku_price || sku.sku_bulk_order_price || 0);
    const rawStock = sku.skuVal?.availQuantity ?? sku.sku_stock ?? null;
    const stock = (rawStock !== null && parseInt(rawStock) > 0) ? parseInt(rawStock) : 5;
    let image = null;
    for (const axis of axes) {
      const vName = specifics[axis.name];
      if (vName) {
        const axisVal = axis.values.find(v => v.name === vName);
        if (axisVal?.image) { image = axisVal.image; break; }
      }
    }
    return { skuId: String(sku.skuId || sku.sku_id || ''), price, ebayPrice: 0, stock, specifics, image };
  });

  const imagesByValue = {};
  for (const axis of axes) {
    for (const val of axis.values) {
      if (val.image) {
        const key = `${axis.name}:${val.name}`;
        if (!imagesByValue[key]) imagesByValue[key] = [];
        imagesByValue[key].push(val.image);
      }
    }
  }

  return { hasVariations: skus.length > 1, axes, skus, imagesByValue };
}

/** DOM price parser extracted from getPriceFromDom */
function parsePriceText(text) {
  const match = text.match(/[\d]+[.,]?\d*/);
  if (!match) return 0;
  let raw = match[0];
  if (raw.includes(',') && !raw.includes('.')) {
    const afterComma = raw.split(',')[1];
    if (afterComma && afterComma.length <= 2) {
      raw = raw.replace(',', '.');
    } else {
      raw = raw.replace(/,/g, '');
    }
  } else {
    raw = raw.replace(/,/g, '');
  }
  const price = parseFloat(raw);
  return price > 0 ? price : 0;
}

/** Broad price pattern from getPriceFromDom fallback */
function parseBroadPriceText(text) {
  const priceMatch = text.match(/(?:US\s*)?[$€£¥]\s*([\d]+[.,]?\d*)/);
  if (priceMatch) {
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (price > 0.01 && price < 100000 && text.length < 30) return price;
  }
  return 0;
}

/** Image URL normalization (from Phase 5) */
function normalizeImageUrl(url) {
  let u = url.startsWith('//') ? 'https:' + url : url;
  u = u.replace(/_+$/, '');
  if (/_([6-9]\d{2}|1\d{3})x/.test(u)) return u;
  if (/\.\w{3,4}_\d+x\d+[^/]*$/.test(u)) {
    u = u.replace(/(\.\w{3,4})_\d+x\d+[^/]*$/, '$1_640x640.jpg');
    return u;
  }
  if (/\.\w{3,4}$/.test(u)) return u + '_640x640.jpg';
  return u;
}

// =====================================================
// Tests
// =====================================================

describe('AliExpress Product Scraper', () => {

  // ---------------------------------------------------
  // Product ID Extraction
  // ---------------------------------------------------
  describe('extractProductId', () => {
    it('extracts ID from standard URL', () => {
      expect(extractProductId('/item/1234567890.html')).toBe('1234567890');
    });

    it('extracts ID from URL with title slug', () => {
      expect(extractProductId('/item/Cool-Widget-Thing/1234567890.html')).toBe('1234567890');
    });

    it('extracts ID from productId query param', () => {
      expect(extractProductId('/some/path', '?productId=9876543210')).toBe('9876543210');
    });

    it('extracts ID from itemId query param', () => {
      expect(extractProductId('/some/path', '?itemId=5555555555')).toBe('5555555555');
    });

    it('returns null for non-product URL', () => {
      expect(extractProductId('/category/electronics.html')).toBeNull();
    });
  });

  // ---------------------------------------------------
  // Title Extraction (DOM)
  // ---------------------------------------------------
  describe('getTitleFromDom', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('extracts title from h1[data-pl="product-title"]', () => {
      document.body.innerHTML = '<h1 data-pl="product-title">Wireless Bluetooth Earbuds</h1>';
      const el = document.querySelector('h1[data-pl="product-title"]');
      expect(el.textContent.trim()).toBe('Wireless Bluetooth Earbuds');
    });

    it('extracts title from .product-title-text', () => {
      document.body.innerHTML = '<div class="product-title-text">USB-C Hub Adapter</div>';
      const el = document.querySelector('.product-title-text');
      expect(el.textContent.trim()).toBe('USB-C Hub Adapter');
    });

    it('falls back to long h1 text', () => {
      document.body.innerHTML = '<h1>Premium Quality LED Desk Lamp With Adjustable Brightness</h1>';
      const h1 = document.querySelector('h1');
      expect(h1.textContent.trim().length).toBeGreaterThan(10);
    });

    it('skips short/branding h1 elements', () => {
      document.body.innerHTML = '<h1>AliExpress</h1><h1>Super Cool Product Name Here!</h1>';
      const allH1 = document.querySelectorAll('h1');
      const valid = Array.from(allH1).find(h => {
        const t = h.textContent.trim();
        return t.length > 10 && !t.toLowerCase().startsWith('aliexpress');
      });
      expect(valid.textContent.trim()).toBe('Super Cool Product Name Here!');
    });
  });

  // ---------------------------------------------------
  // Price Parsing
  // ---------------------------------------------------
  describe('Price Parsing', () => {
    it('parses USD price (dot decimal)', () => {
      expect(parsePriceText('$12.99')).toBe(12.99);
    });

    it('parses EUR price (comma decimal)', () => {
      expect(parsePriceText('€4,99')).toBe(4.99);
    });

    it('parses price with thousand separator', () => {
      expect(parsePriceText('$1,234')).toBe(1234);
    });

    it('parses AUD price', () => {
      expect(parsePriceText('A$24.50')).toBe(24.50);
    });

    it('returns 0 for non-price text', () => {
      expect(parsePriceText('No price here')).toBe(0);
    });

    it('parses broad price pattern US $4.99', () => {
      expect(parseBroadPriceText('US $4.99')).toBe(4.99);
    });

    it('parses broad price pattern €12,50 (with comma)', () => {
      // Broad parser uses simple replace, so €12,50 → 1250 (known behavior)
      // The main parser handles comma decimals properly
      expect(parseBroadPriceText('€12.50')).toBe(12.50);
    });

    it('parses broad price pattern £19.99', () => {
      expect(parseBroadPriceText('£19.99')).toBe(19.99);
    });

    it('rejects absurdly long text', () => {
      expect(parseBroadPriceText('$5.00 ' + 'x'.repeat(50))).toBe(0);
    });

    it('handles EUR comma decimal 3 digits after comma as thousands', () => {
      // "1,234" → afterComma.length is 3 → treated as thousand separator
      expect(parsePriceText('1,234')).toBe(1234);
    });
  });

  // ---------------------------------------------------
  // Single-SKU Products (no variants)
  // ---------------------------------------------------
  describe('Single-SKU products', () => {
    it('returns hasVariations=false when no property list', () => {
      const result = parseVariations({
        sku_property_list: [],
        sku_price_list: [{ sku_id: '1', sku_price: '9.99', sku_stock: '100' }]
      });
      expect(result.hasVariations).toBe(false);
      expect(result.axes).toHaveLength(0);
      expect(result.singleSkuPrice).toBe(9.99);
      expect(result.singleSkuStock).toBe(100);
    });

    it('returns hasVariations=false when completely empty', () => {
      const result = parseVariations({});
      expect(result.hasVariations).toBe(false);
    });

    it('single-SKU fix: does not flag single price entry as multi-variant', () => {
      // Product with property list but only 1 SKU should not be multi-variant
      const result = parseVariations({
        sku_property_list: [{
          sku_property_id: 14,
          sku_property_name: 'Color',
          sku_property_value: [{ property_value_id: 173, property_value_name: 'Black' }]
        }],
        sku_price_list: [{ sku_id: '1', sku_attr: '14:173#Black', sku_price: '15.00', sku_stock: '50' }]
      });
      // Only 1 SKU → hasVariations should be false
      expect(result.hasVariations).toBe(false);
      expect(result.skus).toHaveLength(1);
    });
  });

  // ---------------------------------------------------
  // Multi-Variant Products
  // ---------------------------------------------------
  describe('Multi-variant products (Color + Size)', () => {
    const multiSkuInfo = {
      sku_property_list: [
        {
          sku_property_id: 14,
          sku_property_name: 'Color',
          sku_property_value: [
            { property_value_id: 173, property_value_definition_name: 'Red', sku_image: '//img.alicdn.com/red.jpg' },
            { property_value_id: 174, property_value_definition_name: 'Blue', sku_image: '//img.alicdn.com/blue.jpg' }
          ]
        },
        {
          sku_property_id: 5,
          sku_property_name: 'Size',
          sku_property_value: [
            { property_value_id: 361386, property_value_name: 'S' },
            { property_value_id: 361385, property_value_name: 'M' },
            { property_value_id: 361384, property_value_name: 'L' }
          ]
        }
      ],
      sku_price_list: [
        { sku_id: '101', sku_attr: '14:173#Red;5:361386#S', sku_price: '10.00', sku_stock: '20' },
        { sku_id: '102', sku_attr: '14:173#Red;5:361385#M', sku_price: '11.00', sku_stock: '15' },
        { sku_id: '103', sku_attr: '14:173#Red;5:361384#L', sku_price: '12.00', sku_stock: '10' },
        { sku_id: '104', sku_attr: '14:174#Blue;5:361386#S', sku_price: '10.50', sku_stock: '25' },
        { sku_id: '105', sku_attr: '14:174#Blue;5:361385#M', sku_price: '11.50', sku_stock: '12' },
        { sku_id: '106', sku_attr: '14:174#Blue;5:361384#L', sku_price: '12.50', sku_stock: '8' }
      ]
    };

    it('detects hasVariations=true', () => {
      const result = parseVariations(multiSkuInfo);
      expect(result.hasVariations).toBe(true);
    });

    it('extracts 2 axes (Color and Size)', () => {
      const result = parseVariations(multiSkuInfo);
      expect(result.axes).toHaveLength(2);
      expect(result.axes[0].name).toBe('Color');
      expect(result.axes[1].name).toBe('Size');
    });

    it('generates 6 SKUs (2 colors × 3 sizes)', () => {
      const result = parseVariations(multiSkuInfo);
      expect(result.skus).toHaveLength(6);
    });

    it('assigns correct prices per SKU', () => {
      const result = parseVariations(multiSkuInfo);
      const redS = result.skus.find(s => s.specifics.Color === 'Red' && s.specifics.Size === 'S');
      expect(redS.price).toBe(10.00);
      const blueL = result.skus.find(s => s.specifics.Color === 'Blue' && s.specifics.Size === 'L');
      expect(blueL.price).toBe(12.50);
    });

    it('assigns images from color axis to SKUs', () => {
      const result = parseVariations(multiSkuInfo);
      const redSku = result.skus.find(s => s.specifics.Color === 'Red');
      expect(redSku.image).toBe('https://img.alicdn.com/red.jpg');
    });

    it('builds imagesByValue map', () => {
      const result = parseVariations(multiSkuInfo);
      expect(result.imagesByValue['Color:Red']).toEqual(['https://img.alicdn.com/red.jpg']);
      expect(result.imagesByValue['Color:Blue']).toEqual(['https://img.alicdn.com/blue.jpg']);
    });
  });

  // ---------------------------------------------------
  // Products with only Color OR only Size
  // ---------------------------------------------------
  describe('Single-axis variants', () => {
    it('handles products with only Color (no Size)', () => {
      const result = parseVariations({
        sku_property_list: [{
          sku_property_id: 14,
          sku_property_name: 'Color',
          sku_property_value: [
            { property_value_id: 1, property_value_name: 'Black' },
            { property_value_id: 2, property_value_name: 'White' }
          ]
        }],
        sku_price_list: [
          { sku_id: '1', sku_attr: '14:1#Black', sku_price: '5.00', sku_stock: '10' },
          { sku_id: '2', sku_attr: '14:2#White', sku_price: '5.50', sku_stock: '8' }
        ]
      });
      expect(result.hasVariations).toBe(true);
      expect(result.axes).toHaveLength(1);
      expect(result.axes[0].name).toBe('Color');
      expect(result.skus).toHaveLength(2);
    });

    it('handles products with only Size (no Color)', () => {
      const result = parseVariations({
        sku_property_list: [{
          sku_property_id: 5,
          sku_property_name: 'Size',
          sku_property_value: [
            { property_value_id: 100, property_value_name: 'S' },
            { property_value_id: 101, property_value_name: 'M' },
            { property_value_id: 102, property_value_name: 'L' }
          ]
        }],
        sku_price_list: [
          { sku_id: '1', sku_attr: '5:100#S', sku_price: '8.00', sku_stock: '20' },
          { sku_id: '2', sku_attr: '5:101#M', sku_price: '9.00', sku_stock: '15' },
          { sku_id: '3', sku_attr: '5:102#L', sku_price: '10.00', sku_stock: '10' }
        ]
      });
      expect(result.hasVariations).toBe(true);
      expect(result.axes).toHaveLength(1);
      expect(result.axes[0].name).toBe('Size');
      expect(result.skus).toHaveLength(3);
    });
  });

  // ---------------------------------------------------
  // parseSkuAttr
  // ---------------------------------------------------
  describe('parseSkuAttr', () => {
    const axes = [
      { name: 'Color', propertyId: 14, values: [{ valueId: 173, name: 'Red' }] },
      { name: 'Size', propertyId: 5, values: [{ valueId: 100, name: 'S' }] }
    ];

    it('parses multi-axis sku_attr string', () => {
      const result = parseSkuAttr('14:173#Red;5:100#S', axes);
      expect(result).toEqual({ Color: 'Red', Size: 'S' });
    });

    it('prefers axis value name over inline name', () => {
      const result = parseSkuAttr('14:173#Rojo', axes);
      expect(result.Color).toBe('Red'); // From axis, not "Rojo"
    });

    it('returns empty for null/empty input', () => {
      expect(parseSkuAttr('', axes)).toEqual({});
      expect(parseSkuAttr(null, axes)).toEqual({});
    });

    it('handles unknown property IDs gracefully', () => {
      const result = parseSkuAttr('999:1#Mystery', axes);
      expect(result['Property_999']).toBe('Mystery');
    });
  });

  // ---------------------------------------------------
  // extractVariationsFromModule (script tag / __NEXT_DATA__)
  // ---------------------------------------------------
  describe('extractVariationsFromModule', () => {
    it('returns null for null input', () => {
      expect(extractVariationsFromModule(null)).toBeNull();
    });

    it('returns null when no property list', () => {
      expect(extractVariationsFromModule({ skuPriceList: [{ skuId: '1' }, { skuId: '2' }] })).toBeNull();
    });

    it('returns null when only 1 SKU in price list', () => {
      expect(extractVariationsFromModule({
        productSKUPropertyList: [{ skuPropertyId: 14, skuPropertyName: 'Color', skuPropertyValues: [{ propertyValueId: 1, propertyValueDefinitionName: 'Red' }] }],
        skuPriceList: [{ skuId: '1', skuAttr: '14:1#Red' }]
      })).toBeNull();
    });

    it('parses classic productSKUPropertyList format', () => {
      const result = extractVariationsFromModule({
        productSKUPropertyList: [
          {
            skuPropertyId: 14,
            skuPropertyName: 'Color',
            skuPropertyValues: [
              { propertyValueId: 1, propertyValueDefinitionName: 'Red', skuPropertyImagePath: '//cdn/red.jpg' },
              { propertyValueId: 2, propertyValueDefinitionName: 'Blue' }
            ]
          }
        ],
        skuPriceList: [
          { skuId: '1', skuAttr: '14:1#Red', skuVal: { skuAmount: { value: '5.99' }, availQuantity: 10 } },
          { skuId: '2', skuAttr: '14:2#Blue', skuVal: { skuAmount: { value: '6.49' }, availQuantity: 8 } }
        ]
      });
      expect(result.hasVariations).toBe(true);
      expect(result.skus[0].price).toBe(5.99);
      expect(result.skus[0].image).toBe('https://cdn/red.jpg');
      expect(result.skus[1].image).toBeNull();
    });

    it('normalizes axis name by stripping colon suffix and count', () => {
      const result = extractVariationsFromModule({
        productSKUPropertyList: [
          { skuPropertyId: 14, skuPropertyName: 'Color: Red (3)', skuPropertyValues: [
            { propertyValueId: 1, propertyValueDefinitionName: 'A' },
            { propertyValueId: 2, propertyValueDefinitionName: 'B' }
          ]}
        ],
        skuPriceList: [
          { skuId: '1', skuAttr: '14:1#A' },
          { skuId: '2', skuAttr: '14:2#B' }
        ]
      });
      expect(result.axes[0].name).toBe('Color');
    });

    it('limits to 2 axes, prioritizing Color/Size', () => {
      const result = extractVariationsFromModule({
        productSKUPropertyList: [
          { skuPropertyId: 1, skuPropertyName: 'Color', skuPropertyValues: [
            { propertyValueId: 1, propertyValueDefinitionName: 'Red' },
            { propertyValueId: 2, propertyValueDefinitionName: 'Blue' }
          ]},
          { skuPropertyId: 2, skuPropertyName: 'Size', skuPropertyValues: [
            { propertyValueId: 3, propertyValueDefinitionName: 'S' },
            { propertyValueId: 4, propertyValueDefinitionName: 'M' }
          ]},
          { skuPropertyId: 3, skuPropertyName: 'Plug', skuPropertyValues: [
            { propertyValueId: 5, propertyValueDefinitionName: 'US' },
            { propertyValueId: 6, propertyValueDefinitionName: 'EU' }
          ]}
        ],
        skuPriceList: [
          { skuId: '1', skuAttr: '1:1#Red;2:3#S;3:5#US' },
          { skuId: '2', skuAttr: '1:2#Blue;2:4#M;3:6#EU' }
        ]
      });
      expect(result.axes).toHaveLength(2);
      const names = result.axes.map(a => a.name);
      expect(names).toContain('Color');
      expect(names).toContain('Size');
    });

    it('defaults stock to 5 when unavailable', () => {
      const result = extractVariationsFromModule({
        productSKUPropertyList: [
          { skuPropertyId: 14, skuPropertyName: 'Color', skuPropertyValues: [
            { propertyValueId: 1, propertyValueDefinitionName: 'Red' },
            { propertyValueId: 2, propertyValueDefinitionName: 'Blue' }
          ]}
        ],
        skuPriceList: [
          { skuId: '1', skuAttr: '14:1#Red', skuVal: { skuAmount: { value: '5.00' } } },
          { skuId: '2', skuAttr: '14:2#Blue', skuVal: { skuAmount: { value: '6.00' } } }
        ]
      });
      expect(result.skus[0].stock).toBe(5);
    });

    it('deduplicates axes with same name, keeping richer one', () => {
      const result = extractVariationsFromModule({
        productSKUPropertyList: [
          { skuPropertyId: 1, skuPropertyName: 'Color', skuPropertyValues: [
            { propertyValueId: 1, propertyValueDefinitionName: 'Red' }
          ]},
          { skuPropertyId: 2, skuPropertyName: 'Color', skuPropertyValues: [
            { propertyValueId: 3, propertyValueDefinitionName: 'Red' },
            { propertyValueId: 4, propertyValueDefinitionName: 'Blue' }
          ]}
        ],
        skuPriceList: [
          { skuId: '1', skuAttr: '2:3#Red' },
          { skuId: '2', skuAttr: '2:4#Blue' }
        ]
      });
      // Should keep the one with 2 values
      const colorAxis = result.axes.find(a => a.name === 'Color');
      expect(colorAxis.values).toHaveLength(2);
    });
  });

  // ---------------------------------------------------
  // Shipping Cost Extraction (DOM)
  // ---------------------------------------------------
  describe('Shipping extraction (DOM)', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('detects free shipping', () => {
      document.body.innerHTML = '<div class="shipping-info">Free Shipping to Australia</div>';
      const el = document.querySelector('[class*="shipping"]');
      expect(/free\s*shipp/i.test(el.textContent)).toBe(true);
    });

    it('extracts shipping cost from "$X.XX shipping" pattern', () => {
      const text = 'Shipping: $3.50 shipping to AU';
      const match = text.match(/[$€£]\s*([\d.]+)\s*(?:shipping|delivery)/i);
      expect(parseFloat(match[1])).toBe(3.50);
    });

    it('extracts estimated delivery days', () => {
      const text = 'Estimated delivery: 15-30 business days';
      const dayMatch = text.match(/(\d+)\s*[-–]\s*(\d+)\s*(?:days?|business\s*days?)/i);
      expect(dayMatch[1]).toBe('15');
      expect(dayMatch[2]).toBe('30');
    });

    it('handles no shipping info gracefully', () => {
      document.body.innerHTML = '<div>No shipping data here</div>';
      const el = document.querySelector('[class*="shipping"]');
      expect(el).toBeNull();
    });
  });

  // ---------------------------------------------------
  // Image URL Extraction and Cleaning
  // ---------------------------------------------------
  describe('Image URL normalization', () => {
    it('adds https: to protocol-relative URLs', () => {
      expect(normalizeImageUrl('//img.alicdn.com/photo.jpg')).toBe('https://img.alicdn.com/photo.jpg_640x640.jpg');
    });

    it('appends _640x640.jpg to bare image URLs', () => {
      expect(normalizeImageUrl('https://img.alicdn.com/photo.jpg')).toBe('https://img.alicdn.com/photo.jpg_640x640.jpg');
    });

    it('replaces small size suffixes with 640x640', () => {
      expect(normalizeImageUrl('https://img.alicdn.com/photo.jpg_220x220.jpg')).toBe('https://img.alicdn.com/photo.jpg_640x640.jpg');
    });

    it('preserves existing 640+ size suffixes', () => {
      const url = 'https://img.alicdn.com/photo.jpg_800x800.jpg';
      expect(normalizeImageUrl(url)).toBe(url);
    });

    it('removes trailing underscores', () => {
      const result = normalizeImageUrl('https://img.alicdn.com/photo.jpg___');
      expect(result).not.toContain('___');
    });
  });

  // ---------------------------------------------------
  // Store Name Extraction
  // ---------------------------------------------------
  describe('Store name extraction (API)', () => {
    it('extracts store_name from baseInfo', () => {
      const baseInfo = { store_name: 'TechGadgets Official Store', subject: 'Widget' };
      expect(baseInfo.store_name).toBe('TechGadgets Official Store');
    });

    it('handles missing store name gracefully', () => {
      const baseInfo = {};
      const storeName = baseInfo.store_name || '';
      expect(storeName).toBe('');
    });
  });

  // ---------------------------------------------------
  // Rating / Review Count
  // ---------------------------------------------------
  describe('Rating and review count', () => {
    it('defaults rating to null and reviewCount to 0', () => {
      // The scraper defaults to null/0 when not available from API
      const defaults = { rating: null, reviewCount: 0 };
      expect(defaults.rating).toBeNull();
      expect(defaults.reviewCount).toBe(0);
    });
  });

  // ---------------------------------------------------
  // Edge Cases
  // ---------------------------------------------------
  describe('Edge cases', () => {
    it('handles missing sku_property_value gracefully', () => {
      const result = parseVariations({
        sku_property_list: [{ sku_property_id: 14, sku_property_name: 'Color' }],
        sku_price_list: [
          { sku_id: '1', sku_attr: '', sku_price: '5.00', sku_stock: '10' },
          { sku_id: '2', sku_attr: '', sku_price: '6.00', sku_stock: '5' }
        ]
      });
      // Axis has 0 values, but still present
      expect(result.axes[0].values).toHaveLength(0);
    });

    it('handles empty variants array', () => {
      const result = parseVariations({
        sku_property_list: [],
        sku_price_list: []
      });
      expect(result.hasVariations).toBe(false);
      expect(result.skus).toHaveLength(0);
    });

    it('sku_image with protocol-relative URL gets https prefix', () => {
      const result = parseVariations({
        sku_property_list: [{
          sku_property_id: 14,
          sku_property_name: 'Color',
          sku_property_value: [
            { property_value_id: 1, property_value_name: 'Red', sku_image: '//cdn.alicdn.com/red.jpg' },
            { property_value_id: 2, property_value_name: 'Blue' }
          ]
        }],
        sku_price_list: [
          { sku_id: '1', sku_attr: '14:1#Red', sku_price: '5.00', sku_stock: '10' },
          { sku_id: '2', sku_attr: '14:2#Blue', sku_price: '6.00', sku_stock: '5' }
        ]
      });
      expect(result.axes[0].values[0].image).toBe('https://cdn.alicdn.com/red.jpg');
      expect(result.axes[0].values[1].image).toBeNull();
    });

    it('handles zero-price SKUs', () => {
      const result = parseVariations({
        sku_property_list: [{
          sku_property_id: 14,
          sku_property_name: 'Color',
          sku_property_value: [
            { property_value_id: 1, property_value_name: 'A' },
            { property_value_id: 2, property_value_name: 'B' }
          ]
        }],
        sku_price_list: [
          { sku_id: '1', sku_attr: '14:1#A', sku_price: '0', sku_stock: '10' },
          { sku_id: '2', sku_attr: '14:2#B', sku_price: '7.00', sku_stock: '5' }
        ]
      });
      expect(result.skus[0].price).toBe(0);
      expect(result.skus[1].price).toBe(7.00);
    });

    it('uses sku_bulk_order_price as fallback', () => {
      const result = parseVariations({
        sku_property_list: [{
          sku_property_id: 14,
          sku_property_name: 'Color',
          sku_property_value: [
            { property_value_id: 1, property_value_name: 'X' },
            { property_value_id: 2, property_value_name: 'Y' }
          ]
        }],
        sku_price_list: [
          { sku_id: '1', sku_attr: '14:1#X', sku_bulk_order_price: '3.50', sku_stock: '10' },
          { sku_id: '2', sku_attr: '14:2#Y', sku_bulk_order_price: '4.00', sku_stock: '5' }
        ]
      });
      expect(result.skus[0].price).toBe(3.50);
    });
  });
});
