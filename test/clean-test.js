const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = require('fs');
const EXT = 'hikiofeedjngalncoapgpmljpaoeolci';
const WS = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const log = [];
function L(msg) { const t = new Date().toISOString().substr(11,12); const line = `[${t}] ${msg}`; console.log(line); log.push(line); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // Step 1: Close ALL tabs except one
  L('Step 1: Closing all tabs...');
  const pages = await browser.pages();
  let kept = false;
  for (const p of pages) {
    if (!kept) { kept = true; continue; } // keep one tab
    await p.close().catch(() => {});
  }
  
  // Step 2: Reload extension
  L('Step 2: Reloading extension...');
  const reloadPage = (await browser.pages())[0];
  await reloadPage.goto('chrome-extension://' + EXT + '/pages/popup/popup.html');
  await sleep(2000);
  try { await reloadPage.evaluate(() => chrome.runtime.reload()); } catch(_) {}
  await sleep(5000);
  
  // Step 3: Verify SW is alive
  let targets = await browser.targets();
  let sw = targets.find(t => t.url().includes(EXT) && t.type() === 'service_worker');
  if (!sw) {
    const p = await browser.newPage();
    await p.goto('chrome-extension://' + EXT + '/background/service-worker.js');
    await sleep(3000);
    await p.close();
    targets = await browser.targets();
    sw = targets.find(t => t.url().includes(EXT) && t.type() === 'service_worker');
  }
  L('SW: ' + (sw ? 'ALIVE' : 'DEAD'));
  if (!sw) { L('FATAL'); process.exit(1); }
  
  // SW console monitor
  const swCdp = await sw.createCDPSession();
  swCdp.on('Runtime.consoleAPICalled', (event) => {
    const text = event.args.map(a => a.value || a.description || '').join(' ');
    L('[SW] ' + text.substring(0, 500));
  });
  await swCdp.send('Runtime.enable');
  
  // Step 4: Clear all pending data
  await swCdp.send('Runtime.evaluate', {
    expression: `chrome.storage.local.get(null).then(d => {
      const keys = Object.keys(d).filter(k => k.startsWith('pendingListing') || k.startsWith('dropflow_'));
      return chrome.storage.local.remove(keys);
    })`,
    awaitPromise: true
  });
  L('Cleared storage');
  
  // Step 5: Open ali-bulk-lister and trigger listing
  L('Step 5: Starting listing...');
  const listerPage = await browser.newPage();
  await listerPage.goto('chrome-extension://' + EXT + '/pages/ali-bulk-lister/ali-bulk-lister.html');
  await sleep(2000);
  
  const r = await listerPage.evaluate(() => {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: ['https://a.aliexpress.com/_mMLcP7b'],
        threadCount: 1,
        ebayDomain: 'www.ebay.com.au'
      }, resolve);
    });
  });
  L('Start result: ' + JSON.stringify(r));
  
  // Step 6: Monitor for up to 8 minutes
  let ebayConsoleAttached = false;
  let formFillerDone = false;
  
  for (let tick = 0; tick < 96 && !formFillerDone; tick++) {
    await sleep(5000);
    
    // Check SW alive
    targets = await browser.targets();
    const swAlive = targets.find(t => t.url().includes(EXT) && t.type() === 'service_worker');
    if (!swAlive && tick % 2 === 0) {
      L('⚠️ SW DIED at ' + (tick * 5) + 's, waking...');
      const p = await browser.newPage();
      await p.goto('chrome-extension://' + EXT + '/background/service-worker.js');
      await sleep(3000);
      await p.close();
    }
    
    // Look for eBay page
    if (!ebayConsoleAttached) {
      const allPages = await browser.pages();
      const ebay = allPages.find(p => p.url().includes('ebay') && (p.url().includes('/lstng') || p.url().includes('/sl/')));
      if (ebay) {
        L('Found eBay page: ' + ebay.url().substring(0, 100));
        ebay.on('console', msg => {
          if (msg.text().includes('DropFlow')) L('[EBAY] ' + msg.text().substring(0, 500));
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
        formFillerDone = true;
      }
    } catch (_) {}
    
    if (tick % 6 === 0) L('Tick ' + tick + ' (' + (tick * 5) + 's)');
  }
  
  if (!formFillerDone) L('⏰ Timed out');
  
  // Write report
  fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PHOTO-PERSIST-FIX.md',
    '# Photo Persist Fix Test\n\n## Run: ' + new Date().toISOString() + '\n\n```\n' + log.join('\n') + '\n```\n'
  );
  L('Report written');
  
  browser.disconnect();
})().catch(e => { L('FATAL: ' + e.message); console.error(e); });
