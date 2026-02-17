import puppeteer from 'puppeteer-core';

const CDP = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const ALI_LINK = 'https://www.aliexpress.com/item/1005006995032850.html';
const SCREENSHOT = '/Users/pyrite/.openclaw/workspace/ebay-e2e-final.png';
const MAX_WAIT = 15 * 60 * 1000; // 15 minutes

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log('Connecting to browser...');
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  const allPages = await browser.pages();
  console.log(`Connected. ${allPages.length} tabs open.`);

  // Close extra tabs (keep first)
  for (let i = 1; i < allPages.length; i++) {
    const url = allPages[i].url();
    if (!url.includes('ali-bulk-lister') && url !== 'about:blank' && !url.startsWith('chrome://')) {
      console.log(`Closing: ${url.substring(0, 80)}`);
      await allPages[i].close().catch(() => {});
    }
  }

  // Reload extension SW to reset in-memory state (aliBulkRunning)
  console.log('Reloading extension service worker...');
  // Use fetch to the CDP HTTP endpoint to find and close the SW target
  const http = await import('http');
  try {
    const targetsJson = await new Promise((resolve, reject) => {
      http.default.get('http://127.0.0.1:57542/json', res => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
      }).on('error', reject);
    });
    const targets = JSON.parse(targetsJson);
    const sw = targets.find(t => t.type === 'service_worker' && t.url.includes(EXT_ID));
    if (sw) {
      console.log(`Found SW: ${sw.id}, closing...`);
      await new Promise((resolve, reject) => {
        http.default.get(`http://127.0.0.1:57542/json/close/${sw.id}`, res => {
          let d = ''; res.on('data', c => d += c); res.on('end', () => { console.log('Close result:', d); resolve(); });
        }).on('error', reject);
      });
      await sleep(2000);
    } else {
      console.log('No SW target found');
    }
  } catch(e) { console.log('SW termination error:', e.message?.substring(0, 100)); }

  // Open extension page (this will wake up the SW fresh)
  let ext = await browser.newPage();
  await ext.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  // Clear storage
  const cleared = await ext.evaluate(() => new Promise(r => chrome.storage.local.get(null, items => {
    const keys = Object.keys(items).filter(k =>
      k.startsWith('dropflow_') || k.startsWith('aliBulk') || k.startsWith('pendingListing_') || k.startsWith('__dfBuilder') || k.startsWith('_dropflow_') || k === 'ali_bulk_running'
    );
    chrome.storage.local.remove(keys, () => r(keys.length));
  })));
  console.log(`Cleared ${cleared} storage keys`);

  // Close any existing eBay listing tabs
  for (const p of await browser.pages()) {
    if (p.url().includes('ebay.com.au/lstng') || p.url().includes('ebay.com.au/sl/')) {
      await p.close().catch(() => {});
    }
  }

  // Trigger listing
  console.log(`\nTriggering bulk listing for: ${ALI_LINK}`);
  const resp = await ext.evaluate((link) => new Promise(resolve => {
    chrome.runtime.sendMessage({
      type: 'START_ALI_BULK_LISTING',
      links: [link],
      marketplace: 'ebay.com.au',
      ebayDomain: 'www.ebay.com.au',
      listingType: 'standard',
      threadCount: 1
    }, r => resolve(r));
  }), ALI_LINK);
  console.log('Trigger response:', JSON.stringify(resp));

  if (!resp?.success) {
    console.log('FAILED to trigger. Aborting.');
    browser.disconnect();
    process.exit(1);
  }

  // Track new pages
  browser.on('targetcreated', t => { if (t.type() === 'page') console.log(`  [+TAB] ${t.url()?.substring(0, 100)}`); });
  browser.on('targetdestroyed', t => { if (t.type() === 'page') console.log(`  [-TAB] ${t.url()?.substring(0, 100)}`); });

  // Poll loop
  const start = Date.now();
  let lastTraceCount = 0;
  let builderReported = false;
  let fillResultsReported = false;

  while (Date.now() - start < MAX_WAIT) {
    await sleep(10000);
    const elapsed = Math.round((Date.now() - start) / 1000);

    try {
      // Get fresh ext page
      const freshExt = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
      if (!freshExt) {
        console.log(`[${elapsed}s] Extension page gone!`);
        continue;
      }

      const storage = await freshExt.evaluate(() => new Promise(r => chrome.storage.local.get(null, items => {
        const result = {};
        for (const [k, v] of Object.entries(items)) {
          if (k.startsWith('dropflow_') || k.startsWith('_dropflow_') || k.startsWith('__dfBuilder')) {
            result[k] = v;
          }
        }
        r(result);
      })));

      // Check trace
      const trace = storage._dropflow_fillform_trace || [];
      if (trace.length > lastTraceCount) {
        for (let i = lastTraceCount; i < trace.length; i++) {
          const entry = trace[i];
          console.log(`[${elapsed}s] TRACE[${i}]: ${typeof entry === 'string' ? entry : JSON.stringify(entry).substring(0, 200)}`);
        }
        lastTraceCount = trace.length;
      }

      // Check builder complete
      if (storage.dropflow_builder_complete && !builderReported) {
        console.log(`[${elapsed}s] ✅ BUILDER COMPLETE: ${JSON.stringify(storage.dropflow_builder_complete).substring(0, 300)}`);
        builderReported = true;
      }

      // Check fill results
      if (storage.dropflow_last_fill_results && !fillResultsReported) {
        console.log(`[${elapsed}s] ✅ FILL RESULTS: ${JSON.stringify(storage.dropflow_last_fill_results).substring(0, 500)}`);
        fillResultsReported = true;
      }

      // If fill results found, we're done
      if (fillResultsReported) {
        console.log(`[${elapsed}s] Flow complete! Taking final screenshot...`);
        break;
      }

      // Status line
      const pages = await browser.pages();
      const ali = pages.find(p => p.url().includes('aliexpress.com/item'));
      const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng') || p.url().includes('ebay.com.au/sl/'));
      const varLog = storage.dropflow_variation_log || [];
      const status = ali ? 'scraping' : ebay ? 'eBay form' : 'waiting';
      console.log(`[${elapsed}s] ${status} | trace:${trace.length} varLog:${varLog.length} builder:${!!storage.dropflow_builder_complete} fill:${!!storage.dropflow_last_fill_results}`);

    } catch (e) {
      console.log(`[${elapsed}s] Error: ${e.message?.substring(0, 100)}`);
    }
  }

  // Final screenshot
  try {
    const pages = await browser.pages();
    const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng') || p.url().includes('ebay.com.au/sl/'));
    if (ebay) {
      await ebay.bringToFront();
      await sleep(1000);
      await ebay.screenshot({ path: SCREENSHOT, fullPage: false });
      console.log(`Screenshot saved to ${SCREENSHOT}`);
      
      // Also try scrolling to variations/pricing section
      await ebay.evaluate(() => {
        const el = document.querySelector('[data-testid="variations"], .msku, .vim-variation');
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
      });
      await sleep(500);
      await ebay.screenshot({ path: SCREENSHOT.replace('.png', '-pricing.png') });
      console.log('Pricing section screenshot saved');
    } else {
      console.log('No eBay tab found for screenshot');
    }
  } catch (e) {
    console.log('Screenshot error:', e.message);
  }

  // Final storage dump
  try {
    const freshExt = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
    if (freshExt) {
      const allKeys = await freshExt.evaluate(() => new Promise(r => chrome.storage.local.get(null, items => {
        r(Object.keys(items).filter(k => k.startsWith('dropflow_') || k.startsWith('_dropflow_')));
      })));
      console.log('\nFinal storage keys:', allKeys.join(', '));
    }
  } catch (e) {}

  const totalTime = Math.round((Date.now() - start) / 1000);
  console.log(`\n=== E2E test completed in ${totalTime}s ===`);
  console.log(`Builder complete: ${builderReported}`);
  console.log(`Fill results: ${fillResultsReported}`);

  browser.disconnect();
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
