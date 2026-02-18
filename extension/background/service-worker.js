/**
 * DropFlow Background Service Worker
 * Central message router and orchestrator for all extension features.
 */

import { api } from '../lib/api-client.js';
import {
  SCRAPE_AMAZON_PRODUCT, AMAZON_PRODUCT_DATA,
  SCRAPE_ALIEXPRESS_PRODUCT, ALIEXPRESS_PRODUCT_DATA,
  FILL_EBAY_FORM, EBAY_FORM_FILLED,
  READ_EBAY_LISTING, EBAY_LISTING_DATA,
  START_BULK_LISTING, PAUSE_BULK_LISTING, RESUME_BULK_LISTING, TERMINATE_BULK_LISTING,
  BULK_LISTING_PROGRESS, BULK_LISTING_RESULT, BULK_LISTING_COMPLETE,
  START_ALI_BULK_LISTING, PAUSE_ALI_BULK_LISTING, RESUME_ALI_BULK_LISTING, TERMINATE_ALI_BULK_LISTING,
  ALI_BULK_LISTING_PROGRESS, ALI_BULK_LISTING_RESULT, ALI_BULK_LISTING_COMPLETE,
  GENERATE_TITLES, BUILD_SEO_TITLE,
  END_LOW_PERFORMERS, SELL_SIMILAR, BULK_REVISE, SEND_OFFERS, REVIEW_OFFERS,
  BOOST_PROGRESS, BOOST_COMPLETE, SCHEDULE_BOOST, CANCEL_SCHEDULE,
  CANCEL_BOOST, SCRAPE_ACTIVE_LISTINGS_FULL,
  RESEARCH_COMPETITOR, STOP_RESEARCH, COMPETITOR_PROGRESS, COMPETITOR_COMPLETE,
  ASK_CHATGPT,
  GENERATE_DESCRIPTION,
  GENERATE_ITEM_SPECIFICS,
  GET_EBAY_HEADERS,
  FETCH_IMAGE,
  UPLOAD_EBAY_IMAGE,
  GET_SETTINGS, SAVE_SETTINGS,
  OPEN_PAGE,
  ADD_TRACKED_PRODUCT, REMOVE_TRACKED_PRODUCT, UPDATE_TRACKED_PRODUCT, GET_TRACKED_PRODUCTS,
  START_MONITOR, STOP_MONITOR, CHECK_PRODUCT_NOW,
  MONITOR_CHECK_RESULT, MONITOR_PROGRESS, MONITOR_ALERT,
  GET_MONITOR_SETTINGS, SAVE_MONITOR_SETTINGS,
  SCRAPE_ACTIVE_LISTINGS,
  START_SKU_BACKFILL, PAUSE_SKU_BACKFILL, TERMINATE_SKU_BACKFILL,
  SKU_BACKFILL_PROGRESS, SKU_BACKFILL_COMPLETE,
  REVISE_EBAY_LISTING,
  GET_PENDING_ORDERS, GET_ALL_ORDERS, CREATE_ORDER, UPDATE_ORDER_STATUS,
  CANCEL_ORDER, START_AUTO_ORDER, AUTO_ORDER_PROGRESS, AUTO_ORDER_READY,
  CONFIRM_ORDER_PAYMENT, GET_AUTO_ORDER_SETTINGS, SAVE_AUTO_ORDER_SETTINGS,
  START_SALE_POLLING, STOP_SALE_POLLING, POLL_SALES_NOW, SALE_POLL_STATUS
} from '../lib/message-types.js';

import {
  BACKEND_URL,
  BOOST_SCHEDULE,
  COMPETITOR_SCAN_POSITION,
  DEFAULT_LISTING_TYPE, DEFAULT_THREAD_COUNT, PRICE_MARKUP,
  DEFAULTS,
  TRACKED_PRODUCTS, MONITOR_SETTINGS, MONITOR_ALERTS,
  MONITOR_RUNNING, MONITOR_LAST_RUN, MONITOR_STATS,
  MONITOR_POSITION, MONITOR_SOFT_BLOCK,
  AUTO_ORDERS, AUTO_ORDER_SETTINGS
} from '../lib/storage-keys.js';

import {
  getOrders, createOrder as createAutoOrder, updateOrder, cancelOrder as cancelAutoOrderFn,
  getPendingOrders, executeAutoOrder, confirmOrderPayment,
  getAutoOrderSettings, saveAutoOrderSettings
} from '../lib/auto-order.js';

import {
  runSalePollCycle, startSalePolling, stopSalePolling,
  SALE_POLL_ALARM, SALE_POLL_LAST_RUN, SALE_POLL_STATS
} from '../lib/sale-poller.js';

import {
  createTabAndWait, extractAmazonDomain, amazonToEbayDomain, semaphore,
  sleep, uid, extractAsin, extractAliExpressProductId, formatPrice
} from '../lib/utils.js';

// Storage key for temporary Amazon product data (keyed by tab ID)
const AMAZON_DATA_MAP = '_amazonData';

// ============================
// eBay Draft API Header Interception
// ============================
// Stores captured eBay listing draft headers per tab (tabId → { headers, draftId, mediaUploadUrl })
const ebayHeadersMap = new Map();

// Headers we need from eBay's own requests to their draft API
const HEADERS_TO_CAPTURE = [
  'authorization', 'x-ebay-c-marketplace-id', 'x-ebay-c-enduserctx',
  'x-csrf-token', 'content-type', 'x-ebay-c-complexity'
];

// Listen for eBay's own requests to the listing draft API and capture auth headers
try {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      if (!details.requestHeaders || !details.tabId || details.tabId < 0) return;

      const captured = {};
      for (const header of details.requestHeaders) {
        if (HEADERS_TO_CAPTURE.includes(header.name.toLowerCase())) {
          captured[header.name] = header.value;
        }
      }

      // Extract draft ID from URL: /lstng/api/listing_draft/{draftId}
      const draftMatch = details.url.match(/listing_draft\/([^/?]+)/);
      const draftId = draftMatch ? draftMatch[1] : null;

      // Capture the exact media upload URL if this is a media/image upload request
      const isMediaUpload = details.url.includes('/sell/media') ||
                            details.url.includes('/upload') ||
                            details.url.includes('/image');

      if (Object.keys(captured).length > 0) {
        const existing = ebayHeadersMap.get(details.tabId) || {};
        const entry = {
          headers: captured,
          draftId: draftId || existing.draftId,
          url: details.url
        };
        // Preserve and update media upload URL when we see one
        if (isMediaUpload && details.method === 'POST') {
          entry.mediaUploadUrl = details.url;
          console.log(`[DropFlow] Captured eBay media upload URL for tab ${details.tabId}: ${details.url}`);
        } else if (existing.mediaUploadUrl) {
          entry.mediaUploadUrl = existing.mediaUploadUrl;
        }
        ebayHeadersMap.set(details.tabId, entry);
        console.log(`[DropFlow] Captured eBay headers for tab ${details.tabId}, draftId: ${entry.draftId}`);
      }
    },
    {
      urls: [
        'https://www.ebay.com/lstng/*',
        'https://www.ebay.ca/lstng/*',
        'https://www.ebay.co.uk/lstng/*',
        'https://www.ebay.com.au/lstng/*',
        'https://www.ebay.de/lstng/*',
        'https://www.ebay.fr/lstng/*',
        'https://www.ebay.it/lstng/*',
        'https://www.ebay.es/lstng/*',
        'https://www.ebay.nl/lstng/*',
        // Also capture image upload endpoints
        'https://www.ebay.com/sell/media/*',
        'https://www.ebay.ca/sell/media/*',
        'https://www.ebay.co.uk/sell/media/*',
        'https://www.ebay.com.au/sell/media/*',
        'https://www.ebay.de/sell/media/*',
        'https://www.ebay.fr/sell/media/*',
        'https://www.ebay.it/sell/media/*',
        'https://www.ebay.es/sell/media/*',
        'https://www.ebay.nl/sell/media/*'
      ]
    },
    ['requestHeaders']
  );
} catch (e) {
  console.warn('[DropFlow] webRequest listener setup failed (permission may not be active yet):', e.message);
}

// ============================
// State
// ============================
let bulkPosterRunning = false;
let bulkPosterPaused = false;
let bulkPosterAbort = false;
let competitorRunning = false;
let competitorAbort = false;
let aliBulkRunning = false;
let aliBulkPaused = false;
let aliBulkAbort = false;
let monitorCycleRunning = false;
let skuBackfillRunning = false;
let skuBackfillPaused = false;
let skuBackfillAbort = false;

const MONITOR_ALARM_NAME = 'dropflow-monitor';

// ============================
// Keep-Alive for long-running operations (MV3 SW workaround)
// Uses chrome.alarms (fires every ~30s) + extension page port connections.
// The SW goes dormant after ~30s of inactivity in MV3; these mechanisms prevent that.
// ============================
const KEEPALIVE_ALARM = 'dropflow-keepalive';
let keepAliveActive = false;
const KEEPALIVE_IDLE_GRACE_MS = 180000; // keep SW alive 3 minutes after last image/listing activity
let lastKeepAliveActivityAt = 0;

function touchKeepAliveActivity(reason = '') {
  lastKeepAliveActivityAt = Date.now();
  if (reason) console.log(`[DropFlow] Keep-alive touch: ${reason}`);
}

let keepAliveTimer = null;
let keepAliveLockResolver = null;

async function startSWKeepAlive() {
  if (keepAliveActive) { touchKeepAliveActivity('start-already-active'); return; }
  keepAliveActive = true;
  touchKeepAliveActivity('start');

  // Strategy 1: Offscreen document — most reliable MV3 keep-alive.
  // The offscreen page sends periodic messages which keep the SW alive.
  try {
    if (chrome.offscreen) {
      await chrome.offscreen.createDocument({
        url: 'pages/offscreen/keepalive.html',
        reasons: ['WORKERS'],
        justification: 'Keep service worker alive during bulk listing operations'
      });
      console.log('[DropFlow] SW keep-alive: Offscreen document created');
    }
  } catch (e) {
    // Document may already exist, or offscreen API not available
    if (!e.message?.includes('already exists')) {
      console.warn('[DropFlow] Offscreen create failed:', e.message);
    }
  }

  // Strategy 2: Web Lock — holds the SW alive indefinitely (Chrome 114+)
  if (typeof navigator !== 'undefined' && navigator.locks) {
    navigator.locks.request('dropflow-keepalive-lock', { mode: 'exclusive' }, () => {
      return new Promise(resolve => {
        keepAliveLockResolver = resolve;
        console.log('[DropFlow] SW keep-alive: Web Lock acquired');
      });
    });
  }

  // Strategy 3: Alarm — 25s interval (just under MV3's 30s kill threshold)
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 25 / 60 });

  // Strategy 4: setInterval heartbeat (every 5s - ultra-aggressive for managed browsers)
  keepAliveTimer = setInterval(() => {
    chrome.runtime.getPlatformInfo().then(() => {});
    // Also ping storage to keep the event loop active
    chrome.storage.local.get('__keepalive_ts').then(() => {});
  }, 5000);

  console.log('[DropFlow] SW keep-alive started (offscreen + lock + alarm + interval)');
}

async function stopSWKeepAlive() {
  if (!keepAliveActive) return;
  keepAliveActive = false;

  // Close offscreen document
  try {
    if (chrome.offscreen) {
      await chrome.offscreen.closeDocument();
      console.log('[DropFlow] SW keep-alive: Offscreen document closed');
    }
  } catch (_) {}

  // Release Web Lock
  if (keepAliveLockResolver) {
    keepAliveLockResolver();
    keepAliveLockResolver = null;
  }

  chrome.alarms.clear(KEEPALIVE_ALARM);
  if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
  console.log('[DropFlow] SW keep-alive stopped');
}

const keepAlivePorts = new Set();
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'dropflow-keepalive') {
    keepAlivePorts.add(port);
    console.log('[DropFlow] Keep-alive port connected');
    port.onDisconnect.addListener(() => {
      keepAlivePorts.delete(port);
      console.log('[DropFlow] Keep-alive port disconnected');
    });
    // Respond to pings to keep the port active
    port.onMessage.addListener((msg) => {
      if (msg.type === 'ping') port.postMessage({ type: 'pong' });
    });
  }
});

// ============================
// Orchestration State Persistence (survives SW death)
// ============================
const ORCH_STATE_KEY = '_dropflow_orchestration';

/**
 * Save orchestration checkpoint to chrome.storage.local.
 * Called at key stages so SW restart can detect in-progress work.
 */
async function saveOrchestrationState(state) {
  try {
    await chrome.storage.local.set({ [ORCH_STATE_KEY]: { ...state, updatedAt: Date.now() } });
    console.log(`[DropFlow] Orchestration checkpoint: ${state.stage} (item ${(state.currentIndex ?? -1) + 1}/${state.totalLinks || '?'})`);
  } catch (e) {
    console.warn('[DropFlow] Failed to save orchestration state:', e.message);
  }
}

async function clearOrchestrationState() {
  try {
    await chrome.storage.local.remove(ORCH_STATE_KEY);
    console.log('[DropFlow] Orchestration state cleared');
  } catch (_) {}
}

async function getOrchestrationState() {
  try {
    const data = await chrome.storage.local.get(ORCH_STATE_KEY);
    return data[ORCH_STATE_KEY] || null;
  } catch (_) {
    return null;
  }
}

