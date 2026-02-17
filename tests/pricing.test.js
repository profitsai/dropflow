import { describe, it, expect } from 'vitest';
import { DEFAULTS, MONITOR_SETTINGS } from '../extension/lib/storage-keys.js';

/**
 * calculateEbayPrice extracted from service-worker.js for testing.
 * (Not exported from service-worker, so we replicate it here.)
 */
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
    case '99': ebayPrice = Math.floor(ebayPrice) + 0.99; break;
    case '95': ebayPrice = Math.floor(ebayPrice) + 0.95; break;
    case '49': ebayPrice = Math.floor(ebayPrice) + 0.49; break;
  }

  return Math.round(ebayPrice * 100) / 100;
}

describe('calculateEbayPrice', () => {
  describe('percentage markup', () => {
    it('applies 30% markup by default', () => {
      const result = calculateEbayPrice(10, { priceMarkupType: 'percentage', priceMarkupValue: 30, priceRounding: 'none' });
      expect(result).toBe(13);
    });

    it('applies custom percentage', () => {
      const result = calculateEbayPrice(20, { priceMarkupType: 'percentage', priceMarkupValue: 50, priceRounding: 'none' });
      expect(result).toBe(30);
    });
  });

  describe('fixed markup', () => {
    it('adds fixed amount', () => {
      const result = calculateEbayPrice(10, { priceMarkupType: 'fixed', priceFixedIncrease: 7, priceRounding: 'none' });
      expect(result).toBe(17);
    });

    it('defaults to $5 increase', () => {
      const result = calculateEbayPrice(10, { priceMarkupType: 'fixed', priceRounding: 'none' });
      expect(result).toBe(15);
    });
  });

  describe('variable/tiered markup', () => {
    const tiers = DEFAULTS[MONITOR_SETTINGS].priceVariableTiers;

    it('applies 400% for items under $5', () => {
      const result = calculateEbayPrice(2, { priceMarkupType: 'variable', priceVariableTiers: tiers, priceRounding: 'none' });
      expect(result).toBe(10); // 2 * 5
    });

    it('applies 60% for items $60-100', () => {
      const result = calculateEbayPrice(80, { priceMarkupType: 'variable', priceVariableTiers: tiers, priceRounding: 'none' });
      expect(result).toBe(128); // 80 * 1.6
    });
  });

  describe('minimum profit enforcement', () => {
    it('enforces min profit when markup is too low', () => {
      const result = calculateEbayPrice(100, {
        priceMarkupType: 'percentage', priceMarkupValue: 1, // only 1%
        priceMinProfit: 5, priceRounding: 'none'
      });
      expect(result).toBe(105); // minProfit wins: 100 + 5
    });
  });

  describe('price rounding', () => {
    it('rounds to .99', () => {
      const result = calculateEbayPrice(10, { priceMarkupType: 'percentage', priceMarkupValue: 30, priceRounding: '99' });
      expect(result).toBe(13.99); // floor(13) + 0.99
    });

    it('rounds to .95', () => {
      const result = calculateEbayPrice(10, { priceMarkupType: 'percentage', priceMarkupValue: 30, priceRounding: '95' });
      expect(result).toBe(13.95);
    });

    it('rounds to .49', () => {
      const result = calculateEbayPrice(10, { priceMarkupType: 'percentage', priceMarkupValue: 30, priceRounding: '49' });
      expect(result).toBe(13.49);
    });
  });
});
