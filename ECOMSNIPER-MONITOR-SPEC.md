# EcomSniper Monitor — Exact Replication Spec for DropFlow

## How EcomSniper's Tracker Works (reverse-engineered from v43.40)

### Core Architecture: PAGE-BASED ITERATION
Unlike DropFlow's current approach (store products in chrome.storage, check them individually), EcomSniper:

1. Opens eBay Seller Hub Active Listings page directly
2. Content script on that page reads items from the DOM row-by-row
3. For each item: extracts Custom Label (base64-encoded ASIN), opens Amazon tab to check
4. Applies rules (stock/price/pruning) and takes action
5. Moves to next item, then next page
6. Optionally loops continuously

### The Flow

#### 1. User clicks "Start Tracking" on tracker page
- Checks membership (Ultimate required) — SKIP THIS, DropFlow is free
- Checks at least one filter checkbox is enabled
- Sends `start_tracking` message to background

#### 2. Background receives `start_tracking`
Function `_0xeba795(sender)`:
```
1. Get settings: should_pin_tabs, tracker_run_status
2. If tracker_run_status is false, exit
3. Build eBay active listings URL:
   https://www.ebay.{domain}/sh/lst/active?offset={(page-1)*limit}&limit={limit}&sort=listingSKU
   - If force_domain enabled, append &sites={siteId}
4. Get or create tracker tab (reuses `trackerTabId` from storage)
   - If tab exists: navigate it to the URL
   - If not: create new tab, save ID to storage
   - Optional: pin the tab
5. Wait for tab to load (onTabUpdated + page-loaded-and-stable message)
6. Send `start_tracking_page` to the tracker tab's content script
7. Content script responds with isPageOpenedCorrectly
8. If page didn't load correctly: close tab, wait 5s, retry recursively
```

#### 3. Content script on eBay active listings page
Receives `start_tracking_page`, then:
```
For each item row on the page (position 1 to 200):
  1. Read the listing: item number, title, custom label (SKU), price, quantity, status
  2. Send `update_tracker_position` to update progress UI
  3. Check each enabled rule:

  STOCK MONITOR:
  - If enabled: check Amazon for stock
  - Open supplier tab (reusable `supplierTrackingTabId`)
  - Navigate to Amazon product page: https://www.amazon.{domain}/dp/{ASIN}?th=1&psc=1
  - Content script on Amazon page: get price, availability, prime status, free shipping, delivery time, SKU
  - If product NOT available on Amazon → action: delete listing OR set qty=0
  - If product available:
    - If currently OOS on eBay → restock to configured quantity
    - If force_restock enabled → always set to configured qty
  - Prime filter: if "prime_only" selected, skip non-prime items

  PRICE MONITOR:
  - If enabled: compare Amazon price to eBay price
  - Markup pricing: newEbayPrice = amazonPrice * (1 + markupPercentage/100)
  - Variable pricing: (uses tiers - not fully visible in this version)
  - Price trigger threshold: only update if price changed by more than ±$X
  - Price ending filter: only monitor items with specific price endings (99, 97, 95)
  - If price changed beyond threshold → update eBay listing

  PRUNING RULES:
  - Delete items with no SKU
  - Delete items with broken SKU (base64 decode fails)
  - Delete items not found on Amazon
  - Delete items where SKU changed on Amazon
  - Delete items with ≤N sales older than M days
  - Delete items by non-Chinese sellers
  - Set GSPR
  - Set SKUs to items
  - Scan for restricted words
  - Each rule: action = "delete" | "out_of_stock" | "save_item_id"

  4. Save position to storage (for resume)
  5. Move to next item
  6. When page complete: increment page_number, navigate to next page, repeat
  7. If continuous_tracking enabled: loop back to page 1 when all pages done
```

#### 4. Amazon Data Fetching
Function `fetchAmazonData(url, sender)`:
```
1. Get or create supplier tab (`supplierTrackingTabId`)
   - Reuses a SINGLE tab for all Amazon checks (like DropFlow's new reusable tab)
   - If tab exists: navigate it to the Amazon URL
   - If not: create new tab at index 0, save ID
   - Optional: pin the tab
2. Wait for tab to load
3. Send `get_amazon_data` to content script on Amazon page
4. Content script returns: {
     price, quantity, brand, sku, 
     isItemAvailable, isEligibleForPrime, hasFreeShipping,
     isItemDeliveryExtended, isIpBlocked, hasNetworkError,
     availabilityMessage, deliveryTimeMessage, itemCondition
   }
5. Validate: IP block, network error, availability, prime, shipping, SKU match
```

