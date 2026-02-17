import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  
  // Find existing ali page or open new one
  let page = (await browser.pages()).find(p => p.url().includes('aliexpress.com/item'));
  if (!page) {
    page = await browser.newPage();
    await page.goto('https://www.aliexpress.com/item/1005006995032850.html', { 
      waitUntil: 'domcontentloaded', timeout: 25000 
    }).catch(() => {});
    await sleep(8000);
  }

  const result = await page.evaluate(() => {
    return {
      // Title selectors
      'h1[data-pl=product-title]': document.querySelector('h1[data-pl="product-title"]')?.textContent?.trim(),
      '.product-title-text': document.querySelector('.product-title-text')?.textContent?.trim(),
      '[class*=ProductTitle]': document.querySelector('[class*="ProductTitle"]')?.textContent?.trim(),
      '[class*=product-title]': document.querySelector('[class*="product-title"]')?.textContent?.trim(),
      'all h1s': Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim().substring(0, 80)),
      'document.title': document.title,
      
      // Price selectors  
      '[class*=price]': Array.from(document.querySelectorAll('[class*="price"]')).slice(0, 5).map(e => e.textContent.trim().substring(0, 50)),
      
      // Image count
      'img[src*=alicdn]': document.querySelectorAll('img[src*="alicdn.com"]').length,
      
      // Check for SKU/variation elements
      '[data-pl=product-sku]': !!document.querySelector('[data-pl="product-sku"]'),
      '[class*=sku]': document.querySelectorAll('[class*="sku"]').length,
      
      // runParams check
      hasRunParams: typeof window.runParams !== 'undefined',
    };
  });
  
  console.log(JSON.stringify(result, null, 2));
  
  await page.close();
  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
