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
  
  if (!lstng || !extPage) {
    log('Need extension page and /lstng page');
    process.exit(1);
  }
  
  log('Using existing listing page: ' + lstng.url());
  
  // Step 1: Store product data as pendingListingData so the iframe can find it
  await extPage.evaluate(async (product) => {
    await new Promise(r => chrome.storage.local.set({
      'pendingListingData': product
    }, r));
  }, testProduct);
  log('Product data stored for iframe');
  
  // Step 2: Click "Edit" on Variations section
  log('Clicking Variations Edit...');
  const clicked = await lstng.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    for (const el of elements) {
      const parent = el.closest('div, section');
      if (parent && parent.textContent?.includes('Variations') && el.textContent?.trim() === 'Edit') {
        el.click();
        return true;
      }
    }
    return false;
  });
  log('Edit clicked: ' + clicked);
  
  // Wait for iframe to load
  await sleep(5000);
  await lstng.screenshot({ path: 'price-test-var-builder-opening.png' });
  
  // Step 3: Find the bulkedit iframe and check if content script is running
  const iframeCheck = await lstng.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="bulkedit"]') || document.querySelector('iframe[src*="msku"]');
    if (!iframe) return { found: false };
    return { found: true, src: iframe.src?.substring(0, 150) };
  });
  log('Iframe: ' + JSON.stringify(iframeCheck));
  
  if (!iframeCheck.found) {
    log('No bulkedit iframe found. Waiting...');
    await sleep(10000);
  }
  
  // Step 4: The content script should auto-inject into bulkedit iframe via manifest
  // AND find the pendingListingData in storage
  // Let's inject manually as well to be safe
  const tabId = await extPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: '*://www.ebay.com.au/lstng*' });
    return tabs[0]?.id;
  });
  
  log('Injecting content script into all frames of tab ' + tabId);
  await extPage.evaluate(async (tid) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tid, allFrames: true },
        files: ['content-scripts/ebay/form-filler.js']
      });
      return 'injected to all frames';
    } catch(e) {
      return 'error: ' + e.message;
    }
  }, tabId).then(r => log('Inject result: ' + r));
  
  // Step 5: Monitor for progress - the iframe content script should now run
  // runVariationBuilderPageFlow and fill variations
  log('Monitoring for 3 minutes...');
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    
    // Check the iframe state via the main page
    const state = await lstng.evaluate(() => {
      const iframe = document.querySelector('iframe[src*="bulkedit"]');
      if (!iframe) return { noIframe: true };
      
      try {
        const doc = iframe.contentDocument;
        if (!doc) return { crossOrigin: true, src: iframe.src?.substring(0, 100) };
        
        const text = doc.body?.innerText?.substring(0, 500);
        const inputs = doc.querySelectorAll('input');
        const tables = doc.querySelectorAll('table');
        return { text, inputs: inputs.length, tables: tables.length };
      } catch(e) {
        return { error: e.message, src: iframe.src?.substring(0, 100) };
      }
    }).catch(() => ({}));
    
    if (i % 3 === 0) {
      log(`[${i*5}s] Iframe state: ${JSON.stringify(state).substring(0, 300)}`);
      await lstng.screenshot({ path: `price-test-iframe-${i}.png` });
    }
    
    // Check ALL pages for variation table (including iframe frames accessible via puppeteer)
    const frames = lstng.frames();
    for (const frame of frames) {
      const fUrl = frame.url();
      if (!fUrl.includes('bulkedit')) continue;
      
      const fCheck = await frame.evaluate(() => {
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
        
        const priceInputs = Array.from(document.querySelectorAll('input')).filter(i => {
          const l = (i.getAttribute('aria-label') || i.name || '').toLowerCase();
          return l.includes('price') && i.value;
        });
        
        return { maxRows, priceCount: priceInputs.length, tableData, bodyText: document.body?.innerText?.substring(0, 200) };
      }).catch(() => ({}));
      
      if (fCheck.priceCount > 2) {
        log(`PRICES FOUND in iframe! ${fCheck.priceCount} prices`);
        log('Table: ' + JSON.stringify(fCheck.tableData).substring(0, 1000));
        
        const prices = fCheck.tableData.flatMap(r => r.inputs.map(i => parseFloat(i.value)).filter(v => !isNaN(v) && v > 5));
        const qtys = fCheck.tableData.flatMap(r => r.inputs.map(i => parseInt(i.value)).filter(v => !isNaN(v) && v >= 0 && v <= 100));
        
        log('Prices: ' + JSON.stringify([...new Set(prices)]));
        log('Qtys: ' + JSON.stringify(qtys));
        
        await lstng.screenshot({ path: 'price-test-variation-table.png', fullPage: true });
        fs.writeFileSync('price-test-table-data.json', JSON.stringify(fCheck, null, 2));
        
        browser.disconnect();
        process.exit(0);
      }
      
      if (fCheck.bodyText) {
        log(`iframe body: ${fCheck.bodyText.substring(0, 100)}`);
      }
    }
  }
  
  // Final diagnostics
  const finalDiag = await extPage.evaluate(async () => {
    const d = await new Promise(r => chrome.storage.local.get(null, r));
    return Object.keys(d).filter(k => k.includes('variation') || k.includes('pending') || k.includes('_df'));
  });
  log('Final diag keys: ' + JSON.stringify(finalDiag));
  
  browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
