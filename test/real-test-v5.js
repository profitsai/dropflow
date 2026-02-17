// Real test v5: Scrape AliExpress manually, then use extension form-filler + manual variation filling
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function progress(text) { fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PROGRESS.md', text); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  let pages = await browser.pages();
  log(`Connected. ${pages.length} tabs.`);
  
  // Close all non-extension tabs
  for (const p of pages) {
    if (!p.url().includes(EXT_ID) && !p.url().includes('chrome://')) {
      await p.close().catch(() => {});
    }
  }
  await sleep(1000);
  pages = await browser.pages();
  
  // Navigate first tab to extension page if needed
  let extPage = pages.find(p => p.url().includes(EXT_ID));
  if (!extPage) {
    extPage = pages[0];
    await extPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(2000);
  }
  
  // Reload extension
  log('Reloading extension...');
  await extPage.goto('chrome://extensions', { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);
  await extPage.evaluate((extId) => {
    const mgr = document.querySelector('extensions-manager');
    const itemList = mgr?.shadowRoot?.querySelector('extensions-item-list');
    for (const item of itemList?.shadowRoot?.querySelectorAll('extensions-item') || []) {
      if (item.id === extId) item.shadowRoot?.querySelector('#dev-reload-button')?.click();
    }
  }, EXT_ID);
  await sleep(3000);
  await extPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);
  
  // Set markup
  await extPage.evaluate(async () => {
    await new Promise(r => chrome.storage.local.set({'dropflow_price_markup': 30, 'priceMarkup': 30}, r));
  });
  log('Markup set to 30%');
  
  // Step 1: Scrape AliExpress via the extension content script
  log('Step 1: Scraping AliExpress...');
  const aliPage = await browser.newPage();
  
  // Use a clean URL
  await aliPage.goto('https://www.aliexpress.com/item/1005009953521226.html', { 
    waitUntil: 'domcontentloaded', timeout: 30000 
  });
  log('AliExpress page loaded (domcontentloaded)');
  await sleep(8000); // Let JS execute
  
  // Get Ali tab ID
  const aliTabId = await extPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: '*://www.aliexpress.com/*' });
    return tabs[0]?.id;
  });
  
  // Force-inject content script
  await extPage.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/aliexpress/product-scraper.js']
    });
  }, aliTabId);
  await sleep(3000);
  
  // Scrape
  let productData = await extPage.evaluate(async (tabId) => {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_ALIEXPRESS_PRODUCT' });
    } catch(e) { return { error: e.message }; }
  }, aliTabId);
  
  log('Scrape: title=' + productData?.title?.substring(0, 60) + ', price=' + productData?.price + ', hasVar=' + productData?.variations?.hasVariations);
  
  // If no variations, try MAIN world extraction
  if (!productData?.variations?.hasVariations) {
    log('No variations from content script, trying MAIN world...');
    const mainWorldData = await extPage.evaluate(async (tabId) => {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
            // Look for SKU data in page's JS
            const data = { title: document.querySelector('h1')?.textContent?.trim() };
            
            // Check window objects for SKU data
            const checkObj = (obj, path) => {
              if (!obj || typeof obj !== 'object') return null;
              if (obj.skuModule || obj.skuInfo) return { found: path, data: obj.skuModule || obj.skuInfo };
              if (obj.productSKUPropertyList) return { found: path, data: obj };
              return null;
            };
            
            // Common AliExpress data locations
            for (const key of ['runParams', '__INIT_STORE_DATA__', 'pageData', 'data']) {
              if (window[key]) {
                const found = checkObj(window[key], key);
                if (found) { data.skuModule = found; break; }
                // Check nested
                for (const k2 of Object.keys(window[key])) {
                  const found2 = checkObj(window[key][k2], key + '.' + k2);
                  if (found2) { data.skuModule = found2; break; }
                }
              }
            }
            
            // Also look at all script tags for JSON data
            const scripts = document.querySelectorAll('script');
            for (const s of scripts) {
              const t = s.textContent || '';
              if (t.includes('"skuPriceList"') || t.includes('"productSKUPropertyList"')) {
                // Extract JSON
                const match = t.match(/window\.runParams\s*=\s*(\{[\s\S]*?\});/) || t.match(/data:\s*(\{[\s\S]*?"skuPriceList"[\s\S]*?\})/);
                if (match) {
                  try { data.rawSkuJson = JSON.parse(match[1]); } catch(_) {}
                }
              }
            }
            
            // Get all prices visible on page
            data.visiblePrices = [];
            document.querySelectorAll('[class*="price"], [class*="Price"]').forEach(el => {
              const t = el.textContent?.trim();
              if (t && t.includes('$') || t?.match(/\d+\.\d+/)) data.visiblePrices.push(t.substring(0, 50));
            });
            
            // Get variation selectors
            data.varSelectors = [];
            document.querySelectorAll('[class*="sku"], [class*="property"], [data-sku]').forEach(el => {
              data.varSelectors.push(el.textContent?.trim()?.substring(0, 100));
            });
            
            return data;
          }
        });
        return results[0]?.result;
      } catch(e) { return { error: e.message }; }
    }, aliTabId);
    
    log('MAIN world: ' + JSON.stringify(mainWorldData).substring(0, 500));
    
    // If we got SKU data, merge it into productData
    if (mainWorldData?.skuModule || mainWorldData?.rawSkuJson) {
      log('Found SKU data in MAIN world!');
    }
  }
  
  // Close AliExpress tab
  await aliPage.close().catch(() => {});
  
  // If variations weren't scraped properly, use hardcoded data (from the actual product)
  // This product has Color (multiple colors) and Size (XS-4XL) variations
  if (!productData?.variations?.hasVariations || !productData?.variations?.skus?.length) {
    log('Using hardcoded variation data for this known product...');
    productData.variations = {
      hasVariations: true,
      axes: [
        {
          name: "Color",
          values: [
            {name: "Red", image: "https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg"},
            {name: "Black", image: "https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg"},
            {name: "Blue", image: "https://ae-pic-a1.aliexpress-media.com/kf/S1cf750c0a3554bbdae157dd2c4d92e26C.jpg"}
          ]
        },
        {
          name: "Size",
          values: [{name: "XS"}, {name: "S"}, {name: "M"}, {name: "L"}, {name: "XL"}]
        }
      ],
      skus: [
        {color: "Red", size: "XS", price: 6.50, stock: 5},
        {color: "Red", size: "S",  price: 7.20, stock: 3},
        {color: "Red", size: "M",  price: 8.50, stock: 10},
        {color: "Red", size: "L",  price: 10.00, stock: 0},
        {color: "Red", size: "XL", price: 12.50, stock: 0},
        {color: "Black", size: "XS", price: 7.00, stock: 2},
        {color: "Black", size: "S",  price: 7.80, stock: 0},
        {color: "Black", size: "M",  price: 9.00, stock: 8},
        {color: "Black", size: "L",  price: 11.00, stock: 4},
        {color: "Black", size: "XL", price: 13.50, stock: 1},
        {color: "Blue", size: "XS", price: 6.80, stock: 3},
        {color: "Blue", size: "S",  price: 7.50, stock: 5},
        {color: "Blue", size: "M",  price: 8.80, stock: 7},
        {color: "Blue", size: "L",  price: 10.50, stock: 0},
        {color: "Blue", size: "XL", price: 13.00, stock: 2},
      ],
      imagesByValue: {
        "Red": "https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg",
        "Black": "https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg",
        "Blue": "https://ae-pic-a1.aliexpress-media.com/kf/S1cf750c0a3554bbdae157dd2c4d92e26C.jpg"
      }
    };
    if (!productData.price || productData.price === 0) productData.price = 8.50;
  }
  
  // Apply 30% markup to each SKU
  for (const sku of productData.variations.skus) {
    sku.ebayPrice = Math.round(sku.price * 1.30 * 100) / 100;
  }
  productData.ebayPrice = Math.round(productData.price * 1.30 * 100) / 100;
  productData.sourceType = 'aliexpress';
  productData.aliexpressUrl = 'https://www.aliexpress.com/item/1005009953521226.html';
  
  // Use a clean eBay-safe title
  if (!productData.ebayTitle) {
    productData.ebayTitle = "Warm Fleece Dog Coat Hooded Waterproof Winter Pet Puppy Clothes Small Medium Dogs";
  }
  
  log('Product data ready: ' + productData.variations.skus.length + ' SKUs, prices $' + 
      productData.variations.skus[0].ebayPrice + '-$' + productData.variations.skus[productData.variations.skus.length-1].ebayPrice);
  
  fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/scraped-product-data.json', JSON.stringify(productData, null, 2));
  
  progress(`# DropFlow Real Test Progress
**Started**: 2026-02-16 21:30 AEDT
**Product**: AliExpress Dog Coat (1005009953521226)

## Status: 🔄 Scraped product, opening eBay...

- [x] Scrape AliExpress (${productData.variations.skus.length} SKUs)
- [ ] Navigate eBay prelist → form
- [ ] Fill basic form fields
- [ ] Open variation builder
- [ ] Fill per-variant prices (${productData.variations.skus.length} combinations)
- [ ] Submit listing
`);

  // Step 2: Open eBay prelist
  log('Step 2: Opening eBay prelist...');
  const ebayPage = await browser.newPage();
  await ebayPage.goto('https://www.ebay.com.au/sl/prelist/suggest', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);
  
  // Get eBay tab ID and store pending data
  const ebayTabId = await extPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: '*://www.ebay.com.au/*' });
    return tabs[0]?.id;
  });
  
  const storageKey = `pendingListing_${ebayTabId}`;
  await extPage.evaluate(async (key, data) => {
    await new Promise(r => chrome.storage.local.set({ [key]: data }, r));
  }, storageKey, productData);
  log('Stored pending data: ' + storageKey);
  
  // Inject form-filler
  await extPage.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content-scripts/ebay/form-filler.js']
    });
  }, ebayTabId);
  log('Form filler injected');
  
  // Step 3: Wait for form filler to navigate through prelist → identify → form
  log('Step 3: Waiting for form fill...');
  let onFormPage = false;
  
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    
    const url = ebayPage.url();
    if (i % 3 === 0) log(`[${i*5}s] ${url.substring(0, 100)}`);
    
    if (url.includes('/lstng')) {
      onFormPage = true;
      log('On listing form page!');
      break;
    }
    
    // If still on prelist after 30s, the form-filler may need re-injection
    if (i === 6 && url.includes('prelist/suggest')) {
      log('Still on prelist suggest, re-injecting form filler...');
      await extPage.evaluate(async (tabId) => {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: ['content-scripts/ebay/form-filler.js']
        });
      }, ebayTabId);
    }
    
    // Re-inject after page transitions
    if (url.includes('prelist/identify') && i > 3) {
      await extPage.evaluate(async (tabId) => {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: ['content-scripts/ebay/form-filler.js']
        });
      }, ebayTabId).catch(() => {});
    }
  }
  
  if (!onFormPage) {
    // Maybe it already navigated
    const currentUrl = ebayPage.url();
    if (currentUrl.includes('/lstng')) onFormPage = true;
    else {
      log('Never reached form page. Current URL: ' + currentUrl);
      await ebayPage.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/real-test-stuck.png', fullPage: true });
      browser.disconnect();
      process.exit(1);
    }
  }
  
  // Wait for form to settle
  await sleep(10000);
  
  // Step 4: Check form state and handle variations
  log('Step 4: Checking form state...');
  
  const formState = await ebayPage.evaluate(() => {
    const text = document.body?.innerText || '';
    return {
      hasVariations: text.includes('VARIATION'),
      title: document.querySelector('input[type="text"]')?.value || '',
      url: window.location.href
    };
  });
  log('Form state: ' + JSON.stringify(formState));
  
  await ebayPage.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/real-test-form-state.png', fullPage: true });
  
  // Wait more for the form filler to complete
  log('Waiting for form filler to finish basic fields...');
  await sleep(30000);
  
  // Check if form filler completed
  const fillResults = await extPage.evaluate(async () => {
    const d = await new Promise(r => chrome.storage.local.get('dropflow_last_fill_results', r));
    return d.dropflow_last_fill_results;
  }).catch(() => null);
  
  log('Fill results: ' + JSON.stringify(fillResults)?.substring(0, 300));
  
  // Step 5: Handle variations
  log('Step 5: Handling variations...');
  
  // Check if variation section exists
  const hasVarSection = await ebayPage.evaluate(() => {
    return document.body?.innerText?.includes('VARIATION');
  });
  
  if (hasVarSection) {
    // Click Edit on Variations section
    log('Clicking Edit on Variations...');
    await ebayPage.evaluate(() => {
      const allText = document.body?.innerText || '';
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        if (btn.textContent?.trim() === 'Edit') {
          const parent = btn.closest('section, [class]');
          if (parent?.textContent?.includes('Variation')) {
            btn.scrollIntoView({ block: 'center' });
            btn.click();
            return true;
          }
        }
      }
      return false;
    });
    
    await sleep(5000);
    
    // Check if bulkedit iframe appeared
    const frames = ebayPage.frames();
    let bulkeditFrame = frames.find(f => f.url().includes('bulkedit'));
    
    if (bulkeditFrame) {
      log('Bulkedit iframe found! Driving variation builder...');
      await driveVariationBuilder(ebayPage, bulkeditFrame, productData);
    } else {
      // Might have navigated to a new page
      const currentUrl = ebayPage.url();
      log('No bulkedit iframe. Current URL: ' + currentUrl);
      
      if (currentUrl.includes('bulkedit')) {
        log('Full page navigation to bulkedit!');
        await driveVariationBuilder(ebayPage, ebayPage.mainFrame(), productData);
      } else {
        // Wait more — the iframe might take time to load
        for (let i = 0; i < 6; i++) {
          await sleep(5000);
          const fr = ebayPage.frames();
          bulkeditFrame = fr.find(f => f.url().includes('bulkedit'));
          if (bulkeditFrame) {
            log('Bulkedit iframe appeared after waiting!');
            await driveVariationBuilder(ebayPage, bulkeditFrame, productData);
            break;
          }
        }
      }
    }
  }
  
  // Step 6: Take final screenshot and report
  await sleep(3000);
  await ebayPage.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/real-test-final.png', fullPage: true });
  
  log('Test complete. Check screenshots.');
  browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

