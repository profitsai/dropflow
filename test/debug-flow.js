const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  
  // Get the extension page
  const extPage = pages.find(p => p.url().includes(EXT_ID));
  
  // Check the service worker status and any errors
  const swInfo = await extPage.evaluate(async () => {
    // Check all storage
    const data = await new Promise(r => chrome.storage.local.get(null, r));
    return {
      keys: Object.keys(data),
      swLogs: data._swLogs,
      markup: data.dropflow_price_markup,
      priceMarkup: data.priceMarkup,
    };
  });
  console.log('Storage:', JSON.stringify(swInfo, null, 2));
  
  // Try to get the service worker's console by connecting to its target
  const targets = await browser.targets();
  console.log('\nTargets:');
  for (const t of targets) {
    console.log(`  ${t.type()}: ${t.url().substring(0, 100)}`);
  }
  
  // Find service worker target
  const swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes(EXT_ID));
  if (swTarget) {
    console.log('\nFound SW target, connecting...');
    const swPage = await swTarget.worker();
    if (swPage) {
      // Execute in SW context to check state
      const swState = await swPage.evaluate(() => {
        // Check if there's any bulk listing state
        return {
          hasActiveListing: typeof activeBulkListings !== 'undefined',
          type: typeof self
        };
      }).catch(e => ({ error: e.message }));
      console.log('SW state:', JSON.stringify(swState));
    }
  } else {
    console.log('No SW target found - SW may have gone inactive');
    // Try to wake it up
    const wakeResult = await extPage.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'PING' }, (resp) => {
          resolve(resp || { error: chrome.runtime.lastError?.message });
        });
      });
    });
    console.log('Wake result:', JSON.stringify(wakeResult));
  }
  
  // Check the AliExpress tabs
  const aliPages = pages.filter(p => p.url().includes('aliexpress.com'));
  for (let i = 0; i < aliPages.length; i++) {
    const title = await aliPages[i].title();
    console.log(`\nAliExpress tab ${i}: ${aliPages[i].url().substring(0, 80)} - "${title}"`);
    
    // Check if the extension's content script injected the "List on eBay" button
    const hasButton = await aliPages[i].evaluate(() => {
      const btn = document.querySelector('#dropflow-list-btn, [class*="dropflow"], [id*="dropflow"]');
      return btn ? btn.textContent : 'no dropflow button found';
    }).catch(() => 'error checking');
    console.log(`  DropFlow button: ${hasButton}`);
  }
  
  browser.disconnect();
})().catch(e => console.error(e.message));
