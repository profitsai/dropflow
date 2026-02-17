const puppeteer = require('puppeteer-core');

const WS_URL = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const TEST_PRODUCT = 'https://www.aliexpress.com/item/1005006995032850.html';
const SCREENSHOT_PATH = '/Users/pyrite/.openclaw/workspace/ebay-e2e-result.png';
const POLL_INTERVAL = 10000;
const MAX_WAIT = 10 * 60 * 1000;

async function getSW(browser) {
  const target = await browser.waitForTarget(
    t => t.url().includes(EXT_ID) && t.type() === 'service_worker',
    { timeout: 15000 }
  );
  return await target.worker();
}

(async () => {
  console.log('[E2E] Connecting to browser...');
  const browser = await puppeteer.connect({ browserWSEndpoint: WS_URL, defaultViewport: null });
  
  // Close extra tabs
  const pages = await browser.pages();
  console.log(`[E2E] Found ${pages.length} tabs`);
  for (const p of pages) {
    const url = p.url();
    if (url.includes('ebay.com') || url.includes('aliexpress.com') || url.includes('ali-bulk-lister')) {
      console.log('[E2E] Closing:', url.substring(0, 80));
      await p.close().catch(() => {});
    }
  }

  // Get SW and clear storage
  let sw = await getSW(browser);
  console.log('[E2E] Clearing storage...');
  await sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(all).filter(k =>
      k.startsWith('pendingListing') || k.startsWith('dropflow_') || k.startsWith('_dropflow') ||
      k === 'aliBulkRunning' || k.startsWith('orchestration') || k.startsWith('__dfBuilder')
    );
    if (keysToRemove.length) await chrome.storage.local.remove(keysToRemove);
    return keysToRemove.length;
  });

  // Open bulk lister page
  console.log('[E2E] Opening bulk lister page...');
  const bulkPage = await browser.newPage();
  await bulkPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  // Monitor new targets
  browser.on('targetcreated', async (target) => {
    const url = target.url();
    if (url && !url.startsWith('about:')) {
      console.log(`[TARGET] ${target.type()}: ${url.substring(0, 100)}`);
    }
    if (target.type() === 'page') {
      try {
        const page = await target.page();
        if (page) {
          page.on('console', (msg) => {
            const text = msg.text();
            if (text.includes('DropFlow') || text.includes('[DropFlow') || text.includes('fillForm') || text.includes('variation')) {
              console.log(`[PAGE] ${text.substring(0, 300)}`);
            }
          });
        }
      } catch(e) {}
    }
  });

  // Send message from bulk lister page (extension context)
  console.log('[E2E] Starting bulk listing...');
  const startResult = await bulkPage.evaluate((product) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: [product],
        marketplace: 'ebay.com.au',
        ebayDomain: 'www.ebay.com.au',
        listingType: 'standard'
      }, (resp) => {
        resolve(resp || 'no-response');
      });
      setTimeout(() => resolve('timeout'), 5000);
    });
  }, TEST_PRODUCT);
  console.log('[E2E] Start result:', JSON.stringify(startResult));

  // Poll for results via SW
  const startTime = Date.now();
  let lastTraceLen = 0;
  let done = false;

  while (Date.now() - startTime < MAX_WAIT && !done) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

    try {
      const data = await Promise.race([
        sw.evaluate(async () => {
          return await chrome.storage.local.get([
            '_dropflow_fillform_trace',
            'dropflow_builder_complete',
            'dropflow_last_fill_results',
            '_dropflow_orchestration'
          ]);
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('poll timeout')), 8000))
      ]);

      const trace = data._dropflow_fillform_trace || [];
      if (trace.length > lastTraceLen) {
        for (let i = lastTraceLen; i < trace.length; i++) {
          console.log(`[E2E +${elapsed}s] TRACE: ${JSON.stringify(trace[i])}`);
        }
        lastTraceLen = trace.length;
      } else {
        const orch = data._dropflow_orchestration;
        const orchInfo = orch ? JSON.stringify(orch).substring(0, 200) : 'none';
        console.log(`[E2E +${elapsed}s] Polling... (${trace.length} traces, orch: ${orchInfo})`);
      }

      if (data.dropflow_builder_complete) {
        console.log(`[E2E +${elapsed}s] Builder complete:`, JSON.stringify(data.dropflow_builder_complete));
      }

      if (data.dropflow_last_fill_results) {
        console.log(`[E2E +${elapsed}s] Fill results:`, JSON.stringify(data.dropflow_last_fill_results));
        done = true;
      }

      if (trace.some(t => t.step === 'fillForm_complete' || t.step === 'complete')) {
        // Wait one more poll to get fill results
        if (data.dropflow_last_fill_results) done = true;
        else {
          console.log(`[E2E +${elapsed}s] fillForm complete detected, waiting for results...`);
          await new Promise(r => setTimeout(r, 5000));
          done = true;
        }
      }
    } catch (e) {
      console.log(`[E2E +${elapsed}s] Poll error: ${e.message}`);
      try { sw = await getSW(browser); } catch (_) {}
    }
  }

  // Take screenshot
  console.log('[E2E] Taking screenshot...');
  try {
    const allPages = await browser.pages();
    // Find eBay page for screenshot
    let screenshotPage = allPages.find(p => p.url().includes('ebay.com')) || allPages[allPages.length - 1];
    await screenshotPage.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    console.log(`[E2E] Screenshot saved`);
  } catch (e) {
    console.log(`[E2E] Screenshot error: ${e.message}`);
  }

  // Final dump
  try {
    const finalData = await Promise.race([
      sw.evaluate(async () => {
        return await chrome.storage.local.get(null);
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('final dump timeout')), 8000))
    ]);
    
    const relevant = {};
    for (const [k, v] of Object.entries(finalData)) {
      if (k.startsWith('_dropflow') || k.startsWith('dropflow_') || k.startsWith('orchestration') || k.startsWith('pendingListing')) {
        relevant[k] = v;
      }
    }
    console.log('\n[E2E] === FINAL RESULTS ===');
    console.log(JSON.stringify(relevant, null, 2));
  } catch (e) {
    console.log(`[E2E] Final dump error: ${e.message}`);
  }

  console.log('[E2E] Done');
  browser.disconnect();
  process.exit(0);
})().catch(e => {
  console.error('[E2E] Fatal:', e);
  process.exit(1);
});