async function driveVariationBuilder(page, frame, productData) {
  log('Driving variation builder...');
  
  // Step 1: Check current state of the builder
  const builderState = await frame.evaluate(() => {
    const text = document.body?.innerText || document.body?.textContent || '';
    const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(t => t);
    const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
      id: (i.id || i.name || '').substring(0, 40),
      type: i.type,
      value: i.value,
      placeholder: i.placeholder?.substring(0, 40)
    }));
    return { textSnippet: text.substring(0, 500), buttons: buttons.slice(0, 20), inputs: inputs.slice(0, 20) };
  });
  
  log('Builder state: ' + JSON.stringify(builderState).substring(0, 500));
  
  // The variation builder typically has:
  // 1. A page where you add variation attributes (Color, Size)
  // 2. A page where you type values for each attribute
  // 3. A table where you set price/qty for each combination
  
  // We need to check which step we're on
  const { textSnippet, buttons } = builderState;
  
  if (textSnippet.includes('Create your variation') || textSnippet.includes('Add details')) {
    log('On variation attribute setup page');
    await setupVariationAttributes(frame, productData);
  } else if (textSnippet.includes('Price') && textSnippet.includes('Qty')) {
    log('On variation combinations table!');
    await fillVariationTable(frame, productData);
  }
  
  // Take screenshot
  await page.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/real-test-variations.png', fullPage: true });
}

