# DropFlow Chrome Extension — Security Audit Report

**Date:** 2025-07-25  
**Auditor:** Automated (Claude)  
**Scope:** Full extension source under `extension/`  
**Extension Type:** Manifest V3 Chrome Extension  

---

## Executive Summary

DropFlow is a dropshipping automation Chrome extension that handles eBay credentials, cross-origin requests to supplier sites (Amazon, AliExpress), and **auto-ordering with real money**. The extension generally follows good practices (JWT tokens in `chrome.storage.local`, no hardcoded secrets, proper auth refresh flow), but has several issues ranging from medium to high severity.

---

## Findings

### 🔴 HIGH-001: No Duplicate Order Prevention

**File:** `extension/lib/auto-order.js` → `createOrder()`  
**Severity:** HIGH  
**Impact:** Financial loss — duplicate orders could be placed for the same eBay sale  

`createOrder()` does not check if an order already exists for the same `ebayOrderId`. If sale polling fires twice for the same sale, or the user triggers creation manually, duplicate orders can be created and auto-executed, spending real money twice.

**Recommendation:** Check for existing orders with matching `ebayOrderId` before creating a new one.  
**Status:** ✅ FIXED — Added duplicate check in `createOrder()`.

---

### 🔴 HIGH-002: Max Price Check Uses Stale Price

**File:** `extension/lib/auto-order.js` → `executeAutoOrder()`  
**Severity:** HIGH  
**Impact:** Financial loss — price may have increased since order was created  

The max price check at line 185 compares `order.sourcePrice` (captured at order creation time) against `settings.maxAutoOrderPrice`. If the supplier's price increased between order creation and execution, the check passes on stale data and the user pays more than expected.

**Recommendation:** Re-scrape the current price from the product page before proceeding to checkout, or at minimum log a warning that the price is from creation time.  
**Status:** ⚠️ NOTED — Full fix requires scraping the live page price during execution (complex). Added a comment/warning. The `requireManualConfirm: true` default mitigates this.

---

### 🟡 MEDIUM-001: No Origin Validation on `window.postMessage` Handlers

**Files:** `extension/content-scripts/ebay/form-filler.js` (lines ~6895, ~8620)  
**Severity:** MEDIUM  
**Impact:** A malicious page could send crafted `postMessage` events to the content script  

The `window.addEventListener('message', handler)` listeners check `event.data.type` against a unique callback ID (`__dropflow_msku_photo_<timestamp>`, `__dropflow_helix_<timestamp>`) but do not validate `event.origin`. While the callback IDs are semi-random (timestamp-based), they are predictable.

**Mitigating factors:** These handlers are short-lived (removed after first match or timeout), and the callback ID includes a timestamp making blind injection unlikely. They also only run on eBay listing pages.

**Recommendation:** Add `event.origin` check to verify messages come from expected eBay domains.  
**Status:** ⚠️ NOTED — Low practical exploitability due to short-lived handlers with semi-unique IDs.

---

### 🟡 MEDIUM-002: `open-shadow-roots.js` Runs in MAIN World

**File:** `extension/content-scripts/ebay/open-shadow-roots.js`  
**Severity:** MEDIUM  
**Impact:** Modifies page's `Element.prototype.attachShadow` globally  

This MAIN world script monkey-patches `attachShadow` to force all shadow roots to `open` mode. While necessary for DOM traversal, it:
1. Could interfere with page functionality
2. Runs on all eBay pages (per manifest matches)
3. Page scripts can detect and potentially exploit the patched method

**Recommendation:** Acceptable trade-off for functionality, but document the risk.  
**Status:** ⚠️ NOTED — Functional requirement.

---

### 🟡 MEDIUM-003: No Explicit CSP in manifest.json

**File:** `extension/manifest.json`  
**Severity:** MEDIUM  
**Impact:** Relies on MV3 default CSP rather than explicit restrictive policy  

Manifest V3 provides a strong default CSP (`script-src 'self'; object-src 'self'`), so this is not critical. However, explicitly declaring CSP is a best practice for defense-in-depth.

**Recommendation:** Add explicit CSP to manifest.json.  
**Status:** ⚠️ NOTED — MV3 defaults are sufficient.

---

