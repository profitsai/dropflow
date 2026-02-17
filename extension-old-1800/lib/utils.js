/**
 * Common utility functions shared across the extension.
 */

/**
 * Send a message to the background service worker and await response.
 */
export function sendMessage(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

/**
 * Send a message to a specific tab's content script.
 */
export function sendTabMessage(tabId, type, payload = {}) {
  return chrome.tabs.sendMessage(tabId, { type, ...payload });
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a tab and wait for it to finish loading.
 * Returns the tab object.
 */
export function createTabAndWait(url, timeoutMs = 0, resolveOnTimeout = false) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      let timer;
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          if (timer) clearTimeout(timer);
          resolve(tab);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          if (resolveOnTimeout) {
            // Resolve with the tab even on timeout — page DOM may be ready
            // even if background resources (trackers, ads) are still loading.
            console.log(`[createTabAndWait] Timeout ${timeoutMs / 1000}s but resolving (page likely usable): ${url}`);
            resolve(tab);
          } else {
            // Close the tab before rejecting — otherwise it leaks
            try { chrome.tabs.remove(tab.id); } catch (_) {}
            reject(new Error(`Tab load timed out after ${timeoutMs / 1000}s for ${url}`));
          }
        }, timeoutMs);
      }
    });
  });
}

/**
 * Extract ASIN from an Amazon URL.
 */
export function extractAsin(url) {
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/i,
    /\/gp\/product\/([A-Z0-9]{10})/i,
    /\/ASIN\/([A-Z0-9]{10})/i,
    /[?&]asin=([A-Z0-9]{10})/i
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

/**
 * Extract Amazon domain/marketplace from URL.
 * Returns like "com", "co.uk", "de", etc.
 */
export function extractAmazonDomain(url) {
  const match = url.match(/amazon\.([a-z.]+)\//);
  return match ? match[1] : 'com';
}

/**
 * Map Amazon domain to eBay domain.
 */
export function amazonToEbayDomain(amazonDomain) {
  const mapping = {
    'com': 'com',
    'ca': 'ca',
    'co.uk': 'co.uk',
    'de': 'de',
    'fr': 'fr',
    'it': 'it',
    'es': 'es',
    'nl': 'nl',
    'com.au': 'com.au'
  };
  return mapping[amazonDomain] || 'com';
}

/**
 * Truncate a string to a max length, adding ellipsis if needed.
 */
export function truncate(str, maxLength = 80) {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Format a price with currency symbol.
 */
export function formatPrice(amount, currency = 'USD') {
  const symbols = { USD: '$', CAD: 'C$', GBP: '£', EUR: '€', AUD: 'A$' };
  const symbol = symbols[currency] || currency + ' ';
  return `${symbol}${parseFloat(amount).toFixed(2)}`;
}

/**
 * Simple concurrency limiter (semaphore).
 * Usage: const sem = semaphore(3); await sem.acquire(); ... sem.release();
 */
export function semaphore(maxConcurrent) {
  let current = 0;
  const queue = [];

  return {
    async acquire() {
      if (current < maxConcurrent) {
        current++;
        return;
      }
      await new Promise(resolve => queue.push(resolve));
      current++;
    },
    release() {
      current--;
      if (queue.length > 0) {
        const next = queue.shift();
        next();
      }
    },
    get active() { return current; },
    get waiting() { return queue.length; }
  };
}

/**
 * Parse Amazon links from a text block (one per line or comma-separated).
 */
export function parseAmazonLinks(text) {
  return text
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.includes('amazon.'));
}

/**
 * Parse AliExpress links from a text block (one per line or comma-separated).
 */
export function parseAliExpressLinks(text) {
  return text
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.includes('aliexpress.'));
}

/**
 * Extract AliExpress product ID from URL.
 * Handles: /item/1234567890.html and /item/Title-Slug/1234567890.html
 */
export function extractAliExpressProductId(url) {
  const match = url.match(/\/item\/(?:[^\/]+\/)?(\d+)\.html/);
  return match ? match[1] : null;
}

/**
 * Generate a simple unique ID.
 */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}
