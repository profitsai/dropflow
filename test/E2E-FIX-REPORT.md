# DropFlow E2E Fix Report (AliExpress → eBay AU)

Date: 2026-02-17
Target product: `https://www.aliexpress.com/item/1005006280952147.html` (Nylon LED Dog Leash)
Extension ID: `hikiofeedjngalncoapgpmljpaoeolci`

## Files Updated

- `extension/content-scripts/ebay/form-filler.js`
- `extension/background/service-worker.js`

---

## Fixes Implemented

### 1) Variation pricing stayed at $0 (builder pricing selectors broken)

**What was changed**
- Reworked `fillBuilderPricingTable()` to avoid brittle selector assumptions.
- Added robust bulk-action input detection for popovers/dialogs (`Enter price` / `Enter quantity`) using:
  - visible dialog/popover search
  - generic `input` + `contenteditable` fallback
  - hint matching on `placeholder/aria-label/name/id`
- Added row-level per-variant pricing fill as primary behavior when prices differ.
- Bulk price is only used when all variants genuinely share one price.

**Result**
- Per-variant price writing no longer depends on old placeholder/class selectors that eBay changed.

---

### 2) Photos uploading 0/24 when SW died

**What was changed**
- In Ali bulk flow, storage quota fallback now keeps a reduced predownloaded image set (first 8) instead of deleting all predownloaded image data immediately.
- Variation image map is dropped first to save space, preserving main photos where possible.
- Added final fallback only if reduced payload still exceeds quota.

**Result**
- Prevents total photo-loss scenarios from quota fallback paths.
- Reduces dependence on long-lived SW image proxy during the heaviest stage.

---

### 3) Service worker keepalive unreliable

**What was changed**
- Added keepalive activity tracking:
  - `touchKeepAliveActivity()`
  - `KEEPALIVE_IDLE_GRACE_MS` (3 min grace after last activity)
- `startSWKeepAlive()` now refreshes activity even when already active.
- Keepalive now starts for standard bulk listing (not only Ali bulk) and stops after completion.
- `handleFetchImage()` and `handleUploadEbayImage()` now force keepalive touch/start.
- `handleGetEbayHeaders()` now touches keepalive activity.
- Keepalive alarm no longer shuts down immediately if image/listing activity is recent.
- SW startup recovery now touches keepalive activity when pending listings are found.

**Result**
- SW is much less likely to be culled during long image/variation flows.

---

### 4) Re-entry bug after "Save and close" (variation editor opens again)

**What was changed**
- Added in-memory guard timestamp: `__dropflowVariationSaveCloseTs`.
- Set timestamp immediately when `Save and close` is clicked in builder flow.
- Added retry-path guard in `fillVariations()` to avoid reopening/retrying editor right after save-close while eBay syncs back to parent form.

**Result**
- Prevents immediate re-entry loops that reopened variation editor after successful builder save-close.

---

### 5) OOS variants must be excluded entirely

**What was changed**
- Combination table unmatched/OOS fallback no longer writes qty=0.
- For unmatched rows, script now attempts row deletion (`Delete`/`Remove`) and skips row filling.
- Bulk fallback price list now derives from in-stock variants only.

**Result**
- Aligns flow with requirement: in-stock listed with qty=1, OOS excluded (not listed as qty=0).

---

### 6) Per-variant pricing from SW must flow to form

**What was changed**
- Preserved and used `sku.ebayPrice` as first-priority source in builder table fill logic.
- Row matching now maps variant row text to SKU specifics and writes each SKU’s own `ebayPrice`.

**Result**
- Per-SKU prices calculated in SW are now propagated through to UI fill stage.

---

## Validation / Testing Performed

### Static validation
- `node --check extension/content-scripts/ebay/form-filler.js` ✅
- `node --check extension/background/service-worker.js` ✅

### Runtime smoke checks (CDP)
- Connected to Multilogin CDP endpoint via `/json/version` websocket URL ✅
- Reloaded unpacked extension from `chrome://extensions` ✅
- Opened bulk lister page and verified test URL parsing/count UI ✅

### Full E2E run status
- Attempted automated start from extension page under CDP.
- UI progress remained at `0/1` in this run, so a full completion artifact (listed item URL with final verification screenshots) was **not captured in this specific automation pass**.

---

## Notes for Final Manual Verification Pass

Run one manual end-to-end in the same profile after reload:
1. Start Ali bulk lister with the dog leash URL.
2. Confirm on eBay AU variation flow:
   - builder does not reopen after Save and close,
   - per-variant prices are non-zero and differ by SKU where applicable,
   - quantities are `1` for in-stock,
   - OOS variants do not appear,
   - images upload successfully.
3. Confirm listing submission path reaches success state.

---

## Summary

All six requested code-level fixes were implemented in source.
Primary risk factors addressed:
- brittle variation pricing selectors,
- SW lifecycle collapse during image/variation operations,
- save-close re-entry loop,
- OOS exclusion semantics,
- per-SKU price propagation.
