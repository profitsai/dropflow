import {
  ADD_TRACKED_PRODUCT, REMOVE_TRACKED_PRODUCT, UPDATE_TRACKED_PRODUCT, GET_TRACKED_PRODUCTS,
  START_MONITOR, STOP_MONITOR, CHECK_PRODUCT_NOW,
  MONITOR_CHECK_RESULT, MONITOR_PROGRESS, MONITOR_ALERT,
  GET_MONITOR_SETTINGS, SAVE_MONITOR_SETTINGS,
  SCRAPE_ACTIVE_LISTINGS,
  START_SKU_BACKFILL, PAUSE_SKU_BACKFILL, TERMINATE_SKU_BACKFILL,
  SKU_BACKFILL_PROGRESS, SKU_BACKFILL_COMPLETE,
  DOWNLOAD_EBAY_CSV, IMPORT_CSV_PRODUCTS, CSV_IMPORT_PROGRESS, CSV_IMPORT_COMPLETE,
  PAUSE_MONITOR, RESUME_MONITOR, MONITOR_PAUSED,
  START_TRACKING, STOP_TRACKING, RESET_TRACKING,
  TRACKING_PROGRESS, TRACKING_LOG, TRACKING_STATUS,
  GET_TRACKER_SETTINGS, SAVE_TRACKER_SETTINGS
} from '../../lib/message-types.js';

import { DEFAULTS, MONITOR_SETTINGS, MONITOR_ALERTS } from '../../lib/storage-keys.js';

// ============================
// State
// ============================
let products = [];
let alerts = [];
let settings = DEFAULTS[MONITOR_SETTINGS];
let isRunning = false;
let editingProductId = null;
let currentProductPage = 1;
const PRODUCTS_PER_PAGE = 500;
let sortColumn = null;    // null | 'title' | 'sourcePrice' | 'ebayPrice' | 'margin' | 'stock' | 'lastChecked'
let sortDirection = 'asc'; // 'asc' | 'desc'

// ============================
// DOM refs
// ============================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const logEl = $('#log-output');

// ============================
// Init
// ============================
async function init() {
  setupTabs();
  setupBackfillTabs();
  setupEventListeners();
  await loadMonitorState();
  await loadProducts();
  renderProducts();
  renderAlerts();
  renderUnlinkedProducts();
  updateStats();
}

// ============================
// Tab Switching
// ============================
function setupTabs() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      $$('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $(`#tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

function setupBackfillTabs() {
  $$('[data-backfill-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('[data-backfill-tab]').forEach(t => t.classList.remove('active'));
      $$('.backfill-tab-content').forEach(c => { c.classList.remove('active'); c.style.display = 'none'; });
      tab.classList.add('active');
      const target = $(`#backfill-${tab.dataset.backfillTab}`);
      if (target) { target.classList.add('active'); target.style.display = ''; }
    });
  });
}

// ============================
// Event Listeners
// ============================
function setupEventListeners() {
  // Start/Stop monitor
  $('#btn-toggle-monitor').addEventListener('click', toggleMonitor);

  // Add product
  $('#btn-add-product').addEventListener('click', addProduct);

  // Import from eBay
  $('#btn-import-ebay').addEventListener('click', importFromEbay);
  $('#btn-cancel-import').addEventListener('click', () => {
    _importAborted = true;
    log('Cancelling import after current page...');
  });

  // Check all now (works whether monitor is running or not)
  $('#btn-check-all').addEventListener('click', async () => {
    log('Starting check of all products...');
    const resp = await sendMsg(START_MONITOR);
    if (resp?.error) {
      log('Error: ' + resp.error);
    } else if (resp?.success) {
      if (!isRunning) {
        isRunning = true;
        updateMonitorUI();
      }
    }
  });

  // Export CSV
  $('#btn-export-csv').addEventListener('click', exportCsv);

  // Bulk delete unlinked products
  $('#btn-delete-unlinked').addEventListener('click', deleteUnlinkedProducts);

  // Filter (reset to page 1 on new search)
  $('#filter-products').addEventListener('input', (e) => {
    currentProductPage = 1;
    renderProducts(e.target.value);
  });

  // Alerts
  $('#btn-mark-all-read').addEventListener('click', markAllAlertsRead);
  $('#btn-clear-alerts').addEventListener('click', clearAlerts);

  // Settings
  $('#btn-save-settings').addEventListener('click', saveSettings);

  // Markup type toggle
  $('#set-markup-type').addEventListener('change', (e) => {
    $('#markup-pct-group').style.display = e.target.value === 'percentage' ? '' : 'none';
    $('#markup-fixed-group').style.display = e.target.value === 'fixed' ? '' : 'none';
    $('#variable-tiers-card').style.display = e.target.value === 'variable' ? '' : 'none';
  });

  // Edit modal
  $('#edit-modal-close').addEventListener('click', closeEditModal);
  $('#edit-modal-cancel').addEventListener('click', closeEditModal);
  $('#edit-modal-save').addEventListener('click', saveEditProduct);
  $('#edit-source-url').addEventListener('input', (e) => detectSourceType(e.target.value));
  $('#edit-modal').addEventListener('click', (e) => {
    if (e.target === $('#edit-modal')) closeEditModal();
  });

  // Backfill
  $('#btn-start-backfill').addEventListener('click', startBackfill);
  $('#btn-pause-backfill').addEventListener('click', () => {
    const btn = $('#btn-pause-backfill');
    if (btn.textContent === 'Pause') {
      sendMsg(PAUSE_SKU_BACKFILL, { paused: true });
      btn.textContent = 'Resume';
      log('SKU backfill paused');
    } else {
      sendMsg(PAUSE_SKU_BACKFILL, { paused: false });
      btn.textContent = 'Pause';
      log('SKU backfill resumed');
    }
  });
  $('#btn-stop-backfill').addEventListener('click', () => {
    sendMsg(TERMINATE_SKU_BACKFILL);
    log('SKU backfill terminated');
    resetBackfillUI();
  });

  // --- Pause/Resume Monitor (EcomSniper-inspired) ---
  $('#btn-pause-monitor').addEventListener('click', async () => {
    await sendMsg(PAUSE_MONITOR);
    $('#btn-pause-monitor').style.display = 'none';
    $('#btn-resume-monitor').style.display = '';
    log('Monitor paused');
  });
  $('#btn-resume-monitor').addEventListener('click', async () => {
    await sendMsg(RESUME_MONITOR);
    $('#btn-resume-monitor').style.display = 'none';
    $('#btn-pause-monitor').style.display = '';
    log('Monitor resumed');
  });

  // --- CSV Import (EcomSniper-inspired) ---
  const csvFileInput = $('#csv-file-input');
  const csvImportBtn = $('#btn-import-csv');
  if (csvFileInput) {
    csvFileInput.addEventListener('change', () => {
      csvImportBtn.disabled = !csvFileInput.files.length;
    });
  }
  if (csvImportBtn) {
    csvImportBtn.addEventListener('click', handleCsvImport);
  }
  const openEbayCsvBtn = $('#btn-open-ebay-csv');
  if (openEbayCsvBtn) {
    openEbayCsvBtn.addEventListener('click', () => {
      const domain = $('#csv-import-domain')?.value || 'com.au';
      sendMsg(DOWNLOAD_EBAY_CSV, { domain });
      log('Opening eBay reports page...');
    });
  }

  // Bulk link (local only)
  const bulkLinkBtn = $('#btn-apply-bulk-link');
  if (bulkLinkBtn) {
    bulkLinkBtn.addEventListener('click', applyBulkLinks);
  }

  // Row action buttons (event delegation — inline onclick blocked by MV3 CSP)
  $('#products-tbody').addEventListener('click', handleRowAction);

  // Table column sorting
  $$('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortColumn === col) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = col;
        sortDirection = 'asc';
      }
      // Update header arrows
      $$('.sortable').forEach(h => {
        h.textContent = h.textContent.replace(/ [▲▼]$/, '');
      });
      th.textContent += sortDirection === 'asc' ? ' ▲' : ' ▼';
      currentProductPage = 1;
      renderProducts($('#filter-products').value);
    });
  });

  // eBay OOS preference link
  const prefsLink = $('#btn-open-ebay-prefs');
  if (prefsLink) {
    prefsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://www.ebay.com/ws/eBayISAPI.dll?MyeBayPreferences&CurrentPage=MyeBaySelling' });
    });
  }

  // Listen for broadcasts from service worker
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case MONITOR_PROGRESS:
        handleProgress(message);
        break;
      case MONITOR_CHECK_RESULT:
        handleCheckResult(message);
        break;
      case MONITOR_ALERT:
        handleNewAlert(message.alert);
        break;
      case SKU_BACKFILL_PROGRESS:
        handleBackfillProgress(message);
        break;
      case SKU_BACKFILL_COMPLETE:
        handleBackfillComplete(message);
        break;
      case CSV_IMPORT_PROGRESS:
        handleCsvImportProgress(message);
        break;
      case CSV_IMPORT_COMPLETE:
        handleCsvImportComplete(message);
        break;
      case MONITOR_PAUSED:
        if (message.paused) {
          $('#btn-pause-monitor').style.display = 'none';
          $('#btn-resume-monitor').style.display = '';
        } else {
          $('#btn-resume-monitor').style.display = 'none';
          $('#btn-pause-monitor').style.display = '';
        }
        break;
      // --- Page-Based Tracker ---
      case TRACKING_PROGRESS:
        handleTrackerProgress(message);
        break;
      case TRACKING_LOG:
        handleTrackerLogEntry(message.entry);
        break;
      case TRACKING_STATUS:
        updateTrackerUI(message.running);
        break;
    }
  });
}

