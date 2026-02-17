const puppeteer = require('puppeteer-core');

const WS_URL = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const TEST_PRODUCT = 'https://www.aliexpress.com/item/1005006995032850.html';
const POLL_INTERVAL = 10000;
const MAX_WAIT = 15 * 60 * 1000;
const EXPECTED_PRICES = ['4.54', '4.99', '4.91', '5.14', '5.24'];

const SS_BUILDER = '/Users/pyrite/.openclaw/workspace/ebay-verify-builder.png';
const SS_FINAL = '/Users/pyrite/.openclaw/workspace/ebay-verify-final.png';

async function getSW(browser) {
  const targets = browser.targets();
  const swTarget = targets.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  if (swTarget) return await swTarget.worker();
  const target = await browser.waitForTarget(
    t => t.url().includes(EXT_ID) && t.type() === 'service_worker',
    { timeout: 30000 }
  );
  return await target.worker();
}

async function getEbayPage(browser) {
  const pages = await browser.pages();
  return pages.find(p => p.url().includes('ebay.com'));
}

async function readPricingTable(page) {
  return await page.evaluate(() => {
    const results = { rows: 0, prices: [], visiblePrices: [] };
    const selectors = [
      'input[aria-label*="rice"]', 'input[name*="rice"]', 'input[name*="price"]',
      '.price-input input', 'table input[type="text"]', 'table input[type="number"]',
      '[data-test-id*="price"] input', 'input.textbox[aria-label*="Price"]',
    ];
    for (const sel of selectors) {
      const inputs = document.querySelectorAll(sel);
      if (inputs.length > 0) {
        results.rows = inputs.length;
        results.prices = Array.from(inputs).map(i => i.value);
        results.selector = sel;
        break;
      }
    }
    if (results.rows === 0) {
      const allInputs = document.querySelectorAll('table input');
      const priceInputs = Array.from(allInputs).filter(i => {
        const v = parseFloat(i.value); return !isNaN(v) && v > 0 && v < 100;
      });
      if (priceInputs.length > 0) {
        results.rows = priceInputs.length;
        results.prices = priceInputs.map(i => i.value);
        results.selector = 'table input (filtered)';
      }
    }
    const allText = document.body.innerText;
    const priceMatches = allText.match(/\$\d+\.\d{2}/g);
    results.visiblePrices = priceMatches ? [...new Set(priceMatches)].slice(0, 30) : [];
    return results;
  });
}

