const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CDP = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const EXT_PAGE = `chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`;
const ALI_URL = 'https://www.aliexpress.com/item/1005006995032850.html';
const POLL_INTERVAL = 10_000;
const MAX_POLLS = 90; // 15 minutes
const SCREENSHOT_DIR = '/Users/pyrite/.openclaw/workspace';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function findPage(browser, match) {
  for (const p of await browser.pages()) {
    if (p.url().includes(match)) return p;
  }
  return null;
}

async function screenshot(page, name) {
  const path = `${SCREENSHOT_DIR}/${name}`;
  try {
    await page.screenshot({ path, fullPage: false });
    console.log(`📸 ${name}`);
  } catch (e) {
    console.log(`📸 FAIL ${name}: ${e.message}`);
  }
}

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  console.log('✅ Connected to browser');

  // 1. Close extra tabs (keep only one)
  const allPages = await browser.pages();
  console.log(`Found ${allPages.length} tabs`);
  for (let i = 1; i < allPages.length; i++) {
    try { await allPages[i].close(); } catch (e) {}
  }

  // 2. Open extension page & reload extension
  let extPage = await findPage(browser, 'ali-bulk-lister');
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto(EXT_PAGE, { waitUntil: 'domcontentloaded' });
  }
  console.log('Reloading extension...');
  await extPage.evaluate(() => chrome.runtime.reload());
  await sleep(5000);

  // Re-open ext page after reload
  extPage = await findPage(browser, 'ali-bulk-lister');
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto(EXT_PAGE, { waitUntil: 'domcontentloaded' });
    await sleep(2000);
  }
  console.log('Extension reloaded, page:', extPage.url());

  // 3. Clear ALL storage
  await extPage.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all);
    if (keys.length > 0) await chrome.storage.local.remove(keys);
    return keys.length;
  }).then(n => console.log(`Cleared ${n} storage keys`));

  // Close any eBay listing tabs
  for (const p of await browser.pages()) {
    if (p.url().includes('ebay.com') && p !== extPage) {
      try { await p.close(); } catch (e) {}
    }
  }

  // 4. Start bulk listing
  console.log(`\n🚀 Starting bulk listing for: ${ALI_URL}`);
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

  if (resp?.error) {
    console.error('❌ START failed:', resp.error);
    process.exit(1);
  }

  // 5. Poll loop
  let builderScreenshot = false;
  let pricingScreenshot = false;
  let lastTraceLen = 0;
  const storageKeys = [
    '_dropflow_fillform_trace',
    'dropflow_builder_complete',
    'dropflow_last_fill_results',
    'dropflow_variation_flow_log'
  ];

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL);
    const elapsed = ((i + 1) * POLL_INTERVAL / 1000);
    console.log(`\n⏱️  Poll ${i + 1} (${elapsed}s)`);

    // Read storage from ext page
    let data;
    try {
      // Re-find ext page in case it was navigated
      const ep = await findPage(browser, 'chrome-extension://');
      if (!ep) { console.log('  ⚠️ No extension page found'); continue; }
      data = await ep.evaluate((keys) => chrome.storage.local.get(keys), storageKeys);
    } catch (e) {
      console.log('  ⚠️ Storage read error:', e.message);
      continue;
    }

    // Trace
    const trace = data['_dropflow_fillform_trace'];
    if (trace && Array.isArray(trace) && trace.length > lastTraceLen) {
      const newEntries = trace.slice(lastTraceLen);
      for (const entry of newEntries) {
        console.log(`  📝 TRACE: ${JSON.stringify(entry)}`);
      }
      lastTraceLen = trace.length;
    }

    // Builder complete
    if (data['dropflow_builder_complete']) {
      console.log(`  ✅ BUILDER COMPLETE: ${JSON.stringify(data['dropflow_builder_complete'])}`);
    }

    // Fill results
    if (data['dropflow_last_fill_results']) {
      console.log(`  📊 FILL RESULTS: ${JSON.stringify(data['dropflow_last_fill_results']).substring(0, 500)}`);
    }

    // Variation flow log
    if (data['dropflow_variation_flow_log']) {
      const vlog = data['dropflow_variation_flow_log'];
      if (Array.isArray(vlog)) {
        console.log(`  🔄 VARIATION LOG (${vlog.length} entries):`);
        for (const v of vlog.slice(-5)) {
          console.log(`     ${JSON.stringify(v)}`);
        }
      } else {
        console.log(`  🔄 VARIATION LOG: ${JSON.stringify(vlog).substring(0, 300)}`);
      }
    }

    // Screenshots at key moments
    // Find eBay builder page
    const ebayPage = await findPage(browser, 'ebay.com');
    if (ebayPage) {
      if (!builderScreenshot) {
        await screenshot(ebayPage, 'ebay-builder.png');
        builderScreenshot = true;
      }

      // Check for pricing/combinations table
      try {
        const hasTable = await ebayPage.evaluate(() => {
          const iframes = document.querySelectorAll('iframe');
          for (const iframe of iframes) {
            try {
              const doc = iframe.contentDocument;
              if (doc && doc.querySelector('.grid-container, [class*="variation"], [class*="combination"], table')) {
                return true;
              }
            } catch (e) {}
          }
          return !!document.querySelector('.grid-container, [class*="variation"], [class*="combination"]');
        });
        if (hasTable && !pricingScreenshot) {
          await screenshot(ebayPage, 'ebay-pricing.png');
          pricingScreenshot = true;
          console.log('  💰 Pricing table detected!');
        }
      } catch (e) {}
    }

    // Check if done
    if (data['dropflow_builder_complete'] && data['dropflow_last_fill_results']) {
      console.log('\n🎉 Both builder_complete and fill_results are set!');

      // Take final screenshot
      const ep2 = await findPage(browser, 'ebay.com');
      if (ep2) await screenshot(ep2, 'ebay-final.png');

      // Check per-variant prices in fill results
      const results = data['dropflow_last_fill_results'];
      console.log('\n=== FILL RESULTS ANALYSIS ===');
      console.log(JSON.stringify(results, null, 2));

      // Check variation flow for price data
      if (data['dropflow_variation_flow_log']) {
        console.log('\n=== VARIATION FLOW LOG ===');
        console.log(JSON.stringify(data['dropflow_variation_flow_log'], null, 2));
      }

      // Try to read combinations table from eBay page
      if (ep2) {
        try {
          const tableData = await ep2.evaluate(() => {
            const rows = [];
            // Check main doc and iframes
            const docs = [document];
            document.querySelectorAll('iframe').forEach(f => {
              try { if (f.contentDocument) docs.push(f.contentDocument); } catch(e) {}
            });
            for (const doc of docs) {
              doc.querySelectorAll('tr').forEach(tr => {
                const cells = Array.from(tr.querySelectorAll('td, th')).map(c => c.textContent.trim());
                if (cells.length >= 2) rows.push(cells);
              });
            }
            return rows;
          });
          if (tableData.length > 0) {
            console.log('\n=== COMBINATIONS TABLE ===');
            for (const row of tableData) {
              console.log('  ', row.join(' | '));
            }
            // Check for 5 different size prices
            const priceRows = tableData.filter(r => r.some(c => /\d+\.\d{2}/.test(c)));
            console.log(`\n📊 Found ${priceRows.length} rows with prices`);
            if (priceRows.length >= 5) {
              console.log('✅ 5+ variant prices found!');
            } else {
              console.log(`⚠️ Only ${priceRows.length} price rows (expected 5+)`);
            }
          }
        } catch (e) {
          console.log('Table read error:', e.message);
        }
      }

      console.log('\n✅ TEST COMPLETE - SUCCESS');
      process.exit(0);
    }
  }

  // Timeout - take final screenshot anyway
  console.log('\n⏰ TIMEOUT after 15 minutes');
  const finalPage = await findPage(browser, 'ebay.com');
  if (finalPage) await screenshot(finalPage, 'ebay-final.png');

  // Dump whatever we have
  try {
    const ep = await findPage(browser, 'chrome-extension://');
    if (ep) {
      const allData = await ep.evaluate((keys) => chrome.storage.local.get(keys), storageKeys);
      console.log('\n=== FINAL STORAGE STATE ===');
      console.log(JSON.stringify(allData, null, 2));
    }
  } catch (e) {}

  console.log('\n❌ TEST INCOMPLETE - timed out');
  process.exit(1);
})();
