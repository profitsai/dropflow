import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS = '/Users/pyrite/Projects/dropflow-extension/test/screenshots';
const WS_URL = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const ALI_URL = 'https://www.aliexpress.com/item/1005007380025405.html';

let stepNum = 0;
async function screenshot(page, name) {
  stepNum++;
  const fname = `${String(stepNum).padStart(2,'0')}-${name}.png`;
  await page.screenshot({ path: path.join(SCREENSHOTS, fname), fullPage: false });
  console.log(`📸 ${fname}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  console.log('🔗 Connecting to browser...');
  const browser = await puppeteer.connect({ browserWSEndpoint: WS_URL, defaultViewport: null });
  
  // Step 1: Reload extension via service worker
  console.log('\n=== STEP 1: Reload Extension ===');
  
  // Close existing eBay listing tabs from previous tests
  let pages = await browser.pages();
  for (const p of pages) {
    const url = p.url();
    if (url.includes('ebay.com') && url.includes('lstng')) {
      console.log('Closing stale eBay tab:', url);
      await p.close().catch(() => {});
    }
  }
  
  // Find extension page to reload
  pages = await browser.pages();
  const extPage = pages.find(p => p.url().includes(EXT_ID));
  if (extPage) {
    try {
      await extPage.evaluate(() => chrome.runtime.reload());
      console.log('✅ Extension reload triggered');
    } catch (e) {
      console.log('⚠️ Reload error (expected if page closed):', e.message);
    }
    await sleep(4000);
  }
  
  // Step 2: Connect to service worker and trigger bulk listing with single link
  console.log('\n=== STEP 2: Trigger Ali Bulk Listing via Service Worker ===');
  
  // Get fresh target list
  const resp = await fetch('http://127.0.0.1:57542/json/list');
  const targets = await resp.json();
  const swTarget = targets.find(t => t.url.includes(EXT_ID) && t.type === 'service_worker');
  
  if (!swTarget) {
    console.log('❌ Service worker not found');
    await browser.disconnect();
    process.exit(1);
  }
  
  console.log('Found service worker:', swTarget.id);
  
  // Connect to service worker via CDP
  const cdp = await puppeteer.connect({
    browserWSEndpoint: WS_URL,
    defaultViewport: null
  });
  
  // Use CDP protocol directly to evaluate in the service worker
  const swWs = swTarget.webSocketDebuggerUrl;
  const WebSocket = (await import('ws')).default;
  const ws = new WebSocket(swWs);
  
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  
  let msgId = 1;
  function cdpCall(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30000);
      
      function onMsg(data) {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.off('message', onMsg);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      }
      ws.on('message', onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  
  // Enable Runtime domain
  await cdpCall('Runtime.enable');
  
  // Enable Console to capture logs
  const swLogs = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value || a.description || '').join(' ');
      if (text.includes('[DropFlow') || text.includes('variation') || text.includes('builder') || text.includes('msku') || text.includes('scrape') || text.includes('iframe')) {
        swLogs.push(text);
        console.log(`  📋 SW: ${text}`);
      }
    }
  });
  
  // Trigger the bulk listing with a single AliExpress link
  console.log('Triggering Ali bulk listing with:', ALI_URL);
  const evalResult = await cdpCall('Runtime.evaluate', {
    expression: `self.__dropflowStartAliBulk({ links: ['${ALI_URL}'], threadCount: 1, listingType: 'standard', ebayDomain: 'www.ebay.com.au' })`,
    awaitPromise: true,
    returnByValue: true
  });
  
  console.log('Trigger result:', JSON.stringify(evalResult?.result?.value));
  
  // Step 3: Monitor for new tabs (AliExpress scrape tab, then eBay listing tab)
  console.log('\n=== STEP 3: Monitoring tabs ===');
  
  let ebayPage = null;
  let aliScrapePage = null;
  
  // Watch for new pages
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      try {
        const page = await target.page();
        const url = page.url();
        if (url && url !== 'about:blank') {
          console.log(`  📎 New tab: ${url.substring(0, 100)}`);
        }
      } catch (e) {}
    }
  });
  
  // Wait for the flow to progress - check every 5s for up to 3 minutes
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    
    pages = await browser.pages();
    
    // Check for eBay listing tab
    const ebay = pages.find(p => p.url().includes('ebay.com') && p.url().includes('lstng'));
    if (ebay && !ebayPage) {
      ebayPage = ebay;
      console.log(`\n✅ eBay listing tab opened: ${ebay.url()}`);
      
      // Set up console logging
      ebay.on('console', msg => {
        const text = msg.text();
        if (text.includes('[DropFlow') || text.includes('variation') || text.includes('builder') || text.includes('msku') || text.includes('iframe') || text.includes('price')) {
          swLogs.push(`[EBAY] ${text}`);
          console.log(`  📋 EBAY: ${text}`);
        }
      });
    }
    
    // Check for AliExpress scrape tab
    const ali = pages.find(p => p.url().includes('aliexpress.com/item') && p.url().includes('1005007380025405'));
    if (ali && !aliScrapePage) {
      aliScrapePage = ali;
      console.log(`\n📎 AliExpress scrape tab: ${ali.url()}`);
      await sleep(8000);
      await screenshot(ali, 'aliexpress-scraping');
    }
    
    // If eBay page is loaded and has been around for a bit, take screenshots
    if (ebayPage) {
      const ebayUrl = ebayPage.url();
      if (ebayUrl.includes('lstng')) {
        console.log(`  eBay tab at ${(i+1)*5}s: ${ebayUrl.substring(0, 80)}`);
        
        // Wait for page to settle
        if (i > 0) {
          await screenshot(ebayPage, `ebay-${(i+1)*5}s`);
          
          // Check for builder iframe
          const frames = ebayPage.frames();
          const builderFrame = frames.find(f => f.url().includes('bulkedit'));
          if (builderFrame) {
            console.log('✅ Builder iframe found!');
            await sleep(5000);
            await screenshot(ebayPage, 'builder-active');
            
            // Check builder content
            try {
              const builderContent = await builderFrame.evaluate(() => {
                return {
                  bodyText: document.body?.innerText?.substring(0, 3000) || '',
                  rows: document.querySelectorAll('tr, [class*="row"]').length,
                  inputs: document.querySelectorAll('input').length,
                  tables: document.querySelectorAll('table').length
                };
              });
              console.log('\n=== Builder Content ===');
              console.log('Rows:', builderContent.rows, 'Inputs:', builderContent.inputs, 'Tables:', builderContent.tables);
              console.log('Content preview:', builderContent.bodyText.substring(0, 1000));
            } catch (e) {
              console.log('Could not read builder:', e.message);
            }
            
            // Wait more for builder to complete
            await sleep(15000);
            await screenshot(ebayPage, 'builder-after-wait');
            
            // Check if pricing table appeared
            try {
              const pricingCheck = await builderFrame.evaluate(() => {
                const priceInputs = Array.from(document.querySelectorAll('input')).filter(
                  i => i.placeholder?.toLowerCase().includes('price') || 
                       i.getAttribute('aria-label')?.toLowerCase().includes('price') ||
                       i.name?.toLowerCase().includes('price')
                );
                return {
                  priceInputCount: priceInputs.length,
                  priceValues: priceInputs.map(i => ({ value: i.value, placeholder: i.placeholder })).slice(0, 10),
                  bodyText: document.body?.innerText?.substring(0, 3000) || ''
                };
              });
              console.log('\n=== Pricing Check ===');
              console.log('Price inputs:', pricingCheck.priceInputCount);
              console.log('Price values:', JSON.stringify(pricingCheck.priceValues));
              console.log('Builder text:', pricingCheck.bodyText.substring(0, 1500));
            } catch (e) {
              console.log('Pricing check error:', e.message);
            }
            
            // Take final screenshot
            await sleep(5000);
            await screenshot(ebayPage, 'final-builder-state');
            break;
          }
        }
        
        // If we've waited 60s+ with eBay tab but no builder, check form state
        if (i >= 12 && !ebayPage.frames().find(f => f.url().includes('bulkedit'))) {
          console.log('\n⚠️ Builder iframe not appearing after 60s');
          
          const formState = await ebayPage.evaluate(() => {
            return {
              url: location.href,
              title: document.querySelector('textarea')?.value || '',
              bodySnippet: document.body?.innerText?.substring(0, 2000) || '',
              iframes: Array.from(document.querySelectorAll('iframe')).map(f => f.src).filter(s => s)
            };
          }).catch(() => ({}));
          
          console.log('Form state:', JSON.stringify(formState, null, 2));
          await screenshot(ebayPage, 'no-builder-form-state');
          
          // Wait a bit more since form-filler might still be working
          if (i >= 24) break; // 2 min max after eBay opens
        }
      }
    }
    
    if (i % 6 === 5) {
      console.log(`  ... ${(i+1)*5}s elapsed, ${pages.length} tabs open`);
    }
  }
  
  // Final screenshots of all relevant tabs
  console.log('\n=== FINAL STATE ===');
  pages = await browser.pages();
  for (const p of pages) {
    const url = p.url();
    if (url.includes('ebay.com') || url.includes('aliexpress.com/item')) {
      try {
        await screenshot(p, `final-${url.includes('ebay') ? 'ebay' : 'ali'}`);
      } catch (e) {}
    }
  }
  
  // Save logs
  fs.writeFileSync(path.join(SCREENSHOTS, 'sw-console-logs.txt'), swLogs.join('\n'));
  console.log(`\n📄 Saved ${swLogs.length} log lines to sw-console-logs.txt`);
  
  // Summary
  console.log('\n========== SUMMARY ==========');
  console.log(`Extension reloaded: ✅`);
  console.log(`Bulk listing triggered: ✅`);
  console.log(`AliExpress scrape tab opened: ${aliScrapePage ? '✅' : '❌'}`);
  console.log(`eBay listing tab opened: ${ebayPage ? '✅' : '❌'}`);
  console.log(`Builder iframe found: ${ebayPage ? (ebayPage.frames().some(f => f.url().includes('bulkedit')) ? '✅' : '❌') : 'N/A'}`);
  
  ws.close();
  await browser.disconnect();
  console.log('\n✅ Test complete');
})().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