// ============================
// Message Router
// ============================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, ...payload } = message;

  switch (type) {
    // --- Keep-Alive ---
    case 'KEEPALIVE_PING':
      sendResponse({ pong: true });
      return false;

    // --- Inject form-filler into all frames of the sender's tab ---
    case 'INJECT_FORM_FILLER_IN_FRAMES': {
      const tabId = sender?.tab?.id || payload?.tabId;
      if (tabId) {
        chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: ['content-scripts/ebay/form-filler.js']
        }).then(() => {
          console.log(`[DropFlow] Injected form-filler into all frames of tab ${tabId}`);
          sendResponse({ success: true });
        }).catch(e => {
          console.warn(`[DropFlow] Frame injection failed for tab ${tabId}: ${e.message}`);
          sendResponse({ error: e.message });
        });
      } else {
        sendResponse({ error: 'No tab id' });
      }
      return true;
    }

    // --- Fill variation prices in MSKU iframe via chrome.scripting ---
    case 'FILL_MSKU_PRICES': {
      const tabId = sender?.tab?.id || payload?.tabId;
      const skus = payload?.skus || [];
      const defaultPrice = payload?.defaultPrice || 0;
      if (tabId && (skus.length > 0 || defaultPrice > 0)) {
        chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: (skuData, fallbackPrice) => {
            // Find all tables with price inputs
            const tables = document.querySelectorAll('table');
            let filled = 0;
            for (const table of tables) {
              const headerRow = table.querySelector('thead tr, tr:first-child');
              if (!headerRow) continue;
              const ths = Array.from(headerRow.querySelectorAll('th, td'));
              let priceColIdx = -1, qtyColIdx = -1;
              ths.forEach((th, idx) => {
                const t = (th.textContent || '').trim().toLowerCase();
                if (/price|amount|\$/.test(t) && priceColIdx < 0) priceColIdx = idx;
                if (/qty|quantit|stock/.test(t) && qtyColIdx < 0) qtyColIdx = idx;
              });
              if (priceColIdx < 0) continue;

              const rows = table.querySelectorAll('tbody tr, tr');
              for (const row of rows) {
                if (row === headerRow) continue;
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length === 0) continue;
                const priceCell = cells[priceColIdx];
                if (!priceCell) continue;
                const input = priceCell.querySelector('input');
                if (!input) continue;

                // Determine price for this row
                let price = fallbackPrice;
                const rowText = (row.textContent || '').toLowerCase();
                for (const sku of skuData) {
                  const vals = Object.values(sku.specifics || {}).map(v => String(v).toLowerCase());
                  if (vals.length > 0 && vals.every(v => rowText.includes(v))) {
                    price = sku.ebayPrice || sku.price || fallbackPrice;
                    break;
                  }
                }
                if (price <= 0) continue;

                // Set value using native setter
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (nativeSetter) nativeSetter.call(input, String(price));
                else input.value = String(price);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('blur', { bubbles: true }));
                filled++;
              }
            }
            return { filled };
          },
          args: [skus, defaultPrice]
        }).then(results => {
          const totalFilled = results?.reduce((sum, r) => sum + (r?.result?.filled || 0), 0) || 0;
          console.log(`[DropFlow] FILL_MSKU_PRICES: filled ${totalFilled} price inputs`);
          sendResponse({ success: true, filled: totalFilled });
        }).catch(e => {
          console.warn(`[DropFlow] FILL_MSKU_PRICES failed: ${e.message}`);
          sendResponse({ error: e.message });
        });
      } else {
        sendResponse({ error: 'No tab id or sku data' });
      }
      return true;
    }

    // --- Settings ---
    case GET_SETTINGS:
      handleGetSettings().then(sendResponse);
      return true;

    case SAVE_SETTINGS:
      handleSaveSettings(payload).then(sendResponse);
      return true;

    // --- Amazon Content Script ---
    case AMAZON_PRODUCT_DATA:
      // Product data received from content script - store temporarily
      handleAmazonProductData(payload, sender).then(sendResponse);
      return true;

    // --- eBay Content Script ---
    case EBAY_FORM_FILLED:
      touchKeepAliveActivity('EBAY_FORM_FILLED');
      handleEbayFormFilled(payload, sender).then(sendResponse);
      return true;

    case EBAY_LISTING_DATA:
      handleEbayListingData(payload, sender).then(sendResponse);
      return true;

    // --- Bulk Poster ---
    case START_BULK_LISTING:
      handleStartBulkListing(payload).then(sendResponse);
      return true;

    case PAUSE_BULK_LISTING:
      bulkPosterPaused = true;
      sendResponse({ success: true });
      return false;

    case RESUME_BULK_LISTING:
      bulkPosterPaused = false;
      sendResponse({ success: true });
      return false;

    case TERMINATE_BULK_LISTING:
      bulkPosterAbort = true;
      bulkPosterRunning = false;
      sendResponse({ success: true });
      return false;

    // --- AliExpress Bulk Lister ---
    case START_ALI_BULK_LISTING:
      handleStartAliBulkListing(payload).then(sendResponse);
      return true;

    case PAUSE_ALI_BULK_LISTING:
      aliBulkPaused = true;
      sendResponse({ success: true });
      return false;

    case RESUME_ALI_BULK_LISTING:
      aliBulkPaused = false;
      sendResponse({ success: true });
      return false;

    case TERMINATE_ALI_BULK_LISTING:
      aliBulkAbort = true;
      aliBulkRunning = false;
      sendResponse({ success: true });
      return false;

    // --- Title Builder ---
    case GENERATE_TITLES:
      handleGenerateTitles(payload).then(sendResponse);
      return true;

    case BUILD_SEO_TITLE:
      handleBuildSeoTitle(payload).then(sendResponse);
      return true;

    // --- Boost My Listings ---
    case END_LOW_PERFORMERS:
      handleEndLowPerformers(payload).then(sendResponse);
      return true;

    case SELL_SIMILAR:
      handleSellSimilar(payload).then(sendResponse);
      return true;

    case BULK_REVISE:
      handleBulkRevise(payload).then(sendResponse);
      return true;

    case SEND_OFFERS:
      handleSendOffers(payload).then(sendResponse);
      return true;

    case REVIEW_OFFERS:
      handleReviewOffers(payload).then(sendResponse);
      return true;

    case SCHEDULE_BOOST:
      handleScheduleBoost(payload).then(sendResponse);
      return true;

    case CANCEL_SCHEDULE:
      handleCancelSchedule().then(sendResponse);
      return true;

    case CANCEL_BOOST:
      boostCancelled = true;
      sendResponse({ success: true, message: 'Boost operation cancelled' });
      return false;

    // --- Competitor Research ---
    case RESEARCH_COMPETITOR:
      handleResearchCompetitor(payload).then(sendResponse);
      return true;

    case STOP_RESEARCH:
      competitorAbort = true;
      competitorRunning = false;
      sendResponse({ success: true });
      return false;

    // --- ChatGPT ---
    case ASK_CHATGPT:
      handleAskChatGpt(payload).then(sendResponse);
      return true;

    // --- Description Generation ---
    case GENERATE_DESCRIPTION:
      handleGenerateDescription(payload).then(sendResponse);
      return true;

    // --- Item Specifics AI Generation ---
    case GENERATE_ITEM_SPECIFICS:
      handleGenerateItemSpecifics(payload).then(sendResponse);
      return true;

    // --- eBay Draft API Headers (for direct PUT) ---
    case GET_EBAY_HEADERS:
      startSWKeepAlive(); // Keep SW alive during listing flow
      touchKeepAliveActivity('GET_EBAY_HEADERS');
      sendResponse(handleGetEbayHeaders(sender));
      return false;

    // --- Image Fetch (proxy for content scripts) ---
    case FETCH_IMAGE:
      startSWKeepAlive(); // Keep SW alive during image operations
      touchKeepAliveActivity('FETCH_IMAGE');
      handleFetchImage(payload).then(sendResponse);
      return true;

    // --- Image Upload to eBay (proxy using captured headers) ---
    case UPLOAD_EBAY_IMAGE:
      startSWKeepAlive(); // Keep SW alive during image upload
      touchKeepAliveActivity('UPLOAD_EBAY_IMAGE');
      handleUploadEbayImage(payload, sender).then(sendResponse);
      return true;

    // --- Navigation ---
    case OPEN_PAGE:
      handleOpenPage(payload);
      sendResponse({ success: true });
      return false;

    // --- Auto-Ordering ---
    case GET_ALL_ORDERS:
      getOrders().then(orders => sendResponse({ orders }));
      return true;

    case GET_PENDING_ORDERS:
      getPendingOrders().then(orders => sendResponse({ orders }));
      return true;

    case CREATE_ORDER:
      createAutoOrder(payload.saleData).then(order => sendResponse({ order })).catch(e => sendResponse({ error: e.message }));
      return true;

    case UPDATE_ORDER_STATUS:
      updateOrder(payload.orderId, payload.updates).then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message }));
      return true;

    case CANCEL_ORDER:
      cancelAutoOrderFn(payload.orderId).then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message }));
      return true;

    case START_AUTO_ORDER:
      executeAutoOrder(payload.orderId, (id, status, msg) => {
        chrome.runtime.sendMessage({ type: AUTO_ORDER_PROGRESS, data: { orderId: id, status, message: msg } }).catch(() => {});
      }).then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message }));
      return true;

    case CONFIRM_ORDER_PAYMENT:
      confirmOrderPayment(payload.orderId, payload.sourceOrderId).then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message }));
      return true;

    case GET_AUTO_ORDER_SETTINGS:
      getAutoOrderSettings().then(settings => sendResponse({ settings }));
      return true;

    case SAVE_AUTO_ORDER_SETTINGS:
      saveAutoOrderSettings(payload.settings).then(() => sendResponse({ success: true }));
      return true;

    // --- Sale Polling ---
    case START_SALE_POLLING:
      startSalePolling(payload.intervalMinutes || 5).then(() => sendResponse({ success: true }));
      return true;

    case STOP_SALE_POLLING:
      stopSalePolling().then(() => sendResponse({ success: true }));
      return true;

    case POLL_SALES_NOW:
      runSalePollCycle().then(result => sendResponse(result)).catch(e => sendResponse({ error: e.message }));
      return true;

    case SALE_POLL_STATUS:
      chrome.storage.local.get([SALE_POLL_LAST_RUN, SALE_POLL_STATS]).then(data => {
        sendResponse({
          lastRun: data[SALE_POLL_LAST_RUN] || null,
          stats: data[SALE_POLL_STATS] || null
        });
      });
      return true;

    // --- Stock & Price Monitor ---
    case ADD_TRACKED_PRODUCT:
      handleAddTrackedProduct(payload).then(sendResponse);
      return true;

    case REMOVE_TRACKED_PRODUCT:
      handleRemoveTrackedProduct(payload).then(sendResponse);
      return true;

    case UPDATE_TRACKED_PRODUCT:
      handleUpdateTrackedProduct(payload).then(sendResponse);
      return true;

    case GET_TRACKED_PRODUCTS:
      handleGetTrackedProducts().then(sendResponse);
      return true;

    case START_MONITOR:
      handleStartMonitor().then(sendResponse);
      return true;

    case STOP_MONITOR:
      handleStopMonitor().then(sendResponse);
      return true;

    case CHECK_PRODUCT_NOW:
      handleCheckProductNow(payload).then(sendResponse);
      return true;

    case GET_MONITOR_SETTINGS:
      handleGetMonitorSettings().then(sendResponse);
      return true;

    case SAVE_MONITOR_SETTINGS:
      handleSaveMonitorSettings(payload).then(sendResponse);
      return true;

    // --- SKU Backfiller ---
    case START_SKU_BACKFILL:
      handleStartSkuBackfill(payload).then(sendResponse);
      return true;

    case PAUSE_SKU_BACKFILL:
      skuBackfillPaused = payload?.paused !== false;
      sendResponse({ success: true, paused: skuBackfillPaused });
      return false;

    case TERMINATE_SKU_BACKFILL:
      skuBackfillAbort = true;
      skuBackfillRunning = false;
      sendResponse({ success: true });
      return false;

    // --- Tab ID (used by content scripts to identify themselves) ---
    case 'GET_TAB_ID':
      sendResponse({ tabId: sender.tab?.id || null });
      return false;

    // --- Main-world upload: picupload iframe (CSP-safe replacement for inline <script>) ---
    case 'EXECUTE_MAIN_WORLD_PICUPLOAD': {
      const tabId = sender?.tab?.id;
      if (!tabId) { sendResponse({ error: 'No tab id' }); return false; }
      const { callbackId, fileDataArr } = payload;
      chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (CALLBACK, FILE_DATA) => {
          try {
            var iframe = document.querySelector('iframe[src*="picupload"], iframe[name*="photo"]');
            if (!iframe || !iframe.contentWindow) {
              window.postMessage({ type: CALLBACK, success: false, error: 'no picupload iframe' }, '*');
              return;
            }
            var iframeWin = iframe.contentWindow;
            var u = iframeWin.sellingUIUploader;
            if (!u) {
              window.postMessage({ type: CALLBACK, success: false, error: 'no uploader in picupload' }, '*');
              return;
            }
            var key = Object.keys(u)[0];
            var inst = u[key];
            if (!inst || typeof inst.uploadFiles !== 'function') {
              window.postMessage({ type: CALLBACK, success: false, error: 'no uploadFiles in picupload' }, '*');
              return;
            }
            function dataUrlToFile(dataUrl, name, mimeType) {
              var arr = dataUrl.split(',');
              var mime = mimeType || (arr[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
              var bstr = atob(arr[1]);
              var n = bstr.length;
              var u8 = new Uint8Array(n);
              while (n--) u8[n] = bstr.charCodeAt(n);
              return new File([u8], name, { type: mime });
            }
            var config = Object.assign({}, inst.config);
            config.acceptImage = true;
            config.maxImages = 24;
            inst.acceptImage = true;
            var uploaded = 0;
            for (var i = 0; i < FILE_DATA.length; i++) {
              var file = dataUrlToFile(FILE_DATA[i].dataUrl, FILE_DATA[i].name, FILE_DATA[i].type);
              var done = false;
              var ok = false;
              var onOk = function() { done = true; ok = true; };
              var onFail = function() { done = true; };
              if (inst.emitter) {
                inst.emitter.on('upload-success', onOk);
                inst.emitter.on('upload-fail', onFail);
              }
              inst.uploadFiles([file], 'select', config, { numImage: uploaded, numVideo: 0 });
              var start = Date.now();
              while (!done && Date.now() - start < 20000) {
                await new Promise(function(r) { setTimeout(r, 500); });
              }
              if (inst.emitter) {
                inst.emitter.removeListener('upload-success', onOk);
                inst.emitter.removeListener('upload-fail', onFail);
              }
              if (ok || !done) uploaded++;
              await new Promise(function(r) { setTimeout(r, 500); });
            }
            window.postMessage({ type: CALLBACK, success: uploaded > 0, uploaded: uploaded }, '*');
          } catch (e) {
            window.postMessage({ type: CALLBACK, success: false, error: e.message }, '*');
          }
        },
        args: [callbackId, fileDataArr]
      }).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
      return true;
    }

    // --- Main-world upload: Helix sellingUIUploader (CSP-safe replacement for inline <script>) ---
    case 'EXECUTE_MAIN_WORLD_HELIX': {
      const tabId = sender?.tab?.id;
      if (!tabId) { sendResponse({ error: 'No tab id' }); return false; }
      const { callbackId, fileDataArr } = payload;
      chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (CALLBACK_ID, FILE_DATA) => {
          try {
            const uploaders = window.sellingUIUploader;
            if (!uploaders) {
              window.postMessage({ type: CALLBACK_ID, success: false, error: 'no sellingUIUploader' }, '*');
              return;
            }
            const uploaderKey = Object.keys(uploaders)[0];
            if (!uploaderKey) {
              window.postMessage({ type: CALLBACK_ID, success: false, error: 'no uploader instance' }, '*');
              return;
            }
            const uploader = uploaders[uploaderKey];
            if (!uploader || typeof uploader.uploadFiles !== 'function') {
              window.postMessage({ type: CALLBACK_ID, success: false, error: 'no uploadFiles method' }, '*');
              return;
            }
            function dataUrlToFile(dataUrl, name, mimeType) {
              const arr = dataUrl.split(',');
              const mime = mimeType || (arr[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
              const bstr = atob(arr[1]);
              let n = bstr.length;
              const u8arr = new Uint8Array(n);
              while (n--) u8arr[n] = bstr.charCodeAt(n);
              return new File([u8arr], name, { type: mime });
            }
            const config = Object.assign({}, uploader.config);
            config.acceptImage = true;
            config.accept = 'image/*,image/heic,image/heif,image/jpeg,image/png,image/webp,video/mp4,video/quicktime';
            config.maxImages = config.maxPhotos || 24;
            config.maxPhotos = config.maxPhotos || 24;
            uploader.acceptImage = true;
            let uploadedCount = 0;
            for (let i = 0; i < FILE_DATA.length; i++) {
              const file = dataUrlToFile(FILE_DATA[i].dataUrl, FILE_DATA[i].name, FILE_DATA[i].type);
              let succeeded = false, failed = false;
              const onSuccess = () => { succeeded = true; };
              const onFail = () => { failed = true; };
              if (uploader.emitter && uploader.emitter.on) {
                uploader.emitter.on('upload-success', onSuccess);
                uploader.emitter.on('upload-fail', onFail);
              }
              uploader.uploadFiles(
                [file], 'select', config,
                { numImage: (uploader.totalImagesCount || uploadedCount), numVideo: (uploader.totalVideosCount || 0) }
              );
              const start = Date.now();
              while (Date.now() - start < 20000) {
                if (succeeded || failed) break;
                await new Promise(r => setTimeout(r, 500));
              }
              if (uploader.emitter && uploader.emitter.removeListener) {
                uploader.emitter.removeListener('upload-success', onSuccess);
                uploader.emitter.removeListener('upload-fail', onFail);
              }
              if (succeeded) uploadedCount++;
              await new Promise(r => setTimeout(r, 500));
            }
            window.postMessage({ type: CALLBACK_ID, success: uploadedCount > 0, uploadedCount }, '*');
          } catch (e) {
            window.postMessage({ type: CALLBACK_ID, success: false, error: e.message }, '*');
          }
        },
        args: [callbackId, fileDataArr]
      }).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
      return true;
    }

    // --- Main-world upload: EPS URL association via Helix (CSP-safe replacement for inline <script>) ---
    case 'EXECUTE_MAIN_WORLD_EPS': {
      const tabId = sender?.tab?.id;
      if (!tabId) { sendResponse({ error: 'No tab id' }); return false; }
      const { callbackId, uploadedUrls } = payload;
      chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (CALLBACK_ID, urls) => {
          try {
            var uploaders = window.sellingUIUploader;
            if (!uploaders) { window.postMessage({ type: CALLBACK_ID, success: false }, '*'); return; }
            var key = Object.keys(uploaders)[0];
            var uploader = key ? uploaders[key] : null;
            if (!uploader || typeof uploader.uploadFiles !== 'function') {
              window.postMessage({ type: CALLBACK_ID, success: false }, '*');
              return;
            }
            var config = Object.assign({}, uploader.config);
            config.acceptImage = true;
            config.accept = 'image/*';
            config.maxImages = 24;
            uploader.acceptImage = true;
            uploader.uploadFiles(urls, 'web', config, { numImage: uploader.totalImagesCount || 0, numVideo: uploader.totalVideosCount || 0 });
            window.postMessage({ type: CALLBACK_ID, success: true }, '*');
          } catch (e) {
            window.postMessage({ type: CALLBACK_ID, success: false, error: e.message }, '*');
          }
        },
        args: [callbackId, uploadedUrls]
      }).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
      return true;
    }

    default:
      console.warn('[DropFlow] Unknown message type:', type);
      sendResponse({ error: `Unknown message type: ${type}` });
      return false;
  }
});

// ============================
// Settings Handlers
// ============================
async function handleGetSettings() {
  const keys = [BACKEND_URL, DEFAULT_LISTING_TYPE, DEFAULT_THREAD_COUNT, PRICE_MARKUP];
  const result = await chrome.storage.local.get(keys);
  // Merge with defaults
  const settings = {};
  for (const key of keys) {
    settings[key] = result[key] ?? DEFAULTS[key] ?? '';
  }
  return { success: true, settings };
}

async function handleSaveSettings(payload) {
  const { settings } = payload;
  await chrome.storage.local.set(settings);
  return { success: true };
}

// ============================
// Amazon Handlers
// ============================
async function handleAmazonProductData(payload, sender) {
  // Store the scraped product data associated with the tab
  const { productData } = payload;
  const tabId = sender.tab?.id;
  if (tabId && productData) {
    // Store in a map keyed by tab ID
    const stored = (await chrome.storage.local.get(AMAZON_DATA_MAP)) || {};
    const amazonData = stored[AMAZON_DATA_MAP] || {};
    amazonData[tabId] = productData;
    await chrome.storage.local.set({ [AMAZON_DATA_MAP]: amazonData });
  }
  return { success: true };
}

// ============================
// eBay Handlers
// ============================
async function handleEbayFormFilled(payload, sender) {
  // Content script confirms form was filled
  return { success: true, ...payload };
}

async function handleEbayListingData(payload, sender) {
  return { success: true, ...payload };
}

// ============================
// Bulk Poster
// ============================
async function handleStartBulkListing(payload) {
  if (bulkPosterRunning) {
    return { error: 'Bulk listing already running' };
  }

  const { links, threadCount = 3, minPrice, maxPrice, fbaOnly, listingType = 'standard', ebayDomain = '' } = payload;

  bulkPosterRunning = true;
  bulkPosterPaused = false;
  bulkPosterAbort = false;
  startSWKeepAlive();

  // Run in background (don't await - return immediately)
  runBulkListing(links, { threadCount, minPrice, maxPrice, fbaOnly, listingType, ebayDomain });

  return { success: true, message: `Started bulk listing ${links.length} items` };
}

/**
 * Monitor an eBay tab for navigation to the form page (/lstng) and force-inject
 * the form-filler content script. This handles cases where document_idle doesn't
 * fire reliably (heavy eBay SPA) or the identify → form navigation is a full
 * page load that the content script's MutationObserver misses.
 * Returns a cleanup function to remove the listener.
 */
function monitorEbayFormPage(tabId) {
  let injected = false;

  async function tryInject() {
    if (injected) return;
    injected = true;
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content-scripts/ebay/form-filler.js']
      });
      console.log(`[DropFlow] Force-injected form-filler on eBay form page (tab ${tabId})`);
    } catch (e) {
      console.warn(`[DropFlow] Force-inject on eBay form page failed: ${e.message}`);
      injected = false; // retry on next check
    }
  }

  // Strategy 1: Listen for tab updates (works for full navigations)
  const listener = async (changeTabId, changeInfo, tab) => {
    if (changeTabId !== tabId) return;
    // Reset injected flag when navigating away from form page
    if (changeInfo.url && !changeInfo.url.includes('/lstng')) {
      injected = false;
      return;
    }
    if (injected) return;
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('/lstng')) {
      await tryInject();
    }
  };
  chrome.tabs.onUpdated.addListener(listener);

  // Strategy 2: Poll the tab URL every 3s (catches SPA/React route changes)
  const pollInterval = setInterval(async () => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && tab.url.includes('/lstng') && tab.status === 'complete' && !injected) {
        await tryInject();
      } else if (tab.url && !tab.url.includes('/lstng')) {
        injected = false; // Reset when navigating away
      }
    } catch (_) {
      // Tab closed
      clearInterval(pollInterval);
    }
  }, 3000);

  // Auto-cleanup after 5 minutes
  const cleanupTimer = setTimeout(() => {
    chrome.tabs.onUpdated.removeListener(listener);
    clearInterval(pollInterval);
  }, 300000);

  return () => {
    chrome.tabs.onUpdated.removeListener(listener);
    clearInterval(pollInterval);
    clearTimeout(cleanupTimer);
  };
}

/**
 * Wait for EBAY_FORM_FILLED message from a specific tab.
 * The form filler sends this after completing the entire prelist → form → submit flow.
 */
function waitForFormFilled(tabId, timeoutMs = 1200000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error('Form fill timed out (20 minutes)'));
    }, timeoutMs);

    function listener(message, sender) {
      if (message.type === EBAY_FORM_FILLED && sender.tab && sender.tab.id === tabId) {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        resolve(message);
      }
    }
    chrome.runtime.onMessage.addListener(listener);
  });
}

async function runBulkListing(links, options) {
  const { threadCount = 3, minPrice, maxPrice, fbaOnly, listingType, ebayDomain = '' } = options;
  const results = [];
  let completed = 0;
  const sem = semaphore(threadCount);

  /**
   * Process a single Amazon link → eBay listing.
   * Each call gets its own eBay tab with per-tab storage, so multiple can run concurrently.
   */
  async function processLink(link, index) {
    // Wait for a semaphore slot
    await sem.acquire();

    // Check abort/pause
    if (bulkPosterAbort) { sem.release(); return; }
    while (bulkPosterPaused && !bulkPosterAbort) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (bulkPosterAbort) { sem.release(); return; }

    let result;
    let ebayTabId = null;

    try {
      console.log(`[DropFlow Bulk] Processing ${index + 1}/${links.length}: ${link}`);

      // 1. Open Amazon tab and scrape product data (60s timeout)
      const amazonTab = await createTabAndWait(link, 60000);
      await new Promise(r => setTimeout(r, 3000));

      let productData;
      try {
        productData = await chrome.tabs.sendMessage(amazonTab.id, { type: SCRAPE_AMAZON_PRODUCT });
      } catch (e) {
        throw new Error('Failed to scrape Amazon page: ' + e.message);
      }
      try { await chrome.tabs.remove(amazonTab.id); } catch (e) { /* already closed */ }

      if (!productData || productData.error) {
        throw new Error(productData?.error || 'No product data received');
      }

      console.log(`[DropFlow Bulk] Scraped: "${productData.title}" @ ${productData.price}`);

      // 2. Apply filters
      const price = parseFloat(productData.price);
      if (minPrice && price < minPrice) throw new Error(`Price $${price} below minimum $${minPrice}`);
      if (maxPrice && price > maxPrice) throw new Error(`Price $${price} above maximum $${maxPrice}`);
      if (fbaOnly && !productData.isFBA) throw new Error('Not FBA - skipped');

      // 2b. Apply price markup from settings
      const markupResult = await chrome.storage.local.get(PRICE_MARKUP);
      const markupPct = markupResult[PRICE_MARKUP] ?? DEFAULTS[PRICE_MARKUP];
      if (markupPct > 0) {
        productData.ebayPrice = +(price * (1 + markupPct / 100)).toFixed(2);
        console.log(`[DropFlow Bulk] Price markup ${markupPct}%: $${price} → $${productData.ebayPrice}`);
      } else {
        productData.ebayPrice = price;
      }

      // 3. Generate optimized title if needed
      if (listingType === 'opti-list' || listingType === 'chat-list') {
        try {
          const titleResult = await api.generateTitles({
            title: productData.title,
            description: productData.description,
            bulletPoints: productData.bulletPoints
          });
          if (titleResult.titles && titleResult.titles.length > 0) {
            productData.ebayTitle = titleResult.titles[0];
          }
        } catch (e) {
          console.warn('[DropFlow Bulk] Title generation failed, using original:', e.message);
        }
      }

      // 4. Pre-generate AI description (HTML) so the form filler has it ready
      try {
        const descResult = await handleGenerateDescription({
          title: productData.title || '',
          bulletPoints: productData.bulletPoints || [],
          description: productData.description || ''
        });
        if (descResult.success && descResult.html) {
          productData.aiDescription = descResult.html;
          console.log('[DropFlow Bulk] AI description pre-generated');
        }
      } catch (e) {
        console.warn('[DropFlow Bulk] AI description pre-generation failed:', e.message);
      }

      // 5. Create eBay tab and store per-tab data BEFORE it finishes loading.
      //    This way the content script finds the data on first load (no reload needed).
      const resolvedEbayDomain = ebayDomain || `www.ebay.${amazonToEbayDomain(extractAmazonDomain(link))}`;
      const ebayUrl = `https://${resolvedEbayDomain}/sl/prelist/suggest`;

      // Create tab (get ID immediately, don't wait for load yet)
      const ebayTab = await new Promise(resolve =>
        chrome.tabs.create({ url: ebayUrl, active: false }, resolve)
      );
      ebayTabId = ebayTab.id;

      // 5. Store per-tab pending data NOW, before the page finishes loading
      const storageKey = `pendingListing_${ebayTabId}`;
      await chrome.storage.local.set({ [storageKey]: productData });
      console.log(`[DropFlow Bulk] Tab ${ebayTabId}: stored ${storageKey}, waiting for page load...`);

      // 6. Wait for tab to finish loading (60s timeout to prevent permanent freeze)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error('eBay tab load timed out after 60s'));
        }, 60000);
        const listener = (tabId, changeInfo) => {
          if (tabId === ebayTabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            clearTimeout(timeout);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });

      // 6b. Monitor eBay tab for navigation to form page — force-inject content script
      //     if document_idle doesn't fire (same fix as AliExpress tab load issue)
      const cleanupFormMonitor = monitorEbayFormPage(ebayTabId);

      // 7. Wait for EBAY_FORM_FILLED message from the form filler content script
      const fillResult = await waitForFormFilled(ebayTabId, 1200000);
      cleanupFormMonitor();

      console.log(`[DropFlow Bulk] Tab ${ebayTabId}: form fill complete`);

      // 8. Wait 8 seconds for eBay to process the listing, then close tab
      await new Promise(r => setTimeout(r, 8000));
      try { await chrome.tabs.remove(ebayTabId); } catch (e) { /* already closed */ }

      // Clean up per-tab storage
      await chrome.storage.local.remove(storageKey);

      result = {
        index,
        link,
        status: 'success',
        message: fillResult?.url || 'Listed successfully',
        ebayUrl: fillResult?.url || ''
      };
    } catch (error) {
      console.error(`[DropFlow Bulk] Error on item ${index + 1}:`, error.message);
      result = {
        index,
        link,
        status: 'error',
        message: error.message,
        ebayUrl: ''
      };
      // Clean up per-tab storage and close tab on error
      if (ebayTabId) {
        await chrome.storage.local.remove(`pendingListing_${ebayTabId}`);
        try { await chrome.tabs.remove(ebayTabId); } catch (e) { /* ok */ }
      }
    }

    results.push(result);
    completed++;
    broadcastToExtensionPages({ type: BULK_LISTING_RESULT, result });
    broadcastToExtensionPages({
      type: BULK_LISTING_PROGRESS,
      current: completed,
      total: links.length,
      successCount: results.filter(r => r.status === 'success').length,
      failCount: results.filter(r => r.status === 'error').length
    });

    sem.release();
  }

  // Launch all links concurrently (semaphore limits to threadCount at a time)
  const promises = links.map((link, i) => processLink(link, i));
  await Promise.allSettled(promises);

  bulkPosterRunning = false;
  stopSWKeepAlive();
  broadcastToExtensionPages({
    type: BULK_LISTING_COMPLETE,
    current: results.length,
    total: links.length,
    results,
    successCount: results.filter(r => r.status === 'success').length,
    failCount: results.filter(r => r.status === 'error').length
  });
}

// ============================
// AliExpress Bulk Lister
// ============================
// Expose for E2E testing via CDP
self.__dropflowStartAliBulk = (p) => handleStartAliBulkListing(p);

async function handleStartAliBulkListing(payload) {
  if (aliBulkRunning) {
    return { error: 'AliExpress bulk listing already running' };
  }

  const { links, threadCount = 3, minPrice, maxPrice, listingType = 'standard', ebayDomain = 'www.ebay.com' } = payload;

  aliBulkRunning = true;
  aliBulkPaused = false;
  aliBulkAbort = false;
  startSWKeepAlive();

  runAliBulkListing(links, { threadCount, minPrice, maxPrice, listingType, ebayDomain })
    .catch((err) => {
      console.error('[DropFlow Ali] Bulk listing crashed:', err?.message || err);
    });

  return { success: true, message: `Started AliExpress bulk listing ${links.length} items` };
}

