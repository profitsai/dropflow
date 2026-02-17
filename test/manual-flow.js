const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const extPage = pages.find(p => p.url().includes('ali-bulk-lister'));
  const aliPage = pages.find(p => p.url().includes('aliexpress.com/item'));
  
  if (!extPage || !aliPage) {
    console.error('Missing pages. ext:', !!extPage, 'ali:', !!aliPage);
    process.exit(1);
  }
  
  // Step 1: Force inject scraper on AliExpress page and scrape
  console.log('=== Step 1: Scraping AliExpress ===');
  const tabId = await extPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url: '*://*.aliexpress.com/*' });
    return tabs[0]?.id;
  });
  console.log('AliExpress tab ID:', tabId);
  
  // Inject content script
  const injected = await extPage.evaluate(async (tabId) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        files: ['content-scripts/aliexpress/product-scraper.js']
      });
      return 'ok';
    } catch (e) { return e.message; }
  }, tabId);
  console.log('Inject result:', injected);
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Scrape the product
  const productData = await extPage.evaluate(async (tabId) => {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_ALIEXPRESS_PRODUCT' });
    } catch (e) { return { error: e.message }; }
  }, tabId);
  
  if (productData.error) {
    console.error('Scrape failed:', productData.error);
    process.exit(1);
  }
  
  console.log('Scraped:', productData.title?.substring(0, 60));
  console.log('Price:', productData.price, productData.currency);
  console.log('Images:', productData.images?.length);
  console.log('Variations:', productData.variations?.hasVariations, 
    productData.variations?.axes?.map(a => `${a.name}(${a.values?.length})`).join(', '));
  console.log('SKUs:', productData.variations?.skus?.length || 0);
  
  // Step 2: Generate eBay price (2.5x markup)
  const ebayPrice = Math.ceil(productData.price * 2.5 * 100) / 100;
  console.log('eBay price:', ebayPrice);
  
  // Step 3: Store product data for the form filler
  console.log('\n=== Step 2: Storing data for form filler ===');
  const stored = await extPage.evaluate(async (data, ebayPrice) => {
    // The form filler checks chrome.storage.local for 'pendingProductData'
    const storeData = {
      ...data,
      ebayPrice: ebayPrice,
      source: 'aliexpress',
      sourceUrl: data.aliexpressUrl || window.location?.href,
      listingType: 'standard',
    };
    
    await chrome.storage.local.set({ pendingProductData: storeData });
    return 'stored';
  }, productData, ebayPrice);
  console.log('Storage result:', stored);
  
  // Step 4: Open eBay prelist page
  console.log('\n=== Step 3: Opening eBay prelist ===');
  const newTabId = await extPage.evaluate(async () => {
    const tab = await chrome.tabs.create({ url: 'https://www.ebay.com.au/sl/prelist/suggest', active: true });
    return tab.id;
  });
  console.log('eBay tab ID:', newTabId);
  
  // Monitor form filler tab injection
  const monitorResult = await extPage.evaluate(async (tabId) => {
    // Set up injection listener
    const listener = async (changeTabId, changeInfo, tab) => {
      if (changeTabId !== tabId) return;
      if (changeInfo.status === 'complete' && tab.url && (tab.url.includes('/lstng') || tab.url.includes('/sl/'))) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['content-scripts/ebay/form-filler.js']
          });
          console.log('Force-injected form-filler');
        } catch (e) {
          console.log('Inject failed:', e.message);
        }
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    
    // Auto cleanup after 3 minutes
    setTimeout(() => chrome.tabs.onUpdated.removeListener(listener), 180000);
    return 'monitoring';
  }, newTabId);
  console.log('Monitor:', monitorResult);
  
  // Wait and monitor progress
  console.log('\n=== Step 4: Monitoring form filling ===');
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const currentPages = await browser.pages();
    const ebayPage = currentPages.find(p => p.url().includes('ebay.com.au'));
    if (ebayPage) {
      const url = ebayPage.url();
      console.log(`[${(i+1)*5}s] eBay URL: ${url.substring(0, 100)}`);
      
      if (url.includes('/lstng')) {
        console.log('Form page reached!');
        await ebayPage.screenshot({ path: `form-progress-${i}.png` });
        
        // Check if form filler is running
        const ffStatus = await ebayPage.evaluate(() => {
          return window.__dropflow_form_filler_loaded ? 'loaded' : 'not loaded';
        }).catch(() => 'error');
        console.log('Form filler status:', ffStatus);
        
        if (i > 10) {
          // Take a final screenshot
          await ebayPage.screenshot({ path: 'form-final.png', fullPage: true });
          break;
        }
      }
    } else {
      console.log(`[${(i+1)*5}s] No eBay page yet`);
    }
  }
  
  browser.disconnect();
  console.log('\nDone monitoring');
})().catch(e => { console.error(e.message); process.exit(1); });