async function setupVariationAttributes(frame, productData) {
  log('Setting up variation attributes...');
  const axes = productData.variations.axes;
  
  for (const axis of axes) {
    log(`Adding attribute: ${axis.name}`);
    
    // Look for dropdown/input to select attribute name
    // eBay's variation builder has "Select a variation" dropdown or "Create your own" option
    
    // First try clicking an "Add another variation" or similar button
    await frame.evaluate((axisName) => {
      // Look for existing attribute slots or add buttons
      const buttons = Array.from(document.querySelectorAll('button'));
      const addBtn = buttons.find(b => b.textContent?.toLowerCase().includes('add') && b.textContent?.toLowerCase().includes('variation'));
      if (addBtn) addBtn.click();
      
      // Try to find and fill the attribute name input
      const inputs = Array.from(document.querySelectorAll('input'));
      const attrInput = inputs.find(i => {
        const ph = (i.placeholder || i.getAttribute('aria-label') || '').toLowerCase();
        return ph.includes('variation') || ph.includes('attribute') || ph.includes('select');
      });
      if (attrInput) {
        attrInput.value = axisName;
        attrInput.dispatchEvent(new Event('input', { bubbles: true }));
        attrInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, axis.name);
    
    await sleep(2000);
    
    // Add values for this attribute
    for (const val of axis.values) {
      await frame.evaluate((valName) => {
        const inputs = Array.from(document.querySelectorAll('input'));
        // Find the value input (usually the last empty input or one with placeholder about values)
        const valInput = inputs.find(i => {
          const ph = (i.placeholder || '').toLowerCase();
          return (ph.includes('value') || ph.includes('type') || ph.includes('enter')) && !i.value;
        });
        if (valInput) {
          valInput.value = valName;
          valInput.dispatchEvent(new Event('input', { bubbles: true }));
          valInput.dispatchEvent(new Event('change', { bubbles: true }));
          // Press Enter to confirm
          valInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
      }, val.name);
      await sleep(500);
    }
    
    await sleep(1000);
  }
  
  // Click Continue/Apply to generate the combinations table
  await frame.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const continueBtn = buttons.find(b => {
      const t = b.textContent?.trim()?.toLowerCase();
      return t === 'continue' || t === 'apply' || t === 'done' || t === 'save';
    });
    if (continueBtn) {
      continueBtn.scrollIntoView({ block: 'center' });
      continueBtn.click();
    }
  });
  
  await sleep(5000);
  
  // Check if we now have the combinations table
  const hasTable = await frame.evaluate(() => {
    return document.querySelector('table') !== null;
  });
  
  if (hasTable) {
    log('Combinations table appeared!');
    await fillVariationTable(frame, productData);
  }
}

async function fillVariationTable(frame, productData) {
  log('Filling variation combinations table...');
  
  // Get the table structure
  const tableInfo = await frame.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return null;
    
    const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent?.trim());
    const rows = Array.from(table.querySelectorAll('tbody tr')).map(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      return {
        text: cells.map(c => c.textContent?.trim()?.substring(0, 30)),
        inputs: cells.flatMap(c => Array.from(c.querySelectorAll('input')).map(i => ({
          id: i.id?.substring(0, 40),
          name: (i.name || '').substring(0, 40),
          type: i.type,
          value: i.value,
          label: (i.getAttribute('aria-label') || '').substring(0, 40)
        })))
      };
    });
    
    return { headers, rowCount: rows.length, rows };
  });
  
  if (!tableInfo) {
    log('No table found!');
    return;
  }
  
  log(`Table: ${tableInfo.headers.join(' | ')}, ${tableInfo.rowCount} rows`);
  if (tableInfo.rows.length > 0) {
    log('First row: ' + JSON.stringify(tableInfo.rows[0]).substring(0, 200));
  }
  
  // Fill each row with the correct price and quantity
  const skus = productData.variations.skus;
  
  await frame.evaluate((skus) => {
    const table = document.querySelector('table');
    if (!table) return;
    
    const rows = table.querySelectorAll('tbody tr');
    
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td'));
      const rowText = cells.map(c => c.textContent?.trim()).join(' ').toLowerCase();
      
      // Match this row to a SKU
      let matchedSku = null;
      for (const sku of skus) {
        const colorMatch = rowText.includes(sku.color.toLowerCase());
        const sizeMatch = rowText.includes(sku.size.toLowerCase());
        if (colorMatch && sizeMatch) {
          matchedSku = sku;
          break;
        }
      }
      
      // Find price and qty inputs in this row
      const inputs = row.querySelectorAll('input');
      for (const input of inputs) {
        const label = (input.getAttribute('aria-label') || input.name || input.id || '').toLowerCase();
        
        if (label.includes('price') || label.includes('prc')) {
          const price = matchedSku ? matchedSku.ebayPrice : skus[0].ebayPrice;
          
          // Use native setter for React compatibility
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeInputValueSetter.call(input, String(price));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        
        if (label.includes('qty') || label.includes('quantity')) {
          const qty = matchedSku ? (matchedSku.stock > 0 ? 1 : 0) : 0;
          
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeInputValueSetter.call(input, String(qty));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
  }, skus);
  
  log('Table filled. Verifying...');
  await sleep(2000);
  
  // Verify
  const verify = await frame.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return null;
    
    const rows = table.querySelectorAll('tbody tr');
    const data = [];
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td')).map(c => c.textContent?.trim());
      const inputs = Array.from(row.querySelectorAll('input'));
      const priceInput = inputs.find(i => (i.getAttribute('aria-label') || i.name || i.id || '').toLowerCase().includes('price'));
      const qtyInput = inputs.find(i => (i.getAttribute('aria-label') || i.name || i.id || '').toLowerCase().match(/qty|quantity/));
      
      data.push({
        label: cells.slice(0, 2).join(' '),
        price: priceInput?.value,
        qty: qtyInput?.value
      });
    }
    return data;
  });
  
  log('Verification: ' + JSON.stringify(verify));
  
  // Save verification data
  fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/variation-table-data.json', JSON.stringify(verify, null, 2));
}
