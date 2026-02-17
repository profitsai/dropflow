const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const testProduct = {
  variations: {
    hasVariations: true,
    axes: [
      { name: "Color", values: [{name: "Red"}, {name: "Black"}] },
      { name: "Size", values: [{name: "XS"}, {name: "S"}, {name: "M"}, {name: "L"}, {name: "XL"}] }
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
    ]
  }
};

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const lstng = pages.find(p => p.url().includes('/lstng'));
  const bf = lstng.frames().find(f => f.url().includes('bulkedit'));
  
  // Step 1: Select sizes (XS, S, M, L, XL) on Dog Size tab
  log('Selecting Dog Size options...');
  const sizesToSelect = ['XS', 'S', 'M', 'L', 'XL'];
  await bf.evaluate((sizes) => {
    // Click on Dog Size tab first
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.textContent?.trim() === 'Dog Size' && el.offsetHeight > 0 && el.clientHeight < 50) {
        el.click();
        break;
      }
    }
    
    // Wait a tick then click size options
    setTimeout(() => {
      const options = document.querySelectorAll('[class*="option"], [class*="chip"], button, span');
      for (const opt of options) {
        const text = opt.textContent?.trim();
        if (sizes.includes(text) && opt.offsetHeight > 0 && opt.clientHeight < 40) {
          opt.click();
        }
      }
    }, 500);
  }, sizesToSelect);
  await sleep(2000);
  
  // Check what's selected
  const afterSizes = await bf.evaluate(() => {
    const rightPanel = document.querySelector('[class*="selected"], [class*="right"]');
    return document.body.innerText.substring(0, 800);
  });
  log('After sizes: ' + afterSizes.substring(0, 200));
  await lstng.screenshot({ path: 'price-test-sizes-selected.png' });
  
  // Step 2: Switch to Colour tab and select Red, Black
  log('Switching to Colour tab...');
  await bf.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.textContent?.trim() === 'Colour' && el.offsetHeight > 0 && el.clientHeight < 50) {
        el.click();
        break;
      }
    }
  });
  await sleep(1000);
  
  const coloursToSelect = ['Red', 'Black'];
  await bf.evaluate((colours) => {
    const options = document.querySelectorAll('[class*="option"], [class*="chip"], button, span');
    for (const opt of options) {
      const text = opt.textContent?.trim();
      if (colours.includes(text) && opt.offsetHeight > 0 && opt.clientHeight < 40) {
        opt.click();
      }
    }
  }, coloursToSelect);
  await sleep(1000);
  await lstng.screenshot({ path: 'price-test-colours-selected.png' });
  
  // Check right panel for selected items
  const rightPanel = await bf.evaluate(() => {
    return document.body.innerText.substring(0, 1000);
  });
  log('After colours: ' + rightPanel.substring(0, 300));
  
  // Step 3: Click Continue
  log('Clicking Continue...');
  await bf.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent?.trim() === 'Continue' && btn.offsetHeight > 0) {
        btn.click();
        return 'clicked Continue';
      }
    }
    return 'Continue not found';
  }).then(r => log('  ' + r));
  await sleep(5000);
  await lstng.screenshot({ path: 'price-test-after-continue.png' });
  
  // Check what page we're on now
  const afterContinue = await bf.evaluate(() => document.body.innerText.substring(0, 1000));
  log('After continue: ' + afterContinue.substring(0, 300));
  
  // If there's a combinations table or pricing page, we need to check it
  const tableCheck = await bf.evaluate(() => {
    const tables = document.querySelectorAll('table');
    let maxRows = 0;
    let data = [];
    for (const t of tables) {
      const rows = t.querySelectorAll('tr');
      if (rows.length > maxRows) {
        maxRows = rows.length;
        data = Array.from(rows).slice(0, 15).map(row => ({
          cells: Array.from(row.querySelectorAll('td, th')).map(c => c.textContent?.trim()?.substring(0, 30)),
          inputs: Array.from(row.querySelectorAll('input')).map(i => ({
            value: i.value,
            name: (i.getAttribute('aria-label') || i.name || i.id || '').substring(0, 30),
            type: i.type
          }))
        }));
      }
    }
    const inputs = Array.from(document.querySelectorAll('input'));
    return { maxRows, data, inputCount: inputs.length };
  });
  
  log('Table: ' + tableCheck.maxRows + ' rows, ' + tableCheck.inputCount + ' inputs');
  if (tableCheck.data.length > 0) {
    log('Table data: ' + JSON.stringify(tableCheck.data).substring(0, 1000));
  }
  
  browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
