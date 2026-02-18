import { describe, it, expect, beforeEach } from 'vitest';
import * as SK from '../extension/lib/storage-keys.js';
import { resetStorage, getStorage } from './setup.js';

describe('Tracker settings defaults', () => {
  it('TRACKER_SETTINGS key exists', () => {
    expect(SK.TRACKER_SETTINGS).toBe('trackerSettings');
  });

  it('default tracker settings have all expected fields', () => {
    const ts = SK.DEFAULTS[SK.TRACKER_SETTINGS];
    expect(ts).toBeDefined();

    // Boolean flags
    expect(typeof ts.enableStockMonitor).toBe('boolean');
    expect(typeof ts.enablePriceMonitor).toBe('boolean');
    expect(typeof ts.pruneNoSku).toBe('boolean');
    expect(typeof ts.pruneBrokenSku).toBe('boolean');
    expect(typeof ts.pruneNotFound).toBe('boolean');
    expect(typeof ts.pruneSkuChanged).toBe('boolean');
    expect(typeof ts.pruneNoSales).toBe('boolean');
    expect(typeof ts.continuousTracking).toBe('boolean');
    expect(typeof ts.logData).toBe('boolean');
    expect(typeof ts.pinTabs).toBe('boolean');
    expect(typeof ts.forceRestock).toBe('boolean');

    // Numeric
    expect(typeof ts.restockQuantity).toBe('number');
    expect(typeof ts.markupPercentage).toBe('number');
    expect(typeof ts.priceTriggerThreshold).toBe('number');
    expect(typeof ts.trackingTimeout).toBe('number');
    expect(typeof ts.itemsPerPage).toBe('number');

    // Strings
    expect(typeof ts.pricingOption).toBe('string');
    expect(typeof ts.primeFilter).toBe('string');
    expect(typeof ts.ebayDomain).toBe('string');
    expect(typeof ts.amazonDomain).toBe('string');
    expect(typeof ts.oosAction).toBe('string');
  });

  it('pruning actions default to oos not delete', () => {
    const ts = SK.DEFAULTS[SK.TRACKER_SETTINGS];
    expect(ts.pruneNoSkuAction).toBe('oos');
    expect(ts.pruneBrokenSkuAction).toBe('oos');
    expect(ts.pruneNotFoundAction).toBe('oos');
    expect(ts.pruneSkuChangedAction).toBe('oos');
    expect(ts.pruneNoSalesAction).toBe('oos');
  });

  it('defaults are sensible', () => {
    const ts = SK.DEFAULTS[SK.TRACKER_SETTINGS];
    expect(ts.itemsPerPage).toBe(200);
    expect(ts.markupPercentage).toBe(100);
    expect(ts.restockQuantity).toBeGreaterThan(0);
    expect(ts.trackingTimeout).toBeGreaterThanOrEqual(30);
  });

  it('all tracker storage keys are unique strings', () => {
    const trackerKeys = [
      SK.TRACKER_SETTINGS, SK.TRACKER_RUNNING, SK.TRACKER_POSITION,
      SK.TRACKER_PAGE, SK.TRACKER_TOTAL_PAGES, SK.TRACKER_TAB_ID, SK.TRACKER_LOGS
    ];
    for (const k of trackerKeys) {
      expect(typeof k).toBe('string');
      expect(k.length).toBeGreaterThan(0);
    }
    expect(new Set(trackerKeys).size).toBe(trackerKeys.length);
  });
});

describe('Tracker settings save/load round-trip', () => {
  beforeEach(() => resetStorage());

  it('saves and loads tracker settings via chrome.storage mock', async () => {
    const settings = { ...SK.DEFAULTS[SK.TRACKER_SETTINGS], markupPercentage: 150 };
    await chrome.storage.local.set({ [SK.TRACKER_SETTINGS]: settings });
    const result = await chrome.storage.local.get(SK.TRACKER_SETTINGS);
    expect(result[SK.TRACKER_SETTINGS].markupPercentage).toBe(150);
    expect(result[SK.TRACKER_SETTINGS].enableStockMonitor).toBe(true);
  });

  it('overwrites previous settings', async () => {
    await chrome.storage.local.set({ [SK.TRACKER_SETTINGS]: { markupPercentage: 50 } });
    await chrome.storage.local.set({ [SK.TRACKER_SETTINGS]: { markupPercentage: 200 } });
    const result = await chrome.storage.local.get(SK.TRACKER_SETTINGS);
    expect(result[SK.TRACKER_SETTINGS].markupPercentage).toBe(200);
  });
});
