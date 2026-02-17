const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  const bf = ebay.frames().find(f => f.url().includes('bulkedit'));
  if (!bf) { console.error('No bulkedit frame'); process.exit(1); }
  
  // Step 1: Uncheck "Features" checkbox
  console.log('=== Step 1: Uncheck Features ===');
  await bf.evaluate(() => {
    const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')];
    for (const cb of checkboxes) {
      const label = cb.closest('label') || cb.parentElement;
      if (label?.textContent?.trim() === 'Features' && cb.checked) {
        cb.click();
        return;
      }
    }
  });
  await sleep(500);
  
  // Step 2: Check "Colour" checkbox
  console.log('=== Step 2: Check Colour ===');
  await bf.evaluate(() => {
    const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')];
    for (const cb of checkboxes) {
      const label = cb.closest('label') || cb.parentElement;
      if (label?.textContent?.trim() === 'Colour' && !cb.checked) {
        cb.click();
        return;
      }
    }
  });
  await sleep(1000);
  
  // Check current state
  const state1 = await bf.evaluate(() => {
    const cbs = [...document.querySelectorAll('input[type="checkbox"]')].filter(cb => cb.checked);
    return cbs.map(cb => (cb.closest('label') || cb.parentElement)?.textContent?.trim());
  });
  console.log('Checked attributes:', state1);
  
  // Step 3: Click on Dog Size tab and select size options
  console.log('\n=== Step 3: Select Dog Size options ===');
  // Click Dog Size to show its options
  await bf.evaluate(() => {
    const spans = document.querySelectorAll('span, div, a, button');
    for (const el of spans) {
      if (el.textContent.trim() === 'Dog Size' && el.offsetParent !== null) {
        el.click();
        break;
      }
    }
  });
  await sleep(500);
  
  // Now the options panel shows. The options are likely buttons/chips, not checkboxes
  // Let me analyze the DOM structure of the options
  const optionsInfo = await bf.evaluate(() => {
    // Look for the options section 
    const optionsEl = document.querySelector('[class*="option"], [class*="chip"]');
    
    // Find all elements that look like size option chips
    const allEls = document.querySelectorAll('*');
    const sizeOptions = [];
    for (const el of allEls) {
      const t = el.textContent?.trim();
      if (['XXS','XS','S','M','L','XL','XXL'].includes(t) && el.children.length === 0) {
        sizeOptions.push({
          tag: el.tagName,
          text: t,
          classes: el.className?.substring(0, 80),
          role: el.getAttribute('role'),
          parentTag: el.parentElement?.tagName,
          parentClasses: el.parentElement?.className?.substring(0, 80),
          clickable: el.parentElement?.tagName === 'BUTTON' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'option'
        });
      }
    }
    return sizeOptions;
  });
  console.log('Size options:', JSON.stringify(optionsInfo, null, 2).substring(0, 2000));
  
  // Click on each desired size
  const desiredSizes = ['XS', 'S', 'M', 'L', 'XL'];
  for (const size of desiredSizes) {
    const clicked = await bf.evaluate((sz) => {
      const allEls = document.querySelectorAll('*');
      for (const el of allEls) {
        if (el.textContent?.trim() === sz && el.children.length === 0) {
          // Click the element or its parent button
          const target = el.closest('button') || el.closest('[role="option"]') || el.parentElement;
          if (target) {
            target.click();
            return 'clicked ' + sz + ' via ' + target.tagName;
          }
          el.click();
          return 'clicked ' + sz + ' directly';
        }
      }
      return 'not found: ' + sz;
    }, size);
    console.log(clicked);
    await sleep(300);
  }
  
  await sleep(500);
  await ebay.screenshot({ path: 'var-sizes-selected.png' });
  
  // Step 4: Switch to Colour tab and select colours
  console.log('\n=== Step 4: Select Colour options ===');
  await bf.evaluate(() => {
    const spans = document.querySelectorAll('span, div, a, button');
    for (const el of spans) {
      if (el.textContent.trim() === 'Colour' && el.offsetParent !== null) {
        el.click();
        break;
      }
    }
  });
  await sleep(1000);
  
  // Check what colour options are available
  const colourOptions = await bf.evaluate(() => {
    const text = document.body.innerText;
    // Get the Options section text
    const optIdx = text.indexOf('Options');
    return text.substring(optIdx, optIdx + 500);
  });
  console.log('Colour section:', colourOptions.substring(0, 300));
  
  // The colours might need to be created as custom since they won't be in predefined list
  // Let's check for Red, Black, Coffee in the predefined options
  const colourInfo = await bf.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    const found = [];
    for (const el of allEls) {
      const t = el.textContent?.trim();
      if (['Red', 'Black', 'Coffee', 'Blue', 'Brown', 'White', 'Grey'].includes(t) && el.children.length === 0) {
        found.push({ text: t, tag: el.tagName, parent: el.parentElement?.tagName });
      }
    }
    return found;
  });
  console.log('Colour options found:', JSON.stringify(colourInfo));
  
  // Select Red, Black, Coffee
  const desiredColours = ['Red', 'Black'];
  for (const colour of desiredColours) {
    const clicked = await bf.evaluate((c) => {
      const allEls = document.querySelectorAll('*');
      for (const el of allEls) {
        if (el.textContent?.trim() === c && el.children.length === 0) {
          const target = el.closest('button') || el.closest('[role="option"]') || el.parentElement;
          if (target) { target.click(); return 'clicked ' + c; }
          el.click();
          return 'clicked ' + c + ' directly';
        }
      }
      return 'not found: ' + c;
    }, colour);
    console.log(clicked);
    await sleep(300);
  }
  
  // For Coffee - might need "Create your own"
  console.log('\n=== Creating custom "Coffee" colour ===');
  const createOwn = await bf.evaluate(() => {
    const btns = document.querySelectorAll('button, a, span');
    for (const b of btns) {
      if (b.textContent.trim().includes('Create your own')) {
        b.click();
        return 'clicked Create your own';
      }
    }
    return 'not found';
  });
  console.log(createOwn);
  await sleep(500);
  
  // Type "Coffee" in the input
  const typedCoffee = await bf.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"]');
    for (const input of inputs) {
      if (input.offsetParent !== null && !input.value) {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, 'Coffee');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        // Press Enter
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
        return 'typed Coffee and pressed Enter';
      }
    }
    return 'no input found';
  });
  console.log(typedCoffee);
  await sleep(500);
  
  // Also try clicking Save/Add button after typing
  await bf.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      const t = b.textContent.trim();
      if (t === 'Save' || t === 'Add') {
        b.click();
        return;
      }
    }
  });
  await sleep(500);
  
  await ebay.screenshot({ path: 'var-colours-selected.png' });
  
  // Step 5: Get final state before Continue
  const finalState = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('\nFinal builder state:', finalState.substring(0, 1000));
  
  // Step 6: Click Continue to generate the grid
  console.log('\n=== Step 6: Click Continue ===');
  const continueClicked = await bf.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Continue' && b.offsetParent !== null) {
        b.click();
        return 'clicked Continue';
      }
    }
    return 'Continue not found';
  });
  console.log(continueClicked);
  
  await sleep(3000);
  await ebay.screenshot({ path: 'var-after-continue.png' });
  
  // Check what we see now
  const afterContinue = await bf.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('\nAfter Continue:', afterContinue.substring(0, 1000));
  
  browser.disconnect();
  console.log('\nDone');
})().catch(e => { console.error(e.message); process.exit(1); });
