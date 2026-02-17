const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = require('fs');
const EXT = 'hikiofeedjngalncoapgpmljpaoeolci';
const WS = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const log = [];
function L(msg) { const t = new Date().toISOString().substr(11,12); const line = `[${t}] ${msg}`; console.log(line); log.push(line); }

async function ensureSW(browser) {
  const targets = await browser.targets();
  let sw = targets.find(t => t.url().includes(EXT) && t.type() === 'service_worker');
  if (sw) return sw;
  
  // Wake it
  const p = await browser.newPage();
  await p.goto('chrome-extension://' + EXT + '/background/service-worker.js');
  await sleep(3000);
  await p.close();
  const t2 = await browser.targets();
  return t2.find(t => t.url().includes(EXT) && t.type() === 'service_worker');
}

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // Clean up
  L('Cleaning up...');
  const pages = await browser.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close().catch(() => {});
  
  // Reload extension
  L('Reloading extension...');
  const page = await browser.newPage();
  await page.goto('chrome-extension://' + EXT + '/pages/popup/popup.html');
  await sleep(2000);
  try { await page.evaluate(() => chrome.runtime.reload()); } catch(_) {}
  await sleep(5000);
  
  let sw = await ensureSW(browser);
  L('SW: ' + (sw ? 'ALIVE' : 'DEAD'));
  
  // Clear storage
  if (sw) {
    const swCdp = await sw.createCDPSession();
    await swCdp.send('Runtime.evaluate', {
      expression: `chrome.storage.local.get(null).then(d => {
        const keys = Object.keys(d).filter(k => k.startsWith('pendingListing') || k.startsWith('dropflow_'));
        return chrome.storage.local.remove(keys);
      })`,
      awaitPromise: true
    }).catch(() => {});
  }
  L('Storage cleared');
  
  // Open lister page and trigger
  const lister = await browser.newPage();
  await lister.goto('chrome-extension://' + EXT + '/pages/ali-bulk-lister/ali-bulk-lister.html');
  await sleep(2000);
  
  const r = await lister.evaluate(() => {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: ['https://a.aliexpress.com/_mMLcP7b'],
        threadCount: 1,
        ebayDomain: 'www.ebay.com.au'
      }, resolve);
    });
  });
  L('Started: ' + JSON.stringify(r));
  
  // Main monitoring loop - aggressive SW keepalive
  let lastSWAlive = Date.now();
  let ebayPageConsole = false;
  let swDeathCount = 0;
  
  for (let tick = 0; tick < 120; tick++) {
    await sleep(5000);
    
    // Keep SW alive
    sw = await ensureSW(browser).catch(() => null);
    if (!sw) {
      swDeathCount++;
      L('⚠️ SW dead (death #' + swDeathCount + ')');
    } else {
      // Ping it to keep alive
      try {
        const swCdp = await sw.createCDPSession();
        await swCdp.send('Runtime.evaluate', { expression: '"alive"' });
        await swCdp.detach().catch(() => {});
      } catch(_) {}
    }
    
    // Check pages
    const allPages = await browser.pages();
    const urls = allPages.map(p => p.url());
    
    // Attach to eBay console
    if (!ebayPageConsole) {
      const ebay = allPages.find(p => p.url().includes('ebay') && (p.url().includes('/lstng') || p.url().includes('/sl/')));
      if (ebay) {
        L('📋 eBay page: ' + ebay.url().substring(0, 100));
        ebay.on('console', msg => {
          if (msg.text().includes('DropFlow')) L('[EBAY] ' + msg.text().substring(0, 500));
        });
        ebayPageConsole = true;
      }
    }
    
    // Check fill results
    try {
      const results = await lister.evaluate(() =>
        chrome.storage.local.get('dropflow_last_fill_results').then(d => d.dropflow_last_fill_results)
      ).catch(() => null);
      if (results) {
        L('✅ FILL RESULTS: ' + JSON.stringify(results, null, 2));
        
        // Check photo status specifically
        const photosOk = results.images === true;
        L(photosOk ? '🖼️ PHOTOS: PERSISTED ✅' : '🖼️ PHOTOS: MISSING ❌');
        
        break;
      }
    } catch (_) {}
    
    // Check for ALI_BULK_LISTING_COMPLETE
    try {
      const complete = await lister.evaluate(() => {
        return new Promise(resolve => {
          // Check if there's a stored result
          chrome.storage.local.get('dropflow_bulk_last_result').then(d => resolve(d.dropflow_bulk_last_result || null));
        });
      }).catch(() => null);
    } catch(_) {}
    
    if (tick % 6 === 0) {
      const tabInfo = urls.filter(u => u.includes('ebay') || u.includes('aliexpress')).map(u => u.substring(0, 60));
      L('Tick ' + tick + ' (' + (tick*5) + 's) tabs: [' + tabInfo.join(', ') + ']');
    }
  }
  
  // Write report
  fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PHOTO-PERSIST-FIX.md',
    '# Photo Persist Fix Test\n\n## Run: ' + new Date().toISOString() + '\n\n```\n' + log.join('\n') + '\n```\n'
  );
  L('Report written');
  
  browser.disconnect();
})().catch(e => { L('FATAL: ' + e.message); console.error(e); });
