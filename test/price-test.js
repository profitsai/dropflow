const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';
const ITEM_ID = '177867538247';

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
  fs.appendFileSync('PROGRESS.md', `- ${ts}: ${msg}\n`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function findPage(browser, match) {
  const pages = await browser.pages();
  return pages.find(p => p.url().includes(match));
}

(async () => {
  fs.writeFileSync('PROGRESS.md', '# Price Test Progress\n\n');
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  log('Connected to browser');

  // List current tabs
  const pages = await browser.pages();
  log(`Found ${pages.length} tabs: ${pages.map(p => p.url().substring(0, 80)).join(' | ')}`);

  // Step 1: End old listing
  log('Step 1: Ending old listing #' + ITEM_ID);
  let ebayPage = await findPage(browser, 'ebay.com.au');
  if (!ebayPage) {
    ebayPage = await browser.newPage();
  }
  await ebayPage.goto(`https://www.ebay.com.au/sh/lst/active?search=${ITEM_ID}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);
  await ebayPage.screenshot({ path: 'price-test-listing-search.png' });
  
  // Try to select and end the listing
  try {
    // Check if the listing appears
    const hasListing = await ebayPage.evaluate((itemId) => {
      const rows = document.querySelectorAll('[data-testid="listing-row"], tr, .listing-row');
      for (const row of rows) {
        if (row.textContent.includes(itemId)) return true;
      }
      // Also check if there's any checkbox
      return document.querySelector('input[type="checkbox"]') !== null;
    }, ITEM_ID);
    
    if (hasListing) {
      log('Found listing, attempting to end it...');
      // Try clicking the checkbox for the listing, then End
      const ended = await ebayPage.evaluate(async (itemId) => {
        // Seller Hub active listings - find the item checkbox
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        for (const cb of checkboxes) {
          const row = cb.closest('tr, [class*="row"], [class*="listing"]');
          if (row && row.textContent.includes(itemId)) {
            cb.click();
            return 'checked';
          }
        }
        return 'not-found';
      }, ITEM_ID);
      log('Checkbox result: ' + ended);
      
      if (ended === 'checked') {
        await sleep(1000);
        // Look for End/End listing button
        const endBtn = await ebayPage.$('button[data-testid="end-listing"], [aria-label*="End"], button:has-text("End")');
        if (endBtn) {
          await endBtn.click();
          await sleep(2000);
          // Confirm
          const confirmBtn = await ebayPage.$('button[data-testid="confirm"], button:has-text("End listing")');
          if (confirmBtn) await confirmBtn.click();
          await sleep(3000);
          log('Listing ended');
        } else {
          log('Could not find End button, will try direct URL approach');
          await ebayPage.goto(`https://www.ebay.com.au/bfe/api/sell/end-items`, { waitUntil: 'networkidle2' }).catch(() => {});
        }
      }
    } else {
      log('Listing not found in active listings (may already be ended)');
    }
  } catch (e) {
    log('End listing error: ' + e.message);
  }
  await ebayPage.screenshot({ path: 'price-test-after-end.png' });

  // Step 2: Reload extension
  log('Step 2: Reloading extension');
  const extPage = await browser.newPage();
  await extPage.goto('chrome://extensions', { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);
  
  // Extensions page uses shadow DOM
  await extPage.evaluate((extId) => {
    const manager = document.querySelector('extensions-manager');
    if (!manager || !manager.shadowRoot) return 'no-manager';
    const itemList = manager.shadowRoot.querySelector('extensions-item-list');
    if (!itemList || !itemList.shadowRoot) return 'no-item-list';
    const items = itemList.shadowRoot.querySelectorAll('extensions-item');
    for (const item of items) {
      if (item.id === extId) {
        const reloadBtn = item.shadowRoot?.querySelector('#dev-reload-button, [id*="reload"]');
        if (reloadBtn) { reloadBtn.click(); return 'reloaded'; }
      }
    }
    return 'not-found';
  }, EXT_ID);
  
  // Alternative: use chrome.management API from extension page
  // Let's navigate to extension page first to wake it up
  await sleep(2000);
  await extPage.close();
  
  // Navigate to extension page to wake up service worker
  const wakeupPage = await browser.newPage();
  await wakeupPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);
  log('Extension page loaded, SW should be awake');

  // Step 3: Modify stored product data with varied prices and stock
  log('Step 3: Setting up test data with varied prices and stock');
  
  const setupResult = await wakeupPage.evaluate(async () => {
    // First set markup to 30%
    await new Promise(r => chrome.storage.local.set({'dropflow_price_markup': 30}, r));
    
    // Get current product data
    const data = await new Promise(r => chrome.storage.local.get(null, r));
    
    // Find the stored product key
    const keys = Object.keys(data);
    const productKeys = keys.filter(k => k.includes('product') || k.includes('ali') || k.includes('scrape') || k.includes('1005009953521226'));
    
    // Also check for bulk listing state
    const bulkKeys = keys.filter(k => k.includes('bulk') || k.includes('listing') || k.includes('queue'));
    
    return { 
      allKeys: keys.slice(0, 50), 
      productKeys, 
      bulkKeys,
      markup: data['dropflow_price_markup'],
      sampleValues: productKeys.map(k => ({ key: k, type: typeof data[k], preview: JSON.stringify(data[k]).substring(0, 200) }))
    };
  });
  
  log('Storage keys: ' + JSON.stringify(setupResult.allKeys));
  log('Product keys: ' + JSON.stringify(setupResult.productKeys));
  log('Bulk keys: ' + JSON.stringify(setupResult.bulkKeys));
  log('Markup set: ' + setupResult.markup);
  
  // Write full key dump for debugging
  fs.writeFileSync('price-test-keys.json', JSON.stringify(setupResult, null, 2));

  // Now set up the product data with varied prices
  // The extension stores product data and then the service worker processes it
  // Let's create a modified product and trigger the listing flow
  
  const modifyResult = await wakeupPage.evaluate(async () => {
    // Set the markup
    await new Promise(r => chrome.storage.local.set({'dropflow_price_markup': 30}, r));
    
    // Create a product with varied SKU prices and stock
    const testProduct = {
      title: "Warm Fleece Dog Coat With Hooded Waterproof Winter Pet Puppy Clothes For Small Medium Dogs Cats French Bulldog Hoodie Costume",
      price: 8.12,
      originalPrice: 16.93,
      currency: "AUD",
      images: [
        "https://ae-pic-a1.aliexpress-media.com/kf/S1cf750c0a3554bbdae157dd2c4d92e26C.jpg",
        "https://ae-pic-a1.aliexpress-media.com/kf/Sc5bfa0e7793d4562a3ffe0bbe3a661166.jpg",
        "https://ae-pic-a1.aliexpress-media.com/kf/Sf7831f8ffa854eccbd953391af468128t.jpg",
        "https://ae-pic-a1.aliexpress-media.com/kf/Sfcb676f3b6ab4f6baf6d5e5e013627ddz.jpg"
      ],
      variations: {
        hasVariations: true,
        axes: [
          {
            name: "Color",
            values: [
              {name: "Red", image: "https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg", soldOut: false},
              {name: "Black", image: "https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg", soldOut: false},
              {name: "Coffee", image: "https://ae-pic-a1.aliexpress-media.com/kf/Sb89fb2276757499bb4efd5f33b297367c.jpg", soldOut: false}
            ]
          },
          {
            name: "Size",
            values: [
              {name: "XS", soldOut: false},
              {name: "S", soldOut: false},
              {name: "M", soldOut: false},
              {name: "L", soldOut: false},
              {name: "XL", soldOut: false}
            ]
          }
        ],
        skus: [
          // Red variants - varied prices, some in stock
          {color: "Red", size: "XS", price: 6.50, stock: 5, skuId: "r-xs"},
          {color: "Red", size: "S", price: 7.20, stock: 3, skuId: "r-s"},
          {color: "Red", size: "M", price: 8.50, stock: 10, skuId: "r-m"},
          {color: "Red", size: "L", price: 10.00, stock: 0, skuId: "r-l"},  // OUT OF STOCK
          {color: "Red", size: "XL", price: 12.50, stock: 0, skuId: "r-xl"}, // OUT OF STOCK
          // Black variants - different prices
          {color: "Black", size: "XS", price: 7.00, stock: 2, skuId: "b-xs"},
          {color: "Black", size: "S", price: 7.80, stock: 0, skuId: "b-s"},  // OUT OF STOCK
          {color: "Black", size: "M", price: 9.00, stock: 8, skuId: "b-m"},
          {color: "Black", size: "L", price: 11.00, stock: 4, skuId: "b-l"},
          {color: "Black", size: "XL", price: 13.50, stock: 1, skuId: "b-xl"},
          // Coffee variants
          {color: "Coffee", size: "XS", price: 6.80, stock: 0, skuId: "c-xs"}, // OUT OF STOCK
          {color: "Coffee", size: "S", price: 7.50, stock: 0, skuId: "c-s"},   // OUT OF STOCK
          {color: "Coffee", size: "M", price: 8.80, stock: 0, skuId: "c-m"},   // OUT OF STOCK
          {color: "Coffee", size: "L", price: 10.50, stock: 0, skuId: "c-l"},  // OUT OF STOCK
          {color: "Coffee", size: "XL", price: 14.00, stock: 0, skuId: "c-xl"} // OUT OF STOCK (all Coffee OOS)
        ]
      },
      aliexpressUrl: "https://www.aliexpress.com/item/1005009953521226.html"
    };
    
    // Store it where the extension expects it
    // The service worker reads from message, not storage, but let's check what key it uses
    const data = await new Promise(r => chrome.storage.local.get(null, r));
    const allKeys = Object.keys(data);
    
    return { storedKeys: allKeys, testProduct: 'prepared' };
  });
  
  log('Modify result: ' + JSON.stringify(modifyResult.storedKeys));

  // Step 4: The real approach - send a message to the service worker with our modified product
  // The SW handles START_ALI_BULK_LISTING which scrapes the product, but we need to intercept
  // Or better: directly send the product data and trigger ebay listing
  
  log('Step 4: Triggering listing flow via service worker');
  
  // First, let's understand the flow better by checking the service worker code
  // The SW scrapes AliExpress, then opens eBay and sends FILL_FORM
  // We can: 1) Let it scrape naturally, or 2) Override the scraped data
  
  // Approach: Start the bulk listing flow, then after scrape, modify the data before it goes to eBay
  // Actually, the simplest approach: intercept at the chrome.storage level
  // The SW stores scraped data under specific keys before sending to eBay form-filler
  
  // Let me try the direct approach - trigger the flow and watch
  const triggerResult = await wakeupPage.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: ['https://www.aliexpress.com/item/1005009953521226.html'],
        threadCount: 1,
        ebayDomain: 'www.ebay.com.au',
        listingType: 'standard'
      }, (response) => {
        resolve(response || { error: chrome.runtime.lastError?.message || 'no response' });
      });
    });
  });
  
  log('Trigger result: ' + JSON.stringify(triggerResult));

  // Monitor the flow - wait for AliExpress scrape, then modify data before eBay fill
  log('Monitoring flow for 180 seconds...');
  
  let ebayFormFound = false;
  let screenshotCount = 0;
  
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    const currentPages = await browser.pages();
    const urls = currentPages.map(p => p.url().substring(0, 100));
    
    if (i % 4 === 0) {
      log(`[${(i+1)*5}s] ${currentPages.length} tabs`);
    }
    
    // Check for AliExpress page - once it loads, we need to intercept
    const aliPage = currentPages.find(p => p.url().includes('aliexpress.com/item'));
    if (aliPage && !ebayFormFound) {
      // The extension will scrape this page. After scraping, it processes through SW
      // The SW applies markup per-sku in handleAliExpressScrapedData
      // We need to make sure the scraped data has varied prices
    }
    
    // Check for eBay listing form
    const ebayForm = currentPages.find(p => p.url().includes('ebay.com.au/lstng') || p.url().includes('ebay.com.au/sl/'));
    if (ebayForm && !ebayFormFound) {
      ebayFormFound = true;
      log('eBay listing form found!');
      
      // Now we need to wait for the extension to detect it and start filling
      // But first, let's modify the product data in storage so the form-filler uses our prices
      
      // The form-filler reads product data from chrome.storage.local
      // Key is typically 'dropflow_current_product' or similar
      const storageCheck = await wakeupPage.evaluate(async () => {
        const data = await new Promise(r => chrome.storage.local.get(null, r));
        const keys = Object.keys(data);
        const relevant = {};
        for (const k of keys) {
          const val = JSON.stringify(data[k]);
          if (val.includes('sku') || val.includes('variation') || val.includes('price') || k.includes('product') || k.includes('current')) {
            relevant[k] = val.substring(0, 500);
          }
        }
        return { allKeys: keys, relevant };
      });
      
      log('Storage after scrape: ' + JSON.stringify(storageCheck.allKeys));
      fs.writeFileSync('price-test-storage-after-scrape.json', JSON.stringify(storageCheck, null, 2));
      
      // Now override the SKU data with our varied prices
      const overrideResult = await wakeupPage.evaluate(async () => {
        const data = await new Promise(r => chrome.storage.local.get(null, r));
        const keys = Object.keys(data);
        
        // Find the product data key - could be dropflow_current_listing, dropflow_active_product, etc.
        let productKey = null;
        let productData = null;
        
        for (const k of keys) {
          const val = data[k];
          if (val && typeof val === 'object') {
            const str = JSON.stringify(val);
            if (str.includes('1005009953521226') || (str.includes('skus') && str.includes('variation'))) {
              productKey = k;
              productData = val;
              break;
            }
          }
        }
        
        if (!productKey) {
          // Try to find by checking for ebayPrice or aliexpressUrl
          for (const k of keys) {
            const val = data[k];
            if (val && typeof val === 'object' && (val.aliexpressUrl || val.ebayPrice || val.skus)) {
              productKey = k;
              productData = val;
              break;
            }
          }
        }
        
        if (productData && productData.skus) {
          // Modify SKU prices to be varied
          const priceMap = {
            'XS': 6.50, 'S': 7.20, 'M': 8.50, 'L': 10.00, 'XL': 12.50
          };
          const stockMap = {
            'XS': 5, 'S': 3, 'M': 10, 'L': 0, 'XL': 0
          };
          
          for (const sku of productData.skus) {
            // Find size in SKU properties
            const sizeVal = sku.size || sku.Size || '';
            const props = sku.propValues || sku.properties || '';
            let size = sizeVal;
            if (!size) {
              // Try to extract from properties string
              for (const s of ['XS', 'XL', 'S', 'M', 'L']) {
                if (JSON.stringify(sku).includes(s)) { size = s; break; }
              }
            }
            
            if (priceMap[size] !== undefined) {
              sku.price = priceMap[size];
              sku.ebayPrice = Math.round(priceMap[size] * 1.3 * 100) / 100;
              sku.stock = stockMap[size];
            }
          }
          
          await new Promise(r => chrome.storage.local.set({[productKey]: productData}, r));
          return { success: true, key: productKey, skuCount: productData.skus.length, sample: productData.skus.slice(0, 3).map(s => ({price: s.price, ebayPrice: s.ebayPrice, stock: s.stock})) };
        }
        
        return { success: false, productKey, hasData: !!productData, keys: keys.slice(0, 20) };
      });
      
      log('Override result: ' + JSON.stringify(overrideResult));
    }
    
    // Take periodic screenshots of eBay form
    if (ebayFormFound) {
      const ebayForm = currentPages.find(p => p.url().includes('ebay.com.au/lstng'));
      if (ebayForm) {
        if (screenshotCount < 5 && i % 3 === 0) {
          await ebayForm.screenshot({ path: `price-test-progress-${screenshotCount}.png`, fullPage: false });
          screenshotCount++;
        }
        
        // Check if variations table is visible
        const varTableCheck = await ebayForm.evaluate(() => {
          // Look for variation combination table
          const tables = document.querySelectorAll('table');
          for (const table of tables) {
            const rows = table.querySelectorAll('tr');
            if (rows.length > 3) {
              const cells = [];
              for (const row of rows) {
                const tds = row.querySelectorAll('td, th');
                cells.push(Array.from(tds).map(td => td.textContent?.trim()?.substring(0, 30)).join(' | '));
              }
              return cells.join('\n');
            }
          }
          
          // Also check iframes
          const iframes = document.querySelectorAll('iframe');
          return `No variation table found. ${tables.length} tables, ${iframes.length} iframes on page`;
        }).catch(() => 'page not ready');
        
        if (varTableCheck.includes('|') && varTableCheck.length > 100) {
          log('Variation table found!');
          log(varTableCheck.substring(0, 500));
          
          // Take a detailed screenshot
          await ebayForm.screenshot({ path: 'price-test-variation-table.png', fullPage: true });
          
          // Extract the variation data
          const varData = await ebayForm.evaluate(() => {
            const results = [];
            const tables = document.querySelectorAll('table');
            for (const table of tables) {
              const rows = table.querySelectorAll('tr');
              if (rows.length > 2) {
                for (const row of rows) {
                  const cells = Array.from(row.querySelectorAll('td, th'));
                  const inputs = row.querySelectorAll('input');
                  const inputVals = Array.from(inputs).map(inp => ({type: inp.type, value: inp.value, name: inp.name}));
                  results.push({
                    text: cells.map(c => c.textContent?.trim()?.substring(0, 50)).join(' | '),
                    inputs: inputVals
                  });
                }
              }
            }
            return results;
          }).catch(() => []);
          
          if (varData.length > 0) {
            fs.writeFileSync('price-test-var-data.json', JSON.stringify(varData, null, 2));
            log('Variation data extracted: ' + varData.length + ' rows');
            
            // Check for different prices
            const prices = varData.flatMap(r => r.inputs.filter(i => i.value && !isNaN(parseFloat(i.value))).map(i => parseFloat(i.value)));
            const uniquePrices = [...new Set(prices)];
            log('Prices found: ' + JSON.stringify(uniquePrices));
            
            if (uniquePrices.length > 1) {
              log('SUCCESS: Multiple different prices detected!');
            } else if (uniquePrices.length === 1) {
              log('ISSUE: All prices are the same: ' + uniquePrices[0]);
            }
            
            // Check quantities
            const qtys = varData.flatMap(r => r.inputs.filter(i => i.name?.includes('qty') || i.name?.includes('quantity')).map(i => parseInt(i.value)));
            log('Quantities: ' + JSON.stringify(qtys));
            
            break; // Done monitoring
          }
        }
      }
    }
  }

  // Final screenshot
  const finalPages = await browser.pages();
  const ebayFinal = finalPages.find(p => p.url().includes('ebay.com.au/lstng'));
  if (ebayFinal) {
    await ebayFinal.screenshot({ path: 'price-test-final.png', fullPage: true });
    
    // Scroll to variations section and screenshot
    await ebayFinal.evaluate(() => {
      const varSection = document.querySelector('[data-testid="variations"], [class*="variation"]');
      if (varSection) varSection.scrollIntoView();
    });
    await sleep(1000);
    await ebayFinal.screenshot({ path: 'price-test-variations-section.png' });
  }

  log('Test complete');
  browser.disconnect();
})().catch(e => { 
  console.error('FATAL:', e.message); 
  fs.appendFileSync('PROGRESS.md', `- ERROR: ${e.message}\n`);
  process.exit(1); 
});
