const puppeteer = require('puppeteer-core');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXT = 'hikiofeedjngalncoapgpmljpaoeolci';
const WS = 'ws://127.0.0.1:52111/devtools/browser/399d440a-d2e4-4410-8a3e-a9a0743736f5';
const ALI_URL = 'https://www.aliexpress.com/item/1005006995032850.html';
const EBAY_DOMAIN = 'www.ebay.com.au';
const MARKUP = 30; // percent
const log = [];
function L(msg) { const t = new Date().toISOString().substr(11,12); const line = `[${t}] ${msg}`; console.log(line); log.push(line); }
function writeReport() {
  fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PER-VARIANT-TEST.md',
    '# Per-Variant Pricing E2E Test\n\n## Run: ' + new Date().toISOString() + '\n\n```\n' + log.join('\n') + '\n```\n');
}

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  L('Connected to browser');

  // Close extra tabs
  const pages = await browser.pages();
  let kept = false;
  for (const p of pages) {
    if (!kept) { kept = true; continue; }
    await p.close().catch(() => {});
  }

  // Verify SW alive — try multiple detection methods
  let targets = await browser.targets();
  L('All targets: ' + targets.map(t => t.type() + ':' + t.url().substring(0, 60)).join(' | '));
  let sw = targets.find(t => t.url().includes(EXT) && (t.type() === 'service_worker' || t.type() === 'background_page'));
  if (!sw) {
    // Wake SW by opening popup
    L('SW not in targets, waking...');
    const wakePage = await browser.newPage();
    await wakePage.goto('chrome-extension://' + EXT + '/pages/popup/popup.html');
    await sleep(3000);
    targets = await browser.targets();
    sw = targets.find(t => t.url().includes(EXT) && (t.type() === 'service_worker' || t.type() === 'background_page'));
    if (!sw) {
      // Last resort: use any page to sendMessage
      L('Still no SW target, will use page context instead');
    }
  }
  L('SW: ' + (sw ? 'ALIVE (' + sw.type() + ')' : 'NOT IN TARGETS (will use page context)'));

  // Monitor SW console if available
  if (sw) {
    try {
      const swCdp = await sw.createCDPSession();
      swCdp.on('Runtime.consoleAPICalled', (event) => {
        const text = event.args.map(a => a.value || a.description || '').join(' ');
        if (text.includes('DropFlow') || text.includes('price') || text.includes('variant') || 
            text.includes('MSKU') || text.includes('combination') || text.includes('builder') ||
            text.includes('fillForm') || text.includes('ERROR') || text.includes('bulk')) {
          L('[SW] ' + text.substring(0, 500));
        }
      });
      await swCdp.send('Runtime.enable');
    } catch (e) { L('SW CDP attach failed: ' + e.message); }
  }

  // Clear stale state via extension page
  const cleanPage = (await browser.pages())[0] || await browser.newPage();
  await cleanPage.goto('chrome-extension://' + EXT + '/pages/popup/popup.html');
  await sleep(1000);
  await cleanPage.evaluate(() => {
    return chrome.storage.local.get(null).then(d => {
      const keys = Object.keys(d).filter(k => k.startsWith('pendingListing') || k.startsWith('dropflow_') || k === 'aliBulkRunning' || k.startsWith('orchestration'));
      return chrome.storage.local.remove(keys);
    });
  });
  L('Cleared stale storage');

  // Open ali-bulk-lister and start
  const listerPage = await browser.newPage();
  await listerPage.goto('chrome-extension://' + EXT + '/pages/ali-bulk-lister/ali-bulk-lister.html');
  await sleep(2000);

  const r = await listerPage.evaluate((url, domain) => {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: [url],
        threadCount: 1,
        ebayDomain: domain
      }, resolve);
    });
  }, ALI_URL, EBAY_DOMAIN);
  L('Start result: ' + JSON.stringify(r));

  // Monitor for up to 15 minutes
  let ebayConsoleAttached = false;
  let done = false;
  let ebayPage = null;

  for (let tick = 0; tick < 180 && !done; tick++) {
    await sleep(5000);

    // Check SW alive
    targets = await browser.targets();
    const swAlive = targets.find(t => t.url().includes(EXT) && (t.type() === 'service_worker' || t.type() === 'background_page'));
    if (!swAlive && tick % 4 === 0) {
      L('⚠️ SW DIED at ' + (tick * 5) + 's, waking...');
      const p = await browser.newPage();
      await p.goto('chrome-extension://' + EXT + '/background/service-worker.js');
      await sleep(3000);
      await p.close();
    }

    // Find eBay listing page
    if (!ebayConsoleAttached) {
      const allPages = await browser.pages();
      const ep = allPages.find(p => p.url().includes('ebay') && (p.url().includes('/lstng') || p.url().includes('/sl/')));
      if (ep) {
        ebayPage = ep;
        L('Found eBay page: ' + ep.url().substring(0, 120));
        ep.on('console', msg => {
          const t = msg.text();
          if (t.includes('DropFlow') || t.includes('price') || t.includes('variant') || 
              t.includes('MSKU') || t.includes('combination') || t.includes('builder') ||
              t.includes('fillCombinations') || t.includes('ERROR')) {
            L('[EBAY] ' + t.substring(0, 500));
          }
        });
        ebayConsoleAttached = true;
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

    // Check orchestration state
    if (tick % 6 === 0) {
      try {
        const state = await listerPage.evaluate(() =>
          chrome.storage.local.get('orchestration_state').then(d => d.orchestration_state)
        ).catch(() => null);
        if (state) L('Orchestration: step=' + state.step + ' status=' + state.status);
      } catch (_) {}
      L('Tick ' + tick + ' (' + (tick * 5) + 's)');
    }
  }

  // If listing was submitted, check the variation prices on eBay
  if (done && ebayPage) {
    L('--- Checking submitted listing prices ---');
    try {
      // Try to get the listing ID from the success page
      await sleep(5000);
      const allPages = await browser.pages();
      for (const p of allPages) {
        const url = p.url();
        if (url.includes('ebay') && (url.includes('success') || url.includes('ViewItem'))) {
          L('Success/listing page: ' + url);
        }
      }
    } catch (e) { L('Post-check error: ' + e.message); }
  }

  if (!done) L('⏰ Timed out after 15 minutes');

  writeReport();
  L('Report written to PER-VARIANT-TEST.md');
  browser.disconnect();
})().catch(e => { L('FATAL: ' + e.message); console.error(e); writeReport(); });
