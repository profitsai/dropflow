const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  const bf = ebay.frames().find(f => f.url().includes('bulkedit'));
  if (!bf) { console.error('No bulkedit frame'); process.exit(1); }
  
  // Click Edit to go back to attribute selection
  console.log('=== Clicking Edit to go back ===');
  await bf.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a')];
    const editBtn = btns.find(b => b.textContent.trim() === 'Edit');
    if (editBtn) editBtn.click();
  });
  await sleep(2000);
  
  // Check state
  let text = await bf.evaluate(() => document.body.innerText.substring(0, 1500));
  console.log('After Edit:', text.substring(0, 500));
  
  // Now I need to carefully:
  // 1. Uncheck Features
  // 2. Make sure Dog Size is checked  
  // 3. Check Colour
  // 4. Remove "Coffee" from Dog Size options
  
  console.log('\n=== Step 1: Configure attributes ===');
  
  // Get current checkbox states
  const cbStates = await bf.evaluate(() => {
    const cbs = [...document.querySelectorAll('input[type="checkbox"]')];
    return cbs.map(cb => {
      const label = cb.closest('label') || cb.parentElement;
      return { text: label?.textContent?.trim(), checked: cb.checked };
    });
  });
  console.log('Checkboxes:', JSON.stringify(cbStates));
  
  // Uncheck Features if checked
  await bf.evaluate(() => {
    const cbs = [...document.querySelectorAll('input[type="checkbox"]')];
    for (const cb of cbs) {
      const label = (cb.closest('label') || cb.parentElement)?.textContent?.trim();
      if (label === 'Features' && cb.checked) {
        cb.click();
        console.log('Unchecked Features');
      }
    }
  });
  await sleep(500);
  
  // Check Colour if not checked
  await bf.evaluate(() => {
    const cbs = [...document.querySelectorAll('input[type="checkbox"]')];
    for (const cb of cbs) {
      const label = (cb.closest('label') || cb.parentElement)?.textContent?.trim();
      if (label === 'Colour' && !cb.checked) {
        cb.click();
        console.log('Checked Colour');
      }
    }
  });
  await sleep(500);
  
  // Make sure Dog Size is checked
  await bf.evaluate(() => {
    const cbs = [...document.querySelectorAll('input[type="checkbox"]')];
    for (const cb of cbs) {
      const label = (cb.closest('label') || cb.parentElement)?.textContent?.trim();
      if (label === 'Dog Size' && !cb.checked) {
        cb.click();
        console.log('Checked Dog Size');
      }
    }
  });
  await sleep(500);
  
  // Verify
  const cbStates2 = await bf.evaluate(() => {
    const cbs = [...document.querySelectorAll('input[type="checkbox"]')];
    return cbs.filter(cb => cb.checked).map(cb => (cb.closest('label') || cb.parentElement)?.textContent?.trim());
  });
  console.log('Checked attributes:', cbStates2);
  
  // Step 2: Now click Colour tab to see its options
  console.log('\n=== Step 2: Click Colour tab ===');
  // The attributes should show as tabs: "Dog Size" and "Colour" with "+ Add"
  // I need to find the "Colour" tab in the "Attributes and options you've selected" area
  
  // First let's see what the selected attributes area looks like
  text = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('Current state:', text.substring(0, 800));
  await ebay.screenshot({ path: 'var-redo-state.png' });
  
  // Click on Colour tab - it should be in the "Attributes" row
  // The tabs text showed "FeaturesDog Size+ Add" before. Now should be "Dog SizeColour+ Add"
  await bf.evaluate(() => {
    // Find Colour in the selected attributes area
    const allEls = [...document.querySelectorAll('*')];
    for (const el of allEls) {
      if (el.textContent?.trim() === 'Colour' && el.children.length === 0 && el.offsetParent !== null) {
        // Check if it's in the attributes tab area (not in the checkbox list)
        const parent = el.parentElement;
        if (parent && !parent.querySelector('input[type="checkbox"]')) {
          el.click();
          return 'clicked Colour tab';
        }
      }
    }
    // Just click any Colour text
    for (const el of allEls) {
      if (el.textContent?.trim() === 'Colour' && el.children.length === 0) {
        el.click();
        return 'clicked Colour (any)';
      }
    }
  });
  await sleep(1000);
  
  // Check what options are shown for Colour
  text = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('\nAfter Colour click:', text.substring(0, 800));
  
  // Find the "- Colour" section which means it's active
  const isColourActive = text.includes('- Colour');
  const isDogSizeActive = text.includes('- Dog Size');
  console.log('Colour active:', isColourActive, 'Dog Size active:', isDogSizeActive);
  
  if (isColourActive) {
    // Select Red, Black
    console.log('\n=== Selecting colours ===');
    for (const colour of ['Red', 'Black']) {
      await bf.evaluate((c) => {
        const lis = document.querySelectorAll('li[role="button"]');
        for (const li of lis) {
          if (li.textContent.trim() === c) {
            li.click();
            return;
          }
        }
      }, colour);
      console.log('Selected:', colour);
      await sleep(300);
    }
    
    // Create custom "Coffee"
    console.log('Creating Coffee...');
    await bf.evaluate(() => {
      const links = document.querySelectorAll('button, a, span');
      for (const l of links) {
        if (l.textContent.trim().includes('Create your own') && l.textContent.includes('Colour')) {
          l.click();
          return;
        }
      }
      // Fallback
      for (const l of links) {
        if (l.textContent.trim().includes('Create your own')) {
          l.click();
          return;
        }
      }
    });
    await sleep(500);
    
    // Type Coffee
    await bf.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="text"]');
      for (const input of inputs) {
        if (input.offsetParent !== null) {
          input.focus();
          const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          ns.call(input, 'Coffee');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          return;
        }
      }
    });
    await sleep(500);
    
    // Click Add/Save
    await bf.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === 'Add' && b.offsetParent !== null) {
          b.click();
          return;
        }
      }
    });
    await sleep(500);
  }
  
  // Now switch to Dog Size tab
  console.log('\n=== Switching to Dog Size ===');
  await bf.evaluate(() => {
    const allEls = [...document.querySelectorAll('*')];
    for (const el of allEls) {
      if (el.textContent?.trim() === 'Dog Size' && el.children.length === 0 && el.offsetParent !== null) {
        const parent = el.parentElement;
        if (parent && !parent.querySelector('input[type="checkbox"]')) {
          el.click();
          return;
        }
      }
    }
  });
  await sleep(1000);
  
  text = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
  const isDogSizeNow = text.includes('- Dog Size');
  console.log('Dog Size active:', isDogSizeNow);
  
  if (isDogSizeNow) {
    // First remove Coffee if it's there from the previous mistake
    const hasCoffee = text.includes('Coffee');
    if (hasCoffee) {
      console.log('Removing Coffee from Dog Size...');
      // Coffee would be a selected option - click it to deselect
      await bf.evaluate(() => {
        const lis = document.querySelectorAll('li[role="button"]');
        for (const li of lis) {
          if (li.textContent.trim() === 'Coffee') {
            li.click();
            return;
          }
        }
      });
      await sleep(300);
    }
    
    // Select the sizes we want
    console.log('Selecting sizes...');
    for (const size of ['XS', 'S', 'M', 'L', 'XL']) {
      await bf.evaluate((sz) => {
        const lis = document.querySelectorAll('li[role="button"]');
        for (const li of lis) {
          if (li.textContent.trim() === sz) {
            li.click();
            return;
          }
        }
      }, size);
      console.log('Selected:', size);
      await sleep(200);
    }
  }
  
  await sleep(500);
  
  // Final state check
  text = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('\nFinal state:', text.substring(0, 1000));
  await ebay.screenshot({ path: 'var-redo-final.png' });
  
  // Click Continue
  console.log('\n=== Clicking Continue ===');
  await bf.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Continue' && b.offsetParent !== null) {
        b.click();
        return;
      }
    }
  });
  await sleep(3000);
  
  text = await bf.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('\nAfter Continue:', text.substring(0, 1500));
  await ebay.screenshot({ path: 'var-redo-after-continue.png' });
  
  browser.disconnect();
  console.log('\nDone');
})().catch(e => { console.error(e.message); process.exit(1); });
