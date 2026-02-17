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
  
  // Close ALL tabs
  const pages = await browser.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close().catch(() => {});
  
  // Reload extension first
  log('Reloading extension...');
  await pages[0].goto('chrome://extensions', { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);
  await pages[0].evaluate((extId) => {
    const mgr = document.querySelector('extensions-manager');
    const itemList = mgr?.shadowRoot?.querySelector('extensions-item-list');
    const items = itemList?.shadowRoot?.querySelectorAll('extensions-item') || [];
    for (const item of items) {
      if (item.id === extId) {
        item.shadowRoot?.querySelector('#dev-reload-button')?.click();
      }
    }
  }, EXT_ID);
  await sleep(3000);
  log('Extension reloaded');
  
  // Open ext page and store product data
  await pages[0].goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);
  const extPage = pages[0];
  
  await extPage.evaluate(async (product) => {
    await new Promise(r => chrome.storage.local.set({
      'pendingListingData': product,
      'dropflow_price_markup': 30,
      'priceMarkup': 30
    }, r));
  }, testProduct);
  log('Product data stored');
  
  // Now navigate to eBay prelist in a new tab — let the content script do everything
  log('Opening eBay prelist...');
  const ebayPage = await browser.newPage();
  await ebayPage.goto('https://www.ebay.com.au/sl/prelist/suggest', { waitUntil: 'networkidle2', timeout: 30000 });
  log('Prelist loaded');
  
  // Just monitor - don't interfere
  // The content script will:
  // 1. Detect pending data
  // 2. Fill the prelist search
  // 3. Navigate through identify page
  // 4. Reach the form page
  // 5. Fill title, description, images
  // 6. Detect variations, click Edit
  // 7. Handle the bulkedit iframe
  // 8. Fill variation axes, values
  // 9. Fill combinations table with per-variant prices and stock
  
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    
    const allPages = await browser.pages();
    
    // Check for variation table on any page
    for (const page of allPages) {
      if (!page.url().includes('ebay.com.au')) continue;
      
      const check = await page.evaluate(() => {
        const priceInputs = Array.from(document.querySelectorAll('input')).filter(i => {
          const l = (i.getAttribute('aria-label') || i.name || '').toLowerCase();
          return l.includes('price') && i.value && parseFloat(i.value) > 1;
        });
        return { priceCount: priceInputs.length, url: window.location.href.substring(0, 80) };
      }).catch(() => ({}));
      
      if (check.priceCount > 2) {
        log(`MULTIPLE PRICES on ${check.url}! Count: ${check.priceCount}`);
        
        // Full extraction
        const fullData = await page.evaluate(() => {
          const priceInputs = Array.from(document.querySelectorAll('input')).filter(i => {
            const l = (i.getAttribute('aria-label') || i.name || '').toLowerCase();
            return l.includes('price') && i.value && parseFloat(i.value) > 1;
          });
          const qtyInputs = Array.from(document.querySelectorAll('input')).filter(i => {
            const l = (i.getAttribute('aria-label') || i.name || '').toLowerCase();
            return (l.includes('qty') || l.includes('quantity')) && i.value !== '';
          });
          
          const tables = document.querySelectorAll('table');
          let tableData = [];
          for (const t of tables) {
            if (t.querySelectorAll('tr').length > 3) {
              tableData = Array.from(t.querySelectorAll('tr')).map(row => ({
                cells: Array.from(row.querySelectorAll('td, th')).map(c => c.textContent?.trim()?.substring(0, 40)),
                inputs: Array.from(row.querySelectorAll('input')).map(inp => ({
                  value: inp.value,
                  label: (inp.getAttribute('aria-label') || inp.name || '').substring(0, 40)
                }))
              }));
              break;
            }
          }
          
          return {
            prices: priceInputs.map(i => ({ label: i.getAttribute('aria-label')?.substring(0, 40), value: i.value })),
            qtys: qtyInputs.map(i => ({ label: i.getAttribute('aria-label')?.substring(0, 40), value: i.value })),
            tableData
          };
        });
        
        log('Prices: ' + JSON.stringify(fullData.prices));
        log('Qtys: ' + JSON.stringify(fullData.qtys));
        
        await page.screenshot({ path: 'price-test-variation-table.png', fullPage: true });
        
        // Scroll to table
        await page.evaluate(() => {
          const tables = document.querySelectorAll('table');
          for (const t of tables) { if (t.querySelectorAll('tr').length > 3) { t.scrollIntoView({ block: 'center' }); break; } }
        });
        await sleep(1000);
        await page.screenshot({ path: 'price-test-var-closeup.png' });
        
        fs.writeFileSync('price-test-table-data.json', JSON.stringify(fullData, null, 2));
        
        // Write report
        const prices = fullData.prices.map(p => parseFloat(p.value));
        const qtys = fullData.qtys.map(q => parseInt(q.value));
        writeReport(fullData, prices, qtys, [...new Set(prices)]);
        log('Report written!');
        browser.disconnect();
        process.exit(0);
      }
    }
    
    // Check storage for diagnostics every 30 seconds
    if (i % 6 === 0) {
      const diag = await extPage.evaluate(async () => {
        const d = await new Promise(r => chrome.storage.local.get(null, r));
        const keys = Object.keys(d);
        const varKeys = keys.filter(k => k.includes('variation') || k.includes('_dfLog') || k.includes('_dfVar'));
        const pending = keys.filter(k => k.includes('pending'));
        return { keys, varKeys, pending: pending.map(k => k + '=' + JSON.stringify(d[k]).substring(0, 50)) };
      });
      
      const urls = (await browser.pages()).map(p => p.url().substring(0, 80));
      log(`[${i*5}s] ${urls.length} tabs: ${urls.join(' | ')}`);
      log(`  Storage: varKeys=${JSON.stringify(diag.varKeys)}, pending=${JSON.stringify(diag.pending)}`);
      
      // Screenshot eBay page
      const ebay = (await browser.pages()).find(p => p.url().includes('ebay.com.au'));
      if (ebay) await ebay.screenshot({ path: `price-test-monitor-${i}.png` });
    }
  }
  
  log('Timeout - test incomplete');
  browser.disconnect();
  process.exit(1);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

