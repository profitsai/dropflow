# DropFlow Extension — Bug Analysis & Fix Plan

**Date**: 2026-02-17  
**Analyst**: opus-analyzer  
**For**: CodexBot (apply these fixes)

---

## Bug 1: 🔴 Variation Builder Infinite Loop

### Root Cause

**File**: `content-scripts/ebay/form-filler.js`  
**Functions**: `ensureVariationsEnabled()` (line 4206), `checkPendingData()` (line 7934), `watchForPageTransitions()` (line 7710), `fillForm()` (line ~310)

The loop occurs as follows:

1. `checkPendingData()` (line 7934) runs at script load (line 8481) — finds pending data, calls `fillForm()`
2. `fillForm()` → `fillVariations()` (line ~500) → `ensureVariationsEnabled()` (line 1107)
3. `ensureVariationsEnabled()` clicks the 3-dot menu (line 4263) then clicks "Settings" (line 4366)
4. **Clicking Settings causes eBay's SPA to navigate or fully reload the page** — the Settings modal/panel rendering triggers eBay's React/Marko framework to re-mount components
5. If this causes a **full page reload** (not just SPA DOM mutation), a new JS context is created:
   - `window.__dropflow_form_filler_loaded` (line 14-18) resets to `undefined`
   - `window.__dropflowFillFormLock` (line 308) resets
   - The content script re-injects via manifest `document_idle` injection
   - `checkPendingData()` runs again (line 8481)
   - Pending data **still exists** in `chrome.storage.local` (it's deliberately NOT removed before `fillForm` completes — see comments on lines 7843, 8037)
   - The whole cycle repeats: `fillForm()` → `fillVariations()` → `ensureVariationsEnabled()` → click Settings → page reload → re-inject → loop

6. Even without a full reload, `watchForPageTransitions()` (line 7710) has a `handleMutation()` callback triggered by MutationObserver that calls `fillForm()` again on DOM changes. The `fillingFormNow` guard (line 7749) should prevent this, but if the URL changes during Settings interaction, the guard may not be effective.

7. Additionally, at lines 1199-1207, inside `fillVariations()` retry loop (attempts 2 and 4), `ensureVariationsEnabled()` is called AGAIN if the edit button isn't found — compounding the loop.

### The Fix

**Strategy**: Use a `chrome.storage.local` flag to track that we're currently inside `ensureVariationsEnabled`, surviving across page reloads. Also check if the toggle is already ON before attempting the Settings flow.

#### Change 1: Add re-entry guard in `ensureVariationsEnabled()` (line 4206)

**Before** (line 4206-4208):
```javascript
  async function ensureVariationsEnabled() {
    await logVariationStep('ensureVariationsEnabled:start', {});

    const builderCtx = detectVariationBuilderContextWithLog('ensureVariationsEnabled:start');
```

**After**:
```javascript
  async function ensureVariationsEnabled() {
    await logVariationStep('ensureVariationsEnabled:start', {});

    // Re-entry guard: prevent infinite loop when Settings click triggers page reload/re-injection.
    // This flag persists in chrome.storage.local across JS context resets.
    const guardKey = 'dropflow_ensureVariations_guard';
    const guardData = await chrome.storage.local.get(guardKey);
    const guard = guardData[guardKey];
    if (guard && (Date.now() - guard.timestamp) < 60000) {
      console.warn(`[DropFlow] ensureVariationsEnabled re-entry blocked (age=${Date.now() - guard.timestamp}ms, attempts=${guard.attempts})`);
      await logVariationStep('ensureVariationsEnabled:reentryBlocked', { guard });
      // Clear guard so next listing attempt can proceed
      if (guard.attempts >= 2) {
        await chrome.storage.local.remove(guardKey);
      } else {
        await chrome.storage.local.set({ [guardKey]: { ...guard, attempts: (guard.attempts || 0) + 1 } });
      }
      return false;
    }
    await chrome.storage.local.set({ [guardKey]: { timestamp: Date.now(), attempts: 1 } });

    const builderCtx = detectVariationBuilderContextWithLog('ensureVariationsEnabled:start');
```

#### Change 2: Clear the guard on success/exit (multiple locations)

At the END of `ensureVariationsEnabled()`, before every `return` statement, add guard cleanup. The easiest way: wrap the function body.

Add after the guard check above, and before every `return` in `ensureVariationsEnabled()`:
```javascript
    // Helper to clear re-entry guard
    const clearGuard = () => chrome.storage.local.remove(guardKey).catch(() => {});
```

Then before each `return true`, `return false`, and `return 'builder'` in the function, add `await clearGuard();`.

The key return points to add `await clearGuard()` before:
- Line ~4212: `return true;` (already on builder)
- Line ~4221: `return true;` (already visible)
- Line ~4237: `return false;` (no 3-dot button)
- Line ~4356: `return false;` (no settings option)
- Line ~4500: `return false;` (no toggle found)
- Line ~4525: `return true;` (already on) — **but DON'T clear here yet, leave for later**
- Lines 4631, 4653, 4663, 4678, 4686: various success/builder returns
- Line 4694: final `return false;`

#### Change 3: Prevent re-calling `ensureVariationsEnabled` in retry loop (line 1199)

**Before** (lines 1195-1210):
```javascript
        if (attempt === 2 || attempt === 4) {
          const hasSection = !!findVariationsSection();
          const hasEdit = !!findVariationEditButton();
          if (!hasSection || !hasEdit) {
            try {
              const enableResult = await ensureVariationsEnabled();
```

**After**:
```javascript
        if (attempt === 2 || attempt === 4) {
          const hasSection = !!findVariationsSection();
          const hasEdit = !!findVariationEditButton();
          if (!hasSection || !hasEdit) {
            // Don't re-call ensureVariationsEnabled — it can cause infinite loops
            // if Settings click triggers page reload. Just scroll and wait.
            console.warn(`[DropFlow] Variation section/edit not found at retry ${attempt}, scrolling to reload lazy sections`);
            await scrollPageToLoadAll();
```

Remove the `try { const enableResult = await ensureVariationsEnabled(); ... }` block in the retry loop entirely.

### Risks
- The 60-second guard timeout means if a legitimate retry is needed within 60s, it'll be blocked. This is acceptable since the alternative is an infinite loop.
- Removing the retry `ensureVariationsEnabled` calls means if the first attempt fails silently, we won't retry. But `fillVariations` already has 6 retry attempts for finding the edit button.

---

## Bug 2: 🔴 Photo Upload Broken (0/25 photos)

### Root Cause

**File**: `content-scripts/ebay/form-filler.js`  
**Function**: `uploadImages()` (line 6457)  
**File**: `background/service-worker.js`  
**Function**: `handleFetchImage()` (line ~2907), AliExpress bulk lister image download (lines 1740-1780)

The issue is a **cascading failure across all 4 upload methods**:

1. **Pre-downloaded images (AliExpress flow)**: The service worker downloads images via `chrome.scripting.executeScript` in MAIN world using canvas `toDataURL()` (line 1740-1780). This uses `img.crossOrigin = 'anonymous'` which requires the CDN to return proper CORS headers. **AliExpress CDN (alicdn.com) has inconsistent CORS support** — the canvas `toDataURL()` throws a tainted canvas error silently, returning `null`. The code handles this (line 1769: "Canvas download returned 0 valid images") but falls through to FETCH_IMAGE.

2. **FETCH_IMAGE fallback (service worker fetch)**: `handleFetchImage()` (service-worker.js line ~2907) fetches AliExpress CDN URLs. **AliExpress CDN returns 403/302 for direct fetches** from service workers because:
   - No cookies (service worker context has no AliExpress session)
   - Anti-hotlinking checks on alicdn.com based on Referer header
   - The retry with `referrer: 'https://www.aliexpress.com/'` helps but doesn't always work because the service worker's `fetch()` doesn't send AliExpress cookies

3. **Draft API PUT with URLs** (preferred path, line 6523-6528): `uploadViaDraftApiPut()` (line 6819) tries to PUT external AliExpress image URLs directly into the eBay draft. **eBay's draft API does NOT accept external URLs for images** — it expects eBay-hosted image URLs. All 5 payload formats fail silently (the API returns 200 but ignores the image fields). This is the method tried FIRST (line 6523 "Preferred first path").

4. **File input / Drag-drop DOM methods**: Even when files ARE available, the selectors for finding eBay's file input may be stale. But the primary issue is that `files.length === 0` because neither pre-download nor FETCH_IMAGE succeeded, so these methods are never reached.

### The Fix

The core fix is to make the **content-script-based pre-download** work reliably, since the content script runs on the AliExpress page with proper cookies and origin.

#### Change 1: Fix canvas pre-download in service-worker.js (line ~1740)

The current MAIN-world canvas approach fails because `crossOrigin = 'anonymous'` taints the canvas when CORS headers are missing. Instead, use `fetch()` + `FileReader` in the MAIN world (which has cookies).

**Before** (service-worker.js, lines ~1730-1775, the `chrome.scripting.executeScript` block):
```javascript
func: (urls) => {
  function imgToDataUrl(url, minBytes = 5000) {
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const data = canvas.toDataURL('image/jpeg', 0.92);
          if (minBytes > 0 && data.length < minBytes) {
            resolve({ ok: false, error: 'too-small', data: null });
          } else {
            resolve({ ok: true, data });
          }
        } catch (e) { resolve({ ok: false, error: e.message, data: null }); }
      };
      img.onerror = () => resolve({ ok: false, error: 'load-error', data: null });
      setTimeout(() => resolve({ ok: false, error: 'timeout', data: null }), 10000);
      img.src = url.startsWith('//') ? 'https:' + url : url;
    });
  }
```

**After**:
```javascript
func: (urls) => {
  async function imgToDataUrl(url, minBytes = 5000) {
    const fullUrl = url.startsWith('//') ? 'https:' + url : url;
    try {
      // Use fetch() instead of canvas — avoids CORS/tainted canvas issues.
      // In MAIN world, fetch() has the page's cookies and origin.
      const response = await fetch(fullUrl, {
        credentials: 'include',
        referrerPolicy: 'no-referrer-when-downgrade'
      });
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, data: null };
      const blob = await response.blob();
      if (minBytes > 0 && blob.size < minBytes) {
        return { ok: false, error: 'too-small', data: null };
      }
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ ok: true, data: reader.result });
        reader.onerror = () => resolve({ ok: false, error: 'reader-error', data: null });
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      // Fallback to canvas method for non-alicdn URLs
      return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const data = canvas.toDataURL('image/jpeg', 0.92);
            if (minBytes > 0 && data.length < minBytes) {
              resolve({ ok: false, error: 'too-small', data: null });
            } else {
              resolve({ ok: true, data });
            }
          } catch (e2) { resolve({ ok: false, error: e2.message, data: null }); }
        };
        img.onerror = () => resolve({ ok: false, error: 'load-error', data: null });
        setTimeout(() => resolve({ ok: false, error: 'timeout', data: null }), 10000);
        img.src = fullUrl;
      });
    }
  }
```

#### Change 2: Same fix for variation images canvas download (service-worker.js ~line 1800)

Apply the same `fetch()` + `FileReader` approach to the variation image download block (replace the canvas-based `imgToDataUrl` there too).

#### Change 3: Fix upload method ordering in `uploadImages()` (form-filler.js line ~6520)

The "preferred first path" of Draft API PUT with external URLs (line 6520-6528) NEVER works for AliExpress URLs because eBay doesn't accept external URLs. Skip it when we have pre-downloaded files.

**Before** (line 6518-6528):
```javascript
    console.log(`[DropFlow] ${files.length} images ready, attempting upload...`);

    // Preferred first path: direct draft API PUT with external image URLs.
    // This bypasses fragile DOM upload widgets and is the path that has worked
    // reliably on eBay's React form when headers/draftId are available.
    if (ebayContext && normalizedUrls.length > 0) {
      const earlyPutSuccess = await uploadViaDraftApiPut(normalizedUrls, ebayContext);
      if (earlyPutSuccess) {
        console.log('[DropFlow] Preferred path SUCCESS: draft API PUT with URLs');
        return true;
      }
      console.warn('[DropFlow] Preferred path FAILED: draft API PUT, falling back to DOM/media methods');
    }
```

**After**:
```javascript
    console.log(`[DropFlow] ${files.length} images ready, attempting upload...`);

    // Skip draft API PUT with external URLs — eBay doesn't accept external image URLs
    // (AliExpress CDN, Amazon CDN). Only use DOM-based upload methods with actual file data.
```

This removes the dead-code "preferred path" that wastes time and never succeeds.

#### Change 4: Improve FETCH_IMAGE for AliExpress (service-worker.js ~line 2930)

The content-script pre-download (Change 1) should be the primary path. But as a safety net, improve the service worker's `handleFetchImage` for AliExpress CDN:

**Add** after the existing AliExpress retry logic (after line ~2960):
```javascript
      // AliExpress CDN: try with common working referrer patterns
      if (!response.ok && isAliExpress) {
        // Try with no referrer (some CDN nodes allow this)
        response = await fetch(url, {
          headers: { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
          referrerPolicy: 'no-referrer',
          signal: controller.signal
        });
      }
```

### Risks
- The `fetch()` in MAIN world approach assumes AliExpress doesn't block same-origin fetches to alicdn.com. This should work since the page itself loads these images.
- Removing the draft API PUT "preferred path" means if eBay ever starts accepting external URLs, we'd miss that optimization. Low risk — eBay has never supported this.

---

## Bug 3: 🟡 Stale `aliBulkRunning` Flag

### Root Cause

**File**: `background/service-worker.js`  
**Lines**: 147 (declaration), 865 (guard check), 871 (set true), 2031 (set false)

The flag `aliBulkRunning` is an in-memory boolean (line 147). It's set to `true` in `handleStartAliBulkListing()` (line 871) and cleared to `false` in `runAliBulkListing()` after `Promise.allSettled(promises)` completes (line 2031).

**Problem**: MV3 service workers are terminated after ~30 seconds of inactivity (or 5 minutes max). When the service worker is killed mid-bulk-listing:
1. `aliBulkRunning = true` is in memory
2. Service worker dies → all in-memory state is lost
3. Service worker restarts → `aliBulkRunning` initializes to `false` (line 147)
4. **BUT**: The user reports `aliBulkRunning=true` persisting — this means the flag is ALSO being stored in `chrome.storage.local` somewhere, OR the service worker didn't actually terminate (keep-alive is active).

Looking at line 3331:
```javascript
if (!aliBulkRunning && !bulkPosterRunning && !competitorRunning && !skuBackfillRunning) {
```
This is the keep-alive check — if `aliBulkRunning` is true, the keep-alive keeps the service worker alive, preventing it from dying. So the service worker stays alive with `aliBulkRunning = true` even if the actual bulk listing Promise rejected/hung.

**The real scenario**: `runAliBulkListing()` encounters an unhandled rejection or hangs (tab closed, extension page closed, network error), the `Promise.allSettled` never resolves because individual promises are hanging (waiting for tab responses that never come), so line 2031 (`aliBulkRunning = false`) is never reached. The keep-alive alarm keeps the SW alive indefinitely.

Also: `TERMINATE_ALI_BULK_LISTING` (line 352) sets `aliBulkAbort = true; aliBulkRunning = false;` — but the user might not know to send this message, and the UI page that sends it may have been closed.

### The Fix

#### Change 1: Add startup cleanup (top of service-worker.js, after state declarations ~line 155)

**Add after line 155**:
```javascript
// Cleanup stale bulk-running flags on service worker startup.
// If the SW restarted (crash/update/idle-kill), any running operation is dead.
// In-memory flags reset to false on restart, but we also need to broadcast
// that operations are no longer running so UI pages update.
chrome.runtime.onStartup.addListener(() => {
  console.log('[DropFlow] Service worker startup — clearing stale operation flags');
  aliBulkRunning = false;
  bulkPosterRunning = false;
  competitorRunning = false;
  skuBackfillRunning = false;
});

// Also handle the install/update event
chrome.runtime.onInstalled.addListener(() => {
  aliBulkRunning = false;
  bulkPosterRunning = false;
});
```

#### Change 2: Add timeout to `runAliBulkListing` (around line 2025)

**Before** (line ~2025-2031):
```javascript
  const promises = links.map((link, i) => processLink(link, i));
  await Promise.allSettled(promises);

  aliBulkRunning = false;
  stopSWKeepAlive();
```

**After**:
```javascript
  const promises = links.map((link, i) => processLink(link, i));
  
  // Add a global timeout: if bulk listing takes longer than 2 hours, force-stop
  const BULK_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
  const timeoutPromise = new Promise(resolve => setTimeout(resolve, BULK_TIMEOUT_MS));
  
  await Promise.race([
    Promise.allSettled(promises),
    timeoutPromise.then(() => {
      console.warn('[DropFlow] AliExpress bulk listing timed out after 2 hours — force-stopping');
      aliBulkAbort = true;
    })
  ]);

  aliBulkRunning = false;
  stopSWKeepAlive();
```

#### Change 3: Add a "force reset" message handler (add near line 352)

**Add** a new case in the message listener:
```javascript
    case 'FORCE_RESET_BULK_FLAGS':
      aliBulkRunning = false;
      aliBulkPaused = false;
      aliBulkAbort = false;
      bulkPosterRunning = false;
      bulkPosterPaused = false;
      bulkPosterAbort = false;
      competitorRunning = false;
      skuBackfillRunning = false;
      stopSWKeepAlive();
      sendResponse({ success: true, message: 'All bulk operation flags reset' });
      return false;
```

#### Change 4: Add UI-side staleness check in the ali-bulk-lister page

In the ali-bulk-lister page JS, when checking if bulk listing is running, add a "last activity" timestamp check:

The service worker should store a heartbeat timestamp. **Add** in `processLink()` inside `runAliBulkListing()` (around where it broadcasts progress):
```javascript
chrome.storage.local.set({ aliBulkLastActivity: Date.now() }).catch(() => {});
```

Then in `handleStartAliBulkListing()` (line 865), before rejecting:
```javascript
  if (aliBulkRunning) {
    // Check if the operation is actually alive (activity within last 5 minutes)
    const { aliBulkLastActivity } = await chrome.storage.local.get('aliBulkLastActivity');
    if (aliBulkLastActivity && (Date.now() - aliBulkLastActivity) > 5 * 60 * 1000) {
      console.warn('[DropFlow] aliBulkRunning=true but no activity for 5+ min — auto-resetting');
      aliBulkRunning = false;
      aliBulkAbort = false;
      aliBulkPaused = false;
    } else {
      return { error: 'AliExpress bulk listing already running' };
    }
  }
```

### Risks
- The 2-hour timeout is generous but may cut off legitimately large bulk listings (100+ items). Consider making it configurable or `links.length * 10 minutes`.
- The 5-minute staleness check could prematurely reset if a single item takes >5 minutes to list (unlikely but possible with slow eBay pages). Consider extending to 10 minutes.

---

## Summary of Changes

| Bug | Files to Change | Difficulty |
|-----|----------------|------------|
| Bug 1: Infinite Loop | `form-filler.js` (2 locations) | Medium — add storage-based re-entry guard, remove retry `ensureVariationsEnabled` calls |
| Bug 2: Photo Upload | `service-worker.js` (2 canvas blocks + FETCH_IMAGE), `form-filler.js` (remove dead draft PUT path) | Medium — replace canvas with fetch+FileReader in MAIN world |
| Bug 3: Stale Flag | `service-worker.js` (4 locations) | Easy — add staleness check, timeout, startup cleanup |

**Priority**: Fix Bug 3 first (simplest), then Bug 1 (blocking), then Bug 2 (most impactful).
