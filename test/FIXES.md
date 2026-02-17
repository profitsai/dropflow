# DropFlow Extension Fixes (2026-02-16)

## Scope
Reviewed and fixed issues in:
- `extension/content-scripts/ebay/form-filler.js`
- Audited `extension/content-scripts/aliexpress/product-scraper.js` data shape compatibility with form filler

---

## Root Causes Found

### 1) Form filling stopped mid-way
**Cause:** `fillForm()` had a single top-level `try/catch`. If any inner step threw (description fill, image upload, variation flow, specifics), the rest of the form flow aborted.

**Fixes:**
- Added a **per-frame fill lock** (`__dropflowFillFormLock`) to prevent duplicate concurrent `fillForm()` runs from reinjection/watchers.
- Kept top-level safety but added **step-level exception isolation** so failures in these steps no longer abort the entire listing flow:
  - `fillDescription(...)`
  - `uploadImages(...)`
  - `fillVariations(...)`
  - `uploadVariationImages(...)`
  - `fillItemSpecifics(...)`
- Added lock cleanup in `finally`.

Result: one failed step no longer stops photos/description/price/other steps from continuing.

---

### 2) Variation builder cross-subdomain iframe instability (`bulkedit.ebay.com.au`)
**Cause:** cross-context lock only worked when `draftId` existed in URL. In bulkedit/msku contexts this can be missing, allowing duplicate parent+iframe runs/races.

**Fixes in `runVariationBuilderPageFlow()`**
- Extended cross-context lock scope:
  - Primary scope: `draft_<draftId>` (existing behavior)
  - Fallback scope when no draftId: `surface_<hostname><pathname>`
- Added fallback lock TTL (`30s`) for non-draft scope (vs `120s` for draft scope).
- Improved lock diagnostics (`scope`, age, host) and auto-clear behavior.

Result: fewer parent/iframe race conditions during builder execution on bulkedit subdomain.

---

### 3) Image upload cascade failing all methods
**Causes:**
- File input detection could pick the wrong `input[type=file]` (not the active photos uploader).
- Some eBay/Marko surfaces respond better to synthetic click/event chains than raw `.click()`.
- File input change path lacked `input` event in some flows.

**Fixes:**
- Reworked `findFileInput()` to score/select best uploader input by:
  - `#fehelix-uploader` priority
  - `accept` image hints
  - `multiple`
  - photo-section proximity / uploader class context
  - visibility
- In upload trigger paths, replaced direct `.click()` with `simulateClick(...)` for Marko/React compatibility.
- In `uploadViaFileInput(...)`, dispatch both `input` and `change` after setting files, with focus attempt first.

Result: Method 1 (file input) is now more reliable; fallback methods still remain intact.

---

## Product Scraper Compatibility Audit
Reviewed `product-scraper.js` output shape used by form filler:
- `images[]`
- `variations = { hasVariations, axes[], skus[], imagesByValue }`
- optional `preDownloadedImages[]` (injected by service worker)

No schema mismatch requiring scraper changes was found for the current failing symptoms.

---

## Files Changed
- `extension/content-scripts/ebay/form-filler.js`

## Files Reviewed (no code changes)
- `extension/content-scripts/aliexpress/product-scraper.js`

---

## Notes for Retest
1. Test multi-variation listing with bulkedit iframe on `ebay.com.au`.
2. Confirm only one fill run starts per frame (no duplicate interleaving logs).
3. Validate photo upload method order still executes, with improved Method 1 success rate.
4. Validate that if one step throws, later steps still run and listing can continue.
