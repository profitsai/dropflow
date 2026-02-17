import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  
  const page = await browser.newPage();
  // Capture ALL console from the page
  page.on('console', msg => {
    if (msg.text().includes('DropFlow')) console.log('[CS]', msg.text());
  });
  page.on('pageerror', err => console.log('[PAGE_ERR]', err.message));
  
  console.log('Opening AliExpress page...');
  await page.goto('https://www.aliexpress.com/item/1005006995032850.html', { 
    waitUntil: 'domcontentloaded', timeout: 20000 
  }).catch(e => console.log('Nav timeout:', e.message));
  
  await sleep(5000);
  console.log('Page settled, injecting scraper...');
  
  // Inject via extension
  const extPage = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
  const tabs = await extPage.evaluate(() => chrome.tabs.query({}));
  const aliTab = tabs.find(t => t.url?.includes('1005006995032850'));
  
  await extPage.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/aliexpress/product-scraper.js']
    });
  }, aliTab.id);
  
  console.log('Injected, waiting 2s...');
  await sleep(2000);
  
  // Send scrape message and wait
  console.log('Sending scrape message...');
  const result = await extPage.evaluate((tabId) => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ error: 'TIMEOUT' }), 60000);
      chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_ALIEXPRESS_PRODUCT' }, (resp) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
        else resolve(resp);
      });
    });
  }, aliTab.id);
  
  console.log('\n=== SCRAPE RESULT ===');
  console.log('Error:', result?.error);
  console.log('Title:', result?.title);
  console.log('Price:', result?.price);
  console.log('Images:', result?.images?.length, result?.images?.slice(0, 2));
  console.log('Variations:', JSON.stringify(result?.variations)?.substring(0, 500));
  console.log('Description:', result?.description?.substring(0, 100));
  console.log('preDownloadedImages:', result?.preDownloadedImages?.length);
  
  // Full result keys
  if (result && !result.error) {
    console.log('\nAll keys:', Object.keys(result));
  }
  
  await page.close();
  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
