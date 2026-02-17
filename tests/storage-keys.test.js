import { describe, it, expect } from 'vitest';
import * as SK from '../extension/lib/storage-keys.js';

describe('storage-keys', () => {
  it('exports DEFAULTS object', () => {
    expect(SK.DEFAULTS).toBeDefined();
    expect(typeof SK.DEFAULTS).toBe('object');
  });

  it('all key constants are unique non-empty strings', () => {
    const keys = Object.entries(SK).filter(([k]) => k !== 'DEFAULTS');
    const vals = keys.map(([, v]) => v);
    expect(vals.length).toBeGreaterThan(5);
    for (const v of vals) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
    expect(new Set(vals).size).toBe(vals.length);
  });

  it('DEFAULTS has entries for critical keys', () => {
    expect(SK.DEFAULTS[SK.BACKEND_URL]).toBeDefined();
    expect(SK.DEFAULTS[SK.PRICE_MARKUP]).toBeDefined();
    expect(SK.DEFAULTS[SK.MONITOR_SETTINGS]).toBeDefined();
    expect(SK.DEFAULTS[SK.AUTO_ORDER_SETTINGS]).toBeDefined();
  });

  it('MONITOR_SETTINGS defaults have variable tiers', () => {
    const ms = SK.DEFAULTS[SK.MONITOR_SETTINGS];
    expect(ms.priceVariableTiers).toBeInstanceOf(Array);
    expect(ms.priceVariableTiers.length).toBeGreaterThan(0);
    for (const tier of ms.priceVariableTiers) {
      expect(tier).toHaveProperty('min');
      expect(tier).toHaveProperty('max');
      expect(tier).toHaveProperty('markup');
      expect(tier.max).toBeGreaterThan(tier.min);
    }
  });

  it('AUTO_ORDER_SETTINGS defaults have shipping address shape', () => {
    const aos = SK.DEFAULTS[SK.AUTO_ORDER_SETTINGS];
    expect(aos.defaultShippingAddress).toBeDefined();
    expect(aos.defaultShippingAddress).toHaveProperty('fullName');
    expect(aos.defaultShippingAddress).toHaveProperty('postalCode');
    expect(aos.defaultShippingAddress).toHaveProperty('country');
  });
});
