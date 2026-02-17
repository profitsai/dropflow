# DropFlow AliExpress Scraper Debug Report

Date: 2026-02-16

## Summary
I traced the Ali bulk listing flow across:
- `content-scripts/aliexpress/product-scraper.js`
- `background/service-worker.js`
- `manifest.json`
- `pages/ali-bulk-lister/ali-bulk-lister.js`

### Root cause of the stall
The stall is caused by a **timeout mismatch in the background worker**, not by KEEPALIVE routing.

The Ali scraper has become heavier (script-tag parsing + API fallback path), but `runAliBulkListing()` still enforces a strict **20s timeout** per scrape attempt:
- `service-worker.js` line **879**: first attempt timeout 20s
- `service-worker.js` line **893**: retry timeout 20s

At the same time, there are fixed waits and heavy work before completion:
- 5s settle wait (line **862**)
- 2s post-injection wait (line **872**)
- scraper does script parsing + API/detail fetch path (`product-scraper.js` lines **1151–1170**, with per-request timeouts in `fetchWithTimeout`)

So the observed “sits for ~60s+ on AliExpress” matches the current control flow:
- open/load wait (up to 20s) +
- inject waits (7s) +
- first scrape timeout (20s) +
- retry scrape timeout (20s)

This reproduces the exact symptom: no progression to eBay because background gives up before scraper returns.

---

## What I checked

### 1) Content script guard/injection behavior
- `product-scraper.js` has double-injection guard:
  - line **12**: `if (window.__dropflow_ali_scraper_loaded) return;`
  - line **13**: sets the flag
- Message listener is correctly registered later (lines **1294–1305**) for `SCRAPE_ALIEXPRESS_PRODUCT`.
- No syntax errors found (`node --check` passes).

**Important note:** this guard can still be a reload edge-case risk (if stale page context survives extension reload), but it is not the primary cause of the 60s stall pattern you reported.

### 2) Service worker trigger path
- `START_ALI_BULK_LISTING` route is intact (`service-worker.js` lines **308–310**).
- `handleStartAliBulkListing()` starts correctly (line **805+**).
- It uses both tab creation + explicit script injection (lines **856**, **864–867**) and then sends `SCRAPE_ALIEXPRESS_PRODUCT` (line **878**).
- Current scrape timeout windows are too short for current scraper workload.

### 3) Manifest content_scripts
AliExpress matcher is present and valid:
- `manifest.json` lines **193–202**
- Matches include `https://www.aliexpress.com/item/*` etc.
- `run_at` is `document_idle`.

This means auto-injection is configured correctly, but background already comments that Ali pages may never reach a clean idle/load state; hence force injection is used.

### 4) KEEPALIVE_PING impact
- Added case exists in switch:
  - `service-worker.js` lines **258–260** (`KEEPALIVE_PING` → `sendResponse({ pong: true })`)
- Ali bulk message cases still execute normally (`START_ALI_BULK_LISTING` at lines **308–310**).
- `ali-bulk-lister.js` keepalive ping (line **31**) is non-blocking.

✅ **Conclusion: KEEPALIVE_PING did not break message routing.**

### 5) Orchestrator page communication
- `ali-bulk-lister.js` starts run via `chrome.runtime.sendMessage({ type: START_ALI_BULK_LISTING, ... })` (line **84**).
- Receives progress/result/complete via `chrome.runtime.onMessage` (lines **138+**).
- Flow wiring is correct.

---

## Recommended code fixes

### Fix A (primary): increase scrape timeout budget in background
**File:** `extension/background/service-worker.js`

Change:
- line **879** timeout from `20000` to `60000`
- line **893** timeout from `20000` to `60000`

Why: current scraper work can exceed 20s on Multilogin/Ali pages; 20s causes false timeouts and repeated retries.

### Fix B (optional but recommended): reduce premature retries / noisy duplicate scrape calls
Still in `runAliBulkListing()`, avoid issuing a second scrape request while first scrape may still be running in content script. Prefer one longer timeout over two short retries.

### Fix C (defensive reload edge case): clear/reload guard before force-inject retry
If you see failures after extension reload without page reload, the guard at `product-scraper.js:12` can prevent re-registering listener in stale contexts. A defensive approach is to clear the flag via `executeScript({ world:'MAIN', func: ... })` before reinjection, or redesign initialization so listener registration is idempotent independent of that flag.

---

## Final conclusion
- **Primary root cause:** background’s Ali scrape timeout is too aggressive (20s) relative to the current scraper runtime path.
- **KEEPALIVE_PING:** **not** the breaking change.
- **Most impactful fix:** increase timeout (and ideally avoid dual short retries).