async function runAliBulkListing(links, options) {
  const { threadCount = 3, minPrice, maxPrice, listingType, ebayDomain = 'www.ebay.com' } = options;
  const results = [];
  let completed = 0;
  const sem = semaphore(threadCount);

  async function processLink(link, index) {
    await sem.acquire();

    if (aliBulkAbort) { sem.release(); return; }
    while (aliBulkPaused && !aliBulkAbort) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (aliBulkAbort) { sem.release(); return; }

    let result;
    let aliTabId = null;
    let ebayTabId = null;

    try {
      // Strip tracking/analytics query params — cleaner URLs load faster
      let cleanLink = link;
      try {
        const u = new URL(link);
        if (u.pathname.includes('/item/')) cleanLink = u.origin + u.pathname;
      } catch (_) {}

      console.log(`[DropFlow Ali] Processing ${index + 1}/${links.length}: ${cleanLink}`);

      // 1. Open AliExpress tab (20s timeout, resolve on timeout).
      //    AliExpress pages are heavy and often never fire the 'load' event due to
      //    third-party trackers/ads. This also means document_idle may never fire,
      //    so manifest-based content script injection may not work.
      //    Solution: short timeout + force-inject the content script ourselves.
      const aliTab = await createTabAndWait(cleanLink, 20000, true);
      aliTabId = aliTab.id;

      // 2. Force-inject the content script (don't rely on manifest auto-injection,
      //    which uses document_idle and may never fire if the page load event is blocked).
      //    Injection is idempotent — the script has a double-injection guard.
      await new Promise(r => setTimeout(r, 5000)); // Let DOM parse + settle
      try {
        await chrome.scripting.executeScript({
          target: { tabId: aliTabId },
          files: ['content-scripts/aliexpress/product-scraper.js']
        });
        console.log('[DropFlow Ali] Content script force-injected');
      } catch (injectErr) {
        console.warn(`[DropFlow Ali] Script injection failed: ${injectErr.message}`);
      }
      await new Promise(r => setTimeout(r, 2000)); // Let script initialize

      // 3. Scrape product data
      let productData;
      try {
        productData = await Promise.race([
          chrome.tabs.sendMessage(aliTabId, { type: SCRAPE_ALIEXPRESS_PRODUCT }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Scrape timed out (60s)')), 60000))
        ]);
      } catch (firstErr) {
        // Retry: re-inject and try once more
        console.warn(`[DropFlow Ali] First scrape failed: ${firstErr.message}, retrying...`);
        try {
          await chrome.scripting.executeScript({
            target: { tabId: aliTabId },
            files: ['content-scripts/aliexpress/product-scraper.js']
          });
        } catch (_) {}
        await new Promise(r => setTimeout(r, 2000));
        productData = await Promise.race([
          chrome.tabs.sendMessage(aliTabId, { type: SCRAPE_ALIEXPRESS_PRODUCT }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Scrape retry timed out (60s)')), 60000))
        ]);
      }

      // 3. Validate before downloading images
      if (!productData || productData.error) {
        try { await chrome.tabs.remove(aliTabId); } catch (_) {}
        aliTabId = null;
        throw new Error(productData?.error || 'No product data received');
      }
      console.log(`[DropFlow Ali] Scraped: "${productData.title}" @ $${productData.price}, hasVariations=${productData.variations?.hasVariations}, axes=${productData.variations?.axes?.length || 0}, skus=${productData.variations?.skus?.length || 0}`);

      // CHECKPOINT: AliExpress scrape complete
      await saveOrchestrationState({
        type: 'ali_bulk',
        stage: 'scrape_complete',
        currentIndex: index,
        totalLinks: links.length,
        link: cleanLink,
        productTitle: (productData.title || '').substring(0, 60),
        ebayDomain
      });

      // 3a. Supplement variation data via MAIN-world extraction if content script didn't get it.
      //     Modern AliExpress detail pages often leave window.runParams empty and load SKU data via
      //     prefetch/mtop in page JS. MAIN-world extraction can read that runtime state directly.
      if (!productData.variations?.hasVariations && aliTabId) {
        try {
          console.log('[DropFlow Ali] No variations from content script, trying MAIN-world extraction...');
          const varResults = await Promise.race([
            chrome.scripting.executeScript({
              target: { tabId: aliTabId },
              world: 'MAIN',
              func: async () => {
                try {
                  var skuModule = null;
                  var _diag = { sources: [], foundIn: null };
                  function isSkuModuleShape(obj) {
                    return !!(obj && typeof obj === 'object' && (
                      (obj.productSKUPropertyList && obj.skuPriceList) ||
                      (obj.sku_property_list && obj.sku_price_list) ||
                      (obj.skuPropertyList && obj.skuPriceList) ||
                      (obj.propertyList && obj.priceList)
                    ));
                  }

                  function normalizeAxisName(name, fallbackId) {
                    var n = String(name || '').replace(/\s+/g, ' ').trim();
                    if (n.indexOf(':') >= 0) n = n.split(':')[0].trim();
                    n = n.replace(/\s*\(\d+\)\s*$/, '').trim();
                    if (!n) n = 'Property_' + (fallbackId || 0);
                    return n;
                  }

                  function looksLikeAxisName(name, values) {
                    if (!name) return false;
                    if (name.length < 2 || name.length > 28) return false;
                    if (/^\d+$/.test(name)) return false;

                    var vals = Array.isArray(values) ? values : [];
                    for (var vi = 0; vi < vals.length; vi++) {
                      if ((vals[vi].name || '').toLowerCase() === name.toLowerCase()) return false;
                    }

                    if (!/\s/.test(name) && /^[A-Za-z0-9]+$/.test(name) && name.length >= 7) {
                      var upper = name.toUpperCase();
                      var compactVals = vals.map(function(v) {
                        return String(v.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                      }).filter(Boolean);
                      if (compactVals.length >= 2) {
                        var allContained = compactVals.every(function(v) { return upper.indexOf(v) >= 0; });
                        if (allContained) return false;
                      }
                    }
                    return true;
                  }

                  function finalizeAxes(rawAxes) {
                    var axes = Array.isArray(rawAxes) ? rawAxes.slice() : [];
                    var byName = {};
                    axes.forEach(function(axis) {
                      if (!axis || !axis.name) return;
                      var key = axis.name.toLowerCase();
                      if (!byName[key] || (axis.values || []).length > (byName[key].values || []).length) {
                        byName[key] = axis;
                      }
                    });
                    axes = Object.values(byName);
                    if (axes.length > 2) {
                      axes.sort(function(a, b) {
                        function score(x) {
                          var bonus = /(color|colour|size|style|material|pattern|type|model)/i.test(x.name || '') ? 100 : 0;
                          return bonus + ((x.values || []).length || 0);
                        }
                        return score(b) - score(a);
                      });
                      axes = axes.slice(0, 2);
                    }
                    return axes;
                  }

                  // Deep search helper — finds skuModule/skuComponent in any nested object
                  function findSku(obj, depth, seen) {
                    if (!obj || depth > 8 || typeof obj !== 'object') return null;
                    if (!seen && typeof WeakSet !== 'undefined') seen = new WeakSet();
                    if (seen) {
                      if (seen.has(obj)) return null;
                      seen.add(obj);
                    }

                    // Direct module references (but recurse into wrappers first)
                    var directCandidates = [
                      obj.skuModule,
                      obj.skuComponent,
                      obj.skuBase,
                      obj.skuInfo,
                      obj.skuData,
                      obj.skuDataComponent
                    ];
                    for (var ci = 0; ci < directCandidates.length; ci++) {
                      var candidate = directCandidates[ci];
                      if (!candidate || typeof candidate !== 'object') continue;
                      if (isSkuModuleShape(candidate)) return candidate;
                      var candidateNested = findSku(candidate, depth + 1, seen);
                      if (candidateNested) return candidateNested;
                    }

                    // Object that IS the sku module (has the property+price lists directly)
                    if (isSkuModuleShape(obj)) return obj;

                    var keys = Object.keys(obj);
                    for (var i = 0; i < keys.length && i < 120; i++) {
                      if (typeof obj[keys[i]] === 'object' && obj[keys[i]] !== null) {
                        var found = findSku(obj[keys[i]], depth + 1, seen);
                        if (found) return found;
                      }
                    }
                    return null;
                  }

                  // Source 1: Deep search within window.runParams (classic AliExpress)
                  _diag.sources.push('runParams:' + (typeof window.runParams));
                  if (window.runParams) {
                    // Log structure for diagnostics
                    try {
                      _diag.runParamsKeys = Object.keys(window.runParams).slice(0, 20);
                      if (window.runParams.data) {
                        _diag.runParamsDataKeys = Object.keys(window.runParams.data).slice(0, 30);
                      }
                    } catch (_) {}

                    // Fast path: known locations
                    if (window.runParams.data) {
                      skuModule = window.runParams.data.skuModule
                        || window.runParams.data.skuComponent
                        || window.runParams.data.skuBase
                        || null;
                    }
                    // Deep search within runParams if fast path missed
                    if (!skuModule) {
                      skuModule = findSku(window.runParams, 0);
                    }
                    if (skuModule) _diag.foundIn = 'runParams';
                  }

                  // Source 2: Deep search in __NEXT_DATA__
                  _diag.sources.push('__NEXT_DATA__:' + (typeof window.__NEXT_DATA__));
                  if (!skuModule && window.__NEXT_DATA__) {
                    skuModule = findSku(window.__NEXT_DATA__, 0);
                    if (skuModule) _diag.foundIn = '__NEXT_DATA__';
                  }

                  // Source 3: window.PAGE_DATA
                  _diag.sources.push('PAGE_DATA:' + (typeof window.PAGE_DATA));
                  if (!skuModule && window.PAGE_DATA) {
                    skuModule = findSku(window.PAGE_DATA, 0);
                    if (skuModule) _diag.foundIn = 'PAGE_DATA';
                  }

                  // Source 4: window.__initialState__ (Vue/Nuxt SSR)
                  _diag.sources.push('__initialState__:' + (typeof window.__initialState__));
                  if (!skuModule && window.__initialState__) {
                    skuModule = findSku(window.__initialState__, 0);
                    if (skuModule) _diag.foundIn = '__initialState__';
                  }

                  // Source 5: window.__GLOBAL_DATA__ (newer AliExpress)
                  _diag.sources.push('__GLOBAL_DATA__:' + (typeof window.__GLOBAL_DATA__));
                  if (!skuModule && window.__GLOBAL_DATA__) {
                    skuModule = findSku(window.__GLOBAL_DATA__, 0);
                    if (skuModule) _diag.foundIn = '__GLOBAL_DATA__';
                  }

                  // Source 6: Scan all window properties for likely data containers
                  if (!skuModule) {
                    var scanned = [];
                    var windowKeys = Object.keys(window);
                    for (var k = 0; k < windowKeys.length && k < 200; k++) {
                      var key = windowKeys[k];
                      try {
                        var val = window[key];
                        if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof HTMLElement)) {
                          // Check keys first (safer than JSON.stringify which can throw on circular refs)
                          var objKeys = Object.keys(val).join(',').toLowerCase();
                          var looksLikeSku = /sku|variation|propertylist|pricelist|skumodule|skucomponent/.test(objKeys);
                          // Also try JSON.stringify on small objects as backup
                          if (!looksLikeSku) {
                            try {
                              var valStr = JSON.stringify(val).substring(0, 500);
                              looksLikeSku = /sku|variation|propertyList|priceList/i.test(valStr);
                            } catch (_) {}
                          }
                          if (looksLikeSku) {
                            scanned.push(key);
                            var found = findSku(val, 0);
                            if (found) {
                              skuModule = found;
                              _diag.foundIn = 'window.' + key;
                              break;
                            }
                          }
                        }
                      } catch (_) {}
                    }
                    _diag.scannedGlobals = scanned;
                  }

                  // Source 7: Parse __NEXT_DATA__ from script tag if window.__NEXT_DATA__ is missing
                  if (!skuModule) {
                    var nextScript = document.getElementById('__NEXT_DATA__');
                    if (nextScript) {
                      try {
                        var nextData = JSON.parse(nextScript.textContent);
                        skuModule = findSku(nextData, 0);
                        if (skuModule) _diag.foundIn = '__NEXT_DATA__script';
                      } catch (_) {}
                    }
                    _diag.sources.push('__NEXT_DATA__script:' + (nextScript ? 'exists' : 'missing'));
                  }

                  // Source 8: Parse SKU sub-objects from inline script TEXT
                  // (handles the case where window.runParams is empty at runtime but
                  //  the script tag source text still contains the data)
                  if (!skuModule) {
                    var inlineScripts = document.querySelectorAll('script:not([src])');
                    var subObjPatterns = [
                      { re: /"skuModule"\s*:\s*\{/, name: 'skuModule' },
                      { re: /"skuComponent"\s*:\s*\{/, name: 'skuComponent' },
                      { re: /"skuBase"\s*:\s*\{/, name: 'skuBase' },
                      { re: /"skuInfo"\s*:\s*\{/, name: 'skuInfo' }
                    ];
                    for (var si = 0; si < inlineScripts.length && !skuModule; si++) {
                      var scriptText = inlineScripts[si].textContent || '';
                      if (scriptText.length < 200) continue;
                      for (var pi = 0; pi < subObjPatterns.length; pi++) {
                        var m = scriptText.match(subObjPatterns[pi].re);
                        if (!m) continue;
                        // Extract the sub-object using bracket counting
                        var braceStart = scriptText.indexOf('{', m.index + m[0].length - 1);
                        if (braceStart < 0) continue;
                        var braceDepth = 0, braceEnd = braceStart;
                        for (var bi = braceStart; bi < scriptText.length && bi < braceStart + 300000; bi++) {
                          if (scriptText[bi] === '{') braceDepth++;
                          else if (scriptText[bi] === '}') { braceDepth--; if (braceDepth === 0) { braceEnd = bi + 1; break; } }
                        }
                        if (braceEnd <= braceStart) continue;
                        try {
                          var subObj = JSON.parse(scriptText.substring(braceStart, braceEnd));
                          if (subObj && (subObj.productSKUPropertyList || subObj.skuPropertyList || subObj.sku_property_list || subObj.skuPriceList || subObj.sku_price_list)) {
                            skuModule = subObj;
                            _diag.foundIn = 'scriptText:' + subObjPatterns[pi].name;
                            break;
                          }
                        } catch (_) {
                          _diag.scriptTextParseAttempt = subObjPatterns[pi].name;
                        }
                      }
                    }
                  }

                  // Source 9: AliExpress prefetch payload (modern detail pages)
                  // New AliExpress pages frequently keep runParams empty and load
                  // SKU data via mtop prefetch + __INIT_DATA_CALLBACK__.
                  if (!skuModule) {
                    _diag.sources.push('__INIT_DATA_CALLBACK__:' + (typeof window.__INIT_DATA_CALLBACK__));
                    try {
                      async function waitForInitData(timeoutMs) {
                        if (typeof window.__INIT_DATA_CALLBACK__ !== 'function') return null;
                        return await Promise.race([
                          new Promise(function(resolve, reject) {
                            try {
                              new Promise(window.__INIT_DATA_CALLBACK__).then(resolve).catch(reject);
                            } catch (err) {
                              reject(err);
                            }
                          }),
                          new Promise(function(resolve) {
                            setTimeout(function() { resolve(null); }, timeoutMs);
                          })
                        ]);
                      }

                      var prefetchPayload = await waitForInitData(5000);
                      if (!prefetchPayload &&
                          window.lib &&
                          window.lib.mtop &&
                          typeof window.lib.mtop.request === 'function' &&
                          window._page_config_ &&
                          window._page_config_.prefetch) {
                        _diag.prefetchApi = window._page_config_.prefetch.api || null;
                        var cfg = Object.assign({}, window._page_config_.prefetch);
                        if (cfg.enable === false) cfg.enable = true;
                        prefetchPayload = await Promise.race([
                          new Promise(function(resolve, reject) {
                            try {
                              window.lib.mtop.request(cfg, resolve, reject);
                            } catch (err) {
                              reject(err);
                            }
                          }),
                          new Promise(function(resolve) {
                            setTimeout(function() { resolve(null); }, 7000);
                          })
                        ]);
                        if (prefetchPayload) _diag.prefetchFetched = true;
                      }

                      if (prefetchPayload) {
                        var prefetchRoot = prefetchPayload;
                        if (prefetchPayload.data && typeof prefetchPayload.data === 'object') {
                          // newDetail: data.result, choiceDetail: data.data
                          prefetchRoot = prefetchPayload.data.result || prefetchPayload.data.data || prefetchPayload.data;
                        }
                        skuModule = findSku(prefetchRoot, 0) || findSku(prefetchPayload, 0);
                        if (skuModule) {
                          _diag.foundIn = _diag.prefetchFetched ? 'mtop.prefetch' : '__INIT_DATA_CALLBACK__';
                        } else {
                          try { _diag.prefetchKeys = Object.keys(prefetchRoot).slice(0, 40); } catch (_) {}
                        }
                      } else {
                        _diag.prefetchEmpty = true;
                      }
                    } catch (prefetchErr) {
                      _diag.prefetchError = prefetchErr.message || String(prefetchErr);
                    }
                  }

                  // Source 10: DOM-based variation scraping (last resort)
                  // Extract variation axes and values from the visible product page DOM
                  if (!skuModule) {
                    try {
                      var domAxes = [];
                      var domSkus = [];
                      // AliExpress variation selectors — multiple possible DOM structures
                      var skuContainers = document.querySelectorAll(
                        '[class*="sku-item"], [class*="sku-property"], [class*="product-sku"], ' +
                        '[data-pl="product-sku"] > div, [class*="SkuProperty"], [class*="skuProperty"]'
                      );
                      if (skuContainers.length === 0) {
                        // Broader fallback: look for containers with "Color" or "Size" labels
                        var allDivs = document.querySelectorAll('div');
                        for (var di = 0; di < allDivs.length && di < 500; di++) {
                          var divText = allDivs[di].textContent || '';
                          if (divText.length > 5 && divText.length < 50) {
                            var labelMatch = divText.match(/^(colou?r|size|style|type|model|pattern|material)\s*:?\s*$/i);
                            if (labelMatch && allDivs[di].parentElement) {
                              skuContainers = document.querySelectorAll('[class*="sku"], [class*="Sku"]');
                              break;
                            }
                          }
                        }
                      }
                      for (var ci = 0; ci < skuContainers.length; ci++) {
                        var container = skuContainers[ci];
                        // Find axis name (title/label)
                        var titleEl = container.querySelector(
                          '[class*="title"], [class*="name"], [class*="label"], ' +
                          '[class*="Title"], [class*="Name"]'
                        );
                        var axisName = '';
                        if (titleEl) {
                          axisName = normalizeAxisName(titleEl.textContent, ci);
                          // Skip if it doesn't look like a variation axis name
                          if (axisName.length > 30 || axisName.length < 2) continue;
                        }
                        if (!axisName) continue;

                        // Find values (buttons, list items, clickable elements)
                        var valueEls = container.querySelectorAll(
                          'button, [class*="value"], [class*="item"], li, ' +
                          '[class*="Value"], [class*="Item"], [role="option"]'
                        );
                        var values = [];
                        var seen = {};
                        for (var vi = 0; vi < valueEls.length; vi++) {
                          var valEl = valueEls[vi];
                          var valName = '';
                          // Try image alt text first (for color swatches)
                          var img = valEl.querySelector('img');
                          if (img) {
                            valName = img.getAttribute('alt') || img.getAttribute('title') || '';
                          }
                          // Try text content
                          if (!valName) {
                            valName = valEl.textContent.trim();
                          }
                          // Clean up and skip duplicates/invalid
                          valName = valName.replace(/[:\s]+$/, '').trim();
                          if (!valName || valName.length > 50 || valName.length < 1 || seen[valName]) continue;
                          if (/^\d+$/.test(valName) && valName.length > 5) continue; // Skip IDs
                          seen[valName] = true;

                          var valImage = img ? (img.getAttribute('src') || '') : '';
                          if (valImage && valImage.startsWith('//')) valImage = 'https:' + valImage;

                          values.push({
                            valueId: vi,
                            name: valName,
                            image: valImage || null
                          });
                        }
                        if (values.length >= 2 && looksLikeAxisName(axisName, values)) {
                          domAxes.push({ name: axisName, propertyId: ci, values: values });
                        }
                      }

                      domAxes = finalizeAxes(domAxes);

                      if (domAxes.length > 0) {
                        // Build synthetic SKUs from DOM axes (cartesian product)
                        // Get the displayed price as the default for all SKUs
                        var displayPrice = 0;
                        var priceEl = document.querySelector(
                          '[class*="price-current"], [class*="Price"] span, [data-pl="product-price"]'
                        );
                        if (priceEl) {
                          var priceMatch = priceEl.textContent.match(/[\d]+[.,]?\d*/);
                          if (priceMatch) displayPrice = parseFloat(priceMatch[0].replace(/,/g, ''));
                        }

                        // Build cartesian product of all axis values
                        var combos = [{}];
                        for (var ai = 0; ai < domAxes.length; ai++) {
                          var newCombos = [];
                          for (var cci = 0; cci < combos.length; cci++) {
                            for (var vvi = 0; vvi < domAxes[ai].values.length; vvi++) {
                              var combo = {};
                              for (var ck in combos[cci]) combo[ck] = combos[cci][ck];
                              combo[domAxes[ai].name] = domAxes[ai].values[vvi].name;
                              newCombos.push(combo);
                            }
                          }
                          combos = newCombos;
                        }

                        domSkus = combos.map(function(specifics, idx) {
                          var image = null;
                          for (var axi = 0; axi < domAxes.length; axi++) {
                            var vName = specifics[domAxes[axi].name];
                            var axVal = domAxes[axi].values.find(function(v) { return v.name === vName; });
                            if (axVal && axVal.image) { image = axVal.image; break; }
                          }
                          return {
                            skuId: 'dom_' + idx,
                            price: displayPrice,
                            ebayPrice: 0,
                            stock: 5,
                            specifics: specifics,
                            image: image
                          };
                        });

                        if (domSkus.length > 1) {
                          // Build imagesByValue
                          var domImagesByValue = {};
                          for (var daxi = 0; daxi < domAxes.length; daxi++) {
                            for (var dvi = 0; dvi < domAxes[daxi].values.length; dvi++) {
                              if (domAxes[daxi].values[dvi].image) {
                                var imgKey = domAxes[daxi].name + ':' + domAxes[daxi].values[dvi].name;
                                domImagesByValue[imgKey] = [domAxes[daxi].values[dvi].image];
                              }
                            }
                          }
                          return {
                            hasVariations: true,
                            axes: domAxes,
                            skus: domSkus,
                            imagesByValue: domImagesByValue,
                            _source: 'dom'
                          };
                        }
                      }
                      _diag.domAxesFound = domAxes.length;
                    } catch (domErr) {
                      _diag.domError = domErr.message;
                    }
                  }

                  if (!skuModule) return { _diagnostic: _diag };

                  // Log found module keys for debugging structure mismatches
                  try {
                    _diag.skuModuleKeys = Object.keys(skuModule).slice(0, 30);
                  } catch (_) {}

                  function normalizeArray(maybeList) {
                    if (Array.isArray(maybeList)) return maybeList;
                    if (!maybeList || typeof maybeList !== 'object') return [];
                    if (Array.isArray(maybeList.list)) return maybeList.list;
                    if (Array.isArray(maybeList.items)) return maybeList.items;
                    return Object.values(maybeList).filter(function(v) {
                      return v && typeof v === 'object';
                    });
                  }

                  // Extract property list (variation axes) — handle all naming conventions
                  var propertyList = normalizeArray(
                    skuModule.productSKUPropertyList
                    || skuModule.skuPropertyList
                    || skuModule.sku_property_list
                    || skuModule.propertyList
                    || skuModule.skuProperties
                    || skuModule.sku_property
                    || []
                  );

                  var priceList = normalizeArray(
                    skuModule.skuPriceList
                    || skuModule.sku_price_list
                    || skuModule.priceList
                    || skuModule.skuList
                    || skuModule.sku_list
                    || skuModule.skuPriceMap
                    || []
                  );

                  if (propertyList.length === 0 || priceList.length <= 1) {
                    // Return diagnostic with module keys so we can see what fields exist
                    _diag.skuModuleFound = true;
                    _diag.propertyListLen = propertyList.length;
                    _diag.priceListLen = priceList.length;
                    return { _diagnostic: _diag };
                  }

                  // Build axes array
                  var axes = propertyList.map(function(prop) {
                    var values = normalizeArray(
                      prop.skuPropertyValues
                      || prop.sku_property_value
                      || prop.propertyValues
                      || prop.values
                      || []
                    ).map(function(val) {
                      var img = val.skuPropertyImagePath || val.skuPropertyTips || val.sku_image || null;
                      if (img && img.startsWith('//')) img = 'https:' + img;
                      return {
                        valueId: val.propertyValueId || val.property_value_id || 0,
                        name: val.propertyValueDefinitionName || val.propertyValueDisplayName
                          || val.property_value_definition_name || val.property_value_name || '',
                        image: img
                      };
                    });
                    return {
                      name: normalizeAxisName(
                        prop.skuPropertyName || prop.sku_property_name,
                        prop.skuPropertyId || prop.sku_property_id
                      ),
                      propertyId: prop.skuPropertyId || prop.sku_property_id || 0,
                      values: values
                    };
                  });

                  axes = finalizeAxes(axes);
                  if (axes.length === 0) {
                    _diag.skuModuleFound = true;
                    _diag.propertyListLen = propertyList.length;
                    _diag.priceListLen = priceList.length;
                    _diag.axisFilteredOut = true;
                    return { _diagnostic: _diag };
                  }

                  // Build SKUs array
                  var skus = priceList.map(function(sku) {
                    var attrStr = sku.skuAttr || sku.sku_attr || sku.attr || sku.skuAttrs || sku.saleAttr || '';
                    if (Array.isArray(attrStr)) attrStr = attrStr.join(';');
                    var specifics = {};
                    if (attrStr) {
                      var parts = attrStr.split(';');
                      for (var i = 0; i < parts.length; i++) {
                        var m = parts[i].match(/^(\d+):(\d+)(?:#(.+))?$/);
                        if (!m) continue;
                        var propId = parseInt(m[1]);
                        var valId = parseInt(m[2]);
                        var valName = m[3] || '';
                        for (var a = 0; a < axes.length; a++) {
                          if (axes[a].propertyId === propId) {
                            var foundVal = null;
                            for (var v = 0; v < axes[a].values.length; v++) {
                              if (axes[a].values[v].valueId === valId) { foundVal = axes[a].values[v]; break; }
                            }
                            specifics[axes[a].name] = foundVal ? foundVal.name : valName;
                            break;
                          }
                        }
                      }
                    }

                    // Price: handle skuModule format (skuVal.skuAmount.value) and API format (sku_price)
                    var price = 0;
                    if (sku.skuVal) {
                      price = parseFloat(
                        sku.skuVal.skuAmount?.value || sku.skuVal.skuActivityAmount?.value ||
                        sku.skuVal.skuCalPrice || sku.skuVal.actSkuCalPrice || 0
                      );
                    }
                    if (!price) {
                      price = parseFloat(
                        sku.sku_price || sku.sku_bulk_order_price || sku.price || sku.activityPrice || 0
                      );
                    }

                    // Default to 5 if stock info unavailable (product is on AliExpress, so it's in stock)
                    var rawStock = sku.skuVal?.availQuantity ?? sku.sku_stock ?? null;
                    var stock = rawStock !== null ? parseInt(rawStock) : 5;
                    if (isNaN(stock) || stock <= 0) stock = 5;

                    // Find image from first visual axis
                    var image = null;
                    for (var a = 0; a < axes.length; a++) {
                      var vName = specifics[axes[a].name];
                      if (vName) {
                        for (var v = 0; v < axes[a].values.length; v++) {
                          if (axes[a].values[v].name === vName && axes[a].values[v].image) {
                            image = axes[a].values[v].image;
                            break;
                          }
                        }
                        if (image) break;
                      }
                    }

                    return {
                      skuId: String(sku.skuId || sku.sku_id || ''),
                      price: price,
                      ebayPrice: 0,
                      stock: stock,
                      specifics: specifics,
                      image: image
                    };
                  });

                  // Build imagesByValue map
                  var imagesByValue = {};
                  for (var a = 0; a < axes.length; a++) {
                    for (var v = 0; v < axes[a].values.length; v++) {
                      if (axes[a].values[v].image) {
                        var key = axes[a].name + ':' + axes[a].values[v].name;
                        if (!imagesByValue[key]) imagesByValue[key] = [];
                        imagesByValue[key].push(axes[a].values[v].image);
                      }
                    }
                  }

                  return {
                    hasVariations: skus.length > 1,
                    axes: axes,
                    skus: skus,
                    imagesByValue: imagesByValue
                  };
                } catch (e) {
                  return { _diagnostic: { error: e.message || String(e), sources: _diag ? _diag.sources : [], runParamsKeys: _diag ? _diag.runParamsKeys : null, runParamsDataKeys: _diag ? _diag.runParamsDataKeys : null, foundIn: _diag ? _diag.foundIn : null } };
                }
              }
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('MAIN-world variation timeout (15s)')), 15000))
          ]);

          const varData = varResults?.[0]?.result;
          if (varData?.hasVariations) {
            productData.variations = varData;
            // Update base price to min across all SKUs if lower
            const minSkuPrice = Math.min(...varData.skus.map(s => s.price).filter(p => p > 0));
            if (minSkuPrice > 0) {
              productData.price = minSkuPrice;
            }
            console.log(`[DropFlow Ali] MAIN-world variations: ${varData.axes.map(a => a.name + '(' + a.values.length + ')').join(' × ')} = ${varData.skus.length} SKUs`);
          } else if (varData?._diagnostic) {
            // No variations found — log diagnostic info to help debug
            const d = varData._diagnostic;
            console.warn(`[DropFlow Ali] MAIN-world: No SKU data found. Sources: ${d.sources.join(', ')}`);
            if (d.runParamsKeys) {
              console.log(`[DropFlow Ali] MAIN-world: runParams keys: ${d.runParamsKeys.join(', ')}`);
            }
            if (d.runParamsDataKeys) {
              console.log(`[DropFlow Ali] MAIN-world: runParams.data keys: ${d.runParamsDataKeys.join(', ')}`);
            }
            if (d.skuModuleKeys) {
              console.log(`[DropFlow Ali] MAIN-world: skuModule keys: ${d.skuModuleKeys.join(', ')}`);
            }
            if (d.skuModuleFound) {
              console.warn(`[DropFlow Ali] MAIN-world: skuModule FOUND but propertyList=${d.propertyListLen}, priceList=${d.priceListLen}`);
            }
            if (d.scannedGlobals?.length > 0) {
              console.log(`[DropFlow Ali] MAIN-world: Scanned globals with SKU-like content: ${d.scannedGlobals.join(', ')}`);
            }
            if (d.prefetchApi) {
              console.log(`[DropFlow Ali] MAIN-world: Prefetch API candidate: ${d.prefetchApi}`);
            }
            if (d.prefetchError) {
              console.warn(`[DropFlow Ali] MAIN-world: Prefetch extraction error: ${d.prefetchError}`);
            }
            if (d.prefetchEmpty) {
              console.log('[DropFlow Ali] MAIN-world: Prefetch payload unavailable (timeout or missing callback)');
            }
            // Persist diagnostic to storage for debugging
            chrome.storage.local.set({
              dropflow_variation_mainworld_diag: {
                timestamp: new Date().toISOString(),
                ...d,
                url: productData.url || 'unknown'
              }
            }).catch(() => {});
          } else {
            console.log('[DropFlow Ali] MAIN-world: No variation data found in page JS context');
          }
        } catch (e) {
          console.warn(`[DropFlow Ali] MAIN-world variation extraction failed: ${e.message}`);
        }
      }

      // 3b. Pre-download images via main world execution (runs in the AliExpress
      //     page's own context — correct origin, cookies, CSP permissions).
      //     Content script fetch() fails due to CSP; service worker fetch() gets 404.
      //     Main world fetch() works because the page already loads these images.
      if (productData.images && productData.images.length > 0 && aliTabId) {
        try {
          const imgUrls = productData.images.slice(0, 8);
          console.log(`[DropFlow Ali] Downloading ${imgUrls.length} images via canvas (img-src CSP)...`);
          const downloadResults = await Promise.race([
            chrome.scripting.executeScript({
              target: { tabId: aliTabId },
              world: 'MAIN',
              func: async (urls) => {
                // Use <img> + canvas instead of fetch() — img elements use img-src CSP
                // (allowed, since AliExpress already displays these images) instead of
                // connect-src CSP (which blocks fetch()).

                // AliExpress CDN returns 100x100 thumbnails for base URLs.
                // Use _640x640 (known supported size, > eBay's 500px min).
                function toFullResUrl(url) {
                  let u = url.startsWith('//') ? 'https:' + url : url;
                  u = u.replace(/_+$/, '');
                  // Already has 640+ suffix? Keep it.
                  if (/_([6-9]\d{2}|1\d{3})x/.test(u)) return u;
                  // Has a small size suffix? Replace with 640x640
                  if (/\.\w{3,4}_\d+x\d+[^/]*$/.test(u)) {
                    return u.replace(/(\.\w{3,4})_\d+x\d+[^/]*$/, '$1_640x640.jpg');
                  }
                  // No suffix — append _640x640.jpg
                  if (/\.\w{3,4}$/.test(u)) return u + '_640x640.jpg';
                  return u;
                }

                function imgToDataUrl(url, minWidth = 500) {
                  return new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = () => {
                      try {
                        if (img.naturalWidth < minWidth) {
                          resolve({ ok: false, error: `too small: ${img.naturalWidth}x${img.naturalHeight}` });
                          return;
                        }
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                        resolve({ ok: true, data: dataUrl, w: img.naturalWidth, h: img.naturalHeight });
                      } catch (e) {
                        resolve({ ok: false, error: 'canvas: ' + e.message });
                      }
                    };
                    img.onerror = () => {
                      resolve({ ok: false, error: 'img load failed for: ' + url.substring(0, 60) });
                    };
                    setTimeout(() => resolve({ ok: false, error: 'img timeout' }), 10000);
                    img.src = url;
                  });
                }

                const results = [];
                const errors = [];
                for (let i = 0; i < urls.length; i++) {
                  // Try full-resolution URL first (strip size suffixes)
                  const fullUrl = toFullResUrl(urls[i]);
                  let r = await imgToDataUrl(fullUrl);

                  // If full-res failed or too small, try original URL
                  if (!r.ok && fullUrl !== (urls[i].startsWith('//') ? 'https:' + urls[i] : urls[i])) {
                    const origUrl = urls[i].startsWith('//') ? 'https:' + urls[i] : urls[i];
                    r = await imgToDataUrl(origUrl, 0); // Accept any size as last resort
                  }

                  if (r.ok) {
                    results.push(r.data);
                  } else {
                    errors.push({ index: i, url: urls[i].substring(0, 80), error: r.error });
                    results.push(null);
                  }
                }
                return { results, errors };
              },
              args: [imgUrls]
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('Image download timeout (30s)')), 30000))
          ]);
          if (downloadResults && downloadResults[0] && downloadResults[0].result) {
            const { results: preDownloaded, errors } = downloadResults[0].result;
            if (errors && errors.length > 0) {
              console.warn(`[DropFlow Ali] Image download errors:`, JSON.stringify(errors));
            }
            const validCount = preDownloaded.filter(d => d !== null).length;
            if (validCount > 0) {
              productData.preDownloadedImages = preDownloaded;
              console.log(`[DropFlow Ali] ${validCount}/${imgUrls.length} images downloaded via canvas`);
            } else {
              console.warn('[DropFlow Ali] Canvas download returned 0 valid images — will try FETCH_IMAGE on eBay side');
            }
          }
        } catch (e) {
          console.warn(`[DropFlow Ali] Canvas image download failed: ${e.message}`);
        }
      }

      // 3b. Download variation images via MAIN-world canvas (same technique as gallery)
      if (productData.variations?.hasVariations && aliTabId) {
        try {
          // Collect unique variation image URLs
          const varImageUrls = [];
          const seenUrls = new Set((productData.images || []).map(u => u.replace(/^https?:/, '')));
          for (const urls of Object.values(productData.variations.imagesByValue)) {
            for (const url of urls) {
              const normalized = url.replace(/^https?:/, '');
              if (!seenUrls.has(normalized)) {
                seenUrls.add(normalized);
                varImageUrls.push(url);
              }
            }
          }

          if (varImageUrls.length > 0) {
            const cappedUrls = varImageUrls.slice(0, 20);
            console.log(`[DropFlow Ali] Downloading ${cappedUrls.length} variation images via canvas...`);
            const varDownloadResults = await Promise.race([
              chrome.scripting.executeScript({
                target: { tabId: aliTabId },
                world: 'MAIN',
                func: (urls) => {
                  function imgToDataUrl(url) {
                    return new Promise(resolve => {
                      const img = new Image();
                      img.crossOrigin = 'anonymous';
                      img.onload = () => {
                        try {
                          const canvas = document.createElement('canvas');
                          canvas.width = img.naturalWidth;
                          canvas.height = img.naturalHeight;
                          const ctx = canvas.getContext('2d');
                          ctx.drawImage(img, 0, 0);
                          resolve(canvas.toDataURL('image/jpeg', 0.92));
                        } catch (e) { resolve(null); }
                      };
                      img.onerror = () => resolve(null);
                      setTimeout(() => resolve(null), 10000);
                      img.src = url.startsWith('//') ? 'https:' + url : url;
                    });
                  }
                  return Promise.all(urls.map(u => imgToDataUrl(u)));
                },
                args: [cappedUrls]
              }),
              new Promise((_, rej) => setTimeout(() => rej(new Error('Variation image download timeout (30s)')), 30000))
            ]);

            if (varDownloadResults?.[0]?.result) {
              const downloaded = varDownloadResults[0].result;
              // Build URL→base64 map for the form filler
              const varImageMap = {};
              cappedUrls.forEach((url, i) => {
                if (downloaded[i]) varImageMap[url] = downloaded[i];
              });
              const validCount = Object.keys(varImageMap).length;
              if (validCount > 0) {
                productData.preDownloadedVariationImages = varImageMap;
                console.log(`[DropFlow Ali] ${validCount}/${cappedUrls.length} variation images downloaded`);
              }
            }
          }
        } catch (e) {
          console.warn(`[DropFlow Ali] Variation image download failed: ${e.message}`);
        }
      }

      // 4. Close AliExpress tab
      try { await chrome.tabs.remove(aliTabId); } catch (_) {}
      aliTabId = null;

      // 5. Validate price and apply filters
      const price = parseFloat(productData.price);
      if (!price || price <= 0) throw new Error('Could not extract product price from AliExpress');
      if (minPrice && price < minPrice) throw new Error(`Price $${price} below minimum $${minPrice}`);
      if (maxPrice && price > maxPrice) throw new Error(`Price $${price} above maximum $${maxPrice}`);

      // 5b. Apply price markup from settings
      const aliMarkupResult = await chrome.storage.local.get(PRICE_MARKUP);
      const aliMarkupPct = aliMarkupResult[PRICE_MARKUP] ?? DEFAULTS[PRICE_MARKUP];
      if (aliMarkupPct > 0) {
        productData.ebayPrice = +(price * (1 + aliMarkupPct / 100)).toFixed(2);
        console.log(`[DropFlow Ali] Price markup ${aliMarkupPct}%: $${price} → $${productData.ebayPrice}`);
      } else {
        productData.ebayPrice = price;
      }

      // 5c. Apply markup to each variation SKU price
      if (productData.variations?.hasVariations) {
        productData.variations.skus.forEach(sku => {
          sku.ebayPrice = aliMarkupPct > 0
            ? +(sku.price * (1 + aliMarkupPct / 100)).toFixed(2)
            : sku.price;
        });
        console.log(`[DropFlow Ali] Applied ${aliMarkupPct}% markup to ${productData.variations.skus.length} variation SKUs`);
      }

      // 6. Generate optimized title if needed (15s timeout so dead backend doesn't hang)
      if (listingType === 'opti-list' || listingType === 'chat-list') {
        try {
          const titleResult = await Promise.race([
            api.generateTitles({
              title: productData.title,
              description: productData.description,
              bulletPoints: productData.bulletPoints
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('Title gen timeout')), 15000))
          ]);
          if (titleResult.titles && titleResult.titles.length > 0) {
            productData.ebayTitle = titleResult.titles[0];
          }
        } catch (e) {
          console.warn('[DropFlow Ali] Title generation failed, using original:', e.message);
        }
      }

      // 7. Pre-generate AI description (15s timeout)
      try {
        const descResult = await Promise.race([
          handleGenerateDescription({
            title: productData.title || '',
            bulletPoints: productData.bulletPoints || [],
            description: productData.description || ''
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Desc gen timeout')), 15000))
        ]);
        if (descResult.success && descResult.html) {
          productData.aiDescription = descResult.html;
          console.log('[DropFlow Ali] AI description pre-generated');
        }
      } catch (e) {
        console.warn('[DropFlow Ali] AI description pre-generation failed:', e.message);
      }

      // 8. Open eBay prelist tab (user-selected marketplace)
      const ebayUrl = `https://${ebayDomain}/sl/prelist/suggest`;
      console.log(`[DropFlow Ali] Opening eBay: ${ebayUrl}`);

      const ebayTab = await new Promise(resolve =>
        chrome.tabs.create({ url: ebayUrl, active: false }, resolve)
      );
      ebayTabId = ebayTab.id;

      // CHECKPOINT: eBay tab opened
      await saveOrchestrationState({
        type: 'ali_bulk',
        stage: 'ebay_tab_opened',
        currentIndex: index,
        totalLinks: links.length,
        link: cleanLink,
        ebayTabId,
        ebayDomain
      });

      // 9. Store per-tab pending data before page finishes loading
      const storageKey = `pendingListing_${ebayTabId}`;
      const hasPreDownloaded = Array.isArray(productData.preDownloadedImages) &&
        productData.preDownloadedImages.some(d => d !== null);
      const preDownloadedCount = hasPreDownloaded
        ? productData.preDownloadedImages.filter(d => d !== null).length : 0;
      try {
        await chrome.storage.local.set({ [storageKey]: productData });
        console.log(`[DropFlow Ali] Tab ${ebayTabId}: stored ${storageKey} (${preDownloadedCount} pre-downloaded images), waiting for page load...`);
      } catch (storageErr) {
        // Storage quota exceeded — keep a reduced image set instead of removing all images.
        // This avoids total photo upload failure when SW/image proxy is interrupted.
        console.warn(`[DropFlow Ali] Storage.set failed (${storageErr.message}), retrying with reduced preDownloaded images...`);

        if (Array.isArray(productData.preDownloadedImages)) {
          // Keep first 8 main images (usually enough for eBay listing requirements)
          productData.preDownloadedImages = productData.preDownloadedImages.slice(0, 8);
        }
        // Variation image map can be large; drop it first to save quota.
        delete productData.preDownloadedVariationImages;

        try {
          await chrome.storage.local.set({ [storageKey]: productData });
          const kept = Array.isArray(productData.preDownloadedImages)
            ? productData.preDownloadedImages.filter(Boolean).length : 0;
          console.log(`[DropFlow Ali] Tab ${ebayTabId}: stored ${storageKey} with reduced images (${kept} kept)`);
        } catch (storageErr2) {
          // Last resort: strip all base64 payloads.
          console.warn(`[DropFlow Ali] Reduced image payload still too large (${storageErr2.message}), storing without preDownloaded images`);
          delete productData.preDownloadedImages;
          await chrome.storage.local.set({ [storageKey]: productData });
          console.log(`[DropFlow Ali] Tab ${ebayTabId}: stored ${storageKey} (without pre-downloaded images)`);
        }
      }

      // 10. Wait for eBay tab to finish loading (60s timeout to prevent permanent freeze)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error('eBay tab load timed out after 60s'));
        }, 60000);
        const listener = (tabId, changeInfo) => {
          if (tabId === ebayTabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            clearTimeout(timeout);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });

      // 10b. Monitor eBay tab for navigation to form page — force-inject content script
      //      if document_idle doesn't fire (same fix as AliExpress tab load issue)
      const cleanupFormMonitor = monitorEbayFormPage(ebayTabId);

      // CHECKPOINT: Waiting for form fill
      await saveOrchestrationState({
        type: 'ali_bulk',
        stage: 'waiting_form_fill',
        currentIndex: index,
        totalLinks: links.length,
        link: cleanLink,
        ebayTabId,
        storageKey,
        ebayDomain
      });

      // 11. Wait for form fill completion
      const fillResult = await waitForFormFilled(ebayTabId, 1200000);
      cleanupFormMonitor();

      console.log(`[DropFlow Ali] Tab ${ebayTabId}: form fill complete`);

      // CHECKPOINT: Form fill complete, listing submitted
      await saveOrchestrationState({
        type: 'ali_bulk',
        stage: 'form_fill_complete',
        currentIndex: index,
        totalLinks: links.length,
        link: cleanLink,
        ebayTabId,
        fillResultUrl: fillResult?.url || '',
        ebayDomain
      });

      // 12. Wait 8 seconds for eBay to process the listing, then close tab
      await new Promise(r => setTimeout(r, 8000));
      try { await chrome.tabs.remove(ebayTabId); } catch (_) {}
      ebayTabId = null;
      await chrome.storage.local.remove(storageKey);

      result = {
        index,
        link,
        status: 'success',
        message: fillResult?.url || 'Listed successfully',
        ebayUrl: fillResult?.url || ''
      };
    } catch (error) {
      console.error(`[DropFlow Ali] Error on item ${index + 1}:`, error.message);
      result = {
        index,
        link,
        status: 'error',
        message: error.message,
        ebayUrl: ''
      };
    } finally {
      // GUARANTEED cleanup — even if error handler itself throws
      if (aliTabId) { try { await chrome.tabs.remove(aliTabId); } catch (_) {} }
      if (ebayTabId) {
        await chrome.storage.local.remove(`pendingListing_${ebayTabId}`);
        try { await chrome.tabs.remove(ebayTabId); } catch (_) {}
      }
    }

    results.push(result);
    completed++;
    broadcastToExtensionPages({ type: ALI_BULK_LISTING_RESULT, result });
    broadcastToExtensionPages({
      type: ALI_BULK_LISTING_PROGRESS,
      current: completed,
      total: links.length,
      successCount: results.filter(r => r.status === 'success').length,
      failCount: results.filter(r => r.status === 'error').length
    });

    sem.release();
  }

  try {
    const promises = links.map((link, i) => processLink(link, i));
    await Promise.allSettled(promises);

    broadcastToExtensionPages({
      type: ALI_BULK_LISTING_COMPLETE,
      current: results.length,
      total: links.length,
      results,
      successCount: results.filter(r => r.status === 'success').length,
      failCount: results.filter(r => r.status === 'error').length
    });
  } finally {
    // Always clear run-state flags, even if the run crashes before normal completion.
    aliBulkRunning = false;
    aliBulkPaused = false;
    aliBulkAbort = false;
    await clearOrchestrationState();
    stopSWKeepAlive();
  }
}

// ============================
// Title Builder
// ============================
async function handleGenerateTitles(payload) {
  try {
    const result = await api.generateTitles(payload);
    return { success: true, ...result };
  } catch (error) {
    return { error: error.message };
  }
}

async function handleBuildSeoTitle(payload) {
  try {
    const result = await api.tfidf(payload.documents, payload.query);
    return { success: true, ...result };
  } catch (error) {
    return { error: error.message };
  }
}

// ============================
// Boost My Listings
// ============================
let boostCancelled = false;

/** Broadcast a boost progress message to all extension pages */
function sendBoostProgress(current, total, status) {
  chrome.runtime.sendMessage({ type: BOOST_PROGRESS, current, total, status }).catch(() => {});
}

function sendBoostComplete(total, summary) {
  chrome.runtime.sendMessage({ type: BOOST_COMPLETE, total, summary }).catch(() => {});
}

/** Detect the user's eBay domain from settings or default to .com.au */
async function getEbayDomain() {
  try {
    const result = await chrome.storage.local.get('settings');
    const settings = result.settings || {};
    return settings.ebayDomain || 'com.au';
  } catch (_) {
    return 'com.au';
  }
}

/**
 * Open Seller Hub active listings tab and scrape all pages.
 * @param {string} domain - eBay domain (e.g. 'com.au')
 * @param {boolean} includePerformance - If true, enable Sold/Watchers/Views columns
 * @param {string} [urlSuffix] - Optional URL query string (e.g. '?pill_status=sioEligible')
 * @returns {{ listings: Array, tabId: number }}
 */
async function scrapeAllActiveListings(domain, includePerformance = false, urlSuffix = '') {
  const url = `https://www.ebay.${domain}/sh/lst/active${urlSuffix}`;
  const tab = await createTabAndWait(url, 60000);
  const tabId = tab.id;

  await sleep(5000);

  // Inject active-listings-scraper
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/ebay/active-listings-scraper.js']
    });
  } catch (_) { /* already injected via manifest */ }
  await sleep(2000);

  const messageType = includePerformance ? SCRAPE_ACTIVE_LISTINGS_FULL : SCRAPE_ACTIVE_LISTINGS;
  let allListings = [];

  // Scrape first page
  let response;
  try {
    response = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: messageType, page: 1 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Scrape timed out')), 60000))
    ]);
  } catch (e) {
    // Retry: activate tab and re-inject
    try { await chrome.tabs.update(tabId, { active: true }); } catch (_) {}
    await sleep(3000);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/ebay/active-listings-scraper.js']
      });
    } catch (_) {}
    await sleep(2000);
    response = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: messageType, page: 1 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Scrape retry timed out')), 60000))
    ]);
  }

  if (response?.listings) {
    allListings.push(...response.listings);
  }

  // Paginate through remaining pages
  const pagination = response?.pagination || { totalPages: 1 };
  if (pagination.totalPages > 1) {
    for (let page = 2; page <= pagination.totalPages && !boostCancelled; page++) {
      try {
        const pageResponse = await Promise.race([
          chrome.tabs.sendMessage(tabId, { type: messageType, page }),
          new Promise((_, rej) => setTimeout(() => rej(new Error(`Page ${page} timed out`)), 60000))
        ]);
        if (pageResponse?.listings) {
          allListings.push(...pageResponse.listings);
        }
        await sleep(2000);
      } catch (e) {
        console.warn(`[DropFlow Boost] Failed to scrape page ${page}: ${e.message}`);
        break;
      }
    }
  }

  console.log(`[DropFlow Boost] Scraped ${allListings.length} total listings across ${pagination.totalPages} pages`);
  return { listings: allListings, tabId };
}

