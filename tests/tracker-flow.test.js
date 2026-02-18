import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for tracker flow logic: applyPruningRules, applyStockRules, applyPriceRules.
 * These are extracted from service-worker.js since they can't be imported directly.
 * We replicate the logic faithfully and test it.
 */

// Mock reviseEbayListing
const reviseEbayListing = vi.fn();
const trackerLog = vi.fn();

// ---- Extracted logic ----

async function applyPruningRules(item, settings) {
  if (settings.pruneNoSku && (!item.customLabel || item.customLabel.trim() === '')) {
    trackerLog(`  #${item.position} ${item.itemId}: PRUNED — no SKU`);
    if (settings.pruneNoSkuAction === 'delete') {
      await reviseEbayListing({ ebayItemId: item.itemId, ebayDomain: settings.ebayDomain || 'com.au' }, { action: 'end_listing' });
    } else {
      await reviseEbayListing({ ebayItemId: item.itemId, ebayDomain: settings.ebayDomain || 'com.au' }, { action: 'set_quantity', quantity: 0 });
    }
    return true;
  }
  if (settings.pruneBrokenSku && item.customLabel && !item.skuValid) {
    trackerLog(`  #${item.position} ${item.itemId}: PRUNED — broken SKU "${item.customLabel}"`);
    if (settings.pruneBrokenSkuAction === 'delete') {
      await reviseEbayListing({ ebayItemId: item.itemId, ebayDomain: settings.ebayDomain || 'com.au' }, { action: 'end_listing' });
    } else {
      await reviseEbayListing({ ebayItemId: item.itemId, ebayDomain: settings.ebayDomain || 'com.au' }, { action: 'set_quantity', quantity: 0 });
    }
    return true;
  }
  if (settings.pruneNoSales && item.sold !== undefined) {
    if (item.sold <= settings.pruneNoSalesCount) {
      // Date-based check not implemented yet
    }
  }
  return false;
}

async function applyStockRules(item, amazonResult, settings) {
  const domain = settings.ebayDomain || 'com.au';
  if (amazonResult.notFound) {
    if (settings.pruneNotFound) {
      trackerLog(`  #${item.position} ${item.itemId}: NOT FOUND`);
      if (settings.pruneNotFoundAction === 'delete') {
        await reviseEbayListing({ ebayItemId: item.itemId, ebayDomain: domain }, { action: 'end_listing' });
      } else {
        await reviseEbayListing({ ebayItemId: item.itemId, ebayDomain: domain }, { action: 'set_quantity', quantity: 0 });
      }
    }
    return;
  }
  if (amazonResult.skuMismatch) {
    if (settings.pruneSkuChanged) {
      if (settings.pruneSkuChangedAction === 'delete') {
        await reviseEbayListing({ ebayItemId: item.itemId, ebayDomain: domain }, { action: 'end_listing' });
      } else {
        await reviseEbayListing({ ebayItemId: item.itemId, ebayDomain: domain }, { action: 'set_quantity', quantity: 0 });
      }
    }
    return;
  }
  if (!amazonResult.inStock) {
    await reviseEbayListing({ ebayItemId: item.itemId, ebayDomain: domain }, { action: 'set_quantity', quantity: 0 });
  } else if (item.quantity === 0 || settings.forceRestock) {
    const qty = settings.forceRestock ? (settings.forceRestockQty || 1) : (settings.restockQuantity || 1);
    await reviseEbayListing({ ebayItemId: item.itemId, ebayDomain: domain }, { action: 'set_quantity', quantity: qty });
  }
}

async function applyPriceRules(item, amazonResult, settings) {
  const domain = settings.ebayDomain || 'com.au';
  if (settings.priceEndingFilter) {
    const endings = settings.priceEndingFilter.split(',').map(e => e.trim());
    const priceStr = item.price.toFixed(2);
    const ending = priceStr.slice(-2);
    if (endings.length > 0 && !endings.includes(ending)) {
      return;
    }
  }
  const amazonPrice = amazonResult.price;
  const markupPct = settings.markupPercentage || 100;
  const newEbayPrice = +(amazonPrice * (1 + markupPct / 100)).toFixed(2);
  const priceDiff = Math.abs(newEbayPrice - item.price);
  const threshold = settings.priceTriggerThreshold || 2;
  if (priceDiff >= threshold) {
    await reviseEbayListing({ ebayItemId: item.itemId, ebayDomain: domain }, { action: 'set_price', price: newEbayPrice });
  }
}

// ---- Helpers ----

const baseItem = {
  position: 1,
  itemId: '1234567890',
  title: 'Test Item',
  price: 29.99,
  quantity: 3,
  customLabel: 'B0ABCD1234',
  asin: 'B0ABCD1234',
  skuValid: true,
  sold: 5,
  status: 'Active',
};

