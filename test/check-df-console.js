const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const lstng = pages.find(p => p.url().includes('/lstng'));
  
  if (lstng) {
    // Check if extension content script is present
    const check = await lstng.evaluate(() => {
      // Try to find any DropFlow artifacts on the page
      return {
        url: window.location.href,
        dropflowElements: document.querySelectorAll('[id*="dropflow"], [class*="dropflow"]').length,
      };
    });
    console.log('Page check:', JSON.stringify(check));
    
    // Check storage to see if pending data was consumed
    const extPage = pages.find(p => p.url().includes(EXT_ID));
    if (extPage) {
      const storage = await extPage.evaluate(async () => {
        const data = await new Promise(r => chrome.storage.local.get(null, r));
        const keys = Object.keys(data);
        const pending = keys.filter(k => k.includes('pending') || k.includes('Listing'));
        return { allKeys: keys, pendingKeys: pending, pendingData: pending.map(k => ({ key: k, preview: JSON.stringify(data[k]).substring(0, 200) })) };
      });
      console.log('\nStorage:', JSON.stringify(storage, null, 2));
    }
    
    // Now, let's manually trigger the form-filler with FILL_EBAY_FORM message
    // First re-inject the content script
    console.log('\nTrying to inject content script and trigger fill...');
    const extPage2 = pages.find(p => p.url().includes(EXT_ID));
    if (extPage2) {
      const tabId = await extPage2.evaluate(async () => {
        // Get the eBay listing tab ID
        const tabs = await chrome.tabs.query({ url: '*://www.ebay.com.au/lstng*' });
        return tabs[0]?.id;
      });
      console.log('eBay tab ID:', tabId);
      
      if (tabId) {
        // Inject content script
        const injectResult = await extPage2.evaluate(async (tid) => {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tid },
              files: ['content-scripts/ebay/form-filler.js']
            });
            return 'injected';
          } catch(e) {
            return 'inject error: ' + e.message;
          }
        }, tabId);
        console.log('Inject:', injectResult);
        
        // Wait a moment then send FILL_EBAY_FORM
        await new Promise(r => setTimeout(r, 3000));
        
        // Get the test product data from storage
        const fillResult = await extPage2.evaluate(async (tid) => {
          const data = await new Promise(r => chrome.storage.local.get('pendingListingData', r));
          const product = data.pendingListingData;
          if (!product) return { error: 'no pending data' };
          
          try {
            const resp = await chrome.tabs.sendMessage(tid, {
              type: 'FILL_EBAY_FORM',
              productData: product
            });
            return resp;
          } catch(e) {
            return { error: e.message };
          }
        }, tabId);
        console.log('Fill result:', JSON.stringify(fillResult));
      }
    }
  }
  
  browser.disconnect();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
