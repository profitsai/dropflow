import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CS_DIR = resolve(__dirname, '..', 'extension', 'content-scripts', 'ebay');

function readScript(name) {
  return readFileSync(resolve(CS_DIR, name), 'utf8');
}

describe('Content script message handlers', () => {
  describe('seller-hub-tracker.js', () => {
    const src = readScript('seller-hub-tracker.js');

    it('handles START_TRACKING_PAGE', () => {
      expect(src).toContain('START_TRACKING_PAGE');
    });

    it('handles TRACKER_PING', () => {
      expect(src).toContain('TRACKER_PING');
    });

    it('registers a chrome.runtime.onMessage listener', () => {
      expect(src).toMatch(/chrome\.runtime\.onMessage\.addListener/);
    });
  });

  describe('form-filler.js', () => {
    const src = readScript('form-filler.js');

    it('handles FILL_EBAY_FORM', () => {
      expect(src).toContain('FILL_EBAY_FORM');
    });

    it('handles SET_CUSTOM_LABEL', () => {
      expect(src).toContain('SET_CUSTOM_LABEL');
    });

    it('handles READ_CUSTOM_LABEL', () => {
      expect(src).toContain('READ_CUSTOM_LABEL');
    });

    it('handles REVISE_EBAY_LISTING', () => {
      expect(src).toContain('REVISE_EBAY_LISTING');
    });

    it('registers a chrome.runtime.onMessage listener', () => {
      expect(src).toMatch(/chrome\.runtime\.onMessage\.addListener/);
    });
  });
});