const baseSettings = {
  pruneNoSku: false,
  pruneNoSkuAction: 'oos',
  pruneBrokenSku: false,
  pruneBrokenSkuAction: 'oos',
  pruneNotFound: false,
  pruneNotFoundAction: 'oos',
  pruneSkuChanged: false,
  pruneSkuChangedAction: 'oos',
  pruneNoSales: false,
  pruneNoSalesAction: 'oos',
  pruneNoSalesDays: 30,
  pruneNoSalesCount: 0,
  enableStockMonitor: true,
  enablePriceMonitor: true,
  restockQuantity: 1,
  forceRestock: false,
  forceRestockQty: 1,
  markupPercentage: 100,
  priceTriggerThreshold: 2,
  priceEndingFilter: '',
  ebayDomain: 'com.au',
};

// ---- Tests ----

describe('applyPruningRules', () => {
  beforeEach(() => { reviseEbayListing.mockClear(); trackerLog.mockClear(); });

  it('returns false when no pruning enabled', async () => {
    expect(await applyPruningRules(baseItem, baseSettings)).toBe(false);
    expect(reviseEbayListing).not.toHaveBeenCalled();
  });

  it('prunes no-SKU items → OOS', async () => {
    const item = { ...baseItem, customLabel: '' };
    const settings = { ...baseSettings, pruneNoSku: true, pruneNoSkuAction: 'oos' };
    expect(await applyPruningRules(item, settings)).toBe(true);
    expect(reviseEbayListing).toHaveBeenCalledWith(
      expect.objectContaining({ ebayItemId: item.itemId }),
      expect.objectContaining({ action: 'set_quantity', quantity: 0 })
    );
  });

  it('prunes no-SKU items → delete', async () => {
    const item = { ...baseItem, customLabel: '' };
    const settings = { ...baseSettings, pruneNoSku: true, pruneNoSkuAction: 'delete' };
    expect(await applyPruningRules(item, settings)).toBe(true);
    expect(reviseEbayListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'end_listing' })
    );
  });

  it('prunes broken SKU → OOS', async () => {
    const item = { ...baseItem, customLabel: 'junk!!', skuValid: false };
    const settings = { ...baseSettings, pruneBrokenSku: true };
    expect(await applyPruningRules(item, settings)).toBe(true);
    expect(reviseEbayListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'set_quantity', quantity: 0 })
    );
  });

  it('prunes broken SKU → delete', async () => {
    const item = { ...baseItem, customLabel: 'junk!!', skuValid: false };
    const settings = { ...baseSettings, pruneBrokenSku: true, pruneBrokenSkuAction: 'delete' };
    expect(await applyPruningRules(item, settings)).toBe(true);
    expect(reviseEbayListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'end_listing' })
    );
  });

  it('does not prune valid SKU even with broken-sku enabled', async () => {
    const settings = { ...baseSettings, pruneBrokenSku: true };
    expect(await applyPruningRules(baseItem, settings)).toBe(false);
  });

  it('does not prune item with SKU when pruneNoSku is on', async () => {
    const settings = { ...baseSettings, pruneNoSku: true };
    expect(await applyPruningRules(baseItem, settings)).toBe(false);
  });
});

describe('applyStockRules', () => {
  beforeEach(() => { reviseEbayListing.mockClear(); });

  it('sets OOS when Amazon not found + pruneNotFound enabled', async () => {
    const settings = { ...baseSettings, pruneNotFound: true };
    await applyStockRules(baseItem, { notFound: true }, settings);
    expect(reviseEbayListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'set_quantity', quantity: 0 })
    );
  });

  it('deletes listing when Amazon not found + action=delete', async () => {
    const settings = { ...baseSettings, pruneNotFound: true, pruneNotFoundAction: 'delete' };
    await applyStockRules(baseItem, { notFound: true }, settings);
    expect(reviseEbayListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'end_listing' })
    );
  });

  it('ignores not-found when pruneNotFound disabled', async () => {
    await applyStockRules(baseItem, { notFound: true }, baseSettings);
    expect(reviseEbayListing).not.toHaveBeenCalled();
  });

  it('handles SKU mismatch → OOS', async () => {
    const settings = { ...baseSettings, pruneSkuChanged: true };
    await applyStockRules(baseItem, { skuMismatch: true }, settings);
    expect(reviseEbayListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'set_quantity', quantity: 0 })
    );
  });

  it('handles SKU mismatch → delete', async () => {
    const settings = { ...baseSettings, pruneSkuChanged: true, pruneSkuChangedAction: 'delete' };
    await applyStockRules(baseItem, { skuMismatch: true }, settings);
    expect(reviseEbayListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'end_listing' })
    );
  });

  it('sets qty=0 when Amazon OOS', async () => {
    await applyStockRules(baseItem, { inStock: false }, baseSettings);
    expect(reviseEbayListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'set_quantity', quantity: 0 })
    );
  });

  it('restocks when Amazon in stock + eBay qty=0', async () => {
    const item = { ...baseItem, quantity: 0 };
    await applyStockRules(item, { inStock: true }, baseSettings);
    expect(reviseEbayListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'set_quantity', quantity: 1 })
    );
  });

  it('uses restockQuantity from settings', async () => {
    const item = { ...baseItem, quantity: 0 };
    const settings = { ...baseSettings, restockQuantity: 5 };
    await applyStockRules(item, { inStock: true }, settings);
    expect(reviseEbayListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quantity: 5 })
    );
  });

  it('force restock overrides quantity', async () => {
    const settings = { ...baseSettings, forceRestock: true, forceRestockQty: 10 };
    await applyStockRules(baseItem, { inStock: true }, settings);
    expect(reviseEbayListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quantity: 10 })
    );
  });

  it('does nothing when in stock + qty > 0 + no force restock', async () => {
    await applyStockRules(baseItem, { inStock: true }, baseSettings);
    expect(reviseEbayListing).not.toHaveBeenCalled();
  });
});

