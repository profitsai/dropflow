/**
 * Global test setup — mock chrome.* APIs
 */
import { vi } from 'vitest';

const storage = {};

globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys) => {
        if (typeof keys === 'string') {
          return { [keys]: storage[keys] };
        }
        if (Array.isArray(keys)) {
          const result = {};
          for (const k of keys) result[k] = storage[k];
          return result;
        }
        return {};
      }),
      set: vi.fn(async (obj) => {
        Object.assign(storage, obj);
      }),
    },
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  tabs: {
    create: vi.fn(async (opts) => ({ id: 999, url: opts.url })),
    remove: vi.fn(),
    sendMessage: vi.fn(),
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  scripting: { executeScript: vi.fn() },
  alarms: { create: vi.fn(), clear: vi.fn() },
  notifications: { create: vi.fn() },
};

// Helper to reset storage between tests
export function resetStorage() {
  for (const k of Object.keys(storage)) delete storage[k];
}

export function getStorage() {
  return storage;
}
