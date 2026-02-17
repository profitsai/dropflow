const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  let pages = await browser.pages();
  log(`Connected. ${pages.length} tabs.`);
  
  // Close any existing eBay tabs (but not the ext page)
  for (const p of pages) {
    if (p.url().includes('ebay.com.au')) await p.close().catch(() => {});
  }
  
  // Step 1: Reload extension (with our patched SW)
  const tab = pages[0].url().includes(EXT_ID) ? pages[0] : pages[pages.length - 1];
  await tab.goto('chrome://extensions', { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);
  await tab.evaluate((extId) => {
    const mgr = document.querySelector('extensions-manager');
    const itemList = mgr?.shadowRoot?.querySelector('extensions-item-list');
    const items = itemList?.shadowRoot?.querySelectorAll('extensions-item') || [];
    for (const item of items) {
      if (item.id === extId) item.shadowRoot?.querySelector('#dev-reload-button')?.click();
    }
  }, EXT_ID);
  await sleep(3000);
  log('Extension reloaded');
  
  // Navigate to ext page
  await tab.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);
  
  // Set markup
  await tab.evaluate(async () => {
    await new Promise(r => chrome.storage.local.set({'dropflow_price_markup': 30, 'priceMarkup': 30}, r));
  });
  
  // Step 2: Trigger scrape
  log('Triggering scrape...');
  const result = await tab.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: ['https://www.aliexpress.com/item/1005009953521226.html'],
        ebayDomain: 'www.ebay.com.au',
        listingType: 'standard',
        threadCount: 1
      }, (response) => resolve(response || 'no response'));
      setTimeout(() => resolve('timeout'), 5000);
    });
  });
  log('Trigger result: ' + JSON.stringify(result));
  
  // Step 3: Monitor — watch storage for the pending listing data to see what was scraped
  log('Monitoring...');
  let scrapedData = null;
  let ebayFormReady = false;
  
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    
    pages = await browser.pages();
    const urls = pages.map(p => p.url().substring(0, 100));
    
    // Check storage every 10s
    if (i % 2 === 0) {
      const extTab = pages.find(p => p.url().includes(EXT_ID));
      if (extTab) {
        const storageInfo = await extTab.evaluate(async () => {
          const d = await new Promise(r => chrome.storage.local.get(null, r));
          const result = {};
          for (const [k, v] of Object.entries(d)) {
            if (k.startsWith('pendingListing_')) {
              result[k] = JSON.stringify(v).substring(0, 500);
            }
            if (k === 'dropflow_last_fill_results') {
              result[k] = JSON.stringify(v).substring(0, 500);
            }
          }
          return { keys: Object.keys(d), relevant: result };
        }).catch(() => null);
        
        if (storageInfo) {
          const pendingKeys = Object.keys(storageInfo.relevant);
          if (pendingKeys.length > 0) {
            log(`[${i*5}s] Storage: ${JSON.stringify(storageInfo.relevant).substring(0, 400)}`);
          }
          
          // Save pending data if found
          for (const k of pendingKeys) {
            if (k.startsWith('pendingListing_') && !scrapedData) {
              const fullData = await extTab.evaluate(async (key) => {
                const d = await new Promise(r => chrome.storage.local.get(key, r));
                return d[key];
              }, k);
              scrapedData = fullData;
              fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/scraped-product-data.json', JSON.stringify(fullData, null, 2));
              log('SCRAPED DATA CAPTURED! hasVariations=' + fullData?.variations?.hasVariations);
              log('Axes: ' + JSON.stringify(fullData?.variations?.axes?.map(a => a.name)));
              log('SKUs: ' + fullData?.variations?.skus?.length);
              if (fullData?.variations?.skus?.length > 0) {
                log('Sample SKU: ' + JSON.stringify(fullData.variations.skus[0]));
              }
            }
          }
        }
      }
    }
    
    // Log URLs every 30s
    if (i % 6 === 0) {
      log(`[${i*5}s] ${urls.length} tabs: ${urls.join(' | ')}`);
    }
    
    // Check for eBay listing form
    const ebayPage = pages.find(p => p.url().includes('ebay.com.au/lstng'));
    if (ebayPage && !ebayFormReady) {
      ebayFormReady = true;
      log('eBay form page detected!');
    }
    
    if (ebayPage) {
      // Check for variation section and bulkedit iframe
      const frames = ebayPage.frames();
      const bulkeditFrame = frames.find(f => f.url().includes('bulkedit'));
      
      if (bulkeditFrame) {
        const tableState = await bulkeditFrame.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input'));
          const priceInputs = inputs.filter(i => {
            const l = (i.getAttribute('aria-label') || i.name || i.id || '').toLowerCase();
            return l.includes('price') || l.includes('prc');
          });
          const qtyInputs = inputs.filter(i => {
            const l = (i.getAttribute('aria-label') || i.name || i.id || '').toLowerCase();
            return l.includes('qty') || l.includes('quantity');
          });
          return {
            totalInputs: inputs.length,
            priceInputs: priceInputs.length,
            qtyInputs: qtyInputs.length,
            filledPrices: priceInputs.filter(i => i.value && parseFloat(i.value) > 0).map(i => ({ id: i.id?.substring(0,30), v: i.value })),
            filledQtys: qtyInputs.filter(i => i.value !== '').map(i => ({ id: i.id?.substring(0,30), v: i.value }))
          };
        }).catch(() => null);
        
        if (tableState) {
          log(`  Bulkedit: ${tableState.totalInputs} inputs, ${tableState.priceInputs} prices, ${tableState.qtyInputs} qtys`);
          if (tableState.filledPrices.length > 0) {
            log('  PRICES: ' + JSON.stringify(tableState.filledPrices));
            log('  QTYS: ' + JSON.stringify(tableState.filledQtys));
          }
        }
      }
      
      // Check if EBAY_FORM_FILLED was sent
      const fillResults = await (pages.find(p => p.url().includes(EXT_ID)))?.evaluate(async () => {
        const d = await new Promise(r => chrome.storage.local.get('dropflow_last_fill_results', r));
        return d.dropflow_last_fill_results;
      }).catch(() => null);
      
      if (fillResults) {
        log('FORM FILL RESULTS: ' + JSON.stringify(fillResults).substring(0, 500));
        
        // Take screenshots
        await ebayPage.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/real-test-form.png', fullPage: true });
        
        // Check form state
        const formState = await ebayPage.evaluate(() => {
          const text = document.body?.innerText || '';
          return {
            hasVariations: text.includes('VARIATION'),
            hasVarEdit: text.includes('VariationsEdit') || text.includes('Variations\nEdit'),
            url: window.location.href
          };
        });
        log('Form: ' + JSON.stringify(formState));
        
        // If variations exist but weren't filled, we'll handle manually
        if (formState.hasVariations && !fillResults.variations) {
          log('VARIATIONS NOT FILLED BY EXTENSION — will handle manually');
        }
        
        break; // Exit monitoring loop
      }
    }
  }
  
  log('Monitoring phase complete');
  browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