// ============================
// Monitor Start/Stop
// ============================
async function toggleMonitor() {
  if (isRunning) {
    const resp = await sendMsg(STOP_MONITOR);
    if (resp?.success) {
      isRunning = false;
      updateMonitorUI();
      log('Monitor stopped');
    }
  } else {
    const resp = await sendMsg(START_MONITOR);
    if (resp?.success) {
      isRunning = true;
      updateMonitorUI();
      log(`Monitor started — tracking ${resp.productCount} products`);
    } else {
      log('Error: ' + (resp?.error || 'Failed to start'));
    }
  }
}

function updateMonitorUI() {
  const btn = $('#btn-toggle-monitor');
  const badge = $('#monitor-status');
  if (isRunning) {
    btn.textContent = 'Stop Monitor';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-danger');
    badge.textContent = 'Running';
    badge.className = 'monitor-badge badge-running';
  } else {
    btn.textContent = 'Start Monitor';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-primary');
    badge.textContent = 'Stopped';
    badge.className = 'monitor-badge badge-stopped';
  }
}

// ============================
// Load State
// ============================
async function loadMonitorState() {
  const resp = await sendMsg(GET_MONITOR_SETTINGS);
  if (resp?.success) {
    settings = resp.settings;
    isRunning = resp.running;
    alerts = resp.alerts || [];

    updateMonitorUI();
    populateSettingsForm();

    if (resp.lastRun) {
      $('#stat-last-run').textContent = timeAgo(resp.lastRun);
    }
  }
}

async function loadProducts() {
  const resp = await sendMsg(GET_TRACKED_PRODUCTS);
  if (resp?.success) {
    products = resp.products;
  }
}

// ============================
// Add Product
// ============================
async function addProduct() {
  const sourceUrl = $('#add-source-url').value.trim();
  const ebayItemId = $('#add-ebay-id').value.trim();
  const ebayDomain = $('#add-ebay-domain').value;
  const ebayTitle = $('#add-ebay-title').value.trim();

  if (!sourceUrl) return log('Error: Supplier URL is required');
  if (!ebayItemId) return log('Error: eBay Item ID is required');
  if (!sourceUrl.includes('amazon.') && !sourceUrl.includes('aliexpress.')) {
    return log('Error: URL must be an Amazon or AliExpress product link');
  }

  const resp = await sendMsg(ADD_TRACKED_PRODUCT, {
    product: { sourceUrl, ebayItemId, ebayDomain, ebayTitle }
  });

  if (resp?.success) {
    products.push(resp.product);
    renderProducts();
    updateStats();
    log(`Added: ${ebayTitle || ebayItemId} (${sourceUrl.includes('aliexpress') ? 'AliExpress' : 'Amazon'})`);
    // Clear form
    $('#add-source-url').value = '';
    $('#add-ebay-id').value = '';
    $('#add-ebay-title').value = '';
  } else {
    log('Error: ' + (resp?.error || 'Failed to add product'));
  }
}

// eBay domain → most likely Amazon domain mapping
const EBAY_TO_AMAZON_DOMAIN = {
  'com': 'www.amazon.com',
  'ca': 'www.amazon.ca',
  'co.uk': 'www.amazon.co.uk',
  'com.au': 'www.amazon.com.au',
  'de': 'www.amazon.de',
  'fr': 'www.amazon.fr',
  'it': 'www.amazon.it',
  'es': 'www.amazon.es',
  'nl': 'www.amazon.nl'
};

// ============================
// Source URL Builder
// ============================
function buildSourceUrl(customLabel, ebayDomain) {
  if (!customLabel) return '';
  const label = customLabel.trim();
  const amazonDomain = EBAY_TO_AMAZON_DOMAIN[ebayDomain] || 'www.amazon.com';

  // Amazon ASIN: starts with B0 + 8 alphanumeric chars (e.g. B0ABC12345)
  if (/^B0[A-Z0-9]{8}$/i.test(label)) {
    return `https://${amazonDomain}/dp/${label.toUpperCase()}`;
  }
  // ISBN-10: 9 digits + check digit (0-9 or X), used by Amazon for books (e.g. 031045526X)
  if (/^\d{9}[\dX]$/i.test(label)) {
    return `https://${amazonDomain}/dp/${label.toUpperCase()}`;
  }
  // ISBN-13: 13 digits starting with 978 or 979, also used by Amazon for books
  if (/^97[89]\d{10}$/.test(label)) {
    return `https://${amazonDomain}/dp/${label}`;
  }
  // Other Amazon ASIN formats: 10 alphanumeric chars (some ASINs don't start with B0)
  if (/^[A-Z0-9]{10}$/i.test(label) && /[A-Z]/i.test(label)) {
    return `https://${amazonDomain}/dp/${label.toUpperCase()}`;
  }
  // AliExpress ID: 10+ digits (but NOT ISBN-13 which starts with 978/979)
  if (/^\d{10,}$/.test(label) && !/^97[89]/.test(label)) {
    return `https://www.aliexpress.com/item/${label}.html`;
  }
  return '';
}

// ============================
// Custom Label Enrichment (when table column is hidden)
// ============================

/**
 * Enrichment Layer 1: Inject MAIN world script to access eBay's JS data.
 * chrome.scripting.executeScript with world:'MAIN' runs in the page's
 * JavaScript context, giving access to Marko component state and globals.
 * This bypasses CSP since it's a Chrome API, not an inline script.
 */
async function enrichViaMainWorld(tabId, listings) {
  const itemIds = listings.filter(l => !l.customLabel).map(l => l.itemId).filter(Boolean);
  if (itemIds.length === 0) return 0;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (targetItemIds) => {
        const labels = {};
        const idSet = new Set(targetItemIds);

        // Helper: recursively search objects for listing data
        function findLabels(obj, depth) {
          if (depth > 10 || !obj || typeof obj !== 'object') return;
          try {
            if (Array.isArray(obj)) {
              for (const item of obj) findLabels(item, depth + 1);
              return;
            }
            // Check if this object has itemId + customLabel/sku
            const id = String(obj.itemId || obj.listingId || obj.item_id || '');
            if (idSet.has(id)) {
              const sku = obj.customLabel || obj.sku || obj.SKU ||
                          obj.custom_label || obj.customlabel || '';
              if (sku) labels[id] = String(sku);
            }
            for (const key of Object.keys(obj)) {
              if (key === 'window' || key === 'document' || key === 'self' || key === 'top' || key === 'parent' || key === 'frames') continue;
              const val = obj[key];
              if (val && typeof val === 'object') findLabels(val, depth + 1);
            }
          } catch (e) { /* skip — some objects throw on property access */ }
        }

        // Method A: Walk DOM elements for Marko component instances
        const walker = document.createTreeWalker(document.body, 1 /* SHOW_ELEMENT */);
        let steps = 0;
        while (walker.nextNode() && steps < 5000) {
          steps++;
          const el = walker.currentNode;
          const comp = el.__component || el._component || el.__marko;
          if (comp) {
            if (comp.state) findLabels(comp.state, 0);
            if (comp.input) findLabels(comp.input, 0);
            if (comp._input) findLabels(comp._input, 0);
          }
        }

        // Method B: Check for data in known global patterns
        const globalKeys = Object.keys(window).filter(k => {
          try { return typeof window[k] === 'object' && window[k] !== null && k.startsWith('$'); } catch (e) { return false; }
        });
        for (const key of globalKeys) {
          try { findLabels(window[key], 0); } catch (e) {}
        }

        // Method C: Check $marko_componentLookup and other Marko globals
        if (window.$marko_componentLookup) {
          for (const key of Object.keys(window.$marko_componentLookup)) {
            try {
              const comp = window.$marko_componentLookup[key];
              if (comp?.d) findLabels(comp.d, 0);
              if (comp?.state) findLabels(comp.state, 0);
            } catch (e) {}
          }
        }

        return { labels, componentCount: steps, globalKeysChecked: globalKeys.length };
      },
      args: [itemIds]
    });

    const data = results?.[0]?.result;
    if (!data) return 0;

    log(`MAIN world scan: ${data.componentCount} DOM nodes, ${data.globalKeysChecked} globals checked`);

    let applied = 0;
    if (data.labels && Object.keys(data.labels).length > 0) {
      for (const listing of listings) {
        if (!listing.customLabel && data.labels[listing.itemId]) {
          listing.customLabel = data.labels[listing.itemId];
          applied++;
        }
      }
      log(`MAIN world: Found ${applied} Custom Labels in page JavaScript data`);
    }
    return applied;
  } catch (e) {
    log(`MAIN world extraction error: ${e.message}`);
    return 0;
  }
}

/**
 * Enrichment Layer 2: Open revision tabs and read Custom Labels via form-filler.js.
 * This is the most reliable approach — the revision form always shows Custom Labels.
 * Only used for small sets (≤ 30 items) due to speed.
 */
