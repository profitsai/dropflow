# DropFlow Extension Test Report
## Date: 2026-02-16

## Objective
Get a full AliExpress product with VARIATIONS listed on eBay AU using the DropFlow extension.

## Result: ✅ SUCCESS

### Live Listing
- **Item ID**: 177867571489
- **URL**: https://www.ebay.com.au/itm/177867571489
- **Title**: Warm Fleece Dog Coat Hooded Waterproof Winter Pet Puppy Clothes Small Medium Dog
- **Price**: AU $24.99 per variation
- **Category**: Pet Supplies > Dogs > Clothing & Shoes
- **Condition**: Brand New

### Variations
- **Dog Size**: XS, S, M, L, XL (5 options)
- **Colour**: Red, Black, Coffee (3 options)
- **Total Combinations**: 15
- **Price per variation**: AU $24.99
- **Quantity per variation**: 5

### What Was Filled
- ✅ Title (80 chars, SEO optimized)
- ✅ Photos (6 product images from AliExpress)
- ✅ Description (HTML with key features, size guide table)
- ✅ Condition (Brand New)
- ✅ Category (Clothing & Shoes in Pet Supplies > Dogs)
- ✅ Variations (Dog Size × Colour = 15 combinations)
- ✅ Prices ($24.99 each)
- ✅ Quantities (5 each)
- ✅ Shipping Policy (pre-existing)
- ✅ Return Policy (pre-existing)
- ⚠️ Brand set to "Warm Fleece Dog" (should be "Unbranded" — known form-filler bug)
- ⚠️ SKU not set on variations (would need manual entry)

## Process
1. **Stored product data** in `chrome.storage.local` with proper variation structure (axes + SKUs)
2. **Opened eBay prelist** page, extension auto-injected form-filler
3. **Form-filler navigated**: prelist → identify → listing form (automated by extension)
4. **Form-filler filled**: title, photos (via API upload), description, condition, category
5. **Manually drove variation builder** via puppeteer on bulkedit.ebay.com.au iframe:
   - Added Dog Size attribute with XS/S/M/L/XL
   - Added Colour attribute with Red/Black/Coffee (Coffee via "Create your own")
   - Generated 15 variation combinations
6. **Fixed UPC error**: Bulk price fill accidentally set UPC fields, cleared them
7. **Submitted listing** successfully

## Key Findings

### What Works Well
- Extension's prelist → identify → form navigation is solid
- Photo upload via eBay draft API works reliably (PUT to `/lstng/api/listing_draft/{id}`)
- Description filling via TinyMCE iframe injection works
- Title generation and filling works

### Issues Found
1. **Variation SKUs missing from AliExpress scrape**: The `product-data.json` had `axes` but no `skus` array. The form-filler needs `variations.skus` with `{specifics, price, stock}` to automate variations.
2. **Brand filling incorrect**: Set to "Warm Fleece Dog" instead of "Unbranded"
3. **Variation builder is extremely fragile**: Cross-origin iframe on `bulkedit.ebay.com.au`, complex multi-step UI with attribute tabs, option selection, and grid filling
4. **Bulk input filling is dangerous**: Using `Enter price`/`Enter quantity` bulk actions can fill wrong columns (e.g., UPC)
5. **Form-filler double-injection guard**: Can't easily re-run the form filler after partial completion

### Recommendations
1. Fix AliExpress scraper to always generate `skus` array with `{specifics, price, stock}` objects
2. Fix Brand filling to select "Unbranded" for generic products
3. Make variation builder handling more robust — possibly use draft API PUT instead of DOM automation
4. Add UPC column detection to avoid filling non-price inputs during grid population

## Earlier Listing (No Variations)
- Item ID: 177867538247 — listed without variations, should be ended

## Environment
- Multilogin browser: Chrome 144, CDP port 55870
- eBay account: pepsi-4375 (Shaun)
- Extension ID: cenanjfpigoolnfedgefalledflcodaj
- Test product: https://www.aliexpress.com/item/1005009953521226.html
