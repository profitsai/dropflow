const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // Open AliExpress product page
  console.log('Opening AliExpress product...');
  const page = await browser.newPage();
  await page.goto('https://www.aliexpress.com/item/1005009953521226.html', { 
    waitUntil: 'domcontentloaded', timeout: 30000 
  });
  
  // Wait for page to load
  await new Promise(r => setTimeout(r, 5000));
  console.log('Page loaded:', page.url());
  await page.screenshot({ path: 'ali-fresh.png' });
  
  // Check if extension's "List on eBay" button is present
  const hasButton = await page.evaluate(() => {
    const btn = document.querySelector('#dropflow-list-btn, [id*="dropflow"], [class*="dropflow"]');
    return btn ? btn.outerHTML.substring(0, 200) : 'not found';
  });
  console.log('Extension button:', hasButton);
  
  browser.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
