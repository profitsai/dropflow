import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  
  // Force reload extension to kill any stuck state
  const extPage = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
  console.log('Reloading extension to kill stuck state...');
  await extPage.evaluate(() => chrome.runtime.reload());
  await sleep(4000);
  
  // Reconnect to ext page
  let newExtPage = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
  if (!newExtPage) {
    newExtPage = await browser.newPage();
    await newExtPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
  }
  
  // Clear ALL state
  await newExtPage.evaluate(() => chrome.storage.local.remove([
    'aliBulkRunning','aliBulkPaused','aliBulkAbort',
    'dropflow_last_fill_results','dropflow_variation_steps',
    'dropflow_variation_log','dropflow_variation_status',
    'dropflow_variation_check','dropflow_variation_flow_log',
    'dropflow_builder_complete','dropflow_variation_scripttag_diag',
    'dropflow_3dot_debug','dropflow_3dot_strategy','dropflow_variation_mainworld_diag',
    'pendingListing_1373278465'
  ]));
  console.log('State cleared');
  
  // Close any eBay listing tabs
  for (const p of await browser.pages()) {
    if (p.url().includes('ebay.com.au/lstng')) await p.close().catch(() => {});
  }

  // Attach to SW console
  await sleep(1000);
  const swTarget = browser.targets().find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  if (swTarget) {
    const cdp = await swTarget.createCDPSession();
    await cdp.send('Runtime.enable');
    cdp.on('Runtime.consoleAPICalled', (event) => {
      const text = event.args.map(a => a.value || a.description || '').join(' ');
      if (text.includes('DropFlow') || text.includes('[Drop')) {
        const ts = Math.round((Date.now() - startTime) / 1000);
        console.log(`[SW ${ts}s]`, text.substring(0, 300));
      }
    });
    cdp.on('Runtime.exceptionThrown', (event) => {
      const ts = Math.round((Date.now() - startTime) / 1000);
      console.log(`[SW EXC ${ts}s]`, event.exceptionDetails?.exception?.description?.substring(0, 300));
    });
    console.log('SW console attached');
  }
  
  // Track new pages
  browser.on('targetcreated', async (target) => {
    const ts = Math.round((Date.now() - startTime) / 1000);
    console.log(`[${ts}s NEW]`, target.type(), target.url().substring(0, 120));
  });
  browser.on('targetdestroyed', async (target) => {
    const ts = Math.round((Date.now() - startTime) / 1000);
    console.log(`[${ts}s CLOSED]`, target.type(), target.url().substring(0, 120));
  });

  const startTime = Date.now();
  
  // Trigger
  console.log('Triggering...');
  const resp = await newExtPage.evaluate(() => {
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

  // Monitor for 5 minutes
  while (Date.now() - startTime < 300000) {
    await sleep(15000);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    
    // Check for eBay tab and its state
    const pages = await browser.pages();
    const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng') || p.url().includes('ebay.com.au/sl/'));
    if (ebay) {
      try {
        const state = await ebay.evaluate(() => ({
          ff: window.__dropflow_form_filler_loaded,
          url: location.href.substring(0, 100),
          title: document.querySelector('input')?.value?.substring(0, 60)
        }));
        console.log(`[${elapsed}s EBAY]`, JSON.stringify(state));
      } catch(e) {
        console.log(`[${elapsed}s EBAY err]`, e.message?.substring(0, 80));
      }
    }
    
    // Check storage for variation log, fill results
    const storage = await newExtPage.evaluate(() => new Promise(r => {
      chrome.storage.local.get(['dropflow_variation_log', 'dropflow_last_fill_results', 'dropflow_builder_complete'], r);
    }));
    if (storage.dropflow_variation_log) console.log(`[${elapsed}s VARLOG]`, JSON.stringify(storage.dropflow_variation_log).substring(0, 200));
    if (storage.dropflow_last_fill_results) console.log(`[${elapsed}s FILL]`, JSON.stringify(storage.dropflow_last_fill_results).substring(0, 200));
    if (storage.dropflow_builder_complete) console.log(`[${elapsed}s BUILDER]`, JSON.stringify(storage.dropflow_builder_complete));
  }

  console.log('Monitor timeout');
  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
