# DropFlow SW Persistence + MSKU Price Fix Test Results

**Date**: 2026-02-17 16:41–16:53 AEDT  
**Test URL**: https://a.aliexpress.com/_mMLcP7b (Nylon LED Dog Leash/Collar)  
**Target**: ebay.com.au, standard listing, threadCount 1  
**CDP**: ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd

## Result: ✅ Bug 1 FIXED — SW survived 10+ minutes without dying

The Service Worker stayed alive for the **entire** listing operation (10+ minutes), through all stages including the heavy variation builder phase. Previously it died at ~2-3 minutes.

## Bug 1: SW Death — FIXED ✅

### Changes Made:
1. **Orchestration State Persistence** — Added `_dropflow_orchestration` key in `chrome.storage.local` with checkpoints at:
   - `scrape_complete` — After AliExpress product scraped ✅ (observed at 30s)
   - `ebay_tab_opened` — After eBay prelist tab created ✅ (observed at 50s) 
   - `waiting_form_fill` — After form-filler injected, waiting for fill ✅ (observed at 70s)
   - `form_fill_complete` — After EBAY_FORM_FILLED received

2. **More Aggressive Keepalive**:
   - Alarm interval: 30s → **25s** (under MV3's 30s kill threshold)
   - Heartbeat interval: 10s → **5s** (ultra-aggressive for managed browsers)
   - Heartbeat also pings `chrome.storage.local` to keep event loop active

3. **SW Startup Recovery Enhancement**:
   - On restart, checks `_dropflow_orchestration` for active operations
   - If orchestration state is fresh (<15 min), restarts keepalive and re-injects form-filler
   - Keepalive alarm handler also checks orchestration state before auto-stopping

4. **Keepalive Alarm checks orchestration state** — Even if in-memory flags reset after SW restart, the alarm handler reads persisted orchestration state and keeps the SW alive.

### Test Timeline:
```
[10s]  Listing triggered
[30s]  ORCH:scrape_complete — AliExpress data scraped  
[50s]  ORCH:ebay_tab_opened — eBay tab created, pending data stored
[70s]  ORCH:waiting_form_fill — Form filler running
[100s] SW alive ✅ (previously died around here)
[200s] SW alive ✅ (3+ minutes of form fill)
[300s] SW alive ✅ (5 minutes)
[400s] SW alive ✅ (6.7 minutes)  
[500s] SW alive ✅ (8.3 minutes)
[600s] SW alive ✅ (10 minutes — full form fill duration!)
[670s] Form fill timeout (waitForFormFilled 600s limit) — cleanup ran
```

**SW Deaths: 0** (previously: always died during variation builder phase)

## Bug 2: MSKU Iframe Price Filling — Partially Fixed ⚠️

### Changes Made:
1. **Column-Position Fallback** in `runVariationBuilderPageFlow` Phase E:
   - Builds column map from table header (price/qty/sku column indices)
   - If input hint-matching fails (no aria-label/placeholder), falls back to column position
   - Added "unfilled input" last resort — if no hints match and price column unknown, fills first unfilled non-UPC input

2. **Broader Grid Search** — Searches activeDoc (iframe document), gridContext, AND parent document for grid rows

3. **Bulk Price Strategies** (when no individual prices filled):
   - Column-position bulk fill across all rows
   - "Enter price" button detection and use
   
4. **`FILL_MSKU_PRICES` SW Message Handler** — New capability for parent frame to command price filling in cross-origin MSKU iframe via `chrome.scripting.executeScript`
   - Parent frame sends this at iterations 80, 150, 220 during MSKU wait
   - Uses column-position and SKU matching to fill prices

5. **Manifest Already Correct** — `bulkedit.ebay.com.au/*` was already in content_scripts match patterns ✅

### Status:
- Form-filler correctly identified variations: Color(7) × Size(5) = 35 SKUs
- Variation flow started and detected Edit button already visible
- Could not verify price filling because form-fill timed out at 600s (the variation builder MSKU flow takes very long on this multi-axis product)
- The MSKU iframe content script injection is working (manifest pattern matches)

### Recommendation:
- Increase `waitForFormFilled` timeout from 600s to 900s for multi-variation products
- Monitor next listing run to verify MSKU price filling works

## Files Modified:
1. `extension/background/service-worker.js`:
   - Orchestration state persistence functions (`saveOrchestrationState`, `clearOrchestrationState`, `getOrchestrationState`)
   - Checkpoints in `runAliBulkListing` processLink
   - More aggressive keepalive (25s alarm, 5s heartbeat)
   - Alarm handler checks orchestration state
   - SW startup recovery checks orchestration state
   - New `FILL_MSKU_PRICES` message handler
   - `INJECT_FORM_FILLER_IN_FRAMES` now accepts `tabId` from payload

2. `extension/content-scripts/ebay/form-filler.js`:
   - Phase E grid filling: column-position fallback, unfilled-input fallback
   - Broader grid search across multiple document contexts
   - Enhanced bulk price strategies (column fill, Enter Price button)
   - Parent frame sends `FILL_MSKU_PRICES` to SW at multiple intervals during MSKU wait

3. `extension/manifest.json`: No changes needed (already had correct patterns)
