const puppeteer = require('puppeteer-core');
const fs = require('fs');

const WS = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const OUT = '/Users/pyrite/Projects/dropflow-extension/test/10X-TEST-PROGRESS.md';

const products = [
  ['LED Dog Leash', 'https://www.aliexpress.com/item/1005006280952147.html'],
  ['Phone Case', 'https://www.aliexpress.com/item/1005005686063079.html'],
  ['LED Strip Lights', 'https://www.aliexpress.com/item/1005006014409498.html'],
  ['Wireless Earbuds Case', 'https://www.aliexpress.com/item/1005005447508498.html'],
  ['Laptop Stand', 'https://www.aliexpress.com/item/1005006564795167.html'],
  ['Watch Band', 'https://www.aliexpress.com/item/1005005981822498.html'],
  ['Car Phone Mount', 'https://www.aliexpress.com/item/1005006283012345.html'],
  ['Yoga Mat', 'https://www.aliexpress.com/item/1005005519875498.html'],
  ['Kitchen Scale', 'https://www.aliexpress.com/item/1005006391245678.html'],
  ['Bluetooth Speaker', 'https://www.aliexpress.com/item/1005005823156498.html']
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function withTimeout(promise, ms, fallback = null) {
  return Promise.race([promise, new Promise(r => setTimeout(() => r(fallback), ms))]);
}

function render(rows, startedAt) {
  const head = `# DropFlow 10X Test Progress\n\nStarted: ${startedAt}\nUpdated: ${new Date().toISOString()}\n\n| # | Product | Status | eBay URL | Variations | Notes |\n|---|---------|--------|----------|------------|-------|`;
  const lines = rows.map(r => `| ${r.idx} | ${r.product} | ${r.status} | ${r.ebayUrl || '-'} | ${r.variations || '-'} | ${r.notes || '-'} |`);
  return `${head}\n${lines.join('\n')}\n`;
}

async function safeEval(page, fn, timeout = 10000, fallback = null) {
  try {
    return await withTimeout(page.evaluate(fn), timeout, fallback);
  } catch (e) {
    return fallback;
  }
}

(async () => {
  const rows = products.map((p, i) => ({ idx: i+1, product: p[0], status: '⏳', ebayUrl: '', variations: '', notes: 'Pending' }));
  const startedAt = new Date().toISOString();
  fs.writeFileSync(OUT, render(rows, startedAt));

  const browser = await puppeteer.connect({ browserWSEndpoint: WS, defaultViewport: null });
  let pages = await browser.pages();
  let bulkPage = pages.find(p => p.url().includes(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister`));
  if (!bulkPage) {
    bulkPage = await browser.newPage();
    await bulkPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  await bulkPage.bringToFront();
  await sleep(1500);
  await safeEval(bulkPage, () => new Promise(res => chrome.storage.local.set({ dropflow_price_markup: 30, priceMarkup: 30 }, res)));

  for (let i = 0; i < products.length; i++) {
    const [name, url] = products[i];
    rows[i].status = '🔄';
    rows[i].notes = 'Starting';
    fs.writeFileSync(OUT, render(rows, startedAt));
    console.log(`\n[${i+1}] ========== ${name} ==========`);

    // 1. Terminate previous run
    await safeEval(bulkPage, () => new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'TERMINATE_ALI_BULK_LISTING' }, resp => resolve(resp));
      setTimeout(() => resolve({timeout:true}), 5000);
    }), 8000);
    await sleep(2000);

    // 2. Close leftover Ali/eBay tabs
    try {
      const allPages = await withTimeout(browser.pages(), 10000, []);
      for (const p of allPages) {
        const u = p.url();
        if (u.includes('aliexpress.com/item') || u.includes('ebay.com.au/lstng') || u.includes('ebay.com.au/sl/')) {
          await p.close().catch(() => {});
          console.log(`[${i+1}] closed: ${u.slice(0, 60)}`);
        }
      }
    } catch (e) { console.log(`[${i+1}] cleanup err: ${e.message}`); }
    await sleep(1000);

    // 3. Clear storage
    await safeEval(bulkPage, () => new Promise(res => chrome.storage.local.remove([
      'dropflow_last_fill_results', 'dropflow_variation_steps',
      'dropflow_variation_check', 'dropflow_variation_log',
      'dropflow_variation_status', 'dropflow_variation_flow_log'
    ], res)));

    // 4. Trigger
    let trigger;
    try {
      trigger = await withTimeout(bulkPage.evaluate((u) => new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'START_ALI_BULK_LISTING',
          links: [u],
          marketplace: 'ebay.com.au',
          ebayDomain: 'www.ebay.com.au',
          listingType: 'standard',
          threadCount: 1
        }, resp => resolve(resp || { ok: true }));
        setTimeout(() => resolve({ timeout: true }), 7000);
      }), url), 15000, { error: 'eval-timeout' });
    } catch (e) { trigger = { error: e.message }; }
    console.log(`[${i+1}] trigger: ${JSON.stringify(trigger)}`);

    if (trigger?.error) {
      rows[i].status = '❌';
      rows[i].notes = `Trigger failed: ${trigger.error}`;
      fs.writeFileSync(OUT, render(rows, startedAt));
      continue;
    }

    rows[i].notes = 'Triggered, waiting...';
    fs.writeFileSync(OUT, render(rows, startedAt));

    // 5. Poll for completion (16 min max)
    let ebayUrl = '';
    let varInfo = '';
    let done = false;

    for (let t = 0; t < 96; t++) {
      await sleep(10000);

      // Read variation status from storage (single call, fast)
      const storageState = await safeEval(bulkPage, () => new Promise(async resolve => {
        try {
          const d = await chrome.storage.local.get([
            'dropflow_variation_check', 'dropflow_variation_status',
            'dropflow_variation_log', 'dropflow_variation_flow_log'
          ]);
          resolve({
            varCheck: d.dropflow_variation_check || null,
            varStatus: d.dropflow_variation_status || null,
            varLogLen: (d.dropflow_variation_log || []).length,
            flowLogLen: (d.dropflow_variation_flow_log || []).length,
            lastLog: (d.dropflow_variation_log || []).slice(-1)[0] || null
          });
        } catch(e) { resolve({}); }
      }), 8000, {});

      // Check tab URLs (use CDP directly for speed)
      let tabInfo = '';
      let hasAli = false, hasEbay = false, hasListed = false;
      try {
        const resp = await fetch(`http://127.0.0.1:62547/json/list`);
        const tabs = await resp.json();
        for (const tab of tabs) {
          if (tab.type !== 'page') continue;
          const u = tab.url;
          if (u.includes('aliexpress.com/item')) hasAli = true;
          if (u.includes('ebay.com.au/lstng') || u.includes('ebay.com.au/sl/')) { hasEbay = true; ebayUrl = u; }
          if (/ebay\.com\.au\/itm\//.test(u)) { hasListed = true; ebayUrl = u; done = true; }
        }
        tabInfo = `ali=${hasAli} ebay=${hasEbay} listed=${hasListed}`;
      } catch (e) { tabInfo = 'tab-err'; }

      const varStep = storageState?.varStatus?.step || '-';
      const mins = Math.round((t + 1) * 10 / 60);
      
      // If no Ali/eBay tabs left and we're past 2 min, extension is done
      if (!hasAli && !hasEbay && !hasListed && t > 12) {
        console.log(`[${i+1}] No Ali/eBay tabs left — extension finished or failed`);
        done = true;
      }

      if (storageState?.varCheck?.hasVariations) {
        const vc = storageState.varCheck;
        varInfo = `axes=${vc.variationsObj?.axisNames?.join(',')||'?'}`;
      }

      const note = `${mins}m | ${tabInfo} | var=${varStep} logs=${storageState?.varLogLen||0}`;
      console.log(`[${i+1}] t=${t} ${note}`);
      rows[i].notes = note;
      rows[i].ebayUrl = ebayUrl ? ebayUrl.slice(0, 60) + '...' : '';
      rows[i].variations = varInfo || '-';
      fs.writeFileSync(OUT, render(rows, startedAt));

      if (done) break;
    }

    if (done) {
      rows[i].status = '✅';
      rows[i].notes = `Done! ${ebayUrl.slice(0,60)}`;
    } else {
      rows[i].status = '❌';
      rows[i].notes = rows[i].notes + ' | TIMEOUT';
    }
    fs.writeFileSync(OUT, render(rows, startedAt));
    console.log(`[${i+1}] Result: ${rows[i].status} ${rows[i].notes}`);
    await sleep(3000);
  }

  await browser.disconnect();
  console.log('\n=== DONE ===');
  console.log('Progress written:', OUT);
})();
