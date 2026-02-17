# FIX-REPORT-v2

Date: 2026-02-17
Fixer: OpenClaw subagent (codex-fixer)

## Status
Implemented **surgical fixes** for all 3 requested bugs in extension source.

> Note: I repeatedly checked for `/Users/pyrite/Projects/dropflow-extension/test/BUG-ANALYSIS.md` before fixing, but it did not appear during this run. I proceeded with minimal, targeted fixes directly in code paths matching the reported failures.

---

## 1) 🔴 Variation builder infinite loop

### Bug
`ensureVariationsEnabled()` could detect it was already on the variation builder page but returned `true` instead of the builder sentinel. Callers treat `'builder'` specially; returning `true` can re-enter parent-form logic and contribute to re-injection/retry loops.

### File changed
- `extension/content-scripts/ebay/form-filler.js`

### Before
- In `ensureVariationsEnabled()`:
  - If `detectVariationBuilderContextWithLog(...).isBuilder` was true, function returned `true`.

### After
- Same branch now returns `'builder'`.
- Added short inline comment explaining why sentinel return is required.

### Why this is safe
- Callers already handle `'builder'` explicitly.
- This only changes behavior in the already-builder case; normal settings-toggle path is untouched.

---

## 2) 🔴 Photo upload broken (0 uploaded, cascade fails)

### Bug
`uploadImages()` only iterated over `normalizedUrls.length`. If pre-downloaded AliExpress images existed but URL list was empty/short/incomplete, valid `preDownloadedImages` were effectively skipped, leading to `files.length === 0` and cascade failure.

### File changed
- `extension/content-scripts/ebay/form-filler.js`

### Before
- Loop bound: `for (let i = 0; i < normalizedUrls.length; i++)`
- Pre-downloaded data used only at indexes covered by normalized URL count.

### After
- Loop bound is now `sourceCount = min(maxImages, max(normalizedUrls.length, preDownloadedImages.length when available))`.
- Per index behavior:
  1. Prefer pre-downloaded base64 image if present.
  2. Else fetch via `FETCH_IMAGE` only when corresponding normalized URL exists.

### Why this is safe
- Keeps existing upload cascade and fallback order intact.
- Expands source coverage without changing endpoint logic.
- Prevents dropping usable pre-downloaded images due to URL-list shape mismatch.

---

## 3) 🟡 Stale `aliBulkRunning` flag after crash

### Bug
`aliBulkRunning` was cleared only at normal end of `runAliBulkListing()`. If run-level crash occurred before completion, flag could remain true and block future runs.

### File changed
- `extension/background/service-worker.js`

### Before
- `handleStartAliBulkListing()` fire-and-forget called `runAliBulkListing(...)` with no catch.
- `runAliBulkListing()` set `aliBulkRunning = false` only after `Promise.allSettled(...)` success path.

### After
- `handleStartAliBulkListing()` now attaches `.catch(...)` for crash logging.
- `runAliBulkListing()` wrapped end-of-run section in `try/finally`.
- In `finally`, always clears:
  - `aliBulkRunning = false`
  - `aliBulkPaused = false`
  - `aliBulkAbort = false`
  - `stopSWKeepAlive()`

### Why this is safe
- No changes to per-item processing logic.
- Guarantees run-state cleanup regardless of thrown errors.

---

## Validation performed

- Syntax validation:
  - `node --check extension/content-scripts/ebay/form-filler.js`
  - `node --check extension/background/service-worker.js`
- Both passed (no syntax errors).

---

## Summary of edited files

1. `/Users/pyrite/Projects/dropflow-extension/extension/content-scripts/ebay/form-filler.js`
2. `/Users/pyrite/Projects/dropflow-extension/extension/background/service-worker.js`

No unrelated refactors were made.