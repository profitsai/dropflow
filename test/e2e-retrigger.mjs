import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });

  // Attach to service worker for console logging
  const swTarget = browser.targets().find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  if (swTarget) {
    const sw = await swTarget.worker();
    // Can't easily get console from worker via puppeteer, but let's try CDP
  }

  // Use CDPSession on the browser to monitor console
  const pages = await browser.pages();
  const extPage = pages.find(p => p.url().includes('ali-bulk-lister'));
  
  // Setup console listener on ext page
  const cdp = await extPage.createCDPSession();
  
  // Clear state
  await extPage.evaluate(() => chrome.storage.local.remove([
    'aliBulkRunning','aliBulkPaused','aliBulkAbort',
    'dropflow_last_fill_results','dropflow_variation_steps',
    'dropflow_variation_log','dropflow_variation_status',
    'dropflow_variation_check','dropflow_variation_flow_log',
    'dropflow_builder_complete','dropflow_variation_scripttag_diag',
    'dropflow_3dot_debug','dropflow_3dot_strategy',
    'dropflow_variation_mainworld_diag'
  ]));

  // Close any eBay listing tabs
  for (const p of pages) {
    if (p.url().includes('ebay.com.au/lstng')) await p.close().catch(() => {});
  }

  console.log('Triggering bulk listing...');
  const resp = await extPage.evaluate(() => {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: ['https://a.aliexpress.com/_mMLcP7b'],
        marketplace: 'ebay.com.au',
        ebayDomain: 'www.ebay.com.au',
        listingType: 'standard',
        threadCount: 1
      }, r => resolve(r));
    });
  });
  console.log('Response:', JSON.stringify(resp));

  // Now poll storage every 10 seconds for 5 minutes
  const startTime = Date.now();
  const maxDuration = 5 * 60 * 1000;
  let lastPageCount = 0;

  while (Date.now() - startTime < maxDuration) {
    await sleep(10000);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    
    // List pages
    const currentPages = await browser.pages();
    const urls = currentPages.map(p => p.url());
    if (urls.length !== lastPageCount) {
      console.log(`\n[${elapsed}s] PAGES: ${urls.length}`);
      urls.forEach(u => console.log('  ', u.substring(0, 120)));
      lastPageCount = urls.length;
    }
    
    // Check relevant storage
    const storage = await extPage.evaluate(() => new Promise(r => {
      chrome.storage.local.get(null, items => {
        const relevant = {};
        for (const [k, v] of Object.entries(items)) {
          if (k.startsWith('dropflow_') || k.startsWith('aliBulk') || k.includes('pending') || k.includes('scrape')) {
            relevant[k] = JSON.stringify(v).substring(0, 200);
          }
        }
        r(relevant);
      });
    }));
    
    const storageKeys = Object.keys(storage);
    if (storageKeys.length > 0) {
      console.log(`[${elapsed}s] STORAGE:`);
      storageKeys.forEach(k => console.log(`  ${k}: ${storage[k]}`));
    }

    // Check for eBay tab and its state
    const ebayTab = currentPages.find(p => p.url().includes('ebay.com.au/lstng'));
    if (ebayTab) {
      try {
        const state = await ebayTab.evaluate(() => ({
          formFiller: window.__dropflow_form_filler_loaded,
          title: document.querySelector('input[placeholder*="title" i], [data-testid="title"] input')?.value,
          url: location.href
        }));
        console.log(`[${elapsed}s] EBAY TAB:`, JSON.stringify(state));
      } catch(e) {
        console.log(`[${elapsed}s] EBAY TAB error:`, e.message);
      }
    }

    // Check AliExpress tab
    const aliTab = currentPages.find(p => p.url().includes('aliexpress.com'));
    if (aliTab) console.log(`[${elapsed}s] ALI TAB still open`);

    // Check if bulk listing is done
    const bulkDone = await extPage.evaluate(() => new Promise(r => {
      chrome.storage.local.get(['aliBulkRunning'], items => r(items.aliBulkRunning));
    }));
    if (bulkDone === false) {
      console.log(`[${elapsed}s] Bulk listing COMPLETED`);
      break;
    }
  }

  console.log('Monitoring ended');
  browser.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