#### 5. eBay Listing Actions
- **Restock**: Navigate to revision page, fill quantity
- **Update price**: Navigate to revision page, fill price
- **End item**: Open active listings, search for item, click end
- **Delete/OOS**: End item OR set quantity to 0

#### 6. UI/Settings (tracker page)

MAIN CONTROLS:
- Start Tracking button + toggle switch
- Reset button (resets position to 1, page to 1)

TRACKER FILTERS:
- [x] Enable Stock Monitor
  - Prime filter: All Items | Prime Only
  - Restock Quantity: [number input, default 1]
- [x] Enable Price Monitor  
  - Pricing Option: Markup Pricing | Variable Pricing
  - Markup Percentage: [number, default 100]%
  - Price Trigger Threshold (±$): [number, default 2]
- [x] Only Price Monitor Items with Ending Price: [text, e.g. "99,97,95"]

PRUNING OPTIONS:
- [x] Delete Policy Violation Items
- [x] [Delete|OOS] items with no SKU
- [x] [Delete|OOS] items with broken SKU
- [x] [Delete|OOS] items not found on Amazon
- [x] [Delete|OOS] items where SKU changed on Amazon
- [x] [Delete|OOS] items with ≤[N] sales older than [M] days

ADDITIONAL SETTINGS:
- Link: "Open CSV Tracker"
- [x] Enable Continuous Tracking
- Tracking Timeout (seconds): [default 60]
- [x] Log Data + [Open Logs] button
- [x] Pin Tabs
- [x] Keep eBay Page Open
- [x] Force Domain
- [x] Force stock to [N] if item is available on Amazon
- Page: [input] / [total]
- Position: [input] / [max]

PROGRESS BARS (fixed top-right):
- Item: "Item X of Y (Z%)" with fill bar
- Page: "Page X of Y (Z%)" with fill bar

---

## What DropFlow Must Implement (EXACT COPY)

### 1. Replace current monitor page with EcomSniper-style tracker page
- New HTML matching the layout above
- Settings saved to chrome.storage.local with SAME key structure
- Start/Stop toggle
- All filter checkboxes with their sub-options
- Position/page tracking with manual override
- Dual progress bars (item + page)
- Reset button

### 2. Background: page-based tracking flow
- `START_TRACKING` → open eBay active listings tab, iterate through DOM
- Content script on eBay Seller Hub that reads listing rows
- For each listing: extract item number, title, Custom Label, price, qty
- Base64 decode Custom Label to get ASIN
- Open Amazon in reusable supplier tab
- Get price/stock data from Amazon content script
- Apply enabled rules
- Update eBay listing via revision tab if needed
- Track position/page for resume
- Support continuous tracking (loop)

### 3. Reusable supplier tab (ALREADY DONE by previous CodexBot)
- Single pinned tab for Amazon checks
- Navigate between products instead of opening/closing tabs

### 4. eBay revision actions
- Restock: open revision page, set quantity
- Reprice: open revision page, set price  
- End/delete: open active listings, search, end item
- Set OOS: set quantity to 0

### 5. Tracking logs
- Log each check with timestamp, item, action taken, result
- Viewable from tracker page

### 6. Keep existing DropFlow features that DON'T conflict:
- CSV import (already built)
- Manual product addition
- Alert system
- Sale poller

### Key Implementation Notes:
- Domain defaults to `com.au` for DropFlow (EcomSniper defaults to `com`)
- No membership/credits check (DropFlow is free)
- Keep DropFlow's existing message-passing patterns
- Content scripts needed:
  1. eBay Seller Hub active listings page scraper (reads rows)
  2. Amazon product page scraper (ALREADY EXISTS)
  3. eBay revision page automation (ALREADY EXISTS)
- All settings use chrome.storage.local
- Progress updates via chrome.runtime.sendMessage
