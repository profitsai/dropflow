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
  currency: "AUD",
  ebayPrice: 10.56,
  ebayTitle: "Warm Fleece Dog Coat Hooded Waterproof Winter Pet Puppy Clothes Small Medium Dogs",
  aiDescription: "<p>Warm fleece dog coat with waterproof exterior. Keep your furry friend warm.</p>",
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
  
  // Close all tabs except one
  const pages = await browser.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close().catch(() => {});
  
  // Get extension page
  await pages[0].goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);
  const extPage = pages[0];
  
  // Store as pendingListingData (shared key)
  log('Storing product data...');
  await extPage.evaluate(async (product) => {
    await new Promise(r => chrome.storage.local.set({
      'pendingListingData': product
    }, r));
  }, testProduct);
  
  // Open eBay prelist in a NEW tab — the content script will auto-detect and fill
  log('Opening eBay prelist...');
  const ebayPage = await browser.newPage();
  
  // Enable console capture on the eBay page
  ebayPage.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('DropFlow') || text.includes('[DF')) {
      log('[DF] ' + text.substring(0, 300));
    }
  });
  
  await ebayPage.goto('https://www.ebay.com.au/sl/prelist/suggest', { waitUntil: 'networkidle2', timeout: 30000 });
  log('Prelist loaded: ' + ebayPage.url());
  await sleep(3000);
  
  // Monitor for up to 5 minutes
  let varTableFound = false;
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    
    const url = ebayPage.url();
    const allPages = await browser.pages();
    
    // Check ALL pages for variation content (eBay may open builder in new page/iframe)
    for (const page of allPages) {
      const pageUrl = page.url();
      if (!pageUrl.includes('ebay.com.au')) continue;
      
      const check = await page.evaluate(() => {
        // Find variation table
        const tables = document.querySelectorAll('table');
        let maxRows = 0;
        let tableData = [];
        for (const t of tables) {
          const rows = t.querySelectorAll('tr');
          if (rows.length > maxRows) {
            maxRows = rows.length;
            tableData = Array.from(rows).map(row => {
              const cells = Array.from(row.querySelectorAll('td, th')).map(c => c.textContent?.trim()?.substring(0, 40));
              const inputs = Array.from(row.querySelectorAll('input')).map(inp => ({
                value: inp.value,
                label: (inp.getAttribute('aria-label') || inp.name || inp.id || '').substring(0, 50)
              }));
              return { cells, inputs };
            });
          }
        }
        
        // Count price-related inputs
        const priceInputs = Array.from(document.querySelectorAll('input')).filter(i => {
          const ctx = (i.getAttribute('aria-label') || i.name || i.id || '').toLowerCase();
          return ctx.includes('price') && i.value && parseFloat(i.value) > 1;
        });
        
        return { maxTableRows: maxRows, priceCount: priceInputs.length, tableData, url: window.location.href.substring(0, 80) };
      }).catch(() => ({ error: true }));
      
      if (check.maxTableRows > 3 && check.priceCount > 2) {
        log(`VARIATION TABLE FOUND on ${check.url}! ${check.maxTableRows} rows, ${check.priceCount} prices`);
        varTableFound = true;
        
        // Extract prices and quantities
        const prices = [];
        const qtys = [];
        for (const row of check.tableData) {
          for (const inp of row.inputs) {
            const val = parseFloat(inp.value);
            if (!isNaN(val)) {
              if (val > 5) prices.push(val);
              if (val >= 0 && val <= 100 && Number.isInteger(val)) qtys.push(val);
            }
          }
        }
        
        log('Prices: ' + JSON.stringify([...new Set(prices)]));
        log('Quantities: ' + JSON.stringify(qtys));
        
        await page.screenshot({ path: 'price-test-variation-table.png', fullPage: true });
        await page.evaluate(() => {
          const tables = document.querySelectorAll('table');
          for (const t of tables) { if (t.querySelectorAll('tr').length > 3) { t.scrollIntoView({ block: 'center' }); break; } }
        });
        await sleep(1000);
        await page.screenshot({ path: 'price-test-var-closeup.png' });
        
        fs.writeFileSync('price-test-table-data.json', JSON.stringify(check.tableData, null, 2));
        break;
      }
    }
    
    if (varTableFound) break;
    
    if (i % 6 === 0) {
      log(`[${i*5}s] URL: ${url.substring(0, 80)}, tabs: ${allPages.length}`);
      await ebayPage.screenshot({ path: `price-test-progress-${i}.png` });
    }
  }
  
  // Check variation diagnostics from storage
  const diagData = await extPage.evaluate(async () => {
    const data = await new Promise(r => chrome.storage.local.get(null, r));
    const result = {};
    for (const [k, v] of Object.entries(data)) {
      if (k.includes('variation') || k.includes('_dfLog') || k.includes('_dfVar')) {
        result[k] = v;
      }
    }
    return result;
  });
  log('Variation diagnostics: ' + JSON.stringify(diagData).substring(0, 1000));
  
  if (!varTableFound) {
    log('No variation table found. Taking final screenshots.');
    await ebayPage.screenshot({ path: 'price-test-final-state.png', fullPage: true });
  }
  
  browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
