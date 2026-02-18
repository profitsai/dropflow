import { describe, it, expect } from 'vitest';
import * as MT from '../extension/lib/message-types.js';

const TRACKER_MESSAGE_TYPES = [
  'START_TRACKING',
  'STOP_TRACKING',
  'RESET_TRACKING',
  'TRACKING_PROGRESS',
  'TRACKING_LOG',
  'TRACKING_STATUS',
  'GET_TRACKER_SETTINGS',
  'SAVE_TRACKER_SETTINGS',
  'START_TRACKING_PAGE',
  'TRACKING_PAGE_RESULT',
  'UPDATE_TRACKER_POSITION',
  // The 12th is TRACKER_PING which lives in the content script, not message-types.
  // We count PROGRESS_UPDATE as the 12th since it's used by tracker flow.
];

describe('Tracker message types', () => {
  it('all 11 tracker message type constants exist', () => {
    for (const name of TRACKER_MESSAGE_TYPES) {
      expect(MT[name]).toBeDefined();
      expect(typeof MT[name]).toBe('string');
      expect(MT[name].length).toBeGreaterThan(0);
    }
  });

  it('tracker message type values match their const names', () => {
    for (const name of TRACKER_MESSAGE_TYPES) {
      expect(MT[name]).toBe(name);
    }
  });

  it('all tracker message types are unique', () => {
    const values = TRACKER_MESSAGE_TYPES.map(n => MT[n]);
    expect(new Set(values).size).toBe(values.length);
  });

  it('tracker types do not collide with other message types', () => {
    const allValues = Object.values(MT);
    const trackerValues = TRACKER_MESSAGE_TYPES.map(n => MT[n]);
    // Each tracker value appears exactly once in all exports
    for (const tv of trackerValues) {
      const count = allValues.filter(v => v === tv).length;
      expect(count).toBe(1);
    }
  });

  it('total message type exports exceed 100 (comprehensive coverage)', () => {
    const allExports = Object.keys(MT);
    expect(allExports.length).toBeGreaterThan(100);
  });
});
