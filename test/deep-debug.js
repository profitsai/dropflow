const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  
  console.log('All tabs:');
  for (const p of pages) {
    console.log('  ' + p.url().substring(0, 100));
  }
  
  // Check EACH AliExpress tab for content script
  const aliPages = pages.filter(p => p.url().includes('aliexpress.com/item'));
  for (let i = 0; i < aliPages.length; i++) {
    const p = aliPages[i];
    console.log(`\n--- AliExpress tab ${i} ---`);
    
    // Check for the extension's content script artifacts
    const check = await p.evaluate(() => {
      return {
        // Look for injected elements
        dropflowEls: document.querySelectorAll('[id*="dropflow"], [id*="moltbot"], [class*="dropflow"]').length,
        // Check for the "List on eBay" button the content script injects
        listButton: !!document.querySelector('#dropflow-list-btn, .dropflow-float-btn, [class*="float"][class*="btn"]'),
        // Check page readiness
        readyState: document.readyState,
        hasTitle: !!document.querySelector('h1'),
        title: document.querySelector('h1')?.textContent?.substring(0, 60),
        // Check for AliExpress product data
        hasInitStore: typeof window.__INIT_STORE_DATA__ !== 'undefined',
        hasRunParams: !!document.querySelector('script[type="application/json"]'),
      };
    }).catch(e => ({ error: e.message }));
    console.log('Check:', JSON.stringify(check, null, 2));
  }
  
  // Check service worker
  const targets = await browser.targets();
  const swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes(EXT_ID));
  if (swTarget) {
    console.log('\n--- Service Worker ---');
    const sw = await swTarget.worker();
    
    // Get detailed state
    const state = await sw.evaluate(async () => {
      // Check chrome.storage
      const storage = await new Promise(r => chrome.storage.local.get(null, r));
      const keys = Object.keys(storage);
      
      // Look for any active bulk listing state in global scope
      const globals = {};
      const checkVars = ['aliBulkQueue', 'activeBulkJobs', 'currentJobs', 'pendingTabs', 'tabWaiters', 'scrapingTabs'];
      for (const v of checkVars) {
        try {
          const val = eval(v);
          globals[v] = val ? JSON.stringify(val).substring(0, 300) : String(val);
        } catch(e) { /* not defined */ }
      }
      
      // Check if there are any message listeners or pending operations
      return {
        storageKeys: keys,
        globals,
        swStartTime: performance.now()
      };
    }).catch(e => ({ error: e.message }));
    console.log('State:', JSON.stringify(state, null, 2));
    
    // Listen for console messages from SW
    console.log('\nSending PING to SW...');
    const extPage = pages.find(p => p.url().includes(EXT_ID));
    if (extPage) {
      const ping = await extPage.evaluate(async () => {
        return new Promise(r => {
          chrome.runtime.sendMessage({ type: 'PING' }, resp => {
            r(resp || { error: chrome.runtime.lastError?.message });
          });
        });
      });
      console.log('Ping response:', JSON.stringify(ping));
      
      // Try sending GET_SCRAPE_STATUS or similar
      const status = await extPage.evaluate(async () => {
        return new Promise(r => {
          chrome.runtime.sendMessage({ type: 'GET_STATUS' }, resp => {
            r(resp || { error: chrome.runtime.lastError?.message });
          });
        });
      });
      console.log('Status response:', JSON.stringify(status));
    }
  } else {
    console.log('\nNo SW target found!');
  }
  
  browser.disconnect();
})().catch(e => console.error(e.message, e.stack));