async function enrichViaRevisionTabs(listings, domain) {
  const unlinked = listings.filter(l => !l.customLabel && l.itemId);
  if (unlinked.length === 0 || unlinked.length > 30) return 0;

  // Try multiple revision URL patterns — eBay may have migrated from /lstng to /sl/
  const urlPatterns = [
    (id) => `https://www.ebay.${domain}/sl/revise/${id}`,
    (id) => `https://www.ebay.${domain}/sl/revise?itemId=${id}`,
    (id) => `https://www.ebay.${domain}/lstng?mode=ReviseItem&itemId=${id}`,
  ];

  // Test which URL pattern works with the first item
  let workingPattern = null;
  const testId = unlinked[0].itemId;

  for (const patternFn of urlPatterns) {
    const testUrl = patternFn(testId);
    let testTabId = null;
    try {
      const tab = await new Promise((resolve, reject) => {
        chrome.tabs.create({ url: testUrl, active: false }, (t) => {
          const listener = (tid, changeInfo) => {
            if (tid === t.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve(t);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('timeout')); }, 20000);
        });
      });
      testTabId = tab.id;

      // Check if tab redirected to a generic page (no item context)
      const tabInfo = await chrome.tabs.get(testTabId);
      const finalUrl = tabInfo.url || '';
      if (finalUrl.includes('sr=wnstart') || (finalUrl.includes('/sl/sell') && !finalUrl.includes(testId))) {
        log(`  URL pattern ${testUrl} redirected to generic page — skipping`);
        chrome.tabs.remove(testTabId).catch(() => {});
        continue;
      }

      // URL pattern works — test reading Custom Label
      await new Promise(r => setTimeout(r, 5000));
      try {
        const resp = await chrome.tabs.sendMessage(testTabId, { type: 'READ_CUSTOM_LABEL' });
        if (resp?.found) {
          workingPattern = patternFn;
          if (resp.customLabel) {
            unlinked[0].customLabel = resp.customLabel;
            log(`  Found working revision URL: ${testUrl}`);
            log(`  Item ${testId}: Custom Label = "${resp.customLabel}"`);
          }
        }
      } catch (e) { /* form-filler may not have loaded */ }

      chrome.tabs.remove(testTabId).catch(() => {});
      if (workingPattern) break;
    } catch (e) {
      if (testTabId) chrome.tabs.remove(testTabId).catch(() => {});
    }
  }

  if (!workingPattern) {
    log('Could not find a working revision URL pattern. Revision tab enrichment skipped.');
    return 0;
  }

  // Process remaining items with the working pattern
  let found = unlinked[0].customLabel ? 1 : 0;
  const remaining = unlinked.slice(1);

  log(`Opening revision pages for ${remaining.length} remaining items...`);

  for (let i = 0; i < remaining.length; i++) {
    if (_importAborted) break;
    const listing = remaining[i];
    let tabId = null;

    try {
      const revUrl = workingPattern(listing.itemId);
      const tab = await new Promise((resolve, reject) => {
        chrome.tabs.create({ url: revUrl, active: false }, (t) => {
          const listener = (tid, changeInfo) => {
            if (tid === t.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve(t);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('Tab load timeout')); }, 30000);
        });
      });
      tabId = tab.id;

      await new Promise(r => setTimeout(r, 5000));
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'READ_CUSTOM_LABEL' });
      if (resp?.customLabel) {
        listing.customLabel = resp.customLabel;
        found++;
        log(`  Item ${listing.itemId}: Custom Label = "${resp.customLabel}"`);
      }
    } catch (e) {
      // Skip
    } finally {
      if (tabId) try { chrome.tabs.remove(tabId); } catch (_) {}
    }

    if (i < remaining.length - 1) await new Promise(r => setTimeout(r, 1000));
  }

  if (found > 0) log(`Revision tabs: Found ${found}/${unlinked.length} Custom Labels`);
  return found;
}

// ============================
// Import from eBay (auto-paginating)
// ============================
let _importAborted = false;

