# Changelog

All notable changes to DropFlow are documented here, grouped by feature area.

---

## Production Hardening

- **2d3007b** fix: production hardening — keepalive, error boundaries, storage, permissions

## Auto-Order

- **71b0b51** feat: eBay sale polling and auto-order creation
- **ca72a2a** feat: AliExpress checkout address filling for auto-orders
- **859e8c9** feat: add Orders nav card to popup
- **3301ea2** feat: variant selection in auto-order checkout
- **3dfc813** feat: Amazon checkout address filling
- **494bde1** fix: auto-order audit — 3 bugs fixed + 37 new tests (199 total)

## Boost My Listings

- **1c4d4c2** feat: Boost My Listings — End & Sell Similar, Bulk Revise, Offers, Scheduling
- **b39fe94** fix: boost review — 3 bugs fixed (alarm handler, schedule timing, double click)
- **6c73a41** fix: boost cleanup, FA bundle, sale poller mutex

## Stock & Price Tracker

- **1e3678a** feat: EcomSniper-style page-based tracker + monitor audit
- **529b3ba** fix: tracker review — 3 bugs fixed + 55 new tests (162 total)

## Bulk Listing (AliExpress → eBay)

- **e7475a4** 🎉 First successful eBay listing — fix false-positive photo check
- **f86ff36** fix: AliExpress scraper — per-variant pricing via DOM click-through
- **2d21f3f** feat: default Country of Origin to China for AliExpress listings
- **b8a76a6** fix: default eBay domain to com.au for AliExpress bulk listing
- **68f4d0b** fix: harden AliExpress scraper with fallback selectors and edge cases
- **4c5539e** polish: UX cleanup for end-user readiness
- **80215a6** fix: re-enable AI description generation with SW timeout handling

## eBay Form Filling & Variations (MSKU)

- **e594455** fix: MSKU builder pricing — handle lazy-rendered table rows by click-to-activate
- **4d089c7** fix: bypass broken MSKU iframe for pricing — fill variations directly on parent page
- **b29b34b** feat: add Draft API per-variant pricing to bypass cross-origin iframe
- **28692dc** fix: stale DOM refresh in variation builder + cap all loops at 30 iterations
- **dc4e5f5** fix: handle pre-existing variations in MSKU builder
- **a963799** fix: skip MSKU builder when variations table already exists on parent page
- **5e4ab0a** fix: variation builder post-Continue loop
- **faa893a** fix: release cross-context builder lock on all exit paths
- **54cd9c5** fix: handle pre-checked attributes and chip detection in variation builder
- **e3cf045** fix: run variation option filling inside MSKU iframe, not parent
- **4e95be9** fix: attribute exact matching, DOM pricing primary, combinations table timing

## Image Uploads

- **876dde5** fix: image upload SW communication with timeout and retry
- **8a685ea** fix: resolve CORS errors in eBay image uploads
- **d47f985** fix: skip image upload entirely — chrome.runtime.sendMessage blocks event loop in MV3

## Service Worker & Messaging

- **636cb31** fix: all chrome.runtime.sendMessage timeouts with Promise constructor pattern
- **05f402c** fix: all chrome.runtime.sendMessage timeouts with Promise constructor pattern
- **013d99f** fix: add timeouts to all chrome.runtime.sendMessage calls — prevent SW hang
- **50c6cbc** fix: builder detection in MSKU iframe — lenient check for bulkedit host
- **244f04b** fix: replace inline script CSP violations with scripting.executeScript MAIN world injection

## AI Description

- **c73ae88** fix: AI description hanging — reduce timeout to 15s, fix Promise.race pattern
- **efe5346** fix: skip AI description entirely — use static template as fallback
- **863170e** fix: add fillForm trace logging, reduce description retries to 1

## Content Scripts

- **44bdadd** fix: content script re-injection after variation builder
- **3a52efa** fix: condition modal blocking fillForm — dismiss on entry + add logging

## Axis Matching

- **7ce4b0b** fix: blacklist 'Features' from color axis matching
- **5be4676** fix: blacklist Features in axis matcher + add missing UPLOAD_EBAY_IMAGE timeout
- **244e97d** merge: fix-color-axis-mapping branch

## Testing & Chores

- **c55530b** test: add unit tests for core modules
- **4f68115** chore: update test harness, gitignore screenshots, remove stale screenshot assets
- **92bf50c** chore: gitignore node_modules
