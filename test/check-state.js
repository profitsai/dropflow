const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  
  if (!ebayPage) { console.log('No eBay page'); browser.disconnect(); return; }
  console.log('URL:', ebayPage.url());
  
  // Check errors
  const errors = await ebayPage.evaluate(() => {
    const errorEls = document.querySelectorAll('.summary--error');
    return Array.from(errorEls).map(e => e.className + ': ' + e.textContent.substring(0,150));
  });
  console.log('Errors:', errors);
  
  // Check condition
  const cond = await ebayPage.evaluate(() => {
    const condRecoBtn = document.querySelector('button.condition-recommendation-value');
    const condValue = document.querySelector('#summary-condition-field-value');
    return {
      hasRecoButtons: !!condRecoBtn,
      condValue: condValue?.textContent?.trim()
    };
  });
  console.log('Condition:', cond);
  
  // Check photos
  const photos = await ebayPage.evaluate(() => {
    const imgs = document.querySelectorAll('.uploader-thumbnails img[src]');
    return { count: imgs.length };
  });
  console.log('Photos:', photos);
  
  // Try to manually trigger form fill via extension message
  const result = await ebayPage.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.local.get(['dropflow_product_data', 'dropflow_pending_fill'], (data) => {
        resolve({
          hasProductData: !!data.dropflow_product_data,
          hasPendingFill: !!data.dropflow_pending_fill,
          keys: Object.keys(data)
        });
      });
    });
  }).catch(e => ({ error: e.message }));
  console.log('Storage:', result);
  
  browser.disconnect();
})().catch(e => console.error(e));
