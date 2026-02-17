const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  const bf = ebay.frames().find(f => f.url().includes('bulkedit'));
  if (!bf) { console.error('No bulkedit frame'); process.exit(1); }
  
  // The dropdown "Add variation attribute" is open with Colour checked
  // I need to click Save in the dropdown first
  console.log('=== Step 1: Save attribute dropdown ===');
  
  // First dismiss the "Add rows automatically" dialog
  await bf.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Cancel' && b.offsetParent !== null) {
        const dialog = b.closest('[role="dialog"], [class*="modal"], [class*="overlay"]');
        if (dialog || b.closest('[class*="popup"]')) {
          b.click();
          return;
        }
      }
    }
    // Just click the last Cancel
    const cancels = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Cancel');
    if (cancels.length > 0) cancels[cancels.length - 1].click();
  });
  await sleep(500);
  
  // Now find and click Save in the attribute dropdown 
  console.log('=== Step 2: Click Save in attribute dropdown ===');
  const saveClicked = await bf.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    // Find Save button (not "Save and close")
    for (const b of btns) {
      const t = b.textContent.trim();
      if (t === 'Save' && b.offsetParent !== null) {
        b.click();
        return 'clicked Save';
      }
    }
    return 'Save not found';
  });
  console.log(saveClicked);
  await sleep(1000);
  
  let text = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('State:', text.substring(0, 600));
  await ebay.screenshot({ path: 'var-v3-state1.png' });
  
  // Check if Colour tab now appears
  const hasColourTab = text.includes('Colour') && text.includes('Dog Size');
  console.log('Has Colour tab:', hasColourTab);
  
  // If there's a prompt about adding rows, click "Add rows automatically"
  if (text.includes('Add rows automatically')) {
    console.log('Clicking "Add rows automatically"...');
    await bf.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim().includes('Add rows automatically')) {
          b.click();
          return;
        }
      }
    });
    await sleep(2000);
    text = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
    console.log('After auto-add:', text.substring(0, 600));
  }
  
  // Now click on Colour tab
  console.log('\n=== Step 3: Click Colour tab ===');
  await bf.evaluate(() => {
    // The attribute tabs are in the left panel
    const allEls = [...document.querySelectorAll('*')];
    for (const el of allEls) {
      const t = el.textContent?.trim();
      if (t === 'Colour' && el.children.length <= 2) {
        // Make sure it's a tab (not in checkbox list)
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.width < 200) {
          el.click();
          return 'clicked ' + el.tagName + ' at ' + Math.round(rect.x) + ',' + Math.round(rect.y);
        }
      }
    }
  });
  await sleep(1000);
  
  text = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('After Colour tab click:', text.substring(0, 800));
  await ebay.screenshot({ path: 'var-v3-colour-tab.png' });
  
  // Check if Colour options are showing
  if (text.includes('- Colour')) {
    console.log('\nColour tab is active! Selecting options...');
    
    // Select Red, Black from predefined
    for (const colour of ['Red', 'Black']) {
      await bf.evaluate((c) => {
        const lis = document.querySelectorAll('li[role="button"]');
        for (const li of lis) {
          if (li.textContent.trim() === c) { li.click(); return; }
        }
      }, colour);
      console.log('Selected:', colour);
      await sleep(300);
    }
    
    // Create Coffee custom
    await bf.evaluate(() => {
      const links = [...document.querySelectorAll('button, a, span')];
      const createOwn = links.find(l => l.textContent.trim().includes('Create your own'));
      if (createOwn) createOwn.click();
    });
    await sleep(500);
    
    await bf.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="text"]');
      for (const input of inputs) {
        if (input.offsetParent !== null && input.value === '') {
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
    
    // Click Add
    await bf.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === 'Add' && b.offsetParent !== null) {
          b.click(); return;
        }
      }
    });
    await sleep(500);
  }
  
  // Click "Update variations"
  console.log('\n=== Step 4: Update variations ===');
  text = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('Before update:', text.substring(0, 600));
  
  await bf.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Update variations' && b.offsetParent !== null) {
        b.click();
        return;
      }
    }
  });
  await sleep(2000);
  
  // If there's a prompt, click "Add rows automatically"
  text = await bf.evaluate(() => document.body.innerText.substring(0, 3000));
  if (text.includes('Add rows automatically')) {
    await bf.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim().includes('Add rows automatically')) {
          b.click(); return;
        }
      }
    });
    await sleep(3000);
    text = await bf.evaluate(() => document.body.innerText.substring(0, 3000));
  }
  
  console.log('\nFinal state:', text.substring(0, 2000));
  await ebay.screenshot({ path: 'var-v3-final.png' });
  
  browser.disconnect();
  console.log('\nDone');
})().catch(e => { console.error(e.message); process.exit(1); });
