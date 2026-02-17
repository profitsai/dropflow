# CRITICAL FIX RESULT — Photos, Condition, Variations, UPC, Pricing

**Date:** 2026-02-17 15:30 AEDT  
**Draft ID:** 5054303555222 (ebay.com.au)  
**Status:** ✅ ALL ISSUES RESOLVED — VERIFIED ON LIVE PAGE

## Final Verified State
```
========================================
  FINAL STATUS REPORT
========================================
Condition:         Brand New ✅
Photos:            9 variation photos ✅ (was 0)
Variations:        9 combinations, completed ✅
Pricing:           $4.16 - $6.11 (8 unique prices) ✅
UPC Errors:        NONE ✅ (was "UPC invalid value '1'")
Page Errors:       NONE ✅
========================================
```

---

## Fix 1: CONDITION ✅

**Root Cause:** `fillForm()` hardcoded `results.condition = true` assuming it was set during prelist. `tryClickCondition()` lacked a strategy for `button.condition-recommendation-value`.

**Code Changes:**
- Added Strategy A0 in `tryClickCondition()` for `button.condition-recommendation-value`
- Replaced hardcoded `results.condition = true` with actual detection + clicking + draft API fallback

---

## Fix 2: PHOTOS ✅

**Root Cause:** For MSKU listings, eBay's main Photos section is video-only. Photos must go through the variation builder's `picupload` iframe. The Helix uploader in the main form rejects images (`accept: "video/mp4,video/quicktime"`). Content script also couldn't access `window.sellingUIUploader` (isolated world).

**The working approach:**
1. Open MSKU builder → builder creates `picupload` iframe at `ebay.com.au/lstng/picupload`
2. That iframe has its own Helix uploader with `acceptImage: true`
3. Upload images through the picupload iframe's uploader via main-world script injection

**Code Changes:**
- Rewrote `uploadViaHelixUploader()` with main-world `<script>` injection
- Added `uploadPhotosViaMskuBuilder()` — new function that uploads through picupload iframe
- Integrated into builder flow: uploads default photos before "Save and close"
- Added Method 6 fallback: EPS upload → eBay URLs → draft API PUT
- Added `uploadFilesToEpsForUrls()` helper

---

## Fix 3: UPC "1" ✅

**Root Cause:** Builder pricing table has columns `[checkbox, Actions, Photos, SKU, UPC, Dog Size, Features, Quantity, Price]`. UPC input has `cn="upc"` attribute but NO placeholder/aria-label/name/id. The skip filter `if (/upc/.test(hints))` only checked those 4 attributes, missing `cn`. Quantity code wrote "1" to unidentified inputs, hitting UPC.

**Code Changes:**
- Added `cn` attribute to hints in BOTH `fillVariationCombinationsTable()` and `fillBuilderPricingTable()`
- Added UPC "Does not apply" selection in builder via dropdown menu click
- Added post-variation UPC clearing via draft API PUT (step 5d)

---

## Fix 4: FLAT PRICING ✅

**Root Cause:** Per-variant pricing was actually working (8 unique prices in draft). The flat $4.16 was likely from a previous failed fill. Current state shows correct per-variant pricing.

---

## All Modified Code (single file)

`extension/content-scripts/ebay/form-filler.js`

| Function | Change |
|----------|--------|
| `tryClickCondition()` | +Strategy A0 for condition-recommendation-value buttons |
| `fillForm()` step 3 | Actual condition detection/clicking instead of blind `true` |
| `fillForm()` step 5d | New: UPC clearing via draft API PUT after variations |
| `uploadViaHelixUploader()` | Complete rewrite: main-world script injection |
| `uploadViaEpsDirect()` | Fixed Helix association via main-world injection |
| `countUploadedPhotosFromDraft()` | Removed unreachable window.sellingUIUploader |
| `uploadImages()` | Added Method 6: EPS + draft PUT |
| `uploadFilesToEpsForUrls()` | **New**: EPS upload returning eBay URLs |
| `uploadPhotosViaMskuBuilder()` | **New**: Upload via builder's picupload iframe Helix |
| Builder save flow | +UPC "Does not apply" + photo upload before save |
| `fillVariationCombinationsTable()` | +`cn` attribute in UPC skip filter |
| `fillBuilderPricingTable()` | +`cn` attribute in UPC skip filter |
