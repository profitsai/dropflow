import puppeteer from 'puppeteer-core';
const WS = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS, defaultViewport: null });
  
  // Check the extensions error page
  const pages = await browser.pages();
  const errPage = pages.find(p => p.url().includes('chrome://extensions'));
  if (errPage) {
    // Read extension errors from the page
    const errors = await errPage.evaluate(() => document.body?.innerText?.substring(0, 3000) || 'no text');
    console.log('Extension page text:\n' + errors);
  }

  // Check SW state via extension page
  const extPage = pages.find(p => p.url().includes(EXT_ID) && p.url().includes('popup'));
  if (extPage) {
    // Check Ali bulk state
    const state = await extPage.evaluate(() => new Promise(res => {
      const t = setTimeout(() => res('TIMEOUT'), 5000);
      // Try to get any diagnostic info
      chrome.runtime.sendMessage({ type: 'GET_EBAY_HEADERS' }, r => {
        clearTimeout(t);
        res(JSON.stringify(r));
      });
    }));
    console.log('\nSW state (headers):', state);

    // Check storage for progress/error data
    const storage = await extPage.evaluate(async () => {
      const data = await chrome.storage.local.get(null);
      const keys = Object.keys(data);
      const relevant = {};
      for (const k of keys) {
        if (k.includes('dropflow') || k.includes('orchestration') || k.includes('ali_bulk') || k.includes('progress') || k.includes('error') || k.includes('listing')) {
          const v = JSON.stringify(data[k]);
          relevant[k] = v.length > 500 ? v.substring(0, 500) + '...' : data[k];
        }
      }
      return { totalKeys: keys.length, relevant };
    });
    console.log('\nStorage:', JSON.stringify(storage, null, 2));
  }

  browser.disconnect();
}
run().catch(e => console.error(e.message));
