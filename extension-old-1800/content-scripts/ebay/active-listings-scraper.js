/**
 * eBay Active Listings Scraper
 * Runs on Seller Hub active listings page (ebay.{domain}/sh/lst/active).
 * Extracts listing data for import into the Stock & Price Monitor.
 *
 * eBay uses their Evo/Skin design system (Marko.js, BEM classes):
 *   - Table container: .table, .table--mode-selection
 *   - Row cells: .table-cell, .table-cell--numeric, .table-cell__data, .table-cell__data--secondary
 *   - Thumbnails: .table-cell__thumbnail img
 *   - Columns are user-reorderable — we detect column mapping from <thead> headers.
 */

(function () {
  'use strict';

  // ============================
  // Helpers
  // ============================
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ============================
  // Auto-Enable Custom Label (SKU) Column
  // ============================
  // eBay Seller Hub lets users show/hide table columns. The Custom Label (SKU)
  // column is often hidden by default. We automatically enable it before
  // scraping so that ASINs are visible and can be linked to supplier products.
  // Column settings persist in the user's eBay account — this only runs once.

  let _skuColumnEnsured = false;

  /** Check if the Custom Label (SKU) column is visible in any table header. */
  function isCustomLabelColumnVisible() {
    for (const table of document.querySelectorAll('table')) {
      for (const th of table.querySelectorAll('thead th')) {
        if (/custom.?label|sku/i.test(th.textContent.trim())) return true;
      }
    }
    return false;
  }

  /**
   * Auto-enable the Custom Label (SKU) column.
   * Finds and clicks eBay's "Customise" button, checks the SKU checkbox,
   * clicks Apply, and waits for the table to re-render.
   * Runs once per page load — skips if column is already visible.
   */
  async function ensureCustomLabelColumn() {
    if (_skuColumnEnsured) return;
    _skuColumnEnsured = true;

    if (isCustomLabelColumnVisible()) {
      console.log('[DropFlow] Custom Label (SKU) column already visible');
      return;
    }

    console.log('[DropFlow] Custom Label column not visible — auto-enabling...');

    // --- Step 1: Find the Customise button ---
    const customizeBtn = findCustomizeButton();
    if (!customizeBtn) {
      console.warn('[DropFlow] Cannot find Customise columns button — SKU column will not be available');
      return;
    }

    // --- Step 2: Open the column settings panel ---
    console.log('[DropFlow] Opening column settings...');
    customizeBtn.click();
    await sleep(1200);

    // --- Step 3: Find and enable the Custom Label checkbox ---
    const found = await findAndEnableSkuCheckbox();
    if (!found) {
      console.warn('[DropFlow] Could not find Custom Label checkbox in settings panel');
      closeOpenPanel();
      await sleep(300);
      return;
    }

    // --- Step 4: Apply changes ---
    await applyColumnChanges();

    // --- Step 5: Wait for table re-render ---
    await sleep(2500);

    if (isCustomLabelColumnVisible()) {
      console.log('[DropFlow] Custom Label column is now visible — SKUs will be scraped');
    } else {
      console.warn('[DropFlow] Custom Label column still not visible — auto-enable may have failed');
    }
  }

  /** Find the "Customise" / "Customize" / "Columns" button above the table. */
  function findCustomizeButton() {
    // Strategy 1: Button text matching
    for (const btn of document.querySelectorAll('button, a, [role="button"]')) {
      const text = (btn.textContent || '').trim();
      const label = (btn.getAttribute('aria-label') || '');
      if (/^customi[sz]e$/i.test(text) || /^edit\s*columns?$/i.test(text) || /^columns?$/i.test(text) ||
          /customi[sz]e\s*columns?/i.test(label) || /\bcolumn\b/i.test(label)) {
        console.log('[DropFlow] Found customize button:', text || label);
        return btn;
      }
    }

    // Strategy 2: Icon button with column/settings hint near table area
    for (const btn of document.querySelectorAll('button[aria-haspopup], [class*="icon-btn"]')) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('column') || label.includes('customi')) {
        console.log('[DropFlow] Found icon-style customize button:', label);
        return btn;
      }
    }

    return null;
  }

  /** Find and check the Custom Label checkbox inside the open settings panel. */
  async function findAndEnableSkuCheckbox() {
    // Strategy A: Search labels, list items, role elements for "Custom label" or "SKU"
    const candidates = document.querySelectorAll(
      'label, li, [role="option"], [role="checkbox"], [role="menuitemcheckbox"], ' +
      '[class*="column-option"], [class*="field-option"]'
    );
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      if (/custom\s*label/i.test(text) || (/\bsku\b/i.test(text) && text.length < 40)) {
        console.log('[DropFlow] Found Custom Label option:', text.substring(0, 50));
        const cb = el.querySelector('input[type="checkbox"]');
        if (cb) {
          if (!cb.checked) { cb.click(); console.log('[DropFlow] Checked the SKU checkbox'); }
          else { console.log('[DropFlow] SKU checkbox was already checked'); }
        } else {
          // Element itself may be a toggle
          el.click();
          console.log('[DropFlow] Clicked Custom Label toggle');
        }
        await sleep(400);
        return true;
      }
    }

    // Strategy B: Walk up from all checkboxes, check parent text
    for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
      let parent = cb.parentElement;
      for (let depth = 0; depth < 4 && parent; depth++) {
        const parentText = (parent.textContent || '').trim();
        if (/custom\s*label/i.test(parentText) || (/\bsku\b/i.test(parentText) && parentText.length < 40)) {
          if (!cb.checked) cb.click();
          console.log('[DropFlow] Enabled SKU checkbox via parent text');
          await sleep(400);
          return true;
        }
        parent = parent.parentElement;
      }
    }

    return false;
  }

  /** Click the Apply/Save/Done button, or close the panel if none found. */
  async function applyColumnChanges() {
    for (const btn of document.querySelectorAll('button')) {
      const text = (btn.textContent || '').trim().toLowerCase();
      if (/^(apply|save|done|ok|confirm|update)$/.test(text)) {
        btn.click();
        console.log('[DropFlow] Clicked apply button:', text);
        await sleep(500);
        return;
      }
    }
    // No apply button — some UIs auto-apply; just close the panel
    closeOpenPanel();
  }

  /** Close any open panel/dropdown by pressing Escape. */
  function closeOpenPanel() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }

  // ============================
  // Auto-Enable Performance Columns (Sold, Watchers, Views)
  // ============================

  let _perfColumnsEnsured = false;

  function arePerformanceColumnsVisible() {
    for (const table of document.querySelectorAll('table')) {
      let hasSold = false, hasWatchers = false;
      for (const th of table.querySelectorAll('thead th')) {
        const text = (th.textContent || '').trim().toLowerCase();
        if (/\bsold\b/i.test(text)) hasSold = true;
        if (/\bwatch/i.test(text)) hasWatchers = true;
      }
      if (hasSold && hasWatchers) return true;
    }
    return false;
  }

  async function ensurePerformanceColumns() {
    if (_perfColumnsEnsured) return;
    _perfColumnsEnsured = true;

    if (arePerformanceColumnsVisible()) {
      console.log('[DropFlow] Performance columns (Sold, Watchers) already visible');
      return;
    }

    console.log('[DropFlow] Enabling performance columns (Sold, Watchers, Views)...');

    const customizeBtn = findCustomizeButton();
    if (!customizeBtn) {
      console.warn('[DropFlow] Cannot find Customise button — performance columns unavailable');
      return;
    }

    customizeBtn.click();
    await sleep(1200);

    // Enable Sold, Watchers, and Views checkboxes
    const columnsToEnable = ['sold', 'watch', 'view'];
    let enabled = 0;

    const candidates = document.querySelectorAll(
      'label, li, [role="option"], [role="checkbox"], [role="menuitemcheckbox"], ' +
      '[class*="column-option"], [class*="field-option"]'
    );

    for (const el of candidates) {
      const text = (el.textContent || '').trim().toLowerCase();
      for (const colName of columnsToEnable) {
        if (text.includes(colName) && text.length < 40) {
          const cb = el.querySelector('input[type="checkbox"]');
          if (cb && !cb.checked) {
            cb.click();
            enabled++;
            console.log(`[DropFlow] Enabled column: ${text}`);
            await sleep(200);
          } else if (!cb) {
            el.click();
            enabled++;
            console.log(`[DropFlow] Toggled column: ${text}`);
            await sleep(200);
          }
          break;
        }
      }
    }

    // Also walk checkboxes by parent text
    if (enabled === 0) {
      for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
        let parent = cb.parentElement;
        for (let depth = 0; depth < 4 && parent; depth++) {
          const parentText = (parent.textContent || '').trim().toLowerCase();
          for (const colName of columnsToEnable) {
            if (parentText.includes(colName) && parentText.length < 40 && !cb.checked) {
              cb.click();
              enabled++;
              console.log(`[DropFlow] Enabled column via parent: ${parentText.substring(0, 30)}`);
              await sleep(200);
            }
          }
          parent = parent.parentElement;
        }
      }
    }

    await applyColumnChanges();
    await sleep(2500);

    console.log(`[DropFlow] Performance columns: enabled ${enabled} new columns`);
  }

  // ============================
  // Column Detection
  // ============================

  /**
   * Read <thead> headers to build a column-index map.
   * Returns an object like { item: 1, price: 3, available: 4, customLabel: 5 }
   * Column order varies because Seller Hub lets users customize the table.
   */
  function detectColumnMap(table) {
    const map = {};
    const headers = table.querySelectorAll('thead th');

    headers.forEach((th, i) => {
      const text = (th.textContent || '').trim().toLowerCase();
      // eBay header labels (may vary slightly by locale)
      if (/\bitem\b|listing|product|title/i.test(text)) map.item = i;
      else if (/\bprice\b|buy.?it.?now/i.test(text)) map.price = i;
      else if (/\bavail|quantity|qty\b/i.test(text)) map.available = i;
      else if (/\bcustom.?label|sku\b/i.test(text)) map.customLabel = i;
      else if (/\bformat\b/i.test(text)) map.format = i;
      else if (/\bsold\b/i.test(text)) map.sold = i;
      else if (/\bwatch/i.test(text)) map.watchers = i;
      else if (/\bview|visit|impression/i.test(text)) map.views = i;
      else if (/\btime.?left|end.?date|expir/i.test(text)) map.timeLeft = i;
    });

    return map;
  }

  // ============================
  // Scraping Strategies
  // ============================

  /**
   * Strategy 1: eBay Evo table classes (.table, .table-cell, etc.)
   */
  function scrapeEvoTable() {
    const listings = [];

    // Find the listings table — could be .table--mode-selection or just a <table> inside the page
    const table = document.querySelector('.table--mode-selection table') ||
                  document.querySelector('.table table') ||
                  document.querySelector('table.table') ||
                  document.querySelector('[role="group"] table') ||
                  document.querySelector('#mainContent table');

    if (!table) return listings;

    const colMap = detectColumnMap(table);
    const rows = table.querySelectorAll('tbody tr');

    for (const row of rows) {
      try {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) continue;

        const listing = extractFromEvoRow(row, cells, colMap);
        if (listing && listing.itemId) {
          listings.push(listing);
        }
      } catch (e) {
        console.warn('[DropFlow] Error extracting Evo row:', e);
      }
    }

    return listings;
  }

  function extractFromEvoRow(row, cells, colMap) {
    let itemId = null;
    let title = '';
    let price = 0;
    let quantity = null;
    let customLabel = '';
    let thumbnail = '';
    let sold = 0;
    let watchers = 0;
    let views = 0;
    let timeLeft = '';

    // --- Item cell (title + item ID) ---
    const itemCell = colMap.item !== undefined ? cells[colMap.item] : null;
    if (itemCell) {
      // Title — primary data line
      const titleEl = itemCell.querySelector('.table-cell__data') ||
                      itemCell.querySelector('a');
      if (titleEl) title = titleEl.textContent.trim();

      // Item ID — secondary data line ("Item ID: 123456789012" or just the number)
      const secondaryEl = itemCell.querySelector('.table-cell__data--secondary');
      if (secondaryEl) {
        const idMatch = secondaryEl.textContent.match(/(\d{10,14})/);
        if (idMatch) itemId = idMatch[1];
      }

      // Also try extracting from links
      if (!itemId) {
        const link = itemCell.querySelector('a[href*="/itm/"]');
        if (link) {
          const match = link.href.match(/\/itm\/(\d+)/);
          if (match) itemId = match[1];
        }
      }

      // Thumbnail
      const img = itemCell.querySelector('.table-cell__thumbnail img') ||
                  itemCell.querySelector('img');
      if (img) thumbnail = img.src || img.getAttribute('data-src') || '';
    }

    // If we still don't have an item ID, scan the whole row
    if (!itemId) {
      itemId = extractItemIdFromRow(row);
    }

    // --- Price cell ---
    if (colMap.price !== undefined && cells[colMap.price]) {
      const priceText = cells[colMap.price].textContent;
      const match = priceText.match(/(?:AU|US|CA|GBP|EUR|NZ)?\s*[$£€]?\s*([\d,]+\.?\d*)/i);
      if (match) price = parseFloat(match[1].replace(/,/g, ''));
    }

    // --- Available / Quantity cell ---
    if (colMap.available !== undefined && cells[colMap.available]) {
      const qtyText = cells[colMap.available].textContent;
      const match = qtyText.match(/(\d+)/);
      if (match) quantity = parseInt(match[1], 10);
    }

    // --- Custom Label / SKU cell ---
    if (colMap.customLabel !== undefined && cells[colMap.customLabel]) {
      customLabel = cells[colMap.customLabel].textContent.trim();
    }

    // --- Sold cell ---
    if (colMap.sold !== undefined && cells[colMap.sold]) {
      const soldMatch = cells[colMap.sold].textContent.match(/(\d+)/);
      if (soldMatch) sold = parseInt(soldMatch[1], 10);
    }

    // --- Watchers cell ---
    if (colMap.watchers !== undefined && cells[colMap.watchers]) {
      const watchMatch = cells[colMap.watchers].textContent.match(/(\d+)/);
      if (watchMatch) watchers = parseInt(watchMatch[1], 10);
    }

    // --- Views cell ---
    if (colMap.views !== undefined && cells[colMap.views]) {
      const viewMatch = cells[colMap.views].textContent.match(/([\d,]+)/);
      if (viewMatch) views = parseInt(viewMatch[1].replace(/,/g, ''), 10);
    }

    // --- Time Left cell ---
    if (colMap.timeLeft !== undefined && cells[colMap.timeLeft]) {
      timeLeft = cells[colMap.timeLeft].textContent.trim();
    }

    // If we couldn't detect columns, try scanning all cells
    if (!title && colMap.item === undefined) {
      const extracted = scanRowCellsFallback(row, cells);
      title = extracted.title || title;
      itemId = itemId || extracted.itemId;
      price = price || extracted.price;
      thumbnail = thumbnail || extracted.thumbnail;
      customLabel = customLabel || extracted.customLabel;
    }

    // Title fallback: try img alt text
    if (!title) {
      const img = row.querySelector('img[alt]');
      if (img && img.alt && img.alt.length >= 5) title = img.alt;
    }

    return { itemId, title, price, quantity, customLabel, thumbnail, sold, watchers, views, timeLeft };
  }

  /**
   * Strategy 2: Generic table scraping — works on any <table> with listing links.
   */
  function scrapeGenericTable() {
    const listings = [];
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      const rows = table.querySelectorAll('tbody tr');
      if (rows.length < 1) continue;

      const colMap = detectColumnMap(table);

      for (const row of rows) {
        try {
          const cells = row.querySelectorAll('td');
          if (cells.length < 2) continue;

          const listing = extractFromGenericRow(row, cells, colMap);
          if (listing && listing.itemId) {
            listings.push(listing);
          }
        } catch (e) {
          console.warn('[DropFlow] Error extracting generic row:', e);
        }
      }

      if (listings.length > 0) break; // Found the right table
    }

    return listings;
  }

  function extractFromGenericRow(row, cells, colMap) {
    let itemId = extractItemIdFromRow(row);
    let title = '';
    let price = 0;
    let quantity = null;
    let customLabel = '';
    let thumbnail = '';
    let sold = 0;
    let watchers = 0;
    let views = 0;
    let timeLeft = '';

    // Title: look for the cell with a link or the most text
    for (const cell of cells) {
      const link = cell.querySelector('a[href*="/itm/"]');
      if (link) {
        title = link.textContent.trim();
        if (!itemId) {
          const match = link.href.match(/\/itm\/(\d+)/);
          if (match) itemId = match[1];
        }
        const img = cell.querySelector('img');
        if (img) thumbnail = img.src || img.getAttribute('data-src') || '';
        break;
      }
    }

    // Use column map if available
    if (colMap.price !== undefined && cells[colMap.price]) {
      const m = cells[colMap.price].textContent.match(/[\d,.]+/);
      if (m) price = parseFloat(m[0].replace(/,/g, ''));
    }
    if (colMap.available !== undefined && cells[colMap.available]) {
      const m = cells[colMap.available].textContent.match(/(\d+)/);
      if (m) quantity = parseInt(m[1], 10);
    }
    if (colMap.customLabel !== undefined && cells[colMap.customLabel]) {
      customLabel = cells[colMap.customLabel].textContent.trim();
    }
    if (colMap.sold !== undefined && cells[colMap.sold]) {
      const m = cells[colMap.sold].textContent.match(/(\d+)/);
      if (m) sold = parseInt(m[1], 10);
    }
    if (colMap.watchers !== undefined && cells[colMap.watchers]) {
      const m = cells[colMap.watchers].textContent.match(/(\d+)/);
      if (m) watchers = parseInt(m[1], 10);
    }
    if (colMap.views !== undefined && cells[colMap.views]) {
      const m = cells[colMap.views].textContent.match(/([\d,]+)/);
      if (m) views = parseInt(m[1].replace(/,/g, ''), 10);
    }
    if (colMap.timeLeft !== undefined && cells[colMap.timeLeft]) {
      timeLeft = cells[colMap.timeLeft].textContent.trim();
    }

    // Fallback price detection: first cell that looks like currency
    if (price === 0) {
      for (const cell of cells) {
        const text = cell.textContent.trim();
        const m = text.match(/(?:AU|US|CA|GBP|EUR|NZ)?\s*[$£€]\s*([\d,]+\.\d{2})/i) ||
                  text.match(/^[$£€]\s*([\d,]+\.?\d*)$/);
        if (m) { price = parseFloat(m[1].replace(/,/g, '')); break; }
      }
    }

    // Title fallback: img alt
    if (!title) {
      const img = row.querySelector('img[alt]');
      if (img && img.alt && img.alt.length >= 5) title = img.alt;
    }

    return { itemId, title, price, quantity, customLabel, thumbnail, sold, watchers, views, timeLeft };
  }

  /**
   * Strategy 3: Link-based fallback — find all /itm/ links on the page.
   * Works even if the DOM structure is completely unexpected.
   */
  function scrapeFromLinks() {
    const listings = [];
    const seen = new Set();
    const links = document.querySelectorAll('a[href*="/itm/"]');
    let loggedSample = false;

    for (const link of links) {
      try {
        const match = link.href.match(/\/itm\/(\d+)/);
        if (!match) continue;

        const itemId = match[1];
        if (seen.has(itemId)) continue;
        seen.add(itemId);

        // Walk up to find a reasonable container (tr, div, li, article)
        const container = link.closest('tr') || link.closest('[class*="listing"]') ||
                          link.closest('li') || link.closest('article') ||
                          link.closest('div[class]');

        // Log the first container's HTML for debugging
        if (!loggedSample && container) {
          console.log('[DropFlow] Sample container tag:', container.tagName, 'classes:', container.className);
          console.log('[DropFlow] Sample container HTML (first 2000 chars):', container.outerHTML.substring(0, 2000));
          loggedSample = true;
        }

        let title = '';
        let price = 0;
        let thumbnail = '';
        let customLabel = '';

        // --- Title extraction (multi-strategy) ---
        // 1. Link's own text (if it has readable text, not just an image)
        const linkText = link.textContent.trim();
        if (linkText && linkText.length >= 5) {
          title = linkText;
        }

        if (container) {
          // 2. eBay Evo data cell
          if (!title) {
            const dataEl = container.querySelector('.table-cell__data');
            if (dataEl) title = dataEl.textContent.trim();
          }

          // 3. Any link with substantial text (not just "Edit" or "View")
          if (!title) {
            const allLinks = container.querySelectorAll('a');
            for (const a of allLinks) {
              const t = a.textContent.trim();
              if (t.length >= 10 && !t.match(/^(edit|view|sell|relist|revise|end)/i)) {
                title = t;
                break;
              }
            }
          }

          // 4. Image alt text (eBay puts the title as img alt)
          if (!title) {
            const img = container.querySelector('img[alt]');
            if (img && img.alt && img.alt.length >= 5) title = img.alt;
          }

          // 5. Longest text node in the container (last resort)
          if (!title) {
            const spans = container.querySelectorAll('span, div, td, p');
            let longest = '';
            for (const el of spans) {
              // Only direct text, not nested
              if (el.children.length === 0) {
                const t = el.textContent.trim();
                if (t.length > longest.length && t.length >= 10) longest = t;
              }
            }
            if (longest) title = longest;
          }

          // --- Price extraction ---
          // Handle: $29.99, AU $29.99, A$29.99, £29.99, €29.99, US $29.99, GBP 29.99, etc.
          const cells = container.querySelectorAll('td, [class*="cell"], [class*="price"]');
          for (const cell of cells) {
            const text = cell.textContent.trim();
            // Match prices like: AU $29.99, $29.99, A$1,299.00, US $10.50, GBP 29.99
            const priceMatch = text.match(/(?:AU|US|CA|GBP|EUR|NZ)?\s*[$£€]\s*([\d,]+\.?\d*)/i) ||
                               text.match(/[$£€]\s*([\d,]+\.?\d*)/);
            if (priceMatch && !price) {
              const val = parseFloat(priceMatch[1].replace(/,/g, ''));
              if (val > 0 && val < 100000) { price = val; break; }
            }
          }

          // Fallback: scan entire container text
          if (!price) {
            const containerText = container.textContent;
            const priceMatch = containerText.match(/(?:AU|US|CA|GBP|EUR|NZ)?\s*[$£€]\s*([\d,]+\.\d{2})/i) ||
                               containerText.match(/[$£€]\s*([\d,]+\.\d{2})/);
            if (priceMatch) price = parseFloat(priceMatch[1].replace(/,/g, ''));
          }

          // --- Custom Label / SKU ---
          // Look for cells or elements that might contain a short alphanumeric code
          const skuEl = container.querySelector('[class*="custom-label"], [class*="sku"]');
          if (skuEl) customLabel = skuEl.textContent.trim();

          // --- Thumbnail ---
          const img = container.querySelector('img');
          if (img) thumbnail = img.src || img.getAttribute('data-src') || '';
        }

        listings.push({ itemId, title, price, quantity: null, customLabel, thumbnail, sold: 0, watchers: 0, views: 0, timeLeft: '' });
      } catch (e) {
        console.warn('[DropFlow] Error extracting from link:', e);
      }
    }

    return listings;
  }

  // ============================
  // Helpers
  // ============================

  /**
   * Extract item ID from a table row using multiple strategies.
   */
  function extractItemIdFromRow(row) {
    // 1. Data attributes
    const dataId = row.getAttribute('data-item-id') || row.getAttribute('data-listing-id');
    if (dataId) return dataId;

    // 2. Link href
    const link = row.querySelector('a[href*="/itm/"]');
    if (link) {
      const match = link.href.match(/\/itm\/(\d+)/);
      if (match) return match[1];
    }

    // 3. Secondary text line ("Item ID: 123456789012")
    const secondary = row.querySelector('.table-cell__data--secondary');
    if (secondary) {
      const match = secondary.textContent.match(/(\d{10,14})/);
      if (match) return match[1];
    }

    // 4. Any text containing a 10-14 digit number after "Item" or "ID"
    const rowText = row.textContent;
    const idMatch = rowText.match(/(?:item\s*(?:id|#)?|id)\s*[:.]?\s*(\d{10,14})/i);
    if (idMatch) return idMatch[1];

    // 5. Checkbox value (eBay sometimes puts item ID as the checkbox value)
    const checkbox = row.querySelector('input[type="checkbox"][value]');
    if (checkbox && /^\d{10,14}$/.test(checkbox.value)) return checkbox.value;

    return null;
  }

  /**
   * Fallback: scan all cells when column headers couldn't be detected.
   */
  function scanRowCellsFallback(row, cells) {
    let title = '';
    let itemId = null;
    let price = 0;
    let thumbnail = '';
    let customLabel = '';

    for (const cell of cells) {
      // Title cell usually has an image or a link
      const link = cell.querySelector('a[href*="/itm/"]');
      if (link && !title) {
        title = link.textContent.trim();
        if (!itemId) {
          const m = link.href.match(/\/itm\/(\d+)/);
          if (m) itemId = m[1];
        }
        const img = cell.querySelector('img');
        if (img) thumbnail = img.src || img.getAttribute('data-src') || '';
      }

      // Price cell: text containing a currency value
      const text = cell.textContent.trim();
      if (!price) {
        const m = text.match(/(?:AU|US|CA|GBP|EUR|NZ)?\s*[$£€]\s*([\d,]+\.\d{2})/i);
        if (m) price = parseFloat(m[1].replace(/,/g, ''));
      }
    }

    return { title, itemId, price, thumbnail, customLabel };
  }

  /**
   * Clean extracted title — strip eBay navigation/accessibility prefixes.
   * e.g. "Item photo. Show Listing Details page. Listing ALGAECAL PLUS" → "ALGAECAL PLUS"
   */
  function cleanTitle(raw) {
    if (!raw) return '';
    // Strip common eBay Seller Hub prefixes
    let title = raw
      .replace(/^item\s+photo\.?\s*/i, '')
      .replace(/^show\s+listing\s+details?\s+page\.?\s*/i, '')
      .replace(/^listing\s+/i, '')
      .replace(/^opens?\s+in\s+a?\s*new\s+(?:window|tab)\.?\s*/i, '')
      .trim();
    return title || raw.trim();
  }

  /**
   * Log a sample listing for debugging extraction quality.
   */
  function logSample(listings) {
    const sample = listings.slice(0, 3);
    for (const s of sample) {
      console.log(`[DropFlow] Sample: id=${s.itemId} title="${(s.title || '').substring(0, 60)}" price=${s.price} sku="${s.customLabel}"`);
    }
    const withTitles = listings.filter(l => l.title && l.title.length > 0).length;
    const withPrices = listings.filter(l => l.price > 0).length;
    const withSkus = listings.filter(l => l.customLabel && l.customLabel.length > 0).length;
    console.log(`[DropFlow] Quality: ${withTitles}/${listings.length} titles, ${withPrices}/${listings.length} prices, ${withSkus}/${listings.length} SKUs`);
  }

  // ============================
  // Main Scraper
  // ============================

  /**
   * Scrape all visible listings using a cascade of strategies.
   */
  function scrapeActiveListings() {
    console.log('[DropFlow] Starting active listings scrape...');

    // Strategy 1: eBay Evo table classes
    let listings = scrapeEvoTable();
    if (listings.length > 0) {
      console.log(`[DropFlow] Strategy 1 (Evo table): found ${listings.length} listings`);
      listings.forEach(l => { l.title = cleanTitle(l.title); });
      logSample(listings);
      return listings;
    }

    // Strategy 2: Generic table scraping
    listings = scrapeGenericTable();
    if (listings.length > 0) {
      console.log(`[DropFlow] Strategy 2 (generic table): found ${listings.length} listings`);
      listings.forEach(l => { l.title = cleanTitle(l.title); });
      logSample(listings);
      return listings;
    }

    // Strategy 3: Link-based fallback
    listings = scrapeFromLinks();
    if (listings.length > 0) {
      console.log(`[DropFlow] Strategy 3 (links): found ${listings.length} listings`);
      listings.forEach(l => { l.title = cleanTitle(l.title); });
      logSample(listings);
      return listings;
    }

    // Nothing found — log diagnostic info to help debug
    console.warn('[DropFlow] All 3 strategies found 0 listings. Page diagnostics:');
    console.warn('  URL:', window.location.href);
    console.warn('  Tables on page:', document.querySelectorAll('table').length);
    console.warn('  Links with /itm/:', document.querySelectorAll('a[href*="/itm/"]').length);
    console.warn('  .table elements:', document.querySelectorAll('.table').length);
    console.warn('  .table-cell elements:', document.querySelectorAll('.table-cell').length);
    console.warn('  Body text length:', document.body?.textContent?.length || 0);

    // Capture page structure hint for debugging
    const mainContent = document.querySelector('#mainContent, main, [role="main"]');
    if (mainContent) {
      const children = Array.from(mainContent.children).map(c =>
        `${c.tagName}.${Array.from(c.classList).join('.')}`
      ).slice(0, 10);
      console.warn('  Main content children:', children.join(', '));
    }

    return [];
  }

  // ============================
  // Pagination
  // ============================

  /**
   * Find the pagination controls on eBay Seller Hub.
   * Returns { pageInput, goBtn, totalPagesEl } or null.
   * The Seller Hub layout: "Page [input] / 244 [Go]"
   */
  function findPaginationControls() {
    // Strategy 1: Find "Go" button, then look for nearby input
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text === 'go') {
        // Walk up to parent container, find the input
        let container = btn.parentElement;
        for (let i = 0; i < 3 && container; i++) {
          const input = container.querySelector('input[type="text"], input[type="number"], input:not([type="checkbox"]):not([type="hidden"]):not([type="radio"])');
          if (input) {
            // Verify this is a page input — its value should be a small number
            const val = parseInt(input.value, 10);
            if (!isNaN(val) && val >= 1 && val <= 9999) {
              console.log('[DropFlow] Found pagination: input value=' + input.value, 'Go button found');
              return { pageInput: input, goBtn: btn, container };
            }
          }
          container = container.parentElement;
        }
      }
    }

    // Strategy 2: Find input near "/ NNN" text pattern
    const allInputs = document.querySelectorAll('input');
    for (const input of allInputs) {
      const val = parseInt(input.value, 10);
      if (isNaN(val) || val < 1) continue;
      // Check siblings/parent for "/ 244" pattern
      const parentText = input.parentElement?.textContent || '';
      if (/\/\s*\d{2,}/.test(parentText)) {
        console.log('[DropFlow] Found pagination input via "/ NNN" pattern, value=' + input.value);
        return { pageInput: input, goBtn: null, container: input.parentElement };
      }
    }

    return null;
  }

  function getPaginationInfo() {
    const pageInfo = { currentPage: 1, totalPages: 1, totalItems: 0, itemsPerPage: 200 };

    // --- Results text: "Results: 1-200 of 48,698" ---
    const allText = document.body?.textContent || '';
    const ofMatch = allText.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)\s+of\s+([\d,]+)/i);
    if (ofMatch) {
      const rangeStart = parseInt(ofMatch[1].replace(/,/g, ''), 10);
      const rangeEnd = parseInt(ofMatch[2].replace(/,/g, ''), 10);
      pageInfo.totalItems = parseInt(ofMatch[3].replace(/,/g, ''), 10);
      if (rangeEnd > rangeStart) {
        pageInfo.itemsPerPage = rangeEnd - rangeStart + 1;
      }
    }

    // --- Page input & "/ 244" text (most reliable for Seller Hub) ---
    const controls = findPaginationControls();
    if (controls) {
      const val = parseInt(controls.pageInput.value, 10);
      if (!isNaN(val)) pageInfo.currentPage = val;

      // Extract total pages from "/ 244" text in the container
      const containerText = controls.container?.textContent || '';
      const totalMatch = containerText.match(/\/\s*([\d,]+)/);
      if (totalMatch) {
        pageInfo.totalPages = parseInt(totalMatch[1].replace(/,/g, ''), 10);
      }
    }

    // Fallback: URL params
    if (pageInfo.currentPage === 1 && !controls) {
      const urlParams = new URLSearchParams(window.location.search);
      const page = urlParams.get('page') || urlParams.get('q._pgn');
      if (page) pageInfo.currentPage = parseInt(page, 10);
    }

    // Fallback: calculate total pages from total items
    if (pageInfo.totalPages <= 1 && pageInfo.totalItems > 0) {
      pageInfo.totalPages = Math.ceil(pageInfo.totalItems / pageInfo.itemsPerPage);
    }

    console.log(`[DropFlow] Pagination: page ${pageInfo.currentPage}/${pageInfo.totalPages}, ${pageInfo.itemsPerPage}/page, ~${pageInfo.totalItems} total`);
    return pageInfo;
  }

  /**
   * Navigate to a specific page using the DOM pagination controls.
   * eBay Seller Hub is a Marko.js SPA — URL params don't work for navigation.
   * We interact with the "Page [input] / 244 [Go]" widget directly.
   */
  function navigateToPage(targetPage) {
    return new Promise((resolve, reject) => {
      const controls = findPaginationControls();
      if (!controls || !controls.pageInput) {
        reject(new Error('Pagination controls not found'));
        return;
      }

      const { pageInput, goBtn } = controls;
      const currentPage = parseInt(pageInput.value, 10);

      if (currentPage === targetPage) {
        console.log(`[DropFlow] Already on page ${targetPage}`);
        resolve();
        return;
      }

      // Capture the current "Results: X-Y" text to detect when content changes
      const bodyText = document.body?.textContent || '';
      const currentRange = bodyText.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)\s+of/i);
      const currentRangeStr = currentRange ? currentRange[0] : '';

      console.log(`[DropFlow] Navigating from page ${currentPage} to ${targetPage}...`);

      // Set the page input value using native setter (Marko.js framework-aware)
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(pageInput, String(targetPage));
      pageInput.dispatchEvent(new Event('input', { bubbles: true }));
      pageInput.dispatchEvent(new Event('change', { bubbles: true }));

      // Click Go button, or press Enter as fallback
      if (goBtn) {
        goBtn.click();
      } else {
        pageInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        pageInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }

      // Poll until the page content changes (table re-renders with new data)
      let attempts = 0;
      const maxAttempts = 30; // 30 * 500ms = 15 seconds max wait
      const poll = setInterval(() => {
        attempts++;
        const newText = document.body?.textContent || '';
        const newRange = newText.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)\s+of/i);
        const newRangeStr = newRange ? newRange[0] : '';

        // Content changed — the table has re-rendered
        if (newRangeStr && newRangeStr !== currentRangeStr) {
          clearInterval(poll);
          console.log(`[DropFlow] Page changed: "${currentRangeStr}" → "${newRangeStr}"`);
          // Brief extra wait for DOM to fully settle
          setTimeout(resolve, 1500);
          return;
        }

        if (attempts >= maxAttempts) {
          clearInterval(poll);
          console.warn(`[DropFlow] Timed out waiting for page ${targetPage} to load`);
          // Resolve anyway — scraper will try whatever is on the page
          setTimeout(resolve, 1000);
        }
      }, 500);
    });
  }

  // ============================
  // Custom Label Fallback Strategies
  // ============================
  // When the table column is hidden and auto-enable fails, these strategies
  // extract Custom Labels from eBay's page data or API without needing the column.

  /**
   * Enrich listings with Custom Labels using fallback strategies.
   * Called when the table scrape returned 0 Custom Labels.
   */
  async function enrichCustomLabels(listings) {
    const itemIds = listings.map(l => l.itemId).filter(Boolean);
    if (itemIds.length === 0) return;

    const domain = window.location.hostname.replace(/^www\.ebay\./, '');
    let labels = {};

    // Strategy 1: Extract from embedded page data (Marko.js serialized state)
    console.log('[DropFlow] Fallback Strategy 1: Searching embedded page data...');
    labels = extractCustomLabelsFromPageData(itemIds);
    if (applyLabels(listings, labels)) return;

    // Strategy 2: Fetch individual revision page HTML and parse for Custom Labels
    // The revision page (/lstng?mode=ReviseItem) contains Marko SSR data with all fields
    if (itemIds.length <= 50) {
      console.log('[DropFlow] Fallback Strategy 2: Fetching revision page HTML...');
      labels = await fetchLabelsFromRevisionPages(domain, itemIds);
      if (applyLabels(listings, labels)) return;
    }

    const found = listings.filter(l => l.customLabel).length;
    console.log(`[DropFlow] Content-script enrichment result: ${found}/${listings.length} found`);
    if (found === 0) {
      console.log('[DropFlow] Content-script strategies exhausted. Monitor.js will try MAIN world injection next.');
    }
  }

  function applyLabels(listings, labels) {
    if (!labels || Object.keys(labels).length === 0) return false;
    let applied = 0;
    for (const listing of listings) {
      if (!listing.customLabel && labels[listing.itemId]) {
        listing.customLabel = labels[listing.itemId];
        applied++;
      }
    }
    if (applied > 0) console.log(`[DropFlow] Applied ${applied} Custom Labels`);
    return applied > 0;
  }

  /**
   * Strategy 1: Search <script> tags for listing data containing Custom Labels.
   * Marko.js server-renders pages with serialized component state.
   * Also searches for ASIN patterns (B0xxxxxxxxx) near known item IDs.
   */
  function extractCustomLabelsFromPageData(itemIds) {
    const labels = {};
    const itemIdSet = new Set(itemIds);
    let totalScripts = 0;
    let scriptsWithItemIds = 0;

    for (const script of document.querySelectorAll('script:not([src])')) {
      const text = script.textContent || '';
      if (text.length < 100) continue;
      totalScripts++;

      // Check if this script contains any of our item IDs
      const hasItemId = itemIds.some(id => text.includes(id));
      if (hasItemId) scriptsWithItemIds++;

      // Pattern A: JSON key "customLabel"/"sku" near "itemId"
      const fwd = /"(?:itemId|listingId)"\s*:\s*"?(\d{10,14})"?[^}]{0,1200}?"(?:customLabel|sku|custom_label|customlabel|SKU)"\s*:\s*"([^"]+)"/gi;
      let m;
      while ((m = fwd.exec(text)) !== null) {
        if (itemIdSet.has(m[1])) labels[m[1]] = m[2];
      }

      // Pattern B: reverse order
      const rev = /"(?:customLabel|sku|custom_label|customlabel|SKU)"\s*:\s*"([^"]+)"[^}]{0,1200}?"(?:itemId|listingId)"\s*:\s*"?(\d{10,14})"?/gi;
      while ((m = rev.exec(text)) !== null) {
        if (itemIdSet.has(m[2])) labels[m[2]] = m[1];
      }

      // Pattern C: Look for ASIN (B0xxxxxxxxx) near item IDs in any format
      // This catches Marko serialization formats that aren't standard JSON
      for (const itemId of itemIds) {
        if (labels[itemId]) continue;
        const idx = text.indexOf(itemId);
        if (idx === -1) continue;
        // Search within 2000 chars around the item ID for an ASIN pattern
        const start = Math.max(0, idx - 1000);
        const end = Math.min(text.length, idx + itemId.length + 1000);
        const chunk = text.substring(start, end);
        const asinMatch = chunk.match(/\bB0[A-Z0-9]{8}\b/i);
        if (asinMatch) {
          labels[itemId] = asinMatch[0].toUpperCase();
        }
      }
    }

    console.log(`[DropFlow] Strategy 1: Scanned ${totalScripts} scripts, ${scriptsWithItemIds} contain item IDs, found ${Object.keys(labels).length} Custom Labels`);
    return labels;
  }

  /**
   * Strategy 2: Fetch listing revision page HTML and extract Custom Labels.
   * The revision page (/lstng?mode=ReviseItem&itemId=X) contains Marko SSR data
   * with all listing fields including Custom Label, even for hidden table columns.
   * Tests a single item first; if successful, fetches remaining items.
   */
  async function fetchLabelsFromRevisionPages(domain, itemIds) {
    const labels = {};

    // Test with first item to check if this approach works
    const testId = itemIds[0];
    const testLabel = await fetchSingleRevisionLabel(domain, testId);

    if (testLabel === null) {
      console.log('[DropFlow] Strategy 2: Revision page fetch approach not viable (test item failed)');
      return labels;
    }

    if (testLabel) labels[testId] = testLabel;
    console.log(`[DropFlow] Strategy 2: Test item ${testId} → "${testLabel || '(empty)'}"`);

    // If test succeeded (found data), fetch remaining items in parallel batches
    const remaining = itemIds.filter(id => id !== testId);
    for (let i = 0; i < remaining.length; i += 5) {
      const batch = remaining.slice(i, i + 5);
      await Promise.all(batch.map(async (itemId) => {
        const label = await fetchSingleRevisionLabel(domain, itemId);
        if (label) labels[itemId] = label;
      }));
      if (i + 5 < remaining.length) await sleep(800);
    }

    console.log(`[DropFlow] Strategy 2: Found ${Object.keys(labels).length}/${itemIds.length} Custom Labels via revision pages`);
    return labels;
  }

  /**
   * Fetch a single listing's revision page HTML and extract Custom Label.
   * Returns the Custom Label string, empty string if field exists but is empty,
   * or null if the fetch/parse completely failed.
   */
  async function fetchSingleRevisionLabel(domain, itemId) {
    // Try multiple revision URL patterns (eBay migrated from /lstng to /sl/)
    const urls = [
      `https://www.ebay.${domain}/sl/revise/${itemId}`,
      `https://www.ebay.${domain}/sl/revise?itemId=${itemId}`,
      `https://www.ebay.${domain}/lstng?mode=ReviseItem&itemId=${itemId}`,
    ];

    for (const url of urls) {
      try {
        const resp = await fetch(url, { credentials: 'include', redirect: 'follow' });
        if (!resp.ok) continue;

        // Check if the response URL indicates a generic page (redirect to sell page without itemId)
        const finalUrl = resp.url || '';
        if (finalUrl.includes('sr=wnstart') || (finalUrl.includes('/sl/sell') && !finalUrl.includes(itemId))) {
          console.log(`[DropFlow] URL ${url} redirected to generic page: ${finalUrl}`);
          continue; // Try next URL pattern
        }

        return await parseRevisionHtml(await resp.text(), itemId);
      } catch (e) { continue; }
    }
    console.warn(`[DropFlow] All revision URL patterns failed for ${itemId}`);
    return null;
  }

  /**
   * Parse revision page HTML to extract Custom Label/SKU value.
   * Returns the label string, empty string if page fetched but no label found.
   */
  function parseRevisionHtml(html, itemId) {
    // Search 1: JSON key "customLabel" or "sku" with a value
    const jsonMatch = html.match(/"(?:customLabel|sku|custom_label|SKU)"\s*:\s*"([^"]{1,50})"/i);
    if (jsonMatch) return jsonMatch[1].trim();

    // Search 2: Input field with name="customLabel" and a value
    const inputMatch = html.match(/name=["'](?:customLabel|sku)["'][^>]*value=["']([^"']{1,50})["']/i) ||
                       html.match(/value=["']([^"']{1,50})["'][^>]*name=["'](?:customLabel|sku)["']/i);
    if (inputMatch) return inputMatch[1].trim();

    // Search 3: ASIN pattern near "customLabel" or "sku" text
    const skuSection = html.match(/(?:customLabel|custom.label|sku|SKU)[^]{0,200}?(?:value|>)\s*["']?\s*(B0[A-Z0-9]{8})/i);
    if (skuSection) return skuSection[1].toUpperCase();

    // Search 4: Any ASIN near the item ID in the HTML
    const idIdx = html.indexOf(itemId);
    if (idIdx !== -1) {
      const chunk = html.substring(Math.max(0, idIdx - 2000), Math.min(html.length, idIdx + 2000));
      const asinMatch = chunk.match(/\bB0[A-Z0-9]{8}\b/i);
      if (asinMatch) return asinMatch[0].toUpperCase();
    }

    // Search 5: AliExpress product ID pattern (10+ digits that aren't the itemId)
    if (idIdx !== -1) {
      const chunk = html.substring(Math.max(0, idIdx - 2000), Math.min(html.length, idIdx + 2000));
      const aliMatch = chunk.match(/["'](\d{10,15})["']/g);
      if (aliMatch) {
        for (const raw of aliMatch) {
          const digits = raw.replace(/["']/g, '');
          if (digits !== itemId && digits.length >= 10) return digits;
        }
      }
    }

    return ''; // Page fetched OK but no Custom Label found
  }

  // ============================
  // Edit URL Discovery
  // ============================

  /**
   * Discover the revision/edit URL pattern by inspecting Edit buttons in the table.
   * Returns a URL template like "https://www.ebay.com/sl/sell/ITEM_ID" or null.
   */
  function discoverEditUrl() {
    // Look for Edit buttons/links in the table rows
    const editElements = document.querySelectorAll(
      'a[href*="revise"], a[href*="ReviseItem"], a[href*="/sl/sell"], a[href*="/sl/list"], ' +
      'a[href*="/lstng"], a[href*="mode=Edit"], a[href*="itemId"]'
    );

    for (const el of editElements) {
      const href = el.href || '';
      if (href && href.includes('ebay')) {
        console.log('[DropFlow] Found edit link:', href);
        return href;
      }
    }

    // Check button onclick handlers or data attributes
    for (const btn of document.querySelectorAll('button, a')) {
      const text = (btn.textContent || '').trim().toLowerCase();
      if (text === 'edit' || text === 'revise') {
        const href = btn.href || btn.getAttribute('data-href') || '';
        if (href) {
          console.log('[DropFlow] Found edit button with href:', href);
          return href;
        }
        // Check if button has an itemId-related data attribute
        const itemId = btn.closest('tr')?.querySelector('a[href*="/itm/"]')?.href?.match(/\/itm\/(\d+)/)?.[1];
        if (itemId) {
          console.log('[DropFlow] Found edit button near itemId:', itemId);
        }
      }
    }

    // Check if the Edit buttons in the table are <a> tags with hrefs
    const rows = document.querySelectorAll('tbody tr');
    for (const row of rows) {
      const editBtn = row.querySelector('button, a');
      if (editBtn) {
        const href = editBtn.href || '';
        const text = (editBtn.textContent || '').trim().toLowerCase();
        if ((text === 'edit' || text.includes('edit')) && href) {
          console.log('[DropFlow] Found row edit link:', href);
          return href;
        }
      }
    }

    return null;
  }

  // ============================
  // Message Listener
  // ============================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SCRAPE_ACTIVE_LISTINGS') {
      (async () => {
        try {
          // Auto-enable Custom Label column on first scrape (one-time)
          await ensureCustomLabelColumn();

          // Navigate to target page if needed
          if (message.page && message.page > 1) {
            await navigateToPage(message.page);
          }

          const listings = scrapeActiveListings();
          const pagination = getPaginationInfo();

          // Discover the edit URL pattern for revision operations
          const editUrl = discoverEditUrl();

          // Fallback: if no Custom Labels found, try alternative strategies
          const hasLabels = listings.some(l => l.customLabel && l.customLabel.length > 0);
          if (listings.length > 0 && !hasLabels) {
            console.log('[DropFlow] No Custom Labels from table — trying fallback strategies...');
            await enrichCustomLabels(listings);
          }

          sendResponse({ listings, pagination, editUrl });
        } catch (err) {
          console.error('[DropFlow] Scraping error:', err);
          sendResponse({ listings: [], pagination: getPaginationInfo(), error: err.message });
        }
      })();
      return true; // Always keep channel open for async
    }

    if (message.type === 'SCRAPE_ACTIVE_LISTINGS_FULL') {
      (async () => {
        try {
          // Enable both Custom Label AND performance columns
          await ensureCustomLabelColumn();
          await ensurePerformanceColumns();

          if (message.page && message.page > 1) {
            await navigateToPage(message.page);
          }

          const listings = scrapeActiveListings();
          const pagination = getPaginationInfo();
          const editUrl = discoverEditUrl();

          const hasLabels = listings.some(l => l.customLabel && l.customLabel.length > 0);
          if (listings.length > 0 && !hasLabels) {
            await enrichCustomLabels(listings);
          }

          sendResponse({ listings, pagination, editUrl });
        } catch (err) {
          console.error('[DropFlow] Full scraping error:', err);
          sendResponse({ listings: [], pagination: getPaginationInfo(), error: err.message });
        }
      })();
      return true;
    }
  });

  console.log('[DropFlow] Active listings scraper loaded on', window.location.href);
})();
