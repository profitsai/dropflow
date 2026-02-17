const puppeteer = require('puppeteer-core');
const fs = require('fs');
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('5051135836723'));
  await page.bringToFront();
  
  // Open variation editor
  console.log('1. Opening variation editor...');
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Edit') {
        const parent = b.closest('section, div');
        if (parent && parent.textContent.includes('Variation')) {
          b.scrollIntoView({ block: 'center' });
          b.click();
          return;
        }
      }
    }
  });
  await sleep(8000);
  
  const bulkFrame = page.frames().find(f => f.url().includes('bulkedit'));
  if (!bulkFrame) { console.log('No iframe'); browser.disconnect(); return; }
  
  await sleep(3000);
  
  const io = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="bulkedit"]');
    const rect = iframe.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  
  // First, fix the UPC field that has '24.99'
  console.log('2. Fixing UPC fields...');
  const upcFields = await bulkFrame.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"]');
    const results = [];
    for (const inp of inputs) {
      if (inp.value === '24.99') {
        const rect = inp.getBoundingClientRect();
        if (rect.x < 1000) { // UPC/SKU fields
          results.push({ x: rect.x + rect.width/2, y: rect.y + rect.height/2 });
        }
      }
    }
    return results;
  });
  
  for (const pos of upcFields) {
    await page.mouse.click(io.x + pos.x, io.y + pos.y);
    await sleep(100);
    await page.keyboard.down('Meta');
    await page.keyboard.press('a');
    await page.keyboard.up('Meta');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Tab');
    await sleep(100);
  }
  console.log(`Cleared ${upcFields.length} UPC fields`);
  
  // Now get all price input positions (at x > 1300)
  console.log('\n3. Setting prices using real mouse clicks...');
  
  const pricePositions = await bulkFrame.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"]');
    const results = [];
    for (const inp of inputs) {
      const rect = inp.getBoundingClientRect();
      if (rect.x > 1300 && rect.width > 50 && rect.width < 200 && rect.y > 0) {
        results.push({ x: rect.x + rect.width/2, y: rect.y + rect.height/2, value: inp.value });
      }
    }
    return results;
  });
  
  console.log(`Found ${pricePositions.length} price inputs`);
  
  // Click each price input and type the value
  for (let i = 0; i < pricePositions.length; i++) {
    const pos = pricePositions[i];
    
    // Scroll the input into view if needed
    if (io.y + pos.y > 700 || io.y + pos.y < 0) {
      await bulkFrame.evaluate((targetY) => {
        window.scrollBy(0, targetY - 300);
      }, pos.y);
      await sleep(200);
      
      // Recalculate positions
      const newIo = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="bulkedit"]');
        const rect = iframe.getBoundingClientRect();
        return { x: rect.x, y: rect.y };
      });
      
      // Re-find this price input
      const newPos = await bulkFrame.evaluate((idx) => {
        const inputs = document.querySelectorAll('input[type="text"]');
        const priceInputs = [];
        for (const inp of inputs) {
          const rect = inp.getBoundingClientRect();
          if (rect.x > 1300 && rect.width > 50 && rect.width < 200) {
            priceInputs.push({ x: rect.x + rect.width/2, y: rect.y + rect.height/2 });
          }
        }
        return priceInputs[idx] || null;
      }, i);
      
      if (newPos && newPos.y > 0 && newPos.y < 800) {
        await page.mouse.click(newIo.x + newPos.x, newIo.y + newPos.y);
      } else {
        continue;
      }
    } else {
      await page.mouse.click(io.x + pos.x, io.y + pos.y);
    }
    
    await sleep(50);
    await page.mouse.click(io.x + pos.x, io.y + pos.y, { clickCount: 3 }); // Triple-click to select all
    await sleep(50);
    await page.keyboard.type('24.99', { delay: 10 });
    await page.keyboard.press('Tab');
    await sleep(50);
    
    if (i % 5 === 4) console.log(`  Set price ${i+1}/${pricePositions.length}`);
  }
  console.log(`Set all ${pricePositions.length} prices`);
  
  // Verify
  const verify = await bulkFrame.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"]');
    const prices = [];
    for (const inp of inputs) {
      const rect = inp.getBoundingClientRect();
      if (rect.x > 1300 && rect.width > 50 && rect.width < 200) {
        prices.push(inp.value);
      }
    }
    return prices;
  });
  console.log('Prices:', [...new Set(verify)]);
  
  // Save and close
  console.log('\n4. Save and close...');
  await bulkFrame.evaluate(() => window.scrollTo(0, 99999));
  await sleep(500);
  
  const sncPos = await bulkFrame.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Save and close' && b.offsetParent !== null) {
        const rect = b.getBoundingClientRect();
        return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
      }
    }
    return null;
  });
  
  if (sncPos) {
    const newIo = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[src*="bulkedit"]');
      const rect = iframe.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    });
    await page.mouse.click(newIo.x + sncPos.x, newIo.y + sncPos.y);
    console.log('Clicked Save and close');
  }
  
  await sleep(8000);
  
  // Check final state
  const errors = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*="error"], [role="alert"]'))
      .filter(e => e.offsetParent !== null)
      .map(e => e.textContent.trim().substring(0, 150));
  });
  console.log('\nErrors:', errors);
  
  // Check variation section
  const varSection = await page.evaluate(() => {
    const text = document.body.innerText;
    const idx = text.indexOf('VARIATIONS');
    return text.substring(idx, idx + 300);
  });
  console.log('\nVariation section:', varSection);
  
  await page.screenshot({ path: '/Users/pyrite/.openclaw/workspace/final-after-prices.png' });
  
  browser.disconnect();
})().catch(e => console.error(e));
