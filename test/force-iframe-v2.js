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
  
  // Step 2: Clear the guard variable in the iframe and re-inject
  const frames = lstng.frames();
  const bulkFrame = frames.find(f => f.url().includes('bulkedit'));
  
  if (bulkFrame) {
    // Clear the guard
    await bulkFrame.evaluate(() => {
      window.__dropflow_form_filler_loaded = false;
    });
    log('Guard cleared in iframe');
  }
  
  // Step 3: Inject content script into all frames
  const tabId = await extPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: '*://www.ebay.com.au/lstng*' });
    return tabs[0]?.id;
  });
  
  // Also clear guard on main page
  await lstng.evaluate(() => {
    window.__dropflow_form_filler_loaded = false;
  });
  
  await extPage.evaluate(async (tid) => {
    await chrome.scripting.executeScript({
      target: { tabId: tid, allFrames: true },
      files: ['content-scripts/ebay/form-filler.js']
    });
  }, tabId);
  log('Content script re-injected into all frames');
  
  // Step 4: Monitor progress
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    
    const bulkFrameNow = lstng.frames().find(f => f.url().includes('bulkedit'));
    if (!bulkFrameNow) {
      log(`[${i*5}s] No bulkedit frame (may have been closed/replaced)`);
      
      // Check main page for variation table
      const mainCheck = await lstng.evaluate(() => {
        const tables = document.querySelectorAll('table');
        let maxRows = 0;
        for (const t of tables) maxRows = Math.max(maxRows, t.querySelectorAll('tr').length);
        const priceInputs = Array.from(document.querySelectorAll('input')).filter(i => {
          const l = (i.getAttribute('aria-label') || '').toLowerCase();
          return l.includes('price') && i.value && parseFloat(i.value) > 1;
        });
        return { maxRows, prices: priceInputs.length };
      }).catch(() => ({}));
      
      if (mainCheck.prices > 2) {
        log('Prices found on main page! ' + mainCheck.prices);
        await extractAndReport(lstng, 'main');
        break;
      }
      continue;
    }
    
    const check = await bulkFrameNow.evaluate(() => {
      const bodyText = document.body?.innerText?.substring(0, 300) || '';
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
      return { bodySnippet: bodyText.substring(0, 100), maxRows, priceCount: priceInputs.length, tableData: tableData.slice(0, 15) };
    }).catch(e => ({ error: e.message }));
    
    if (i % 3 === 0) {
      log(`[${i*5}s] body="${check.bodySnippet?.substring(0, 60)}", rows=${check.maxRows}, prices=${check.priceCount}`);
    }
    
    if (check.priceCount > 2) {
      log('VARIATION PRICES FOUND IN IFRAME!');
      await extractAndReport(lstng, 'iframe', check);
      break;
    }
    
    // Check if page changed
    if (check.bodySnippet && !check.bodySnippet.includes('Create your variation')) {
      log('Page changed: ' + check.bodySnippet);
      await lstng.screenshot({ path: `price-test-progress-${i}.png` });
    }
  }
  
  async function extractAndReport(page, source, check) {
    const extractPage = source === 'iframe' ? lstng.frames().find(f => f.url().includes('bulkedit')) : page;
    
    const data = check || await extractPage.evaluate(() => {
      const tables = document.querySelectorAll('table');
      let tableData = [];
      for (const t of tables) {
        if (t.querySelectorAll('tr').length > 3) {
          tableData = Array.from(t.querySelectorAll('tr')).map(row => ({
            cells: Array.from(row.querySelectorAll('td, th')).map(c => c.textContent?.trim()?.substring(0, 40)),
            inputs: Array.from(row.querySelectorAll('input')).map(inp => ({
              value: inp.value,
              label: (inp.getAttribute('aria-label') || '').substring(0, 40)
            }))
          }));
          break;
        }
      }
      return { tableData };
    });
    
    const prices = (data.tableData || []).flatMap(r => (r.inputs || []).filter(i => parseFloat(i.value) > 5).map(i => parseFloat(i.value)));
    const qtys = (data.tableData || []).flatMap(r => (r.inputs || []).filter(i => {
      const v = parseInt(i.value);
      return !isNaN(v) && v >= 0 && v <= 100 && (i.label || '').toLowerCase().includes('qty');
    }).map(i => parseInt(i.value)));
    
    const uniquePrices = [...new Set(prices)];
    log('Prices: ' + JSON.stringify(uniquePrices));
    log('Qtys: ' + JSON.stringify(qtys));
    
    await lstng.screenshot({ path: 'price-test-variation-table.png', fullPage: true });
    fs.writeFileSync('price-test-table-data.json', JSON.stringify(data, null, 2));
    
    const report = `# DropFlow Per-Variant Pricing Test Report

**Date**: ${new Date().toISOString()}
**Source**: ${source}

## Results
### Per-Variant Pricing: ${uniquePrices.length > 1 ? '✅ PASS' : uniquePrices.length === 1 ? '❌ FAIL (all same)' : '⚠️ No prices found'}
- Unique prices: ${JSON.stringify(uniquePrices)}

### Stock Handling: ${qtys.includes(0) ? '✅ PASS' : qtys.length === 0 ? '⚠️ No qty data' : '❌ FAIL'}
- Quantities: ${JSON.stringify(qtys)}

### Table
\`\`\`json
${JSON.stringify(data.tableData, null, 2).substring(0, 3000)}
\`\`\`
`;
    fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PRICE-TEST-REPORT.md', report);
    log('Report written');
  }
  
  browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
