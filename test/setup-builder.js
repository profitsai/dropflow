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
  
  if (!bf) { log('No bulkedit frame'); process.exit(1); }
  
  // Step 1: In the attribute dialog, uncheck Features, check Colour, save
  log('Setting up attributes...');
  await bf.evaluate(() => {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    for (const cb of checkboxes) {
      const label = cb.closest('label') || cb.parentElement;
      const text = label?.textContent?.trim() || '';
      
      if (text.includes('Features') && cb.checked) {
        cb.click(); // Uncheck Features
      }
      if (text.includes('Colour') && !cb.checked) {
        cb.click(); // Check Colour
      }
    }
  });
  await sleep(500);
  
  // Click Save
  await bf.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent?.trim() === 'Save' && btn.offsetHeight > 0) {
        btn.click();
        return 'clicked Save';
      }
    }
    return 'Save not found';
  }).then(r => log('  ' + r));
  await sleep(2000);
  await lstng.screenshot({ path: 'price-test-builder-attrs.png' });
  
  // Step 2: Now we should see Colour and Dog Size attributes with their options
  // Need to click on Colour tab and add "Red" and "Black"
  const bodyText = await bf.evaluate(() => document.body.innerText.substring(0, 1000));
  log('After save: ' + bodyText.substring(0, 200));
  
  // Click on the Colour attribute tab
  log('Clicking Colour tab...');
  await bf.evaluate(() => {
    const chips = document.querySelectorAll('[class*="chip"], [class*="tab"], button, [class*="attribute"]');
    for (const chip of chips) {
      if (chip.textContent?.trim().includes('Colour') && !chip.textContent?.includes('x')) {
        chip.click();
        return 'clicked Colour chip';
      }
    }
    // Try text match
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.textContent?.trim() === 'Colour' && el.offsetHeight > 0) {
        el.click();
        return 'clicked Colour text element';
      }
    }
    return 'Colour tab not found';
  }).then(r => log('  ' + r));
  await sleep(1000);
  await lstng.screenshot({ path: 'price-test-builder-colour.png' });
  
  // Check what options are available
  const colourOptions = await bf.evaluate(() => {
    const body = document.body.innerText;
    return body.substring(0, 1000);
  });
  log('Colour section: ' + colourOptions.substring(0, 300));
  
  // We need to add custom colour values "Red" and "Black"
  // Look for "+ Create your own" or an input field
  log('Adding Red and Black colours...');
  
  // Click "+ Create your own"
  await bf.evaluate(() => {
    const links = document.querySelectorAll('a, button, [class*="link"]');
    for (const link of links) {
      if (link.textContent?.includes('Create your own')) {
        link.click();
        return 'clicked Create your own';
      }
    }
    return 'Create your own not found';
  }).then(r => log('  ' + r));
  await sleep(1000);
  
  // Find the input field and type "Red"
  const inputResult = await bf.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    const visible = Array.from(inputs).filter(i => i.offsetHeight > 0);
    if (visible.length > 0) {
      const inp = visible[visible.length - 1]; // Usually the last visible input is the new one
      inp.focus();
      inp.value = 'Red';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      return { found: true, placeholder: inp.placeholder, id: inp.id };
    }
    return { found: false };
  });
  log('Input: ' + JSON.stringify(inputResult));
  await sleep(500);
  
  // Click Add button if there is one
  await bf.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent?.trim() === 'Add' && btn.offsetHeight > 0) {
        btn.click();
        return 'clicked Add';
      }
    }
    return 'no Add button';
  }).then(r => log('  ' + r));
  await sleep(500);
  
  // Add "Black" too
  await bf.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    const visible = Array.from(inputs).filter(i => i.offsetHeight > 0 && !i.value);
    if (visible.length > 0) {
      const inp = visible[visible.length - 1];
      inp.focus();
      inp.value = 'Black';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    }
  });
  await sleep(500);
  await bf.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent?.trim() === 'Add' && btn.offsetHeight > 0) {
        btn.click();
      }
    }
  });
  await sleep(1000);
  await lstng.screenshot({ path: 'price-test-builder-colours-added.png' });
  
  // Step 3: Switch to Dog Size tab and add sizes
  log('Switching to Dog Size tab...');
  await bf.evaluate(() => {
    const chips = document.querySelectorAll('[class*="chip"], [class*="tab"], button, span');
    for (const chip of chips) {
      if (chip.textContent?.trim().includes('Dog Size') && chip.offsetHeight > 0) {
        chip.click();
        return;
      }
    }
  });
  await sleep(1000);
  
  // Check what size options are available
  const sizeState = await bf.evaluate(() => document.body.innerText.substring(0, 1000));
  log('Size section: ' + sizeState.substring(0, 300));
  await lstng.screenshot({ path: 'price-test-builder-sizes.png' });
  
  browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
