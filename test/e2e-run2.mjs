import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  
  // Attach to SW via CDP for console logs
  const swTarget = browser.targets().find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  if (swTarget) {
    const cdp = await swTarget.createCDPSession();
    await cdp.send('Runtime.enable');
    cdp.on('Runtime.consoleAPICalled', (event) => {
      const text = event.args.map(a => a.value || a.description || '').join(' ');
      if (text.includes('DropFlow') || text.includes('Ali') || text.includes('bulk') || text.includes('error') || text.includes('Error')) {
        console.log(`[SW ${event.type}]`, text.substring(0, 200));
      }
    });
    cdp.on('Runtime.exceptionThrown', (event) => {
      console.log('[SW EXCEPTION]', event.exceptionDetails?.text, event.exceptionDetails?.exception?.description?.substring(0, 200));
    });
    console.log('Attached to SW console');
  }

  const extPage = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
  
  // Clear state
  await extPage.evaluate(() => chrome.storage.local.remove([
    'aliBulkRunning','aliBulkPaused','aliBulkAbort',
    'dropflow_last_fill_results','dropflow_variation_steps',
    'dropflow_variation_log','dropflow_variation_status',
    'dropflow_variation_check','dropflow_variation_flow_log',
    'dropflow_builder_complete','dropflow_variation_scripttag_diag',
    'dropflow_3dot_debug','dropflow_3dot_strategy','dropflow_variation_mainworld_diag'
  ]));

  // Close leftover eBay tabs
  for (const p of await browser.pages()) {
    if (p.url().includes('ebay.com.au/lstng')) await p.close().catch(() => {});
  }

  // Also listen for new pages
  browser.on('targetcreated', async (target) => {
    console.log('[NEW TARGET]', target.type(), target.url().substring(0, 100));
  });
  browser.on('targetdestroyed', async (target) => {
    console.log('[TARGET CLOSED]', target.type(), target.url().substring(0, 100));
  });

  console.log('Triggering...');
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

  // Monitor for 5 minutes
  const start = Date.now();
  while (Date.now() - start < 300000) {
    await sleep(10000);
    const elapsed = Math.round((Date.now() - start) / 1000);
    
    // Check storage
    const storage = await extPage.evaluate(() => new Promise(r => {
      chrome.storage.local.get(null, items => {
        const filtered = {};
        for (const [k, v] of Object.entries(items)) {
          if (k.startsWith('dropflow_') || k.startsWith('aliBulk') || k.startsWith('pending')) {
            filtered[k] = JSON.stringify(v).substring(0, 150);
          }
        }
        r(filtered);
      });
    }));
    
    const newKeys = Object.keys(storage).filter(k => !k.includes('iframe_test') && !k.includes('price_markup') && !k.includes('1373278444'));
    if (newKeys.length > 0) {
      console.log(`[${elapsed}s] Storage:`, JSON.stringify(Object.fromEntries(newKeys.map(k => [k, storage[k]]))));
    }

    // Check pages
    const pages = await browser.pages();
    const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
    if (ebay) {
      console.log(`[${elapsed}s] eBay tab found:`, ebay.url().substring(0, 100));
      try {
        const state = await ebay.evaluate(() => ({
          ff: window.__dropflow_form_filler_loaded,
          title: document.querySelector('input')?.value?.substring(0, 50)
        }));
        console.log(`[${elapsed}s] eBay state:`, JSON.stringify(state));
      } catch(e) {}
    }
  }

  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
