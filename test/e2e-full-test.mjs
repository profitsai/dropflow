import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS = '/Users/pyrite/Projects/dropflow-extension/test/screenshots';
const WS_URL = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const ALI_URL = 'https://www.aliexpress.com/item/1005006995032850.html';

// Clear old screenshots
for (const f of fs.readdirSync(SCREENSHOTS).filter(f => f.endsWith('.png') || f.endsWith('.txt'))) {
  fs.unlinkSync(path.join(SCREENSHOTS, f));
}

let stepNum = 0;
async function screenshot(page, name) {
  stepNum++;
  const fname = `${String(stepNum).padStart(2,'0')}-${name}.png`;
  await page.screenshot({ path: path.join(SCREENSHOTS, fname), fullPage: false });
  console.log(`📸 ${fname}`);
  return fname;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  let msgId = 1;
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30000);
      function onMsg(data) {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) { clearTimeout(timeout); ws.off('message', onMsg); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
      }
      ws.on('message', onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  return { ws, call };
}

(async () => {
  const allLogs = [];
  const log = (msg) => { allLogs.push(msg); console.log(msg); };

  log('🔗 Connecting to browser...');
  const browser = await puppeteer.connect({ browserWSEndpoint: WS_URL, defaultViewport: null });
  
  // === STEP 1: Wake up service worker ===
  log('\n=== STEP 1: Wake Service Worker ===');
  
  // Open extension page and ping SW to wake it
  let pages = await browser.pages();
  let extPage = pages.find(p => p.url().includes(EXT_ID));
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    log('Opened bulk lister page');
  }
  await sleep(2000);
  // Ping to wake SW
  const pingResult = await extPage.evaluate(async () => {
    try {
      return await chrome.runtime.sendMessage({ type: 'KEEPALIVE_PING' });
    } catch (e) { return { error: e.message }; }
  });
  log(`SW ping: ${JSON.stringify(pingResult)}`);
  await sleep(2000);
  
  // Verify SW is up
  let targets = await (await fetch('http://127.0.0.1:57542/json/list')).json();
  let swTarget = targets.find(t => t.url.includes(EXT_ID) && t.type === 'service_worker');
  if (!swTarget) {
    log('❌ Service worker still not up. Aborting.');
    await browser.disconnect();
    process.exit(1);
  }
  log(`✅ Service worker active: ${swTarget.id}`);
  
  // Connect CDP to SW for logging
  const { ws: swWs, call: swCall } = await cdpConnect(swTarget.webSocketDebuggerUrl);
  await swCall('Runtime.enable');
  
  // Capture SW console
  swWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
        if (text.includes('[DropFlow') || text.includes('variation') || text.includes('builder') || 
            text.includes('msku') || text.includes('scrape') || text.includes('iframe') || 
            text.includes('form-filler') || text.includes('Draft') || text.includes('price')) {
          allLogs.push(`[SW] ${text}`);
          console.log(`  📋 SW: ${text.substring(0, 200)}`);
        }
      }
    } catch {}
  });
  
  // === STEP 2: Trigger bulk listing ===
  log('\n=== STEP 2: Trigger Ali Bulk Listing ===');
  log(`Product: ${ALI_URL}`);
  
  const triggerResult = await swCall('Runtime.evaluate', {
    expression: `self.__dropflowStartAliBulk({ links: ['${ALI_URL}'], threadCount: 1, listingType: 'standard', ebayDomain: 'www.ebay.com.au' })`,
    awaitPromise: true,
    returnByValue: true
  });
  log(`Trigger result: ${JSON.stringify(triggerResult?.result?.value)}`);
  
  // === STEP 3: Monitor flow ===
  log('\n=== STEP 3: Monitoring flow ===');
  
  let ebayPage = null;
  let aliScrapePage = null;
  let builderFound = false;
  let builderContent = null;
  
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      try {
        const p = await target.page();
        const url = await p.url();
        if (url && url !== 'about:blank') log(`  📎 New tab: ${url.substring(0, 100)}`);
      } catch {}
    }
  });
  
  for (let tick = 0; tick < 60; tick++) { // 5 min max
    await sleep(5000);
    
    pages = await browser.pages();
    
    // Find AliExpress scrape tab
    if (!aliScrapePage) {
      const ali = pages.find(p => p.url().includes('aliexpress.com/item/1005006995032850') && p !== extPage);
      if (ali) {
        aliScrapePage = ali;
        log(`📎 AliExpress scrape tab found`);
        await sleep(5000);
        await screenshot(ali, 'aliexpress-scraping');
      }
    }
    
    // Find eBay listing tab
    if (!ebayPage) {
      const ebay = pages.find(p => p.url().includes('ebay.com') && p.url().includes('lstng'));
      if (ebay) {
        ebayPage = ebay;
        log(`\n✅ eBay listing tab opened: ${ebay.url().substring(0, 100)}`);
        
        // Set up console logging on eBay page
        ebay.on('console', msg => {
          const text = msg.text();
          if (text.includes('[DropFlow') || text.includes('variation') || text.includes('builder') || 
              text.includes('msku') || text.includes('iframe') || text.includes('price') ||
              text.includes('form-filler') || text.includes('Draft')) {
            allLogs.push(`[EBAY] ${text}`);
            console.log(`  📋 EBAY: ${text.substring(0, 200)}`);
          }
        });
        
        await sleep(5000);
        await screenshot(ebay, 'ebay-listing-initial');
      }
    }
    
    // Monitor eBay page progress
    if (ebayPage) {
      // Check for builder iframe
      if (!builderFound) {
        const frames = ebayPage.frames();
        const builderFrame = frames.find(f => f.url().includes('bulkedit'));
        if (builderFrame) {
          builderFound = true;
          log(`\n✅ Builder iframe found: ${builderFrame.url().substring(0, 100)}`);
          await sleep(3000);
          await screenshot(ebayPage, 'builder-iframe-loaded');
          
          // Monitor builder for up to 60s
          for (let bTick = 0; bTick < 12; bTick++) {
            await sleep(5000);
            
            try {
              builderContent = await builderFrame.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('input'));
                const priceInputs = inputs.filter(i => 
                  i.type === 'text' && (
                    i.placeholder?.toLowerCase().includes('price') ||
                    i.getAttribute('aria-label')?.toLowerCase().includes('price') ||
                    i.closest('[class*="price"]')
                  )
                );
                const filledPriceInputs = priceInputs.filter(i => i.value && i.value !== '');
                const allFilledInputs = inputs.filter(i => i.value && i.value !== '');
                
                return {
                  bodyText: document.body?.innerText?.substring(0, 4000) || '',
                  totalInputs: inputs.length,
                  priceInputCount: priceInputs.length,
                  filledPriceCount: filledPriceInputs.length,
                  filledPriceValues: filledPriceInputs.map(i => i.value).slice(0, 20),
                  allFilledCount: allFilledInputs.length,
                  tables: document.querySelectorAll('table').length,
                  rows: document.querySelectorAll('tr').length,
                  hasOptionsSelected: document.body?.innerText?.includes('options you\'ve selected') || false,
                  hasCombinations: document.body?.innerText?.includes('Combinations') || document.body?.innerText?.includes('combinations') || false,
                  hasContinue: !!document.querySelector('button')
                };
              });
              
              log(`  Builder @${(bTick+1)*5}s: inputs=${builderContent.totalInputs}, priceInputs=${builderContent.priceInputCount}, filled=${builderContent.filledPriceCount}, rows=${builderContent.rows}, tables=${builderContent.tables}`);
              
              if (builderContent.hasCombinations || builderContent.filledPriceCount > 0) {
                log('✅ Combinations/prices detected!');
                await screenshot(ebayPage, 'builder-with-prices');
                break;
              }
              
              // Take periodic screenshots
              if (bTick === 3 || bTick === 7) {
                await screenshot(ebayPage, `builder-progress-${(bTick+1)*5}s`);
              }
            } catch (e) {
              log(`  Builder read error: ${e.message}`);
            }
          }
          
          // Final builder screenshot
          await screenshot(ebayPage, 'builder-final');
          
          // Log full builder text
          if (builderContent) {
            log('\n=== Builder Content ===');
            log(builderContent.bodyText.substring(0, 2000));
            log(`\nPrice values found: ${JSON.stringify(builderContent.filledPriceValues)}`);
          }
        }
      }
      
      // Also check form fields
      if (tick % 4 === 3) {
        try {
          const formState = await ebayPage.evaluate(() => {
            const textareas = Array.from(document.querySelectorAll('textarea'));
            const titleEl = textareas.find(t => t.value && t.value.length > 10);
            const iframes = Array.from(document.querySelectorAll('iframe')).map(f => f.src).filter(s => s && !s.startsWith('about:'));
            return {
              title: titleEl?.value || 'NONE',
              iframeUrls: iframes.map(u => u.substring(0, 100)),
              url: location.href
            };
          });
          log(`  Form @${(tick+1)*5}s: title="${formState.title.substring(0, 60)}", iframes=${formState.iframeUrls.length}`);
          if (formState.iframeUrls.length > 0) {
            log(`  Iframes: ${formState.iframeUrls.join(', ')}`);
          }
        } catch {}
      }
      
      // If builder was found and we've checked it, we can stop
      if (builderFound && builderContent) {
        break;
      }
      
      // Timeout: 2 min after eBay tab opened without builder
      if (tick > 24 && !builderFound) {
        log('⚠️ Builder not found after 2+ min with eBay tab');
        await screenshot(ebayPage, 'ebay-no-builder-timeout');
        
        // Check form state in detail
        try {
          const fullState = await ebayPage.evaluate(() => ({
            url: location.href,
            bodySnippet: document.body?.innerText?.substring(0, 3000),
            iframes: Array.from(document.querySelectorAll('iframe')).map(f => ({ src: f.src?.substring(0, 150), visible: f.offsetParent !== null }))
          }));
          log('\n=== eBay Form State (no builder) ===');
          log(`URL: ${fullState.url}`);
          log(`Iframes: ${JSON.stringify(fullState.iframes, null, 2)}`);
          log(`Body: ${fullState.bodySnippet?.substring(0, 1500)}`);
        } catch {}
        break;
      }
    }
    
    if (tick % 6 === 5) log(`  ... ${(tick+1)*5}s elapsed, ${pages.length} tabs open`);
  }
  
  // === FINAL ===
  log('\n========== FINAL SUMMARY ==========');
  log(`AliExpress scrape tab: ${aliScrapePage ? '✅' : '❌'}`);
  log(`eBay listing opened: ${ebayPage ? '✅' : '❌'}`);
  log(`Builder iframe found: ${builderFound ? '✅' : '❌'}`);
  if (builderContent) {
    log(`Builder has combinations: ${builderContent.hasCombinations ? '✅' : '❌'}`);
    log(`Price inputs: ${builderContent.priceInputCount}`);
    log(`Filled prices: ${builderContent.filledPriceCount}`);
    log(`Price values: ${JSON.stringify(builderContent.filledPriceValues)}`);
  }
  
  // Save logs
  fs.writeFileSync(path.join(SCREENSHOTS, 'full-test-logs.txt'), allLogs.join('\n'));
  log(`📄 Saved ${allLogs.length} log entries`);
  
  swWs.close();
  await browser.disconnect();
  log('\n✅ Test complete');
})().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
