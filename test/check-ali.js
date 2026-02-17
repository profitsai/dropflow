const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  
  const aliPage = pages.find(p => p.url().includes('aliexpress.com/item'));
  if (aliPage) {
    console.log('AliExpress page:', aliPage.url());
    
    // Check for content script
    const csCheck = await aliPage.evaluate(() => {
      // Check if DropFlow content script is present
      const dropflowElements = document.querySelectorAll('[id*="dropflow"], [class*="dropflow"]');
      return {
        dropflowElements: dropflowElements.length,
        title: document.title,
        bodyLength: document.body?.innerHTML?.length || 0,
        hasRunParams: !!window.__INIT_STORE_DATA__,
        scripts: Array.from(document.querySelectorAll('script')).length
      };
    }).catch(e => ({ error: e.message }));
    console.log('Content script check:', JSON.stringify(csCheck, null, 2));
    
    await aliPage.screenshot({ path: 'ali-page-current.png' });
    
    // Try manually injecting content script
    console.log('\nTrying to manually execute content script...');
    try {
      await aliPage.evaluate(() => {
        // Check if chrome.runtime is available (content script context)
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
          return 'Extension context available: ' + chrome.runtime.id;
        }
        return 'No extension context';
      }).then(r => console.log(r));
    } catch(e) {
      console.log('Error:', e.message);
    }
  } else {
    console.log('No AliExpress page found');
  }
  
  // Also check SW directly
  const targets = await browser.targets();
  const swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes(EXT_ID));
  if (swTarget) {
    const sw = await swTarget.worker();
    const state = await sw.evaluate(async () => {
      // Check bulk listing state
      try {
        const queues = typeof aliBulkQueue !== 'undefined' ? aliBulkQueue : 'undefined';
        const active = typeof activeListings !== 'undefined' ? activeListings : 'undefined';
        
        // Check all global vars that might hold state
        const globals = {};
        for (const key of ['aliBulkQueue', 'activeListings', 'activeBulkListings', 'bulkListingState', 'currentListing', 'listingInProgress']) {
          try { globals[key] = eval(`typeof ${key} !== 'undefined' ? JSON.stringify(${key}).substring(0, 200) : 'undefined'`); } catch(e) { globals[key] = 'error: ' + e.message; }
        }
        return globals;
      } catch(e) {
        return { error: e.message };
      }
    }).catch(e => ({ error: e.message }));
    console.log('\nSW globals:', JSON.stringify(state, null, 2));
  }
  
  browser.disconnect();
})().catch(e => console.error(e.message));
