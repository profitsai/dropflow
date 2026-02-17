/**
 * DropFlow eBay Orders Scraper
 * Content script for ebay.com/sh/ord — scrapes recent Seller Hub orders.
 * Injected programmatically by the service worker on the sale-poll alarm.
 */

(function () {
  if (window.__dropflowOrdersScraper) return;
  window.__dropflowOrdersScraper = true;

  console.log('[DropFlow Orders] Scraper loaded on', location.href);

  /**
   * Scrape the Seller Hub Orders page (/sh/ord).
   * Returns an array of order objects.
   */
  function scrapeOrders() {
    const orders = [];

    // Strategy 1: Table rows (classic Seller Hub)
    const rows = document.querySelectorAll('table tbody tr, .orders-list .order-row, [data-testid="order-row"]');
    if (rows.length > 0) {
      for (const row of rows) {
        const order = parseOrderRow(row);
        if (order && order.orderId) orders.push(order);
      }
    }

    // Strategy 2: Card-based layout (newer Seller Hub)
    if (orders.length === 0) {
      const cards = document.querySelectorAll(
        '.order-card, [class*="order-info"], [class*="OrderCard"], ' +
        '.sh-ord__item, [data-test-id*="order"], .m-order'
      );
      for (const card of cards) {
        const order = parseOrderCard(card);
        if (order && order.orderId) orders.push(order);
      }
    }

    // Strategy 3: Generic — scan for order-id patterns in any container
    if (orders.length === 0) {
      const allLinks = document.querySelectorAll('a[href*="/ordm/"], a[href*="/ord/details"], a[href*="OrderId"]');
      const seen = new Set();
      for (const link of allLinks) {
        const container = link.closest('tr, [class*="order"], [class*="card"], div[role="row"]') || link.parentElement;
        const order = parseGenericContainer(container, link);
        if (order && order.orderId && !seen.has(order.orderId)) {
          seen.add(order.orderId);
          orders.push(order);
        }
      }
    }

    console.log(`[DropFlow Orders] Scraped ${orders.length} orders`);
    return orders;
  }

  function parseOrderRow(row) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 3) return null;

    const text = row.textContent || '';
    const orderId = extractOrderId(row);
    const itemId = extractItemId(row);
    const title = extractTitle(row);
    const buyerName = extractBuyerName(row);
    const price = extractPrice(row);
    const quantity = extractQuantity(row);
    const date = extractDate(row);
    const variant = extractVariant(row);
    const sku = extractSku(row);

    if (!orderId) return null;

    return { orderId, itemId, title, buyerName, price, quantity, date, variant, sku };
  }

  function parseOrderCard(card) {
    const orderId = extractOrderId(card);
    const itemId = extractItemId(card);
    const title = extractTitle(card);
    const buyerName = extractBuyerName(card);
    const price = extractPrice(card);
    const quantity = extractQuantity(card);
    const date = extractDate(card);
    const variant = extractVariant(card);
    const sku = extractSku(card);

    return { orderId, itemId, title, buyerName, price, quantity, date, variant, sku };
  }

  function parseGenericContainer(container, link) {
    if (!container) return null;
    const href = link?.href || '';
    const orderId = extractOrderId(container) || extractOrderIdFromUrl(href);

    return {
      orderId,
      itemId: extractItemId(container),
      title: extractTitle(container),
      buyerName: extractBuyerName(container),
      price: extractPrice(container),
      quantity: extractQuantity(container),
      date: extractDate(container),
      variant: extractVariant(container),
      sku: extractSku(container)
    };
  }

  // === Extraction Helpers ===

  function extractOrderId(el) {
    // Look for links with order IDs
    const links = el.querySelectorAll('a[href]');
    for (const a of links) {
      const match = a.href.match(/[?&]orderid=([^&]+)/i) ||
                    a.href.match(/\/ord\/details\/([^/?]+)/) ||
                    a.href.match(/OrderId=([^&]+)/i);
      if (match) return match[1];
    }
    // Look for text patterns like order IDs (##-#####-#####)
    const text = el.textContent || '';
    const m = text.match(/(\d{2}-\d{5}-\d{5})/);
    if (m) return m[1];
    // Also try longer numeric IDs
    const m2 = text.match(/Order\s*#?\s*:?\s*(\d[\d-]{10,})/i);
    if (m2) return m2[1].replace(/[^0-9-]/g, '');
    return '';
  }

  function extractOrderIdFromUrl(url) {
    const m = url.match(/[?&]orderid=([^&]+)/i) ||
              url.match(/\/ord\/details\/([^/?]+)/);
    return m ? m[1] : '';
  }

  function extractItemId(el) {
    const links = el.querySelectorAll('a[href*="/itm/"]');
    for (const a of links) {
      const m = a.href.match(/\/itm\/(?:[^/]+\/)?(\d{10,})/);
      if (m) return m[1];
    }
    // Item number from text
    const text = el.textContent || '';
    const m = text.match(/(?:Item|#)\s*:?\s*(\d{10,14})/i);
    return m ? m[1] : '';
  }

  function extractTitle(el) {
    // Prefer links to item pages
    const links = el.querySelectorAll('a[href*="/itm/"]');
    for (const a of links) {
      const t = a.textContent.trim();
      if (t.length > 5) return t;
    }
    // Any bold or heading-like text
    const heading = el.querySelector('h3, h4, .item-title, [class*="title"]');
    if (heading) return heading.textContent.trim();
    return '';
  }

  function extractBuyerName(el) {
    const text = el.textContent || '';
    const m = text.match(/(?:Buyer|Sold to|Paid by)\s*:?\s*([A-Za-z][A-Za-z0-9_.*-]{2,30})/i);
    if (m) return m[1];
    // Look for buyer link
    const buyerLink = el.querySelector('a[href*="/usr/"], a[href*="buyer"]');
    if (buyerLink) return buyerLink.textContent.trim();
    return '';
  }

  function extractPrice(el) {
    const text = el.textContent || '';
    // Match currency amounts
    const matches = text.match(/(?:US\s*)?\$\s*(\d+(?:,\d{3})*\.?\d*)/g) ||
                    text.match(/(\d+\.\d{2})\s*(?:USD|AUD|GBP|EUR|CAD)/g);
    if (matches && matches.length > 0) {
      // First price is usually the sold price
      const num = matches[0].replace(/[^0-9.]/g, '');
      return parseFloat(num) || 0;
    }
    return 0;
  }

  function extractQuantity(el) {
    const text = el.textContent || '';
    const m = text.match(/(?:Qty|Quantity)\s*:?\s*(\d+)/i);
    return m ? parseInt(m[1], 10) : 1;
  }

  function extractDate(el) {
    const text = el.textContent || '';
    // Common date patterns: Jan 15, 2026 or 15 Jan 2026 or 2026-01-15
    const m = text.match(/(\w{3}\s+\d{1,2},?\s+\d{4})/i) ||
              text.match(/(\d{1,2}\s+\w{3}\s+\d{4})/i) ||
              text.match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }

  function extractVariant(el) {
    const text = el.textContent || '';
    // Look for "Variation: Color: Blue, Size: XL" or similar
    const m = text.match(/(?:Variation|Option|Style)\s*:?\s*([^\n]{3,60})/i);
    if (m) {
      let v = m[1].trim();
      // Clean trailing junk
      v = v.replace(/\s*(Qty|Quantity|Item|Price|Total|Buyer|Ship).*$/i, '').trim();
      return v || '';
    }
    // Also check for specific variant elements
    const varEl = el.querySelector('[class*="variation"], [class*="variant"], [class*="item-specific"]');
    if (varEl) return varEl.textContent.trim().substring(0, 100);
    return '';
  }

  function extractSku(el) {
    const text = el.textContent || '';
    const m = text.match(/(?:SKU|Custom\s*Label)\s*:?\s*([A-Za-z0-9_-]{3,40})/i);
    return m ? m[1] : '';
  }

  // === Message Listener ===
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'DROPFLOW_SCRAPE_EBAY_ORDERS') {
      try {
        const orders = scrapeOrders();
        sendResponse({ success: true, orders });
      } catch (e) {
        console.error('[DropFlow Orders] Scrape error:', e);
        sendResponse({ error: e.message });
      }
      return false;
    }
  });
})();