async function importFromEbay() {
  const domain = $('#add-ebay-domain').value || 'com';
  const baseUrl = `https://www.ebay.${domain}/sh/lst/active`;
  const importBtn = $('#btn-import-ebay');
  const cancelBtn = $('#btn-cancel-import');
  importBtn.disabled = true;
  cancelBtn.style.display = '';
  _importAborted = false;

  log(`Opening eBay active listings (${domain}) — 200 items/page, auto-paginating all pages...`);

  // Show progress bar
  const progressSection = $('#progress-section');
  progressSection.style.display = '';
  $('#progress-bar').style.width = '0%';
  $('#progress-text').textContent = 'Loading eBay Seller Hub...';

  // --- Helpers ---

  /** Scrape page 1 with retries (waits for Marko.js SPA to render the table) */
  async function scrapeFirstPage(tabId) {
    const delays = [6000, 6000, 8000, 12000];
    for (let i = 0; i < delays.length; i++) {
      await new Promise(r => setTimeout(r, delays[i]));
      try {
        const resp = await chrome.tabs.sendMessage(tabId, { type: SCRAPE_ACTIVE_LISTINGS });
        if (resp?.listings?.length > 0) return resp;
      } catch (e) {
        // Content script may not have loaded — inject it
        if (i === 0) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId },
              files: ['content-scripts/ebay/active-listings-scraper.js']
            });
          } catch (_) { /* ignore */ }
        }
      }
    }
    return null;
  }

  /**
   * Scrape a specific page — the content script handles DOM pagination
   * (types the page number into the "Page [X] / 244 [Go]" input and clicks Go).
   * No full-page reload needed — stays within the Marko.js SPA.
   */
  async function scrapePageN(tabId, page) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: SCRAPE_ACTIVE_LISTINGS, page });
      return resp;
    } catch (e) {
      return { listings: [], error: e.message };
    }
  }

  /** Import a batch of listings — add new, update existing */
  async function importBatch(listings, ebayDomain) {
    let added = 0, updated = 0;
    for (const listing of listings) {
      const existing = products.find(p => p.ebayItemId === listing.itemId);
      const sourceUrl = buildSourceUrl(listing.customLabel, ebayDomain);

      if (existing) {
        const updates = {};
        if (listing.title && listing.title !== existing.ebayTitle) updates.ebayTitle = listing.title;
        if (listing.price > 0 && listing.price !== existing.ebayPrice) updates.ebayPrice = listing.price;
        if (!existing.sourceUrl && sourceUrl) {
          updates.sourceUrl = sourceUrl;
          // Also set sourceId, sourceType, sourceDomain so the monitor can check the product
          const isAli = sourceUrl.includes('aliexpress.');
          updates.sourceType = isAli ? 'aliexpress' : 'amazon';
          if (isAli) {
            const aliMatch = sourceUrl.match(/\/item\/(?:[^/]+\/)?(\d+)\.html/);
            if (aliMatch) updates.sourceId = aliMatch[1];
            updates.sourceDomain = 'aliexpress';
          } else {
            const asinMatch = sourceUrl.match(/\/dp\/([A-Z0-9]{10})/i);
            if (asinMatch) updates.sourceId = asinMatch[1].toUpperCase();
            const amzDomainMatch = sourceUrl.match(/amazon\.([a-z.]+)\//);
            updates.sourceDomain = amzDomainMatch ? amzDomainMatch[1] : 'com';
          }
        }
        if (Object.keys(updates).length > 0) {
          const resp = await sendMsg(UPDATE_TRACKED_PRODUCT, { productId: existing.id, updates });
          if (resp?.success) { Object.assign(existing, updates); updated++; }
        }
      } else {
        const result = await sendMsg(ADD_TRACKED_PRODUCT, {
          product: { sourceUrl, ebayItemId: listing.itemId, ebayDomain, ebayTitle: listing.title, ebayPrice: listing.price }
        });
        if (result?.success) { products.push(result.product); added++; }
      }
    }
    return { added, updated };
  }

  // --- Main Flow ---

  let tab;
  try {
    // Open first page (items-per-page is controlled by eBay session settings, not URL params)
    tab = await new Promise((resolve, reject) => {
      chrome.tabs.create({ url: baseUrl, active: true }, (t) => {
        const listener = (tabId, changeInfo) => {
          if (tabId === t.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(t);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error('Timeout loading eBay'));
        }, 60000);
      });
    });
  } catch (e) {
    log('Error: Failed to load eBay active listings page');
    importBtn.disabled = false;
    progressSection.style.display = 'none';
    return;
  }

  try {
    // --- Page 1 ---
    log('Scraping page 1...');
    const firstResp = await scrapeFirstPage(tab.id);

    if (!firstResp?.listings?.length) {
      log('No listings found on page 1. Make sure you are logged in and on the Active Listings page. Check browser console (F12) for "[DropFlow]" diagnostic messages.');
      importBtn.disabled = false;
      cancelBtn.style.display = 'none';
      progressSection.style.display = 'none';
      chrome.tabs.remove(tab.id).catch(() => {});
      return;
    }

    const totalPages = firstResp.pagination?.totalPages || 1;
    const totalItems = firstResp.pagination?.totalItems || firstResp.listings.length;
    const itemsPerPage = firstResp.pagination?.itemsPerPage || firstResp.listings.length;

    // Log discovered edit URL pattern (helps debug revision URL issues)
    if (firstResp.editUrl) {
      log(`Edit URL discovered: ${firstResp.editUrl}`);
    }

    log(`Page 1: ${firstResp.listings.length} listings scraped. Total: ~${totalItems.toLocaleString()} items across ${totalPages} pages (${itemsPerPage}/page)`);

    // Check if Custom Labels (SKUs) were found — if not, run enrichment
    let withSkus = firstResp.listings.filter(l => l.customLabel && l.customLabel.length > 0).length;
    if (withSkus === 0) {
      log('No Custom Labels in table — running enrichment to find supplier links...');
      $('#progress-text').textContent = 'Enriching listings with Custom Labels...';

      // Layer 1: MAIN world injection (fast — reads eBay's JS data directly)
      await enrichViaMainWorld(tab.id, firstResp.listings);
      withSkus = firstResp.listings.filter(l => l.customLabel && l.customLabel.length > 0).length;

      // Layer 2: Revision tabs (slow but guaranteed — only for small sets)
      if (withSkus === 0 && firstResp.listings.length <= 30 && !_importAborted) {
        await enrichViaRevisionTabs(firstResp.listings, domain);
        withSkus = firstResp.listings.filter(l => l.customLabel && l.customLabel.length > 0).length;
      }

      if (withSkus > 0) {
        log(`Enrichment complete: Found ${withSkus}/${firstResp.listings.length} Custom Labels — auto-linking`);
      } else {
        log('No Custom Labels found after enrichment. Listings will import as Unlinked.');
        log('For existing listings without ASINs, use the Bulk SKU Backfiller to add them.');
      }
    } else {
      log(`Found ${withSkus}/${firstResp.listings.length} listings with Custom Labels (SKUs) — auto-linking`);
    }

    // Import page 1
    let totalAdded = 0, totalUpdated = 0;
    const p1 = await importBatch(firstResp.listings, domain);
    totalAdded += p1.added;
    totalUpdated += p1.updated;

    const pct1 = Math.round((1 / totalPages) * 100);
    $('#progress-bar').style.width = pct1 + '%';
    $('#progress-text').textContent = `Page 1/${totalPages} — ${totalAdded + totalUpdated} products processed`;

    // --- Remaining pages ---
    if (totalPages > 1) {
      let consecutiveEmpty = 0;

      for (let page = 2; page <= totalPages; page++) {
        if (_importAborted) {
          log('Import cancelled by user');
          break;
        }

        // Check tab still exists
        try { await chrome.tabs.get(tab.id); } catch (_) {
          log('eBay tab was closed — import stopped');
          break;
        }

        $('#progress-text').textContent = `Page ${page}/${totalPages} — navigating...`;

        // Content script navigates via DOM (Page input + Go button) and scrapes
        const pageResp = await scrapePageN(tab.id, page);

        if (pageResp?.listings?.length > 0) {
          consecutiveEmpty = 0;

          // Enrich this page's listings if no Custom Labels found
          const pageSkus = pageResp.listings.filter(l => l.customLabel && l.customLabel.length > 0).length;
          if (pageSkus === 0) {
            await enrichViaMainWorld(tab.id, pageResp.listings);
          }

          const result = await importBatch(pageResp.listings, domain);
          totalAdded += result.added;
          totalUpdated += result.updated;
          log(`Page ${page}/${totalPages}: ${pageResp.listings.length} listings (${totalAdded} new, ${totalUpdated} updated so far)`);
        } else {
          consecutiveEmpty++;
          log(`Page ${page}/${totalPages}: No listings found${pageResp?.error ? ' — ' + pageResp.error : ''}`);
          if (consecutiveEmpty >= 3) {
            log('3 consecutive empty pages — stopping early');
            break;
          }
        }

        // Update progress bar
        const pct = Math.round((page / totalPages) * 100);
        $('#progress-bar').style.width = pct + '%';
        $('#progress-text').textContent = `Page ${page}/${totalPages} — ${(totalAdded + totalUpdated).toLocaleString()} products processed`;

        // Brief delay between pages (the content script already waits for DOM to update)
        if (page < totalPages) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    renderProducts();
    renderUnlinkedProducts();
    updateStats();
    log(`Import complete: ${totalAdded.toLocaleString()} new + ${totalUpdated.toLocaleString()} updated (${(totalAdded + totalUpdated).toLocaleString()} total)`);
  } catch (e) {
    log('Error during import: ' + e.message);
  } finally {
    importBtn.disabled = false;
    cancelBtn.style.display = 'none';
    progressSection.style.display = 'none';
    try { chrome.tabs.remove(tab.id); } catch (_) {}
  }
}

// ============================
// Render Products Table
// ============================
function renderProducts(filter = '') {
  const tbody = $('#products-tbody');
  const filterLower = filter.toLowerCase();

  let filtered = filter
    ? products.filter(p =>
        (p.ebayTitle || '').toLowerCase().includes(filterLower) ||
        (p.sourceId || '').toLowerCase().includes(filterLower) ||
        (p.ebayItemId || '').includes(filterLower)
      )
    : [...products];

  // Apply sorting
  if (sortColumn) {
    const dir = sortDirection === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      let va, vb;
      switch (sortColumn) {
        case 'title':
          va = (a.ebayTitle || a.sourceId || '').toLowerCase();
          vb = (b.ebayTitle || b.sourceId || '').toLowerCase();
          return va < vb ? -dir : va > vb ? dir : 0;
        case 'sourcePrice':
          return ((a.sourcePrice || 0) - (b.sourcePrice || 0)) * dir;
        case 'ebayPrice':
          return ((a.ebayPrice || 0) - (b.ebayPrice || 0)) * dir;
        case 'margin':
          va = (a.ebayPrice && a.sourcePrice) ? a.ebayPrice - a.sourcePrice : -Infinity;
          vb = (b.ebayPrice && b.sourcePrice) ? b.ebayPrice - b.sourcePrice : -Infinity;
          return (va - vb) * dir;
        case 'stock':
          va = a.sourceInStock === true ? 2 : a.sourceInStock === false ? 0 : 1;
          vb = b.sourceInStock === true ? 2 : b.sourceInStock === false ? 0 : 1;
          return (va - vb) * dir;
        case 'lastChecked':
          va = a.lastChecked ? new Date(a.lastChecked).getTime() : 0;
          vb = b.lastChecked ? new Date(b.lastChecked).getTime() : 0;
          return (va - vb) * dir;
        default:
          return 0;
      }
    });
  }

  // Reset to page 1 when filter changes
  const totalPages = Math.max(1, Math.ceil(filtered.length / PRODUCTS_PER_PAGE));
  if (currentProductPage > totalPages) currentProductPage = totalPages;

  const startIdx = (currentProductPage - 1) * PRODUCTS_PER_PAGE;
  const pageItems = filtered.slice(startIdx, startIdx + PRODUCTS_PER_PAGE);

  $('#products-count').textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No products tracked yet. Add a product above to get started.</td></tr>';
    renderProductsPagination(0, 0);
    return;
  }

  tbody.innerHTML = pageItems.map(p => {
    const sourceClass = p.sourceType === 'aliexpress' ? 'source-aliexpress' : 'source-amazon';
    const sourceLabel = p.sourceType === 'aliexpress' ? 'Ali' : 'AMZ';

    let stockClass = 'stock-unknown';
    let stockLabel = 'Unknown';
    if (p.status === 'error') { stockClass = 'stock-error'; stockLabel = 'Error'; }
    else if (!p.lastChecked) { /* never checked — stay Unknown */ }
    else if (p.sourceInStock === true) { stockClass = 'stock-in'; stockLabel = 'In Stock'; }
    else if (p.sourceInStock === false) { stockClass = 'stock-out'; stockLabel = 'Out of Stock'; }

    const margin = p.ebayPrice && p.sourcePrice ? p.ebayPrice - p.sourcePrice : null;
    const marginPct = p.sourcePrice ? ((margin / p.sourcePrice) * 100) : null;
    let marginClass = '';
    let marginText = '-';
    if (margin !== null) {
      marginClass = margin > 5 ? 'margin-positive' : margin > 0 ? 'margin-low' : 'margin-negative';
      marginText = `$${margin.toFixed(2)} (${marginPct.toFixed(0)}%)`;
    }

    const lastChecked = p.lastChecked ? timeAgo(p.lastChecked) : 'Never';

    return `
      <tr data-id="${p.id}">
        <td>
          <span class="source-badge ${sourceClass}">${sourceLabel}</span>
          ${p.sourceUrl ? '<span class="link-badge link-linked">Linked</span>' : '<span class="link-badge link-unlinked">Unlinked</span>'}
        </td>
        <td>
          <div style="font-weight:600;color:#fff">${escHtml(p.ebayTitle || p.sourceId || 'Untitled')}</div>
          <div style="font-size:11px;color:#666">${p.ebayItemId}</div>
        </td>
        <td>$${(p.sourcePrice || 0).toFixed(2)}</td>
        <td>$${(p.ebayPrice || 0).toFixed(2)}</td>
        <td class="${marginClass}">${marginText}</td>
        <td><span class="stock-badge ${stockClass}">${stockLabel}</span></td>
        <td style="font-size:12px;color:#888">${lastChecked}</td>
        <td>
          <div class="row-actions">
            <button class="row-btn" data-action="edit" data-id="${p.id}" title="Edit / Link">${p.sourceUrl ? 'Edit' : 'Link'}</button>
            <button class="row-btn" data-action="check" data-id="${p.id}" title="Check now">Check</button>
            <button class="row-btn btn-row-danger" data-action="remove" data-id="${p.id}" title="Remove">X</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  renderProductsPagination(filtered.length, totalPages);
}

function handleRowAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (action === 'edit') window._editProduct(id);
  else if (action === 'check') window._checkNow(id);
  else if (action === 'remove') window._removeProduct(id);
}

function renderProductsPagination(totalItems, totalPages) {
  const container = $('#products-pagination');
  if (!container) return;

  if (totalPages <= 1) {
    container.style.display = 'none';
    return;
  }

  container.style.display = '';
  const startItem = (currentProductPage - 1) * PRODUCTS_PER_PAGE + 1;
  const endItem = Math.min(currentProductPage * PRODUCTS_PER_PAGE, totalItems);

  container.innerHTML = `
    <button class="btn btn-small btn-secondary pagination-btn" id="products-page-first" ${currentProductPage === 1 ? 'disabled' : ''}>First</button>
    <button class="btn btn-small btn-secondary pagination-btn" id="products-page-prev" ${currentProductPage === 1 ? 'disabled' : ''}>Prev</button>
    <span class="pagination-info">Page ${currentProductPage} of ${totalPages} (${startItem.toLocaleString()}-${endItem.toLocaleString()} of ${totalItems.toLocaleString()})</span>
    <button class="btn btn-small btn-secondary pagination-btn" id="products-page-next" ${currentProductPage === totalPages ? 'disabled' : ''}>Next</button>
    <button class="btn btn-small btn-secondary pagination-btn" id="products-page-last" ${currentProductPage === totalPages ? 'disabled' : ''}>Last</button>
  `;

  const filter = $('#filter-products').value;
  $('#products-page-first').addEventListener('click', () => { currentProductPage = 1; renderProducts(filter); });
  $('#products-page-prev').addEventListener('click', () => { currentProductPage = Math.max(1, currentProductPage - 1); renderProducts(filter); });
  $('#products-page-next').addEventListener('click', () => { currentProductPage = Math.min(totalPages, currentProductPage + 1); renderProducts(filter); });
  $('#products-page-last').addEventListener('click', () => { currentProductPage = totalPages; renderProducts(filter); });
}

// Expose handlers to inline onclick (needed since this is a module)
window._checkNow = async (productId) => {
  log(`Checking product ${productId}...`);
  const resp = await sendMsg(CHECK_PRODUCT_NOW, { productId });
  if (resp?.success) {
    await loadProducts();
    renderProducts($('#filter-products').value);
    updateStats();
    const r = resp.result;
    if (r.changed) {
      log(`Change detected (${r.type})`);
    } else if (r.error) {
      log(`Error: ${r.message}`);
    } else {
      log('No changes detected');
    }
  }
};

window._removeProduct = async (productId) => {
  const product = products.find(p => p.id === productId);
  const label = product?.ebayTitle || product?.ebayItemId || productId;
  if (!confirm(`Remove "${label}" from tracking?`)) return;

  const resp = await sendMsg(REMOVE_TRACKED_PRODUCT, { productId });
  if (resp?.success) {
    products = products.filter(p => p.id !== productId);
    renderProducts($('#filter-products').value);
    renderUnlinkedProducts();
    updateStats();
    log(`Removed: ${label}`);
  }
};

// ============================
// Alerts
// ============================
function renderAlerts() {
  const container = $('#alerts-list');
  const unread = alerts.filter(a => !a.read).length;
  const badge = $('#alert-badge');
  if (unread > 0) {
    badge.textContent = unread;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }

  if (alerts.length === 0) {
    container.innerHTML = '<div class="empty-state">No alerts yet. Start monitoring to receive alerts.</div>';
    return;
  }

  container.innerHTML = alerts.slice(0, 200).map(a => {
    const icon = {
      out_of_stock: '\u26A0\uFE0F',
      price_up: '\u2B06\uFE0F',
      price_down: '\u2B07\uFE0F',
      not_found: '\u274C',
      restocked: '\u2705',
      error: '\u26A0\uFE0F'
    }[a.type] || '\u2139\uFE0F';

    return `
      <div class="alert-item ${a.read ? '' : 'unread'}">
        <div class="alert-icon">${icon}</div>
        <div class="alert-body">
          <div class="alert-message">${escHtml(a.message)}</div>
          <div class="alert-action">${escHtml(a.actionTaken || '')}</div>
        </div>
        <div class="alert-time">${timeAgo(a.timestamp)}</div>
      </div>
    `;
  }).join('');
}

function handleNewAlert(alert) {
  alerts.unshift(alert);
  renderAlerts();
  log(`Alert: ${alert.message}`);
}

async function markAllAlertsRead() {
  alerts.forEach(a => { a.read = true; });
  // Update in storage via a direct set
  await chrome.storage.local.set({ [MONITOR_ALERTS]: alerts });
  chrome.action.setBadgeText({ text: '' });
  renderAlerts();
  log('All alerts marked as read');
}

async function clearAlerts() {
  alerts = [];
  await chrome.storage.local.set({ [MONITOR_ALERTS]: [] });
  chrome.action.setBadgeText({ text: '' });
  renderAlerts();
  log('Alerts cleared');
}

// ============================
// Progress
// ============================
function handleProgress(msg) {
  const section = $('#progress-section');
  const statsEl = $('#progress-stats');

  if (msg.status === 'running') {
    section.style.display = '';
    const pct = msg.total ? Math.round((msg.checked / msg.total) * 100) : 0;
    $('#progress-bar').style.width = pct + '%';
    $('#progress-text').textContent = `${msg.checked}/${msg.total} checked (${pct}%) | ${msg.changed || 0} changed | ${msg.errors || 0} errors`;

    // EcomSniper-inspired: show detailed progress stats
    if (statsEl) {
      statsEl.style.display = '';
      const processed = $('#prog-processed');
      const total = $('#prog-total');
      const changed = $('#prog-changed');
      const errors = $('#prog-errors');
      const unprocessed = $('#prog-unprocessed');
      if (processed) processed.textContent = msg.checked || 0;
      if (total) total.textContent = msg.total || 0;
      if (changed) changed.textContent = msg.changed || 0;
      if (errors) errors.textContent = msg.errors || 0;
      if (unprocessed) unprocessed.textContent = (msg.total || 0) - (msg.checked || 0) - (msg.skipped || 0);
    }

    // Show pause button when running
    const pauseBtn = $('#btn-pause-monitor');
    if (pauseBtn) pauseBtn.style.display = '';

    if (msg.lastProduct) log(`Checked: ${msg.lastProduct}`);
  } else if (msg.status === 'complete') {
    section.style.display = 'none';
    if (statsEl) statsEl.style.display = 'none';
    $('#btn-pause-monitor').style.display = 'none';
    $('#btn-resume-monitor').style.display = 'none';
    $('#stat-last-run').textContent = 'Just now';
    log(msg.message || 'Check cycle complete');
    // Reload products to reflect updated data
    loadProducts().then(() => {
      renderProducts($('#filter-products').value);
      updateStats();
    });
  } else if (msg.status === 'blocked') {
    section.style.display = '';
    $('#progress-bar').style.width = '100%';
    $('#progress-text').textContent = msg.message;
    log(msg.message);
  }
}

function handleCheckResult(msg) {
  // Update specific row in table if visible
  const row = document.querySelector(`tr[data-id="${msg.productId}"]`);
  if (row && msg.changed) {
    row.style.background = '#2a2a1e';
    setTimeout(() => { row.style.background = ''; }, 3000);
  }
}

// ============================
// Stats
// ============================
function updateStats() {
  const total = products.length;
  const inStock = products.filter(p => p.sourceInStock === true).length;
  const outStock = products.filter(p => p.sourceInStock === false).length;
  const errors = products.filter(p => p.status === 'error').length;
  const priceChanged = products.filter(p => p.lastChanged && p.changeCount > 0).length;

  $('#stat-total').textContent = total;
  $('#stat-in-stock').textContent = inStock;
  $('#stat-out-stock').textContent = outStock;
  $('#stat-price-changed').textContent = priceChanged;
  $('#stat-errors').textContent = errors;
}

// ============================
// Settings
// ============================
function populateSettingsForm() {
  $('#set-interval').value = settings.intervalMinutes || 30;
  $('#set-concurrency').value = settings.concurrency || 2;
  $('#set-delay').value = settings.delayBetweenMs || 3000;
  $('#set-oos-action').value = settings.stockOutOfStockAction || 'zero';
  $('#set-restock-qty').value = settings.stockRestockQuantity || 3;
  $('#set-auto-restock').checked = settings.stockAutoRestock || false;
  $('#set-price-auto').checked = settings.priceAutoUpdate !== false;
  $('#set-threshold').value = settings.priceChangeThresholdPct || 5;
  $('#set-markup-type').value = settings.priceMarkupType || 'percentage';
  $('#set-markup-value').value = settings.priceMarkupValue || 30;
  $('#set-fixed-increase').value = settings.priceFixedIncrease || 5;
  $('#set-min-profit').value = settings.priceMinProfit || 2;
  $('#set-rounding').value = settings.priceRounding || '99';
  $('#set-badge').checked = settings.alertBadge !== false;
  $('#set-notification').checked = settings.alertNotification !== false;

  // EcomSniper-inspired settings
  const reusableTabEl = $('#set-reusable-tab');
  if (reusableTabEl) reusableTabEl.checked = settings.useReusableTab !== false;
  const trackingTimeoutEl = $('#set-tracking-timeout');
  if (trackingTimeoutEl) trackingTimeoutEl.value = settings.trackingTimeout || 30000;

  // Toggle visibility
  $('#markup-pct-group').style.display = settings.priceMarkupType === 'percentage' ? '' : 'none';
  $('#markup-fixed-group').style.display = settings.priceMarkupType === 'fixed' ? '' : 'none';
  $('#variable-tiers-card').style.display = settings.priceMarkupType === 'variable' ? '' : 'none';

  // Render tiers
  renderTiers(settings.priceVariableTiers || DEFAULTS[MONITOR_SETTINGS].priceVariableTiers);
}

function renderTiers(tiers) {
  const container = $('#tiers-container');
  container.innerHTML = tiers.map((t, i) => `
    <div class="tier-row">
      <input type="number" class="tier-min" value="${t.min}" placeholder="Min $" min="0">
      <input type="number" class="tier-max" value="${t.max}" placeholder="Max $" min="0">
      <input type="number" class="tier-markup" value="${t.markup}" placeholder="Markup %" min="1">
      <button class="tier-remove" data-idx="${i}">X</button>
    </div>
  `).join('');

  container.querySelectorAll('.tier-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const rows = collectTiers();
      rows.splice(parseInt(btn.dataset.idx), 1);
      renderTiers(rows);
    });
  });

  // Add tier button
  const addBtn = $('#btn-add-tier');
  addBtn.onclick = () => {
    const rows = collectTiers();
    const lastMax = rows.length > 0 ? rows[rows.length - 1].max : 0;
    rows.push({ min: lastMax, max: lastMax + 50, markup: 30 });
    renderTiers(rows);
  };
}

function collectTiers() {
  const rows = $$('.tier-row');
  return Array.from(rows).map(row => ({
    min: parseFloat(row.querySelector('.tier-min').value) || 0,
    max: parseFloat(row.querySelector('.tier-max').value) || 99999,
    markup: parseFloat(row.querySelector('.tier-markup').value) || 30
  }));
}

async function saveSettings() {
  settings = {
    enabled: isRunning,
    intervalMinutes: parseInt($('#set-interval').value) || 30,
    concurrency: parseInt($('#set-concurrency').value) || 2,
    delayBetweenMs: parseInt($('#set-delay').value) || 3000,
    stockOutOfStockAction: $('#set-oos-action').value,
    stockRestockQuantity: parseInt($('#set-restock-qty').value) || 3,
    stockAutoRestock: $('#set-auto-restock').checked,
    priceAutoUpdate: $('#set-price-auto').checked,
    priceChangeThresholdPct: parseInt($('#set-threshold').value) || 5,
    priceMarkupType: $('#set-markup-type').value,
    priceMarkupValue: parseInt($('#set-markup-value').value) || 30,
    priceFixedIncrease: parseFloat($('#set-fixed-increase').value) || 5,
    priceVariableTiers: collectTiers(),
    priceMinProfit: parseFloat($('#set-min-profit').value) || 2,
    priceRounding: $('#set-rounding').value,
    alertBadge: $('#set-badge').checked,
    alertNotification: $('#set-notification').checked,
    // EcomSniper-inspired settings
    useReusableTab: $('#set-reusable-tab')?.checked !== false,
    trackingTimeout: parseInt($('#set-tracking-timeout')?.value) || 30000
  };

  const resp = await sendMsg(SAVE_MONITOR_SETTINGS, { settings });
  if (resp?.success) {
    const confirm = $('#settings-saved');
    confirm.style.display = '';
    setTimeout(() => { confirm.style.display = 'none'; }, 2000);
    log('Settings saved');
  }
}

// ============================
// Export CSV
// ============================
function exportCsv() {
  if (products.length === 0) return log('No products to export');

  const header = 'Source Type,Source URL,Source ID,Source Price,In Stock,eBay Item ID,eBay Domain,eBay Title,eBay Price,Margin,Last Checked,Status\n';
  const rows = products.map(p => {
    const margin = p.ebayPrice && p.sourcePrice ? (p.ebayPrice - p.sourcePrice).toFixed(2) : '';
    return [
      p.sourceType, p.sourceUrl, p.sourceId, p.sourcePrice,
      p.sourceInStock, p.ebayItemId, p.ebayDomain,
      `"${(p.ebayTitle || '').replace(/"/g, '""')}"`,
      p.ebayPrice, margin, p.lastChecked || '', p.status
    ].join(',');
  }).join('\n');

  const blob = new Blob([header + rows], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dropflow-monitor-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  log(`Exported ${products.length} products to CSV`);
}

