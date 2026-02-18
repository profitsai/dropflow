import { describe, it, expect } from 'vitest';
import * as StorageKeys from '../extension/lib/storage-keys.js';

// Separate DEFAULTS from key constants
const { DEFAULTS, ...keyConstants } = StorageKeys;
const allKeys = Object.entries(keyConstants);

describe('Storage key integrity', () => {
  it('all key constants are unique strings', () => {
    const values = allKeys.map(([, v]) => v);
    const dupes = values.filter((v, i) => values.indexOf(v) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });

  it('no key constant is undefined or null', () => {
    const bad = allKeys.filter(([, v]) => v == null);
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it('all key constants are non-empty strings', () => {
    const bad = allKeys.filter(([, v]) => typeof v !== 'string' || v === '');
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it('DEFAULTS object exists and is non-empty', () => {
    expect(DEFAULTS).toBeDefined();
    expect(Object.keys(DEFAULTS).length).toBeGreaterThan(0);
  });

  it('every DEFAULTS key references a declared storage key constant', () => {
    const knownValues = new Set(allKeys.map(([, v]) => v));
    const defaultKeys = Object.keys(DEFAULTS);
    const orphans = defaultKeys.filter(k => !knownValues.has(k));
    expect(orphans).toEqual([]);
  });

  it('DEFAULTS values have correct types', () => {
    // backendUrl → string
    expect(typeof DEFAULTS[StorageKeys.BACKEND_URL]).toBe('string');
    // defaultThreadCount → number
    expect(typeof DEFAULTS[StorageKeys.DEFAULT_THREAD_COUNT]).toBe('number');
    // priceMarkup → number
    expect(typeof DEFAULTS[StorageKeys.PRICE_MARKUP]).toBe('number');
    // monitorSettings → object
    expect(typeof DEFAULTS[StorageKeys.MONITOR_SETTINGS]).toBe('object');
    // trackerSettings → object
    expect(typeof DEFAULTS[StorageKeys.TRACKER_SETTINGS]).toBe('object');
    // autoOrderSettings → object
    expect(typeof DEFAULTS[StorageKeys.AUTO_ORDER_SETTINGS]).toBe('object');
  });

  it('no conflicts between tracker, monitor, boost, and auto-order keys', () => {
    const groups = {
      tracker: allKeys.filter(([k]) => k.startsWith('TRACKER')).map(([, v]) => v),
      monitor: allKeys.filter(([k]) => k.startsWith('MONITOR')).map(([, v]) => v),
      boost: allKeys.filter(([k]) => k.startsWith('BOOST')).map(([, v]) => v),
      autoOrder: allKeys.filter(([k]) => k.startsWith('AUTO_ORDER')).map(([, v]) => v),
    };
    // Check no value appears in more than one group
    const all = [];
    for (const [group, vals] of Object.entries(groups)) {
      for (const v of vals) all.push({ group, value: v });
    }
    const valueToGroups = {};
    for (const { group, value } of all) {
      (valueToGroups[value] ??= []).push(group);
    }
    const conflicts = Object.entries(valueToGroups).filter(([, g]) => g.length > 1);
    expect(conflicts).toEqual([]);
  });
});
