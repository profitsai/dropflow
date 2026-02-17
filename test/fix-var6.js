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
  
  // Get the iframe position on the page  
  const iframeOffset = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="bulkedit"]');
    if (!iframe) return null;
    const rect = iframe.getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  });
  console.log('Iframe offset:', iframeOffset);
  
  if (!iframeOffset) {
    console.log('No iframe found!');
    browser.disconnect();
    return;
  }
  
  // Helper: click element in iframe using real mouse events
  async function clickInIframe(text) {
    const pos = await bulkFrame.evaluate((txt) => {
      const allEls = document.querySelectorAll('button, a, span, div, [role="button"]');
      for (const el of allEls) {
        if (el.textContent.trim() === txt && el.offsetParent !== null) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.width < 250 && rect.height > 0 && rect.height < 80) {
            return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
          }
        }
      }
      return null;
    }, text);
    
    if (!pos) return false;
    
    const absX = iframeOffset.x + pos.x;
    const absY = iframeOffset.y + pos.y;
    await page.mouse.click(absX, absY);
    return true;
  }
  
  // Helper: get positions of all option buttons
  async function getOptionPositions() {
    return await bulkFrame.evaluate(() => {
      const results = {};
      const allEls = document.querySelectorAll('button, a, span');
      for (const el of allEls) {
        const text = el.textContent.trim();
        if (text && text.length < 25 && el.offsetParent !== null) {
          const rect = el.getBoundingClientRect();
          // Option buttons are in the ~270-340 y range
          if (rect.width > 20 && rect.width < 120 && rect.height > 15 && rect.height < 50 && rect.y > 200 && rect.y < 400) {
            if (!results[text]) {
              results[text] = { x: rect.x + rect.width/2, y: rect.y + rect.height/2, w: rect.width, h: rect.height };
            }
          }
        }
      }
      return results;
    });
  }
  
  // Step 1: Remove Coffee from Dog Size right panel
  console.log('1. Removing Coffee from right panel...');
  
  // First get Coffee x button position in the right panel for Dog Size
  const coffeePosInRP = await bulkFrame.evaluate(() => {
    // There are two "Coffee x" tags in the right panel (one in Dog Size, one in Colour)
    // Find all "x" buttons next to Coffee text
    const xBtns = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 && el.textContent.trim() === 'x') {
        const parent = el.parentElement;
        if (parent && parent.textContent.trim().startsWith('Coffee')) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0) {
            xBtns.push({ x: rect.x + rect.width/2, y: rect.y + rect.height/2, parentText: parent.textContent.trim() });
          }
        }
      }
    }
    return xBtns;
  });
  console.log('Coffee x buttons:', coffeePosInRP);
  
  // Click all Coffee x buttons to remove them
  for (const pos of coffeePosInRP) {
    const absX = iframeOffset.x + pos.x;
    const absY = iframeOffset.y + pos.y;
    await page.mouse.click(absX, absY);
    console.log(`  Clicked Coffee x at ${absX}, ${absY}`);
    await sleep(500);
  }
  
  await sleep(500);
  await page.screenshot({ path: 'var-after-remove-coffee.png' });
  fs.copyFileSync('var-after-remove-coffee.png', '/Users/pyrite/.openclaw/workspace/var-after-remove-coffee.png');
  
  // Step 2: Make sure Dog Size is the active attribute and select sizes
  console.log('\n2. Clicking Dog Size attribute...');
  await clickInIframe('Dog Size x');
  await sleep(500);
  
  // Get option positions
  let options = await getOptionPositions();
  console.log('Options available:', Object.keys(options));
  
  // Click sizes
  console.log('Clicking sizes...');
  for (const size of ['XS', 'S', 'M', 'L', 'XL']) {
    if (options[size]) {
      const absX = iframeOffset.x + options[size].x;
      const absY = iframeOffset.y + options[size].y;
      await page.mouse.click(absX, absY);
      console.log(`  ${size}: clicked at ${absX}, ${absY}`);
    } else {
      console.log(`  ${size}: NOT FOUND in options`);
    }
    await sleep(400);
  }
  
  await sleep(500);
  await page.screenshot({ path: 'var-after-sizes.png' });
  fs.copyFileSync('var-after-sizes.png', '/Users/pyrite/.openclaw/workspace/var-after-sizes.png');
  
  // Check right panel
  const rpAfterSizes = await bulkFrame.evaluate(() => {
    const text = document.body.innerText;
    return text.substring(text.indexOf('Attributes and options'), text.indexOf('Update') || text.length).substring(0, 400);
  });
  console.log('\nRight panel:', rpAfterSizes);
  
  // Step 3: Switch to Colour
  console.log('\n3. Clicking Colour attribute...');
  await clickInIframe('Colour x');
  await sleep(1000);
  
  // Get colour option positions
  options = await getOptionPositions();
  console.log('Colour options:', Object.keys(options));
  
  // Click Red, Black
  for (const color of ['Red', 'Black']) {
    if (options[color]) {
      const absX = iframeOffset.x + options[color].x;
      const absY = iframeOffset.y + options[color].y;
      await page.mouse.click(absX, absY);
      console.log(`  ${color}: clicked at ${absX}, ${absY}`);
    } else {
      console.log(`  ${color}: NOT FOUND`);
    }
    await sleep(400);
  }
  
  // Create Coffee custom option
  console.log('Adding Coffee custom...');
  await clickInIframe('+ Create your own');
  await sleep(500);
  
  // Type in the input
  const inputPos = await bulkFrame.evaluate(() => {
    const input = document.getElementById('msku-custom-option-input');
    if (!input) return null;
    const rect = input.getBoundingClientRect();
    return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
  });
  
  if (inputPos) {
    await page.mouse.click(iframeOffset.x + inputPos.x, iframeOffset.y + inputPos.y);
    await sleep(200);
    await page.keyboard.type('Coffee', { delay: 30 });
    await sleep(200);
    
    // Click Add
    const addPos = await bulkFrame.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === 'Add' && b.offsetParent !== null && b.getBoundingClientRect().width > 0) {
          const classes = b.className.toLowerCase();
          if (classes.includes('option-add') || classes.includes('msku-option')) {
            const rect = b.getBoundingClientRect();
            return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
          }
        }
      }
      return null;
    });
    
    if (addPos) {
      await page.mouse.click(iframeOffset.x + addPos.x, iframeOffset.y + addPos.y);
      console.log('Clicked Add');
    } else {
      // Press Enter instead
      await page.keyboard.press('Enter');
      console.log('Pressed Enter');
    }
  }
  
  await sleep(1000);
  
  // Final state
  const finalState = await bulkFrame.evaluate(() => {
    return document.body.innerText.substring(document.body.innerText.indexOf('Attributes and options'), 
      document.body.innerText.indexOf('Update') + 30).substring(0, 400);
  });
  console.log('\nFinal state:', finalState);
  
  await page.screenshot({ path: 'var-final4.png' });
  fs.copyFileSync('var-final4.png', '/Users/pyrite/.openclaw/workspace/var-final4.png');
  
  browser.disconnect();
})().catch(e => console.error(e));
