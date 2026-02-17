const puppeteer = require('puppeteer-core');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WS = 'ws://127.0.0.1:52111/devtools/browser/399d440a-d2e4-4410-8a3e-a9a0743736f5';
const EXT = 'hikiofeedjngalncoapgpmljpaoeolci';
const ALI_URL = 'https://www.aliexpress.com/item/1005006995032850.html';
const log = [];
function L(msg) { const t = new Date().toISOString().substr(11,12); console.log(`[${t}] ${msg}`); log.push(`[${t}] ${msg}`); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  L('Connected');

  // Close extra tabs
  const pages = await browser.pages();
  let kept = false;
  for (const p of pages) { if (!kept) { kept = true; continue; } await p.close().catch(() => {}); }

  // Reload extension + clear state
  const page = (await browser.pages())[0];
  await page.goto('chrome-extension://' + EXT + '/pages/popup/popup.html');
  await sleep(2000);
  try { await page.evaluate(() => chrome.runtime.reload()); } catch(_) {}
  await sleep(5000);
  
  const extPage = (await browser.pages())[0];
  await extPage.goto('chrome-extension://' + EXT + '/pages/popup/popup.html');
  await sleep(1000);
  await extPage.evaluate(() => chrome.storage.local.get(null).then(d => {
    const keys = Object.keys(d).filter(k => k.startsWith('pendingListing') || k.startsWith('dropflow_') || k === 'aliBulkRunning' || k.startsWith('orchestration') || k.startsWith('_dropflow'));
    return chrome.storage.local.remove(keys);
  }));
  L('Extension reloaded, storage cleared');

  // Start listing
  const listerPage = await browser.newPage();
  await listerPage.goto('chrome-extension://' + EXT + '/pages/ali-bulk-lister/ali-bulk-lister.html');
  await sleep(2000);
  const r = await listerPage.evaluate((url) => new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'START_ALI_BULK_LISTING', links: [url], threadCount: 1, ebayDomain: 'www.ebay.com.au' }, resolve);
  }), ALI_URL);
  L('Started: ' + JSON.stringify(r));

  // Monitor
  let done = false;
  let lastUrl = '';
  for (let tick = 0; tick < 240 && !done; tick++) {
    await sleep(5000);

    // Check pages
    const allPages = await browser.pages();
    for (const p of allPages) {
      const u = p.url();
      if (u.includes('ebay') && u !== lastUrl) {
        lastUrl = u;
        L('PAGE: ' + u.substring(0, 150));
      }
    }

    // Check fill results
    try {
      const results = await listerPage.evaluate(() =>
        chrome.storage.local.get('dropflow_last_fill_results').then(d => d.dropflow_last_fill_results)
      ).catch(() => null);
      if (results) {
        L('✅ FILL RESULTS: ' + JSON.stringify(results));
        done = true;
      }
    } catch (_) {}

    // Check orchestration
    if (tick % 12 === 0) {
      try {
        const orch = await listerPage.evaluate(() =>
          chrome.storage.local.get('_dropflow_orchestration').then(d => d._dropflow_orchestration)
        ).catch(() => null);
        L('Tick ' + tick + ' (' + (tick*5) + 's) orch=' + (orch?.stage || '?'));
      } catch(_) { L('Tick ' + tick); }
    }

    // Check flow log growth
    if (tick % 6 === 0 && tick > 0) {
      try {
        const fl = await listerPage.evaluate(() =>
          chrome.storage.local.get('dropflow_variation_flow_log').then(d => (d.dropflow_variation_flow_log || []).length)
        ).catch(() => 0);
        L('Flow log: ' + fl + ' entries');
      } catch(_) {}
    }
  }

  if (!done) L('⏰ TIMED OUT');

  // Check variation prices in storage
  try {
    const keys = await listerPage.evaluate(() => chrome.storage.local.get(null).then(d => 
      Object.keys(d).filter(k => k.startsWith('pendingListing'))
    ));
    for (const k of keys) {
      const data = await listerPage.evaluate((key) => chrome.storage.local.get(key).then(d => d[key]), k);
      if (data?.variations?.skus) {
        const prices = [...new Set(data.variations.skus.map(s => s.ebayPrice))].sort((a,b) => a-b);
        L('Variant eBay prices: ' + JSON.stringify(prices));
      }
    }
  } catch(_) {}

  fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/E2E-RESULT.md',
    '# E2E Test\n## ' + new Date().toISOString() + '\n\n```\n' + log.join('\n') + '\n```\n');
  L('Report saved');
  browser.disconnect();
})().catch(e => { console.error('FATAL:', e.message); });