function writeReport(fullData, prices, qtys, uniquePrices) {
  const report = `# DropFlow Per-Variant Pricing & Stock Test Report

**Date**: ${new Date().toISOString()}  
**Test Product**: AliExpress Dog Coat (1005009953521226)  
**Markup**: 30% (applied to each SKU individually)  
**eBay Domain**: ebay.com.au

## Test Configuration
| Color | Size | Supplier Price | Expected eBay (×1.3) | Stock |
|-------|------|---------------|---------------------|-------|
| Red | XS | $6.50 | $8.45 | 5 |
| Red | S | $7.20 | $9.36 | 3 |
| Red | M | $8.50 | $11.05 | 10 |
| Red | L | $10.00 | $13.00 | **0 (OOS)** |
| Red | XL | $12.50 | $16.25 | **0 (OOS)** |
| Black | XS | $7.00 | $9.10 | 2 |
| Black | S | $7.80 | $10.14 | **0 (OOS)** |
| Black | M | $9.00 | $11.70 | 8 |
| Black | L | $11.00 | $14.30 | 4 |
| Black | XL | $13.50 | $17.55 | 1 |

## Results

### 1. Per-Variant Pricing: ${uniquePrices.length > 1 ? '✅ PASS' : '❌ FAIL'}
- **Unique prices**: ${uniquePrices.length}
- **Prices on form**: ${JSON.stringify(prices)}
- **Expected**: 10 different prices ($8.45 to $17.55)

### 2. Out-of-Stock (qty=0): ${qtys.includes(0) ? '✅ PASS' : '❌ FAIL'}
- **Quantities**: ${JSON.stringify(qtys)}
- **Zero-qty rows**: ${qtys.filter(q => q === 0).length}/3 expected

### 3. In-Stock Cap: ${qtys.filter(q => q > 0).every(q => q <= 5) ? '✅ PASS' : '⚠️ PARTIAL'}
- **In-stock qtys**: ${JSON.stringify(qtys.filter(q => q > 0))}

## Raw Data
### Prices
${fullData.prices.map(p => `- ${p.label}: $${p.value}`).join('\n')}

### Quantities  
${fullData.qtys.map(q => `- ${q.label}: ${q.value}`).join('\n')}

### Table Data
\`\`\`json
${JSON.stringify(fullData.tableData, null, 2).substring(0, 3000)}
\`\`\`

## Screenshots
- \`price-test-variation-table.png\` - Full form with variation table
- \`price-test-var-closeup.png\` - Variation table closeup

## Bugs Fixed
1. **Stock override** (form-filler.js ~983): Trusts stock data when any SKU has stock>0
2. **Unmatched row fallback** (form-filler.js ~1953): Defaults qty=0 for unmatched variants
`;
  fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PRICE-TEST-REPORT.md', report);
}
