const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  log(`Found ${pages.length} tabs`);
  
  // Find the extension page or eBay page
  let extPage = pages.find(p => p.url().includes(EXT_ID));
  let ebayPage = pages.find(p => p.url().includes('ebay.com.au'));
  
  log('Tabs: ' + pages.map(p => p.url().substring(0, 80)).join(' | '));
  
  // Check what's in storage
  if (extPage) {
    const storage = await extPage.evaluate(async () => {
      const d = await new Promise(r => chrome.storage.local.get(null, r));
      return d;
    });
    log('Full storage: ' + JSON.stringify(storage).substring(0, 2000));
  }
  
  // Check console logs on eBay page
  if (ebayPage) {
    // Get the page content to see what's happening
    const url = ebayPage.url();
    log('eBay URL: ' + url);
    
    // Check if content script is present
    const hasDF = await ebayPage.evaluate(() => {
      return {
        hasDropFlow: !!document.querySelector('[data-dropflow]'),
        bodyText: document.body?.innerText?.substring(0, 500),
        inputs: Array.from(document.querySelectorAll('input')).map(i => ({
          placeholder: i.placeholder,
          value: i.value,
          type: i.type,
          name: i.name
        })).slice(0, 5)
      };
    });
    log('eBay page state: ' + JSON.stringify(hasDF));
  }
  
  browser.disconnect();
})().catch(e => console.error('FATAL:', e.message));
