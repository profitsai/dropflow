# DropFlow Single Product Test Result (AliExpress → eBay AU)

**Date:** 2026-02-17 (Australia/Melbourne)  
**Extension ID:** `hikiofeedjngalncoapgpmljpaoeolci`  
**Product URL tested:** `https://a.aliexpress.com/_mMLcP7b`

## 1) CDP Check
`curl -s http://127.0.0.1:62547/json/version` returned valid Chrome JSON with:
- Browser: `Chrome/144.0.7559.59`
- websocket debugger URL matched provided endpoint

✅ CDP is alive.

## 2) Stale State Clear
Executed in extension context (`ali-bulk-lister.html`):
```js
chrome.storage.local.remove([
  'aliBulkRunning','aliBulkPaused','aliBulkAbort',
  'dropflow_last_fill_results','dropflow_variation_steps','dropflow_variation_log'
])
```

✅ Clear command executed.

## 3) Start Bulk Listing (single URL)
Sent:
```js
chrome.runtime.sendMessage({
  type: 'START_ALI_BULK_LISTING',
  links: ['https://a.aliexpress.com/_mMLcP7b'],
  marketplace: 'ebay.com.au',
  ebayDomain: 'www.ebay.com.au',
  listingType: 'standard',
  threadCount: 1
})
```
Response:
```json
{"success":true,"message":"Started AliExpress bulk listing 1 items"}
```

✅ Trigger accepted.

## 4) Monitoring (10s cadence)
Observed key tab flow:
- Ali short URL opened first: `https://a.aliexpress.com/_mMLcP7b`
- Then resolved to full AliExpress product URL (`/item/1005006995032850.html?...`)
- eBay AU listing tabs active (draft IDs seen):
  - `5054292507820`
  - `5053798596022`
  - `5053833876822`
- Also saw eBay prelist/suggest and prelist/identify pages briefly.

Screenshots captured during monitoring:
- Directory: `/Users/pyrite/Projects/dropflow-extension/test/single-test-shots`
- Count: **197** PNG files

## 5) Bug Fix Verification

### Bug 1 — Variation builder loop
❌ **Still looping / retry cycling observed**

`dropflow_variation_log` repeatedly shows the same failure pattern across drafts:
- `ensureVariationsEnabled:noThreeDotButton`
- `fillVariations:waitingForEditButton` (multiple attempts)
- `fillVariations:noEditButton`
- `fillVariations:blockSubmitAfterFailure`
- `keepPendingAfterVariationIncomplete`
- then it starts variation fill again on another/open draft

Also saw `fillVariations:mskuIframeTimeout`.

This indicates the variation flow is not converging and re-enters failure/retry sequences.

### Bug 2 — Photos upload
⚠️ **Not confirmed in this run**

No clear `dropflow_last_fill_results` photo-upload success payload was present in storage during/after this run. The run was dominated by variation-stage failures/retries, so image upload completion could not be validated.

### Bug 3 — Bulk flag clear
❌ **Not verified as fixed (completion state not reached)**

Expected lifecycle keys (`aliBulkRunning`, `aliBulkPaused`, `aliBulkAbort`) did not present a clean completion transition in storage during observation. Because the flow remained stuck in variation failure loops and never reached normal completion, bulk flag clear behavior could not be positively validated.

## 6) Console / Errors
No explicit browser console stack traces were captured in this run log, but extension diagnostic storage logs clearly show repeated variation flow failures and timeouts (`noThreeDotButton`, `noEditButton`, `mskuIframeTimeout`).

## 7) Outcome
- Short AliExpress URL handling: ✅ works (resolved/opened full product URL)
- Listing completion for this item: ❌ not completed
- Primary blocker: variation flow repeatedly fails and cycles

---

## Final assessment (single-product test)
For this test product on **ebay.com.au**, the automation did **not** successfully complete a listing due to repeated variation-stage failures/looping behavior. Therefore, bug fixes for variation-loop prevention and bulk completion/flag clearing are **not validated as passing** in this run; photo upload fix is **inconclusive** due to upstream blockage.
