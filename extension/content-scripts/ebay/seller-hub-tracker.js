/**
 * eBay Seller Hub Tracker Content Script (EcomSniper-style)
 * 
 * Runs on eBay Seller Hub active listings pages.
 * When triggered by START_TRACKING_PAGE from the background, iterates through
 * each listing row, extracts data, and sends it back for processing.
 * 
 * This is separate from active-listings-scraper.js which is used for import.
 * The tracker content script works row-by-row and communicates progress.
 */

(function () {
  'use strict';

  // Prevent double injection
  if (window.__dropflow_tracker_loaded) return;
  window.__dropflow_tracker_loaded = true;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /**
   * Decode a Custom Label that may be base64-encoded (EcomSniper format).
   * Returns { asin, raw, valid }
   */
  function decodeCustomLabel(label) {
    if (!label || typeof label !== 'string') return { asin: null, raw: label, valid: false };
    const trimmed = label.trim();

    // Already an ASIN
    if (/^B0[A-Z0-9]{8}$/i.test(trimmed)) return { asin: trimmed.toUpperCase(), raw: trimmed, valid: true };
    if (/^[A-Z0-9]{10}$/i.test(trimmed) && /[A-Z]/i.test(trimmed)) return { asin: trimmed.toUpperCase(), raw: trimmed, valid: true };
    // AliExpress ID
    if (/^\d{10,}$/.test(trimmed)) return { asin: trimmed, raw: trimmed, valid: true };

    // Try base64 decode
    try {
      const decoded = atob(trimmed);
      if (/^B0[A-Z0-9]{8}$/i.test(decoded)) return { asin: decoded.toUpperCase(), raw: trimmed, valid: true };
      if (/^[A-Z0-9]{10}$/i.test(decoded) && /[A-Z]/i.test(decoded)) return { asin: decoded.toUpperCase(), raw: trimmed, valid: true };
      if (/^\d{10,}$/.test(decoded)) return { asin: decoded, raw: trimmed, valid: true };
    } catch (_) {}

    return { asin: null, raw: trimmed, valid: false };
  }

  /**
   * Detect column mapping from table headers
   */
  function detectColumnMap(table) {
    const map = {};
    const headers = table.querySelectorAll('thead th');
    headers.forEach((th, i) => {
      const text = (th.textContent || '').trim().toLowerCase();
      if (/\bitem\b|listing|product|title/i.test(text)) map.item = i;
      else if (/\bprice\b|buy.?it.?now/i.test(text)) map.price = i;
      else if (/\bavail|quantity|qty\b/i.test(text)) map.available = i;
      else if (/\bcustom.?label|sku\b/i.test(text)) map.customLabel = i;
      else if (/\bsold\b/i.test(text)) map.sold = i;
      else if (/\bstatus\b/i.test(text)) map.status = i;
    });
    return map;
  }

  /**
   * Extract data from a single table row
   */
  function extractRowData(row, cells, colMap) {
    let itemId = null;
    let title = '';
    let price = 0;
    let quantity = null;
    let customLabel = '';
    let sold = 0;
    let status = '';

    // Item cell
    const itemCell = colMap.item !== undefined ? cells[colMap.item] : null;
    if (itemCell) {
      const titleEl = itemCell.querySelector('.table-cell__data') || itemCell.querySelector('a');
      if (titleEl) title = titleEl.textContent.trim();
      const secondaryEl = itemCell.querySelector('.table-cell__data--secondary');
      if (secondaryEl) {
        const idMatch = secondaryEl.textContent.match(/(\d{10,14})/);
        if (idMatch) itemId = idMatch[1];
      }
      if (!itemId) {
        const link = itemCell.querySelector('a[href*="/itm/"]');
        if (link) { const m = link.href.match(/\/itm\/(\d+)/); if (m) itemId = m[1]; }
      }
    }

    // Fallback item ID
    if (!itemId) {
      const link = row.querySelector('a[href*="/itm/"]');
      if (link) { const m = link.href.match(/\/itm\/(\d+)/); if (m) itemId = m[1]; }
      const dataId = row.getAttribute('data-item-id') || row.getAttribute('data-listing-id');
      if (dataId) itemId = dataId;
      const cb = row.querySelector('input[type="checkbox"][value]');
      if (!itemId && cb && /^\d{10,14}$/.test(cb.value)) itemId = cb.value;
    }

    // Price
    if (colMap.price !== undefined && cells[colMap.price]) {
      const m = cells[colMap.price].textContent.match(/(?:AU|US|CA|GBP|EUR|NZ)?\s*[$£€]?\s*([\d,]+\.?\d*)/i);
      if (m) price = parseFloat(m[1].replace(/,/g, ''));
    }

    // Quantity
    if (colMap.available !== undefined && cells[colMap.available]) {
      const m = cells[colMap.available].textContent.match(/(\d+)/);
      if (m) quantity = parseInt(m[1], 10);
    }

    // Custom Label / SKU
    if (colMap.customLabel !== undefined && cells[colMap.customLabel]) {
      customLabel = cells[colMap.customLabel].textContent.trim();
    }

    // Sold
    if (colMap.sold !== undefined && cells[colMap.sold]) {
      const m = cells[colMap.sold].textContent.match(/(\d+)/);
      if (m) sold = parseInt(m[1], 10);
    }

    // Status
    if (colMap.status !== undefined && cells[colMap.status]) {
      status = cells[colMap.status].textContent.trim();
    }

    // Clean title
    title = title
      .replace(/^item\s+photo\.?\s*/i, '')
      .replace(/^show\s+listing\s+details?\s+page\.?\s*/i, '')
      .replace(/^listing\s+/i, '')
      .trim();

    return { itemId, title, price, quantity, customLabel, sold, status };
  }

  /**
   * Get all listing rows from the current page
   */
  function getListingRows() {
    const table = document.querySelector('.table--mode-selection table') ||
                  document.querySelector('.table table') ||
                  document.querySelector('table.table') ||
                  document.querySelector('[role="group"] table') ||
                  document.querySelector('#mainContent table');
    
    if (!table) return { rows: [], colMap: {} };
    
    const colMap = detectColumnMap(table);
    const rows = Array.from(table.querySelectorAll('tbody tr')).filter(row => {
      const cells = row.querySelectorAll('td');
      return cells.length >= 2;
    });
    
    return { rows, colMap, table };
  }

  /**
   * Get pagination info
   */
  function getPaginationInfo() {
    const info = { currentPage: 1, totalPages: 1, totalItems: 0 };
    const text = document.body?.textContent || '';
    
    const ofMatch = text.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)\s+of\s+([\d,]+)/i);
    if (ofMatch) {
      info.totalItems = parseInt(ofMatch[3].replace(/,/g, ''), 10);
    }

    // Find page input
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.trim().toLowerCase() === 'go') {
        let container = btn.parentElement;
        for (let i = 0; i < 3 && container; i++) {
          const input = container.querySelector('input:not([type="checkbox"]):not([type="hidden"]):not([type="radio"])');
          if (input) {
            const val = parseInt(input.value, 10);
            if (!isNaN(val) && val >= 1) info.currentPage = val;
            const totalMatch = container.textContent.match(/\/\s*([\d,]+)/);
            if (totalMatch) info.totalPages = parseInt(totalMatch[1].replace(/,/g, ''), 10);
            break;
          }
          container = container.parentElement;
        }
        break;
      }
    }

    if (info.totalPages <= 1 && info.totalItems > 0) {
      info.totalPages = Math.ceil(info.totalItems / 200);
    }

    return info;
  }

  // ============================
  // Message Listener
  // ============================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_TRACKING_PAGE') {
      (async () => {
        try {
          // Check the page loaded correctly
          await sleep(2000);
          const { rows, colMap } = getListingRows();
          const pagination = getPaginationInfo();

          if (rows.length === 0) {
            sendResponse({
              isPageOpenedCorrectly: false,
              error: 'No listing rows found',
              pagination
            });
            return;
          }

          // Extract all items on this page
          const items = [];
          for (let i = 0; i < rows.length; i++) {
            const cells = rows[i].querySelectorAll('td');
            const data = extractRowData(rows[i], cells, colMap);
            if (data.itemId) {
              const decoded = decodeCustomLabel(data.customLabel);
              items.push({
                position: i + 1,
                itemId: data.itemId,
                title: data.title,
                price: data.price,
                quantity: data.quantity,
                customLabel: data.customLabel,
                asin: decoded.asin,
                skuValid: decoded.valid,
                sold: data.sold,
                status: data.status
              });
            }
          }

          sendResponse({
            isPageOpenedCorrectly: true,
            items,
            pagination,
            totalOnPage: items.length
          });
        } catch (err) {
          sendResponse({
            isPageOpenedCorrectly: false,
            error: err.message
          });
        }
      })();
      return true;
    }

    // Ping to check if content script is loaded
    if (message.type === 'TRACKER_PING') {
      sendResponse({ loaded: true });
      return false;
    }
  });

  console.log('[DropFlow] Seller Hub Tracker content script loaded on', window.location.href);
})();