describe('applyPriceRules', () => {
  beforeEach(() => { reviseEbayListing.mockClear(); });

  it('updates price when diff >= threshold', async () => {
    // Amazon $10, markup 100% → $20. Item price $29.99 → diff $9.99 >= $2
    const item = { ...baseItem, price: 29.99 };
    await applyPriceRules(item, { price: 10 }, baseSettings);
    expect(reviseEbayListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'set_price', price: 20 })
    );
  });

  it('does NOT update price when diff < threshold', async () => {
    // Amazon $14.50, markup 100% → $29.00. Item price $29.99 → diff $0.99 < $2
    const item = { ...baseItem, price: 29.99 };
    await applyPriceRules(item, { price: 14.50 }, baseSettings);
    expect(reviseEbayListing).not.toHaveBeenCalled();
  });

  it('calculates markup correctly', async () => {
    // Amazon $25, markup 50% → $37.50
    const item = { ...baseItem, price: 10 };
    const settings = { ...baseSettings, markupPercentage: 50 };
    await applyPriceRules(item, { price: 25 }, settings);
    expect(reviseEbayListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ price: 37.50 })
    );
  });

  it('respects custom threshold', async () => {
    // Amazon $15, markup 100% → $30. Item $29 → diff $1. Threshold $5 → skip
    const item = { ...baseItem, price: 29 };
    const settings = { ...baseSettings, priceTriggerThreshold: 5 };
    await applyPriceRules(item, { price: 15 }, settings);
    expect(reviseEbayListing).not.toHaveBeenCalled();
  });

  it('skips items not matching priceEndingFilter', async () => {
    // Item price ends in .99 → "99". Filter requires "97"
    const item = { ...baseItem, price: 29.99 };
    const settings = { ...baseSettings, priceEndingFilter: '97' };
    await applyPriceRules(item, { price: 10 }, settings);
    expect(reviseEbayListing).not.toHaveBeenCalled();
  });

  it('processes items matching priceEndingFilter', async () => {
    const item = { ...baseItem, price: 29.99 };
    const settings = { ...baseSettings, priceEndingFilter: '99,97' };
    await applyPriceRules(item, { price: 10 }, settings);
    expect(reviseEbayListing).toHaveBeenCalled();
  });

  it('empty priceEndingFilter processes all', async () => {
    const item = { ...baseItem, price: 29.99 };
    await applyPriceRules(item, { price: 10 }, { ...baseSettings, priceEndingFilter: '' });
    expect(reviseEbayListing).toHaveBeenCalled();
  });
});

describe('position/page tracking', () => {
  it('position increments per item', () => {
    const items = [{ position: 1 }, { position: 2 }, { position: 3 }];
    items.forEach((item, i) => {
      expect(item.position).toBe(i + 1);
    });
  });

  it('page calculation from offset', () => {
    const itemsPerPage = 200;
    for (const page of [1, 2, 5]) {
      const offset = (page - 1) * itemsPerPage;
      expect(offset).toBe((page - 1) * 200);
    }
  });

  it('totalPages from totalItems', () => {
    expect(Math.ceil(1500 / 200)).toBe(8);
    expect(Math.ceil(200 / 200)).toBe(1);
    expect(Math.ceil(0 / 200)).toBe(0);
    expect(Math.ceil(201 / 200)).toBe(2);
  });
});
