// Real test v3: Let the extension scrape, but handle eBay listing manually to control variations
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  let pages = await browser.pages();
  const extPage = pages.find(p => p.url().includes(EXT_ID)) || pages[0];
  
  // Step 1: Scrape AliExpress product directly using the content script
  log('Step 1: Opening AliExpress product and scraping...');
  const aliPage = await browser.newPage();
  await aliPage.goto('https://www.aliexpress.com/item/1005009953521226.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(10000); // Let page fully load
  
  // Inject content script and scrape
  const scrapeResult = await extPage.evaluate(async (tabId) => {
    // Inject the content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/aliexpress/product-scraper.js']
      });
    } catch(e) { return { error: 'inject failed: ' + e.message }; }
    
    await new Promise(r => setTimeout(r, 3000));
    
    // Now send scrape message
    try {
      const data = await chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_ALIEXPRESS_PRODUCT' });
      return data;
    } catch(e) { return { error: 'scrape failed: ' + e.message }; }
  }, (await aliPage.target()._targetId ? null : null));
  
  // Get the tab ID properly
  const aliTabId = await extPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: '*://www.aliexpress.com/*' });
    return tabs[0]?.id;
  });
  log('AliExpress tab ID: ' + aliTabId);
  
  // Inject and scrape via extension APIs
  await extPage.evaluate(async (tabId) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/aliexpress/product-scraper.js']
      });
    } catch(e) { console.log('inject err:', e.message); }
  }, aliTabId);
  await sleep(5000);
  
  let productData = await extPage.evaluate(async (tabId) => {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_ALIEXPRESS_PRODUCT' });
    } catch(e) { return { error: e.message }; }
  }, aliTabId);
  
  log('Scrape result: ' + JSON.stringify(productData).substring(0, 500));
  
  if (productData?.error || !productData?.title) {
    log('Content script scrape failed, trying MAIN world extraction...');
    
    // Try MAIN world extraction
    const mainWorldResult = await extPage.evaluate(async (tabId) => {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
            // Try to get data from page's JS objects
            const data = {};
            if (window.runParams) data.runParams = JSON.stringify(window.runParams).substring(0, 2000);
            if (window.__INIT_STORE_DATA__) data.initStore = JSON.stringify(window.__INIT_STORE_DATA__).substring(0, 2000);
            
            // Try script tags
            const scripts = document.querySelectorAll('script');
            for (const s of scripts) {
              const t = s.textContent || '';
              if (t.includes('skuModule') || t.includes('skuPriceList')) {
                data.skuScript = t.substring(0, 2000);
                break;
              }
            }
            
            // DOM fallback
            data.title = document.querySelector('h1')?.textContent?.trim();
            data.priceText = document.querySelector('[class*="price"]')?.textContent?.trim();
            
            return data;
          }
        });
        return results[0]?.result;
      } catch(e) { return { error: e.message }; }
    }, aliTabId);
    
    log('MAIN world result: ' + JSON.stringify(mainWorldResult).substring(0, 500));
  }
  
  // If scrape succeeded, check for variations
  if (productData && !productData.error) {
    log(`Product: "${productData.title}"`);
    log(`Price: $${productData.price}`);
    log(`HasVariations: ${productData.variations?.hasVariations}`);
    log(`Axes: ${productData.variations?.axes?.length || 0}`);
    log(`SKUs: ${productData.variations?.skus?.length || 0}`);
    
    if (productData.variations?.skus) {
      log('SKU sample: ' + JSON.stringify(productData.variations.skus.slice(0, 3)));
    }
    
    fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/scraped-product-data.json', JSON.stringify(productData, null, 2));
    log('Full product data saved to scraped-product-data.json');
  }
  
  // Close AliExpress tab
  await aliPage.close().catch(() => {});
  
  // Step 2: Apply markup to create eBay prices
  const markup = 1.30;
  if (productData?.variations?.skus) {
    for (const sku of productData.variations.skus) {
      sku.ebayPrice = Math.round(sku.price * markup * 100) / 100;
    }
  }
  const baseEbayPrice = productData?.price ? Math.round(productData.price * markup * 100) / 100 : 14.99;
  productData.ebayPrice = baseEbayPrice;
  
  // Step 3: Store pending data and open eBay prelist
  log('Step 2: Opening eBay prelist...');
  const ebayPage = await browser.newPage();
  
  // Get the tab ID for storage key
  const ebayTabId = await extPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: '*://www.ebay.com.au/*' });
    // Find the newest tab
    if (tabs.length === 0) {
      // Create tab via chrome.tabs to get the ID
      return null;
    }
    return tabs[tabs.length - 1]?.id;
  });
  
  await ebayPage.goto('https://www.ebay.com.au/sl/prelist/suggest', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);
  
  // Get actual tab ID
  const realEbayTabId = await extPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: '*://www.ebay.com.au/*' });
    return tabs[0]?.id;
  });
  log('eBay tab ID: ' + realEbayTabId);
  
  // Store pending data
  const storageKey = `pendingListing_${realEbayTabId}`;
  await extPage.evaluate(async (key, data) => {
    await new Promise(r => chrome.storage.local.set({ [key]: data }, r));
  }, storageKey, productData);
  log('Stored pending data under ' + storageKey);
  
  // Step 4: Inject form-filler content script
  await extPage.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content-scripts/ebay/form-filler.js']
    });
  }, realEbayTabId);
  log('Form filler injected');
  
  // Step 5: Monitor for 5 minutes
  log('Step 3: Monitoring form fill progress...');
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    
    pages = await browser.pages();
    const currentEbay = pages.find(p => p.url().includes('ebay.com.au'));
    if (!currentEbay) {
      log('eBay page gone! Checking...');
      continue;
    }
    
    const url = currentEbay.url();
    
    if (i % 3 === 0) {
      log(`[${i*5}s] ${url.substring(0, 100)}`);
    }
    
    // If we're on the form page, check for variations
    if (url.includes('/lstng')) {
      const formState = await currentEbay.evaluate(() => {
        const text = document.body?.innerText || '';
        const hasVar = text.includes('VARIATION');
        const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({ src: f.src?.substring(0, 100), h: f.offsetHeight }));
        const bulkeditFrame = iframes.find(f => f.src?.includes('bulkedit'));
        return { hasVar, iframes, bulkeditFrame, titleSnippet: text.substring(0, 200) };
      });
      
      if (i % 6 === 0) log('  Form state: ' + JSON.stringify(formState).substring(0, 300));
      
      // Check bulkedit iframe for variation table
      const frames = currentEbay.frames();
      for (const frame of frames) {
        if (frame.url().includes('bulkedit')) {
          const varTable = await frame.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const priceInputs = inputs.filter(i => {
              const l = (i.getAttribute('aria-label') || i.name || i.id || '').toLowerCase();
              return (l.includes('price') || l.includes('prc'));
            });
            return { inputCount: inputs.length, priceInputCount: priceInputs.length };
          }).catch(() => null);
          
          if (varTable) {
            log(`  Bulkedit iframe: ${varTable.inputCount} inputs, ${varTable.priceInputCount} price inputs`);
            if (varTable.priceInputCount > 2) {
              log('VARIATION TABLE WITH PRICES FOUND!');
              // Extract full data
              const fullData = await frame.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('input'));
                return inputs.filter(i => i.value).map(i => ({
                  id: (i.id || i.name || '').substring(0, 40),
                  label: (i.getAttribute('aria-label') || '').substring(0, 40),
                  value: i.value
                }));
              });
              log('All filled inputs: ' + JSON.stringify(fullData));
              fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/variation-table-data.json', JSON.stringify(fullData, null, 2));
            }
          }
        }
      }
    }
  }
  
  log('Monitoring complete');
  browser.disconnect();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
