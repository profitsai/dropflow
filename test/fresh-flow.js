const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
  fs.appendFileSync('PROGRESS.md', `- ${ts}: ${msg}\n`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  fs.writeFileSync('PROGRESS.md', '# Price Test Progress (Fresh Flow)\n\n');
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // Close extra tabs first
  const pages = await browser.pages();
  for (const p of pages) {
    const url = p.url();
    if (url.includes('aliexpress.com') || url.includes('sh/lst/active') || url.includes('chrome://extensions')) {
      await p.close().catch(() => {});
    }
  }
  log('Cleaned up tabs');
  
  // Get extension page (keep it)
  let extPage = (await browser.pages()).find(p => p.url().includes(EXT_ID));
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'networkidle2', timeout: 15000 });
  }
  
  // First, set markup to 30%
  await extPage.evaluate(async () => {
    await new Promise(r => chrome.storage.local.set({
      'dropflow_price_markup': 30,
      'priceMarkup': 30
    }, r));
  });
  log('Markup set to 30%');
  
  // Now trigger fresh listing - the SW will open a NEW AliExpress tab and scrape it
  log('Triggering fresh listing flow...');
  const result = await extPage.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: ['https://www.aliexpress.com/item/1005009953521226.html'],
        threadCount: 1,
        ebayDomain: 'www.ebay.com.au',
        listingType: 'standard'
      }, (response) => {
        resolve(response || { error: chrome.runtime.lastError?.message });
      });
    });
  });
  log('Trigger: ' + JSON.stringify(result));
  
  // Monitor - the SW should:
  // 1. Open AliExpress tab
  // 2. Wait for content script to scrape
  // 3. Get product data back
  // 4. Generate AI title
  // 5. Open eBay listing form
  // 6. Fill in data
  
  let phase = 'waiting-ali';
  let modifiedData = false;
  
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const currentPages = await browser.pages();
    const urls = currentPages.map(p => p.url().substring(0, 100));
    
    // Check SW logs periodically
    if (i % 6 === 0) {
      const swLogs = await extPage.evaluate(async () => {
        const d = await new Promise(r => chrome.storage.local.get('_swLogs', r));
        return d._swLogs || [];
      }).catch(() => []);
      if (swLogs.length > 0) {
        const recentLogs = swLogs.slice(-5);
        log('SW logs: ' + JSON.stringify(recentLogs).substring(0, 500));
      }
    }
    
    // Track phases
    const hasAli = currentPages.some(p => p.url().includes('aliexpress.com/item'));
    const hasEbayPrelist = currentPages.some(p => p.url().includes('ebay.com.au/sl/'));
    const hasEbayForm = currentPages.some(p => p.url().includes('ebay.com.au/lstng'));
    
    if (hasAli && phase === 'waiting-ali') {
      log('Phase: AliExpress page opened, scraping...');
      phase = 'scraping';
    }
    
    if (hasEbayPrelist && phase !== 'ebay-prelist') {
      log('Phase: eBay prelist page');
      phase = 'ebay-prelist';
    }
    
    if (hasEbayForm && phase !== 'ebay-form') {
      log('Phase: eBay listing form loaded!');
      phase = 'ebay-form';
      
      // Now check storage for the product data and modify SKU prices
      if (!modifiedData) {
        const storageData = await extPage.evaluate(async () => {
          const data = await new Promise(r => chrome.storage.local.get(null, r));
          const keys = Object.keys(data);
          const result = {};
          for (const k of keys) {
            const v = JSON.stringify(data[k]);
            if (v.length > 50 && (v.includes('sku') || v.includes('SKU') || v.includes('variation') || v.includes('ebayPrice'))) {
              result[k] = data[k];
            }
          }
          return { allKeys: keys, productData: result };
        });
        
        log('Storage keys after scrape: ' + JSON.stringify(storageData.allKeys));
        fs.writeFileSync('price-test-product-storage.json', JSON.stringify(storageData, null, 2));
        
        // The form-filler receives data via chrome.runtime message, not storage
        // So we need to check the form-filler's state directly
        // Let's check what's actually on the eBay form
        modifiedData = true;
      }
    }
    
    if (phase === 'ebay-form') {
      const ebayForm = currentPages.find(p => p.url().includes('ebay.com.au/lstng'));
      if (ebayForm) {
        // Check form state
        const formState = await ebayForm.evaluate(() => {
          const title = document.querySelector('[data-testid="title-input"], input[name*="title"], #editpane_title input');
          const variationSection = document.querySelector('[data-testid="variations"], [class*="variation"], #variationSection');
          
          // Check all iframes for variation content
          const iframes = document.querySelectorAll('iframe');
          const iframeInfo = Array.from(iframes).map(f => ({ src: f.src?.substring(0, 100), id: f.id }));
          
          // Look for variation table in main document and shadow roots
          const tables = document.querySelectorAll('table');
          let tableData = [];
          for (const table of tables) {
            const rows = table.querySelectorAll('tr');
            if (rows.length > 2) {
              for (const row of rows) {
                const cells = Array.from(row.querySelectorAll('td, th'));
                const inputs = Array.from(row.querySelectorAll('input'));
                tableData.push({
                  text: cells.map(c => c.textContent?.trim()?.substring(0, 40)).join(' | '),
                  inputs: inputs.map(inp => ({ value: inp.value, name: inp.name?.substring(0, 40), type: inp.type }))
                });
              }
            }
          }
          
          return {
            title: title?.value || 'no title input',
            hasVariationSection: !!variationSection,
            iframes: iframeInfo,
            tables: tableData.length,
            tableData: tableData.slice(0, 30),
            bodyLength: document.body.innerHTML.length
          };
        }).catch(e => ({ error: e.message }));
        
        log(`Form state: title="${formState.title?.substring(0, 50)}", vars=${formState.hasVariationSection}, tables=${formState.tables}, iframes=${formState.iframes?.length}`);
        
        if (formState.tableData && formState.tableData.length > 3) {
          log('VARIATION TABLE FOUND!');
          fs.writeFileSync('price-test-table-data.json', JSON.stringify(formState.tableData, null, 2));
          
          // Extract prices and quantities from the table
          const priceValues = [];
          const qtyValues = [];
          for (const row of formState.tableData) {
            for (const inp of row.inputs) {
              if (inp.value && !isNaN(parseFloat(inp.value))) {
                const val = parseFloat(inp.value);
                if (inp.name?.includes('price') || inp.name?.includes('Price') || (val > 5 && val < 100)) {
                  priceValues.push(val);
                }
                if (inp.name?.includes('qty') || inp.name?.includes('Qty') || inp.name?.includes('quantity') || (Number.isInteger(val) && val >= 0 && val <= 10)) {
                  qtyValues.push(val);
                }
              }
            }
          }
          
          const uniquePrices = [...new Set(priceValues)];
          const uniquQtys = [...new Set(qtyValues)];
          log(`Prices: ${JSON.stringify(uniquePrices)}`);
          log(`Quantities: ${JSON.stringify(uniquQtys)}`);
          
          // Take screenshot
          await ebayForm.screenshot({ path: 'price-test-variation-table.png', fullPage: true });
          
          // Scroll to find variation table and screenshot just that area
          await ebayForm.evaluate(() => {
            const tables = document.querySelectorAll('table');
            for (const t of tables) {
              if (t.querySelectorAll('tr').length > 3) {
                t.scrollIntoView({ block: 'start' });
                break;
              }
            }
          });
          await sleep(1000);
          await ebayForm.screenshot({ path: 'price-test-var-closeup.png' });
          
          // Generate report
          const report = generateReport(formState, priceValues, qtyValues, uniquePrices);
          fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PRICE-TEST-REPORT.md', report);
          log('Report written!');
          
          break;
        }
        
        // Also check iframes for variation builder
        if (formState.iframes && formState.iframes.length > 0) {
          for (const iframe of formState.iframes) {
            if (iframe.src?.includes('variation') || iframe.src?.includes('bulkedit')) {
              log('Found variation iframe: ' + iframe.src);
            }
          }
        }
        
        // Take periodic screenshots
        if (i % 6 === 0) {
          await ebayForm.screenshot({ path: `price-test-form-${i}.png` });
        }
      }
    }
    
    if (i % 6 === 0) {
      log(`[${(i+1)*5}s] phase=${phase}, tabs=${currentPages.length}`);
    }
  }
  
  log('Flow monitoring complete');
  browser.disconnect();
})().catch(e => { 
  console.error('FATAL:', e.message, e.stack); 
  fs.appendFileSync('PROGRESS.md', `- ERROR: ${e.message}\n`);
});

