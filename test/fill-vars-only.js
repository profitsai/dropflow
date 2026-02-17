const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const testProduct = {
  title: "Warm Fleece Dog Coat Hooded Waterproof Winter Pet Puppy Clothes Small Medium Dogs",
  price: 8.12,
  ebayPrice: 10.56,
  ebayTitle: "Warm Fleece Dog Coat Hooded Waterproof Winter Pet Puppy Clothes Small Medium Dogs",
  images: [],
  aliexpressUrl: "https://www.aliexpress.com/item/1005009953521226.html",
  sourceType: "aliexpress",
  variations: {
    hasVariations: true,
    axes: [
      {
        name: "Color",
        values: [
          {name: "Red", image: "https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg"},
          {name: "Black", image: "https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg"}
        ]
      },
      {
        name: "Size",
        values: [
          {name: "XS"}, {name: "S"}, {name: "M"}, {name: "L"}, {name: "XL"}
        ]
      }
    ],
    skus: [
      {color: "Red", size: "XS", price: 6.50,  ebayPrice: 8.45,  stock: 5},
      {color: "Red", size: "S",  price: 7.20,  ebayPrice: 9.36,  stock: 3},
      {color: "Red", size: "M",  price: 8.50,  ebayPrice: 11.05, stock: 10},
      {color: "Red", size: "L",  price: 10.00, ebayPrice: 13.00, stock: 0},
      {color: "Red", size: "XL", price: 12.50, ebayPrice: 16.25, stock: 0},
      {color: "Black", size: "XS", price: 7.00,  ebayPrice: 9.10,  stock: 2},
      {color: "Black", size: "S",  price: 7.80,  ebayPrice: 10.14, stock: 0},
      {color: "Black", size: "M",  price: 9.00,  ebayPrice: 11.70, stock: 8},
      {color: "Black", size: "L",  price: 11.00, ebayPrice: 14.30, stock: 4},
      {color: "Black", size: "XL", price: 13.50, ebayPrice: 17.55, stock: 1},
    ],
    imagesByValue: {
      "Red": "https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg",
      "Black": "https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg"
    }
  }
};

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  
  const extPage = pages.find(p => p.url().includes(EXT_ID));
  const lstng = pages.find(p => p.url().includes('/lstng'));
  
  if (!lstng) { log('No lstng page'); process.exit(1); }
  log('Found listing page: ' + lstng.url());
  
  // First, take a screenshot to see current state
  await lstng.screenshot({ path: 'price-test-before-vars.png' });
  
  // Try to find and click the "Edit" button for variations
  log('Looking for Edit button in VARIATIONS section...');
  const editResult = await lstng.evaluate(() => {
    const allText = document.body.innerText;
    
    // Find all buttons/links with "Edit" text near variations
    const elements = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    const editButtons = elements.filter(el => {
      const text = el.textContent?.trim();
      return text === 'Edit' || text === 'edit';
    });
    
    // Find the one closest to "VARIATIONS" text
    for (const btn of editButtons) {
      const parent = btn.closest('section, [class*="section"], div');
      if (parent?.textContent?.includes('VARIATION')) {
        btn.click();
        return { clicked: true, text: btn.textContent, parentText: parent.textContent?.substring(0, 100) };
      }
    }
    
    // Try another approach - find the VARIATIONS heading and look for Edit nearby
    const headings = Array.from(document.querySelectorAll('h2, h3, h4, [class*="heading"], strong'));
    for (const h of headings) {
      if (h.textContent?.includes('VARIATION')) {
        const section = h.parentElement;
        const editBtn = section?.querySelector('button, a, [role="button"]');
        if (editBtn) {
          editBtn.click();
          return { clicked: true, text: editBtn.textContent, headingText: h.textContent };
        }
      }
    }
    
    return { clicked: false, editCount: editButtons.length, editTexts: editButtons.map(b => b.textContent?.trim() + ' — ' + b.closest('section,div')?.textContent?.substring(0, 50)) };
  });
  
  log('Edit result: ' + JSON.stringify(editResult));
  await sleep(3000);
  await lstng.screenshot({ path: 'price-test-after-edit-click.png' });
  
  // Check what happened - might have navigated to variation builder
  const currentUrl = lstng.url();
  log('Current URL: ' + currentUrl);
  
  // Check all pages for variation builder
  const allPages = await browser.pages();
  for (const page of allPages) {
    const url = page.url();
    if (url.includes('bulkedit') || url.includes('variation')) {
      log('Found variation builder page: ' + url);
      await page.screenshot({ path: 'price-test-var-builder.png' });
    }
  }
  
  // Now inject content script and send FILL_EBAY_FORM
  if (extPage) {
    const tabId = await extPage.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: '*://www.ebay.com.au/lstng*' });
      return tabs[0]?.id;
    });
    
    if (tabId) {
      // Inject content script
      await extPage.evaluate(async (tid) => {
        await chrome.scripting.executeScript({
          target: { tabId: tid },
          files: ['content-scripts/ebay/form-filler.js']
        });
      }, tabId);
      await sleep(2000);
      log('Content script injected');
      
      // Send FILL_EBAY_FORM
      log('Sending FILL_EBAY_FORM...');
      const fillPromise = extPage.evaluate(async (tid, product) => {
        try {
          const resp = await chrome.tabs.sendMessage(tid, {
            type: 'FILL_EBAY_FORM',
            productData: product
          });
          return resp;
        } catch(e) { return { error: e.message }; }
      }, tabId, testProduct);
      
      // Monitor while waiting
      for (let i = 0; i < 40; i++) {
        await sleep(5000);
        
        // Check for variation table on ALL pages
        const currentPages = await browser.pages();
        for (const page of currentPages) {
          if (!page.url().includes('ebay.com.au')) continue;
          
          const check = await page.evaluate(() => {
            const tables = document.querySelectorAll('table');
            let maxRows = 0;
            let tableData = [];
            for (const t of tables) {
              const rows = t.querySelectorAll('tr');
              if (rows.length > maxRows) {
                maxRows = rows.length;
                tableData = Array.from(rows).map(row => ({
                  cells: Array.from(row.querySelectorAll('td, th')).map(c => c.textContent?.trim()?.substring(0, 40)),
                  inputs: Array.from(row.querySelectorAll('input')).map(inp => ({
                    value: inp.value,
                    label: (inp.getAttribute('aria-label') || inp.name || '').substring(0, 40)
                  }))
                }));
              }
            }
            
            // Also look for inline price/qty inputs (eBay sometimes uses divs not tables)
            const priceInputs = Array.from(document.querySelectorAll('input')).filter(i => {
              const l = (i.getAttribute('aria-label') || '').toLowerCase();
              return l.includes('price') && i.value && parseFloat(i.value) > 1;
            });
            
            return {
              maxRows, tableData, 
              priceCount: priceInputs.length,
              prices: priceInputs.map(i => ({ label: i.getAttribute('aria-label'), value: i.value })),
              url: window.location.href.substring(0, 80)
            };
          }).catch(() => ({}));
          
          if (check.priceCount > 2) {
            log(`PRICES FOUND on ${check.url}! ${check.priceCount} prices`);
            log('Prices: ' + JSON.stringify(check.prices));
            
            await page.screenshot({ path: 'price-test-variation-table.png', fullPage: true });
            
            // Extract all data
            const prices = check.prices.map(p => parseFloat(p.value));
            const uniquePrices = [...new Set(prices)];
            log('Unique prices: ' + JSON.stringify(uniquePrices));
            
            fs.writeFileSync('price-test-table-data.json', JSON.stringify(check, null, 2));
            
            // Scroll to table
            await page.evaluate(() => {
              const tables = document.querySelectorAll('table');
              for (const t of tables) { if (t.querySelectorAll('tr').length > 3) { t.scrollIntoView({block:'center'}); break; } }
            });
            await sleep(1000);
            await page.screenshot({ path: 'price-test-var-closeup.png' });
            
            browser.disconnect();
            process.exit(0);
          }
        }
        
        if (i % 6 === 0) {
          log(`[${i*5}s] Waiting for variations...`);
          await lstng.screenshot({ path: `price-test-wait-${i}.png` });
        }
      }
      
      // Get fill result
      const fillResult = await fillPromise;
      log('Fill result: ' + JSON.stringify(fillResult).substring(0, 500));
    }
  }
  
  // Final diagnostics
  if (extPage) {
    const diag = await extPage.evaluate(async () => {
      const d = await new Promise(r => chrome.storage.local.get(null, r));
      const result = {};
      for (const [k, v] of Object.entries(d)) {
        if (k.includes('variation') || k.includes('_dfLog') || k.includes('dropflow_var')) {
          result[k] = v;
        }
      }
      return result;
    });
    log('Final diagnostics: ' + JSON.stringify(diag, null, 2).substring(0, 2000));
  }
  
  browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
