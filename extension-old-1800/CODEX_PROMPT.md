# Codex Task: Fix eBay Variation Builder Detection in Cross-Subdomain MSKU Iframe

## Problem Summary

This is a Chrome Extension (Manifest V3) called "DropFlow" that auto-fills eBay listing forms with product data scraped from AliExpress. When a product has variations (Color, Size), the extension needs to interact with eBay's dedicated variation builder UI.

**The bug**: When the extension clicks "Edit" on the Variations section of the eBay listing form, eBay opens a variation builder inside a **cross-subdomain iframe** at `https://bulkedit.ebay.com.au/msku?draftId=...`. The extension detects the iframe exists but **cannot access its content from the parent frame** (`contentDocument.body.textContent` is always 0). The bot "freezes" — it never interacts with the builder UI.

## Root Cause Analysis (Proven by Logs)

eBay's variation builder loads inside an iframe at `bulkedit.ebay.com.au` while the parent page is at `www.ebay.com.au`. Despite having `https://*.ebay.com.au/*` in `host_permissions`, accessing `iframe.contentDocument` from the parent frame's content script returns the initial `about:blank` document indefinitely — Chrome does not grant real cross-subdomain `contentDocument` access to content scripts even with matching host_permissions.

**Key log evidence:**
```
[DropFlow] MSKU iframe found but still loading: textLen=0, iter=0
[DropFlow] MSKU iframe found but still loading: textLen=0, iter=10
[DropFlow] MSKU iframe found after postEditClick loop: https://bulkedit.ebay.com.au/msku?draftId=5049315444220&listingMode=AddItem&meta...
```
The iframe exists, has a valid src, but `textContentLen=0` for 48+ seconds of polling. Meanwhile, `open-shadow-roots.js MAIN world script active` fires (proving the iframe IS loading its page), and the form-filler content script IS injected into the iframe (we see `checkPendingData:initial` with `score=0, signals={}`).

## What We've Already Tried (All Failed)

1. **Shadow DOM traversal** — Added `walkShadows()` and `queryAllWithShadow()`. Result: Zero shadow roots on eBay pages.
2. **MAIN world `attachShadow` monkey-patch** — Created `open-shadow-roots.js`. Result: Zero closed shadow roots intercepted.
3. **textContent fallback** — When `innerText` returns ~10 chars, fall back to `textContent`. Result: Gets 12K chars from main doc but builder text NOT in main doc.
4. **iframe textContent search** — Search all same-origin iframes for builder text. Result: Found the `bulkedit` iframe but `textContentLen=0`.
5. **Parent frame contentDocument polling** — Poll `iframe.contentDocument.body.textContent` every 300-500ms for 48+ seconds. Result: Always 0. Chrome doesn't give real cross-origin contentDocument access.
6. **Wildcard host_permissions** — Changed `https://www.ebay.com/*` to `https://*.ebay.com/*`. Result: No effect on contentDocument access.

## The Fix That Should Work

The content script IS already being injected into the `bulkedit` iframe (via manifest entry). But the **subframe handler gives up after one check**:

```javascript
// Current code (line ~6421):
if (!IS_TOP_FRAME) {
  if (initialBuilderCtx.isBuilder && productData.variations?.hasVariations) {
    console.warn('[DropFlow] Subframe builder detected; running variation builder flow in-frame');
    await runVariationBuilderPageFlow(productData, [], initialBuilderCtx.doc);
  }
  return; // <-- GIVES UP IMMEDIATELY if builder not detected
}
```

At `document_idle`, the SPA hasn't rendered the builder UI yet, so `detectVariationBuilderContext()` returns `isBuilder=false, score=0`. The subframe exits without retrying.

**The fix**: Add polling/retry in the subframe path. Wait for the builder to render (the SPA loads content after `document_idle`), then run the builder flow. Also need to make `detectVariationBuilderContext()` work correctly inside the iframe (the URL is `/msku?...` not `/lstng`, so the `urlHint` check fails).

## Files to Modify