function generateReport(formState, priceValues, qtyValues, uniquePrices) {
  const now = new Date().toISOString();
  return `# DropFlow Per-Variant Pricing Test Report

**Date**: ${now}
**Test Product**: AliExpress Dog Coat (1005009953521226)
**Markup**: 30%

## Test Objectives
1. ✅/❌ Each variant has a DIFFERENT eBay price based on supplier cost × 1.3
2. ✅/❌ Out-of-stock variants show quantity 0
3. ✅/❌ In-stock variants show quantity ≤ 5

## Results

### Price Variation
- **Unique prices found**: ${uniquePrices.length}
- **Prices**: ${JSON.stringify(uniquePrices)}
- **Result**: ${uniquePrices.length > 1 ? '✅ PASS - Multiple different prices' : '❌ FAIL - All prices identical'}

### Quantity/Stock
- **Quantities found**: ${JSON.stringify(qtyValues)}
- **Has zero quantities**: ${qtyValues.includes(0) ? '✅ Yes' : '❌ No'}
- **All ≤ 5**: ${qtyValues.every(q => q <= 5) ? '✅ Yes' : '❌ No (some > 5)'}

### Variation Table Data
\`\`\`json
${JSON.stringify(formState.tableData?.slice(0, 20), null, 2)}
\`\`\`

## Screenshots
- \`price-test-variation-table.png\` - Full page with variation table
- \`price-test-var-closeup.png\` - Closeup of variation area

## Bugs Fixed
1. **Stock override** (form-filler.js ~983): Now checks if ANY sku has real stock → trusts data; only defaults to 5 when no stock data
2. **Unmatched row fallback** (form-filler.js ~1953): Now defaults qty=0 for unmatched variants
`;
}
