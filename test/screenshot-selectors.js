const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/itm/'));
  
  // Scroll to the Dog Size / Colour selectors
  await ebay.evaluate(() => {
    const labels = document.querySelectorAll('label');
    for (const l of labels) {
      if (l.textContent.includes('Dog Size') || l.textContent.includes('Colour')) {
        l.scrollIntoView({ block: 'start' });
        break;
      }
    }
  });
  await sleep(500);
  await ebay.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/screenshots/variation-selectors.png' });
  
  // Get variation dropdown options
  const varOptions = await ebay.evaluate(() => {
    const results = {};
    const labels = document.querySelectorAll('label');
    for (const l of labels) {
      const text = l.textContent?.trim();
      if (text?.includes('Dog Size') || text?.includes('Colour')) {
        const forId = l.getAttribute('for');
        const select = forId ? document.getElementById(forId) : l.parentElement?.querySelector('select');
        if (select) {
          results[text] = Array.from(select.options).map(o => ({
            text: o.textContent?.trim(),
            value: o.value
          })).filter(o => o.value !== '-1');
        }
      }
    }
    return results;
  });
  console.log('Variation options:', JSON.stringify(varOptions, null, 2));
  
  // Select a specific variant and check its price
  const priceCheck = await ebay.evaluate(async () => {
    const results = [];
    const selects = {};
    const labels = document.querySelectorAll('label');
    for (const l of labels) {
      const t = l.textContent?.trim();
      if (t?.includes('Dog Size') || t?.includes('Colour')) {
        const forId = l.getAttribute('for');
        const sel = forId ? document.getElementById(forId) : l.parentElement?.querySelector('select');
        if (sel) selects[t.replace(':', '')] = sel;
      }
    }
    
    // Try selecting Color=Red, Size=XS -> should be $8.45
    const colorSel = selects['Colour'] || selects['Color'];
    const sizeSel = selects['Dog Size'] || selects['Size'];
    
    if (colorSel && sizeSel) {
      // Select each size for Red and check price
      const redOpt = Array.from(colorSel.options).find(o => o.textContent.includes('Red'));
      if (redOpt) {
        colorSel.value = redOpt.value;
        colorSel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 1500));
        
        for (const sizeOpt of sizeSel.options) {
          if (sizeOpt.value === '-1') continue;
          sizeSel.value = sizeOpt.value;
          sizeSel.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 1000));
          
          const priceEl = document.querySelector('#prcIsum, .x-price-primary span[itemprop="price"], .x-price-primary .ux-textspans');
          results.push({
            color: 'Red',
            size: sizeOpt.textContent?.trim(),
            price: priceEl?.textContent?.trim()
          });
        }
      }
      
      // Select Black
      const blackOpt = Array.from(colorSel.options).find(o => o.textContent.includes('Black'));
      if (blackOpt) {
        colorSel.value = blackOpt.value;
        colorSel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 1500));
        
        for (const sizeOpt of sizeSel.options) {
          if (sizeOpt.value === '-1') continue;
          sizeSel.value = sizeOpt.value;
          sizeSel.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 1000));
          
          const priceEl = document.querySelector('#prcIsum, .x-price-primary span[itemprop="price"], .x-price-primary .ux-textspans');
          results.push({
            color: 'Black',
            size: sizeOpt.textContent?.trim(),
            price: priceEl?.textContent?.trim()
          });
        }
      }
    }
    
    return results;
  });
  console.log('\nPer-variant prices:');
  for (const p of priceCheck) {
    console.log(`  ${p.color} / ${p.size}: ${p.price}`);
  }
  
  await ebay.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/screenshots/variant-price-check.png' });
  
  browser.disconnect();
})().catch(e => console.error('FATAL:', e.message));
