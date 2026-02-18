import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as MessageTypes from '../extension/lib/message-types.js';

const swSrc = readFileSync(
  resolve(__dirname, '..', 'extension', 'background', 'service-worker.js'),
  'utf8'
);

// Extract all `case CONSTANT_NAME:` (imported constant refs) from the main message switch
const importedCaseRegex = /^\s{4}case ([A-Z][A-Z_0-9]+)\s*:/gm;
const importedCases = new Set([...swSrc.matchAll(importedCaseRegex)].map(m => m[1]));

// Extract all `case 'STRING':` from the main message switch (lines with 4-space indent)
const literalCaseRegex = /^\s{4}case '([A-Z][A-Z_0-9]+)'\s*:/gm;
const literalCases = new Set([...swSrc.matchAll(literalCaseRegex)].map(m => m[1]));

const allHandledConstants = importedCases;
const allHandledLiterals = literalCases;

const exportedNames = new Set(Object.keys(MessageTypes));
const exportedValues = new Set(Object.values(MessageTypes));

// Internal literal handlers that don't need a message-types constant
const internalLiterals = new Set([
  'KEEPALIVE_PING',
  'INJECT_FORM_FILLER_IN_FRAMES',
  'FILL_MSKU_PRICES',
  'GET_TAB_ID',
]);

describe('Service worker message routing', () => {
  it('every exported message type constant that is handled uses the constant (not a string literal)', () => {
    // Ensure imported constant names match actual export names
    const unknownConstants = [...allHandledConstants].filter(c => !exportedNames.has(c));
    expect(unknownConstants).toEqual([]);
  });

  it('no orphaned literal handlers (handler exists but message type constant does not)', () => {
    const orphans = [...allHandledLiterals].filter(l => !internalLiterals.has(l) && !exportedValues.has(l));
    expect(orphans).toEqual([]);
  });

  it('every message type in message-types.js has a handler OR is a response/event type', () => {
    // Response/event/progress types are sent FROM the SW, not handled by it
    const responsePatterns = [
      /_DATA$/, /_FILLED$/, /_RESULT$/, /_COMPLETE$/, /_PROGRESS$/,
      /_ALERT$/, /_STATUS$/, /_REVISED$/, /_SET$/, /_UPDATED$/,
      /^PROGRESS_UPDATE$/, /^ERROR$/, /^TITLES_GENERATED$/, /^TFIDF_RESULT$/,
      /^TRACKING_PROGRESS$/, /^TRACKING_LOG$/, /^TRACKING_STATUS$/,
      /^TRACKING_PAGE_RESULT$/, /^UPDATE_TRACKER_POSITION$/,
      /^MONITOR_CHECK_RESULT$/, /^MONITOR_ALERT$/,
      /^MONITOR_PAUSED$/, /^SETTINGS_UPDATED$/,
      /^AUTO_ORDER_READY$/,
      /^CHATGPT_RESPONSE$/,
    ];

    // Content-script-only types (handled by content scripts, not SW)
    const contentScriptOnly = new Set([
      'SCRAPE_AMAZON_PRODUCT', 'FILL_EBAY_FORM', 'READ_EBAY_LISTING',
      'SCRAPE_ALIEXPRESS_PRODUCT', 'SCRAPE_ACTIVE_LISTINGS',
      'SCRAPE_ACTIVE_LISTINGS_FULL',
      'END_LOW_PERFORMING_ITEMS', 'SELL_SIMILAR_ENDED_ITEMS',
      'SUBMIT_BULK_EDIT_FORM', 'REVISE_ITEMS', 'COUNT_MENU_OPTIONS',
      'CLICK_MENU_OPTION', 'SEND_WATCHER_OFFERS', 'REVIEW_PENDING_OFFERS',
      'START_TRACKING_PAGE', 'SET_CUSTOM_LABEL', 'READ_CUSTOM_LABEL',
      'REVISE_EBAY_LISTING', 'SCRAPE_AMAZON_TAB',
    ]);

    const isResponse = (name) => responsePatterns.some(p => p.test(name));

    const unhandled = [];
    for (const [name, value] of Object.entries(MessageTypes)) {
      if (isResponse(name)) continue;
      if (contentScriptOnly.has(name)) continue;
      // Check if handled by imported constant or literal
      if (!allHandledConstants.has(name) && !allHandledLiterals.has(value)) {
        unhandled.push(name);
      }
    }
    expect(unhandled).toEqual([]);
  });

  it('handler count is reasonable (at least 50 cases in the main switch)', () => {
    const totalCases = allHandledConstants.size + allHandledLiterals.size;
    expect(totalCases).toBeGreaterThanOrEqual(50);
  });
});
