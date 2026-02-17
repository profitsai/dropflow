import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  
  // Clean start
  let ext = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
  if (!ext) {
    ext = await browser.newPage();
    await ext.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
  }

  // Clear state
  await ext.evaluate(() => new Promise(r => chrome.storage.local.get(null, items => {
    const keys = Object.keys(items).filter(k => 
      k.startsWith('dropflow_') || k.startsWith('aliBulk') || k.startsWith('pendingListing_') || k.startsWith('__dfBuilder')
    );
    chrome.storage.local.remove(keys, () => r(keys.length));
  })));

  // Close eBay listing tabs
  for (const p of await browser.pages()) {
    if (p.url().includes('ebay.com.au/lstng') || p.url().includes('ebay.com.au/sl/')) {
      await p.close().catch(() => {});
    }
  }
  
  // Trigger
  console.log('Triggering bulk listing...');
  const resp = await ext.evaluate(() => new Promise(resolve => {
    chrome.runtime.sendMessage({
      type: 'START_ALI_BULK_LISTING',
      links: ['https://a.aliexpress.com/_mMLcP7b'],
      marketplace: 'ebay.com.au',
      ebayDomain: 'www.ebay.com.au',
      listingType: 'standard',
      threadCount: 1
    }, r => resolve(r));
  }));
  console.log('Trigger:', JSON.stringify(resp));
  
  if (!resp?.success) {
    console.log('Failed to trigger. Exiting.');
    browser.disconnect();
    return;
  }

  // Track pages
  browser.on('targetcreated', t => { if (t.type() === 'page') console.log(`[+PAGE]`, t.url()?.substring(0, 80)); });
  browser.on('targetdestroyed', t => { if (t.type() === 'page') console.log(`[-PAGE]`, t.url()?.substring(0, 80)); });

  const start = Date.now();
  let stage = 'A'; // A=scraping, B=ebay-load, C=form-fill, D=photos, E=variations, F=specifics, G=submit
  
  while (Date.now() - start < 600000) { // 10 min max
    await sleep(15000);
    const elapsed = Math.round((Date.now() - start) / 1000);
    
    try {
      const pages = await browser.pages();
      const ali = pages.find(p => p.url().includes('aliexpress.com/item'));
      const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng') || p.url().includes('ebay.com.au/sl/'));
      
      if (ali) {
        console.log(`[${elapsed}s] Stage A: Scraping AliExpress...`);
        continue;
      }
      
      if (ebay && stage === 'A') {
        stage = 'B';
        console.log(`[${elapsed}s] Stage B: eBay page opened: ${ebay.url().substring(0, 80)}`);
      }
      
      if (ebay) {
        // Check storage for progress
        const freshExt = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
        if (freshExt) {
          const storage = await freshExt.evaluate(() => new Promise(r => chrome.storage.local.get([
            'dropflow_variation_log', 'dropflow_builder_complete', 'dropflow_last_fill_results'
          ], r)));
          
          const varLog = storage.dropflow_variation_log || [];
          const lastStep = varLog.length > 0 ? varLog[varLog.length - 1].step : 'none';
          
          if (storage.dropflow_last_fill_results) {
            console.log(`[${elapsed}s] Stage G: FORM FILL COMPLETE!`);
            console.log(JSON.stringify(storage.dropflow_last_fill_results).substring(0, 300));
            break;
          }
          
          if (storage.dropflow_builder_complete) {
            console.log(`[${elapsed}s] Stage E: Builder complete, log entries: ${varLog.length}, last: ${lastStep}`);
          } else if (varLog.length > 0) {
            console.log(`[${elapsed}s] Stage E: Variation builder, ${varLog.length} entries, last: ${lastStep}`);
          } else {
            console.log(`[${elapsed}s] Stage C: Form filling, eBay URL: ${ebay.url().substring(0, 80)}`);
          }
        }
      }
      
      if (!ali && !ebay) {
        console.log(`[${elapsed}s] No Ali or eBay tabs - checking if complete...`);
        const freshExt = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
        if (freshExt) {
          const fill = await freshExt.evaluate(() => new Promise(r => chrome.storage.local.get('dropflow_last_fill_results', r)));
          if (fill.dropflow_last_fill_results) {
            console.log(`[${elapsed}s] COMPLETE!`, JSON.stringify(fill.dropflow_last_fill_results).substring(0, 300));
            break;
          }
        }
        // May be between stages
      }
    } catch(e) {
      console.log(`[${elapsed}s] Poll error:`, e.message?.substring(0, 80));
    }
  }

  // Final screenshot
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  if (ebay) {
    await ebay.screenshot({ path: 'ebay-final-result.png', fullPage: true });
    console.log('Final screenshot saved');
  }

  console.log('Monitoring ended');
  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
