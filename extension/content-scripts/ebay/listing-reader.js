/**
 * eBay Listing Reader
 * Extracts data from existing eBay item pages.
 */

(function () {
  'use strict';

  /**
   * Extract listing data from the current eBay item page.
   */
  function readListing() {
    return {
      itemId: extractItemId(),
      title: extractTitle(),
      price: extractPrice(),
      currency: extractCurrency(),
      condition: extractCondition(),
      seller: extractSeller(),
      description: extractDescription(),
      images: extractImages(),
      itemSpecifics: extractItemSpecifics(),
      url: window.location.href
    };
  }

  function extractItemId() {
    const match = window.location.pathname.match(/\/itm\/(\d+)/);
    return match ? match[1] : null;
  }

  function extractTitle() {
    const el = document.querySelector('h1.x-item-title__mainTitle span') ||
               document.querySelector('#itemTitle') ||
               document.querySelector('h1');
    return el ? el.textContent.trim() : '';
  }

  function extractPrice() {
    const el = document.querySelector('.x-price-primary span') ||
               document.querySelector('#prcIsum') ||
               document.querySelector('[itemprop="price"]');
    if (el) {
      const match = el.textContent.match(/[\d,.]+/);
      return match ? parseFloat(match[0].replace(/,/g, '')) : 0;
    }
    return 0;
  }

  function extractCurrency() {
    const el = document.querySelector('[itemprop="priceCurrency"]');
    return el ? el.getAttribute('content') || 'USD' : 'USD';
  }

  function extractCondition() {
    const el = document.querySelector('.x-item-condition-text span') ||
               document.querySelector('#vi-itm-cond');
    return el ? el.textContent.trim() : '';
  }

  function extractSeller() {
    const el = document.querySelector('.x-sellercard-atf__info__about-seller a') ||
               document.querySelector('.mbg-nw');
    return el ? el.textContent.trim() : '';
  }

  function extractDescription() {
    const iframe = document.querySelector('#desc_ifr') || document.querySelector('iframe[title*="description" i]');
    if (iframe) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        return doc.body ? doc.body.textContent.trim() : '';
      } catch (e) {
        return ''; // Cross-origin restriction
      }
    }
    return '';
  }

  function extractImages() {
    const images = [];
    document.querySelectorAll('#vi_main_img_fs img, .ux-image-carousel-item img').forEach(img => {
      const src = img.getAttribute('data-zoom-src') || img.getAttribute('src');
      if (src && !images.includes(src)) {
        images.push(src.replace(/s-l\d+/, 's-l1600')); // Get full-size
      }
    });
    return images;
  }

  function extractItemSpecifics() {
    const specifics = {};
    document.querySelectorAll('.x-about-this-item .ux-labels-values').forEach(row => {
      const label = row.querySelector('.ux-labels-values__labels span');
      const value = row.querySelector('.ux-labels-values__values span');
      if (label && value) {
        specifics[label.textContent.trim()] = value.textContent.trim();
      }
    });
    return specifics;
  }

  // Message listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'READ_EBAY_LISTING') {
      sendResponse(readListing());
      return false;
    }
  });

  console.log('[DropFlow] eBay listing reader loaded');
})();
