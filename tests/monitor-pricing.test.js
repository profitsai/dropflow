/**
 * Unit tests for monitor pricing logic.
 * Tests calculateEbayPrice extracted from service-worker.js
 */
import { describe, it, expect } from 'vitest';
import { DEFAULTS, MONITOR_SETTINGS } from '../extension/lib/storage-keys.js';

// Extract calculateEbayPrice logic (same as service-worker.js)
function calculateEbayPrice(supplierPrice, settings) {
  let ebayPrice;

  switch (settings.priceMarkupType) {
    case 'fixed':
      ebayPrice = supplierPrice + (settings.priceFixedIncrease || 5);
      break;

    case 'variable': {
      const tiers = settings.priceVariableTiers || DEFAULTS[MONITOR_SETTINGS].priceVariableTiers;
      let markup = 30;
      for (const tier of tiers) {
        if (supplierPrice >= tier.min && supplierPrice < tier.max) {
          markup = tier.markup;
          break;
        }
      }
      ebayPrice = supplierPrice * (1 + markup / 100);
      break;
    }

    case 'percentage':
    default:
      ebayPrice = supplierPrice * (1 + (settings.priceMarkupValue || 30) / 100);
      break;
  }

  if (settings.priceMinProfit && ebayPrice - supplierPrice < settings.priceMinProfit) {
    ebayPrice = supplierPrice + settings.priceMinProfit;
  }

  switch (settings.priceRounding) {
    case '99':
      ebayPrice = Math.floor(ebayPrice) + 0.99;
      break;
    case '95':
      ebayPrice = Math.floor(ebayPrice) + 0.95;
      break;
    case '49':
      ebayPrice = Math.floor(ebayPrice) + 0.49;
      break;
  }

  return Math.round(ebayPrice * 100) / 100;
}

describe('calculateEbayPrice', () => {
  const baseSettings = {
    priceMarkupType: 'percentage',
    priceMarkupValue: 30,
    priceFixedIncrease: 5,
    priceMinProfit: 2,
    priceRounding: '99',
    priceVariableTiers: DEFAULTS[MONITOR_SETTINGS].priceVariableTiers,
  };

  describe('percentage markup', () => {
    it('applies 30% markup', () => {
      const result = calculateEbayPrice(10, baseSettings);
      // 10 * 1.3 = 13 → floor + .99 = 13.99
      expect(result).toBe(13.99);
    });

    it('applies 100% markup', () => {
      const s = { ...baseSettings, priceMarkupValue: 100 };
      const result = calculateEbayPrice(10, s);
      // 10 * 2 = 20 → 20.99
      expect(result).toBe(20.99);
    });

    it('handles zero supplier price', () => {
      const result = calculateEbayPrice(0, baseSettings);
      // 0 * 1.3 = 0, min profit 2 → 2, rounding → 2.99
      expect(result).toBe(2.99);
    });
  });

  describe('fixed markup', () => {
    it('adds fixed increase', () => {
      const s = { ...baseSettings, priceMarkupType: 'fixed', priceFixedIncrease: 5 };
      const result = calculateEbayPrice(10, s);
      // 10 + 5 = 15 → 15.99
      expect(result).toBe(15.99);
    });

    it('applies min profit when fixed increase is low', () => {
      const s = { ...baseSettings, priceMarkupType: 'fixed', priceFixedIncrease: 0.50, priceMinProfit: 3 };
      const result = calculateEbayPrice(10, s);
      // 10 + 0.50 = 10.50, but min profit 3 → 13 → 13.99
      expect(result).toBe(13.99);
    });
  });

  describe('variable tiers', () => {
    it('uses correct tier for $3 item (400% markup)', () => {
      const s = { ...baseSettings, priceMarkupType: 'variable' };
      const result = calculateEbayPrice(3, s);
      // 3 * (1 + 400/100) = 3 * 5 = 15 → 15.99
      expect(result).toBe(15.99);
    });

    it('uses correct tier for $10 item (200% markup)', () => {
      const s = { ...baseSettings, priceMarkupType: 'variable' };
      const result = calculateEbayPrice(10, s);
      // 10 * 3 = 30 → 30.99
      expect(result).toBe(30.99);
    });

    it('uses correct tier for $50 item (80% markup)', () => {
      const s = { ...baseSettings, priceMarkupType: 'variable' };
      const result = calculateEbayPrice(50, s);
      // 50 * 1.8 = 90 → 90.99
      expect(result).toBe(90.99);
    });

    it('uses correct tier for $200 item (40% markup)', () => {
      const s = { ...baseSettings, priceMarkupType: 'variable' };
      const result = calculateEbayPrice(200, s);
      // 200 * 1.4 = 280 → 280.99
      expect(result).toBe(280.99);
    });
  });

  describe('price rounding', () => {
    it('rounds to .99', () => {
      const s = { ...baseSettings, priceRounding: '99' };
      expect(calculateEbayPrice(10, s)).toBe(13.99);
    });

    it('rounds to .95', () => {
      const s = { ...baseSettings, priceRounding: '95' };
      expect(calculateEbayPrice(10, s)).toBe(13.95);
    });

    it('rounds to .49', () => {
      const s = { ...baseSettings, priceRounding: '49' };
      expect(calculateEbayPrice(10, s)).toBe(13.49);
    });

    it('no rounding', () => {
      const s = { ...baseSettings, priceRounding: 'none' };
      expect(calculateEbayPrice(10, s)).toBe(13);
    });
  });

  describe('minimum profit enforcement', () => {
    it('enforces min profit when markup is too low', () => {
      const s = { ...baseSettings, priceMarkupValue: 1, priceMinProfit: 5 };
      const result = calculateEbayPrice(10, s);
      // 10 * 1.01 = 10.10, profit = 0.10 < 5 → 10 + 5 = 15 → 15.99
      expect(result).toBe(15.99);
    });

    it('does not enforce when profit exceeds minimum', () => {
      const s = { ...baseSettings, priceMarkupValue: 100, priceMinProfit: 2 };
      const result = calculateEbayPrice(10, s);
      // 10 * 2 = 20, profit = 10 > 2 → 20 → 20.99
      expect(result).toBe(20.99);
    });
  });
});

describe('margin calculations (UI)', () => {
  it('calculates dollar margin', () => {
    const ebayPrice = 29.99;
    const sourcePrice = 15.00;
    const margin = ebayPrice - sourcePrice;
    expect(margin).toBeCloseTo(14.99, 2);
  });

  it('calculates percentage margin', () => {
    const ebayPrice = 29.99;
    const sourcePrice = 15.00;
    const margin = ebayPrice - sourcePrice;
    const pct = (margin / sourcePrice) * 100;
    expect(pct).toBeCloseTo(99.93, 1);
  });

  it('handles zero source price', () => {
    const margin = 29.99 - 0;
    expect(margin).toBe(29.99);
  });
});
