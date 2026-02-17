/**
 * Amazon Product Page Scraper
 * Extracts product data from Amazon product pages and injects a "List on eBay" button.
 */

(function () {
  'use strict';

  const checkAvailability = window.__dropflow_checkAvailability;

  /**
   * Scrape all product data from the current Amazon page.
   */
  function scrapeProduct() {
    const data = {
      asin: extractAsin(),
      title: extractTitle(),
      price: extractPrice(),
      currency: extractCurrency(),
      images: extractImages(),
      description: extractDescription(),
      bulletPoints: extractBulletPoints(),
      availability: extractAvailability(),
      seller: extractSeller(),
      isFBA: extractIsFBA(),
      category: extractCategory(),
      rating: extractRating(),
      reviewCount: extractReviewCount(),
      url: window.location.href
    };

    return data;
  }

  function extractAsin() {
    // From URL
    const urlMatch = window.location.pathname.match(/\/dp\/([A-Z0-9]{10})/i) ||
                     window.location.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i);
    if (urlMatch) return urlMatch[1].toUpperCase();

    // From page data
    const input = document.querySelector('input[name="ASIN"]') || document.querySelector('#ASIN');
    if (input) return input.value;

    // From canonical link
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      const match = canonical.href.match(/\/dp\/([A-Z0-9]{10})/i);
      if (match) return match[1].toUpperCase();
    }

    return null;
  }

  function extractTitle() {
    const el = document.getElementById('productTitle') ||
               document.querySelector('#title span') ||
               document.querySelector('h1.a-size-large');
    return el ? el.textContent.trim() : '';
  }

  function extractPrice() {
    // Try multiple selectors for Amazon's various price layouts
    const selectors = [
      '.a-price .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#priceblock_saleprice',
      '#price_inside_buybox',
      '#newBuyBoxPrice',
      '#corePrice_feature_div .a-price .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
      '#apex_offerDisplay_desktop .a-price .a-offscreen',
      '#buybox .a-price .a-offscreen',
      '#desktop_buybox .a-price .a-offscreen',
      '#buyBoxAccordion .a-price .a-offscreen',
      '.a-price-whole',
      'span.a-color-price'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        const match = text.match(/[\d,.]+/);
        if (match) {
          return parseFloat(match[0].replace(/,/g, ''));
        }
      }
    }
    return 0;
  }

  function extractCurrency() {
    const priceEl = document.querySelector('.a-price-symbol');
    if (priceEl) {
      const symbol = priceEl.textContent.trim();
      const map = { '$': 'USD', '£': 'GBP', '€': 'EUR', 'C$': 'CAD', 'A$': 'AUD', 'CDN$': 'CAD' };
      return map[symbol] || 'USD';
    }
    // Infer from domain
    const domain = window.location.hostname;
    if (domain.includes('.co.uk')) return 'GBP';
    if (domain.includes('.de') || domain.includes('.fr') || domain.includes('.it') || domain.includes('.es') || domain.includes('.nl')) return 'EUR';
    if (domain.includes('.ca')) return 'CAD';
    if (domain.includes('.com.au')) return 'AUD';
    return 'USD';
  }

  function extractImages() {
    const images = [];

    // Try to get high-res images from the image data script
    const scripts = document.querySelectorAll('script[type="text/javascript"]');
    for (const script of scripts) {
      const text = script.textContent;
      if (text.includes('ImageBlockATF') || text.includes('colorImages')) {
        const matches = text.match(/\"hiRes\":\"(https:\/\/[^\"]+)\"/g);
        if (matches) {
          for (const m of matches) {
            const url = m.match(/\"hiRes\":\"(https:\/\/[^\"]+)\"/)[1];
            if (!images.includes(url)) images.push(url);
          }
        }
        // Also try large images
        const largeMatches = text.match(/\"large\":\"(https:\/\/[^\"]+)\"/g);
        if (largeMatches && images.length === 0) {
          for (const m of largeMatches) {
            const url = m.match(/\"large\":\"(https:\/\/[^\"]+)\"/)[1];
            if (!images.includes(url)) images.push(url);
          }
        }
      }
    }

    // Fallback: get from image elements
    if (images.length === 0) {
      const mainImg = document.getElementById('landingImage') || document.getElementById('imgBlkFront');
      if (mainImg) {
        const src = mainImg.getAttribute('data-old-hires') || mainImg.getAttribute('data-a-dynamic-image');
        if (src) {
          if (src.startsWith('http')) {
            images.push(src);
          } else {
            try {
              const parsed = JSON.parse(src);
              images.push(...Object.keys(parsed));
            } catch (e) {}
          }
        }
        if (images.length === 0 && mainImg.src) {
          images.push(mainImg.src);
        }
      }

      // Thumbnail strip
      document.querySelectorAll('#altImages .a-button-thumbnail img, .imageThumbnail img').forEach(img => {
        let src = img.src;
        // Convert thumbnail URL to full-size
        src = src.replace(/\._[A-Z]+\d+_/, '').replace(/\._(SX|SY|SS)\d+_/, '');
        if (src && !images.includes(src)) images.push(src);
      });
    }

    return images.slice(0, 12); // eBay allows up to 12 images
  }

  function extractDescription() {
    // Product description
    const descEl = document.getElementById('productDescription');
    if (descEl) {
      const text = descEl.textContent.trim();
      if (text) return text;
    }

    // A+ content / enhanced brand content
    const aplusEl = document.getElementById('aplus') || document.querySelector('.aplus-v2');
    if (aplusEl) return aplusEl.textContent.trim().substring(0, 2000);

    return '';
  }

  function extractBulletPoints() {
    const bullets = [];
    const listEl = document.getElementById('feature-bullets');
    if (listEl) {
      listEl.querySelectorAll('li span.a-list-item').forEach(li => {
        const text = li.textContent.trim();
        if (text && !text.includes('Make sure this fits') && text.length > 5) {
          bullets.push(text);
        }
      });
    }
    return bullets;
  }

  function extractAvailability() {
    // Strategy 1: Standard #availability element
    const avail = document.getElementById('availability');
    if (avail) {
      const text = avail.textContent.trim();
      if (text) {
        if (checkAvailability) {
          return checkAvailability(text);
        }
        return { inStock: text.toLowerCase().includes('in stock'), quantity: null, text };
      }
    }

    // Strategy 2: Check alternate availability selectors (Amazon.com.au, newer layouts)
    const altSelectors = [
      '#availability span',
      '#availabilityInsideBuyBox_feature_div',
      '#pantryAvailability',
      '.a-section .a-text-bold:not(.a-color-price)',
      '#deliveryBlockMessage .a-text-bold'
    ];
    for (const sel of altSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text && checkAvailability) {
          const result = checkAvailability(text);
          if (result.inStock || result.quantity === 0) return result;
        }
      }
    }

    // Strategy 3: Presence of "Add to Cart" button = in stock
    const addToCartBtn = document.getElementById('add-to-cart-button') ||
                         document.getElementById('buy-now-button') ||
                         document.querySelector('input[name="submit.add-to-cart"]') ||
                         document.querySelector('#addToCart input[type="submit"]');
    if (addToCartBtn) {
      // Verify it's not disabled/hidden
      const style = window.getComputedStyle(addToCartBtn);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        console.log('[DropFlow] #availability not found, but Add to Cart button present — assuming in stock');
        return { inStock: true, quantity: null, text: 'add-to-cart-present' };
      }
    }

    // Strategy 4: Check for explicit out-of-stock indicators
    const oosEl = document.getElementById('outOfStock') ||
                  document.querySelector('#availabilityInsideBuyBox_feature_div .a-color-price') ||
                  document.querySelector('.a-color-price:not(.a-text-price)');
    if (oosEl) {
      const oosText = oosEl.textContent.trim().toLowerCase();
      if (/unavailable|out of stock|not available|currently unavailable/i.test(oosText)) {
        return { inStock: false, quantity: 0, text: oosText };
      }
    }

    // Strategy 5: If we have a price and title, page loaded successfully —
    // absence of both #availability and OOS indicators often means "in stock"
    // (Amazon sometimes omits #availability for standard in-stock items on .com.au)
    const priceSelectors = '.a-price .a-offscreen, #priceblock_ourprice, #newBuyBoxPrice, #price_inside_buybox, #corePrice_feature_div .a-price, #corePriceDisplay_desktop_feature_div .a-price, #apex_offerDisplay_desktop .a-price, #buybox .a-price, #desktop_buybox .a-price';
    const hasPrice = !!document.querySelector(priceSelectors);
    const hasTitle = !!document.getElementById('productTitle');
    if (hasPrice && hasTitle) {
      console.log('[DropFlow] No availability element found but page has price+title — assuming in stock');
      return { inStock: true, quantity: null, text: 'no-availability-element-price-present' };
    }

    console.warn('[DropFlow] extractAvailability: no availability signal found on page');
    return { inStock: false, quantity: null, text: '' };
  }

  function extractSeller() {
    const sellerEl = document.getElementById('sellerProfileTriggerId') ||
                     document.querySelector('#merchant-info a') ||
                     document.querySelector('#tabular-buybox .tabular-buybox-text a');
    return sellerEl ? sellerEl.textContent.trim() : 'Amazon';
  }

  function extractIsFBA() {
    const fulfillment = document.querySelector('#tabular-buybox') ||
                        document.getElementById('merchant-info');
    if (fulfillment) {
      const text = fulfillment.textContent.toLowerCase();
      return text.includes('fulfilled by amazon') || text.includes('ships from amazon') ||
             text.includes('versand durch amazon') || text.includes('expédié par amazon');
    }
    // If seller is Amazon, it's FBA by default
    return extractSeller() === 'Amazon';
  }

  function extractCategory() {
    const breadcrumbs = document.querySelectorAll('#wayfinding-breadcrumbs_feature_div a');
    if (breadcrumbs.length > 0) {
      return Array.from(breadcrumbs).map(a => a.textContent.trim()).join(' > ');
    }
    return '';
  }

  function extractRating() {
    const ratingEl = document.querySelector('#acrPopover .a-icon-alt') ||
                     document.querySelector('.a-icon-star-small .a-icon-alt');
    if (ratingEl) {
      const match = ratingEl.textContent.match(/([\d.]+)/);
      return match ? parseFloat(match[1]) : null;
    }
    return null;
  }

  function extractReviewCount() {
    const countEl = document.getElementById('acrCustomerReviewText');
    if (countEl) {
      const match = countEl.textContent.match(/([\d,]+)/);
      return match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
    }
    return 0;
  }

  // ============================
  // Inject "List on eBay" Button
  // ============================
  function findAnchorElement() {
    // Try multiple selectors - Amazon changes layouts frequently
    const selectors = [
      '#buyBoxAccordion',
      '#desktop_buybox',
      '#addToCart_feature_div',
      '#buybox',
      '#buy-now-button',
      '#rightCol',
      '#ppd',
      '#centerCol'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function injectListButton() {
    // Don't inject if already present
    if (document.getElementById('dropflow-list-btn')) return;

    const anchor = findAnchorElement();
    if (!anchor) {
      console.warn('[DropFlow] Could not find anchor element to inject buttons');
      return;
    }

    const container = document.createElement('div');
    container.id = 'dropflow-container';

    const bar = document.createElement('div');
    bar.className = 'dropflow-action-bar';

    const listBtn = document.createElement('button');
    listBtn.id = 'dropflow-list-btn';
    listBtn.className = 'dropflow-btn dropflow-btn-primary';
    listBtn.textContent = 'List on eBay';

    const copyBtn = document.createElement('button');
    copyBtn.id = 'dropflow-copy-btn';
    copyBtn.className = 'dropflow-btn dropflow-btn-secondary';
    copyBtn.textContent = 'Copy Data';

    bar.append(listBtn, copyBtn);
    container.appendChild(bar);
    anchor.parentNode.insertBefore(container, anchor.nextSibling);

    // List on eBay button
    listBtn.addEventListener('click', async () => {
      const productData = scrapeProduct();
      // Store product data for the eBay form filler to pick up
      await chrome.storage.local.set({ pendingListingData: productData });
      chrome.runtime.sendMessage({
        type: 'AMAZON_PRODUCT_DATA',
        productData
      });
      // Open eBay listing page for the matching country
      const domain = window.location.hostname.replace('www.amazon.', '');
      const ebayDomain = { 'com': 'com', 'ca': 'ca', 'co.uk': 'co.uk', 'de': 'de', 'fr': 'fr', 'it': 'it', 'es': 'es', 'nl': 'nl', 'com.au': 'com.au' }[domain] || 'com';
      window.open(`https://www.ebay.${ebayDomain}/sl/prelist/suggest`, '_blank');
    });

    // Copy data button
    copyBtn.addEventListener('click', () => {
      const data = scrapeProduct();
      navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy Data'; }, 2000);
    });
  }

  // ============================
  // Message Listener
  // ============================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SCRAPE_AMAZON_PRODUCT') {
      const data = scrapeProduct();
      sendResponse(data);
      return false;
    }
  });

  // Inject button when page is ready, with retry for lazy-loaded elements
  function tryInject() {
    injectListButton();
    // If injection failed (no anchor found), watch for DOM changes
    if (!document.getElementById('dropflow-list-btn')) {
      const observer = new MutationObserver(() => {
        if (findAnchorElement() && !document.getElementById('dropflow-list-btn')) {
          observer.disconnect();
          injectListButton();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      // Give up after 15 seconds
      setTimeout(() => observer.disconnect(), 15000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInject);
  } else {
    tryInject();
  }

})();
