const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const lstng = pages.find(p => p.url().includes('/lstng'));
  
  if (!lstng) { log('No lstng page'); process.exit(1); }
  
  const frames = lstng.frames();
  const bf = frames.find(f => f.url().includes('bulkedit'));
  
  if (!bf) { log('No bulkedit frame'); process.exit(1); }
  
  log('Found builder iframe');
  
  // Step 1: Remove "Features" attribute (click the X on it)
  // Then add "Color" attribute 
  // The builder has "Features" and "Dog Size" pre-selected
  
  // First remove Features
  log('Removing Features attribute...');
  await bf.evaluate(() => {
    // Find the "Features x" button/chip and click the X
    const chips = document.querySelectorAll('[class*="chip"], [class*="tag"], button');
    for (const chip of chips) {
      if (chip.textContent?.includes('Features')) {
        // Find the X/close button within
        const closeBtn = chip.querySelector('[class*="close"], [class*="remove"], [aria-label*="remove"]');
        if (closeBtn) { closeBtn.click(); return 'removed via close btn'; }
        // Or the chip might be a button itself
        const allBtns = chip.querySelectorAll('button, [role="button"]');
        for (const btn of allBtns) {
          if (btn.textContent?.includes('x') || btn.textContent?.includes('×') || btn.getAttribute('aria-label')?.includes('remove')) {
            btn.click();
            return 'removed via inner btn';
          }
        }
        // Try clicking the chip itself
        chip.click();
        return 'clicked chip';
      }
    }
    return 'Features chip not found';
  }).then(r => log('  ' + r));
  await sleep(1000);
  
  // Take screenshot
  await lstng.screenshot({ path: 'price-test-builder-1.png' });
  
  // Step 2: Click "+ Add" to add Color attribute
  log('Adding Color attribute...');
  await bf.evaluate(() => {
    const addBtn = Array.from(document.querySelectorAll('button, a, [role="button"]')).find(b => 
      b.textContent?.trim() === '+ Add' || b.textContent?.trim() === 'Add'
    );
    if (addBtn) { addBtn.click(); return 'clicked + Add'; }
    return 'Add button not found';
  }).then(r => log('  ' + r));
  await sleep(1000);
  
  // Screenshot to see what appeared
  await lstng.screenshot({ path: 'price-test-builder-2.png' });
  
  // Check what options appeared after clicking +Add
  const addState = await bf.evaluate(() => {
    return document.body.innerText.substring(0, 1000);
  });
  log('After +Add: ' + addState.substring(0, 200));
  
  // Look for a dropdown or input to type "Color"
  const inputState = await bf.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
    return inputs.map(i => ({
      value: i.value,
      placeholder: i.placeholder,
      visible: i.offsetHeight > 0,
      id: i.id,
      class: i.className?.substring(0, 40)
    }));
  });
  log('Inputs: ' + JSON.stringify(inputState));
  
  // Find a visible text input and type "Color"
  const visibleInputs = inputState.filter(i => i.visible);
  if (visibleInputs.length > 0) {
    log('Typing "Color" into visible input...');
    // Find the actual input element and type
    const typed = await bf.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
      const visible = inputs.filter(i => i.offsetHeight > 0 && !i.value);
      if (visible.length > 0) {
        visible[0].focus();
        visible[0].value = 'Color';
        visible[0].dispatchEvent(new Event('input', { bubbles: true }));
        visible[0].dispatchEvent(new Event('change', { bubbles: true }));
        return 'typed Color';
      }
      return 'no empty visible input';
    });
    log('  ' + typed);
    await sleep(1000);
    
    // Check for dropdown/suggestions
    const suggestions = await bf.evaluate(() => {
      const lists = document.querySelectorAll('[class*="dropdown"], [class*="suggestion"], [class*="menu"], ul, [role="listbox"]');
      const items = [];
      for (const list of lists) {
        if (list.offsetHeight > 0) {
          const lis = list.querySelectorAll('li, [role="option"], [class*="item"]');
          for (const li of lis) {
            items.push(li.textContent?.trim()?.substring(0, 40));
          }
        }
      }
      return items;
    });
    log('Suggestions: ' + JSON.stringify(suggestions));
  }
  
  await lstng.screenshot({ path: 'price-test-builder-3.png' });
  
  browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
