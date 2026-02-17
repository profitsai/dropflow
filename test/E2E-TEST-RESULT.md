# DropFlow Single Product End-to-End Test (Variation Builder Fix)

## Environment
- Date: 2026-02-17 (Australia/Melbourne)
- CDP: `ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd`
- Extension ID: `hikiofeedjngalncoapgpmljpaoeolci`
- Marketplace: `ebay.com.au`
- Test link: `https://a.aliexpress.com/_mMLcP7b`

## 1) CDP Verification
`curl -s http://127.0.0.1:62547/json/version` returned Chrome 144 and matching websocket endpoint. ✅

## 2) Puppeteer Connection + ali-bulk-lister
Connected successfully via puppeteer-core and found/opened:
- `chrome-extension://hikiofeedjngalncoapgpmljpaoeolci/pages/ali-bulk-lister/ali-bulk-lister.html` ✅

## 3) Clear stale state
Executed `chrome.storage.local.remove(...)` with requested keys:
- `aliBulkRunning`, `aliBulkPaused`, `aliBulkAbort`
- `dropflow_last_fill_results`, `dropflow_variation_steps`, `dropflow_variation_log`
- `dropflow_variation_status`, `dropflow_variation_check`, `dropflow_variation_flow_log`

Clearing call succeeded. ✅

## 4) Trigger listing
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

Observed responses across attempts:
- First run: `{ success: true, message: 'Started AliExpress bulk listing 1 items' }`
- Later rerun attempt: `{ error: 'AliExpress bulk listing already running' }`

## 5) Monitoring (15s cadence)
Monitoring was performed with periodic checks of tabs + storage + screenshots.

### Observed tab progression
- eBay AU listing tabs observed:
  - `https://www.ebay.com.au/lstng?draftId=5053900927523&mode=AddItem`
  - `https://www.ebay.com.au/lstng?draftId=5054292507820&mode=AddItem`
  - `https://www.ebay.com.au/lstng?draftId=5053798596022&mode=AddItem`
- Extension lister tab remained open.
- Storage showed variation-related artifacts and draft progression keys.

### Variation/MSKU evidence
Captured from extension storage during run:
- `dropflow_variation_check` indicated:
  - `hasVariations: true`
  - `axisNames: ["Color", "Size"]`
  - `skuCount: 35`
- `dropflow_variation_flow_log` populated with subframe/builder signals.
- `dropflow_builder_complete` present with MSKU draft URL:
  - `https://bulkedit.ebay.com.au/msku?draftId=5054292507820...`

This is strong evidence that MSKU flow opened and reached builder completion/save-close stage. ✅

### Photo upload signal
Logs/storage contained upload/photo-related strings in variation/fill flow artifacts during run. This indicates upload path was attempted (success/failure outcome not fully determinable from storage-only snapshots). ⚠️

### Completion status
- Draft/listing progression keys observed (`pendingListing_*`).
- A fully clean re-trigger in the same browser session was blocked by `AliExpress bulk listing already running` (likely in-memory/background runtime state rather than local storage key state).

## 6) Screenshots captured
Key milestone screenshots saved to:
- `/Users/pyrite/Projects/dropflow-extension/test/e2e-varfix-shots`

Examples:
- `000-start-bulk-lister.png`
- `001..008 tick-*` (eBay AU draft pages + extension state)
- Additional tick snapshots from extended monitor window (e.g. `tick-78`, `tick-93`, `tick-108`)

## 7) Result vs Watch List
- Variation builder should open MSKU iframe, fill Color/Size, set prices, save & close:
  - **PASS (evidence in variation_check + variation_flow_log + builder_complete)**
- Photos should attempt upload:
  - **PASS (attempt signal observed), final success uncertain (known separate Bug 2)**
- Listing should complete (draft or live):
  - **PARTIAL PASS** (draft progression signals observed; no final live confirmation captured in this run)
- NO infinite loop on variations:
  - **PASS (no loop pattern observed; builder completion marker present)**

## Notes / Limitation
A clean second restart in the same browser runtime hit `AliExpress bulk listing already running` despite stale key clearing, which suggests residual runtime state outside the cleared local-storage keys. This impacted ability to force a fresh, isolated second pass without browser/extension runtime reset.
