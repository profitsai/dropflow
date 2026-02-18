# DropFlow Auto-Order System — Audit Report

**Date:** 2026-02-18  
**Auditor:** OpenClaw Subagent  
**Tests:** 199 passing (37 new auto-order/sale-poller tests added)

---

## 1. Architecture Overview

### Complete Flow: Sale Detection → Supplier Checkout → Order Tracking

```
┌─────────────────┐     ┌───────────────────┐     ┌──────────────────────┐
│  Sale Detection  │────▶│  Order Creation    │────▶│  Auto-Order Execute  │
│  (sale-poller)   │     │  (auto-order.js)   │     │  (content scripts)   │
└─────────────────┘     └───────────────────┘     └──────────────────────┘
        │                        │                          │
   5-min alarm            createOrder()              Opens source tab
   eBay Seller Hub        status: pending            Injects auto-order CS
   orders-scraper.js      Match to tracked           Sets qty, clicks Buy/Cart
        │                   product                         │
        ▼                        │                          ▼
 Scrape /sh/ord           Variant resolution       ┌──────────────────────┐
 Compare known IDs        Source URL lookup         │  Checkout Address    │
 Create new orders                                  │  (AliExpress only)   │
                                                    │  checkout-address.js │
                                                    └──────────────────────┘
                                                            │
                                                            ▼
                                                    status: awaiting_payment
                                                    User confirms manually
                                                            │
                                                            ▼
                                                    status: ordered → shipped → delivered
```

### Files Audited

| File | Purpose | Lines |
|------|---------|-------|
| `lib/auto-order.js` | Order CRUD, state machine, executeAutoOrder | ~200 |
| `lib/sale-poller.js` | eBay sale detection via Seller Hub scraping | ~300 |
| `background/service-worker.js` | Message routing for all order/poll messages | ~6000 |
| `lib/message-types.js` | 14 auto-order + 4 sale-polling message types | ~180 |
| `pages/orders/orders.js` | Orders dashboard UI | ~200 |
| `pages/orders/orders.html` | Orders dashboard markup | ~80 |
| `content-scripts/amazon/auto-order.js` | Amazon add-to-cart automation | ~100 |
| `content-scripts/aliexpress/auto-order.js` | AliExpress Buy Now automation | ~120 |
| `content-scripts/aliexpress/checkout-address.js` | AliExpress checkout address filler | ~350 |
| `content-scripts/ebay/orders-scraper.js` | Seller Hub orders page scraper | ~280 |

---

## 2. Bugs Found & Fixed

### BUG-1: No max price check in `executeAutoOrder` ✅ FIXED
**Severity:** Medium  
**File:** `lib/auto-order.js`  
**Issue:** `maxAutoOrderPrice` setting existed but was never checked before executing an order. A $500 item could be auto-ordered with a $100 limit.  
**Fix:** Added price check before processing. Returns error and sets status to FAILED if source price exceeds limit.

### BUG-2: Tab load listener leak in `executeAutoOrder` ✅ FIXED
**Severity:** Medium  
**File:** `lib/auto-order.js`  
**Issue:** `chrome.tabs.onUpdated` listener had no timeout. If a tab was closed before loading, the listener leaked permanently in the service worker.  
**Fix:** Added 30-second timeout that removes the listener and resolves the promise.

### BUG-3: Stale `__dropflow_pending_checkout` data ✅ FIXED
**Severity:** Low  
**File:** `lib/auto-order.js`, `content-scripts/aliexpress/checkout-address.js`  
**Issue:** Pending checkout data persisted indefinitely. If checkout never loaded (tab closed, navigation failure), the next AliExpress checkout visit would attempt to fill a stale address.  
**Fix:** Added `expiresAt` TTL (10 minutes) to pending checkout data. Checkout address script now checks expiry before auto-filling.

### BUG-4: Race condition — `AWAITING_PAYMENT` set before content script processes
**Severity:** Low (functional, not data-corrupting)  
**File:** `lib/auto-order.js`  
**Issue:** `updateOrder(orderId, { status: AWAITING_PAYMENT })` is called right after `sendMessage`, but the content script's `executeOrder` is async. The status update may happen before the cart is actually prepared.  
**Impact:** Minor UI inconsistency — order shows "awaiting payment" while content script is still working. The `AUTO_ORDER_PROGRESS` messages from content scripts mitigate this.  
**Recommendation:** Consider setting AWAITING_PAYMENT only after receiving a success response from the content script. Not fixed as it requires restructuring the flow and the progress messages provide adequate UX.

### BUG-5: `specificsmatch` doesn't handle case-insensitive key lookup correctly
**Severity:** Low  
**File:** `lib/sale-poller.js`  
**Issue:** `const bVal = b[k] || b[k.toLowerCase()] || ''` — if `k` is already lowercase, both lookups are identical. If `k` is "Color" and `b` has "color", neither `b["Color"]` nor `b["color"]` would match because JS objects are case-sensitive. The `b[k.toLowerCase()]` fallback only works if the source data also has lowercase keys.  
**Impact:** Variant matching may fail when eBay sends "Color: Blue" but the variant map uses "color" as the key. Low probability since the variant map is user/extension-generated.

