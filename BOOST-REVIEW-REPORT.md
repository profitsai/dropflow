# Boost My Listings — Code Review Report

**Date:** 2026-02-18  
**Reviewer:** DropFlow Code Review (automated)  
**Files reviewed:** 8 source files + EcomSniper originals  
**Tests:** All 162 existing tests pass ✅

---

## Executive Summary

The Boost My Listings feature is **mostly well-implemented** with clean architecture that improves on EcomSniper's obfuscated original. However, there are several bugs ranging from medium to critical severity, plus architectural concerns around the content script being largely dead code.

**Overall Verdict: 🟡 Needs fixes before production use.**

---

## Bugs Found

### BUG-1: Content script is dead code — background uses `executeScript` instead (Severity: LOW / Design)

The content script `boost-listings.js` registers 8 message handlers (END_LOW_PERFORMING_ITEMS, SELL_SIMILAR_ENDED_ITEMS, etc.), but the background service worker **never sends these messages**. Instead, the background handlers (`handleEndLowPerformers`, `handleBulkRevise`, `handleSendOffers`, `handleReviewOffers`) use:
- `scrapeAllActiveListings()` → which messages the *active-listings-scraper.js* content script
- `reviseEbayListing()` → which messages the *form-filler.js* content script  
- `chrome.scripting.executeScript()` → inline functions for Send Offers / Review Offers

**Impact:** The entire `boost-listings.js` content script (~400 lines) is injected on every Seller Hub page but never used. It adds page weight and the double-injection guard suggests it was considered, but the background took a different (better) architectural approach.

**Recommendation:** Either remove the content script and its manifest entry, or refactor the background to use it. The current `executeScript` approach is actually more reliable for MV3.

### BUG-2: Schedule alarm action mismatch (Severity: HIGH) 🔴

**boost-listings.js (page)** sends:
```js
schedule = { action: 'scheduled-boost', ... }
```

**service-worker.js alarm handler** checks:
```js
switch (schedule.action) {
  case 'end-sell':      // ← never matches
  case 'bulk-revise':   // ← never matches
  case 'send-offers':   // ← never matches
}
```

The page always sets `action: 'scheduled-boost'` but the alarm handler expects `'end-sell'`, `'bulk-revise'`, or `'send-offers'`. **Scheduled automation will silently do nothing.**

**Fix:** The schedule should check `sellSimilarEnabled` and `reviseEnabled` flags instead of a single `action` string.

### BUG-3: Schedule alarm `when` parameter not used (Severity: MEDIUM) 🟡

`handleScheduleBoost()` creates the alarm with only `periodInMinutes`:
```js
await chrome.alarms.create('boost-schedule', {
  periodInMinutes: schedule.intervalHours * 60
});
```

This fires the first alarm after `intervalHours` (e.g., 24h), ignoring the user's configured start time. EcomSniper correctly uses `when` to set the first fire at the scheduled time:
```js
chrome.alarms.create(alarmName, { when: targetTime.getTime(), periodInMinutes: ... });
```

### BUG-4: `markupMultiplier` computed but unused in Review Offers (Severity: LOW)

In `boost-listings.js` page script:
```js
const markupMultiplier = 1 + (markupPct / 100);  // computed but never sent
const response = await chrome.runtime.sendMessage({ type: REVIEW_OFFERS, minMarkup: markupPct });
```

The `markupMultiplier` variable is dead code. Not a functional bug since the background receives `minMarkup` (percentage) correctly.

### BUG-5: `handleSendOffers` uses inline `executeScript` with no discount input handling (Severity: MEDIUM) 🟡

The `handleSendOffers` function clicks "Send Offer" via `executeScript`, then in a second `executeScript` call tries to fill a discount input. However, eBay's Send Offer modal may not have loaded in the 3-second `sleep(3000)` gap. There's no `waitForElement`-style retry — it's a fire-and-forget pattern that will likely miss the modal on slower connections.

### BUG-6: `safeClick` in content script fires click twice (Severity: LOW)

```js
function safeClick(el) {
  el.click();                                           // click 1
  el.dispatchEvent(new MouseEvent('click', {...}));     // click 2
}
```

This double-click can cause issues with toggles (checkboxes toggled on then off). EcomSniper only dispatches once.

