const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const lstng = pages.find(p => p.url().includes('/lstng'));
  const bf = lstng.frames().find(f => f.url().includes('bulkedit'));
  
  // First, click on Colour tab to make sure it's active
  log('Clicking Colour tab...');
  await bf.evaluate(() => {
    // The Colour chip/tab - it has an "x" which means it's already added as an attribute
    const spans = document.querySelectorAll('span, div, button');
    for (const el of spans) {
      const text = el.textContent?.trim();
      // Match "Colour" exactly (not "Colour x" which is the attribute chip)
      if (text === 'Colour' && el.offsetHeight > 0) {
        el.click();
        return 'clicked ' + el.tagName;
      }
    }
  });
  await sleep(1000);
  
  // Now find and click the Red and Black option chips
  log('Clicking Red option...');
  // Use xpath-like approach to find the exact element
  const clickedRed = await bf.evaluate(() => {
    // Find all clickable option elements
    const options = document.querySelectorAll('.optionValue, [class*="optionValue"], [class*="option-value"]');
    let clicked = [];
    
    // Try generic approach - find text "Red" at leaf level
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (el.offsetHeight === 0) continue;
      const text = el.textContent?.trim();
      // Only match exact "Red" (not "Red Silver" etc)
      if (text === 'Red' && el.children.length === 0) {
        el.click();
        clicked.push({ tag: el.tagName, class: el.className?.substring(0, 30), text });
      }
    }
    return clicked;
  });
  log('Clicked Red: ' + JSON.stringify(clickedRed));
  await sleep(500);
  
  log('Clicking Black option...');
  await bf.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (el.offsetHeight === 0) continue;
      if (el.textContent?.trim() === 'Black' && el.children.length === 0) {
        el.click();
        return true;
      }
    }
  });
  await sleep(1000);
  await lstng.screenshot({ path: 'price-test-colours-clicked.png' });
  
  // Check right panel
  const rightPanel = await bf.evaluate(() => {
    // Find the right panel content
    const panels = document.querySelectorAll('[class*="panel"], [class*="selected"], [class*="right"]');
    for (const p of panels) {
      if (p.textContent?.includes('Attributes and options')) {
        return p.innerText?.substring(0, 300);
      }
    }
    return 'panel not found';
  });
  log('Right panel: ' + rightPanel);
  
  // Now switch to Dog Size and select sizes
  log('Clicking Dog Size tab...');
  await bf.evaluate(() => {
    const spans = document.querySelectorAll('span, div, button');
    for (const el of spans) {
      if (el.textContent?.trim() === 'Dog Size' && el.offsetHeight > 0) {
        el.click();
        return;
      }
    }
  });
  await sleep(1000);
  
  // Click sizes XS, S, M, L, XL
  for (const size of ['XS', 'S', 'M', 'L', 'XL']) {
    await bf.evaluate((sz) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        const el = walker.currentNode;
        if (el.offsetHeight === 0) continue;
        if (el.textContent?.trim() === sz && el.children.length === 0) {
          el.click();
          return true;
        }
      }
    }, size);
    await sleep(300);
  }
  await sleep(1000);
  await lstng.screenshot({ path: 'price-test-sizes-clicked.png' });
  
  // Check right panel again
  const rightPanel2 = await bf.evaluate(() => {
    const body = document.body.innerText;
    const idx = body.indexOf('Attributes and options');
    return idx >= 0 ? body.substring(idx, idx + 300) : 'not found';
  });
  log('Right panel: ' + rightPanel2);
  
  // Click Continue
  log('Clicking Continue...');
  await bf.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent?.trim() === 'Continue' && btn.offsetHeight > 0) {
        btn.click();
      }
    }
  });
  await sleep(5000);
  await lstng.screenshot({ path: 'price-test-after-continue-2.png' });
  
  // Check new page state
  const newState = await bf.evaluate(() => ({
    body: document.body.innerText?.substring(0, 500),
    tables: document.querySelectorAll('table').length,
    inputs: document.querySelectorAll('input').length
  }));
  log('After continue: tables=' + newState.tables + ', inputs=' + newState.inputs);
  log('Body: ' + newState.body.substring(0, 200));
  
  browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
