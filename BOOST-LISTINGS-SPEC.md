# EcomSniper "Boost My Listings" — Replication Spec for DropFlow

## What It Does
Three main features to boost eBay listing visibility:

### 1. End & Sell Similar (Core Feature)
Ends low-performing listings and immediately relists them via "Sell Similar" to reset their search ranking.

**Flow:**
1. User sets filters: min sold (default 0), min views (default 1000), hours left (default 24)
2. Clicks "End & Sell Similar"
3. Background opens eBay active listings page sorted by time remaining (limit 200)
4. Content script on that page: `end_low_performing_items` — finds items matching filters (≤N sales, ≤N views, ending within M hours), selects them, clicks "End" 
5. If items were ended: navigates to ended listings page (unsold, not relisted, sorted by end date)
6. Content script: `sell_similar_ended_low_performing_items` — selects the just-ended items, clicks "Sell Similar"
7. eBay opens bulk edit page for the relisted items
8. Content script: `submit-bulk-edit-form` — submits the bulk edit
9. If auto-repeat enabled: loops until no more items match filters
10. If auto-close enabled: closes the tab when done

**Background functions (from obfuscated code):**
- `_0x16000c(sender, minSold, minViews, filterByHours)` — orchestrates the full flow
- `_0x5b7a7d(sender, automatic, tabId)` — opens ended listings, clicks sell similar
- `_0x44ef5d(sender, automatic, tabId)` — submits bulk edit form
- `_0x258be0(ebayData, retries)` — ends a single item via active listings search

### 2. Bulk Revise Listing
Iterates through all "menu options" (listing pages) on active listings and revises them — specifically toggling offers on/off.

**Flow:**
1. Opens eBay active listings page (sorted by scheduled start date, limit 200)
2. Content script counts total menu option pages
3. For each page: clicks the menu option, sends `revise_items` with the offers dropdown value
4. Content script on that page toggles offers on or off for all items
5. Exits, moves to next page
6. If "switch offer" enabled: after all pages, flips the dropdown (on→off or off→on)

**Background function:**
- `_0x268238(sender)` — the bulk revise flow

### 3. Optimization (Send Offers + Review Offers)
**Send Offers:**
- Opens eBay active listings filtered to `?pill_status=sioEligible` (items eligible for offers)
- Content script sends watcher offers at configured % discount
- Message: `send-offers-button-clicked` with percent

**Review Offers:**
- Opens eBay active listings filtered to `?status=PENDING_OFFERS`
- Content script reviews/accepts pending offers based on minimum markup multiplier
- Message: `review-offers-button-clicked:boost-my-listings`

### 4. Scheduling
- Chrome alarm `scheduleBoostAlarm` triggers at configured time
- Repeats at configured interval (1-24 hours)
- Can enable/disable sell similar and bulk revise automation independently
- Countdown timer shows time until next scheduled run

## Settings (chrome.storage.local keys)
```
minSoldQuantity: number (default 0)
minViewCount: number (default 1000)  
filterByHours: number (default 24)
autoCloseSellSimilarTab: boolean (default true)
autoRepeatSellSimilarTab: boolean (default true)
offersDropdownOption: number (0=on, 1=off)
switchOffer: boolean (default true)
scheduleSellSimilar: boolean
scheduledTimeSellSimilar: string (HH:MM)
scheduledInterval: number (hours, default 24)
sellSimilarScheduleAutomation: boolean (default true)
reviseListingScheduleAutomation: boolean (default false)
watcherOfferPercent: number (0-100, default 5)
best_offer_markup_multiplier: number (multiplier, e.g. 1.5 = 50% markup)
```

## What DropFlow Must Implement

### New Page: `extension/pages/boost/boost.html`
Copy the EcomSniper layout exactly:
- **End & Sell Similar** section: button + settings modal (min sold, min views, hours left, auto close, auto repeat)
- **Bulk Revise Listing** section: button + settings modal (switch offer toggle), offers dropdown
- **Optimization** section: send offers (% input + button), review offers (markup % + button)
- **Schedule Automation** modal: enable toggles for sell similar and bulk revise, time picker, interval dropdown
- Progress bar + status message
- Log viewer modal
- Current time display + countdown to next scheduled run

### New Content Script: `extension/content-scripts/ebay/boost-listings.js`
Runs on eBay Seller Hub active/ended listings pages. Handles:
- `end_low_performing_items` — filter rows by sold/views/time, select, end
- `sell_similar_ended_low_performing_items` — select ended items, click sell similar
- `submit-bulk-edit-form` — submit the bulk edit form
- `revise_items` — toggle offers on/off for all items on page
- `count_total_menu_options` — count pagination pages
- `click_bulk_revise_menu_option` — navigate to specific page
- `sendWatcherOffers` — send offers to eligible watchers
- `review_offer_and_action` — review pending offers

### Background Handlers (service-worker.js)
- `END_AND_SELL_SIMILAR` — full end + relist flow
- `BULK_REVISE_LISTING` — iterate pages, toggle offers
- `SEND_OFFERS` — open eligible listings, trigger offers
- `REVIEW_OFFERS` — open pending offers, review
- Scheduling via chrome.alarms

### Navigation Entry
- Add "Boost Listings" card to popup (like the existing Monitor/Orders cards)
- Or add as a tab within the monitor page

### Key Notes
- Domain: default `com.au`
- No membership check
- All the eBay Seller Hub DOM scraping is fragile (Marko.js SPA) — use defensive selectors
- The "Sell Similar" flow depends on eBay's bulk action UI — checkboxes, action dropdown, confirmation
- Keep existing DropFlow patterns (sendMessageSafe, message-types constants)