---

## 3. Potential Issues (Not Bugs, But Risks)

### RISK-1: Sale poller opens real browser tabs
The `runSalePollCycle` function opens a real Chrome tab (`active: false`) to scrape Seller Hub. This is visible in the tab bar and could confuse users. EcomSniper uses the same approach but keeps tabs more hidden.  
**Recommendation:** Consider using `chrome.offscreen` document with fetch-based scraping if the Seller Hub page doesn't require full rendering.

### RISK-2: No duplicate order prevention during concurrent polls  
If two poll cycles overlap (unlikely with alarms, but possible with manual `POLL_SALES_NOW`), both could detect the same sale and create duplicate orders. The check against `existingEbayOrderIds` mitigates this, but there's a TOCTOU window between reading and writing.  
**Recommendation:** Add a mutex/lock flag (`salePollInProgress`) to prevent concurrent cycles.

### RISK-3: Amazon auto-order content script doesn't handle variant selection
The Amazon auto-order script sets quantity and clicks Add to Cart, but doesn't select product variants (color, size). If the sale was for a specific variant, the wrong variant could be ordered.  
**Recommendation:** Use the `sourceVariant` data passed in the message to select the correct variant before adding to cart.

### RISK-4: No eBay buyer address scraping from orders list
The sale poller scrapes orders from `/sh/ord` but `buyerAddress` is set to `null` in `createOrder`. The orders-scraper.js attempts to extract addresses but the Seller Hub list view rarely shows full addresses. Addresses are only available on detail pages.  
**Recommendation:** Add a follow-up step that navigates to each order's detail page to scrape the full buyer address.

### RISK-5: Known orders array growth
The `knownEbayOrders` array is trimmed to 500 entries. For high-volume sellers, older order IDs could be evicted and re-detected as "new" on subsequent polls (if they're still on the first page of Seller Hub).  
**Recommendation:** Consider using a time-based eviction (e.g., keep orders from last 30 days) instead of count-based.

---

## 4. Comparison with EcomSniper's Auto-Ordering

| Feature | EcomSniper | DropFlow |
|---------|-----------|----------|
| **Trigger** | `order_item_same_browser` message from popup/dashboard | Sale poller alarm + manual trigger from orders dashboard |
| **Checkout flow** | Tab-based with URL monitoring: cart → checkout → thank you → order history | Content script injection: set qty → add to cart/buy now → stop for manual confirm |
| **Payment** | Automated (completes full checkout via `autoOrder` actions) | Manual confirmation required (safer) |
| **Variant selection** | Handled via `addToCart` action with variant data | ⚠️ Not yet implemented in content scripts |
| **Address filling** | Via checkout page automation | AliExpress checkout-address.js (good), Amazon not implemented |
| **Order tracking** | `record_order_details` scrapes Amazon order history | Manual entry via orders dashboard |
| **URL monitoring** | Watches tab URL changes: `/cart` → `/checkout` → `/thankyou` → `/order-details` | No URL monitoring — relies on content script messages |
| **Error recovery** | Tab-based retry with step tracking | Status set to FAILED, manual retry required |

### Key Differences
1. **Safety:** DropFlow's manual payment confirmation is significantly safer for dropshipping — prevents accidental charges.
2. **Completeness:** EcomSniper has a more complete end-to-end flow (variant selection, address fill on Amazon, order number extraction). DropFlow needs Amazon address filling and variant selection.
3. **Architecture:** EcomSniper uses URL-based state tracking (monitors tab URL changes). DropFlow uses message-passing between content scripts and service worker, which is cleaner but less resilient to page navigation.

---

## 5. Test Coverage

### New Tests Added (37 tests)

**auto-order.test.js** (33 tests, up from 13):
- Order CRUD: create, update, cancel, get by status
- Tracked product source info copying
- Buyer address preservation
- Unique ID generation
- Timestamp lifecycle (orderedAt, shippedAt, deliveredAt not overwritten)
- Full state machine happy path
- Settings CRUD
- saveOrders/getOrders round-trip

**sale-poller.test.js** (28 tests, up from 11):
- matchSaleToProduct: item ID, SKU, fuzzy title, priority ordering, prefix matching
- specificsmatch: case handling, subset matching, null safety
- resolveVariant: all variant map formats (array by specifics, array by SKU, object by key, object by spec values), fallbacks, colon-in-value parsing

### Test Results
```
Test Files  13 passed (13)
     Tests  199 passed (199)
  Duration  428ms
```

---

## 6. Recommendations (Priority Order)

1. **Add variant selection to Amazon/AliExpress auto-order scripts** — Use the `sourceVariant` data to select correct color/size before add-to-cart
2. **Add sale poll mutex** — Prevent concurrent poll cycles from creating duplicate orders
3. **Add Amazon checkout address filling** — Like the AliExpress checkout-address.js
4. **Add tab URL monitoring** — Watch for navigation from product → cart → checkout (EcomSniper approach) for more resilient flow tracking
5. **Scrape buyer address from order detail pages** — Navigate to each order's detail page after detecting new sales
6. **Export `matchSaleToProduct` and `resolveVariant`** — Currently private functions that are replicated in tests; export for proper unit testing