// ============================
// Bulk Delete Unlinked Products
// ============================
async function deleteUnlinkedProducts() {
  const unlinked = products.filter(p => !p.sourceUrl);
  if (unlinked.length === 0) return log('No unlinked products to delete');

  if (!confirm(`Delete ${unlinked.length} unlinked product(s) from tracking?\n\nThis removes them from the monitor only — it does NOT affect your eBay listings.`)) return;

  let deleted = 0;
  for (const p of unlinked) {
    const resp = await sendMsg(REMOVE_TRACKED_PRODUCT, { productId: p.id });
    if (resp?.success) deleted++;
  }

  products = products.filter(p => !!p.sourceUrl);
  renderProducts($('#filter-products').value);
  renderUnlinkedProducts();
  updateStats();
  log(`Deleted ${deleted} unlinked products`);
}

// ============================
// Edit / Link Modal
// ============================
window._editProduct = (productId) => {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  editingProductId = productId;
  $('#edit-source-url').value = product.sourceUrl || '';
  $('#edit-ebay-title').value = product.ebayTitle || '';
  $('#edit-ebay-price').value = product.ebayPrice || '';
  $('#edit-ebay-item-id').textContent = product.ebayItemId;
  $('#edit-source-type').textContent = product.sourceType || 'Not set';
  $('#edit-modal-title').textContent = product.sourceUrl ? 'Edit Tracked Product' : 'Link Source to Product';
  detectSourceType(product.sourceUrl || '');
  $('#edit-modal').style.display = '';
};

