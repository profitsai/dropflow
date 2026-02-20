# DropFlow — Dropshipping Automation for eBay

DropFlow is a Chrome extension that automates the entire dropshipping workflow: scrape products from AliExpress (or Amazon), bulk-list them on eBay with AI-optimised titles and descriptions, track stock and price changes, boost your listings with scheduled promotions, and automatically place orders on your supplier when a sale comes in — all from your browser, no server required.

---

## ✨ Features

| Feature | Description |
|---|---|
| **Bulk Listing** | Scrape AliExpress product pages (title, images, variants, pricing) and list them on eBay in bulk — handles variations/MSKU, image uploads, and form filling automatically. |
| **Stock & Price Tracker** | Monitor your listed products for stock-outs and price changes on the source site. Page-based tracker inspired by EcomSniper. |
| **Boost My Listings** | End & Sell Similar, Bulk Revise, send Offers to watchers, and schedule boosts — all from one dashboard. |
| **Auto-Order** | When an eBay sale is detected, DropFlow creates an order on AliExpress (or Amazon) and fills in the buyer's shipping address at checkout. Supports variant selection. |
| **AI Descriptions** | Generate optimised listing descriptions via the backend AI service (optional). |
| **Title Builder** | TF-IDF keyword analysis to craft high-ranking eBay titles. |

---

## 📦 Installation

DropFlow is a Chrome extension loaded in developer mode (not yet on the Chrome Web Store).

1. **Download or clone** this repository:
   ```bash
   git clone https://github.com/your-username/dropflow-extension.git
   ```
2. Open **Chrome** (or any Chromium browser — Edge, Brave, Arc, etc.).
3. Navigate to `chrome://extensions`.
4. Enable **Developer mode** (toggle in the top-right corner).
5. Click **Load unpacked**.
6. Select the `extension/` folder inside this repo.
7. Pin the DropFlow icon in your toolbar for easy access.

> **Tip:** After updating the code, return to `chrome://extensions` and click the ↻ reload button on the DropFlow card.

---

## 🚀 Quick Start

### List your first product (AliExpress → eBay)

1. **Open an AliExpress product page** — e.g. `https://www.aliexpress.com/item/123456789.html`
2. **Click the DropFlow icon** in your toolbar. You'll see the product details scraped automatically.
3. Click **"Add to Queue"** to save the product.
4. Repeat for as many products as you like.
5. Open the **Ali Bulk Lister** page from the DropFlow popup.
6. Review your queue — adjust prices, select variants, tweak titles.
7. Click **"Start Listing"**. DropFlow opens eBay listing tabs and fills everything in automatically (images, title, description, item specifics, variations, pricing).
8. Review each listing and submit.

<!-- Screenshot: AliExpress product page with DropFlow overlay showing scraped data -->
<!-- Screenshot: Ali Bulk Lister queue with multiple products ready to list -->
<!-- Screenshot: eBay listing form being auto-filled by DropFlow -->

### Track prices & stock

1. From the DropFlow popup, open **Monitor**.
2. Add products to track — these are checked periodically for price drops and stock-outs.
3. Get notified when something changes.

<!-- Screenshot: Monitor dashboard showing tracked products with price change indicators -->

### Boost your listings

1. Open **Boost My Listings** from the popup.
2. Select listings to boost — End & Sell Similar, Bulk Revise, or send Offers to watchers.
3. Optionally set a **schedule** to automate boosts at specific times.

<!-- Screenshot: Boost dashboard with listing actions and scheduling options -->

### Auto-order on sale

1. Open **Orders** from the popup.
2. DropFlow polls your eBay sales automatically.
3. When a sale is detected, it creates an order on AliExpress and fills in the buyer's shipping address at checkout.
4. Review and confirm the order.

<!-- Screenshot: Orders page showing a detected sale with auto-order status -->

---

## 🌐 Supported Sites

| Source | Destination | Status |
|---|---|---|
| AliExpress | eBay (AU, US, UK, DE, FR, IT, ES, NL, CA) | ✅ Fully supported |
| Amazon (US, CA, UK, DE, FR, IT, ES, NL, AU) | eBay | 🔧 Supported (listing + auto-order) |

---

## ⚙️ Settings

Open **Settings** from the DropFlow popup to configure:

| Setting | Description | Default |
|---|---|---|
| **Backend Server URL** | URL of the DropFlow API server (for AI descriptions). Leave blank to skip AI features. | `https://dropflow-api.onrender.com` |
| **Default Listing Type** | Standard, Opti-List (AI), Chat-List (ChatGPT), or SEO-List. | Standard |
| **Simultaneous Tabs** | Number of eBay listing tabs to process at once (1–10). Lower = safer. | 3 |
| **Price Markup (%)** | Percentage to add on top of the source price for your eBay listing. | 30% |

Use the **Test Backend Connection** button to verify your server is reachable.

---

## 🔧 Troubleshooting

| Problem | Solution |
|---|---|
| **Extension not appearing** | Make sure you loaded the `extension/` subfolder (not the repo root). Check Developer mode is on. |
| **AliExpress scraper not detecting product** | Refresh the page and wait for it to fully load. DropFlow needs the product page DOM to settle. |
| **eBay form not filling** | Ensure you're logged into eBay. DropFlow fills the Unified Listing flow — if eBay redirects you to an older form, try a different category. |
| **Image upload fails** | eBay blocks some AliExpress image URLs. DropFlow proxies images through the service worker — if it still fails, check the console for CORS errors and ensure host permissions are granted. |
| **MSKU / variations not working** | The MSKU builder handles iframes and lazy-loaded tables. If it stalls, reduce simultaneous tabs to 1 and retry. |
| **"Service worker inactive" errors** | MV3 service workers can go idle. DropFlow includes a keepalive mechanism — if you still see issues, reload the extension from `chrome://extensions`. |
| **AI descriptions not generating** | Check that your backend URL is set and reachable in Settings. The AI service is optional — listings will use a template description if unavailable. |
| **Auto-order not detecting sales** | Make sure you're on the eBay Seller Hub active listings page (`/sh/lst/active`) for the sale poller to activate. |

---

## 🧪 Development

```bash
# Install dev dependencies
npm install

# Run tests
npx vitest run
```

Tests cover core modules: pricing, scraping, tracker logic, boost scheduling, and auto-order flows.

### CDP-based runner scripts (E2E / batch)

Some scripts in this repo connect to an existing Chromium browser via the Chrome DevTools Protocol (CDP) (e.g. Multilogin Mimic).

Configure the target via environment variables:

- `CDP_HOST` (default: `127.0.0.1`)
- `CDP_PORT` (required unless `CDP_URL` is set)
- `CDP_URL` (optional override, e.g. `http://127.0.0.1:9222`)

Examples:

```bash
CDP_PORT=9222 node live-e2e-test.js
CDP_URL=http://127.0.0.1:9222 node test/run-10x-batch.js
```

---

## 📄 License

This project is proprietary. All rights reserved.

---

## 🙏 Acknowledgements

Built with vanilla JS, Chrome Extension Manifest V3, and a lot of eBay form-filling patience.