/**
 * End Low Performers: scrape active listings, filter by performance, end underperformers.
 */
async function handleEndLowPerformers(payload) {
  const { minSold = 0, minViews = 0, hoursRemaining = 24, autoRelist = false, autoRepeat = false } = payload;
  boostCancelled = false;

  const domain = await getEbayDomain();
  let hubTabId = null;

  try {
    // 1. Scrape all active listings with performance data
    sendBoostProgress(0, 0, 'Scanning active listings...');
    const { listings, tabId } = await scrapeAllActiveListings(domain, true);
    hubTabId = tabId;

    if (listings.length === 0) {
      return { success: true, message: 'No active listings found', ended: 0 };
    }

    // 2. Filter low performers
    const lowPerformers = listings.filter(listing => {
      const soldOk = listing.sold <= minSold;
      const viewsOk = minViews > 0 ? listing.views <= minViews : true;
      // Parse time-left text (e.g. "3d 12h", "5h 30m", "2d") into hours
      let hoursOk = true;
      if (hoursRemaining > 0 && listing.timeLeft) {
        const dMatch = listing.timeLeft.match(/(\d+)\s*d/i);
        const hMatch = listing.timeLeft.match(/(\d+)\s*h/i);
        const totalHours = (dMatch ? parseInt(dMatch[1], 10) * 24 : 0) + (hMatch ? parseInt(hMatch[1], 10) : 0);
        hoursOk = totalHours <= hoursRemaining;
      }
      return soldOk && viewsOk && hoursOk;
    });

    if (lowPerformers.length === 0) {
      return { success: true, message: `Scanned ${listings.length} listings — none matched criteria`, ended: 0 };
    }

    console.log(`[DropFlow Boost] Found ${lowPerformers.length} low performers out of ${listings.length} listings`);
    sendBoostProgress(0, lowPerformers.length, `Found ${lowPerformers.length} low performers`);

    // 3. Close hub tab (we'll open individual revision tabs)
    if (hubTabId) {
      try { await chrome.tabs.remove(hubTabId); } catch (_) {}
      hubTabId = null;
    }

    // 4. End each low performer
    let ended = 0;
    let relisted = 0;

    for (let i = 0; i < lowPerformers.length && !boostCancelled; i++) {
      const listing = lowPerformers[i];
      const shortTitle = (listing.title || '').substring(0, 40);
      sendBoostProgress(i + 1, lowPerformers.length, `Ending: ${shortTitle}...`);

      const product = { ebayItemId: listing.itemId, ebayDomain: domain };
      const result = await reviseEbayListing(product, { action: 'end_listing' });

      if (result?.success || result?.action === 'end_listing') {
        ended++;
        console.log(`[DropFlow Boost] Ended listing ${listing.itemId}: ${shortTitle}`);

        // Auto Sell Similar if enabled
        if (autoRelist) {
          sendBoostProgress(i + 1, lowPerformers.length, `Relisting: ${shortTitle}...`);
          const relistResult = await sellSimilar(listing.itemId, domain);
          if (relistResult?.success) {
            relisted++;
          }
        }
      } else {
        console.warn(`[DropFlow Boost] Failed to end ${listing.itemId}: ${result?.error || 'unknown'}`);
      }

      await sleep(3000);
    }

    const summary = `Ended ${ended}/${lowPerformers.length} listings` + (relisted > 0 ? `, relisted ${relisted}` : '');
    sendBoostComplete(lowPerformers.length, summary);

    // Auto repeat if enabled and we found items
    if (autoRepeat && ended > 0 && !boostCancelled) {
      console.log('[DropFlow Boost] Auto-repeating End & Sell Similar...');
      await sleep(5000);
      return handleEndLowPerformers(payload);
    }

    return { success: true, message: summary, ended, relisted };
  } catch (error) {
    console.error('[DropFlow Boost] End low performers error:', error);
    return { error: error.message };
  } finally {
    if (hubTabId) {
      try { await chrome.tabs.remove(hubTabId); } catch (_) {}
    }
  }
}