---

## Missing Features vs EcomSniper

### MISS-1: No `autoClose` tab behavior
The page UI has an `autoCloseToggle` setting, and it's sent in the payload (`autoClose`), but `handleEndLowPerformers` never reads or acts on it. EcomSniper closes the tab automatically when `autoCloseSellSimilarTab` is true.

### MISS-2: No "Cancel" message for content script operations
The `CANCEL_BOOST` handler sets `boostCancelled = true`, but only the scrape loop and revision loop check this flag. If a `reviseEbayListing` call is in-progress (waiting 60s for tab), the cancel has no effect until the current item completes.

### MISS-3: Sell Similar uses revision URL, not eBay's bulk Sell Similar flow
EcomSniper's flow: select items on ended listings page → bulk action "Sell Similar" → bulk edit form → submit. DropFlow's approach opens individual `/sl/sell?mode=SellSimilar&itemId=X` URLs for each item. This is functional but **much slower** for large batches (serial per-item vs one bulk operation).

### MISS-4: Bulk Revise is per-item, not eBay's bulk edit
Same as above — EcomSniper uses Seller Hub's native bulk edit UI. DropFlow opens individual revision tabs. Functional but 10-50x slower for hundreds of listings.

---

## Selector Concerns

Since the content script is dead code (BUG-1), the selectors in `boost-listings.js` are moot. The actual DOM interaction happens via `chrome.scripting.executeScript` inline functions in the service worker, which use similar defensive patterns. These inline selectors are adequate but fragile:

- `'thead input[type="checkbox"]'` — works for current Seller Hub
- `'tbody tr'` — too generic, may match non-listing rows
- Button text matching (`/send offer/i`) — reasonable for eBay's current UI

The `active-listings-scraper.js` content script (which IS used) was not in scope but is the real workhorse.

---

## MV3 Compliance ✅

No violations found:
- No `eval()`, no remote code execution
- Uses `chrome.scripting.executeScript` correctly
- `chrome.alarms` for scheduling (not `setInterval` for long delays)
- Module imports in service worker
- Proper keep-alive patterns already in place

---

## Integration & Message Types ✅

- No message type collisions — all boost types are prefixed/unique
- Storage keys are namespaced with `boost` prefix — no conflicts
- The content script manifest entry matches `https://www.ebay.*/sh/lst/*` and `https://bulkedit.ebay.*/*` — broad but correct

---

## Scheduling Assessment

- **Alarm creation:** Works but missing `when` parameter (BUG-3)
- **Alarm handler:** Broken due to action mismatch (BUG-2)  
- **Countdown timer:** Correct implementation — calculates next run and updates every second
- **Interval options:** 1-24 hours matches EcomSniper

---

## UI Assessment

- **CSP:** External Font Awesome CDN link may fail if CSP blocks it. Should bundle locally.
- **Modals:** Work correctly with data-modal-target pattern
- **Settings persistence:** Correct — auto-saves on change, loads on page open
- **Log viewer:** Clean implementation with 200-entry cap

---

## Security

- **No XSS risks** in the extension pages (no `innerHTML` with user data in the page script; logs use `textContent`)
- **Content script** uses `innerHTML` nowhere — safe
- **`executeScript` inline functions** don't process untrusted input unsafely

---

## Recommendations

1. **Fix BUG-2 (critical):** Rewrite alarm handler to check `sellSimilarEnabled`/`reviseEnabled` flags
2. **Fix BUG-3:** Add `when` parameter to alarm creation
3. **Remove or repurpose `boost-listings.js`** — it's 400 lines of dead code being injected on every Seller Hub page
4. **Fix `safeClick` double-fire** — remove either `.click()` or `.dispatchEvent()`
5. **Bundle Font Awesome** locally instead of CDN
6. **Add `autoClose` support** to `handleEndLowPerformers`
7. **Consider batch operations** for Sell Similar / Bulk Revise using the content script approach (would make the content script useful)

---

## Files Changed

Bugs fixed inline:
- `extension/background/service-worker.js` — BUG-2 (alarm action mismatch), BUG-3 (missing `when`)
- `extension/content-scripts/ebay/boost-listings.js` — BUG-6 (double click)