### 1. `D:\extension\content-scripts\ebay\form-filler.js` (~6900 lines)

This is the main file. Key sections:

#### a) Subframe handler in `checkPendingData()` (line ~6421)

Current:
```javascript
if (!IS_TOP_FRAME) {
  if (initialBuilderCtx.isBuilder && productData.variations?.hasVariations) {
    console.warn('[DropFlow] Subframe builder detected; running variation builder flow in-frame');
    await runVariationBuilderPageFlow(productData, [], initialBuilderCtx.doc);
  }
  return;
}
```

Needs to become a retry loop that:
- Polls `detectVariationBuilderContext()` every 500ms for up to 30 seconds
- If the iframe URL contains `bulkedit` or `msku`, it's definitely the builder — wait for content to render
- Once builder is detected (`isBuilder=true`), run `runVariationBuilderPageFlow()`
- Pass the iframe's own `document` (not a parent frame reference)

#### b) `detectVariationBuilderContext()` (line ~5455)

The `urlHint` check only matches `/lstng` or `/sl/prelist`:
```javascript
const urlHint = /\/lstng|\/sl\/prelist/i.test(pathname);
```

Inside the `bulkedit` iframe, the URL is `https://bulkedit.ebay.com.au/msku?draftId=...`. The pathname is `/msku`. This needs to also match `/msku` as a URL hint for the builder.

Also:
```javascript
const urlHasVariation = /\bvari/i.test(pathname);
```
`/msku` doesn't match `vari`, so this is also 0. Need to add `/msku` as a URL signal.

#### c) The parent frame MSKU polling (lines ~1152-1241)

