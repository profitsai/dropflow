# CODEX Audit Result — Post-Builder Flow & Per-Variant Pricing

Date: 2026-02-17
File audited: `extension/content-scripts/ebay/form-filler.js`
Reference: `test/PRICE-TEST-REPORT.md` (per-variant unique prices expected; supplier × 1.3)

---

## 1) Exact code paths traced

### Path 1 — `fillForm` after `fillVariations`

- `fillForm` starts at **line 298** and sets lock `__dropflowFillFormLock` (**311-320**).
- `fillVariations(productData)` is called at **line 502**.
- Return handling:
  - success object (`varResult.filledAxes`) → `results.variations = true` (**507-510**) and variation image flow (**512-517**)
  - failure/null → single-price fallback (**519-535**)
- Then `fillVariationCombinationsTable(productData)` runs regardless (**539-556**) and sets `results.variationPrices = true` on success (**547**).
- Remaining flow after variations still runs:
  - SKU/custom label section (**558+**)
  - item specifics section (**625+**)
  - submit safety and `List it` (**648+**)
- Lock release is in `finally` and always executes, including early `return` paths (**693-698**).

### Path 2 — MSKU builder per-variant pricing

- Builder flow enters `runVariationBuilderPageFlow` (**2364+**).
- After Continue, pricing page is detected and `fillBuilderPricingTable(activeDoc, productData)` is called (**3768-3771**).
- Row fill logic is in `fillBuilderPricingTable` (**3806+**, especially **3839-3918**).
- Main form combinations table fallback is in `fillVariationCombinationsTable` (**2115+**).

### Path 3 — `findVariationsSection` + `checkVariationsPopulated`

- `findVariationsSection()` at **4965+**.
- `checkVariationsPopulated()` uses `findVariationsSection()` and checks text/table/chips at **2346+**.

---

## 2) Bugs found with line numbers

### Bug A — Post-builder stall due strict submit gate

- **Location:** `fillForm` submit guard at old logic near current **657-662**.
- **Issue:** submission was blocked when `results.variations` was false, even if builder actually succeeded and combinations were filled (`results.variationPrices=true`) or section was populated.
- **Effect:** “stall” after builder flow despite usable variation table.

### Bug B — Item specifics skipped even when variations were actually present

- **Location:** item specifics gate near current **632-636**.
- **Issue:** condition relied only on `results.variations`, so specifics could be skipped after successful late/iframe population.

### Bug C — Per-variant price fallback not guaranteed to apply 1.3 markup

- **Locations:** multiple lookups previously used `sku.ebayPrice || sku.price`:
  - grid lookup: now **2012**
  - combinations lookup: now **2207**
  - bulk fallback list: now **2306-2309**
  - builder pricing table entries: now **3841**
- **Issue:** if `sku.ebayPrice` missing, raw supplier `sku.price` could be used directly instead of supplier×1.3.

### Bug D — Bulk price popup could target wrong input (e.g., UPC)

- **Location:** `useBulkAction` in `fillBuilderPricingTable`, current **3861-3870**.
- **Issue:** when no labeled price input was found, code fell back to first empty input, which can be unrelated.

### Bug E — `findVariationsSection` could return heading/tiny wrapper instead of container

- **Location:** heading strategy in `findVariationsSection`, current **4969-4976**.
- **Issue:** `closest('[class*="variation"]')`-style matching can resolve to title wrappers; this weakens downstream section checks.

---

## 3) Fixes applied (before/after)

### Fix 1 — Variation readiness gate (prevents false stall)

- **Changed:** `fillForm` item specifics and submit gates.
- **Now:** uses readiness = `results.variations || results.variationPrices || checkVariationsPopulated()`.
- **Lines:** **632-665**.

**Before (behavior):** blocked/skipped if `!results.variations`.

**After (behavior):** allows continuation if variation table is clearly populated, even when `fillVariations` return state lags.

---

### Fix 2 — Unified per-variant price resolver with 1.3 fallback

- **Added helper:** `computeVariantEbayPrice(sku, productData)` at **967-978**.
- Priority:
  1. `sku.ebayPrice` if valid
  2. `sku.price * 1.3` (rounded 2dp)
  3. `productData.ebayPrice`
- Rewired pricing call sites:
  - **2012**, **2207**, **2306-2309**, **3841**, plus uniform single-price list extraction.

**Before:** `sku.ebayPrice || sku.price`.

**After:** `computeVariantEbayPrice(...)` (enforces expected markup fallback).

---

### Fix 3 — Prevent bulk price writing into UPC/other fields

- **Changed:** `useBulkAction` fallback logic in builder pricing.
- **Lines:** **3861-3870**.

**Before:** if no labeled target, fallback to first empty input.

**After:** for `kind==='price'`, no blind fallback; aborts unless a price-like target is detected.

---

### Fix 4 — Harden `findVariationsSection` heading strategy

- **Changed:** heading candidate return logic.
- **Lines:** **4969-4976**.

**Before:** immediate return of `closest(...)` candidate.

**After:** rejects heading/self/tiny-title candidates; returns only plausible container.

---

## Verification against `PRICE-TEST-REPORT.md`

The working report expects unique per-variant prices and 30% markup behavior on eBay AU.
Applied fixes align with that expectation by:

- preserving per-SKU prices in both builder and combinations-table paths,
- enforcing `supplier × 1.3` fallback when `sku.ebayPrice` is absent,
- preventing false non-submission when variations are actually populated.

---

## Notes

- `fillVariations()` does not currently return `'builder'`; that sentinel is used by `ensureVariationsEnabled()`. `fillForm` handles object/null, and with the new readiness gates this is now robust to iframe-timing edge cases.
- Lock handling is correct: released in `finally` even on early returns.
