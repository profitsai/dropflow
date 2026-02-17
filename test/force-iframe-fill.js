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
        values: [{name: "XS"}, {name: "S"}, {name: "M"}, {name: "L"}, {name: "XL"}]
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
  
  if (!lstng || !extPage) { log('Missing pages'); process.exit(1); }
  
  // Step 1: Store pending data
  await extPage.evaluate(async (product) => {
    await new Promise(r => chrome.storage.local.set({
      'pendingListingData': product
    }, r));
  }, testProduct);
  log('Pending data stored');
  
  // Step 2: Get the bulkedit iframe's tab target and inject
  const tabId = await extPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: '*://www.ebay.com.au/lstng*' });
    return tabs[0]?.id;
  });
  
  // Inject content script into all frames
  const injectResult = await extPage.evaluate(async (tid) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tid, allFrames: true },
        files: ['content-scripts/ebay/form-filler.js']
      });
      return 'ok';
    } catch(e) { return e.message; }
  }, tabId);
  log('Inject result: ' + injectResult);
  
  // Step 3: Wait for the iframe content script to run
  // It should: detect it's on bulkedit host → find pending data → run builder flow
  log('Waiting for iframe content script to process...');
  
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    
    const frames = lstng.frames();
    const bulkFrame = frames.find(f => f.url().includes('bulkedit'));
    
    if (bulkFrame) {
      const check = await bulkFrame.evaluate(() => {
        const bodyText = document.body?.innerText || '';
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
                label: (inp.getAttribute('aria-label') || inp.name || inp.getAttribute('data-testid') || '').substring(0, 40)
              }))
            }));
          }
        }
        
        const priceInputs = Array.from(document.querySelectorAll('input')).filter(i => {
          const l = (i.getAttribute('aria-label') || i.name || '').toLowerCase();
          return l.includes('price') && i.value;
        });
        
        return {
          bodySnippet: bodyText.substring(0, 200),
          maxRows,
          priceCount: priceInputs.length,
          tableData: tableData.slice(0, 15),
          buttonTexts: Array.from(document.querySelectorAll('button:not([hidden])')).filter(b => b.offsetHeight > 0).map(b => b.textContent?.trim()?.substring(0, 20)).slice(0, 10)
        };
      }).catch(e => ({ error: e.message }));
      
      if (i % 3 === 0) {
        log(`[${i*5}s] body="${check.bodySnippet?.substring(0, 80)}", tables=${check.maxRows}, prices=${check.priceCount}, buttons=[${check.buttonTexts?.join(',')}]`);
      }
      
      if (check.priceCount > 2) {
        log('VARIATION PRICES FOUND!');
        log('Table data: ' + JSON.stringify(check.tableData).substring(0, 2000));
        
        const prices = check.tableData.flatMap(r => (r.inputs || []).filter(i => parseFloat(i.value) > 5).map(i => parseFloat(i.value)));
        const qtys = check.tableData.flatMap(r => (r.inputs || []).filter(i => {
          const v = parseInt(i.value);
          return !isNaN(v) && v >= 0 && v <= 100;
        }).map(i => parseInt(i.value)));
        
        log('Prices: ' + JSON.stringify([...new Set(prices)]));
        log('Qtys: ' + JSON.stringify(qtys));
        
        await lstng.screenshot({ path: 'price-test-variation-table.png', fullPage: true });
        fs.writeFileSync('price-test-table-data.json', JSON.stringify(check, null, 2));
        
        // Write report
        const uniquePrices = [...new Set(prices)];
        const report = `# DropFlow Per-Variant Pricing Test Report

**Date**: ${new Date().toISOString()}  
**Test Product**: AliExpress Dog Coat (1005009953521226)  
**Markup**: 30%

## Results
### Per-Variant Pricing: ${uniquePrices.length > 1 ? '✅ PASS' : '❌ FAIL'}
- Prices: ${JSON.stringify(uniquePrices)}

### Stock Handling: ${qtys.includes(0) ? '✅ PASS' : '❌ FAIL'}
- Quantities: ${JSON.stringify(qtys)}
- Zero-qty (OOS): ${qtys.filter(q => q === 0).length}

### Table Data
\`\`\`json
${JSON.stringify(check.tableData, null, 2).substring(0, 3000)}
\`\`\`
`;
        fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PRICE-TEST-REPORT.md', report);
        log('Report written');
        browser.disconnect();
        process.exit(0);
      }
      
      // Check if content script is actively running (body text changes)
      if (check.bodySnippet?.includes('Create your variation') && i > 6) {
        // Still on first page after 30s - content script isn't progressing
        // Let's check if pending data is still there
        const pending = await extPage.evaluate(async () => {
          const d = await new Promise(r => chrome.storage.local.get('pendingListingData', r));
          return !!d.pendingListingData;
        });
        if (!pending && i > 6) {
          log('Pending data was consumed but builder not progressing. Re-storing...');
          await extPage.evaluate(async (product) => {
            await new Promise(r => chrome.storage.local.set({
              'pendingListingData': product
            }, r));
          }, testProduct);
          // Re-inject
          await extPage.evaluate(async (tid) => {
            await chrome.scripting.executeScript({
              target: { tabId: tid, allFrames: true },
              files: ['content-scripts/ebay/form-filler.js']
            });
          }, tabId);
          log('Re-stored and re-injected');
        }
      }
    }
  }
  
  log('Timeout');
  browser.disconnect();
  process.exit(1);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