(async () => {
  console.log('[E2E-VERIFY] Connecting...');
  const browser = await puppeteer.connect({ browserWSEndpoint: WS_URL, defaultViewport: null });

  // List all targets
  const allTargets = browser.targets();
  console.log('[E2E-VERIFY] All targets:');
  for (const t of allTargets) {
    console.log(`  ${t.type()}: ${t.url().substring(0, 100)}`);
  }

  // Close ebay/aliexpress pages  
  const pages = await browser.pages();
  console.log(`[E2E-VERIFY] ${pages.length} pages`);
  for (const p of pages) {
    const url = p.url();
    if (url.includes('ebay.com') || url.includes('aliexpress.com')) {
      console.log('[E2E-VERIFY] Closing:', url.substring(0, 80));
      await p.close().catch(() => {});
    }
  }

  // Find extension page target
  let bulkTarget = allTargets.find(t => t.url().includes('ali-bulk-lister'));
  let bulkPage;
  if (bulkTarget) {
    console.log('[E2E-VERIFY] Found existing bulk lister target');
    bulkPage = await bulkTarget.page();
    if (bulkPage) {
      await bulkPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  if (!bulkPage) {
    // Try CDP directly to create a tab at the extension URL
    console.log('[E2E-VERIFY] Creating extension page via CDP...');
    const cdpSession = await browser.target().createCDPSession();
    await cdpSession.send('Target.createTarget', {
      url: `chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`
    });
    await new Promise(r => setTimeout(r, 3000));
    
    // Now find it
    const pgs = await browser.pages();
    bulkPage = pgs.find(p => p.url().includes('ali-bulk-lister'));
    if (!bulkPage) {
      console.log('[E2E-VERIFY] Still no bulk page. Listing pages:');
      for (const p of pgs) console.log('  ', p.url().substring(0, 100));
    }
  }

  // Get SW
  let sw;
  try {
    sw = await getSW(browser);
    console.log('[E2E-VERIFY] SW found');
  } catch (e) {
    console.log('[E2E-VERIFY] No SW found:', e.message);
    console.log('[E2E-VERIFY] ❌ FAIL — Extension service worker not available');
    browser.disconnect();
    process.exit(1);
  }

  // Clear ALL storage
  console.log('[E2E-VERIFY] Clearing ALL storage...');
  const cleared = await sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const count = Object.keys(all).length;
    await chrome.storage.local.clear();
    return count;
  });
  console.log(`[E2E-VERIFY] Cleared ${cleared} keys`);

  if (bulkPage) {
    await bulkPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  }

  // Monitor new pages
  let builderScreenshotTaken = false;
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      try {
        const page = await target.page();
        if (page) {
          page.on('console', (msg) => {
            const text = msg.text();
            if (text.includes('DropFlow') || text.includes('fillForm') || text.includes('variation') || text.includes('pricing') || text.includes('builder')) {
              console.log(`[PAGE] ${text.substring(0, 400)}`);
            }
          });
        }
      } catch(e) {}
    }
  });

  // Start bulk listing - try via SW if no bulk page
  console.log('[E2E-VERIFY] Starting bulk listing...');
  let startResult;
  if (bulkPage) {
    startResult = await bulkPage.evaluate((product) => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'START_ALI_BULK_LISTING',
          links: [product],
          marketplace: 'ebay.com.au',
          ebayDomain: 'www.ebay.com.au',
          listingType: 'standard'
        }, (resp) => resolve(resp || 'no-response'));
        setTimeout(() => resolve('timeout'), 5000);
      });
    }, TEST_PRODUCT);
  } else {
    // Send directly via SW
    console.log('[E2E-VERIFY] No bulk page, sending via SW...');
    startResult = await sw.evaluate(async (product) => {
      // Simulate the message handler directly
      const handler = chrome.runtime.onMessage._listeners?.[0];
      if (!handler) return 'no-handler';
      return new Promise((resolve) => {
        handler(
          { type: 'START_ALI_BULK_LISTING', links: [product], marketplace: 'ebay.com.au', ebayDomain: 'www.ebay.com.au', listingType: 'standard' },
          { tab: {} },
          (resp) => resolve(resp || 'no-response')
        );
        setTimeout(() => resolve('timeout'), 5000);
      });
    }, TEST_PRODUCT);
  }
  console.log('[E2E-VERIFY] Start result:', JSON.stringify(startResult));

  // Poll loop
  const startTime = Date.now();
  let lastTraceLen = 0;
  let done = false;
  let fillResults = null;

  while (Date.now() - startTime < MAX_WAIT && !done) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

    try {
      const data = await Promise.race([
        sw.evaluate(async () => chrome.storage.local.get([
          '_dropflow_fillform_trace',
          'dropflow_builder_complete',
          'dropflow_last_fill_results',
          '_dropflow_orchestration'
        ])),
        new Promise((_, rej) => setTimeout(() => rej(new Error('poll timeout')), 8000))
      ]);

      const trace = data._dropflow_fillform_trace || [];
      if (trace.length > lastTraceLen) {
        for (let i = lastTraceLen; i < trace.length; i++) {
          console.log(`[TRACE +${elapsed}s] ${JSON.stringify(trace[i])}`);
        }
        lastTraceLen = trace.length;
      } else {
        const orch = data._dropflow_orchestration;
        const orchStr = orch ? JSON.stringify(orch).substring(0, 150) : 'none';
        console.log(`[POLL +${elapsed}s] traces=${trace.length} orch=${orchStr}`);
      }

      if (data.dropflow_builder_complete && !builderScreenshotTaken) {
        console.log(`[+${elapsed}s] Builder complete!`);
        const ebayPage = await getEbayPage(browser);
        if (ebayPage) {
          await ebayPage.screenshot({ path: SS_BUILDER, fullPage: false });
          console.log(`[+${elapsed}s] Builder screenshot saved`);
          builderScreenshotTaken = true;
        }
      }

      if (data.dropflow_last_fill_results) {
        console.log(`[+${elapsed}s] FILL RESULTS:`, JSON.stringify(data.dropflow_last_fill_results).substring(0, 500));
        fillResults = data.dropflow_last_fill_results;
        done = true;
      }

      if (trace.some(t => t.step === 'fillForm_complete' || t.step === 'complete')) {
        if (!data.dropflow_last_fill_results) {
          await new Promise(r => setTimeout(r, 5000));
          const extra = await sw.evaluate(async () => chrome.storage.local.get(['dropflow_last_fill_results']));
          if (extra.dropflow_last_fill_results) fillResults = extra.dropflow_last_fill_results;
        }
        done = true;
      }
    } catch (e) {
      console.log(`[POLL +${elapsed}s] Error: ${e.message}`);
      try { sw = await getSW(browser); } catch (_) {}
    }
  }

  // === PRICING CHECK ===
  console.log('\n[E2E-VERIFY] === PRICING CHECK ===');
  const ebayPage = await getEbayPage(browser);
  if (ebayPage) {
    await ebayPage.screenshot({ path: SS_FINAL, fullPage: false });
    console.log('[E2E-VERIFY] Final screenshot saved');

    const pricingResult = await readPricingTable(ebayPage);
    console.log('[E2E-VERIFY] Pricing table:', JSON.stringify(pricingResult, null, 2));

    const foundPrices = pricingResult.prices.map(p => p.replace('$', '').trim());
    const matched = EXPECTED_PRICES.filter(ep => foundPrices.some(fp => fp === ep));
    console.log(`[E2E-VERIFY] Expected: ${EXPECTED_PRICES.join(', ')}`);
    console.log(`[E2E-VERIFY] Input prices: ${foundPrices.join(', ')}`);
    console.log(`[E2E-VERIFY] Matched: ${matched.length}/${EXPECTED_PRICES.length}`);

    const visMatched = EXPECTED_PRICES.filter(ep => pricingResult.visiblePrices.some(vp => vp.includes(ep)));
    console.log(`[E2E-VERIFY] Visible matches: ${visMatched.length}/${EXPECTED_PRICES.length} from ${pricingResult.visiblePrices.join(', ')}`);

    if (matched.length === EXPECTED_PRICES.length || visMatched.length === EXPECTED_PRICES.length) {
      console.log('[E2E-VERIFY] ✅ PASS — All 5 expected prices found');
    } else {
      console.log('[E2E-VERIFY] ❌ FAIL — Missing prices');
    }
  } else {
    console.log('[E2E-VERIFY] ❌ No eBay page found');
  }

  // Storage dump
  try {
    const finalData = await sw.evaluate(async () => chrome.storage.local.get(null));
    const relevant = {};
    for (const [k, v] of Object.entries(finalData)) {
      if (k.startsWith('_dropflow') || k.startsWith('dropflow_') || k.startsWith('pendingListing')) {
        relevant[k] = v;
      }
    }
    console.log('\n[E2E-VERIFY] === STORAGE ===');
    console.log(JSON.stringify(relevant, null, 2));
  } catch (e) {
    console.log('[E2E-VERIFY] Storage dump error:', e.message);
  }

  console.log('\n[E2E-VERIFY] Done.');
  browser.disconnect();
  process.exit(0);
})().catch(e => {
  console.error('[E2E-VERIFY] Fatal:', e);
  process.exit(1);
});
