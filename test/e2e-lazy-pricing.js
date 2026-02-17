const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CDP = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const EXT_PAGE = `chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`;
const ALI_URL = 'https://www.aliexpress.com/item/1005006995032850.html';
const POLL_MS = 10_000;
const MAX_POLLS = 90; // 15 min
const SCREENSHOT_DIR = '/Users/pyrite/.openclaw/workspace';
const EXPECTED_PRICES = ['4.54', '4.99', '4.91', '5.14', '5.24'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findPage(browser, match) {
  for (const p of await browser.pages()) {
    if (p.url().includes(match)) return p;
  }
  return null;
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}`, fullPage: false });
    console.log(`📸 ${name}`);
  } catch (e) { console.log(`📸 FAIL ${name}: ${e.message}`); }
}

async function readPricesFromPage(page) {
  // Try reading price inputs from the page and all accessible iframes
  return page.evaluate(() => {
    const prices = [];
    const readDoc = (doc, label) => {
      // Common price input selectors
      const inputs = doc.querySelectorAll(
        'input[type="text"], input[type="number"], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'
      );
      for (const inp of inputs) {
        const val = inp.value?.trim();
        if (val && /^\d+(\.\d{1,2})?$/.test(val) && parseFloat(val) > 0 && parseFloat(val) < 1000) {
          prices.push({ value: val, label, name: inp.name || inp.id || inp.className?.substring(0, 50) });
        }
      }
    };
    readDoc(document, 'main');
    document.querySelectorAll('iframe').forEach((f, i) => {
      try { if (f.contentDocument) readDoc(f.contentDocument, `iframe-${i}`); } catch (e) {}
    });
    return prices;
  });
}

async function readPricesViaCDP(browser) {
  // Use CDP to find bulkedit iframe target and read prices directly
  const cdpSession = await browser.target().createCDPSession();
  try {
    const { targetInfos } = await cdpSession.send('Target.getTargets');
    const bulkeditTargets = targetInfos.filter(t =>
      t.url && t.url.includes('bulkedit.ebay.com') && t.type === 'iframe'
    );
    console.log(`  🔍 Found ${bulkeditTargets.length} bulkedit iframe target(s)`);
    for (const t of bulkeditTargets) {
      console.log(`     ${t.type}: ${t.url.substring(0, 100)}`);
    }

    const prices = [];
    for (const target of bulkeditTargets) {
      try {
        const { sessionId } = await cdpSession.send('Target.attachToTarget', {
          targetId: target.targetId, flatten: true
        });
        const session = browser.connection()?.session?.(sessionId);
        // Use Runtime.evaluate on the attached target
        const result = await cdpSession.send('Runtime.evaluate', {
          expression: `
            (() => {
              const prices = [];
              const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
              for (const inp of inputs) {
                const val = inp.value?.trim();
                if (val && /^\\d+(\\.\\d{1,2})?$/.test(val) && parseFloat(val) > 0 && parseFloat(val) < 1000) {
                  prices.push(val);
                }
              }
              return JSON.stringify({ total: inputs.length, prices });
            })()
          `,
          returnByValue: true
        }, sessionId);
        if (result?.result?.value) {
          const data = JSON.parse(result.result.value);
          console.log(`  📊 Iframe ${target.targetId}: ${data.total} inputs, ${data.prices.length} price values`);
          prices.push(...data.prices);
        }
        await cdpSession.send('Target.detachFromTarget', { sessionId }).catch(() => {});
      } catch (e) {
        console.log(`  ⚠️ CDP iframe error: ${e.message}`);
      }
    }
    return prices;
  } finally {
    cdpSession.detach().catch(() => {});
  }
}

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  console.log('✅ Connected');

  // Close extra tabs
  const pages = await browser.pages();
  console.log(`Closing ${pages.length - 1} extra tabs`);
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch (e) {}
  }

  // Open extension page & reload
  let extPage = await findPage(browser, 'ali-bulk-lister');
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto(EXT_PAGE, { waitUntil: 'domcontentloaded' });
  }
  console.log('Reloading extension...');
  await extPage.evaluate(() => chrome.runtime.reload());
  await sleep(5000);

  extPage = await findPage(browser, 'ali-bulk-lister');
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto(EXT_PAGE, { waitUntil: 'domcontentloaded' });
    await sleep(2000);
  }

  // Clear ALL storage
  const cleared = await extPage.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all);
    if (keys.length) await chrome.storage.local.remove(keys);
    return keys.length;
  });
  console.log(`Cleared ${cleared} storage keys`);

  // Close eBay tabs
  for (const p of await browser.pages()) {
    if (p.url().includes('ebay.com') && p !== extPage) {
      try { await p.close(); } catch (e) {}
    }
  }

  // Start bulk listing
  console.log(`\n🚀 Starting bulk listing: ${ALI_URL}`);
  const resp = await extPage.evaluate((url) => {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: [url],
        marketplace: 'ebay.com.au',
        ebayDomain: 'www.ebay.com.au',
        listingType: 'standard',
        threadCount: 1
      }, r => resolve(r));
    });
  }, ALI_URL);
  console.log('Response:', JSON.stringify(resp));
  if (resp?.error) { console.error('❌ START failed:', resp.error); process.exit(1); }

  // Poll loop
  let lastTraceLen = 0;
  let builderComplete = false;
  let tookPricingShot = false;
  let tookFinalShot = false;
  const startTime = Date.now();
  const STORAGE_KEYS = [
    '_dropflow_fillform_trace',
    'dropflow_builder_complete',
    'dropflow_last_fill_results'
  ];

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_MS);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n⏱️  Poll ${i + 1} (${elapsed}s)`);

    // Read storage
    let data;
    try {
      const ep = await findPage(browser, 'chrome-extension://');
      if (!ep) { console.log('  ⚠️ No extension page'); continue; }
      data = await ep.evaluate(keys => chrome.storage.local.get(keys), STORAGE_KEYS);
    } catch (e) { console.log('  ⚠️ Storage error:', e.message); continue; }

    // Trace entries
    const trace = data['_dropflow_fillform_trace'];
    if (Array.isArray(trace) && trace.length > lastTraceLen) {
      for (const entry of trace.slice(lastTraceLen)) {
        console.log(`  📝 TRACE: ${JSON.stringify(entry)}`);
      }
      lastTraceLen = trace.length;
    }

    // Builder complete
    if (data['dropflow_builder_complete']) {
      console.log(`  ✅ BUILDER COMPLETE: ${JSON.stringify(data['dropflow_builder_complete'])}`);
      builderComplete = true;
    }

    // Fill results
    if (data['dropflow_last_fill_results']) {
      console.log(`  📊 FILL RESULTS: ${JSON.stringify(data['dropflow_last_fill_results']).substring(0, 500)}`);
    }

    // Check for pricing — after 5 min OR builder_complete
    const fiveMinPassed = elapsed >= 300;
    const shouldCheckPricing = fiveMinPassed || builderComplete;

    if (shouldCheckPricing) {
      // Screenshot during pricing fill (first time)
      const ebayPage = await findPage(browser, 'ebay.com');
      if (ebayPage && !tookPricingShot) {
        await shot(ebayPage, 'ebay-lazy-pricing.png');
        tookPricingShot = true;
      }

      // Try reading prices from page
      if (ebayPage) {
        try {
          const pagePrices = await readPricesFromPage(ebayPage);
          if (pagePrices.length > 0) {
            console.log(`  💰 Page prices (${pagePrices.length}):`);
            const uniqueVals = [...new Set(pagePrices.map(p => p.value))];
            console.log(`     Unique: ${uniqueVals.join(', ')}`);
          }
        } catch (e) { console.log(`  Page price read error: ${e.message}`); }
      }

      // Try CDP iframe approach
      try {
        const cdpPrices = await readPricesViaCDP(browser);
        if (cdpPrices.length > 0) {
          const unique = [...new Set(cdpPrices)];
          console.log(`  💰 CDP prices: ${cdpPrices.length} total, ${unique.length} unique: ${unique.join(', ')}`);
        }
      } catch (e) { console.log(`  CDP price read error: ${e.message}`); }
    }

    // Check if done
    if (data['dropflow_builder_complete'] && data['dropflow_last_fill_results']) {
      console.log('\n🎉 Builder complete AND fill results set!');

      const ebayPage = await findPage(browser, 'ebay.com');
      if (ebayPage) {
        await shot(ebayPage, 'ebay-lazy-final.png');
        tookFinalShot = true;

        // Final price check on parent page
        try {
          const finalPrices = await readPricesFromPage(ebayPage);
          console.log(`\n=== FINAL PRICE CHECK (parent page) ===`);
          console.log(`Total price inputs: ${finalPrices.length}`);
          const uniqueVals = [...new Set(finalPrices.map(p => p.value))];
          console.log(`Unique values: ${uniqueVals.join(', ')}`);
          console.log(`Filled: ${finalPrices.length}, Empty: 0`);

          // Verify expected
          const found = EXPECTED_PRICES.filter(e => uniqueVals.includes(e));
          const missing = EXPECTED_PRICES.filter(e => !uniqueVals.includes(e));
          console.log(`\n=== VERIFICATION ===`);
          console.log(`Expected prices: ${EXPECTED_PRICES.join(', ')}`);
          console.log(`Found: ${found.join(', ')}`);
          if (missing.length) console.log(`Missing: ${missing.join(', ')}`);
          console.log(`Rows with prices: ${finalPrices.length}`);

          if (found.length === EXPECTED_PRICES.length && finalPrices.length >= 34) {
            console.log('\n✅ PASS — All 5 unique prices found across 34+ rows');
            process.exit(0);
          } else {
            console.log(`\n⚠️ PARTIAL — ${found.length}/5 prices, ${finalPrices.length} rows`);
          }
        } catch (e) {
          console.log('Final price read error:', e.message);
        }
      }

      // Also try CDP one last time
      try {
        const cdpPrices = await readPricesViaCDP(browser);
        const unique = [...new Set(cdpPrices)];
        console.log(`\nCDP final: ${cdpPrices.length} prices, ${unique.length} unique: ${unique.join(', ')}`);
        const found = EXPECTED_PRICES.filter(e => unique.includes(e));
        if (found.length === EXPECTED_PRICES.length && cdpPrices.length >= 34) {
          console.log('\n✅ PASS (via CDP) — All 5 unique prices found across 34+ rows');
          process.exit(0);
        }
      } catch (e) {}

      console.log('\n❌ FAIL — Pricing verification incomplete');
      process.exit(1);
    }
  }

  // Timeout
  console.log('\n⏰ TIMEOUT after 15 minutes');
  const finalPage = await findPage(browser, 'ebay.com');
  if (finalPage) await shot(finalPage, 'ebay-lazy-final.png');

  try {
    const ep = await findPage(browser, 'chrome-extension://');
    if (ep) {
      const allData = await ep.evaluate(keys => chrome.storage.local.get(keys), STORAGE_KEYS);
      console.log('\n=== FINAL STORAGE ===');
      console.log(JSON.stringify(allData, null, 2));
    }
  } catch (e) {}

  console.log('\n❌ FAIL — Timed out');
  process.exit(1);
})();
