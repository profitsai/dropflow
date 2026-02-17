# PHOTO-DEBUG-REPORT

Date: 2026-02-16

## Scope
Investigated why DropFlow reported photo upload blocked and why "List it" failed, using:
- `extension/content-scripts/ebay/form-filler.js`
- `extension/background/service-worker.js`
- `test/REAL-TEST-REPORT.md`

---

## Findings

## 1) Photo upload code is still intact (and is NOT only DOM injection)

Confirmed in `form-filler.js`:
- `uploadImages(...)` exists and is called from `fillForm(...)`.
- It implements **4 upload paths**:
  1. File input injection (`uploadViaFileInput`)
  2. Drag/drop simulation (`uploadViaDragDrop`)
  3. eBay media endpoint POST + draft update (`uploadViaEbayMediaApi`)
  4. **Direct eBay draft API PUT** (`uploadViaDraftApiPut`) to `/lstng/api/listing_draft/{draftId}` with multiple payload formats.

So the previous claim "eBay resists programmatic injection" is incomplete/misleading: the extension also has API-based upload paths, including direct draft PUT.

---

## 2) Service worker still supports image pre-download and upload proxy

Confirmed in `service-worker.js`:
- Pre-download flow for gallery images (`productData.preDownloadedImages`) and variation images (`productData.preDownloadedVariationImages`) is present.
- Captures eBay auth headers + draftId from `chrome.webRequest` into `ebayHeadersMap`.
- Exposes `GET_EBAY_HEADERS` for content script.
- Exposes `UPLOAD_EBAY_IMAGE` proxy to POST to media endpoints when content-script same-origin upload fails.

So backend plumbing for API/media upload is still present.

---

## 3) Why "List it" failed in the reported run

From flow and code behavior, the likely runtime failure path was:
- `uploadImages(...)` did run (it is always called when `productData.images.length > 0`, before variation builder).
- Upload methods failed in that session (or could not be confirmed by counters), resulting in `results.images = false`.
- Code still proceeded to click "List it" even when images failed.
- eBay blocked submission with photo-required validation.

Important: this is not caused by variation detection skipping image upload.

### Variation skip check
- `fillForm()` uploads images **before** variation flow.
- `hasVariations` logic does not bypass `uploadImages(...)`.

---

## 4) Difference from earlier successful listings

Earlier successful items likely succeeded because at least one upload path worked in those sessions (especially API-based path), not because the code lacked upload logic now.

The current failure report appears to have over-focused on DOM upload resistance and not validated API fallback success/failure with detailed logs.

---

## Code fixes applied

### Fix A: Prioritize draft API PUT before fragile DOM methods

In `uploadImages(...)`, I changed order so it now tries:
1. **Draft API PUT first** (preferred, non-DOM)
2. Then falls back to DOM/media cascade if PUT fails

Rationale: your known-good historical path was API-based; this avoids relying first on brittle file input/drag-drop UI behavior.

### Fix B: Do not submit listing when image upload failed

In `fillForm(...)`, added submission safety check:
- If listing has images but `results.images === false`, it now logs and **does not click "List it"**.

Rationale: prevents false "submit attempt" state and makes root cause explicit (image upload not confirmed) instead of ending at eBay validation error.

---

## What this means for the failing test

- The extension did not lose photo-upload code.
- The failure is likely a runtime path failure (or endpoint/payload mismatch in that session), not absence of logic.
- The new order + submit guard should make behavior closer to the previously successful API-first workflow and easier to diagnose if eBay changed payload requirements.

---

## Recommended next validation run (quick)

1. Run the same AliExpress test product again.
2. Confirm logs show:
   - `Preferred path SUCCESS: draft API PUT with URLs` (new message), or clear fallback diagnostics.
3. Verify at least 1 photo visible before submit.
4. Confirm no "photos required" block.

If still failing, capture the exact `Draft PUT failed (status)` response body from console for payload contract update against current eBay API schema.
