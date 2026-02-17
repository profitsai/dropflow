# DropFlow 10X Test Progress

Started: 2026-02-17T00:04:00Z (AEST 11:04 AM)
Updated: 2026-02-17T00:20:00Z

## Summary

**Test could not complete the full 10x batch** — the extension's form filler has two blocking bugs that prevent end-to-end listing creation.

### What Works ✅
- AliExpress product scraping (URL → product data extraction)
- eBay listing form creation (opens `ebay.com.au/lstng`)
- Title filling (80/80 chars, AliExpress title reused)
- Item category detection (Pet Supplies > Dogs > Collars)
- Item specifics population (Brand, UPC, Colour, Material, Dog Size, Features, Type, Dog Breed, etc.)
- Condition: Brand New
- Description: Full HTML with product overview + key features
- Pricing: Buy It Now AU $12.08 (with 30% markup applied)
- Postage: Shipping Policy auto-selected
- Preferences: Sunbury VIC 3429, No Return policy
- Variation detection: Color(7) × Size(5) = 35 SKUs detected

### Blocking Bugs ❌

#### Bug 1: Variation Builder Loop
The `ensureVariationsEnabled` flow gets stuck in an infinite loop:
1. Form filler detects Color + Size axes
2. Clicks three-dot menu → Settings
3. Settings navigation causes page re-render
4. Form filler re-injects and starts over from step 1
5. Repeats indefinitely

**Log trace:**
```
fillVariations:start → specificsFound → axisMappingFallback → axisMapping →
ensureVariationsEnabled:start → clickedThreeDot → clickedSettings →
[page re-renders] → fillVariations:start → ... (loops)
```

Last recorded state: `dropflow_variation_status.step = "noThreeDotButton"` / `clickedSettings`

#### Bug 2: Photo Upload Not Working
Photos section shows 0/25 throughout the entire form fill process. No images were uploaded from AliExpress product images.

#### Bug 3: Form Fill Timeout
Due to Bug 1, the service worker's `waitForFormFilled()` never receives `EBAY_FORM_FILLED` message, causing a 10-minute timeout: "Form fill timed out (3 minutes)" [note: error message says 3 min but actual timeout is 600s/10min].

### Test Infrastructure Notes
- CDP connectivity: ✅ Working (Chrome 144 via Multilogin)
- `aliBulkRunning` state gets stuck after crashes — need `TERMINATE_ALI_BULK_LISTING` before each `START`
- `ebayPage.evaluate()` via puppeteer consistently times out on eBay listing pages
- Extension storage keys differ from what test script expected (`dropflow_variation_*` not `dropflow_last_fill_results`)

### Product Tested
| # | Product | Status | Notes |
|---|---------|--------|-------|
| 1 | LED Dog Leash | ❌ | Form fill timeout — variation loop bug |
| 2 | Phone Case | ⏳ | Not attempted |
| 3 | LED Strip Lights | ⏳ | Not attempted |
| 4-10 | ... | ⏳ | Not attempted |

### Recommended Fixes
1. **Fix `ensureVariationsEnabled`**: Prevent re-injection loop when Settings navigation causes page re-render. Add a guard/flag in storage to skip if already attempted.
2. **Fix photo upload**: Investigate why AliExpress product images aren't being uploaded to the eBay listing form.
3. **Fix timeout error message**: Says "3 minutes" but actual timeout is 600,000ms (10 min).
4. **Add `aliBulkRunning` reset**: Auto-reset on extension page load or add a health check endpoint.
