/**
 * Chrome storage key constants.
 * All chrome.storage.local keys are defined here to avoid typos.
 */

// === Settings ===
export const BACKEND_URL = 'backendUrl';

// === Bulk Poster State ===
export const BULK_POSTER_STATE = 'bulkPosterState';
export const BULK_POSTER_RESULTS = 'bulkPosterResults';

// === Title Builder ===
export const LAST_TFIDF_RESULT = 'lastTfidfResult';
export const LAST_GENERATED_TITLES = 'lastGeneratedTitles';

// === Boost My Listings ===
export const BOOST_SCHEDULE = 'boostSchedule';
export const BOOST_SETTINGS = 'boostSettings';

// === Competitor Research ===
export const COMPETITOR_LIST = 'competitorList';
export const COMPETITOR_SCAN_POSITION = 'competitorScanPosition';
export const COMPETITOR_RESULTS = 'competitorResults';
export const COMPETITOR_SETTINGS = 'competitorSettings';

// === User Preferences ===
export const DEFAULT_LISTING_TYPE = 'defaultListingType';
export const DEFAULT_THREAD_COUNT = 'defaultThreadCount';
export const PRICE_MARKUP = 'priceMarkup';

// === Stock & Price Monitor ===
export const TRACKED_PRODUCTS = 'trackedProducts';
export const MONITOR_SETTINGS = 'monitorSettings';
export const MONITOR_ALERTS = 'monitorAlerts';
export const MONITOR_RUNNING = 'monitorRunning';
export const MONITOR_LAST_RUN = 'monitorLastRun';
export const MONITOR_STATS = 'monitorStats';
export const MONITOR_POSITION = 'monitorPosition';
export const MONITOR_SOFT_BLOCK = 'monitorSoftBlock';

// === Defaults ===
export const DEFAULTS = {
  [BACKEND_URL]: 'https://dropflow-api.onrender.com',
  [DEFAULT_LISTING_TYPE]: 'standard',
  [DEFAULT_THREAD_COUNT]: 3,
  [PRICE_MARKUP]: 30,
  [MONITOR_SETTINGS]: {
    enabled: false,
    intervalMinutes: 30,
    concurrency: 2,
    delayBetweenMs: 3000,
    stockOutOfStockAction: 'zero',
    stockRestockQuantity: 3,
    stockAutoRestock: false,
    priceAutoUpdate: true,
    priceChangeThresholdPct: 5,
    priceMarkupType: 'percentage',
    priceMarkupValue: 30,
    priceFixedIncrease: 5.00,
    priceVariableTiers: [
      { min: 0, max: 5, markup: 400 },
      { min: 5, max: 15, markup: 200 },
      { min: 15, max: 30, markup: 100 },
      { min: 30, max: 60, markup: 80 },
      { min: 60, max: 100, markup: 60 },
      { min: 100, max: 99999, markup: 40 }
    ],
    priceMinProfit: 2.00,
    priceRounding: '99',
    alertBadge: true,
    alertNotification: true
  }
};
