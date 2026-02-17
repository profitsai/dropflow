const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/itm/'));
  if (!ebay) { console.log('No listing page'); browser.disconnect(); return; }
  
  // Scroll to find variation pickers
  const varInfo = await ebay.evaluate(() => {
    // Look for variation-related elements
    const allText = document.body.innerText;
    const colorIdx = allText.indexOf('Colour');
    const sizeIdx = allText.indexOf('Size');
    
    // Find variation menu elements
    const menus = document.querySelectorAll('[class*="vim"], [id*="msku"], [class*="variation"], [class*="picker"], [data-testid*="variation"]');
    const menuInfo = Array.from(menus).map(m => ({
      tag: m.tagName,
      className: m.className?.substring?.(0, 60),
      text: m.textContent?.substring(0, 100),
      rect: m.getBoundingClientRect()
    }));
    
    // Look for any select/radio with Color/Size labels
    const labels = document.querySelectorAll('label, [class*="label"]');
    const varLabels = Array.from(labels).filter(l => {
      const t = l.textContent?.toLowerCase() || '';
      return t.includes('colour') || t.includes('color') || t.includes('size');
    }).map(l => ({
      text: l.textContent?.trim(),
      rect: l.getBoundingClientRect()
    }));
    
    // Check for msku variation section
    const mskuEl = document.querySelector('#msku-variation, [class*="msku"]');
    
    return { 
      colorIdx, sizeIdx, 
      menuCount: menuInfo.length,
      menus: menuInfo.slice(0, 5),
      varLabels,
      hasMsku: !!mskuEl,
      priceText: document.querySelector('.x-price-primary, [itemprop="price"]')?.textContent?.trim()
    };
  });
  console.log('Variation info:', JSON.stringify(varInfo, null, 2));
  
  // Scroll to the price area and screenshot
  await ebay.evaluate(() => {
    const priceEl = document.querySelector('.x-price-primary, [itemprop="price"], .vim');
    if (priceEl) priceEl.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 400);
  });
  await sleep(500);
  await ebay.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/screenshots/listing-price-area.png' });
  
  // Get the full listing body text to search for variation indicators
  const bodyText = await ebay.evaluate(() => document.body.innerText);
  // Search for key variation terms
  for (const term of ['Colour', 'Color', 'Size', 'Select', 'variation', 'XS', 'Red', 'Black', 'Blue']) {
    const idx = bodyText.indexOf(term);
    if (idx >= 0) {
      console.log(`Found "${term}" at position ${idx}: ...${bodyText.substring(Math.max(0, idx-20), idx+50)}...`);
    }
  }
  
  browser.disconnect();
})().catch(e => console.error('FATAL:', e.message));
