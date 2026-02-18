import { describe, it, expect } from 'vitest';
import {
  fuzzyMatch,
  parseVariantText,
  getVariantOptions,
  findBestMatch,
} from '../extension/lib/variant-selector.js';

describe('fuzzyMatch', () => {
  it('matches exact strings (case-insensitive)', () => {
    expect(fuzzyMatch('Red', 'red')).toBe(true);
    expect(fuzzyMatch('  XL ', 'xl')).toBe(true);
  });

  it('matches when one string contains the other', () => {
    expect(fuzzyMatch('Dark Red', 'Red')).toBe(true);
    expect(fuzzyMatch('XL', 'Extra Large XL')).toBe(true);
  });

  it('returns false for non-matching strings', () => {
    expect(fuzzyMatch('Red', 'Blue')).toBe(false);
    expect(fuzzyMatch('S', 'XL')).toBe(false);
  });

  it('returns false for empty/null inputs', () => {
    expect(fuzzyMatch('', 'Red')).toBe(false);
    expect(fuzzyMatch(null, 'Red')).toBe(false);
    expect(fuzzyMatch('Red', undefined)).toBe(false);
  });
});

describe('parseVariantText', () => {
  it('splits on / separator', () => {
    expect(parseVariantText('Red / XL')).toEqual(['Red', 'XL']);
  });

  it('splits on comma separator', () => {
    expect(parseVariantText('Red, XL')).toEqual(['Red', 'XL']);
  });

  it('returns empty array for null/empty', () => {
    expect(parseVariantText(null)).toEqual([]);
    expect(parseVariantText('')).toEqual([]);
  });

  it('handles single value', () => {
    expect(parseVariantText('Red')).toEqual(['Red']);
  });
});

describe('getVariantOptions', () => {
  it('extracts from sourceVariantText', () => {
    expect(getVariantOptions({ sourceVariantText: 'Red / XL' })).toEqual(['Red', 'XL']);
  });

  it('extracts from specifics object', () => {
    expect(getVariantOptions({ specifics: { Color: 'Blue', Size: 'M' } })).toEqual(['Blue', 'M']);
  });

  it('extracts from ebayVariant string', () => {
    expect(getVariantOptions({ ebayVariant: 'Color: Green, Size: L' })).toEqual(['Green', 'L']);
  });

  it('returns empty for null sourceVariant', () => {
    expect(getVariantOptions(null)).toEqual([]);
  });

  it('returns empty for sourceVariant with no variant data', () => {
    expect(getVariantOptions({ sourceUrl: 'http://example.com' })).toEqual([]);
  });

  it('prefers sourceVariantText over specifics', () => {
    expect(getVariantOptions({
      sourceVariantText: 'Rouge / XL',
      specifics: { Color: 'Red', Size: 'XL' }
    })).toEqual(['Rouge', 'XL']);
  });
});

describe('findBestMatch', () => {
  const candidates = [
    { element: 'el-red', text: 'Red' },
    { element: 'el-dark-red', text: 'Dark Red' },
    { element: 'el-blue', text: 'Blue' },
    { element: 'el-xl', text: 'XL' },
    { element: 'el-small', text: 'Small (S)' },
  ];

  it('finds exact match (case-insensitive)', () => {
    const result = findBestMatch('red', candidates);
    expect(result).toEqual({ element: 'el-red', matchType: 'exact' });
  });

  it('finds exact match with whitespace tolerance', () => {
    const result = findBestMatch('  XL  ', candidates);
    expect(result).toEqual({ element: 'el-xl', matchType: 'exact' });
  });

  it('falls back to fuzzy match', () => {
    const result = findBestMatch('S', candidates);
    expect(result).toEqual({ element: 'el-small', matchType: 'fuzzy' });
  });

  it('returns null when no match', () => {
    expect(findBestMatch('Green', candidates)).toBeNull();
  });

  it('returns null for empty option', () => {
    expect(findBestMatch('', candidates)).toBeNull();
  });

  it('returns null for empty candidates', () => {
    expect(findBestMatch('Red', [])).toBeNull();
  });

  it('prefers exact over fuzzy', () => {
    // "Red" should match exact "Red", not fuzzy "Dark Red"
    const result = findBestMatch('Red', candidates);
    expect(result.matchType).toBe('exact');
    expect(result.element).toBe('el-red');
  });
});