function detectSourceType(url) {
  const hint = $('#edit-source-detected');
  if (!url) { hint.textContent = ''; return; }
  if (url.includes('amazon.')) {
    const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/i) || url.match(/\/gp\/product\/([A-Z0-9]{10})/i);
    hint.textContent = asinMatch ? `Amazon ASIN: ${asinMatch[1]}` : 'Amazon URL detected';
    hint.style.color = '#ff9800';
  } else if (url.includes('aliexpress.')) {
    const idMatch = url.match(/\/item\/(?:[^/]+\/)?(\d+)\.html/);
    hint.textContent = idMatch ? `AliExpress ID: ${idMatch[1]}` : 'AliExpress URL detected';
    hint.style.color = '#e53935';
  } else {
    hint.textContent = 'URL must be Amazon or AliExpress';
    hint.style.color = '#f44336';
  }
}

async function saveEditProduct() {
  if (!editingProductId) return;

  const sourceUrl = $('#edit-source-url').value.trim();
  const ebayTitle = $('#edit-ebay-title').value.trim();
  const ebayPrice = parseFloat($('#edit-ebay-price').value) || 0;

  const updates = { ebayTitle, ebayPrice };

  if (sourceUrl) {
    const isAli = sourceUrl.includes('aliexpress.');
    updates.sourceUrl = sourceUrl;
    updates.sourceType = isAli ? 'aliexpress' : 'amazon';
    if (isAli) {
      const match = sourceUrl.match(/\/item\/(?:[^/]+\/)?(\d+)\.html/);
      if (match) updates.sourceId = match[1];
      updates.sourceDomain = 'aliexpress';
    } else {
      const asinMatch = sourceUrl.match(/\/dp\/([A-Z0-9]{10})/i) || sourceUrl.match(/\/gp\/product\/([A-Z0-9]{10})/i);
      if (asinMatch) updates.sourceId = asinMatch[1].toUpperCase();
      const domainMatch = sourceUrl.match(/amazon\.([a-z.]+)\//);
      updates.sourceDomain = domainMatch ? domainMatch[1] : 'com';
    }
  } else {
    updates.sourceUrl = '';
    updates.sourceType = '';
    updates.sourceId = '';
    updates.sourceDomain = '';
  }

  const resp = await sendMsg(UPDATE_TRACKED_PRODUCT, { productId: editingProductId, updates });
  if (resp?.success) {
    const idx = products.findIndex(p => p.id === editingProductId);
    if (idx !== -1) Object.assign(products[idx], updates);
    renderProducts($('#filter-products').value);
    renderUnlinkedProducts();
    updateStats();
    closeEditModal();
    log(`Updated: ${ebayTitle || editingProductId}`);
  } else {
    log('Error: ' + (resp?.error || 'Failed to save'));
  }
}

function closeEditModal() {
  $('#edit-modal').style.display = 'none';
  editingProductId = null;
}

// ============================
// Bulk SKU Backfiller
// ============================
function renderUnlinkedProducts() {
  const container = $('#unlinked-products-list');
  if (!container) return;

  const unlinked = products.filter(p => !p.sourceUrl);

  if (unlinked.length === 0) {
    container.innerHTML = '<div class="empty-state">All products are linked! No backfill needed.</div>';
    return;
  }

  container.innerHTML = unlinked.map(p => `
    <div class="unlinked-item">
      <input type="checkbox" class="backfill-check" value="${p.id}" data-item-id="${p.ebayItemId}" data-domain="${p.ebayDomain || 'com'}">
      <label>${escHtml(p.ebayTitle || 'Untitled')}</label>
      <span class="item-id">${p.ebayItemId}</span>
    </div>
  `).join('');
}

async function startBackfill() {
  const activeTab = document.querySelector('[data-backfill-tab].active');
  const mode = activeTab ? activeTab.dataset.backfillTab : 'select-products';
  let items = [];

  if (mode === 'select-products') {
    const asin = $('#backfill-asin-input').value.trim();
    if (!asin) return log('Error: Enter an ASIN / Source ID');

    const checked = $$('.backfill-check:checked');
    if (checked.length === 0) return log('Error: Select at least one product');

    items = Array.from(checked).map(cb => {
      const isAli = /^\d{10,}$/.test(asin);
      const domain = cb.dataset.domain || 'com';
      const amazonDomain = EBAY_TO_AMAZON_DOMAIN[domain] || 'www.amazon.com';
      const sourceUrl = isAli
        ? `https://www.aliexpress.com/item/${asin}.html`
        : `https://${amazonDomain}/dp/${asin}`;
      return {
        productId: cb.value,
        ebayItemId: cb.dataset.itemId,
        ebayDomain: domain,
        customLabel: asin,
        sourceUrl
      };
    });
  } else {
    const csv = $('#backfill-csv-input').value.trim();
    if (!csv) return log('Error: Paste CSV data');

    const lines = csv.split('\n').filter(l => l.trim());
    items = lines.map(line => {
      const parts = line.split(',').map(s => s.trim());
      const ebayItemId = parts[0];
      const customLabel = parts[1];
      if (!ebayItemId || !customLabel) return null;

      const product = products.find(p => p.ebayItemId === ebayItemId);
      const ebayDomain = product?.ebayDomain || 'com';
      const isAli = /^\d{10,}$/.test(customLabel);
      const amazonDomain = EBAY_TO_AMAZON_DOMAIN[ebayDomain] || 'www.amazon.com';
      const sourceUrl = isAli
        ? `https://www.aliexpress.com/item/${customLabel}.html`
        : `https://${amazonDomain}/dp/${customLabel}`;

      return {
        productId: product?.id || null,
        ebayItemId,
        ebayDomain,
        customLabel,
        sourceUrl
      };
    }).filter(Boolean);

    if (items.length === 0) return log('Error: No valid CSV rows found');
  }

  const concurrency = parseInt($('#backfill-concurrency').value) || 1;
  const delayMs = parseInt($('#backfill-delay').value) || 3000;

  log(`Starting SKU backfill for ${items.length} items (concurrency: ${concurrency}, delay: ${delayMs}ms)...`);

  const resp = await sendMsg(START_SKU_BACKFILL, { items, concurrency, delayMs });
  if (resp?.error) {
    log('Error: ' + resp.error);
    return;
  }

  // Show progress UI
  $('#btn-start-backfill').style.display = 'none';
  $('#btn-pause-backfill').style.display = '';
  $('#btn-stop-backfill').style.display = '';
  $('#backfill-progress').style.display = '';
  $('#backfill-log').style.display = '';
  $('#backfill-log').innerHTML = '';
}

function handleBackfillProgress(msg) {
  const pct = msg.total ? Math.round((msg.current / msg.total) * 100) : 0;
  $('#backfill-progress-bar').style.width = pct + '%';
  $('#backfill-progress-text').textContent = `${msg.current}/${msg.total} | ${msg.successCount} success | ${msg.failCount} failed`;

  if (msg.result) {
    const logLine = document.createElement('div');
    const color = msg.result.status === 'success' ? '#4caf50' : '#f44336';
    logLine.innerHTML = `<span style="color:${color}">[${msg.result.status}]</span> ${escHtml(msg.result.ebayItemId)}: ${escHtml(msg.result.message)}`;
    $('#backfill-log').appendChild(logLine);
    $('#backfill-log').scrollTop = $('#backfill-log').scrollHeight;
  }
}

function handleBackfillComplete(msg) {
  log(`SKU backfill complete: ${msg.successCount} success, ${msg.failCount} failed out of ${msg.total}`);
  resetBackfillUI();
  loadProducts().then(() => {
    renderProducts($('#filter-products').value);
    renderUnlinkedProducts();
    updateStats();
  });
}

function resetBackfillUI() {
  $('#btn-start-backfill').style.display = '';
  $('#btn-pause-backfill').style.display = 'none';
  $('#btn-stop-backfill').style.display = 'none';
}

// ============================
// Bulk Link (Local Only)
// ============================
async function applyBulkLinks() {
  const csv = $('#bulk-link-csv').value.trim();
  const resultEl = $('#bulk-link-result');
  if (!csv) { resultEl.textContent = 'No data to apply'; resultEl.style.display = ''; return; }

  const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
  let linked = 0;
  let skipped = 0;

  for (const line of lines) {
    const parts = line.split(',').map(s => s.trim());
    if (parts.length < 2) { skipped++; continue; }

    const [ebayItemId, sourceUrl] = parts;
    if (!ebayItemId || !sourceUrl) { skipped++; continue; }

    // Find matching product
    const product = products.find(p => p.ebayItemId === ebayItemId);
    if (!product) { skipped++; log(`Bulk link: No product found for eBay ID ${ebayItemId}`); continue; }

    // Parse source URL
    const isAli = sourceUrl.includes('aliexpress.');
    const updates = { sourceUrl, sourceType: isAli ? 'aliexpress' : 'amazon' };

    if (isAli) {
      const match = sourceUrl.match(/\/item\/(?:[^/]+\/)?(\d+)\.html/);
      if (match) updates.sourceId = match[1];
      updates.sourceDomain = 'aliexpress';
    } else {
      const asinMatch = sourceUrl.match(/\/dp\/([A-Z0-9]{10})/i) || sourceUrl.match(/\/gp\/product\/([A-Z0-9]{10})/i);
      if (asinMatch) updates.sourceId = asinMatch[1].toUpperCase();
      const domainMatch = sourceUrl.match(/amazon\.([a-z.]+)\//);
      updates.sourceDomain = domainMatch ? domainMatch[1] : 'com';
    }

    await sendMsg(UPDATE_TRACKED_PRODUCT, { productId: product.id, updates });
    // Update local state
    Object.assign(product, updates);
    linked++;
  }

  resultEl.textContent = `Linked ${linked} products${skipped ? `, ${skipped} skipped` : ''}`;
  resultEl.style.display = '';
  log(`Bulk link: ${linked} linked, ${skipped} skipped`);

  renderProducts($('#filter-products').value);
  renderUnlinkedProducts();
  updateStats();

  setTimeout(() => { resultEl.style.display = 'none'; }, 5000);
}

// ============================
// CSV Import (EcomSniper-inspired)
// ============================
// EcomSniper uses CSV-based tracking: user downloads active listings CSV from eBay,
// which contains customLabel fields with base64-encoded Amazon ASINs.
// We parse the CSV client-side and send rows to the service worker for import.

async function handleCsvImport() {
  const fileInput = $('#csv-file-input');
  const file = fileInput?.files?.[0];
  if (!file) return log('No CSV file selected');

  const domain = $('#csv-import-domain')?.value || 'com.au';
  const progressEl = $('#csv-import-progress');
  progressEl.style.display = '';
  $('#csv-progress-text').textContent = 'Parsing CSV...';

  try {
    const text = await file.text();
    const rows = parseCsv(text);

    if (rows.length === 0) {
      log('No valid rows found in CSV');
      progressEl.style.display = 'none';
      return;
    }

    log(`Parsed ${rows.length} rows from CSV. Importing...`);
    $('#csv-progress-text').textContent = `Importing ${rows.length} products...`;

    const resp = await sendMsg(IMPORT_CSV_PRODUCTS, { rows, domain });

    if (resp?.success) {
      log(`CSV import: ${resp.added} added, ${resp.updated} updated, ${resp.skipped} skipped`);
      await loadProducts();
      renderProducts();
      renderUnlinkedProducts();
      updateStats();
    } else {
      log('CSV import error: ' + (resp?.error || 'Unknown error'));
    }
  } catch (e) {
    log('CSV parse error: ' + e.message);
  } finally {
    progressEl.style.display = 'none';
  }
}

/**
 * Parse CSV text into an array of row objects.
 * Handles eBay's standard CSV format and various header naming conventions.
 */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Parse header row
  const headers = parseCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length < 2) continue;

    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = values[idx] || '';
    });

    // Map common eBay CSV field names to our format
    rows.push({
      itemId: row['Item number'] || row['Item ID'] || row['ItemID'] || row['Listing ID'] || '',
      title: row['Title'] || row['Item title'] || row['Listing title'] || '',
      customLabel: row['Custom label'] || row['Custom Label'] || row['SKU'] || row['customLabel'] || '',
      price: row['Price'] || row['Current price'] || row['Start price'] || row['Buy It Now price'] || '',
      quantity: row['Available quantity'] || row['Quantity'] || row['Quantity available'] || ''
    });
  }

  return rows.filter(r => r.itemId);
}

