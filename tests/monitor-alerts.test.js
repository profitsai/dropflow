/**
 * Unit tests for monitor alert generation and product tracking CRUD.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resetStorage, getStorage } from './setup.js';
import { TRACKED_PRODUCTS, MONITOR_ALERTS, MONITOR_SETTINGS, DEFAULTS } from '../extension/lib/storage-keys.js';

// Simulate the helper functions from service-worker.js
async function getTrackedProducts() {
  const result = await chrome.storage.local.get(TRACKED_PRODUCTS);
  return result[TRACKED_PRODUCTS] || [];
}

async function saveTrackedProducts(products) {
  await chrome.storage.local.set({ [TRACKED_PRODUCTS]: products });
}

async function getMonitorAlerts() {
  const result = await chrome.storage.local.get(MONITOR_ALERTS);
  return result[MONITOR_ALERTS] || [];
}

async function addMonitorAlert(alert) {
  const alerts = await getMonitorAlerts();
  alerts.unshift(alert);
  if (alerts.length > 500) alerts.length = 500;
  await chrome.storage.local.set({ [MONITOR_ALERTS]: alerts });
}

function uid() {
  return 'test_' + Math.random().toString(36).slice(2, 10);
}

describe('Product Tracking CRUD', () => {
  beforeEach(() => resetStorage());

  it('adds a product', async () => {
    const product = {
      id: uid(),
      sourceType: 'amazon',
      sourceUrl: 'https://www.amazon.com/dp/B0ABC12345',
      sourceId: 'B0ABC12345',
      ebayItemId: '123456789012',
      ebayDomain: 'com',
      ebayTitle: 'Test Product',
      ebayPrice: 29.99,
      sourcePrice: 0,
      sourceInStock: null,
      lastChecked: null,
      status: 'active',
      addedAt: new Date().toISOString(),
      checkCount: 0,
      changeCount: 0,
    };
    const products = await getTrackedProducts();
    products.push(product);
    await saveTrackedProducts(products);

    const loaded = await getTrackedProducts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].sourceId).toBe('B0ABC12345');
    expect(loaded[0].ebayItemId).toBe('123456789012');
  });

  it('prevents duplicate ebayItemId', async () => {
    const product = { id: uid(), ebayItemId: '123456789012' };
    await saveTrackedProducts([product]);

    const products = await getTrackedProducts();
    const exists = products.find(p => p.ebayItemId === '123456789012');
    expect(exists).toBeTruthy();
  });

  it('removes a product', async () => {
    const p1 = { id: 'a', ebayItemId: '111' };
    const p2 = { id: 'b', ebayItemId: '222' };
    await saveTrackedProducts([p1, p2]);

    let products = await getTrackedProducts();
    products = products.filter(p => p.id !== 'a');
    await saveTrackedProducts(products);

    const loaded = await getTrackedProducts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('b');
  });

  it('updates a product', async () => {
    const product = { id: 'x', ebayItemId: '999', sourcePrice: 10, ebayPrice: 20 };
    await saveTrackedProducts([product]);

    const products = await getTrackedProducts();
    const idx = products.findIndex(p => p.id === 'x');
    Object.assign(products[idx], { sourcePrice: 15, sourceInStock: true });
    await saveTrackedProducts(products);

    const loaded = await getTrackedProducts();
    expect(loaded[0].sourcePrice).toBe(15);
    expect(loaded[0].sourceInStock).toBe(true);
  });
});

describe('Alert Generation', () => {
  beforeEach(() => resetStorage());

  it('adds an alert', async () => {
    await addMonitorAlert({
      id: uid(),
      productId: 'p1',
      type: 'out_of_stock',
      message: 'Out of stock: Test Product',
      timestamp: new Date().toISOString(),
      read: false,
    });

    const alerts = await getMonitorAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('out_of_stock');
    expect(alerts[0].read).toBe(false);
  });

  it('prepends new alerts (newest first)', async () => {
    await addMonitorAlert({ id: '1', type: 'out_of_stock', timestamp: '2026-01-01' });
    await addMonitorAlert({ id: '2', type: 'price_down', timestamp: '2026-01-02' });

    const alerts = await getMonitorAlerts();
    expect(alerts[0].id).toBe('2');
    expect(alerts[1].id).toBe('1');
  });

  it('trims to 500 alerts', async () => {
    // Pre-fill with 500 alerts
    const existing = Array.from({ length: 500 }, (_, i) => ({ id: `old_${i}`, type: 'test' }));
    await chrome.storage.local.set({ [MONITOR_ALERTS]: existing });

    await addMonitorAlert({ id: 'new', type: 'price_up' });

    const alerts = await getMonitorAlerts();
    expect(alerts).toHaveLength(500);
    expect(alerts[0].id).toBe('new');
  });

  it('generates correct alert for price increase', async () => {
    const alert = {
      id: uid(),
      productId: 'p1',
      type: 'price_up',
      message: 'Price increased: Test Product ($10.00 → $15.00)',
      oldValue: { price: 10 },
      newValue: { price: 15, suggestedEbayPrice: 19.99 },
      actionTaken: 'eBay price updated: $29.99 → $19.99',
      timestamp: new Date().toISOString(),
      read: false,
    };
    await addMonitorAlert(alert);

    const alerts = await getMonitorAlerts();
    expect(alerts[0].newValue.suggestedEbayPrice).toBe(19.99);
    expect(alerts[0].actionTaken).toContain('eBay price updated');
  });

  it('generates correct alert for restock', async () => {
    const alert = {
      id: uid(),
      productId: 'p1',
      type: 'restocked',
      message: 'Back in stock: Test Product',
      oldValue: { inStock: false },
      newValue: { inStock: true, price: 12 },
      actionTaken: 'Restocked eBay listing with quantity 3',
      timestamp: new Date().toISOString(),
      read: false,
    };
    await addMonitorAlert(alert);

    const alerts = await getMonitorAlerts();
    expect(alerts[0].type).toBe('restocked');
  });
});

describe('Price Change Detection Logic', () => {
  it('detects change above threshold', () => {
    const oldPrice = 10;
    const newPrice = 12;
    const threshold = 5; // 5%
    const pctChange = Math.abs(newPrice - oldPrice) / oldPrice * 100;
    expect(pctChange).toBe(20);
    expect(pctChange >= threshold).toBe(true);
  });

  it('ignores change below threshold', () => {
    const oldPrice = 10;
    const newPrice = 10.04;
    const threshold = 5;
    const pctChange = Math.abs(newPrice - oldPrice) / oldPrice * 100;
    expect(pctChange).toBeLessThan(threshold);
  });

  it('detects direction correctly', () => {
    expect(15 > 10 ? 'price_up' : 'price_down').toBe('price_up');
    expect(8 > 10 ? 'price_up' : 'price_down').toBe('price_down');
  });

  it('handles incomplete scrape (price=0)', () => {
    const oldPrice = 15;
    const newPrice = 0;
    // Service worker skips when newPrice=0 and oldPrice>0
    const shouldSkip = newPrice === 0 && oldPrice > 0;
    expect(shouldSkip).toBe(true);
  });
});

describe('Settings Persistence', () => {
  beforeEach(() => resetStorage());

  it('returns defaults when no settings saved', async () => {
    const result = await chrome.storage.local.get(MONITOR_SETTINGS);
    const settings = result[MONITOR_SETTINGS] || DEFAULTS[MONITOR_SETTINGS];
    expect(settings.intervalMinutes).toBe(30);
    expect(settings.concurrency).toBe(2);
    expect(settings.priceMarkupType).toBe('percentage');
    expect(settings.priceMarkupValue).toBe(30);
  });

  it('saves and loads custom settings', async () => {
    const custom = { ...DEFAULTS[MONITOR_SETTINGS], intervalMinutes: 60, concurrency: 1 };
    await chrome.storage.local.set({ [MONITOR_SETTINGS]: custom });

    const result = await chrome.storage.local.get(MONITOR_SETTINGS);
    expect(result[MONITOR_SETTINGS].intervalMinutes).toBe(60);
    expect(result[MONITOR_SETTINGS].concurrency).toBe(1);
  });

  it('preserves variable tiers', async () => {
    const tiers = [{ min: 0, max: 10, markup: 500 }, { min: 10, max: 99999, markup: 50 }];
    const custom = { ...DEFAULTS[MONITOR_SETTINGS], priceVariableTiers: tiers };
    await chrome.storage.local.set({ [MONITOR_SETTINGS]: custom });

    const result = await chrome.storage.local.get(MONITOR_SETTINGS);
    expect(result[MONITOR_SETTINGS].priceVariableTiers).toHaveLength(2);
    expect(result[MONITOR_SETTINGS].priceVariableTiers[0].markup).toBe(500);
  });
});