/**
 * Sell Similar: open a pre-filled listing form for an ended item and submit it.
 */
async function sellSimilar(itemId, domain) {
  // Try multiple URL patterns for Sell Similar
  const urls = [
    `https://www.ebay.${domain}/sl/sell?mode=SellSimilar&itemId=${itemId}`,
    `https://www.ebay.${domain}/lstng?mode=SellSimilar&itemId=${itemId}`,
  ];

  for (const url of urls) {
    let tabId = null;
    try {
      const tab = await createTabAndWait(url, 45000);
      tabId = tab.id;
      await sleep(5000);

      // Inject form-filler
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content-scripts/ebay/form-filler.js']
        });
      } catch (_) {}
      await sleep(2000);

      // Send list_similar action
      const response = await Promise.race([
        chrome.tabs.sendMessage(tabId, { type: REVISE_EBAY_LISTING, action: 'list_similar' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Sell similar timed out (60s)')), 60000))
      ]);

      await sleep(5000);

      if (response?.success) {
        console.log(`[DropFlow Boost] Sell Similar successful for ${itemId}`);
        return { success: true };
      }

      // If we got an error but the page loaded, the URL pattern might be wrong
      if (response?.error) {
        console.warn(`[DropFlow Boost] Sell Similar error for ${itemId}: ${response.error}`);
      }
    } catch (e) {
      console.warn(`[DropFlow Boost] Sell Similar failed for URL ${url}: ${e.message}`);
    } finally {
      if (tabId) {
        try { await chrome.tabs.remove(tabId); } catch (_) {}
      }
    }
  }

  return { error: 'All Sell Similar URL patterns failed' };
}

async function handleSellSimilar(payload) {
  const domain = await getEbayDomain();
  const { itemId } = payload;
  if (!itemId) return { error: 'No item ID provided' };
  return await sellSimilar(itemId, domain);
}

/**
 * Bulk Revise: iterate through active listings, open revision page, toggle Best Offer.
 */
async function handleBulkRevise(payload) {
  const { toggleOffers = false } = payload;
  boostCancelled = false;

  const domain = await getEbayDomain();
  let hubTabId = null;

  try {
    sendBoostProgress(0, 0, 'Scanning active listings...');
    const { listings, tabId } = await scrapeAllActiveListings(domain, false);
    hubTabId = tabId;

    if (listings.length === 0) {
      return { success: true, message: 'No active listings found', revised: 0 };
    }

    sendBoostProgress(0, listings.length, `Found ${listings.length} listings to revise`);

    // Close hub tab
    if (hubTabId) {
      try { await chrome.tabs.remove(hubTabId); } catch (_) {}
      hubTabId = null;
    }

    let revised = 0;
    for (let i = 0; i < listings.length && !boostCancelled; i++) {
      const listing = listings[i];
      const shortTitle = (listing.title || '').substring(0, 40);
      sendBoostProgress(i + 1, listings.length, `Revising: ${shortTitle}...`);

      const product = { ebayItemId: listing.itemId, ebayDomain: domain };
      const result = await reviseEbayListing(product, { action: 'toggle_best_offer', enable: toggleOffers });

      if (result?.success) {
        revised++;
      } else {
        console.warn(`[DropFlow Boost] Revision failed for ${listing.itemId}: ${result?.error || 'unknown'}`);
      }

      await sleep(3000);
    }

    const summary = `Revised ${revised}/${listings.length} listings (Best Offer: ${toggleOffers ? 'ON' : 'OFF'})`;
    sendBoostComplete(listings.length, summary);
    return { success: true, message: summary, revised };
  } catch (error) {
    console.error('[DropFlow Boost] Bulk revise error:', error);
    return { error: error.message };
  } finally {
    if (hubTabId) {
      try { await chrome.tabs.remove(hubTabId); } catch (_) {}
    }
  }
}

/**
 * Send Offers: navigate to Seller Hub SIO-eligible listings and send offers.
 */
async function handleSendOffers(payload) {
  const { discountPct = 10 } = payload;
  boostCancelled = false;

  const domain = await getEbayDomain();
  let tabId = null;

  try {
    sendBoostProgress(0, 0, 'Opening eligible listings...');

    // Open Seller Hub filtered to SIO-eligible listings
    const url = `https://www.ebay.${domain}/sh/lst/active?pill_status=sioEligible&action=search`;
    const tab = await createTabAndWait(url, 60000);
    tabId = tab.id;
    await sleep(6000);

    // Use executeScript to interact with the Seller Hub offers UI
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (discount) => {
        const result = { sent: 0, eligible: 0, errors: [] };

        // Find listing rows with "Send offer" buttons
        const rows = document.querySelectorAll('tbody tr, [class*="listing-row"]');
        if (rows.length === 0) {
          // Try to count listings from page text
          const text = document.body?.textContent || '';
          const countMatch = text.match(/(\d+)\s+result/i);
          result.eligible = countMatch ? parseInt(countMatch[1], 10) : 0;
        } else {
          result.eligible = rows.length;
        }

        // Strategy 1: Select all checkboxes and use bulk "Send Offer" action
        const selectAllCb = document.querySelector('thead input[type="checkbox"], [aria-label*="select all" i]');
        if (selectAllCb && !selectAllCb.checked) {
          selectAllCb.click();
        }

        // Wait briefly, then look for the bulk actions dropdown
        const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));

        // Find "Send offer" or "Send Offer" in bulk actions
        const sendOfferBtn = allBtns.find(b => {
          const text = (b.textContent || '').trim().toLowerCase();
          return text.includes('send offer') || text.includes('send offers');
        });

        if (sendOfferBtn) {
          sendOfferBtn.click();
          result.clickedSendOffer = true;

          // The modal/panel should appear — we'll handle the discount input in a follow-up
          result.message = `Clicked Send Offer for ${result.eligible} eligible listings. Discount: ${discount}%`;
        } else {
          // Strategy 2: Try individual row "Send offer" actions
          let individualCount = 0;
          for (const row of rows) {
            const rowBtns = Array.from(row.querySelectorAll('button, a, [role="button"]'));
            const offerBtn = rowBtns.find(b => {
              const t = (b.textContent || '').trim().toLowerCase();
              return t.includes('send offer');
            });
            if (offerBtn) individualCount++;
          }
          result.individualButtons = individualCount;
          result.message = `Found ${individualCount} individual Send Offer buttons`;
        }

        return result;
      },
      args: [discountPct]
    });

    const scriptResult = results?.[0]?.result || {};
    await sleep(3000);

    // If the Send Offer modal opened, fill in the discount
    if (scriptResult.clickedSendOffer) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (discount) => {
          // Look for discount/price input in the modal
          const inputs = document.querySelectorAll('input[type="text"], input[type="number"]');
          for (const input of inputs) {
            const label = input.closest('label, .form-group, [class*="field"]')?.textContent || '';
            const placeholder = input.placeholder || '';
            if (/discount|percent|%|offer|price/i.test(label + placeholder)) {
              const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              if (nativeSetter) nativeSetter.call(input, String(discount));
              else input.value = String(discount);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              break;
            }
          }

          // Click confirm/send button
          const confirmBtns = Array.from(document.querySelectorAll('button'));
          const confirmBtn = confirmBtns.find(b => {
            const t = (b.textContent || '').trim().toLowerCase();
            return t === 'send' || t === 'send offer' || t === 'send offers' || t === 'confirm' || t === 'apply';
          });
          if (confirmBtn && !confirmBtn.disabled) {
            confirmBtn.click();
            return { confirmed: true };
          }
          return { confirmed: false };
        },
        args: [discountPct]
      });

      await sleep(5000);
    }

    const summary = `Sent offers at ${discountPct}% discount. ${scriptResult.message || ''}`;
    sendBoostComplete(scriptResult.eligible || 0, summary);
    return { success: true, message: summary, eligible: scriptResult.eligible || 0 };
  } catch (error) {
    console.error('[DropFlow Boost] Send offers error:', error);
    return { error: error.message };
  } finally {
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch (_) {}
    }
  }
}

/**
 * Review Offers: scrape pending buyer offers and accept/decline based on markup.
 */
async function handleReviewOffers(payload) {
  const { minMarkup = 15 } = payload;
  boostCancelled = false;

  const domain = await getEbayDomain();
  let tabId = null;

  try {
    sendBoostProgress(0, 0, 'Loading offers dashboard...');

    // Load tracked products to get source costs
    const stored = await chrome.storage.local.get(TRACKED_PRODUCTS);
    const trackedProducts = stored[TRACKED_PRODUCTS] || [];
    // Build lookup: ebayItemId → sourcePrice
    const sourcePriceMap = {};
    for (const p of trackedProducts) {
      if (p.ebayItemId && p.sourcePrice) {
        sourcePriceMap[p.ebayItemId] = p.sourcePrice;
      }
    }

    // Open eBay Offers dashboard
    const url = `https://www.ebay.${domain}/sh/mktv2/offers`;
    const tab = await createTabAndWait(url, 60000);
    tabId = tab.id;
    await sleep(6000);

    // Scrape pending offers from the page
    const scrapeResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const offers = [];
        // Look for offer rows in the dashboard
        const rows = document.querySelectorAll('tbody tr, [class*="offer-row"], [class*="offer-card"]');

        for (const row of rows) {
          try {
            // Extract item ID from links
            const link = row.querySelector('a[href*="/itm/"]');
            const itemId = link ? (link.href.match(/\/itm\/(\d+)/) || [])[1] : null;

            // Extract offer price
            const priceEls = row.querySelectorAll('[class*="price"], td');
            let offerPrice = 0;
            let listingPrice = 0;
            for (const el of priceEls) {
              const text = el.textContent.trim();
              const match = text.match(/[$£€]\s*([\d,]+\.?\d*)/);
              if (match) {
                const val = parseFloat(match[1].replace(/,/g, ''));
                if (val > 0) {
                  if (!offerPrice) offerPrice = val;
                  else if (!listingPrice) listingPrice = val;
                }
              }
            }

            // Extract buyer name
            const buyerEl = row.querySelector('[class*="buyer"], [class*="user"]');
            const buyer = buyerEl ? buyerEl.textContent.trim() : '';

            // Find accept/decline buttons
            const btns = Array.from(row.querySelectorAll('button'));
            const acceptBtn = btns.find(b => /accept/i.test(b.textContent));
            const declineBtn = btns.find(b => /decline|reject|counter/i.test(b.textContent));

            if (itemId || offerPrice > 0) {
              offers.push({
                itemId,
                offerPrice,
                listingPrice,
                buyer,
                hasAcceptBtn: !!acceptBtn,
                hasDeclineBtn: !!declineBtn
              });
            }
          } catch (_) {}
        }

        return { offers, totalRows: rows.length };
      }
    });

    const { offers = [], totalRows = 0 } = scrapeResults?.[0]?.result || {};

    if (offers.length === 0) {
      return { success: true, message: `No pending offers found (${totalRows} rows scanned)`, accepted: 0, declined: 0 };
    }

    sendBoostProgress(0, offers.length, `Found ${offers.length} pending offers`);

    let accepted = 0;
    let declined = 0;
    let skipped = 0;

    for (let i = 0; i < offers.length && !boostCancelled; i++) {
      const offer = offers[i];
      const sourcePrice = offer.itemId ? sourcePriceMap[offer.itemId] : null;

      if (!sourcePrice) {
        skipped++;
        sendBoostProgress(i + 1, offers.length, `Skipped offer (no source cost data)`);
        continue;
      }

      const markup = ((offer.offerPrice - sourcePrice) / sourcePrice) * 100;
      const shouldAccept = markup >= minMarkup;

      sendBoostProgress(i + 1, offers.length, `Offer $${offer.offerPrice} (${markup.toFixed(1)}% markup) → ${shouldAccept ? 'ACCEPT' : 'DECLINE'}`);

      // Click Accept or Decline via executeScript
      // Use itemId to find the correct row (not index — rows shift after accept/decline)
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (itemId, offerPrice, accept) => {
          const rows = document.querySelectorAll('tbody tr, [class*="offer-row"], [class*="offer-card"]');
          let targetRow = null;

          for (const row of rows) {
            // Match by item ID in links
            const link = row.querySelector('a[href*="/itm/"]');
            const rowItemId = link ? (link.href.match(/\/itm\/(\d+)/) || [])[1] : null;
            if (itemId && rowItemId === itemId) { targetRow = row; break; }

            // Fallback: match by offer price text
            if (!targetRow && offerPrice > 0) {
              const text = row.textContent || '';
              if (text.includes(offerPrice.toFixed(2))) { targetRow = row; }
            }
          }

          if (!targetRow) return { found: false };

          const btns = Array.from(targetRow.querySelectorAll('button'));
          if (accept) {
            const btn = btns.find(b => /accept/i.test(b.textContent));
            if (btn) { btn.click(); return { found: true, clicked: 'accept' }; }
          } else {
            const btn = btns.find(b => /decline|reject/i.test(b.textContent));
            if (btn) { btn.click(); return { found: true, clicked: 'decline' }; }
          }
          return { found: true, clicked: null };
        },
        args: [offer.itemId, offer.offerPrice, shouldAccept]
      });

      if (shouldAccept) accepted++;
      else declined++;

      await sleep(3000);
    }

    const summary = `Reviewed ${offers.length} offers: ${accepted} accepted, ${declined} declined, ${skipped} skipped`;
    sendBoostComplete(offers.length, summary);
    return { success: true, message: summary, accepted, declined, skipped };
  } catch (error) {
    console.error('[DropFlow Boost] Review offers error:', error);
    return { error: error.message };
  } finally {
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch (_) {}
    }
  }
}

/**
 * Schedule: save settings and create a chrome.alarm for recurring boost actions.
 */
async function handleScheduleBoost(payload) {
  const { schedule } = payload;

  // Save schedule settings (including the action settings for when the alarm fires)
  await chrome.storage.local.set({ [BOOST_SCHEDULE]: schedule });

  // Create chrome.alarm
  await chrome.alarms.create('boost-schedule', {
    periodInMinutes: schedule.intervalHours * 60
  });

  console.log(`[DropFlow Boost] Schedule set: ${schedule.action} every ${schedule.intervalHours}h`);
  return { success: true, message: `Scheduled: ${schedule.action} every ${schedule.intervalHours}h` };
}

async function handleCancelSchedule() {
  await chrome.storage.local.remove(BOOST_SCHEDULE);
  await chrome.alarms.clear('boost-schedule');
  console.log('[DropFlow Boost] Schedule cancelled');
  return { success: true, message: 'Schedule cancelled' };
}

