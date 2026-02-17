# Variant Pricing Fix — 2026-02-17

## Problem
All MSKU variants were getting the same flat price (the highest variant price) instead of per-variant pricing. This was **intentionally hardcoded** as a simplification.

## Root Cause
In `fillBuilderPricingTable()` (~line 4337):
1. `bulkPriceAllowed = true` — forced bulk pricing always
2. `defaultPrice = Math.max(...)` — picked highest price
3. Per-row loop used `entry = { price: defaultPrice, qty: 1 }` — same price for every row, no variant matching

## Changes Made

### 1. Bulk pricing only when all prices are identical
```js
// Before:
const bulkPriceAllowed = true; // Always use flat pricing
// After:
const bulkPriceAllowed = uniquePrices.length === 1; // Only bulk if all prices identical
```

### 2. Per-row variant matching in main loop
The main per-row loop now matches each row to its variant using:
1. **Cell-level exact match** — variant specifics values match cell text exactly
2. **Cell-level partial match** — cell contains variant value or vice versa
3. **Row text regex match** — variant values found in full row text with word boundaries
4. **Index-based fallback** — assumes builder rows are in same order as `skuEntries`
5. **Default fallback** — uses `defaultPrice` as last resort

Each row gets its matched variant's `ebayPrice` instead of a flat price.

### 3. Logging updated
Changed from `FLAT PRICING` to `PER-VARIANT PRICING` log messages. First 5 rows log their matched price and cell texts for debugging.

## Files Modified
- `extension/content-scripts/ebay/form-filler.js` — `fillBuilderPricingTable()` function

## What Was NOT Changed
- The fallback section (column-position fill when `pricesFilled === 0`) already had per-variant matching logic — left untouched
- Quantity filling unchanged (still sets 1 for all)
- No other functions modified
- Photos, title, condition, description, submit flow untouched

## Verification
- Syntax check passed (`node -c form-filler.js`)
- No E2E test run (manual verification needed on next listing)
