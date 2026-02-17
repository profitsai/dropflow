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
  
  // Helper: get LI option positions
  async function getOptionLIs() {
    return await bulkFrame.evaluate(() => {
      const results = {};
      const lis = document.querySelectorAll('li');
      for (const li of lis) {
        const text = li.textContent.trim();
        if (text && text.length < 30 && li.offsetParent !== null) {
          const rect = li.getBoundingClientRect();
          if (rect.width > 20 && rect.height > 15) {
            results[text] = {
              x: rect.x + rect.width/2,
              y: rect.y + rect.height/2,
              selected: li.classList.contains('selected')
            };
          }
        }
      }
      return results;
    });
  }
  
  // Helper: click an LI option using real mouse
  async function clickOption(text) {
    const options = await getOptionLIs();
    if (options[text]) {
      const absX = iframeOffset.x + options[text].x;
      const absY = iframeOffset.y + options[text].y;
      await page.mouse.click(absX, absY);
      return true;
    }
    return false;
  }
  
  // Helper: click any element in iframe
  async function clickEl(text) {
    const pos = await bulkFrame.evaluate((txt) => {
      const els = document.querySelectorAll('button, a, li, span, div, [role="button"]');
      for (const el of els) {
        if (el.textContent.trim() === txt && el.offsetParent !== null) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.width < 300 && rect.height > 0 && rect.height < 80) {
            return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
          }
        }
      }
      return null;
    }, text);
    if (!pos) return false;
    await page.mouse.click(iframeOffset.x + pos.x, iframeOffset.y + pos.y);
    return true;
  }
  
  // === Step 1: Deselect Coffee from Dog Size ===
  console.log('1. Deselecting Coffee from Dog Size...');
  
  // Coffee is a selected LI - clicking it should toggle it off
  let opts = await getOptionLIs();
  console.log('Current options:', Object.entries(opts).map(([k,v]) => `${k}${v.selected ? ' [selected]' : ''}`).join(', '));
  
  if (opts['Coffee']?.selected) {
    await clickOption('Coffee');
    console.log('  Clicked Coffee to deselect');
    await sleep(500);
  }
  
  // === Step 2: Select sizes XS, S, M, L, XL ===
  console.log('\n2. Selecting sizes...');
  for (const size of ['XS', 'S', 'M', 'L', 'XL']) {
    const clicked = await clickOption(size);
    console.log(`  ${size}: ${clicked ? 'clicked' : 'not found'}`);
    await sleep(400);
  }
  
  await sleep(500);
  
  // Verify
  opts = await getOptionLIs();
  console.log('\nOptions after clicking:', Object.entries(opts).map(([k,v]) => `${k}${v.selected ? ' [SELECTED]' : ''}`).join(', '));
  
  // Check right panel
  const rpText = await bulkFrame.evaluate(() => {
    const text = document.body.innerText;
    const start = text.indexOf('Dog Size\n');
    return text.substring(start, start + 200);
  });
  console.log('Right panel Dog Size:', rpText.substring(0, 100));
  
  await page.screenshot({ path: 'var-sizes-real.png' });
  fs.copyFileSync('var-sizes-real.png', '/Users/pyrite/.openclaw/workspace/var-sizes-real.png');
  
  // === Step 3: Switch to Colour attribute ===
  console.log('\n3. Switching to Colour...');
  
  // Find and click the Colour tag (it's in the attributes area)
  const colourTagPos = await bulkFrame.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      // Look for elements containing "Colour" in the attribute tags area (~y:150-200)
      const text = el.textContent.trim();
      const rect = el.getBoundingClientRect();
      if ((text === 'Colour x' || text === 'Colour') && rect.y > 140 && rect.y < 220 && rect.width < 200) {
        return { x: rect.x + rect.width/2, y: rect.y + rect.height/2, text };
      }
    }
    return null;
  });
  
  if (colourTagPos) {
    await page.mouse.click(iframeOffset.x + colourTagPos.x, iframeOffset.y + colourTagPos.y);
    console.log(`Clicked Colour tag at ${colourTagPos.x}, ${colourTagPos.y}`);
  } else {
    console.log('Colour tag not found!');
  }
  await sleep(1000);
  
  // Get colour options
  opts = await getOptionLIs();
  console.log('Colour options:', Object.keys(opts).join(', '));
  
  // Deselect Coffee if selected
  if (opts['Coffee']?.selected) {
    await clickOption('Coffee');
    console.log('  Deselected Coffee');
    await sleep(400);
  }
  
  // Select Red, Black
  for (const color of ['Red', 'Black']) {
    const clicked = await clickOption(color);
    console.log(`  ${color}: ${clicked ? 'clicked' : 'not found'}`);
    await sleep(400);
  }
  
  // Add Coffee custom for Colour
  console.log('  Adding Coffee custom...');
  await clickEl('+ Create your own');
  await sleep(500);
  
  // Find and click the input
  const inputPos = await bulkFrame.evaluate(() => {
    const input = document.getElementById('msku-custom-option-input');
    if (!input || !input.offsetParent) return null;
    const rect = input.getBoundingClientRect();
    return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
  });
  
  if (inputPos) {
    await page.mouse.click(iframeOffset.x + inputPos.x, iframeOffset.y + inputPos.y);
    await sleep(200);
    await page.keyboard.type('Coffee', { delay: 30 });
    await sleep(200);
    
    // Find and click Add button
    const addPos = await bulkFrame.evaluate(() => {
      const btns = document.querySelectorAll('button, a');
      for (const b of btns) {
        if (b.textContent.trim() === 'Add' && b.offsetParent !== null) {
          const rect = b.getBoundingClientRect();
          if (rect.width > 0 && rect.y > 250) { // In the options area
            return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
          }
        }
      }
      return null;
    });
    
    if (addPos) {
      await page.mouse.click(iframeOffset.x + addPos.x, iframeOffset.y + addPos.y);
      console.log('  Clicked Add button');
    } else {
      await page.keyboard.press('Enter');
      console.log('  Pressed Enter');
    }
  }
  
  await sleep(1000);
  
  // Verify final state
  opts = await getOptionLIs();
  console.log('\nFinal options:', Object.entries(opts).map(([k,v]) => `${k}${v.selected ? ' [SELECTED]' : ''}`).join(', '));
  
  const finalRP = await bulkFrame.evaluate(() => {
    const text = document.body.innerText;
    const idx = text.indexOf('Attributes and options');
    return text.substring(idx, idx + 400);
  });
  console.log('\nFinal right panel:', finalRP);
  
  await page.screenshot({ path: 'var-final5.png' });
  fs.copyFileSync('var-final5.png', '/Users/pyrite/.openclaw/workspace/var-final5.png');
  
  browser.disconnect();
})().catch(e => console.error(e));
