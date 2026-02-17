import { describe, it, expect } from 'vitest';
import * as MT from '../extension/lib/message-types.js';

describe('message-types', () => {
  const entries = Object.entries(MT);

  it('exports at least 20 message types', () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it('all values are non-empty strings', () => {
    for (const [key, val] of entries) {
      expect(typeof val, `${key} should be string`).toBe('string');
      expect(val.length, `${key} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it('all values are unique', () => {
    const values = entries.map(([, v]) => v);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('export names match their string values', () => {
    // Convention: export name === value
    for (const [key, val] of entries) {
      expect(val).toBe(key);
    }
  });
});