/**
 * Parse a single CSV line, handling quoted fields with commas.
 */
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function handleCsvImportProgress(msg) {
  const pct = msg.total ? Math.round((msg.processed / msg.total) * 100) : 0;
  $('#csv-progress-bar').style.width = pct + '%';
  $('#csv-progress-text').textContent = `${msg.processed}/${msg.total} — ${msg.added} added, ${msg.updated} updated`;
}

function handleCsvImportComplete(msg) {
  $('#csv-import-progress').style.display = 'none';
  log(`CSV import complete: ${msg.added} added, ${msg.updated} updated, ${msg.skipped} skipped`);
  loadProducts().then(() => {
    renderProducts();
    renderUnlinkedProducts();
    updateStats();
  });
}

// ============================
// Utilities
// ============================
function sendMsg(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload }).catch(e => ({ error: e.message }));
}

function log(text) {
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function timeAgo(iso) {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ============================
// Page-Based Tracker (EcomSniper-style)
// ============================
let trackerIsRunning = false;

async function initTracker() {
  const resp = await sendMsg(GET_TRACKER_SETTINGS);
  if (resp?.success) {
    populateTrackerForm(resp.settings);
    trackerIsRunning = resp.running;
    updateTrackerUI(resp.running);
    if (resp.page) $('#trk-current-page').value = resp.page;
    if (resp.position) $('#trk-current-position').value = resp.position;
    if (resp.totalPages) $('#trk-total-pages').textContent = resp.totalPages;
    // Populate logs
    if (resp.logs && resp.logs.length > 0) {
      const container = $('#tracker-log-container');
      for (const entry of resp.logs.slice(-200)) {
        appendTrackerLog(container, entry);
      }
    }
  }

  // Event listeners
  $('#btn-start-tracker').addEventListener('click', startTracker);
  $('#btn-stop-tracker').addEventListener('click', stopTracker);
  $('#btn-reset-tracker').addEventListener('click', resetTracker);
  $('#btn-save-tracker-settings').addEventListener('click', saveTrackerSettings);
  $('#btn-toggle-tracker-logs').addEventListener('click', () => {
    const container = $('#tracker-log-container');
    const btn = $('#btn-toggle-tracker-logs');
    if (container.style.display === 'none') {
      container.style.display = '';
      btn.textContent = 'Hide Logs';
    } else {
      container.style.display = 'none';
      btn.textContent = 'Show Logs';
    }
  });
}

function populateTrackerForm(s) {
  $('#trk-stock-enable').checked = s.enableStockMonitor !== false;
  $('#trk-price-enable').checked = s.enablePriceMonitor !== false;
  $('#trk-prime-filter').value = s.primeFilter || 'all';
  $('#trk-restock-qty').value = s.restockQuantity || 1;
  $('#trk-force-restock').checked = s.forceRestock || false;
  $('#trk-force-restock-qty').value = s.forceRestockQty || 1;
  $('#trk-pricing-option').value = s.pricingOption || 'markup';
  $('#trk-markup-pct').value = s.markupPercentage || 100;
  $('#trk-price-threshold').value = s.priceTriggerThreshold || 2;
  $('#trk-price-ending').value = s.priceEndingFilter || '';
  $('#trk-prune-no-sku').checked = s.pruneNoSku || false;
  $('#trk-prune-no-sku-action').value = s.pruneNoSkuAction || 'oos';
  $('#trk-prune-broken-sku').checked = s.pruneBrokenSku || false;
  $('#trk-prune-broken-sku-action').value = s.pruneBrokenSkuAction || 'oos';
  $('#trk-prune-not-found').checked = s.pruneNotFound || false;
  $('#trk-prune-not-found-action').value = s.pruneNotFoundAction || 'oos';
  $('#trk-prune-sku-changed').checked = s.pruneSkuChanged || false;
  $('#trk-prune-sku-changed-action').value = s.pruneSkuChangedAction || 'oos';
  $('#trk-prune-no-sales').checked = s.pruneNoSales || false;
  $('#trk-prune-no-sales-action').value = s.pruneNoSalesAction || 'oos';
  $('#trk-prune-no-sales-count').value = s.pruneNoSalesCount || 0;
  $('#trk-prune-no-sales-days').value = s.pruneNoSalesDays || 30;
  $('#trk-continuous').checked = s.continuousTracking || false;
  $('#trk-timeout').value = s.trackingTimeout || 60;
  $('#trk-log-data').checked = s.logData !== false;
  $('#trk-pin-tabs').checked = s.pinTabs !== false;
  $('#trk-keep-ebay-open').checked = s.keepEbayPageOpen || false;
  $('#trk-ebay-domain').value = s.ebayDomain || 'com.au';
  $('#trk-amazon-domain').value = s.amazonDomain || 'com.au';
  $('#trk-oos-action').value = s.oosAction || 'zero';
}

function collectTrackerSettings() {
  return {
    enableStockMonitor: $('#trk-stock-enable').checked,
    enablePriceMonitor: $('#trk-price-enable').checked,
    primeFilter: $('#trk-prime-filter').value,
    restockQuantity: parseInt($('#trk-restock-qty').value) || 1,
    forceRestock: $('#trk-force-restock').checked,
    forceRestockQty: parseInt($('#trk-force-restock-qty').value) || 1,
    pricingOption: $('#trk-pricing-option').value,
    markupPercentage: parseInt($('#trk-markup-pct').value) || 100,
    priceTriggerThreshold: parseFloat($('#trk-price-threshold').value) || 2,
    priceEndingFilter: $('#trk-price-ending').value.trim(),
    pruneNoSku: $('#trk-prune-no-sku').checked,
    pruneNoSkuAction: $('#trk-prune-no-sku-action').value,
    pruneBrokenSku: $('#trk-prune-broken-sku').checked,
    pruneBrokenSkuAction: $('#trk-prune-broken-sku-action').value,
    pruneNotFound: $('#trk-prune-not-found').checked,
    pruneNotFoundAction: $('#trk-prune-not-found-action').value,
    pruneSkuChanged: $('#trk-prune-sku-changed').checked,
    pruneSkuChangedAction: $('#trk-prune-sku-changed-action').value,
    pruneNoSales: $('#trk-prune-no-sales').checked,
    pruneNoSalesAction: $('#trk-prune-no-sales-action').value,
    pruneNoSalesCount: parseInt($('#trk-prune-no-sales-count').value) || 0,
    pruneNoSalesDays: parseInt($('#trk-prune-no-sales-days').value) || 30,
    continuousTracking: $('#trk-continuous').checked,
    trackingTimeout: parseInt($('#trk-timeout').value) || 60,
    logData: $('#trk-log-data').checked,
    pinTabs: $('#trk-pin-tabs').checked,
    keepEbayPageOpen: $('#trk-keep-ebay-open').checked,
    ebayDomain: $('#trk-ebay-domain').value,
    amazonDomain: $('#trk-amazon-domain').value,
    oosAction: $('#trk-oos-action').value,
    itemsPerPage: 200
  };
}

async function saveTrackerSettings() {
  const settings = collectTrackerSettings();
  // Also save page/position overrides
  const page = parseInt($('#trk-current-page').value) || 1;
  const position = parseInt($('#trk-current-position').value) || 1;
  await sendMsg(SAVE_TRACKER_SETTINGS, { settings });
  await chrome.storage.local.set({ trackerPage: page, trackerPosition: position });
  const confirm = $('#tracker-settings-saved');
  confirm.style.display = '';
  setTimeout(() => { confirm.style.display = 'none'; }, 2000);
  log('Tracker settings saved');
}

async function startTracker() {
  // Save settings first
  const settings = collectTrackerSettings();
  await sendMsg(SAVE_TRACKER_SETTINGS, { settings });
  
  const resp = await sendMsg(START_TRACKING);
  if (resp?.error) {
    log('Tracker error: ' + resp.error);
  } else {
    trackerIsRunning = true;
    updateTrackerUI(true);
    log('Tracker started');
  }
}

async function stopTracker() {
  const resp = await sendMsg(STOP_TRACKING);
  if (resp?.success) {
    trackerIsRunning = false;
    updateTrackerUI(false);
    log('Tracker stopped');
  }
}

async function resetTracker() {
  const resp = await sendMsg(RESET_TRACKING);
  if (resp?.success) {
    $('#trk-current-page').value = 1;
    $('#trk-current-position').value = 1;
    log('Tracker position reset to page 1, position 1');
  }
}

function updateTrackerUI(running) {
  trackerIsRunning = running;
  const startBtn = $('#btn-start-tracker');
  const stopBtn = $('#btn-stop-tracker');
  const badge = $('#tracker-status-badge');
  const overlay = $('#tracker-progress-overlay');

  if (running) {
    startBtn.style.display = 'none';
    stopBtn.style.display = '';
    badge.textContent = 'Running';
    badge.className = 'badge badge-running';
    overlay.style.display = '';
  } else {
    startBtn.style.display = '';
    stopBtn.style.display = 'none';
    badge.textContent = 'Stopped';
    badge.className = 'badge badge-stopped';
    overlay.style.display = 'none';
  }
}

function handleTrackerProgress(msg) {
  const overlay = $('#tracker-progress-overlay');
  overlay.style.display = '';

  // Item progress
  const itemPct = msg.totalOnPage > 0 ? Math.round((msg.position / msg.totalOnPage) * 100) : 0;
  $('#trk-item-bar').style.width = itemPct + '%';
  $('#trk-item-text').textContent = `Item ${msg.position} of ${msg.totalOnPage} (${itemPct}%)`;

  // Page progress
  const pagePct = msg.totalPages > 0 ? Math.round((msg.page / msg.totalPages) * 100) : 0;
  $('#trk-page-bar').style.width = pagePct + '%';
  $('#trk-page-text').textContent = `Page ${msg.page} of ${msg.totalPages} (${pagePct}%)`;

  // Current item
  if (msg.itemTitle) {
    $('#trk-current-item').textContent = `${msg.itemId}: ${msg.itemTitle}`;
  }

  // Update position inputs
  $('#trk-current-page').value = msg.page;
  $('#trk-current-position').value = msg.position;
  $('#trk-total-pages').textContent = msg.totalPages;
  $('#trk-total-on-page').textContent = msg.totalOnPage;
}

function handleTrackerLogEntry(entry) {
  const container = $('#tracker-log-container');
  appendTrackerLog(container, entry);
}

function appendTrackerLog(container, entry) {
  const line = document.createElement('div');
  const time = new Date(entry.timestamp).toLocaleTimeString();
  line.textContent = `[${time}] ${entry.message}`;
  if (entry.level === 'warn') line.className = 'log-warn';
  if (entry.level === 'error') line.className = 'log-error';
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

// ============================
// Boot
// ============================
init();
initTracker();