// ============================
// Competitor Research
// ============================
async function handleResearchCompetitor(payload) {
  if (competitorRunning) {
    return { error: 'Research already running' };
  }

  const { usernames, filterDays = 30, concurrency = 3 } = payload;
  competitorRunning = true;
  competitorAbort = false;

  // Run in background
  runCompetitorResearch(usernames, { filterDays, concurrency });

  return { success: true, message: `Started researching ${usernames.length} competitors` };
}

async function runCompetitorResearch(usernames, options) {
  const { filterDays, concurrency } = options;
  let position = 0;

  for (const username of usernames) {
    if (competitorAbort) break;

    try {
      // Open eBay completed listings search for this seller
      const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=&_sacat=0&_ssn=${encodeURIComponent(username)}&_sop=10&LH_Complete=1&LH_Sold=1&rt=nc`;
      const tab = await createTabAndWait(searchUrl);
      await new Promise(r => setTimeout(r, 3000));

      // Competitor sold-listing extraction is planned for a future release.
      await chrome.tabs.remove(tab.id);

      position++;
      broadcastToExtensionPages({
        type: COMPETITOR_PROGRESS,
        current: position,
        total: usernames.length,
        currentUser: username
      });
    } catch (error) {
      console.error(`[DropFlow] Error researching ${username}:`, error);
    }

    // Save position for resume
    await chrome.storage.local.set({ [COMPETITOR_SCAN_POSITION]: position });
  }

  competitorRunning = false;
  broadcastToExtensionPages({ type: COMPETITOR_COMPLETE, total: position });
}

// ============================
// ChatGPT
// ============================
async function handleAskChatGpt(payload) {
  try {
    const { prompt, model } = payload;
    const result = await api.chat(
      [{ role: 'user', content: prompt }],
      model || 'gpt-4o-mini'
    );
    return { success: true, response: result.content };
  } catch (error) {
    return { error: error.message };
  }
}

// ============================
// Description Generation
// ============================
const DESCRIPTION_PROMPT_TEMPLATE = `You are an expert eBay listing description writer. Generate a professional, conversion-optimized product description in eBay-safe HTML.

RULES:
1. Output ONLY the HTML — no markdown, no code fences, no explanation
2. Use only eBay-safe HTML tags: <div>, <p>, <h2>, <h3>, <ul>, <ol>, <li>, <b>, <i>, <br>, <span>, <hr>, <table>, <tr>, <td>, <th>
3. Use inline styles only (no <style> blocks, no class attributes)
4. Do NOT use <script>, <link>, <iframe>, <form>, <img>, or any external resources
5. Be factual — only include information provided, never fabricate specs
6. Do NOT mention Amazon, the original seller, or the source
7. Do NOT include any images or image references
8. Keep it concise but informative (150-300 words)
9. Use a clean, modern layout with good visual hierarchy

PRODUCT DATA:
Title: {{TITLE}}
Features: {{BULLET_POINTS}}
Original Description: {{DESCRIPTION}}

Generate the eBay listing HTML description now:`;

async function handleGenerateDescription(payload) {
  try {
    const { title, bulletPoints, description } = payload;
    const prompt = DESCRIPTION_PROMPT_TEMPLATE
      .replace('{{TITLE}}', title || '')
      .replace('{{BULLET_POINTS}}', Array.isArray(bulletPoints) ? bulletPoints.join('\n- ') : (bulletPoints || ''))
      .replace('{{DESCRIPTION}}', description || '');

    const result = await api.chat(
      [{ role: 'user', content: prompt }],
      'gpt-4o-mini'
    );
    return { success: true, html: result.content };
  } catch (error) {
    return { error: error.message };
  }
}

// ============================
// eBay Draft API Headers
// ============================
function handleGetEbayHeaders(sender) {
  touchKeepAliveActivity('get-ebay-headers');
  const tabId = sender.tab?.id;
  if (!tabId) return { error: 'No tab ID' };

  const stored = ebayHeadersMap.get(tabId);
  if (!stored) return { error: 'No headers captured yet', headers: null, draftId: null };

  return {
    success: true,
    headers: stored.headers,
    draftId: stored.draftId,
    mediaUploadUrl: stored.mediaUploadUrl || null
  };
}

// ============================
// Item Specifics AI Generation
// ============================
const ITEM_SPECIFICS_PROMPT = `You are an eBay listing expert. Given product data and a list of required eBay item specific field names, suggest the most appropriate value for each field.

RULES:
1. Output ONLY valid JSON — no markdown, no code fences, no explanation
2. The JSON must be an object mapping each field name to its suggested value (string)
3. Use factual information from the product data only — never fabricate
4. For fields where you cannot determine a value, use "Details in Description"
5. Keep values concise (1-3 words typically)
6. For "Brand", extract the actual brand name from the product data
7. For "Type", "Style", "Material", etc., infer from the product details
8. For "MPN" (Manufacturer Part Number), use "Does Not Apply" if not found

PRODUCT DATA:
Title: {{TITLE}}
Features: {{BULLET_POINTS}}
Description: {{DESCRIPTION}}

REQUIRED FIELDS: {{FIELDS}}

Output the JSON object now:`;

async function handleGenerateItemSpecifics(payload) {
  try {
    const { requiredFields, productData } = payload;

    const prompt = ITEM_SPECIFICS_PROMPT
      .replace('{{TITLE}}', productData.title || '')
      .replace('{{BULLET_POINTS}}', Array.isArray(productData.bulletPoints)
        ? productData.bulletPoints.join('\n- ') : (productData.bulletPoints || ''))
      .replace('{{DESCRIPTION}}', productData.description || '')
      .replace('{{FIELDS}}', JSON.stringify(requiredFields));

    const result = await api.chat(
      [{ role: 'user', content: prompt }],
      'gpt-4o-mini'
    );

    // Parse the JSON response
    let specifics;
    try {
      // Strip markdown fences if present
      const cleaned = result.content.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
      specifics = JSON.parse(cleaned);
    } catch (parseErr) {
      console.warn('[DropFlow] Failed to parse item specifics JSON:', result.content);
      // Fallback: assign "Details in Description" to all fields
      specifics = {};
      for (const field of requiredFields) {
        specifics[field] = 'Details in Description';
      }
    }

    console.log('[DropFlow] AI item specifics generated:', specifics);
    return { success: true, specifics };
  } catch (error) {
    console.error('[DropFlow] Item specifics generation error:', error);
    return { error: error.message };
  }
}

// ============================
// Image Fetch (proxy for content scripts that can't cross-origin fetch)
// ============================
async function handleFetchImage(payload) {
  const { url } = payload;
  touchKeepAliveActivity('fetch-image');
  startSWKeepAlive();

  // Retry wrapper — service worker may get terminated mid-fetch, causing "Failed to fetch"
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[DropFlow] FETCH_IMAGE retry ${attempt + 1}/3 for: ${url.substring(0, 80)}`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }

      const isAliExpress = url.includes('alicdn') || url.includes('aliexpress') || url.includes('aliimg');

      // AbortController with 30s timeout to prevent indefinite hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const fetchOpts = {
        headers: { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
        signal: controller.signal
      };
      if (url.includes('amazon') || url.includes('media-amazon')) {
        fetchOpts.referrer = 'https://www.amazon.com/';
        fetchOpts.referrerPolicy = 'no-referrer-when-downgrade';
      }
      let response = await fetch(url, fetchOpts);

      // AliExpress CDN: if failed, try with referrer
      if (!response.ok && isAliExpress) {
        console.log(`[DropFlow] FETCH_IMAGE ${response.status} for alicdn, retrying with referrer...`);
        response = await fetch(url, {
          ...fetchOpts,
          referrer: 'https://www.aliexpress.com/',
          referrerPolicy: 'no-referrer-when-downgrade'
        });
      }

      // AliExpress CDN: if still failed, try stripping size suffix (e.g. _640x640.jpg, _Q90.jpg_)
      if (!response.ok && isAliExpress) {
        const cleanedUrl = url
          .replace(/_\d+x\d+Q?\d*\.\w+_?$/, '')  // _640x640Q90.jpg_ suffix
          .replace(/\.jpg_\d+x\d+.*$/, '.jpg')    // .jpg_640x640 suffix
          .replace(/_Q\d+\.jpg_?$/, '.jpg')        // _Q90.jpg_ suffix
          .replace(/\.\w+_\d+x\d+.*$/, '.jpg');   // .png_640x640Q90.png_ suffix
        if (cleanedUrl !== url) {
          console.log(`[DropFlow] FETCH_IMAGE retry with cleaned URL: ${cleanedUrl.substring(0, 80)}`);
          response = await fetch(cleanedUrl, fetchOpts);
          if (!response.ok) {
            // Also try cleaned URL with referrer
            response = await fetch(cleanedUrl, {
              ...fetchOpts,
              referrer: 'https://www.aliexpress.com/',
              referrerPolicy: 'no-referrer-when-downgrade'
            });
          }
        }
      }

      // Amazon fallback: try without referrer (some CDN nodes block referrer-based requests)
      if (!response.ok && (url.includes('amazon') || url.includes('media-amazon'))) {
        console.log(`[DropFlow] FETCH_IMAGE ${response.status} for Amazon, retrying without referrer...`);
        response = await fetch(url, {
          headers: { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
          signal: controller.signal
        });
      }

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      // Convert to base64 data URL for transfer via message passing
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const dataUrl = `data:${blob.type || 'image/jpeg'};base64,${base64}`;
      return { success: true, dataUrl, mimeType: blob.type || 'image/jpeg' };
    } catch (error) {
      if (attempt === 2) {
        console.warn(`[DropFlow] FETCH_IMAGE failed after 3 attempts: ${error.message}`);
        return { error: error.message };
      }
      // Retry on network errors ("Failed to fetch", aborted, etc.)
    }
  }
  return { error: 'Failed after 3 attempts' };
}

// ============================
// Image Upload to eBay (proxy for content scripts)
// ============================
/**
 * Upload an image to eBay's media service on behalf of the content script.
 * The service worker has captured auth headers and can proxy the upload.
 * @param {object} payload - { imageDataUrl, ebayDomain }
 * @param {object} sender - Chrome message sender (used to get tabId)
 */
async function handleUploadEbayImage(payload, sender) {
  const { imageDataUrl, filename } = payload;
  touchKeepAliveActivity('upload-ebay-image');
  startSWKeepAlive();
  const tabId = sender.tab?.id;

  if (!tabId) return { error: 'No tab ID' };
  if (!imageDataUrl) return { error: 'No image data provided' };

  const stored = ebayHeadersMap.get(tabId);
  if (!stored || !stored.headers) {
    return { error: 'No captured eBay headers for this tab' };
  }

  // Convert data URL to Blob
  try {
    const [header, base64] = imageDataUrl.split(',');
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mime });

    // Determine eBay domain from stored URL
    let ebayHost;
    try {
      ebayHost = new URL(stored.url).host;
    } catch {
      ebayHost = 'www.ebay.com';
    }

    // Build headers (exclude Content-Type — FormData sets its own boundary)
    const headers = {};
    for (const [key, value] of Object.entries(stored.headers)) {
      if (key.toLowerCase() !== 'content-type') {
        headers[key] = value;
      }
    }

    // Try the captured media upload URL first, then common patterns
    const endpoints = [];
    if (stored.mediaUploadUrl) {
      endpoints.push(stored.mediaUploadUrl);
    }
    endpoints.push(
      `https://${ebayHost}/sell/media/api/image`,
      `https://${ebayHost}/sell/media/imageUpload`,
      `https://${ebayHost}/sell/media/upload/image`,
      `https://${ebayHost}/lstng/api/listing_draft/${stored.draftId}/image`
    );

    for (const endpoint of endpoints) {
      try {
        const formData = new FormData();
        formData.append('file', blob, filename || 'product-image.jpg');

        const resp = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: formData
        });

        if (resp.ok) {
          const data = await resp.json().catch(() => null);
          if (data) {
            const picUrl = data.url || data.imageUrl || data.pictureUrl ||
                           data.imageURL || data.pictureURL ||
                           (data.image && (data.image.url || data.image.imageUrl)) ||
                           (data.data && (data.data.url || data.data.imageUrl));
            if (picUrl) {
              console.log(`[DropFlow] Image uploaded via service worker proxy: ${picUrl.substring(0, 60)}`);
              return { success: true, imageUrl: picUrl };
            }
            console.log(`[DropFlow] Upload response (no URL):`, JSON.stringify(data).substring(0, 200));
            return { success: true, data };
          }
        } else if (resp.status !== 404) {
          const text = await resp.text().catch(() => '');
          console.warn(`[DropFlow] Upload ${resp.status} from ${endpoint}:`, text.substring(0, 100));
        }
      } catch (e) {
        // Try next endpoint
      }
    }

    return { error: 'All upload endpoints failed' };
  } catch (error) {
    console.error('[DropFlow] Image upload proxy error:', error);
    return { error: error.message };
  }
}

// ============================
// Stock & Price Monitor
// ============================

async function getMonitorSettings() {
  const result = await chrome.storage.local.get(MONITOR_SETTINGS);
  return result[MONITOR_SETTINGS] || DEFAULTS[MONITOR_SETTINGS];
}

async function getTrackedProducts() {
  const result = await chrome.storage.local.get(TRACKED_PRODUCTS);
  return result[TRACKED_PRODUCTS] || [];
}

async function saveTrackedProducts(products) {
  await chrome.storage.local.set({ [TRACKED_PRODUCTS]: products });
}

/**
 * Atomic read-modify-write for a single product.
 * Minimises the window between read and write to avoid race conditions
 * when multiple concurrent checks run via the semaphore.
 * @param {string} productId
 * @param {function} updateFn - receives product object, mutate in-place
 * @returns {object|null} the updated product, or null if not found
 */
async function atomicUpdateProduct(productId, updateFn) {
  const products = await getTrackedProducts();
  const idx = products.findIndex(p => p.id === productId);
  if (idx === -1) return null;
  updateFn(products[idx]);
  await saveTrackedProducts(products);
  return products[idx];
}

async function getMonitorAlerts() {
  const result = await chrome.storage.local.get(MONITOR_ALERTS);
  return result[MONITOR_ALERTS] || [];
}

async function addMonitorAlert(alert) {
  const alerts = await getMonitorAlerts();
  alerts.unshift(alert); // newest first
  // Keep max 500 alerts
  if (alerts.length > 500) alerts.length = 500;
  await chrome.storage.local.set({ [MONITOR_ALERTS]: alerts });

  // Badge
  const settings = await getMonitorSettings();
  if (settings.alertBadge) {
    const unread = alerts.filter(a => !a.read).length;
    chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
  }

  // Chrome notification
  if (settings.alertNotification) {
    chrome.notifications.create(alert.id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'DropFlow Monitor',
      message: alert.message
    });
  }

  // Broadcast to dashboard
  broadcastToExtensionPages({ type: MONITOR_ALERT, alert });
}

// --- CRUD Handlers ---

async function handleAddTrackedProduct(payload) {
  const { product } = payload;
  if (!product || (!product.sourceUrl && !product.ebayItemId)) {
    return { error: 'sourceUrl or ebayItemId is required' };
  }

  const products = await getTrackedProducts();

  // Prevent duplicates by ebayItemId (primary key for tracking)
  if (product.ebayItemId) {
    const exists = products.find(p => p.ebayItemId === product.ebayItemId);
    if (exists) {
      return { error: 'Product already being tracked', existingId: exists.id };
    }
  }

  // Determine source type and ID
  let sourceType = 'amazon';
  let sourceId = '';
  let sourceDomain = '';
  if (product.sourceUrl) {
    const isAliExpress = product.sourceUrl.includes('aliexpress.');
    sourceType = isAliExpress ? 'aliexpress' : 'amazon';
    sourceId = isAliExpress
      ? extractAliExpressProductId(product.sourceUrl)
      : extractAsin(product.sourceUrl);
    sourceDomain = isAliExpress ? 'aliexpress' : extractAmazonDomain(product.sourceUrl);
  }

  const tracked = {
    id: uid(),
    sourceType,
    sourceUrl: product.sourceUrl,
    sourceId: sourceId || '',
    sourceDomain,
    ebayItemId: product.ebayItemId,
    ebayDomain: product.ebayDomain || 'com',
    ebayTitle: product.ebayTitle || '',
    ebayPrice: product.ebayPrice || 0,
    ebayCurrency: product.ebayCurrency || 'USD',
    sourcePrice: product.sourcePrice || 0,
    sourceCurrency: product.sourceCurrency || 'USD',
    sourceInStock: null,
    sourceQuantity: null,
    lastChecked: null,
    lastChanged: null,
    status: 'active',
    errorMessage: null,
    addedAt: new Date().toISOString(),
    checkCount: 0,
    changeCount: 0
  };

  products.push(tracked);
  await saveTrackedProducts(products);
  return { success: true, product: tracked };
}

async function handleRemoveTrackedProduct(payload) {
  const { productId } = payload;
  let products = await getTrackedProducts();
  products = products.filter(p => p.id !== productId);
  await saveTrackedProducts(products);
  return { success: true };
}

async function handleUpdateTrackedProduct(payload) {
  const { productId, updates } = payload;
  const products = await getTrackedProducts();
  const idx = products.findIndex(p => p.id === productId);
  if (idx === -1) return { error: 'Product not found' };
  Object.assign(products[idx], updates);
  await saveTrackedProducts(products);
  return { success: true, product: products[idx] };
}

async function handleGetTrackedProducts() {
  const products = await getTrackedProducts();
  return { success: true, products };
}

// --- Settings Handlers ---

async function handleGetMonitorSettings() {
  const settings = await getMonitorSettings();
  const running = (await chrome.storage.local.get(MONITOR_RUNNING))[MONITOR_RUNNING] || false;
  const lastRun = (await chrome.storage.local.get(MONITOR_LAST_RUN))[MONITOR_LAST_RUN] || null;
  const stats = (await chrome.storage.local.get(MONITOR_STATS))[MONITOR_STATS] || {};
  const alerts = await getMonitorAlerts();
  return { success: true, settings, running, lastRun, stats, alerts };
}

async function handleSaveMonitorSettings(payload) {
  const { settings } = payload;
  await chrome.storage.local.set({ [MONITOR_SETTINGS]: settings });

  // If monitor is running, update the alarm interval
  const running = (await chrome.storage.local.get(MONITOR_RUNNING))[MONITOR_RUNNING];
  if (running && settings.intervalMinutes) {
    await chrome.alarms.create(MONITOR_ALARM_NAME, {
      periodInMinutes: Math.max(1, settings.intervalMinutes)
    });
  }
  return { success: true };
}

// --- Start / Stop ---

async function handleStartMonitor() {
  const settings = await getMonitorSettings();
  const products = await getTrackedProducts();

  if (products.length === 0) {
    return { error: 'No products to monitor. Add products first.' };
  }

  await chrome.storage.local.set({ [MONITOR_RUNNING]: true });
  await chrome.alarms.create(MONITOR_ALARM_NAME, {
    delayInMinutes: 0.1, // Fire almost immediately for the first run
    periodInMinutes: Math.max(1, settings.intervalMinutes)
  });

  console.log(`[DropFlow Monitor] Started — checking ${products.length} products every ${settings.intervalMinutes} min`);
  return { success: true, productCount: products.length };
}

async function handleStopMonitor() {
  await chrome.storage.local.set({ [MONITOR_RUNNING]: false });
  await chrome.alarms.clear(MONITOR_ALARM_NAME);
  monitorCycleRunning = false;
  console.log('[DropFlow Monitor] Stopped');
  return { success: true };
}

// --- On-Demand Single Check ---

async function handleCheckProductNow(payload) {
  const { productId } = payload;
  const products = await getTrackedProducts();
  const product = products.find(p => p.id === productId);
  if (!product) return { error: 'Product not found' };

  const settings = await getMonitorSettings();
  const result = await checkSingleProduct(product, settings);
  return { success: true, result };
}

// --- Alarm Listener ---

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // --- Keep-Alive Alarm ---
  if (alarm.name === KEEPALIVE_ALARM) {
    // No-op: just waking the SW is enough. Check if we still need it.
    // IMPORTANT: After SW restart, in-memory flags are all false. Check storage
    // for pending listing data (pendingListing_* keys) before killing keepalive.
    if (!aliBulkRunning && !bulkPosterRunning && !competitorRunning && !skuBackfillRunning) {
      // Check orchestration state — if present and fresh, keep alive
      try {
        const orchState = await getOrchestrationState();
        if (orchState && (Date.now() - (orchState.updatedAt || 0)) < 15 * 60 * 1000) {
          console.log(`[DropFlow] Keep-alive alarm: orchestration state active (stage=${orchState.stage}), keeping alive`);
          touchKeepAliveActivity('orchestration-state-active');
          return;
        }
      } catch (_) {}

      const idleMs = Date.now() - (lastKeepAliveActivityAt || 0);
      if (lastKeepAliveActivityAt && idleMs < KEEPALIVE_IDLE_GRACE_MS) {
        console.log(`[DropFlow] Keep-alive alarm: recent activity ${Math.round(idleMs/1000)}s ago, keeping alive`);
        return;
      }
      try {
        const allData = await chrome.storage.local.get(null);
        const hasPending = Object.keys(allData).some(k => k.startsWith('pendingListing_'));
        if (hasPending) {
          console.log('[DropFlow] Keep-alive alarm: pending listing data found in storage, keeping alive');
          // Recovery: check if any eBay tab needs form-filler injection
          try {
            const pendingKeys = Object.keys(allData).filter(k => k.startsWith('pendingListing_'));
            for (const key of pendingKeys) {
              const tabId = parseInt(key.replace('pendingListing_', ''), 10);
              if (isNaN(tabId)) continue;
              try {
                const tab = await chrome.tabs.get(tabId);
                if (tab.url && tab.url.includes('/lstng') && tab.status === 'complete') {
                  // Check if form-filler is already loaded
                  const [check] = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => !!window.__dropflow_form_filler_loaded
                  });
                  if (!check.result) {
                    await chrome.scripting.executeScript({
                      target: { tabId, allFrames: true },
                      files: ['content-scripts/ebay/form-filler.js']
                    });
                    console.log(`[DropFlow] Alarm recovery: injected form-filler on tab ${tabId}`);
                  }
                }
              } catch (_) {} // Tab may be closed
            }
          } catch (e) {
            console.warn('[DropFlow] Alarm recovery error:', e.message);
          }
          return;
        }
      } catch (_) {}
      stopSWKeepAlive();
    }
    return;
  }

  // --- Boost Schedule Alarm ---
  if (alarm.name === 'boost-schedule') {
    const result = await chrome.storage.local.get(BOOST_SCHEDULE);
    const schedule = result[BOOST_SCHEDULE];
    if (!schedule) return;

    console.log(`[DropFlow Boost] Scheduled alarm fired: ${schedule.action}`);
    try {
      switch (schedule.action) {
        case 'end-sell':
          await handleEndLowPerformers(schedule.settings || { minSold: 0, minViews: 0, hoursRemaining: 24, autoRelist: true });
          break;
        case 'bulk-revise':
          await handleBulkRevise(schedule.settings || { toggleOffers: false });
          break;
        case 'send-offers':
          await handleSendOffers(schedule.settings || { discountPct: 10 });
          break;
      }
    } catch (e) {
      console.error('[DropFlow Boost] Scheduled action failed:', e);
    }
    return;
  }

  // --- Sale Poll Alarm ---
  if (alarm.name === SALE_POLL_ALARM) {
    console.log('[DropFlow] Sale poll alarm fired');
    runSalePollCycle().then(result => {
      if (result.newOrders > 0) {
        console.log(`[DropFlow SalePoller] Created ${result.newOrders} new auto-orders`);
      }
      if (result.errors.length > 0) {
        console.warn('[DropFlow SalePoller] Errors:', result.errors);
      }
    }).catch(e => {
      console.error('[DropFlow SalePoller] Poll cycle failed:', e);
    });
    return;
  }

  // --- Monitor Alarm ---
  if (alarm.name !== MONITOR_ALARM_NAME) return;

  const running = (await chrome.storage.local.get(MONITOR_RUNNING))[MONITOR_RUNNING];
  if (!running) {
    await chrome.alarms.clear(MONITOR_ALARM_NAME);
    return;
  }

  if (monitorCycleRunning) {
    console.log('[DropFlow Monitor] Cycle already running, skipping');
    return;
  }

  await runMonitorCycle();
});

