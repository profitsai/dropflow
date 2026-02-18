import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as MessageTypes from '../extension/lib/message-types.js';

const allExports = Object.entries(MessageTypes);

describe('Message type integrity', () => {
  it('has no undefined or null values', () => {
    const bad = allExports.filter(([, v]) => v == null);
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it('all values are unique (no collisions)', () => {
    const values = allExports.map(([, v]) => v);
    const dupes = values.filter((v, i) => values.indexOf(v) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });

  it('all values are non-empty strings', () => {
    const bad = allExports.filter(([, v]) => typeof v !== 'string' || v === '');
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it('export count is at least 100 (regression guard)', () => {
    // Current count is ~120+. Alert if someone removes a bunch.
    expect(allExports.length).toBeGreaterThanOrEqual(100);
  });

  it('every message type used in service-worker.js has a constant', () => {
    const swSrc = readFileSync(
      resolve(__dirname, '..', 'extension', 'background', 'service-worker.js'),
      'utf8'
    );
    // Extract string-literal cases like case 'FOO':
    const literalCases = [...swSrc.matchAll(/case\s+'([A-Z_]+)'/g)].map(m => m[1]);
    const exportedValues = new Set(allExports.map(([, v]) => v));
    // Filter to ones that look like message types (UPPER_SNAKE) but aren't in constants
    const missing = literalCases.filter(c => !exportedValues.has(c) && /^[A-Z][A-Z_]+$/.test(c));
    // KEEPALIVE_PING, INJECT_FORM_FILLER_IN_FRAMES, FILL_MSKU_PRICES, GET_TAB_ID are internal
    const allowed = new Set(['KEEPALIVE_PING', 'INJECT_FORM_FILLER_IN_FRAMES', 'FILL_MSKU_PRICES', 'GET_TAB_ID']);
    const unexpected = missing.filter(m => !allowed.has(m));
    expect(unexpected).toEqual([]);
  });
});
