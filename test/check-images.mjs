import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

// Check what's in storage for product data
const pages = await browser.pages();
// Find the eBay or AliExpress tab
for (const p of pages) {
  const url = p.url();
  console.log('Tab:', url.substring(0, 80));
}

// Use a page to execute in the extension's service worker context
const extPage = pages.find(p => p.url().includes('ebay')) || pages[0];

// Check storage for product data keys
const storageData = await extPage.evaluate(async () => {
  try {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all);
    const productKeys = keys.filter(k => k.startsWith('aliProduct_') || k.startsWith('productData_') || k.includes('product'));
    const result = {};
    for (const k of productKeys) {
      const val = all[k];
      if (val && typeof val === 'object') {
        result[k] = {
          title: val.title?.substring(0, 50),
          imageCount: val.images?.length,
          firstImage: val.images?.[0]?.substring(0, 80),
          hasPreDownloaded: Array.isArray(val.preDownloadedImages),
          preDownloadedCount: val.preDownloadedImages?.filter(Boolean)?.length || 0,
          preDownloadedSizes: val.preDownloadedImages?.map(d => d ? Math.round(d.length/1024) + 'KB' : null)?.slice(0, 3)
        };
      }
    }
    return { keys, productKeys, result };
  } catch(e) { return { error: e.message }; }
});

console.log('Storage data:', JSON.stringify(storageData, null, 2));

// Try fetching an AliExpress image from the service worker
if (storageData.result) {
  const firstKey = Object.keys(storageData.result)[0];
  if (firstKey) {
    const imageUrl = storageData.result[firstKey]?.firstImage;
    if (imageUrl) {
      console.log('\nTrying FETCH_IMAGE for:', imageUrl);
      const fetchResult = await extPage.evaluate(async (url) => {
        try {
          const resp = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url });
          return { success: resp?.success, error: resp?.error, size: resp?.dataUrl?.length };
        } catch(e) { return { error: e.message }; }
      }, imageUrl);
      console.log('FETCH_IMAGE result:', JSON.stringify(fetchResult));
    }
  }
}

browser.disconnect();
