const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = require('fs');

const WS = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const TEST_URL = 'https://a.aliexpress.com/_mMLcP7b';
const log = [];
function L(msg) { const t = new Date().toISOString().substr(11,8); const line = `[${t}] ${msg}`; console.log(line); log.push(line); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // Ensure SW is alive
  let targets = await browser.targets();
  let sw = targets.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  if (!sw) {
    L('SW dead, waking...');
    const p = await browser.newPage();
    await p.goto(`chrome-extension://${EXT_ID}/background/service-worker.js`);
    await sleep(3000);
    await p.close();
    targets = await browser.targets();
    sw = targets.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  }
  L(`SW: ${sw ? 'ALIVE' : 'DEAD'}`);
  if (!sw) { L('FATAL: Cannot wake SW'); process.exit(1); }

  // Monitor SW console
  const swCdp = await sw.createCDPSession();
  swCdp.on('Runtime.consoleAPICalled', (event) => {
    const text = event.args.map(a => a.value || a.description || '').join(' ');
    L(`[SW] ${text.substring(0, 400)}`);
  });
  await swCdp.send('Runtime.enable');

  // Trigger the listing
  const listerPage = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
  let triggerPage = listerPage;
  if (!triggerPage) {
    triggerPage = await browser.newPage();
    await triggerPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`);
    await sleep(2000);
  }

  const r = await triggerPage.evaluate((url) => {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: [url],
        threadCount: 1,
        ebayDomain: 'www.ebay.com.au'
      }, resolve);
    });
  }, TEST_URL);
  L(`Start: ${JSON.stringify(r)}`);

  // Monitor pages for eBay form page and watch form-filler console
  let ebayPageMonitored = false;
  let formFillerDone = false;
  let lastResults = null;

  for (let tick = 0; tick < 120 && !formFillerDone; tick++) {
    await sleep(5000);

    // Check SW is alive
    targets = await browser.targets();
    sw = targets.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
    if (!sw) {
      L('⚠️ SW DIED at tick ' + tick);
      // Try to reattach
      const p = await browser.newPage();
      await p.goto(`chrome-extension://${EXT_ID}/background/service-worker.js`);
      await sleep(2000);
      await p.close();
      targets = await browser.targets();
      sw = targets.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
      if (sw) {
        const newCdp = await sw.createCDPSession();
        newCdp.on('Runtime.consoleAPICalled', (event) => {
          const text = event.args.map(a => a.value || a.description || '').join(' ');
          L(`[SW] ${text.substring(0, 400)}`);
        });
        await newCdp.send('Runtime.enable');
        L('SW revived');
      }
    }

    // Look for eBay listing page
    if (!ebayPageMonitored) {
      const pages = await browser.pages();
      const ebayPage = pages.find(p => p.url().includes('ebay') && p.url().includes('/lstng'));
      if (ebayPage) {
        L('Found eBay page: ' + ebayPage.url().substring(0, 100));
        ebayPage.on('console', msg => {
          const text = msg.text();
          if (text.includes('DropFlow')) L(`[EBAY] ${text.substring(0, 400)}`);
        });
        ebayPageMonitored = true;
      }
    }

    // Check storage for fill results
    try {
      const pages = await browser.pages();
      const anyExtPage = pages.find(p => p.url().includes(EXT_ID));
      if (anyExtPage) {
        const results = await anyExtPage.evaluate(() => {
          return chrome.storage.local.get('dropflow_last_fill_results').then(d => d.dropflow_last_fill_results || null);
        }).catch(() => null);
        if (results && !lastResults) {
          lastResults = results;
          L(`✅ FILL RESULTS: ${JSON.stringify(results)}`);
          formFillerDone = true;
        }
      }
    } catch (_) {}

    if (tick % 6 === 0) L(`Tick ${tick} (${tick*5}s elapsed)`);
  }

  if (!formFillerDone) {
    L('⏰ Test timed out after 10 minutes');
  }

  // Write results
  const report = log.join('\n');
  fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PHOTO-PERSIST-FIX.md', 
    `# Photo Persist Fix Test\n\n## Run: ${new Date().toISOString()}\n\n\`\`\`\n${report}\n\`\`\`\n\n## Results\n${lastResults ? JSON.stringify(lastResults, null, 2) : 'No results (timed out)'}\n`
  );
  L('Report written to PHOTO-PERSIST-FIX.md');

  browser.disconnect();
})().catch(e => { L('FATAL: ' + e.message); process.exit(1); });
