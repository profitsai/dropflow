import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  
  // Find service worker target
  const targets = browser.targets();
  const swTarget = targets.find(t => t.url().includes('hikiofeedjngalncoapgpmljpaoeolci') && t.type() === 'service_worker');
  if (!swTarget) { console.log('No SW target found'); browser.disconnect(); return; }
  
  console.log('Found SW:', swTarget.url());
  const sw = await swTarget.worker();
  
  // Check aliBulk state
  const state = await sw.evaluate(() => {
    return new Promise(resolve => {
      chrome.storage.local.get(['aliBulkRunning', 'aliBulkPaused', 'aliBulkAbort'], resolve);
    });
  });
  console.log('Bulk state:', JSON.stringify(state));

  // Check if there's a current listing in progress by looking at global vars
  const globals = await sw.evaluate(() => {
    return {
      hasListingQueue: typeof globalThis.listingQueue !== 'undefined',
      // Try to get any error info
    };
  });
  console.log('Globals:', JSON.stringify(globals));

  // Try to get recent console output from the extensions error page
  const extPage = (await browser.pages()).find(p => p.url().includes('chrome://extensions'));
  if (extPage) {
    // Can't easily scrape chrome:// pages, but let's try
    try {
      const errors = await extPage.evaluate(() => {
        const errorItems = document.querySelectorAll('extensions-error-page');
        return errorItems.length;
      });
      console.log('Extension errors page items:', errors);
    } catch(e) {
      console.log('Cannot access chrome:// page');
    }
  }

  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
