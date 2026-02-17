/**
 * Direct photo persistence test.
 * Manually scrapes AliExpress, stores data, opens eBay, and monitors form fill.
 * Handles SW deaths by periodically waking it.
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

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // Clean up all tabs
  L('Cleaning...');
  const pages = await browser.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close().catch(() => {});
  
  // Reload extension  
  L('Reloading extension...');
  const firstPage = (await browser.pages())[0];
  await firstPage.goto('chrome-extension://' + EXT + '/pages/popup/popup.html');
  await sleep(2000);
  try { await firstPage.evaluate(() => chrome.runtime.reload()); } catch(_) {}
  await sleep(5000);
  
  let sw = await ensureSW(browser);
  L('SW: ' + (sw ? 'ALIVE' : 'DEAD'));
  
  // Step 1: Scrape AliExpress manually via puppeteer
  L('Step 1: Scraping AliExpress...');
  const aliPage = await browser.newPage();
  aliPage.setDefaultTimeout(30000);
  await aliPage.goto('https://www.aliexpress.com/item/1005006995032850.html', { 
    waitUntil: 'domcontentloaded', timeout: 30000 
  });
  await sleep(8000); // Let content load
  
  // Force inject content script
  sw = await ensureSW(browser);
  if (sw) {
    const swCdp = await sw.createCDPSession();
    const aliTabId = await new Promise(async (resolve) => {
      const targets = await browser.targets();
      for (const t of targets) {
        if (t.url().includes('aliexpress.com/item')) {
          // Get tab ID via CDP
          const r = await swCdp.send('Runtime.evaluate', {
            expression: `chrome.tabs.query({url: '*://www.aliexpress.com/item/*'}).then(tabs => tabs[0]?.id || null)`,
            awaitPromise: true
          });
          resolve(r.result?.value);
          return;
        }
      }
      resolve(null);
    });
    L('Ali tab ID: ' + aliTabId);
    
    if (aliTabId) {
      await swCdp.send('Runtime.evaluate', {
        expression: `chrome.scripting.executeScript({
          target: { tabId: ${aliTabId} },
          files: ['content-scripts/aliexpress/product-scraper.js']
        }).then(() => 'ok').catch(e => e.message)`,
        awaitPromise: true
      });
      L('Content script injected');
      await sleep(3000);
      
      // Scrape
      const scrapeResult = await swCdp.send('Runtime.evaluate', {
        expression: `chrome.tabs.sendMessage(${aliTabId}, { type: 'SCRAPE_ALIEXPRESS_PRODUCT' }).then(r => JSON.stringify({
          title: r?.title?.substring(0,60),
          images: r?.images?.length || 0,
          price: r?.price,
          hasVar: r?.variations?.hasVariations,
          skus: r?.variations?.skus?.length || 0
        })).catch(e => JSON.stringify({error: e.message}))`,
        awaitPromise: true
      });
      const scrapeData = JSON.parse(scrapeResult.result?.value || '{}');
      L('Scrape: ' + JSON.stringify(scrapeData));
      
      if (scrapeData.error) {
        L('Scrape failed, trying MAIN world extraction...');
        await swCdp.send('Runtime.evaluate', {
          expression: `chrome.scripting.executeScript({
            target: { tabId: ${aliTabId} },
            files: ['content-scripts/aliexpress/product-scraper.js']
          }).then(() => 'ok').catch(e => e.message)`,
          awaitPromise: true
        });
        await sleep(5000);
        
        const retry = await swCdp.send('Runtime.evaluate', {
          expression: `chrome.tabs.sendMessage(${aliTabId}, { type: 'SCRAPE_ALIEXPRESS_PRODUCT' }).then(r => JSON.stringify({
            title: r?.title?.substring(0,60),
            images: r?.images?.length || 0,
            price: r?.price,
            hasVar: r?.variations?.hasVariations,
          })).catch(e => JSON.stringify({error: e.message}))`,
          awaitPromise: true
        });
        L('Retry scrape: ' + (retry.result?.value || 'null'));
      }
      
      // Get full product data
      const fullDataResult = await swCdp.send('Runtime.evaluate', {
        expression: `chrome.tabs.sendMessage(${aliTabId}, { type: 'SCRAPE_ALIEXPRESS_PRODUCT' }).then(r => JSON.stringify(r)).catch(e => JSON.stringify({error: e.message}))`,
        awaitPromise: true
      });
      
      const productData = JSON.parse(fullDataResult.result?.value || '{}');
      L('Product: title="' + (productData.title || '').substring(0,50) + '" images=' + (productData.images?.length || 0));
      
      if (!productData.title) {
        L('FATAL: No product data scraped');
        await aliPage.close();
        browser.disconnect();
        return;
      }
      
      // Apply markup
      const price = parseFloat(productData.price) || 10;
      productData.ebayPrice = +(price * 1.3).toFixed(2);
      productData.ebayTitle = (productData.title || '').substring(0, 80);
      
      // Close Ali page
      await aliPage.close();
      L('Ali page closed');
      
      // Step 2: Open eBay prelist and store pending data
      L('Step 2: Opening eBay listing...');
      const ebayTab = await browser.newPage();
      const ebayUrl = 'https://www.ebay.com.au/sl/prelist/suggest';
      
      // Get eBay tab ID
      await ebayTab.goto(ebayUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      sw = await ensureSW(browser);
      const swCdp2 = await sw.createCDPSession();
      
      const ebayTabId = await swCdp2.send('Runtime.evaluate', {
        expression: `chrome.tabs.query({url: '*://*.ebay.com.au/*'}).then(tabs => tabs[0]?.id || null)`,
        awaitPromise: true
      }).then(r => r.result?.value);
      L('eBay tab ID: ' + ebayTabId);
      
      // Store pending data
      const storageKey = 'pendingListing_' + ebayTabId;
      await swCdp2.send('Runtime.evaluate', {
        expression: `chrome.storage.local.set({ '${storageKey}': ${JSON.stringify(JSON.stringify(productData))} }).then(() => 'stored')`,
        awaitPromise: true
      });
      // Actually we need to parse it back since we double-stringified
      await swCdp2.send('Runtime.evaluate', {
        expression: `chrome.storage.local.set({ '${storageKey}': JSON.parse(${JSON.stringify(JSON.stringify(JSON.stringify(productData)))}) }).then(() => 'stored')`,
        awaitPromise: true
      });
      L('Pending data stored');
      
      // Inject form filler
      await swCdp2.send('Runtime.evaluate', {
        expression: `chrome.scripting.executeScript({
          target: { tabId: ${ebayTabId}, allFrames: true },
          files: ['content-scripts/ebay/form-filler.js']
        }).then(() => 'injected').catch(e => e.message)`,
        awaitPromise: true
      });
      L('Form filler injected');
      
      // Monitor eBay page console
      ebayTab.on('console', msg => {
        if (msg.text().includes('DropFlow')) L('[EBAY] ' + msg.text().substring(0, 500));
      });
      
      // Step 3: Monitor for form fill results (up to 8 min)
      L('Step 3: Monitoring form fill...');
      for (let tick = 0; tick < 96; tick++) {
        await sleep(5000);
        
        // Keep SW alive
        await ensureSW(browser).catch(() => null);
        
        // Check results
        try {
          const extPage = (await browser.pages()).find(p => p.url().includes(EXT));
          if (extPage) {
            const results = await extPage.evaluate(() =>
              chrome.storage.local.get('dropflow_last_fill_results').then(d => d.dropflow_last_fill_results)
            ).catch(() => null);
            if (results) {
              L('✅ FILL RESULTS: ' + JSON.stringify(results, null, 2));
              L(results.images ? '🖼️ PHOTOS: PERSISTED ✅' : '🖼️ PHOTOS: MISSING ❌');
              break;
            }
          }
        } catch(_) {}
        
        if (tick % 6 === 0) L('Tick ' + tick + ' (' + (tick*5) + 's)');
      }
    }
    await swCdp.detach().catch(() => {});
  }
  
  // Write report
  fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PHOTO-PERSIST-FIX.md',
    '# Photo Persist Fix Test\n\n## Run: ' + new Date().toISOString() + '\n\n```\n' + log.join('\n') + '\n```\n'
  );
  L('Report written');
  
  browser.disconnect();
})().catch(e => { L('FATAL: ' + e.message); console.error(e); });
