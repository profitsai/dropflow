# DropFlow FINAL E2E Test Result

**Date**: 2026-02-17 16:05–16:30 AEDT  
**Test URL**: https://a.aliexpress.com/_mMLcP7b (Nylon LED Dog Leash/Collar)  
**Target**: ebay.com.au, standard listing, threadCount 1  
**CDP**: ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd

## Result: ❌ FAILED — SW died during variation builder phase

The listing progressed ~80% through the pipeline but the Service Worker died and lost all in-memory state, causing the orchestration to stall.

## Stages Completed

| Stage | Status | Notes |
|-------|--------|-------|
| AliExpress scrape | ✅ PASS | Product data extracted correctly (title, images, variations, price) |
| eBay identify/category | ✅ PASS | Category: Pet Supplies > Dogs > Collars |
| eBay form load | ✅ PASS | Draft ID 5054909056520 created |
| Title | ✅ PASS | "Nylon LED Night Safety Flashing Glow In The Dark Dog Leash Dogs Luminous Fluores" |
| Condition | ✅ PASS | "Brand New" set (condition dialog fix worked!) |
| Description | ✅ PASS | HTML description populated |
| Item Specifics | ✅ PASS | Color, Material, Dog Size, Type, Dog Breed, Features all filled |
| Photo upload | ✅ PARTIAL | 12/25 photos uploaded before SW died |
| Pricing (base) | ✅ PASS | AU $12.08 Buy It Now |
| Postage | ✅ PASS | Shipping Policy applied |
| Variation builder open | ✅ PASS | Builder opened with Dog Size (XS,S,M,L,XL) × Features/Color (Pink,black,green,Red,Blue,Yellow,Orange) |
| Variation Continue | ✅ PASS | Clicked Continue, reached MSKU table with 70 rows |
| Variation photos | ✅ PASS | Photos uploaded per variant row |
| Variation UPC | ✅ PASS | "Does not apply" set for all rows |
| Variation pricing | ❌ FAIL | Price column exists but 0 price inputs filled |
| Variation Save | ❌ FAIL | Never reached — SW died |
| List it submit | ❌ FAIL | Never reached |

## Root Cause: Service Worker Termination

The MV3 Service Worker was terminated by Chrome despite 4 keepalive strategies:
1. **Offscreen document** (keepalive.html with 10s ping interval)
2. **Web Lock** (navigator.locks)
3. **Alarm** (every 30s)
4. **setInterval heartbeat** (every 10s)

When the SW restarts, `aliBulkRunning` and all other module-scoped state variables reset to their defaults. The orchestration loop (`runAliBulkListing`) dies silently — no crash handler catches this.

### Why the SW dies:
- MV3 SWs in managed browsers (DiCloak) appear to have more aggressive lifecycle management
- Long-running operations (image download, photo upload, variation building) can take 5+ minutes
- Chrome may kill the SW if it believes it's idle (even with keepalive pings) during cross-origin fetch operations

## Bugs Fixed (confirmed working):

1. ✅ **Condition dialog** — The "Done" button close logic works. "Brand New" was set without the dialog staying open (on this run)
2. ✅ **Item specifics** — All fields populated correctly
3. ✅ **Photo upload** — EPS upload mechanism works (12/25 uploaded)
4. ✅ **Variation builder** — TDZ fix works, builder opened and populated correctly
5. ✅ **UPC** — "Does not apply" set correctly

## Remaining Critical Bug:

### SW Keepalive Failure (BLOCKING)
The Service Worker dies during the variation builder phase. This is the #1 blocker.

**Proposed fix**: Persist orchestration state to `chrome.storage.local` at each step. On SW restart, check for interrupted operations and resume from the last checkpoint. Key state to persist:
- Current link being processed
- Current phase (scrape/identify/fill/variations/submit)
- eBay tab ID + draft ID
- Product data
- Form-filler progress

### Variation Pricing Not Filled
Even before the SW died, the price inputs in the MSKU table (70 rows) were at 0. The form-filler may not be injected into the `bulkedit.ebay.com.au` iframe properly. The form-filler was found in the main frame but NOT in the bulkedit iframe.

## Screenshots Captured
- `ali-check.png` — AliExpress product page (loaded correctly)
- `progress-15s.png` — eBay form initial state
- `var-dialog.png` — Variation builder attribute selection
- `current-2.png` — MSKU variation table (mid-page)
- `current-4.png` — MSKU variation table bottom with Save/Cancel buttons
- `current-state.png` — Full page scroll showing complete form

## Timeline
```
16:19:00 — Triggered listing
16:19:15 — AliExpress tab opened
16:20:00 — Scraping complete, Ali tab closed
16:20:30 — eBay identify page
16:20:45 — eBay listing form (draft 5054909056520)
16:20:45 — Photos uploading (2/25)
16:21:30 — Photos at 9/25
16:22:00 — Photos at 12/25, variation dialog opened
16:22:30 — Variation builder: attribute selection
16:23:00 — Variation builder: MSKU table with 70 rows
16:24:00 — SW dies, process stalls
16:26:00 — Confirmed SW dead, variations stuck without prices
```