The parent frame approach (polling `contentDocument` from parent) will NEVER work. These code blocks can be cleaned up or left as dead code (they'll just time out harmlessly). The real fix is in the subframe (section a above).

#### d) `runVariationBuilderPageFlow()` (line ~1736)

When called from the subframe, `builderDoc` will be `null` (the subframe passes `initialBuilderCtx.doc` which IS `document`). The function needs to work correctly when the builder is the entire iframe document (not a section of a larger page).

The `findBuilderRoot()` function searches for elements with text matching "create your variation" + "attributes" + "options". This should work IF the builder text is visible in the iframe. But `isElementVisible()` might have issues if the builder uses CSS that hides content from `innerText` while visually rendered (same issue as the parent page).

### 2. `D:\extension\manifest.json`

The bulkedit content script entry (lines 173-189) does NOT have `"all_frames": true`. This should be fine since the `bulkedit` iframe is the top-level document of its URL context. But verify this works.

## Current State of Detection Signals

On the main eBay form page (parent frame, URL `/lstng?...`):
```
isBuilder=false, score=4
hasCreateHeader:false, hasVariationsTitle:true, hasOptions:true, urlHint:true
```
Only `hasVariationsTitle` (the "Variations" section heading) and `hasOptions` (generic "options" text) are detected. All builder-specific signals are false because the builder content is in the iframe.

Inside the `bulkedit` iframe (URL `/msku?draftId=...`):
```
isBuilder=false, score=0, signals={}
```
The SPA hasn't rendered at `document_idle`. All signals are empty.

## What the Builder UI Looks Like (from earlier test screenshots)

The builder has:
- Header: "Create your variations"
- Left panel: "Attributes" section with selectable attribute chips (Color, Size, etc.)
- Right panel: "Options" section with values to add
- Buttons: "+ Add", "Create your own", "Continue", "Cancel"
- URL: `https://bulkedit.ebay.com.au/msku?draftId=...&listingMode=AddItem&...`

## Expected Behavior After Fix

1. Extension clicks "Edit" on Variations section → eBay opens `bulkedit` iframe
2. Content script inside iframe runs at `document_idle`
3. Subframe handler detects it's on a `bulkedit`/`msku` URL and polls for builder content
4. SPA renders the builder UI (takes a few seconds)
5. `detectVariationBuilderContext()` detects the builder (with `msku` URL hint)
6. `runVariationBuilderPageFlow()` runs inside the iframe, interacting with builder elements
7. Builder flow selects attributes, adds values, clicks Continue

## Key Architecture Points

- `IS_TOP_FRAME`: `true` in parent frame (`www.ebay.com.au`), `false` in iframe (`bulkedit.ebay.com.au`)
- `checkPendingData()`: Called at startup. Gets product data from `chrome.storage.local`. Routes to subframe handler if `!IS_TOP_FRAME`.
- `detectVariationBuilderContext()`: Scoring-based detection. Searches for text signals ("create your variation", "attributes", "options") and button text ("+ Add", "Continue", "Cancel"). Score >= 7 with key buttons = `isBuilder=true`.
- `runVariationBuilderPageFlow()`: The actual builder interaction. Finds the builder root element, reads attribute chips, clicks them, adds option values, clicks Continue.
- `getAccessibleDocuments()`: Walks document + all same-origin iframes. Used by detection function.

## Console Log Timeline (Full Test Run)

```
// Page 1: prelist search
[DropFlow] checkPendingData:initial: isBuilder=false, score=1, bodyTextLen=400

// Page 2: find a match
[DropFlow] checkPendingData:initial: isBuilder=false, score=1, bodyTextLen=690

// Page 3: confirm details
[DropFlow] watchTransitions:mutation: isBuilder=false, score=1, bodyTextLen=866

// Page 4: form page loads
[DropFlow] Page structure: iframes=1 (cross-origin=0), bodyTextLen=3248
[DropFlow] checkPendingData:initial: isBuilder=false, score=4 (hasVariationsTitle:true, hasOptions:true, urlHint:true)

// Subframe (bulkedit iframe):
[DropFlow] checkPendingData:initial: isBuilder=false, score=0, signals={}   // <-- GIVES UP HERE

// Form filling proceeds...
[DropFlow] fillVariations:start: isBuilder=false, score=4
[DropFlow] ensureVariationsEnabled (toggle flow runs)
[DropFlow] BUILDER TEXT SEARCH in main doc: (not found in main doc)
[DropFlow] iframe[1] src=https://bulkedit.ebay.com.au/msku?draftId=..., innerTextLen=0, textContentLen=0

// Post-edit click loop - polls for 18 seconds
[DropFlow] fillVariations:postEditClick:0: isBuilder=false, score=4
[DropFlow] MSKU iframe found but still loading: textLen=0, iter=0
[DropFlow] fillVariations:postEditClick:10: isBuilder=false, score=4
[DropFlow] MSKU iframe found but still loading: textLen=0, iter=10
... (continues through iter=50, all textLen=0)

// Dedicated 30s wait
[DropFlow] MSKU iframe found after postEditClick loop: https://bulkedit.ebay.com.au/msku?...
// (textLen stays 0 forever — parent frame can't access iframe content)
```

## Constraints

- Manifest V3 Chrome Extension
- Content scripts run in ISOLATED world (separate JS context from page scripts)
- Cannot use `chrome.scripting.executeScript` from content scripts (only from background)
- The parent frame CANNOT access the `bulkedit` iframe's real DOM via `contentDocument`
- The subframe content script CAN access its own `document` normally
- Product data is available via `chrome.storage.local` (already stored by the parent frame flow)
- The `runVariationBuilderPageFlow()` function already handles builder interaction — it just needs to be called at the right time with the right document reference

## Summary of Required Changes

1. **Fix `detectVariationBuilderContext()`**: Add `/msku` and `bulkedit` as URL hints so the builder is detected when running inside the iframe
2. **Fix subframe handler in `checkPendingData()`**: Add polling/retry loop instead of single check. Wait for SPA content to render before giving up.
3. **Optionally: Add communication from parent to subframe** via `chrome.storage.local` or `postMessage` to pass the `axisMapping` (currently the subframe passes `[]` which means it uses raw AliExpress axis names instead of mapped eBay-specific names)
4. **Clean up or gate the parent-frame `contentDocument` polling** since it will never work

The highest priority is #1 and #2 — these are the minimum changes needed to make the builder flow work inside the iframe.
