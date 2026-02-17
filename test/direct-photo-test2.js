/**
 * Direct photo persistence test v2.
 * Uses page title as fallback when scraper returns empty title.
 */
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = require('fs');
const EXT = 'hikiofeedjngalncoapgpmljpaoeolci';
const WS = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const log = [];
function L(msg) { const t = new Date().toISOString().substr(11,12); const line = `[${t}] ${msg}`; console.log(line); log.push(line); }

async function ensureSW(browser) {
  let targets = await browser.targets();
  let sw = targets.find(t => t.url().includes(EXT) && t.type() === 'service_worker');
  if (sw) return sw;
  const p = await browser.newPage();
  await p.goto('chrome-extension://' + EXT + '/background/service-worker.js');
  await sleep(3000);
  await p.close();
  targets = await browser.targets();
  return targets.find(t => t.url().includes(EXT) && t.type() === 'service_worker');
}

async function swEval(swCdp, expr) {
  const r = await swCdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true });
  return r.result?.value;
}

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // Clean up
  L('Cleaning...');
  const pages = await browser.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close().catch(() => {});
  
  // Reload ext
  const firstPage = (await browser.pages())[0];
  await firstPage.goto('chrome-extension://' + EXT + '/pages/popup/popup.html');
  await sleep(2000);
  try { await firstPage.evaluate(() => chrome.runtime.reload()); } catch(_) {}
  await sleep(5000);
  
  let sw = await ensureSW(browser);
  L('SW: ' + (sw ? 'ALIVE' : 'DEAD'));
  if (!sw) { L('FATAL'); process.exit(1); }
  
  // Step 1: Scrape AliExpress
  L('Scraping AliExpress...');
  const aliPage = await browser.newPage();
  await aliPage.goto('https://www.aliexpress.com/item/1005006995032850.html', { 
    waitUntil: 'domcontentloaded', timeout: 30000 
  }).catch(() => {});
  await sleep(10000);
  
  sw = await ensureSW(browser);
  const swCdp = await sw.createCDPSession();
  
  // Get tab ID and inject
  const aliTabId = await swEval(swCdp, 
    `chrome.tabs.query({url: '*://www.aliexpress.com/item/*'}).then(tabs => tabs[0]?.id || null)`
  );
  L('Ali tab: ' + aliTabId);
  
  await swEval(swCdp, `chrome.scripting.executeScript({
    target: { tabId: ${aliTabId} },
    files: ['content-scripts/aliexpress/product-scraper.js']
  }).then(() => 'ok').catch(e => e.message)`);
  await sleep(5000);
  
  // Scrape - get full data
  const rawData = await swEval(swCdp, 
    `chrome.tabs.sendMessage(${aliTabId}, { type: 'SCRAPE_ALIEXPRESS_PRODUCT' }).then(r => JSON.stringify(r)).catch(e => JSON.stringify({error: e.message}))`
  );
  let productData = JSON.parse(rawData || '{}');
  
  // Fallback title from page
  if (!productData.title) {
    const pageTitle = await aliPage.title().catch(() => '');
    productData.title = pageTitle.replace(/\s*[-–|]?\s*AliExpress.*$/i, '').trim();
    L('Using page title: ' + productData.title.substring(0, 60));
  }
  
  L('Product: "' + (productData.title || '').substring(0,50) + '" imgs=' + (productData.images?.length || 0));
  
  // Set pricing
  productData.ebayPrice = Math.max(+(parseFloat(productData.price || 10) * 1.3).toFixed(2), 12.99);
  productData.ebayTitle = (productData.title || 'LED Dog Leash Nylon Safety Glow In Dark').substring(0, 80);
  
  await aliPage.close();
  L('Ali closed');
  
  // Step 2: Open eBay prelist
  L('Opening eBay...');
  const ebayPage = await browser.newPage();
  ebayPage.on('console', msg => {
    if (msg.text().includes('DropFlow')) L('[EBAY] ' + msg.text().substring(0, 500));
  });
  
  await ebayPage.goto('https://www.ebay.com.au/sl/prelist/suggest', { 
    waitUntil: 'domcontentloaded', timeout: 60000 
  }).catch(() => {});
  await sleep(3000);
  
  sw = await ensureSW(browser);
  const swCdp2 = await sw.createCDPSession();
  
  const ebayTabId = await swEval(swCdp2,
    `chrome.tabs.query({url: '*://*.ebay.com.au/*'}).then(tabs => tabs[0]?.id || null)`
  );
  L('eBay tab: ' + ebayTabId);
  
  // Store pending data using proper JSON serialization
  const dataStr = JSON.stringify(productData);
  await swCdp2.send('Runtime.evaluate', {
    expression: `(async () => {
      const data = JSON.parse(${JSON.stringify(dataStr)});
      await chrome.storage.local.set({ 'pendingListing_${ebayTabId}': data });
      return 'stored';
    })()`,
    awaitPromise: true
  });
  L('Data stored for tab ' + ebayTabId);
  
  // Inject form filler
  const injectResult = await swEval(swCdp2, `chrome.scripting.executeScript({
    target: { tabId: ${ebayTabId}, allFrames: true },
    files: ['content-scripts/ebay/form-filler.js']
  }).then(() => 'injected').catch(e => e.message)`);
  L('Form filler: ' + injectResult);
  
  // Also start SW keepalive
  await swCdp2.send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        if (chrome.offscreen) {
          await chrome.offscreen.createDocument({
            url: 'pages/offscreen/keepalive.html',
            reasons: ['WORKERS'],
            justification: 'Keep alive during listing'
          });
        }
      } catch(_) {}
      if (typeof navigator !== 'undefined' && navigator.locks) {
        navigator.locks.request('dropflow-keepalive-lock', { mode: 'exclusive' }, () => 
          new Promise(() => {})
        );
      }
      chrome.alarms.create('dropflow-keepalive', { periodInMinutes: 0.5 });
      return 'keepalive started';
    })()`,
    awaitPromise: true
  });
  L('SW keepalive started manually');
  
  await swCdp2.detach().catch(() => {});
  
  // Step 3: Monitor
  L('Monitoring form fill...');
  const lister = (await browser.pages()).find(p => p.url().includes(EXT));
  
  for (let tick = 0; tick < 96; tick++) {
    await sleep(5000);
    await ensureSW(browser).catch(() => null);
    
    try {
      if (lister) {
        const results = await lister.evaluate(() =>
          chrome.storage.local.get('dropflow_last_fill_results').then(d => d.dropflow_last_fill_results)
        ).catch(() => null);
        if (results) {
          L('✅ FILL RESULTS:\n' + JSON.stringify(results, null, 2));
          L(results.images ? '🖼️ PHOTOS PERSISTED ✅' : '🖼️ PHOTOS MISSING ❌');
          break;
        }
      }
    } catch(_) {}
    
    if (tick % 6 === 0) {
      const allPages = await browser.pages();
      const ebayUrls = allPages.filter(p => p.url().includes('ebay')).map(p => p.url().substring(0, 80));
      L('Tick ' + tick + ' (' + (tick*5) + 's) eBay: [' + ebayUrls.join(', ') + ']');
    }
  }
  
  fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PHOTO-PERSIST-FIX.md',
    '# Photo Persist Fix Test\n\n## Run: ' + new Date().toISOString() + '\n\n```\n' + log.join('\n') + '\n```\n'
  );
  L('Report written');
  browser.disconnect();
})().catch(e => { L('FATAL: ' + e.message); console.error(e); });
