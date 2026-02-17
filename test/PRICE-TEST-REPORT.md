# DropFlow Per-Variant Pricing & Stock Test Report

**Date**: 2026-02-16T10:02:02.073Z  
**Test Product**: AliExpress Dog Coat (1005009953521226)  
**Markup**: 30% applied per-SKU individually  
**eBay Domain**: ebay.com.au

## Results Summary

| Test | Result |
|------|--------|
| Per-variant pricing (10 unique prices) | ✅ PASS (10 unique) |
| Out-of-stock qty=0 | ✅ PASS (3/3) |
| In-stock qty ≤ 5 | ✅ PASS (max=5) |

## Variation Table on eBay Form

| Colour | Dog Size | Price | Qty | Status |
|--------|----------|-------|-----|--------|
| Red | XS | $8.45 | 5 | 🟢 |
| Red | S | $9.36 | 3 | 🟢 |
| Red | M | $11.05 | 5 | 🟢 |
| Red | L | $13.00 | 0 | 🔴 OOS |
| Red | XL | $16.25 | 0 | 🔴 OOS |
| Black | XS | $9.10 | 2 | 🟢 |
| Black | S | $10.14 | 0 | 🔴 OOS |
| Black | M | $11.70 | 5 | 🟢 |
| Black | L | $14.30 | 4 | 🟢 |
| Black | XL | $17.55 | 1 | 🟢 |

## Test Data
Each SKU has a unique supplier price. The 30% markup produces unique eBay prices:
- Cheapest: Red XS ($6.50 → $8.45)
- Most expensive: Black XL ($13.50 → $17.55)

3 SKUs marked out-of-stock (stock=0): Red L, Red XL, Black S

## Screenshots
- `price-test-variation-table.png` - Full page
- `price-test-var-closeup.png` - Table top rows  
- `price-test-var-closeup-2.png` - Table bottom rows

## Bugs Fixed
1. **Stock override** (form-filler.js ~983): Trusts per-SKU stock when any SKU has stock>0
2. **Unmatched row fallback** (form-filler.js ~1953): qty=0 for unmatched variants
3. **Per-variant pricing** (service-worker.js ~1810): Markup applied to each sku.price individually
