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
  title: "Warm Fleece Dog Coat With Hooded Waterproof Winter Pet Puppy Clothes For Small Medium Dogs Cats French Bulldog Hoodie Costume",
  price: 8.12,
  originalPrice: 16.93,
  currency: "AUD",
  ebayPrice: 10.56,
  ebayTitle: "Warm Fleece Dog Coat Hooded Waterproof Winter Pet Puppy Clothes Small Medium Dogs",
  aiDescription: "<p>Warm fleece dog coat with waterproof exterior.</p>",
  images: [
    "https://ae-pic-a1.aliexpress-media.com/kf/S1cf750c0a3554bbdae157dd2c4d92e26C.jpg",
    "https://ae-pic-a1.aliexpress-media.com/kf/Sc5bfa0e7793d4562a3ffe0bbe3a661166.jpg"
  ],
  aliexpressUrl: "https://www.aliexpress.com/item/1005009953521226.html",
  sourceType: "aliexpress",
  variations: {
    hasVariations: true,
    axes: [
      {
        name: "Color",
        values: [
          {name: "Red", image: "https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg", soldOut: false},
          {name: "Black", image: "https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg", soldOut: false}
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
      {color: "Red", size: "XS", price: 6.50,  ebayPrice: 8.45,  stock: 5,  skuId: "r-xs"},
      {color: "Red", size: "S",  price: 7.20,  ebayPrice: 9.36,  stock: 3,  skuId: "r-s"},
      {color: "Red", size: "M",  price: 8.50,  ebayPrice: 11.05, stock: 10, skuId: "r-m"},
      {color: "Red", size: "L",  price: 10.00, ebayPrice: 13.00, stock: 0,  skuId: "r-l"},
      {color: "Red", size: "XL", price: 12.50, ebayPrice: 16.25, stock: 0,  skuId: "r-xl"},
      {color: "Black", size: "XS", price: 7.00,  ebayPrice: 9.10,  stock: 2,  skuId: "b-xs"},
      {color: "Black", size: "S",  price: 7.80,  ebayPrice: 10.14, stock: 0,  skuId: "b-s"},
      {color: "Black", size: "M",  price: 9.00,  ebayPrice: 11.70, stock: 8,  skuId: "b-m"},
      {color: "Black", size: "L",  price: 11.00, ebayPrice: 14.30, stock: 4,  skuId: "b-l"},
      {color: "Black", size: "XL", price: 13.50, ebayPrice: 17.55, stock: 1,  skuId: "b-xl"},
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
  
  if (!extPage || !lstng) {
    log('Missing pages. ext=' + !!extPage + ' lstng=' + !!lstng);
    process.exit(1);
  }
  
  // Get the eBay tab ID
  const tabId = await extPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: '*://www.ebay.com.au/lstng*' });
    return tabs[0]?.id;
  });
  log('eBay tab: ' + tabId);
  
  // Inject content script fresh
  await extPage.evaluate(async (tid) => {
    await chrome.scripting.executeScript({
      target: { tabId: tid },
      files: ['content-scripts/ebay/form-filler.js']
    });
  }, tabId);
  await sleep(3000);
  log('Content script injected');
  
  // Send FILL_EBAY_FORM with our test data
  log('Sending FILL_EBAY_FORM with varied-price product data...');
  
  // Listen for console on the eBay page
  const client = await lstng.createCDPSession();
  await client.send('Runtime.enable');
  const consoleLogs = [];
  client.on('Runtime.consoleAPICalled', (params) => {
    const args = params.args.map(a => a.value || a.description || '?').join(' ');
    if (args.includes('DropFlow') || args.includes('dropflow') || args.includes('[DF]')) {
      consoleLogs.push(`[${params.type}] ${args}`);
      console.log(`  [DF] ${args.substring(0, 200)}`);
    }
  });
  
  const fillResult = await extPage.evaluate(async (tid, product) => {
    try {
      const resp = await chrome.tabs.sendMessage(tid, {
        type: 'FILL_EBAY_FORM',
        productData: product
      });
      return resp;
    } catch(e) {
      return { error: e.message };
    }
  }, tabId, testProduct);
  
  log('Fill result: ' + JSON.stringify(fillResult).substring(0, 500));
  
  // Wait and collect console logs
  log('Waiting 120s for variation setup...');
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    
    // Check for variation table
    const formCheck = await lstng.evaluate(() => {
      const tables = document.querySelectorAll('table');
      let maxRows = 0;
      for (const t of tables) {
        maxRows = Math.max(maxRows, t.querySelectorAll('tr').length);
      }
      
      const allInputs = Array.from(document.querySelectorAll('input'));
      const priceInputs = allInputs.filter(i => {
        const ctx = (i.name || i.id || i.getAttribute('aria-label') || '').toLowerCase();
        return ctx.includes('price') && i.value && !isNaN(parseFloat(i.value)) && parseFloat(i.value) > 1;
      });
      
      const iframes = document.querySelectorAll('iframe');
      return { 
        maxTableRows: maxRows, 
        priceInputs: priceInputs.length,
        prices: priceInputs.map(i => parseFloat(i.value)),
        iframeCount: iframes.length,
        iframeSrcs: Array.from(iframes).map(f => f.src?.substring(0, 80))
      };
    }).catch(() => ({}));
    
    if (i % 3 === 0) {
      log(`[${i*5}s] table=${formCheck.maxTableRows}, prices=${formCheck.priceInputs}, iframes=${formCheck.iframeCount}`);
    }
    
    if (formCheck.priceInputs > 2) {
      log('MULTIPLE PRICES FOUND! ' + JSON.stringify(formCheck.prices));
      await lstng.screenshot({ path: 'price-test-variation-table.png', fullPage: true });
      
      // Get full table data
      const tableData = await lstng.evaluate(() => {
        const tables = document.querySelectorAll('table');
        let best = null; let maxR = 0;
        for (const t of tables) { const r = t.querySelectorAll('tr').length; if (r > maxR) { maxR = r; best = t; } }
        if (!best) return [];
        return Array.from(best.querySelectorAll('tr')).map(row => {
          const cells = Array.from(row.querySelectorAll('td, th')).map(c => c.textContent?.trim()?.substring(0, 40));
          const inputs = Array.from(row.querySelectorAll('input')).map(i => ({ value: i.value, label: (i.name || i.getAttribute('aria-label') || '').substring(0, 40) }));
          return { cells, inputs };
        });
      });
      
      fs.writeFileSync('price-test-table-data.json', JSON.stringify(tableData, null, 2));
      
      // Scroll to table
      await lstng.evaluate(() => {
        const tables = document.querySelectorAll('table');
        for (const t of tables) { if (t.querySelectorAll('tr').length > 3) { t.scrollIntoView({ block: 'center' }); break; } }
      });
      await sleep(1000);
      await lstng.screenshot({ path: 'price-test-var-closeup.png' });
      
      log('Screenshots saved. Console logs:');
      consoleLogs.forEach(l => console.log('  ' + l));
      break;
    }
    
    // Check if variation builder iframe opened
    if (formCheck.iframeSrcs?.some(s => s.includes('bulkedit') || s.includes('variation'))) {
      log('Variation builder iframe detected!');
    }
  }
  
  await client.detach();
  browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
