# DropFlow Full E2E Test Results

**Date**: 2026-02-17 15:27–15:40 AEDT  
**Test URL**: https://a.aliexpress.com/_mMLcP7b  
**Marketplace**: ebay.com.au  
**Listing Type**: Standard  
**Draft ID**: 5054303555222

---

## Summary: ❌ BLOCKED — Photos not persisting to final listing form

The extension successfully completed **all stages except photo persistence** to the eBay listing. The "List it" click was blocked by eBay's validation: "Add at least 1 photo."

---

## Stage Results

| Stage | Status | Details |
|-------|--------|---------|
| AliExpress scrape | ✅ Pass | Product scraped: "Nylon LED Dog Collar Night Safety Glow Flashing Pet Leash" |
| eBay navigation | ✅ Pass | Navigated to prelist → identify → listing form |
| Condition click | ✅ Pass | "Brand New" selected |
| Photo upload (EPS) | ⚠️ Partial | Photos were uploading (observed 5/24 default photos) but did NOT persist to the final "Complete your listing" form |
| Variation builder | ✅ Pass | 9 variations created: Dog Size (S, M, L) × Features (Red, Blue, Green) |
| Per-variant pricing | ✅ Pass | AU $4.16 – AU $6.11 (different prices per SKU) |
| Description fill | ✅ Pass | HTML template with title, key features (USB rechargeable, Adjustable), description |
| Title | ✅ Pass | "Nylon LED Dog Collar Night Safety Glow Flashing Pet Leash" (57/80 chars) |
| Category | ✅ Pass | Collars in Pet Supplies > Dogs |
| Item specifics | ✅ Pass | Brand filled |
| "List it" click | ❌ BLOCKED | eBay validation error: "Add at least 1 photo" |
| UPC field | ℹ️ Not observed | Could not verify — field may not appear for this category |

---

## Blocker Details

### Photos Not Persisting

When the extension ran, it was observed uploading default photos (progressed from 1/24 to 5/24) on what appeared to be the variations/MSKU editor page. However, when the eBay page transitioned to the final "Complete your listing" unified form (`/lstng?draftId=...&mode=AddItem`), **zero photos** were present:

- Main video/photos section: 0 images
- Variation photos section: "Upload photos" placeholder, 0 images

The eBay error banner on "List it" click:
> "Looks like something is missing or invalid. Please fix any issues and try again. Photos"

Within the Variations section error:
> "Add at least 1 photo. More photos are better!"

### Likely Cause

The EPS photo upload was still in progress (only 5/24 completed) when the form filler moved on to the next step, causing a page transition that discarded the in-progress uploads. Or the photos were uploaded to a different page context (prelist/MSKU builder) that doesn't carry over to the final listing form.

### Service Worker Death

The extension's service worker was found dead (no service_worker target in CDP). This may have contributed to the flow not completing — the bulk listing orchestrator in the service worker couldn't process the `EBAY_FORM_FILLED` message or retry the flow.

### Extension Error Log

One error was visible on the extensions error page (from a different draft):
```
[DropFlow] Builder detection: isBuilder=false, score=3
Could not find 3-dot button with any strategy
```
Context: `form-filler.js:4586 (detectVariationBuilderContextWithLog)`

---

## What Worked Well

1. **AliExpress scraping** — Fast, reliable product data extraction
2. **Variation builder** — Successfully created 9 MSKU variations with correct axes
3. **Per-variant pricing** — Different prices per SKU (AU $4.16–$6.11)
4. **Description HTML** — Clean template with key features
5. **Form filling** — All text fields, condition, category properly set
6. **Condition selection** — "Brand New" correctly clicked

---

## Recommended Fixes

1. **Wait for ALL photo uploads to complete** before proceeding to the next form step. The form filler should poll/wait until the upload count matches the expected count (e.g., 24/24).

2. **Re-upload photos on the final form** if they didn't persist from the MSKU builder — detect the "Complete your listing" page and re-trigger photo upload via EPS.

3. **Service worker keepalive** — Ensure the service worker stays alive throughout the entire listing flow. The `startSWKeepAlive()` mechanism may not be working reliably.

4. **Add photo verification** before clicking "List it" — check that eBay's photo count indicator shows > 0 photos.

---

## Screenshots

- `e2e-check.png` — Variations page showing 1/24 photos uploading
- `e2e-check2.png` — 2/24 photos  
- `e2e-full.png` — 5/24 photos
- `e2e-check4.png` — Final "Complete your listing" with 0 photos (VIDEO section)
- `e2e-scroll-3.png` — Variations summary showing "Upload photos" placeholder
- `e2e-scroll-4.png` — Description and pricing filled correctly
- `e2e-after-submit.png` — Red error banner: "Looks like something is missing or invalid"
- `e2e-ext-errors.png` — Extension error log