// --- Main Monitor Cycle ---

async function runMonitorCycle() {
  monitorCycleRunning = true;
  console.log('[DropFlow Monitor] Starting check cycle...');

  // Snapshot current tabs so the safety sweep only closes tabs opened during this cycle
  const existingTabs = await chrome.tabs.query({});
  const preExistingTabIds = new Set(existingTabs.map(t => t.id));

  const settings = await getMonitorSettings();
  const products = await getTrackedProducts();
  const activeProducts = products.filter(p => p.status === 'active');

  if (activeProducts.length === 0) {
    monitorCycleRunning = false;
    return;
  }

  // Check for soft-block cooldown
  const blockData = (await chrome.storage.local.get(MONITOR_SOFT_BLOCK))[MONITOR_SOFT_BLOCK];
  if (blockData && Date.now() < blockData.until) {
    const remaining = Math.ceil((blockData.until - Date.now()) / 1000);
    console.log(`[DropFlow Monitor] Soft-block cooldown — ${remaining}s remaining`);
    broadcastToExtensionPages({
      type: MONITOR_PROGRESS,
      status: 'blocked',
      message: `Rate-limited. Resuming in ${remaining}s...`
    });
    monitorCycleRunning = false;
    return;
  }

  const totalCount = activeProducts.length;
  let checkedCount = 0;
  let changedCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  broadcastToExtensionPages({
    type: MONITOR_PROGRESS,
    status: 'running',
    message: `Checking ${totalCount} products...`,
    total: totalCount,
    checked: 0
  });

  // Process with concurrency limit
  const sem = semaphore(settings.concurrency || 2);
  const checkPromises = activeProducts.map(async (product) => {
    await sem.acquire();
    try {
      // Check if monitor was stopped mid-cycle
      const stillRunning = (await chrome.storage.local.get(MONITOR_RUNNING))[MONITOR_RUNNING];
      if (!stillRunning) return;

      const result = await checkSingleProduct(product, settings);
      if (result.skipped) {
        skippedCount++;
      } else {
        checkedCount++;
        if (result.changed) changedCount++;
        if (result.error) errorCount++;
      }

      broadcastToExtensionPages({
        type: MONITOR_PROGRESS,
        status: 'running',
        total: totalCount,
        checked: checkedCount,
        changed: changedCount,
        errors: errorCount,
        skipped: skippedCount,
        lastProduct: product.ebayTitle || product.sourceId
      });

      // Delay between checks to avoid rate limits (only for actual checks, not skips)
      if (!result.skipped && settings.delayBetweenMs > 0) {
        await sleep(settings.delayBetweenMs);
      }
    } finally {
      sem.release();
    }
  });

  await Promise.all(checkPromises);

  // Save run stats
  const now = new Date().toISOString();
  await chrome.storage.local.set({
    [MONITOR_LAST_RUN]: now,
    [MONITOR_STATS]: { lastRun: now, totalChecked: checkedCount, changed: changedCount, errors: errorCount, skipped: skippedCount }
  });

  const parts = [`${checkedCount} checked`, `${changedCount} changed`];
  if (skippedCount > 0) parts.push(`${skippedCount} unlinked`);
  if (errorCount > 0) parts.push(`${errorCount} errors`);
  const summaryMsg = `Done. ${parts.join(', ')}.`;

  broadcastToExtensionPages({
    type: MONITOR_PROGRESS,
    status: 'complete',
    total: totalCount,
    checked: checkedCount,
    changed: changedCount,
    errors: errorCount,
    skipped: skippedCount,
    message: summaryMsg
  });

  console.log(`[DropFlow Monitor] Cycle complete: ${summaryMsg}`);

  // Safety sweep: close any orphaned tabs opened during this cycle
  await closeOrphanedMonitorTabs(preExistingTabIds);

  monitorCycleRunning = false;
}

/**
 * Safety sweep: close any tabs that were opened during the monitor cycle
 * but not properly cleaned up. Only closes tabs NOT in the pre-existing set
 * and matching known supplier/eBay URL patterns. This avoids closing
 * the user's own browsing tabs.
 */
async function closeOrphanedMonitorTabs(preExistingTabIds) {
  try {
    const tabs = await chrome.tabs.query({});
    const monitorPatterns = [
      /^https?:\/\/(www\.)?amazon\./,
      /^https?:\/\/(www\.)?aliexpress\.com\/item\//,
      /^https?:\/\/(www\.)?ebay\.[^/]+\/sl\/revise/
    ];

    let closed = 0;
    for (const tab of tabs) {
      // Skip tabs that existed before the cycle (user's own tabs)
      if (preExistingTabIds.has(tab.id)) continue;
      // Skip pinned tabs
      if (tab.pinned) continue;
      const url = tab.url || tab.pendingUrl || '';
      if (monitorPatterns.some(p => p.test(url))) {
        try {
          await chrome.tabs.remove(tab.id);
          closed++;
        } catch (_) {}
      }
    }
    if (closed > 0) {
      console.log(`[DropFlow Monitor] Safety sweep: closed ${closed} orphaned tab(s)`);
    }
  } catch (err) {
    console.warn('[DropFlow Monitor] Tab cleanup sweep failed:', err.message);
  }
}

// --- Single Product Check ---

async function checkSingleProduct(product, settings) {
  // Skip products without a source URL (imported from eBay but no supplier linked)
  if (!product.sourceUrl) {
    return { skipped: true, message: 'No supplier URL linked' };
  }

  // Auto-correct Amazon domain mismatch: if ebayDomain is e.g. 'com.au' but sourceUrl
  // points to amazon.com, rebuild the URL with the correct regional domain.
  if (product.sourceType !== 'aliexpress' && product.ebayDomain && product.sourceUrl.includes('amazon.')) {
    const EBAY_TO_AMZ = { 'com': 'www.amazon.com', 'ca': 'www.amazon.ca', 'co.uk': 'www.amazon.co.uk',
      'com.au': 'www.amazon.com.au', 'de': 'www.amazon.de', 'fr': 'www.amazon.fr',
      'it': 'www.amazon.it', 'es': 'www.amazon.es', 'nl': 'www.amazon.nl' };
    const expectedDomain = EBAY_TO_AMZ[product.ebayDomain];
    if (expectedDomain && !product.sourceUrl.includes(expectedDomain)) {
      const correctedUrl = product.sourceUrl.replace(/www\.amazon\.[a-z.]+/, expectedDomain);
      if (correctedUrl !== product.sourceUrl) {
        console.log(`[DropFlow Monitor] Auto-correcting Amazon domain: ${product.sourceUrl} → ${correctedUrl}`);
        product.sourceUrl = correctedUrl;
        // Persist the fix
        await atomicUpdateProduct(product.id, p => { p.sourceUrl = correctedUrl; });
      }
    }
  }

  let supplierData;
  try {
    if (product.sourceType === 'aliexpress') {
      supplierData = await checkAliExpressProduct(product);
    } else {
      supplierData = await checkAmazonProduct(product);
    }
  } catch (err) {
    console.error(`[DropFlow Monitor] Error checking ${product.sourceId}:`, err);
    await atomicUpdateProduct(product.id, p => {
      p.status = 'error';
      p.errorMessage = err.message || 'Check failed';
      p.lastChecked = new Date().toISOString();
      p.checkCount++;
    });
    return { error: true, message: err.message };
  }

  // Handle soft-block (Amazon 503)
  if (supplierData.softBlock) {
    await chrome.storage.local.set({
      [MONITOR_SOFT_BLOCK]: { until: Date.now() + 120000 }
    });
    console.warn('[DropFlow Monitor] Amazon soft-block detected — pausing 120s');
    return { error: true, message: 'Rate limited by Amazon' };
  }

  // Handle scrape error (all methods failed) — don't change stock/price
  if (supplierData.error) {
    console.warn(`[DropFlow Monitor] Scrape error for ${product.sourceId}: ${supplierData.message}`);
    await atomicUpdateProduct(product.id, p => {
      p.lastChecked = new Date().toISOString();
      p.checkCount++;
    });
    return { changed: false, type: 'scrape_error', message: supplierData.message };
  }

  // Handle product not found
  if (supplierData.notFound) {
    await atomicUpdateProduct(product.id, p => {
      p.sourceInStock = false;
      p.lastChecked = new Date().toISOString();
      p.lastChanged = new Date().toISOString();
      p.checkCount++;
      p.changeCount++;
    });

    await addMonitorAlert({
      id: uid(),
      productId: product.id,
      type: 'not_found',
      message: `Product removed from supplier: ${product.ebayTitle || product.sourceId}`,
      oldValue: { inStock: product.sourceInStock, price: product.sourcePrice },
      newValue: { inStock: false, price: null },
      actionTaken: await executeOutOfStockAction(product, settings),
      timestamp: new Date().toISOString(),
      read: false
    });

    return { changed: true, type: 'not_found' };
  }

  const oldPrice = product.sourcePrice;
  const oldInStock = product.sourceInStock;
  const newPrice = supplierData.price;
  const newInStock = supplierData.inStock;

  let changed = false;
  let changeType = null;
  let newEbayPrice = null;

  // --- Stock change detection ---
  // Only act on stock changes if we successfully extracted a price (price > 0).
  // A price of 0 means the scrape was incomplete — don't trust the stock status
  // enough to modify eBay listings (could cause false OOS removals).
  if (newPrice === 0 && oldPrice > 0) {
    console.warn(`[DropFlow Monitor] Scrape returned price=0 for ${product.sourceId} — keeping previous data, skipping stock actions`);
    // Still update lastChecked but don't change stock/price or trigger actions
    await atomicUpdateProduct(product.id, p => {
      p.lastChecked = new Date().toISOString();
      p.checkCount++;
    });
    return { changed: false, type: 'incomplete_scrape' };
  }

  if (oldInStock && !newInStock) {
    changed = true;
    changeType = 'out_of_stock';

    const actionTaken = await executeOutOfStockAction(product, settings);
    await addMonitorAlert({
      id: uid(),
      productId: product.id,
      type: 'out_of_stock',
      message: `Out of stock: ${product.ebayTitle || product.sourceId}`,
      oldValue: { inStock: true, price: oldPrice },
      newValue: { inStock: false, price: newPrice },
      actionTaken,
      timestamp: new Date().toISOString(),
      read: false
    });
  } else if (!oldInStock && newInStock) {
    changed = true;
    changeType = 'restocked';

    let actionTaken = await executeRestockAction(product, settings);

    await addMonitorAlert({
      id: uid(),
      productId: product.id,
      type: 'restocked',
      message: `Back in stock: ${product.ebayTitle || product.sourceId}`,
      oldValue: { inStock: false, price: oldPrice },
      newValue: { inStock: true, price: newPrice },
      actionTaken,
      timestamp: new Date().toISOString(),
      read: false
    });
  }

  // --- Price change detection ---
  if (newInStock && newPrice > 0 && oldPrice > 0) {
    const pctChange = Math.abs(newPrice - oldPrice) / oldPrice * 100;

    if (pctChange >= (settings.priceChangeThresholdPct || 5)) {
      changed = true;
      const direction = newPrice > oldPrice ? 'price_up' : 'price_down';
      changeType = changeType || direction;

      let actionTaken = 'Alert only';

      if (settings.priceAutoUpdate) {
        newEbayPrice = calculateEbayPrice(newPrice, settings);
        actionTaken = await executePriceUpdateAction(product, newEbayPrice);
      }

      await addMonitorAlert({
        id: uid(),
        productId: product.id,
        type: direction,
        message: `Price ${direction === 'price_up' ? 'increased' : 'decreased'}: ${product.ebayTitle || product.sourceId} (${formatPrice(oldPrice, product.sourceCurrency)} → ${formatPrice(newPrice, product.sourceCurrency)})`,
        oldValue: { price: oldPrice },
        newValue: { price: newPrice, suggestedEbayPrice: newEbayPrice },
        actionTaken,
        timestamp: new Date().toISOString(),
        read: false
      });
    }
  }

  // Single atomic update for the product after all checks complete
  const finalChanged = changed;
  const updated = await atomicUpdateProduct(product.id, p => {
    p.sourcePrice = newPrice || p.sourcePrice;
    p.sourceInStock = newInStock;
    p.sourceQuantity = supplierData.quantity;
    p.lastChecked = new Date().toISOString();
    p.checkCount++;
    if (finalChanged) {
      p.lastChanged = new Date().toISOString();
      p.changeCount++;
    }
    if (newEbayPrice !== null) {
      p.ebayPrice = newEbayPrice;
    }
    p.status = 'active';
    p.errorMessage = null;
  });

  if (!updated) {
    return { error: true, message: 'Product disappeared from list' };
  }

  // Broadcast result
  broadcastToExtensionPages({
    type: MONITOR_CHECK_RESULT,
    productId: product.id,
    changed,
    changeType,
    supplierData
  });

  return { changed, type: changeType };
}

// --- SKU Backfill Orchestrator ---

async function handleStartSkuBackfill(payload) {
  if (skuBackfillRunning) {
    return { error: 'SKU backfill already running' };
  }

  const { items, concurrency = 1, delayMs = 3000 } = payload;
  if (!items || items.length === 0) {
    return { error: 'No items to backfill' };
  }

  skuBackfillRunning = true;
  skuBackfillPaused = false;
  skuBackfillAbort = false;

  // Fire-and-forget — progress comes via broadcasts
  runSkuBackfill(items, { concurrency, delayMs });

  return { success: true, message: `Started SKU backfill for ${items.length} items` };
}

async function runSkuBackfill(items, options) {
  const { concurrency = 1, delayMs = 3000 } = options;
  const results = [];
  let completed = 0;
  const sem = semaphore(concurrency);

  async function processItem(item, index) {
    await sem.acquire();

    if (skuBackfillAbort) { sem.release(); return; }

    // Pause loop
    while (skuBackfillPaused && !skuBackfillAbort) {
      await sleep(500);
    }
    if (skuBackfillAbort) { sem.release(); return; }

    let result;
    let tabId = null;

    try {
      const { ebayItemId, ebayDomain, customLabel, productId, sourceUrl } = item;
      console.log(`[DropFlow SKU] ${index + 1}/${items.length}: Setting "${customLabel}" on item ${ebayItemId}`);

      // 1. Construct revision URL — try multiple patterns (eBay migrated from /lstng to /sl/)
      const domain = ebayDomain || 'com';
      const revisionUrls = [
        `https://www.ebay.${domain}/sl/revise/${ebayItemId}`,
        `https://www.ebay.${domain}/sl/revise?itemId=${ebayItemId}`,
        `https://www.ebay.${domain}/lstng?mode=ReviseItem&itemId=${ebayItemId}`,
      ];
      const revisionUrl = revisionUrls[0]; // Try the most likely URL first

      // 2. Open tab and wait for load
      const tab = await createTabAndWait(revisionUrl, 45000);
      tabId = tab.id;

      // 3. Wait for page to settle
      await sleep(3000);

      // 4. Send SET_CUSTOM_LABEL message to form-filler content script
      let response;
      try {
        response = await Promise.race([
          chrome.tabs.sendMessage(tabId, { type: 'SET_CUSTOM_LABEL', customLabel }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('SET_CUSTOM_LABEL timed out (60s)')), 60000))
        ]);
      } catch (e) {
        // Content script may not have loaded — inject and retry
        console.warn(`[DropFlow SKU] Direct message failed: ${e.message}, injecting script...`);
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content-scripts/ebay/form-filler.js']
          });
        } catch (_) { /* ignore injection errors */ }
        await sleep(2000);
        response = await Promise.race([
          chrome.tabs.sendMessage(tabId, { type: 'SET_CUSTOM_LABEL', customLabel }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('SET_CUSTOM_LABEL retry timed out')), 60000))
        ]);
      }

      if (response?.error) {
        throw new Error(response.error);
      }

      // 5. Wait for eBay to process the revision
      await sleep(5000);

      // 6. Update tracked product record with source info
      if (productId && sourceUrl) {
        const isAli = sourceUrl.includes('aliexpress.');
        const updates = {
          sourceUrl,
          sourceType: isAli ? 'aliexpress' : 'amazon',
          sourceId: customLabel
        };
        if (!isAli) {
          const domainMatch = sourceUrl.match(/amazon\.([a-z.]+)\//);
          updates.sourceDomain = domainMatch ? domainMatch[1] : 'com';
        } else {
          updates.sourceDomain = 'aliexpress';
        }
        await handleUpdateTrackedProduct({ productId, updates });
      }

      result = { index, ebayItemId, status: 'success', message: `Custom Label set to "${customLabel}"` };
    } catch (error) {
      console.error(`[DropFlow SKU] Error on item ${index + 1}:`, error.message);
      result = { index, ebayItemId: item.ebayItemId, status: 'error', message: error.message };
    } finally {
      if (tabId) {
        try { await chrome.tabs.remove(tabId); } catch (_) { /* tab may already be closed */ }
      }
    }

    results.push(result);
    completed++;

    broadcastToExtensionPages({
      type: SKU_BACKFILL_PROGRESS,
      current: completed,
      total: items.length,
      successCount: results.filter(r => r.status === 'success').length,
      failCount: results.filter(r => r.status === 'error').length,
      lastItem: item.ebayItemId,
      result
    });

    // Rate limiting delay
    if (delayMs > 0) await sleep(delayMs);

    sem.release();
  }

  const promises = items.map((item, i) => processItem(item, i));
  await Promise.allSettled(promises);

  skuBackfillRunning = false;

  broadcastToExtensionPages({
    type: SKU_BACKFILL_COMPLETE,
    total: items.length,
    results,
    successCount: results.filter(r => r.status === 'success').length,
    failCount: results.filter(r => r.status === 'error').length
  });
}

// --- Supplier Checkers ---

async function checkAmazonProduct(product) {
  const url = product.sourceUrl.includes('?')
    ? product.sourceUrl + '&th=1&psc=1'
    : product.sourceUrl + '?th=1&psc=1';

  let tab;
  try {
    tab = await createTabAndWait(url, 30000);
  } catch (err) {
    return { error: true, message: 'Tab load timeout' };
  }

  try {
    // Wait for page to load — activate tab briefly so JS isn't throttled
    await sleep(2000);

    // Check for Amazon's "Continue shopping" bot interstitial and CAPTCHA pages.
    // These block the actual product page from loading.
    const interstitialHandled = await handleAmazonInterstitial(tab.id);
    if (interstitialHandled === 'blocked') {
      return { softBlock: true };
    }

    // If interstitial was clicked, we navigated — wait for the real product page
    if (interstitialHandled === 'clicked') {
      // Wait for navigation to complete
      await new Promise((resolve) => {
        const listener = (tabId, changeInfo) => {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
      });
      await sleep(3000); // Let product page JS render
    } else {
      await sleep(2000); // Normal path: just wait for JS to render
    }

    // Scrape product data
    let data;
    try {
      data = await chrome.tabs.sendMessage(tab.id, { type: SCRAPE_AMAZON_PRODUCT });
    } catch (err) {
      // Content script may not have loaded on the new page after interstitial navigation
      console.log('[DropFlow Monitor] Content script not responding, injecting manually...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-scripts/amazon/availability.js', 'content-scripts/amazon/product-scraper.js']
        });
        await sleep(1500);
        data = await chrome.tabs.sendMessage(tab.id, { type: SCRAPE_AMAZON_PRODUCT });
      } catch (injErr) {
        return { error: true, message: 'Content script injection failed: ' + injErr.message };
      }
    }

    if (!data || data.error) {
      const tabInfo = await chrome.tabs.get(tab.id);
      if (tabInfo.title && /sorry/i.test(tabInfo.title)) {
        return { softBlock: true };
      }
      return { notFound: true };
    }

    // Check if product page is a "currently unavailable" / dog page
    if (!data.title && !data.price) {
      return { notFound: true };
    }

    // If title found but price=0, the page may be partially loaded. Retry.
    if (data.title && !data.price) {
      console.log('[DropFlow Monitor] Title found but no price — retrying...');
      await sleep(4000);
      const retry = await chrome.tabs.sendMessage(tab.id, { type: SCRAPE_AMAZON_PRODUCT });
      if (retry && (retry.price || retry.availability?.inStock)) {
        data = retry;
      }
    }

    // Log availability details for debugging false OOS detections
    const inStock = data.availability?.inStock ?? false;
    if (!inStock) {
      console.warn(`[DropFlow Monitor] Product detected as OUT OF STOCK:`,
        `title="${data.title?.substring(0, 50)}"`,
        `price=${data.price}`,
        `availability=${JSON.stringify(data.availability)}`);
    }

    return {
      price: data.price || 0,
      currency: data.currency || 'USD',
      inStock,
      quantity: data.availability?.quantity ?? null
    };
  } catch (err) {
    // Content script not responding — possibly blocked page
    try {
      const tabInfo = await chrome.tabs.get(tab.id);
      if (tabInfo.title && /sorry|robot|captcha/i.test(tabInfo.title)) {
        return { softBlock: true };
      }
    } catch (_) {}
    return { error: true, message: err.message || 'Scrape failed' };
  } finally {
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch (_) {}
    }
  }
}

/**
 * Detect and handle Amazon's bot interstitial pages:
 * - "Click the button below to continue shopping" (Continue shopping button)
 * - CAPTCHA / "Sorry, we just need to make sure you're not a robot"
 * Returns: 'clicked' if interstitial was bypassed, 'blocked' if CAPTCHA, 'none' if normal page.
 */
