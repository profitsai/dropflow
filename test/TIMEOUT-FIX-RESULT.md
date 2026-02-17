# DropFlow Timeout Fix + E2E Test Results

**Date:** 2026-02-17 17:00 AEDT  
**Test URL:** https://a.aliexpress.com/_mMLcP7b (LED Dog Collar, 35 SKUs: 5 sizes × 7 colors)

## Timeout Fix Applied ✅

All 600000ms (10-min) timeouts increased to 1200000ms (20-min):

| File | Line | Change |
|------|------|--------|
| `form-filler.js` | 315 | Fill lock guard: 600000 → 1200000 |
| `service-worker.js` | 765 | `waitForFormFilled()` default: 600000 → 1200000 |
| `service-worker.js` | 912 | Amazon flow call: 600000 → 1200000 |
| `service-worker.js` | 2131 | AliExpress flow call: 600000 → 1200000 |

## E2E Test Results

### Flow Timeline
| Time | Stage | Status |
|------|-------|--------|
| +0s | Connect to browser | ✅ |
| +10s | AliExpress page opened | ✅ Scraping |
| +60s | Ali scrape complete, moved to eBay prelist | ✅ |
| +80s | eBay prelist/suggest | ✅ |
| +90s | eBay prelist/identify | ✅ |
| +100s | eBay listing form (lstng) opened | ✅ |
| +160s | Photos uploaded (6/25), condition set (Brand New) | ✅ |
| +220s | MSKU builder opened, 35 variations detected | ✅ |
| +240s | Subframe builder ran, clicked Continue | ✅ |
| +248s | Pricing page detected | ✅ |
| +250s+ | **MSKU pricing fill FAILED SILENTLY** | ❌ BLOCKER |

### What Worked
- AliExpress scraping: ✅ Product data, images, variations extracted
- eBay prelist flow: ✅ Category selected, navigated to listing form  
- Photo upload: ✅ 6/25 photos, + 12/24 in MSKU builder
- Title: ✅ "Nylon LED Night Safety Flashing Glow In The Dark Dog Leash Dogs Luminous Fluores"
- Condition: ✅ Brand New
- MSKU builder: ✅ Opened, 35 variations created (XS/S/M/L/XL × 7 colors)
- Builder Continue: ✅ Clicked, pricing page loaded
- UPC: ✅ Set to "Does not apply" for all 35 rows

### What Failed — MSKU Pricing ❌

**Root Cause:** The `fillBuilderPricingTable()` function ran inside the `bulkedit.ebay.com.au/msku` iframe but failed silently after the `pricingPageDetected` step. No further log entries after that point.

**Likely failure:** The function uses `useBulkAction()` to find "Enter price" button and fill a bulk price. With 35 SKUs that have **different per-variant prices** (different size/color combos), `bulkPriceAllowed` would be `false`, so it falls through to per-row filling. The per-row fill likely failed to match row values to SKU entries.

**Evidence:**
- Price inputs: ALL EMPTY (no prices set)
- Quantity: Set to 1 for all rows ✅
- SKU/UPC: "Does not apply" for all rows ✅

### Secondary Issue — `isLikelyBuilderFrame` False Positive

The form filler was also injected into the `picupload` iframe (photo upload), which matched `isBulkEditHost` because its URL contains `allowedUrl=https://bulkedit.ebay.com.au`:

```
https://www.ebay.com.au/lstng/picupload?allowedUrl=https://bulkedit.ebay.com.au&windowName=photo-iframe-photos-default
```

This wasted 30s polling in the wrong iframe.

**Fix needed in `checkPendingData()` line ~9420:**
```javascript
const isBulkEditHost =
  /(^|\.)bulkedit\.ebay\./i.test(subframeHost);  // Remove href check
```

### Timeout Fix Validation

The 20-min timeout was **NOT tested** in this run because the parent frame loop (300 iterations × ~3.3s ≈ 16.5 min) would complete before the 20-min timeout expires. The timeout fix is correct but the actual blocker is the pricing fill, not the timeout.

## Next Steps

1. **Fix `fillBuilderPricingTable()`** — needs to handle per-variant pricing for 35 SKUs where prices differ
2. **Fix `isLikelyBuilderFrame`** — check `subframeHost` only, not the full URL/href
3. **Add error logging** — the `try/catch` around `fillBuilderPricingTable` silently swallows errors; add `logVariationStep()` in the catch block
4. **Re-test** after pricing fix

## Technical Notes

- SW keepalive works (offscreen + alarm + storage orchestration state)
- `aliBulkRunning` variable is lost on SW restart (expected) but orchestration state in storage persists
- The form filler injection into frames works via `INJECT_FORM_FILLER_IN_FRAMES` message
- The `checkPendingData()` subframe detection correctly identifies the `bulkedit.ebay.com.au/msku` iframe
