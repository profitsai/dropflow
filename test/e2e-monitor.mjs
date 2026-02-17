import puppeteer from 'puppeteer-core';

const CDP = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const SCREENSHOT = '/Users/pyrite/.openclaw/workspace/ebay-e2e-final.png';
const MAX_WAIT = 14 * 60 * 1000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getExtPage(browser) {
  const pages = await browser.pages();
  // Use the FIRST extension page found
  return pages.find(p => p.url().includes(`chrome-extension://${EXT_ID}`));
}

async function getStorage(ext) {
  return ext.evaluate(() => new Promise(r => chrome.storage.local.get(null, items => {
    const result = {};
    for (const [k, v] of Object.entries(items)) {
      if (k.startsWith('dropflow_') || k.startsWith('_dropflow_') || k.startsWith('__dfBuilder')) {
        result[k] = v;
      }
    }
    r(result);
  })));
}

async function run() {
  console.log('Connecting...');
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });

  browser.on('targetcreated', t => { if (t.type() === 'page') console.log(`  [+TAB] ${t.url()?.substring(0, 100)}`); });
  browser.on('targetdestroyed', t => { if (t.type() === 'page') console.log(`  [-TAB] ${t.url()?.substring(0, 100)}`); });

  const start = Date.now();
  let lastTraceCount = 0;
  let builderReported = false;
  let fillResultsReported = false;

  while (Date.now() - start < MAX_WAIT) {
    await sleep(10000);
    const elapsed = Math.round((Date.now() - start) / 1000);

    try {
      const ext = await getExtPage(browser);
      if (!ext) { console.log(`[${elapsed}s] No extension page`); continue; }

      const storage = await getStorage(ext);

      // Trace
      const trace = storage._dropflow_fillform_trace || [];
      if (trace.length > lastTraceCount) {
        for (let i = lastTraceCount; i < trace.length; i++) {
          const entry = trace[i];
          console.log(`[${elapsed}s] TRACE[${i}]: ${typeof entry === 'string' ? entry : JSON.stringify(entry).substring(0, 250)}`);
        }
        lastTraceCount = trace.length;
      }

      // Builder complete
      if (storage.dropflow_builder_complete && !builderReported) {
        console.log(`[${elapsed}s] ✅ BUILDER COMPLETE: ${JSON.stringify(storage.dropflow_builder_complete).substring(0, 300)}`);
        builderReported = true;
      }

      // Fill results
      if (storage.dropflow_last_fill_results && !fillResultsReported) {
        console.log(`[${elapsed}s] ✅ FILL RESULTS: ${JSON.stringify(storage.dropflow_last_fill_results).substring(0, 500)}`);
        fillResultsReported = true;
      }

      if (fillResultsReported) {
        console.log(`[${elapsed}s] Flow complete!`);
        break;
      }

      // Status
      const pages = await browser.pages();
      const ebay = pages.find(p => p.url().includes('ebay.com.au'));
      const varLog = storage.dropflow_variation_log || [];
      console.log(`[${elapsed}s] trace:${trace.length} varLog:${varLog.length} builder:${!!storage.dropflow_builder_complete} fill:${!!storage.dropflow_last_fill_results} ebay:${ebay ? 'yes' : 'no'}`);

    } catch (e) {
      console.log(`[${elapsed}s] Error: ${e.message?.substring(0, 100)}`);
    }
  }

  // Final screenshot
  try {
    const pages = await browser.pages();
    const ebay = pages.find(p => p.url().includes('ebay.com.au'));
    if (ebay) {
      await ebay.bringToFront();
      await sleep(500);
      await ebay.screenshot({ path: SCREENSHOT });
      console.log(`Screenshot: ${SCREENSHOT}`);
      // Scroll to variations
      await ebay.evaluate(() => {
        const el = document.querySelector('[class*="variation"], [class*="msku"], .vim-variation');
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
      });
      await sleep(500);
      await ebay.screenshot({ path: SCREENSHOT.replace('.png', '-pricing.png') });
    }
  } catch (e) { console.log('Screenshot error:', e.message); }

  // Final storage dump
  try {
    const ext = await getExtPage(browser);
    if (ext) {
      const storage = await getStorage(ext);
      console.log('\nFinal storage keys:', Object.keys(storage).join(', '));
      if (storage.dropflow_last_fill_results) {
        console.log('Fill results:', JSON.stringify(storage.dropflow_last_fill_results).substring(0, 1000));
      }
    }
  } catch(e) {}

  console.log(`\n=== Done in ${Math.round((Date.now() - start) / 1000)}s | builder:${builderReported} fill:${fillResultsReported} ===`);
  browser.disconnect();
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
