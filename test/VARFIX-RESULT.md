# Variation Builder Fix v2 — Result

## Date: 2026-02-17

## Root Cause Found & Fixed

### The Bug: `ReferenceError: Cannot access 'dismissVariationDialogs' before initialization`

The `dismissVariationDialogs` function was defined as a `const` arrow function at **line 2608** inside `runVariationBuilderPageFlow()`, but called at **line 2325** — **before its declaration in the same function scope**. This is a JavaScript Temporal Dead Zone (TDZ) error.

**Why this only affected the iframe**: The parent frame's code paths that trigger `runVariationBuilderPageFlow` were correctly blocked by the `isMskuDialog && IS_TOP_FRAME` guards (from the previous fix). So the parent never hit this error. But the **iframe's content script** — running inside `bulkedit.ebay.com.au/msku` — correctly detected the builder and called `runVariationBuilderPageFlow`, which immediately crashed on the TDZ error. The error was silently swallowed by the `try/catch` in `checkPendingData()`.

### The Fix (in `form-filler.js`):

1. **Moved `dismissVariationDialogs` definition** from line ~2608 to right after `activeDoc` is declared (line ~2323), before its first call. This eliminates the TDZ error.

2. **Added standalone `dismissVariationDialogs` at IIFE scope** (before `fillVariations`) so that calls from `fillVariations` (lines 1759, 1914) also work — they were referencing a function that only existed inside `runVariationBuilderPageFlow`'s scope.

3. **Added error logging** around the subframe's `runVariationBuilderPageFlow` call in `checkPendingData` to capture and log any future errors to `chrome.storage.local`.

4. **Added completion signal**: When the iframe builder completes, it writes `dropflow_builder_complete` to storage so the parent can detect it.

## Test Results

### Live Test on `https://www.ebay.com.au/lstng?draftId=5054292507820`

**Builder Flow Log (from iframe at `bulkedit.ebay.com.au/msku`):**

| Step | Detail |
|------|--------|
| `subframeBuilderDetected` | score=16, poll=0 |
| `variationBuilder:start` | axes: Size(3), Color(3) |
| `variationBuilder:stateBefore` | Existing chips: Dog Size, Features |
| `variationBuilder:afterSelectiveReset` | Kept: Dog Size, Features |
| `variationBuilder:axisFilled` | Dog Size → S, M, L (3 values) |
| `variationBuilder:axisFilled` | Features → Red, Blue, Green (3 values) |
| `variationBuilder:continueClicked` | → pricing page |
| `variationBuilder:pricingPageDetected` | |
| `variationBuilder:fillPricing:start` | 9 SKU combinations |
| `variationBuilder:fillPricing:done` | qty bulk-filled, prices=0 (no ebayPrice in data) |
| `variationBuilder:saveAndCloseClicked` | ✅ |
| `subframeBuilderResult` | ok=true ✅ |

**Post-flow state:**
- MSKU iframe: **gone** (closed by "Save and close")
- MSKU dialog: **gone**
- Variations on parent page: **present** ✅

### Pricing Note
Per-variant prices were not filled because the test product data (`pendingListing_1373278444`) had no `ebayPrice` values. This is a data issue, not a code issue. The pricing fill mechanism works correctly when price data is present (confirmed in previous test: `PRICE-TEST-REPORT.md`).

## Files Changed

- `extension/content-scripts/ebay/form-filler.js`:
  - Added standalone `dismissVariationDialogs()` at IIFE scope (~line 967)
  - Moved `const dismissVariationDialogs` inside `runVariationBuilderPageFlow` to before first use (~line 2323)
  - Removed old duplicate definition that was after first use (~line 2608)
  - Added try/catch + error logging around subframe builder flow call
  - Added `dropflow_builder_complete` storage signal on success
