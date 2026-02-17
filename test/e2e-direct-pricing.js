const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CDP = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const EXT_PAGE = `chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`;
const ALI_URL = 'https://www.aliexpress.com/item/1005006995032850.html';
const POLL_INTERVAL = 10_000;
const MAX_POLLS = 72; // 12 min
const SS = '/Users/pyrite/.openclaw/workspace';
const EXPECTED_PRICES = ['4.54', '4.99', '4.91', '5.14', '5.24'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function findPage(browser, match) {
  for (const p of await browser.pages()) {
    if (p.url().includes(match)) return p;
  }
  return null;
}

async function screenshot(page, name) {
  try {
    await page.screenshot({ path: `${SS}/${name}`, fullPage: false });
    console.log(`📸 ${name}`);
  } catch (e) {
    console.log(`📸 FAIL ${name}: ${e.message}`);
  }
}

async function readPriceInputs(page) {
  try {
    return await page.evaluate(() => {
      const data = { filled: 0, empty: 0, values: [], raw: [] };
      const selectors = [
        'input[aria-label*="rice"]', 'input[aria-label*="Price"]',
        'input[name*="price"]', 'input[name*="Price"]',
        'input[id*="price"]', 'input[id*="Price"]',
        'input[data-testid*="price"]', 'input[placeholder*="rice"]',
        'input[placeholder*="$"]', 'input[placeholder*="amount"]',
        '.grid-container input[type="text"]', '.grid-container input[type="number"]',
        'table input[type="text"]', 'table input[type="number"]',
        '[class*="variation"] input', '[class*="combination"] input',
        '[class*="price"] input',
      ];
      const found = new Set();
      const docs = [document];
      for (const iframe of document.querySelectorAll('iframe')) {
        try { if (iframe.contentDocument) docs.push(iframe.contentDocument); } catch (e) {}
      }
      for (const doc of docs) {
        for (const sel of selectors) {
          for (const el of doc.querySelectorAll(sel)) found.add(el);
        }
        // Broad sweep for price-like values
        for (const input of doc.querySelectorAll('input')) {
          if (/^\d+\.\d{2}$/.test(input.value)) found.add(input);
        }
      }
      for (const el of found) {
        const v = el.value?.trim();
        data.raw.push({
          value: v, name: el.name || '', id: el.id || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          placeholder: el.placeholder || '',
        });
        if (v && v !== '0' && v !== '0.00') { data.filled++; data.values.push(v); }
        else { data.empty++; }
      }
      data.uniqueValues = [...new Set(data.values)].sort();

      // Also grab visible price text in variation sections
      const priceTexts = [];
      for (const doc of docs) {
        for (const el of doc.querySelectorAll('[class*="variation"], [class*="price"], [class*="grid"]')) {
          const txt = el.textContent;
          const matches = txt.match(/\$\d+\.\d{2}/g);
          if (matches) priceTexts.push(...matches);
        }
      }
      data.visiblePriceTexts = [...new Set(priceTexts)].sort();
      return data;
    });
  } catch (e) {
    console.log('⚠️ readPriceInputs error:', e.message);
    return null;
  }
}

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  console.log('✅ Connected');

  // Close extra tabs
  const allPages = await browser.pages();
  console.log(`Found ${allPages.length} tabs`);
  for (let i = 1; i < allPages.length; i++) {
    try { await allPages[i].close(); } catch (e) {}
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
  console.log('Extension reloaded');

  // Clear ALL storage
  const cleared = await extPage.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all);
    if (keys.length > 0) await chrome.storage.local.remove(keys);
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
  let priceCheckDone = false;
  let listingPageFirstSeen = 0;
  const storageKeys = [
    '_dropflow_fillform_trace',
    'dropflow_builder_complete',
    'dropflow_last_fill_results',
    'dropflow_variation_flow_log'
  ];

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL);
    const elapsed = (i + 1) * POLL_INTERVAL / 1000;
    console.log(`\n⏱️  Poll ${i + 1} (${elapsed}s)`);

    // Read storage
    let data;
    try {
      const ep = await findPage(browser, 'chrome-extension://');
      if (!ep) { console.log('  ⚠️ No ext page'); continue; }
      data = await ep.evaluate((keys) => chrome.storage.local.get(keys), storageKeys);
    } catch (e) {
      console.log('  ⚠️ Storage error:', e.message);
      continue;
    }

    // Trace
    const trace = data['_dropflow_fillform_trace'];
    if (trace && Array.isArray(trace) && trace.length > lastTraceLen) {
      for (const entry of trace.slice(lastTraceLen)) {
        console.log(`  📝 TRACE: ${JSON.stringify(entry)}`);
      }
      lastTraceLen = trace.length;
    }

    if (data['dropflow_builder_complete']) console.log(`  ✅ BUILDER COMPLETE`);

    if (data['dropflow_last_fill_results']) {
      console.log(`  📊 FILL RESULTS: ${JSON.stringify(data['dropflow_last_fill_results']).substring(0, 500)}`);
    }

    if (data['dropflow_variation_flow_log']) {
      const vlog = data['dropflow_variation_flow_log'];
      const arr = Array.isArray(vlog) ? vlog : [vlog];
      console.log(`  🔄 VAR LOG (${arr.length}): last=${JSON.stringify(arr.slice(-3)).substring(0, 300)}`);
    }

    // Check for eBay page
    const ebayPage = await findPage(browser, 'ebay.com');
    if (ebayPage && !listingPageFirstSeen) {
      listingPageFirstSeen = Date.now();
      console.log('  🌐 eBay listing page detected');
    }

    // Price check: fillForm done OR 6 min on listing page
    const fillDone = !!data['dropflow_last_fill_results'];
    const sixMinOnListing = listingPageFirstSeen && (Date.now() - listingPageFirstSeen > 360_000);

    if ((fillDone || sixMinOnListing) && !priceCheckDone && ebayPage) {
      console.log('\n💰 === PRICE INPUT CHECK ===');
      await screenshot(ebayPage, 'ebay-direct-pricing.png');

      const priceData = await readPriceInputs(ebayPage);
      if (priceData) {
        console.log(`  Filled: ${priceData.filled}`);
        console.log(`  Empty: ${priceData.empty}`);
        console.log(`  Unique values: ${JSON.stringify(priceData.uniqueValues)}`);
        console.log(`  All values: ${JSON.stringify(priceData.values)}`);
        console.log(`  Visible price texts: ${JSON.stringify(priceData.visiblePriceTexts)}`);
        if (priceData.raw.length > 0) {
          console.log('  Raw inputs:');
          for (const r of priceData.raw) {
            console.log(`    val=${r.value} name=${r.name} id=${r.id} aria=${r.ariaLabel} ph=${r.placeholder}`);
          }
        }

        const matchCount = priceData.uniqueValues.filter(v => EXPECTED_PRICES.includes(v)).length;
        console.log(`\n  Expected prices: ${EXPECTED_PRICES.join(', ')}`);
        console.log(`  Found ${priceData.uniqueValues.length} unique, matched ${matchCount}/${EXPECTED_PRICES.length}`);

        if (matchCount === EXPECTED_PRICES.length && priceData.filled >= 5) {
          console.log('\n  ✅ PASS — All expected prices found in variation rows');
        } else if (priceData.filled > 0) {
          console.log(`\n  ⚠️ PARTIAL — ${priceData.filled} filled, ${matchCount} expected matched`);
        } else {
          console.log('\n  ❌ FAIL — No price inputs filled');
        }
        priceCheckDone = true;
      }
      await screenshot(ebayPage, 'ebay-direct-final.png');
    }

    if (fillDone && priceCheckDone) {
      console.log('\n🎉 TEST COMPLETE');
      process.exit(0);
    }
  }

  // Timeout — final check
  console.log('\n⏰ TIMEOUT');
  const ebayPage = await findPage(browser, 'ebay.com');
  if (ebayPage && !priceCheckDone) {
    console.log('Running final price check...');
    await screenshot(ebayPage, 'ebay-direct-pricing.png');
    const priceData = await readPriceInputs(ebayPage);
    if (priceData) {
      console.log(`Filled: ${priceData.filled}, Empty: ${priceData.empty}`);
      console.log(`Unique: ${JSON.stringify(priceData.uniqueValues)}`);
      console.log(`All: ${JSON.stringify(priceData.values)}`);
      console.log(`Visible: ${JSON.stringify(priceData.visiblePriceTexts)}`);
    }
    await screenshot(ebayPage, 'ebay-direct-final.png');
  }

  try {
    const ep = await findPage(browser, 'chrome-extension://');
    if (ep) {
      const allData = await ep.evaluate((keys) => chrome.storage.local.get(keys), storageKeys);
      console.log('\n=== FINAL STORAGE ===');
      console.log(JSON.stringify(allData, null, 2));
    }
  } catch (e) {}

  console.log('\n❌ TEST INCOMPLETE');
  process.exit(1);
})();