async function handleAmazonInterstitial(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const bodyText = document.body?.innerText || '';

        // Check for CAPTCHA — can't bypass this
        if (/sorry.*not a robot|enter the characters|type the characters/i.test(bodyText)) {
          return 'captcha';
        }

        // Check for "Continue shopping" interstitial
        if (/continue shopping|click the button below/i.test(bodyText)) {
          // Try to find and click the continue button
          const btns = document.querySelectorAll('a, button, input[type="submit"]');
          for (const btn of btns) {
            const text = (btn.textContent || btn.value || '').trim().toLowerCase();
            if (text.includes('continue shopping') || text.includes('continue')) {
              btn.click();
              return 'clicked';
            }
          }
          // Fallback: look for any prominent link/button on the page
          const link = document.querySelector('a[href*="amazon"]');
          if (link) {
            link.click();
            return 'clicked';
          }
          return 'interstitial_no_button';
        }

        // Check if this is a normal product page (has product title or price)
        if (document.getElementById('productTitle') || document.querySelector('.a-price')) {
          return 'product_page';
        }

        return 'unknown';
      }
    });

    const result = results?.[0]?.result;
    console.log(`[DropFlow Monitor] Amazon page check: ${result}`);

    if (result === 'captcha') return 'blocked';
    if (result === 'clicked') return 'clicked';
    if (result === 'interstitial_no_button') return 'blocked';
    return 'none';
  } catch (err) {
    console.log(`[DropFlow Monitor] Interstitial check failed: ${err.message}`);
    return 'none';
  }
}

/**
 * Use chrome.scripting.executeScript with world: 'MAIN' to read AliExpress
 * page JavaScript variables directly. This bypasses CSP because it's a Chrome
 * extension API, not inline script injection (which AliExpress CSP blocks).
 */
async function scrapeAliExpressMainWorld(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        var result = { price: 0, images: [], title: '', inStock: true, quantity: null };
        try {
          // Source 1: window.runParams (classic AliExpress)
          if (window.runParams && window.runParams.data) {
            var d = window.runParams.data;
            var priceModule = d.priceModule || d.priceComponent || {};
            result.price = parseFloat(
              priceModule.minAmount?.value || priceModule.minActivityAmount?.value ||
              priceModule.formatedPrice?.replace(/[^\d.]/g, '') ||
              priceModule.minPrice || priceModule.actMinPrice || 0
            );
            var imgModule = d.imageModule || d.imageComponent || {};
            if (imgModule.imagePathList && imgModule.imagePathList.length > 0) {
              result.images = imgModule.imagePathList.slice(0, 12);
            }
            var titleModule = d.titleModule || d.productInfoComponent || {};
            result.title = titleModule.subject || d.pageModule?.title || '';
            // Stock info
            var quantityModule = d.quantityModule || d.inventoryComponent || {};
            if (quantityModule.totalAvailQuantity !== undefined) {
              result.quantity = quantityModule.totalAvailQuantity;
              result.inStock = quantityModule.totalAvailQuantity > 0;
            }
          }

          // Source 2: window.__NEXT_DATA__ (newer SSR pages)
          if (window.__NEXT_DATA__) {
            function drill(obj, depth) {
              if (!obj || depth > 6 || typeof obj !== 'object') return;
              if (!result.price && obj.minAmount && obj.minAmount.value)
                result.price = parseFloat(obj.minAmount.value);
              if (!result.price && obj.minPrice)
                result.price = parseFloat(obj.minPrice);
              if (!result.price && obj.actMinPrice)
                result.price = parseFloat(obj.actMinPrice);
              if (!result.price && obj.formatedPrice)
                result.price = parseFloat(String(obj.formatedPrice).replace(/[^\d.]/g, ''));
              if (result.images.length === 0 && Array.isArray(obj.imagePathList))
                result.images = obj.imagePathList.slice(0, 12);
              if (!result.title && obj.subject)
                result.title = obj.subject;
              if (result.quantity === null && obj.totalAvailQuantity !== undefined) {
                result.quantity = obj.totalAvailQuantity;
                result.inStock = obj.totalAvailQuantity > 0;
              }
              var keys = Object.keys(obj);
              for (var i = 0; i < keys.length && i < 50; i++) {
                if (typeof obj[keys[i]] === 'object' && obj[keys[i]] !== null)
                  drill(obj[keys[i]], depth + 1);
              }
            }
            drill(window.__NEXT_DATA__, 0);
          }

          // Source 3: window.PAGE_DATA
          if (!result.price && window.PAGE_DATA) {
            var pd = window.PAGE_DATA;
            result.price = parseFloat(pd.price || pd.minPrice || pd.actMinPrice || 0);
            if (pd.images) result.images = pd.images.slice(0, 12);
            if (pd.title) result.title = pd.title;
          }
        } catch (e) {}
        // Fix protocol-relative URLs
        result.images = result.images.map(function(u) {
          return u.startsWith('//') ? 'https:' + u : u;
        });
        return result;
      }
    });

    const data = results?.[0]?.result;
    if (data && (data.price > 0 || data.title)) {
      console.log(`[DropFlow Monitor] AliExpress MAIN world: $${data.price}, ${data.images.length} imgs, stock=${data.inStock}`);
      return data;
    }
    console.log('[DropFlow Monitor] AliExpress MAIN world returned no usable data');
    return null;
  } catch (err) {
    console.warn('[DropFlow Monitor] AliExpress MAIN world failed:', err.message);
    return null;
  }
}

async function checkAliExpressProduct(product) {
  const productId = product.sourceId || extractAliExpressProductId(product.sourceUrl);
  if (!productId) {
    return { error: true, message: 'Cannot extract AliExpress product ID' };
  }

  // Try internal API first (no tab needed — much faster)
  // NOTE: Service worker fetch has no cookies/session, so API data may be unreliable.
  // Only trust the API if it returns BOTH price > 0 AND inStock === true.
  // If API says out-of-stock, always verify via tab scrape (cookie-less API may see
  // different availability than a real browser session).
  try {
    const apiUrl = `https://www.aliexpress.com/aeglobal/glo-buyercard/api/item/detail?itemId=${productId}`;
    const resp = await fetch(apiUrl, {
      headers: { 'Accept': 'application/json' }
    });

    if (resp.ok) {
      const json = await resp.json();
      const data = json.data || json;

      // Extract price from API response
      let price = 0;
      const priceInfo = data.price || data.priceInfo || {};
      if (priceInfo.minAmount) {
        price = parseFloat(priceInfo.minAmount.value || priceInfo.minAmount) || 0;
      }
      if (!price && priceInfo.actMinPrice) {
        price = parseFloat(priceInfo.actMinPrice) || 0;
      }
      if (!price && priceInfo.minPrice) {
        price = parseFloat(priceInfo.minPrice) || 0;
      }

      // Stock status
      const inventory = data.inventory || data.quantityInfo || {};
      const totalQty = inventory.totalQuantity || inventory.totalAvailQuantity || null;
      const inStock = totalQty === null ? true : totalQty > 0;

      // Only return API result if price is valid AND product is in stock.
      // If API says OOS, fall through to tab scrape for verification.
      if (price > 0 && inStock) {
        console.log(`[DropFlow Monitor] AliExpress API: $${price}, in stock`);
        return { price, currency: 'USD', inStock: true, quantity: totalQty };
      } else {
        console.log(`[DropFlow Monitor] AliExpress API returned price=$${price}, inStock=${inStock} — verifying via tab`);
      }
    }
  } catch (err) {
    console.log('[DropFlow Monitor] AliExpress API fallback to tab:', err.message);
  }

  // Fallback: open tab and scrape
  let tab;
  try {
    tab = await createTabAndWait(product.sourceUrl, 30000);
  } catch (err) {
    return { error: true, message: 'AliExpress tab load timeout' };
  }

  try {
    // AliExpress pages are extremely JS-heavy — wait for rendering
    await sleep(4000);

    // --- Strategy 1: MAIN world extraction (bypasses CSP) ---
    // chrome.scripting.executeScript({ world: 'MAIN' }) reads window.runParams,
    // __NEXT_DATA__, etc. directly. Unlike inline <script> injection, this is NOT
    // blocked by AliExpress's Content Security Policy.
    let mainWorldData = await scrapeAliExpressMainWorld(tab.id);

    // If MAIN world returned no price, activate tab (background tabs throttle JS) and retry
    if (!mainWorldData || !mainWorldData.price) {
      console.log('[DropFlow Monitor] MAIN world attempt 1 got no price — activating tab and retrying');
      try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) {}
      await sleep(5000);
      mainWorldData = await scrapeAliExpressMainWorld(tab.id);
    }

    if (mainWorldData && mainWorldData.price > 0) {
      return {
        price: mainWorldData.price,
        currency: 'USD',
        inStock: mainWorldData.inStock ?? true,
        quantity: mainWorldData.quantity ?? null
      };
    }

    // --- Strategy 2: Content script messaging fallback ---
    console.log('[DropFlow Monitor] MAIN world failed — falling back to content script');

    // Ensure content script is injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-scripts/aliexpress/product-scraper.js']
      });
    } catch (_) { /* already injected via manifest */ }
    await sleep(1000);

    let data;
    try {
      data = await chrome.tabs.sendMessage(tab.id, { type: SCRAPE_ALIEXPRESS_PRODUCT });
    } catch (err) {
      console.log('[DropFlow Monitor] AliExpress content script scrape failed:', err.message);
    }

    // Retry with tab activation if needed
    if (!data || (!data.price && !data.error)) {
      console.log('[DropFlow Monitor] Content script returned no price — activating tab and retrying');
      try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) {}
      await sleep(5000);

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-scripts/aliexpress/product-scraper.js']
        });
      } catch (_) {}
      await sleep(1000);

      try {
        data = await chrome.tabs.sendMessage(tab.id, { type: SCRAPE_ALIEXPRESS_PRODUCT });
      } catch (err) {
        console.warn('[DropFlow Monitor] AliExpress retry scrape failed:', err.message);
      }
    }

    if (!data || data.error) {
      console.warn('[DropFlow Monitor] All AliExpress scrape methods failed');
      return { error: true, message: data?.error || 'AliExpress scrape failed' };
    }

    return {
      price: data.price || 0,
      currency: data.currency || 'USD',
      inStock: data.availability?.inStock ?? true,
      quantity: data.availability?.quantity ?? null
    };
  } catch (err) {
    return { error: true, message: err.message || 'AliExpress scrape failed' };
  } finally {
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch (_) {}
    }
  }
}

// --- Price Calculation ---

function calculateEbayPrice(supplierPrice, settings) {
  let ebayPrice;

  switch (settings.priceMarkupType) {
    case 'fixed':
      ebayPrice = supplierPrice + (settings.priceFixedIncrease || 5);
      break;

    case 'variable': {
      const tiers = settings.priceVariableTiers || DEFAULTS[MONITOR_SETTINGS].priceVariableTiers;
      let markup = 30; // default
      for (const tier of tiers) {
        if (supplierPrice >= tier.min && supplierPrice < tier.max) {
          markup = tier.markup;
          break;
        }
      }
      ebayPrice = supplierPrice * (1 + markup / 100);
      break;
    }

    case 'percentage':
    default:
      ebayPrice = supplierPrice * (1 + (settings.priceMarkupValue || 30) / 100);
      break;
  }

  // Enforce minimum profit
  if (settings.priceMinProfit && ebayPrice - supplierPrice < settings.priceMinProfit) {
    ebayPrice = supplierPrice + settings.priceMinProfit;
  }

  // Price rounding
  switch (settings.priceRounding) {
    case '99':
      ebayPrice = Math.floor(ebayPrice) + 0.99;
      break;
    case '95':
      ebayPrice = Math.floor(ebayPrice) + 0.95;
      break;
    case '49':
      ebayPrice = Math.floor(ebayPrice) + 0.49;
      break;
    // 'none' — no rounding
  }

  return Math.round(ebayPrice * 100) / 100;
}

// --- eBay Actions ---

// Revision queue to ensure only 1 revision tab at a time
let revisionQueue = Promise.resolve();
const REVISION_COOLDOWN_MS = 10000;

/**
 * Open an eBay revision page, send a REVISE_EBAY_LISTING message to form-filler.js,
 * and wait for the result. Handles tab lifecycle and content script injection fallback.
 * @param {Object} product - Tracked product record
 * @param {Object} changes - { action: 'set_quantity'|'set_price'|'end_listing', quantity?, price? }
 * @returns {Promise<Object>} Result from form-filler
 */
async function reviseEbayListing(product, changes) {
  // Queue revisions to run one at a time with cooldown between them
  const result = await new Promise((resolve) => {
    revisionQueue = revisionQueue.then(async () => {
      const res = await _doReviseEbayListing(product, changes);
      await sleep(REVISION_COOLDOWN_MS);
      return res;
    }).then(resolve).catch(err => resolve({ error: err.message }));
  });
  return result;
}

async function _doReviseEbayListing(product, changes) {
  const domain = product.ebayDomain || 'com';
  const itemId = product.ebayItemId;

  if (!itemId) return { error: 'No eBay item ID' };

  console.log(`[DropFlow Monitor] Revising listing ${itemId}: ${JSON.stringify(changes)}`);

  // Try multiple revision URL patterns (eBay migrated from /lstng to /sl/)
  const revisionUrl = `https://www.ebay.${domain}/sl/revise/${itemId}`;

  let tabId = null;
  try {
    // 1. Open revision tab
    const tab = await createTabAndWait(revisionUrl, 45000);
    tabId = tab.id;

    // 2. Wait for page to settle, then ensure form-filler is loaded
    await sleep(5000);

    // Pre-emptively inject form-filler (manifest may not have matched the revision URL)
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/ebay/form-filler.js']
      });
    } catch (_) { /* already injected via manifest — ignore */ }
    await sleep(2000);

    // 3. Send REVISE_EBAY_LISTING message with retry
    let response;
    try {
      response = await Promise.race([
        chrome.tabs.sendMessage(tabId, { type: REVISE_EBAY_LISTING, ...changes }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Revision timed out (60s)')), 60000))
      ]);
    } catch (e) {
      // Content script may not have loaded — wait longer and retry
      console.warn(`[DropFlow Monitor] First revision attempt failed: ${e.message}, retrying...`);
      // Activate tab to ensure JS runs fully
      try { await chrome.tabs.update(tabId, { active: true }); } catch (_) {}
      await sleep(5000);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content-scripts/ebay/form-filler.js']
        });
      } catch (_) {}
      await sleep(3000);
      response = await Promise.race([
        chrome.tabs.sendMessage(tabId, { type: REVISE_EBAY_LISTING, ...changes }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Revision retry timed out (60s)')), 60000))
      ]);
    }

    // 4. Wait for eBay to process
    await sleep(5000);

    if (response?.error) {
      console.warn(`[DropFlow Monitor] Revision error for ${itemId}: ${response.error}`);
      return { error: response.error };
    }

    console.log(`[DropFlow Monitor] Revision successful for ${itemId}:`, response);
    return { success: true, ...response };
  } catch (error) {
    console.error(`[DropFlow Monitor] Revision failed for ${itemId}:`, error.message);
    return { error: error.message };
  } finally {
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch (_) { /* tab may already be closed */ }
    }
  }
}

async function executeOutOfStockAction(product, settings) {
  const action = settings.stockOutOfStockAction || 'zero';

  switch (action) {
    case 'end': {
      console.log(`[DropFlow Monitor] Ending eBay listing ${product.ebayItemId}`);
      const result = await reviseEbayListing(product, { action: 'end_listing' });
      if (result.error) {
        console.warn(`[DropFlow Monitor] End listing failed: ${result.error}`);
        return `Failed to end listing ${product.ebayItemId}: ${result.error}`;
      }
      return `Listing ${product.ebayItemId} ended`;
    }

    case 'zero': {
      console.log(`[DropFlow Monitor] Setting quantity to 0 for ${product.ebayItemId}`);
      const result = await reviseEbayListing(product, { action: 'set_quantity', quantity: 0 });
      if (result.error) {
        console.warn(`[DropFlow Monitor] Set qty=0 failed: ${result.error}`);
        return `Failed to set quantity to 0 for ${product.ebayItemId}: ${result.error}`;
      }
      return `Listing ${product.ebayItemId} quantity set to 0`;
    }

    case 'alert':
    default:
      return 'Alert only — no eBay action taken';
  }
}

async function executeRestockAction(product, settings) {
  if (!settings.stockAutoRestock) return 'No action (auto-restock disabled)';

  const qty = settings.stockRestockQuantity || 1;
  console.log(`[DropFlow Monitor] Restocking ${product.ebayItemId} with quantity ${qty}`);

  const result = await reviseEbayListing(product, { action: 'set_quantity', quantity: qty });
  if (result.error) {
    console.warn(`[DropFlow Monitor] Restock failed: ${result.error}`);
    return `Failed to restock ${product.ebayItemId}: ${result.error}`;
  }
  return `Restocked eBay listing ${product.ebayItemId} with quantity ${qty}`;
}

async function executePriceUpdateAction(product, newEbayPrice) {
  if (!newEbayPrice || newEbayPrice <= 0) return 'No price update needed';

  console.log(`[DropFlow Monitor] Updating price for ${product.ebayItemId}: ${product.ebayPrice} → ${newEbayPrice}`);

  const result = await reviseEbayListing(product, { action: 'set_price', price: newEbayPrice });
  if (result.error) {
    console.warn(`[DropFlow Monitor] Price update failed: ${result.error}`);
    return `Failed to update price for ${product.ebayItemId}: ${result.error}`;
  }
  return `eBay price updated for ${product.ebayItemId}: ${formatPrice(product.ebayPrice, product.ebayCurrency)} → ${formatPrice(newEbayPrice, product.ebayCurrency)}`;
}

// ============================
// Navigation
// ============================
function handleOpenPage(payload) {
  const { page } = payload;
  const pageUrl = chrome.runtime.getURL(`pages/${page}`);
  chrome.tabs.create({ url: pageUrl });
}

/**
 * Broadcast a message to all open extension pages (popups, tabs with our pages).
 */
async function broadcastToExtensionPages(message) {
  try {
    const tabs = await chrome.tabs.query({});
    const extensionUrl = chrome.runtime.getURL('');
    for (const tab of tabs) {
      if (tab.url && tab.url.startsWith(extensionUrl)) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }
  } catch (e) {
    // Ignore - best effort
  }
}

// ============================
// Extension Install / Update
// ============================
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set defaults on first install
    chrome.storage.local.set(DEFAULTS);
    console.log('[DropFlow] Extension installed successfully');
  }

  // Restore monitor alarm if it was running before install/update
  chrome.storage.local.get(MONITOR_RUNNING).then(result => {
    if (result[MONITOR_RUNNING]) {
      chrome.storage.local.get(MONITOR_SETTINGS).then(r => {
        const settings = r[MONITOR_SETTINGS] || DEFAULTS[MONITOR_SETTINGS];
        chrome.alarms.create(MONITOR_ALARM_NAME, {
          delayInMinutes: 1,
          periodInMinutes: Math.max(1, settings.intervalMinutes)
        });
        console.log('[DropFlow Monitor] Alarm restored after install/update');
      });
    }
  });

  // Restore sale polling alarm if auto-ordering is enabled
  getAutoOrderSettings().then(settings => {
    if (settings.enabled) {
      startSalePolling(5);
      console.log('[DropFlow SalePoller] Alarm restored after install/update');
    }
  }).catch(() => {});
});

// Clean up stored Amazon data and captured eBay headers when tabs are closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Clean up captured eBay headers
  ebayHeadersMap.delete(tabId);

  try {
    const stored = await chrome.storage.local.get(AMAZON_DATA_MAP);
    const amazonData = stored[AMAZON_DATA_MAP];
    if (amazonData && amazonData[tabId]) {
      delete amazonData[tabId];
      await chrome.storage.local.set({ [AMAZON_DATA_MAP]: amazonData });
    }
  } catch (e) {
    // Ignore cleanup errors
  }
});

// ============================
// SW Startup Recovery
// ============================
// On every SW load (including after death/restart), check if there's pending
// listing work. If so, ensure keepalive is active and force-inject the form
// filler into any eBay tabs that may have loaded while SW was dead.
(async () => {
  try {
    const allData = await chrome.storage.local.get(null);
    const pendingKeys = Object.keys(allData).filter(k => k.startsWith('pendingListing_'));

    // Check orchestration state — if SW died mid-operation, restore keepalive
    const orchState = allData[ORCH_STATE_KEY];
    if (orchState) {
      const ageMs = Date.now() - (orchState.updatedAt || 0);
      const isStale = ageMs > 15 * 60 * 1000; // 15 minutes = stale
      if (isStale) {
        console.log(`[DropFlow] SW recovery: orchestration state is stale (${Math.round(ageMs / 1000)}s), clearing`);
        await clearOrchestrationState();
      } else {
        console.log(`[DropFlow] SW recovery: orchestration state found — stage="${orchState.stage}", item ${(orchState.currentIndex ?? -1) + 1}/${orchState.totalLinks || '?'}, age=${Math.round(ageMs / 1000)}s`);
        touchKeepAliveActivity('startup-recovery-orchestration');
        startSWKeepAlive();

        // If we have an ebayTabId in the orch state, ensure form-filler is injected
        if (orchState.ebayTabId) {
          try {
            const tab = await chrome.tabs.get(orchState.ebayTabId);
            if (tab && tab.url) {
              console.log(`[DropFlow] SW recovery: re-injecting form-filler into orch tab ${orchState.ebayTabId}`);
              await chrome.scripting.executeScript({
                target: { tabId: orchState.ebayTabId, allFrames: true },
                files: ['content-scripts/ebay/form-filler.js']
              });
            }
          } catch (e) {
            console.warn(`[DropFlow] SW recovery: orch tab ${orchState.ebayTabId} not found: ${e.message}`);
          }
        }
      }
    }

    if (pendingKeys.length > 0) {
      console.log(`[DropFlow] SW startup recovery: found ${pendingKeys.length} pending listing(s): ${pendingKeys.join(', ')}`);
      touchKeepAliveActivity('startup-recovery-pending');
      startSWKeepAlive();

      // Force-inject form filler into matching eBay tabs
      for (const key of pendingKeys) {
        const tabIdStr = key.replace('pendingListing_', '');
        const tabId = parseInt(tabIdStr);
        if (!tabId || isNaN(tabId)) continue;
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab && tab.url && (tab.url.includes('/lstng') || tab.url.includes('/sl/prelist') || tab.url.includes('bulkedit'))) {
            console.log(`[DropFlow] SW recovery: force-injecting form-filler into tab ${tabId} (${tab.url.substring(0, 80)})`);
            await chrome.scripting.executeScript({
              target: { tabId, allFrames: true },
              files: ['content-scripts/ebay/form-filler.js']
            });
          }
        } catch (e) {
          // Tab may not exist anymore
          console.warn(`[DropFlow] SW recovery: tab ${tabId} not found or inject failed: ${e.message}`);
          // Clean up orphaned pending data
          await chrome.storage.local.remove(key);
          console.log(`[DropFlow] SW recovery: cleaned up orphaned ${key}`);
        }
      }
    }
  } catch (e) {
    console.warn('[DropFlow] SW startup recovery error:', e.message);
  }
})();

console.log('[DropFlow] Service worker loaded');
