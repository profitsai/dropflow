const puppeteer = require('puppeteer-core');

const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';
const ALI_LINK = 'https://www.aliexpress.com/item/1005009953521226.html';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  
  // Find the ali-bulk-lister page
  let listerPage = pages.find(p => p.url().includes('ali-bulk-lister'));
  
  if (!listerPage) {
    console.log('Opening ali-bulk-lister page...');
    listerPage = await browser.newPage();
    await listerPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`);
    await listerPage.waitForSelector('#links-input');
  }
  
  console.log('Found lister page:', listerPage.url());
  
  // Listen to console
  listerPage.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') console.log('❌ CONSOLE ERROR:', text);
    else if (type === 'warning') console.log('⚠️  WARNING:', text);
    else console.log('📝', text);
  });
  
  // Listen for page errors
  listerPage.on('pageerror', err => console.log('❌ PAGE ERROR:', err.message));
  
  // Select Australia marketplace
  await listerPage.select('#ebay-marketplace', 'www.ebay.com.au');
  console.log('✅ Selected eBay Australia');
  
  // Set threads to 1 for easier debugging
  await listerPage.evaluate(() => { document.getElementById('thread-count').value = '1'; });
  
  // Clear and paste link
  await listerPage.evaluate((link) => {
    document.getElementById('links-input').value = link;
    document.getElementById('links-input').dispatchEvent(new Event('input'));
  }, ALI_LINK);
  console.log('✅ Pasted AliExpress link');
  
  // Wait a beat then check link count
  await new Promise(r => setTimeout(r, 500));
  const count = await listerPage.$eval('#link-count', el => el.textContent);
  console.log(`Link count: ${count}`);
  
  // Click Start
  console.log('Clicking Start Listing...');
  await listerPage.click('#btn-start');
  
  // Wait and monitor for 30 seconds
  console.log('Monitoring for 30 seconds...');
  await new Promise(r => setTimeout(r, 30000));
  
  // Take screenshot
  await listerPage.screenshot({ path: '/Users/pyrite/.openclaw/workspace/extension-run.png' });
  console.log('Screenshot saved');
  
  browser.disconnect();
})();
