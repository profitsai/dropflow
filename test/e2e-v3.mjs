import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  
  // First reload extension
  let extPage = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded' });
  }
  
  console.log('Reloading extension...');
  await extPage.evaluate(() => chrome.runtime.reload());
  await sleep(5000);
  
  // Reconnect - the old page is dead
  extPage = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
  }
  
  // Verify ext page is alive
  try {
    await extPage.evaluate(() => document.title);
    console.log('Ext page alive');
  } catch(e) {
    console.log('Ext page dead, opening new one');
    extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
  }

  // Now attach to the NEW SW
  await sleep(1000);
  const swTarget = browser.targets().find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  if (swTarget) {
    const cdp = await swTarget.createCDPSession();
    await cdp.send('Runtime.enable');
    cdp.on('Runtime.consoleAPICalled', (event) => {
      const text = event.args.map(a => a.value || a.description || '').join(' ');
      if (text.includes('DropFlow') || text.includes('[Drop')) {
        console.log(`[SW]`, text.substring(0, 300));
      }
    });
    cdp.on('Runtime.exceptionThrown', (event) => {
      console.log(`[SW EXC]`, event.exceptionDetails?.exception?.description?.substring(0, 300));
    });
    console.log('Attached to NEW SW');
  } else {
    console.log('WARNING: No SW target found');
  }

  // Clear ALL state
  await extPage.evaluate(() => new Promise(r => chrome.storage.local.get(null, items => {
    const keysToRemove = Object.keys(items).filter(k => 
      k.startsWith('dropflow_') || k.startsWith('aliBulk') || k.startsWith('pendingListing_') || k.startsWith('__dfBuilder')
    );
    chrome.storage.local.remove(keysToRemove, () => r(keysToRemove));
  })));
  console.log('State cleared');

  // Close eBay listing tabs
  for (const p of await browser.pages()) {
    if (p.url().includes('ebay.com.au/lstng') || p.url().includes('ebay.com.au/sl/')) {
      await p.close().catch(() => {});
    }
  }

  // Track new pages  
  const startTime = Date.now();
  browser.on('targetcreated', (target) => {
    if (target.type() === 'page') {
      const ts = Math.round((Date.now() - startTime) / 1000);
      console.log(`[${ts}s +PAGE]`, target.url().substring(0, 120));
    }
  });
  browser.on('targetdestroyed', (target) => {
    if (target.type() === 'page') {
      const ts = Math.round((Date.now() - startTime) / 1000);
      console.log(`[${ts}s -PAGE]`, target.url().substring(0, 120));
    }
  });

  // Trigger
  console.log('Triggering bulk listing...');
  const resp = await extPage.evaluate(() => new Promise(resolve => {
    chrome.runtime.sendMessage({
      type: 'START_ALI_BULK_LISTING',
      links: ['https://a.aliexpress.com/_mMLcP7b'],
      marketplace: 'ebay.com.au',
      ebayDomain: 'www.ebay.com.au',
      listingType: 'standard',
      threadCount: 1
    }, r => resolve(r));
  }));
  console.log('Response:', JSON.stringify(resp));

  // Poll loop
  while (Date.now() - startTime < 300000) {
    await sleep(15000);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    
    const pages = await browser.pages();
    const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng') || p.url().includes('ebay.com.au/sl/'));
    if (ebay) {
      try {
        const state = await ebay.evaluate(() => ({
          ff: window.__dropflow_form_filler_loaded,
          url: location.href.substring(0, 100),
        }));
        console.log(`[${elapsed}s EBAY]`, JSON.stringify(state));
      } catch(e) {}
    }

    // Check key storage items
    try {
      const storage = await extPage.evaluate(() => new Promise(r => {
        chrome.storage.local.get([
          'dropflow_variation_log', 'dropflow_last_fill_results', 
          'dropflow_builder_complete', 'dropflow_variation_status'
        ], r);
      }));
      for (const [k, v] of Object.entries(storage)) {
        if (v) console.log(`[${elapsed}s]`, k, '=', JSON.stringify(v).substring(0, 200));
      }
    } catch(e) {}
  }

  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
