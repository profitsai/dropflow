import puppeteer from 'puppeteer-core';
const WS = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS, defaultViewport: null });
  
  // List all targets
  const targets = browser.targets();
  console.log('All targets:');
  for (const t of targets) {
    console.log(`  ${t.type()}: ${t.url().substring(0, 80)}`);
  }

  // Check SW
  const sw = targets.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  console.log('\nSW found:', !!sw, sw?.url());

  // Try simple ping from extension page
  const p = await browser.newPage();
  await p.goto(`chrome-extension://${EXT_ID}/pages/popup/popup.html`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  // Test 1: Simple runtime API
  const test1 = await p.evaluate(() => {
    return new Promise(resolve => {
      const t = setTimeout(() => resolve('TIMEOUT'), 5000);
      try {
        chrome.runtime.sendMessage({ type: 'PING' }, resp => {
          clearTimeout(t);
          resolve('resp: ' + JSON.stringify(resp));
        });
      } catch(e) {
        clearTimeout(t);
        resolve('error: ' + e.message);
      }
    });
  });
  console.log('PING test:', test1);

  // Test 2: Check if runtime is connected
  const test2 = await p.evaluate(() => {
    return {
      id: chrome.runtime?.id,
      getURL: chrome.runtime?.getURL?.('test'),
    };
  });
  console.log('Runtime state:', JSON.stringify(test2));

  // Test 3: Try sendMessage with known type
  const test3 = await p.evaluate(() => {
    return new Promise(resolve => {
      const t = setTimeout(() => resolve('TIMEOUT 5s'), 5000);
      chrome.runtime.sendMessage({ type: 'GET_EBAY_HEADERS' }, resp => {
        clearTimeout(t);
        resolve('resp: ' + JSON.stringify(resp)?.substring(0, 200));
      });
    });
  });
  console.log('GET_EBAY_HEADERS test:', test3);

  // Test 4: Try the actual trigger with a short timeout
  const test4 = await p.evaluate(() => {
    return new Promise(resolve => {
      const t = setTimeout(() => resolve('TIMEOUT 10s'), 10000);
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        payload: {
          links: ['https://www.aliexpress.com/item/1005007380025405.html'],
          threadCount: 1,
          listingType: 'standard'
        }
      }, resp => {
        clearTimeout(t);
        resolve('resp: ' + JSON.stringify(resp));
      });
    });
  });
  console.log('START_ALI_BULK_LISTING:', test4);

  await p.close();
  browser.disconnect();
}

run().catch(e => console.error('FATAL:', e.message));