### 🟡 MEDIUM-004: Localhost in Production `host_permissions`

**File:** `extension/manifest.json`  
**Severity:** MEDIUM  
**Impact:** Extension can make requests to `http://localhost:3000/*` in production  

The manifest includes `http://localhost:3000/*` in `host_permissions`, likely for development. This is unnecessary in production and slightly expands the attack surface.

**Recommendation:** Remove or gate behind a development build flag.  
**Status:** ⚠️ NOTED — Low risk but unnecessary exposure.

---

### 🟢 LOW-001: `innerHTML` Usage is Mostly Sanitized

**Files:** `extension/pages/monitor/monitor.js`, `extension/pages/orders/orders.js`, others  
**Severity:** LOW  
**Impact:** Potential XSS if sanitization is bypassed  

The extension uses `innerHTML` extensively for rendering UI. The monitor page has an `escHtml()` function that properly sanitizes via `textContent → innerHTML` conversion. Most dynamic content is passed through `escHtml()`.

However, some pages (orders.js, bulk-poster.js) construct HTML with template literals. The data sources are primarily from `chrome.storage.local` (extension-controlled) and API responses, not direct user input from untrusted sources.

**Status:** ✅ ACCEPTABLE — Data sources are trusted (extension storage / own API).

---

### 🟢 LOW-002: Content Script Message Handlers Don't Validate Sender

**Files:** Various content scripts using `chrome.runtime.onMessage.addListener`  
**Severity:** LOW  
**Impact:** Minimal — `chrome.runtime.onMessage` can only be sent by the extension itself  

`chrome.runtime.onMessage` is an internal extension API. Only the extension's own scripts (background, other content scripts, popups) can send these messages. Web pages cannot inject messages into this channel. No `onMessageExternal` or `externally_connectable` is configured.

**Status:** ✅ ACCEPTABLE — Chrome's security model protects this channel.

---

### 🟢 LOW-003: Checkout Data Expiration

**File:** `extension/content-scripts/aliexpress/checkout-address.js`  
**Severity:** LOW (Positive finding)  

Checkout data (`__dropflow_pending_checkout`) properly checks `expiresAt` before auto-filling. The `auto-order.js` sets a 10-minute TTL. Data is cleaned up after use.

**Status:** ✅ GOOD — Properly implemented.

---

### 🟢 LOW-004: Auth Token Management

**File:** `extension/lib/auth.js`, `extension/lib/api-client.js`  
**Severity:** LOW (Positive finding)  

JWT tokens are stored in `chrome.storage.local` (not in code or localStorage). Token refresh is handled automatically on 401 responses. No hardcoded credentials found anywhere in the codebase.

**Status:** ✅ GOOD — Properly implemented.

---

### 🟢 LOW-005: Login Credentials

**File:** `extension/pages/login/login.js`  
**Severity:** LOW  

Password is sent via `fetch()` to the backend API. The default backend URL is `https://dropflow-api.onrender.com` (HTTPS), so credentials are encrypted in transit. Password is not persisted locally.

**Status:** ✅ ACCEPTABLE — HTTPS ensures transport security.

---

## Auto-Order Safety Summary

| Check | Status | Notes |
|-------|--------|-------|
| Max price enforcement | ⚠️ Partial | Checked at execution time but uses stale price from creation |
| Duplicate order prevention | ❌ Missing | No check for existing order with same `ebayOrderId` — **FIXED** |
| Manual confirmation default | ✅ Good | `requireManualConfirm: true` by default |
| Checkout data expiry | ✅ Good | 10-minute TTL, cleaned after use |
| Auto-trigger safeguard | ✅ Good | `autoTriggerOnSale: false` by default |

---

## Fixes Applied

### Fix 1: Duplicate Order Prevention (HIGH-001)
Added duplicate `ebayOrderId` check in `createOrder()` in `extension/lib/auto-order.js`.

---

## Recommendations Summary

| Priority | Action |
|----------|--------|
| HIGH | ✅ Add duplicate order check (DONE) |
| HIGH | Consider re-checking live price at execution time |
| MEDIUM | Add `event.origin` checks to `postMessage` handlers |
| MEDIUM | Remove `localhost:3000` from production `host_permissions` |
| LOW | Add explicit CSP to manifest.json |
