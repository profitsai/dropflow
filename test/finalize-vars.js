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
  const bulkFrame = page.frames().find(f => f.url().includes('bulkedit'));
  
  const iframeOffset = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="bulkedit"]');
    const rect = iframe.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  
  // Remove Coffee from Dog Size - click the "x" next to Coffee in the Dog Size section of right panel
  console.log('1. Removing Coffee from Dog Size...');
  
  // Find Coffee x button(s) in the right panel
  // The right panel has "Dog Size" section with "Coffee x", "XS x", "S x", etc.
  const coffeeTags = await bulkFrame.evaluate(() => {
    // Find all small tag-like elements with "x" that contain "Coffee"
    const results = [];
    const allEls = document.querySelectorAll('li, span, div, button');
    for (const el of allEls) {
      const text = el.textContent.trim();
      if (text === 'Coffee x' || text === 'Coffee  x') {
        const rect = el.getBoundingClientRect();
        if (rect.x > 800) { // Right panel starts around x=900
          // Find the actual x/close button inside
          const xEl = el.querySelector('span, button, i');
          if (xEl && xEl.textContent.trim() === 'x') {
            const xRect = xEl.getBoundingClientRect();
            results.push({ x: xRect.x + xRect.width/2, y: xRect.y + xRect.height/2, parentY: rect.y });
          } else {
            results.push({ x: rect.x + rect.width - 10, y: rect.y + rect.height/2, parentY: rect.y });
          }
        }
      }
    }
    return results;
  });
  
  console.log('Coffee tags in right panel:', coffeeTags);
  
  // Click the Coffee x in Dog Size section (should be the one with higher y since Dog Size is below Colour)
  if (coffeeTags.length > 0) {
    // Sort by Y - the last one should be in the Dog Size section
    coffeeTags.sort((a, b) => b.parentY - a.parentY);
    const target = coffeeTags[0]; // Bottom one = Dog Size
    await page.mouse.click(iframeOffset.x + target.x, iframeOffset.y + target.y);
    console.log(`  Clicked at ${target.x}, ${target.y}`);
    await sleep(500);
  }
  
  // Alternative: switch to Dog Size, deselect Coffee option
  console.log('  Also deselecting Coffee in Dog Size options...');
  
  // Click Dog Size attribute
  const dsPos = await bulkFrame.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const text = el.textContent.trim();
      const rect = el.getBoundingClientRect();
      if ((text === 'Dog Size x' || text === 'Dog Size') && rect.y > 140 && rect.y < 220 && rect.width < 200) {
        return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
      }
    }
    return null;
  });
  
  if (dsPos) {
    await page.mouse.click(iframeOffset.x + dsPos.x, iframeOffset.y + dsPos.y);
    await sleep(500);
    
    // Check if Coffee is selected and deselect it
    const coffeeOpt = await bulkFrame.evaluate(() => {
      const lis = document.querySelectorAll('li');
      for (const li of lis) {
        if (li.textContent.trim() === 'Coffee' && li.classList.contains('selected')) {
          const rect = li.getBoundingClientRect();
          return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
        }
      }
      return null;
    });
    
    if (coffeeOpt) {
      await page.mouse.click(iframeOffset.x + coffeeOpt.x, iframeOffset.y + coffeeOpt.y);
      console.log('  Deselected Coffee option');
      await sleep(500);
    }
  }
  
  // Verify state
  const rpState = await bulkFrame.evaluate(() => {
    const text = document.body.innerText;
    const idx = text.lastIndexOf('Colour\n');
    return text.substring(idx, idx + 200);
  });
  console.log('\nRight panel:', rpState);
  
  await page.screenshot({ path: 'var-before-update.png' });
  fs.copyFileSync('var-before-update.png', '/Users/pyrite/.openclaw/workspace/var-before-update.png');
  
  // 2. Click "Update variations"
  console.log('\n2. Clicking Update variations...');
  const updatePos = await bulkFrame.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Update variations' && b.offsetParent !== null) {
        const rect = b.getBoundingClientRect();
        return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
      }
    }
    return null;
  });
  
  if (updatePos) {
    await page.mouse.click(iframeOffset.x + updatePos.x, iframeOffset.y + updatePos.y);
    console.log('Clicked Update variations');
  }
  await sleep(3000);
  
  // Check for "Update automatically" dialog
  const hasAutoDialog = await bulkFrame.evaluate(() => {
    return document.body.innerText.includes('automatically');
  });
  
  if (hasAutoDialog) {
    console.log('Auto update dialog appeared, clicking "Update automatically"...');
    const autoPos = await bulkFrame.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim().includes('automatically') && b.offsetParent !== null) {
          const rect = b.getBoundingClientRect();
          return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
        }
      }
      // Try "Yes" button
      for (const b of btns) {
        if (b.textContent.trim() === 'Yes' && b.offsetParent !== null) {
          const rect = b.getBoundingClientRect();
          if (rect.width > 0) return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
        }
      }
      return null;
    });
    
    if (autoPos) {
      await page.mouse.click(iframeOffset.x + autoPos.x, iframeOffset.y + autoPos.y);
      console.log('Clicked auto update');
    }
    await sleep(5000);
  }
  
  // Check result
  await page.screenshot({ path: 'var-updated-final.png' });
  fs.copyFileSync('var-updated-final.png', '/Users/pyrite/.openclaw/workspace/var-updated-final.png');
  
  const result = await bulkFrame.evaluate(() => {
    return {
      text: document.body.innerText.substring(0, 2000),
      tables: document.querySelectorAll('table').length,
      rows: document.querySelectorAll('table tbody tr').length,
      priceInputs: Array.from(document.querySelectorAll('input[id*="prc"]')).length,
      qtyInputs: Array.from(document.querySelectorAll('input[id*="qty"]')).length
    };
  }).catch(() => ({ error: 'frame error' }));
  
  console.log('\nResult:');
  console.log(`  Tables: ${result.tables}, Rows: ${result.rows}`);
  console.log(`  Price inputs: ${result.priceInputs}, Qty inputs: ${result.qtyInputs}`);
  console.log('  Text:', result.text?.substring(0, 500));
  
  browser.disconnect();
})().catch(e => console.error(e));
