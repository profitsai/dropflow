import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  
  // Open the AliExpress URL
  const aliPage = await browser.newPage();
  aliPage.on('console', msg => console.log('[ALI]', msg.text()));
  aliPage.on('pageerror', err => console.log('[ALI ERROR]', err.message));
  
  console.log('Navigating to AliExpress...');
  await aliPage.goto('https://www.aliexpress.com/item/1005006995032850.html', { 
    waitUntil: 'domcontentloaded', 
    timeout: 20000 
  }).catch(e => console.log('Nav timeout (expected):', e.message));
  
  console.log('Page loaded, waiting 5s...');
  await sleep(5000);
  
  // Inject content script
  console.log('Injecting content script...');
  const extPage = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
  const injectResult = await extPage.evaluate((tabUrl) => {
    return new Promise(async (resolve) => {
      // Get tab ID for the aliexpress tab
      const tabs = await chrome.tabs.query({});
      const aliTab = tabs.find(t => t.url && t.url.includes('1005006995032850'));
      if (!aliTab) { resolve({ error: 'Ali tab not found' }); return; }
      
      try {
        await chrome.scripting.executeScript({
          target: { tabId: aliTab.id },
          files: ['content-scripts/aliexpress/product-scraper.js']
        });
        resolve({ success: true, tabId: aliTab.id });
      } catch(e) {
        resolve({ error: e.message });
      }
    });
  });
  console.log('Inject result:', JSON.stringify(injectResult));
  
  await sleep(2000);
  
  // Now send scrape message
  console.log('Sending SCRAPE message...');
  const scrapeResult = await extPage.evaluate((tabId) => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ error: 'Timed out after 30s' }), 30000);
      chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_ALIEXPRESS_PRODUCT' }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(response);
        }
      });
    });
  }, injectResult.tabId);
  
  console.log('Scrape result:');
  if (scrapeResult?.error) {
    console.log('ERROR:', scrapeResult.error);
  } else {
    console.log('Title:', scrapeResult?.title);
    console.log('Price:', scrapeResult?.price);
    console.log('Images:', scrapeResult?.images?.length);
    console.log('Variations:', JSON.stringify(scrapeResult?.variations)?.substring(0, 300));
  }
  
  await aliPage.close();
  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
