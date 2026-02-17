const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  const bf = ebay.frames().find(f => f.url().includes('bulkedit'));
  if (!bf) { console.error('No bulkedit frame'); process.exit(1); }
  
  // Step 1: Remove Features attribute by clicking its X button
  console.log('=== Step 1: Remove Features ===');
  const removed = await bf.evaluate(() => {
    // Find the "Features" tab/chip that has an X/close button
    // Looking at the screenshot, there are attribute chips with "x" buttons
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const t = el.textContent?.trim();
      // The chip text is "Features x" or similar
      if (t === 'Features' && el.children.length === 0 && el.tagName !== 'INPUT') {
        // Find sibling/nearby X button
        const parent = el.parentElement;
        if (parent) {
          const closeBtn = parent.querySelector('button, [class*="close"], [class*="remove"], [aria-label*="close"], [aria-label*="remove"]');
          if (closeBtn) {
            closeBtn.click();
            return 'clicked close button in parent';
          }
          // Try clicking the X text next to it
          const siblings = parent.querySelectorAll('*');
          for (const s of siblings) {
            if (s.textContent.trim() === 'x' || s.textContent.trim() === '×' || s.textContent.trim() === 'X') {
              s.click();
              return 'clicked X sibling';
            }
          }
          // The "x" might be part of the same element text: "Features x"
          // Try clicking the parent which might be the whole chip
        }
      }
      // Also try "Features x" as full text
      if (t === 'Features x' || t === 'Features  x') {
        const btns = el.querySelectorAll('button, span, svg, [role="button"]');
        for (const b of btns) {
          if (b.textContent.trim() === 'x' || b.textContent.trim() === '×') {
            b.click();
            return 'clicked x in Features chip';
          }
        }
      }
    }
    return 'not found';
  });
  console.log('Remove Features:', removed);
  await sleep(1000);
  
  // Try harder - find by aria-label or SVG close icon
  if (removed === 'not found') {
    const removed2 = await bf.evaluate(() => {
      // Get the attributes area - look for the chip container
      const chips = document.querySelectorAll('[class*="chip"], [class*="tag"], [class*="pill"], [class*="badge"]');
      for (const chip of chips) {
        if (chip.textContent.includes('Features')) {
          // Find close/remove button within
          const btn = chip.querySelector('button, [role="button"], svg');
          if (btn) { btn.click(); return 'clicked via chip class'; }
          // Try all children
          for (const child of chip.querySelectorAll('*')) {
            if (child.tagName === 'BUTTON' || child.tagName === 'SVG' || child.getAttribute('role') === 'button') {
              child.click();
              return 'clicked child: ' + child.tagName;
            }
          }
        }
      }
      
      // Nuclear option: find any element with role=button near "Features" text
      const tree = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => node.textContent.trim() === 'Features' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      });
      let textNode;
      while ((textNode = tree.nextNode())) {
        const parent = textNode.parentElement;
        if (parent) {
          // Walk up to find clickable X
          let container = parent;
          for (let i = 0; i < 3; i++) {
            if (!container) break;
            const btns = container.querySelectorAll('button:not([disabled])');
            for (const b of btns) {
              if (b.textContent.trim().length <= 2) { // X, ×, etc
                return 'found button near Features: ' + b.textContent.trim() + ' ' + b.tagName;
              }
            }
            container = container.parentElement;
          }
        }
      }
      return 'still not found';
    });
    console.log('Remove Features attempt 2:', removed2);
    
    // If found, click it
    if (removed2.includes('found button')) {
      await bf.evaluate(() => {
        const tree = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => node.textContent.trim() === 'Features' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        });
        let textNode;
        while ((textNode = tree.nextNode())) {
          const parent = textNode.parentElement;
          if (parent) {
            let container = parent;
            for (let i = 0; i < 3; i++) {
              if (!container) break;
              const btns = container.querySelectorAll('button:not([disabled])');
              for (const b of btns) {
                if (b.textContent.trim().length <= 2) {
                  b.click();
                  return;
                }
              }
              container = container.parentElement;
            }
          }
        }
      });
      await sleep(1000);
    }
  }
  
  // Step 2: Click "+ Add" to add Colour
  console.log('\n=== Step 2: Add Colour attribute ===');
  // First check if Features was removed
  let text = await bf.evaluate(() => document.body.innerText.substring(0, 1500));
  console.log('Attributes area:', text.substring(0, 300));
  
  // Click "+ Add"
  await bf.evaluate(() => {
    const btns = document.querySelectorAll('button, a, span');
    for (const b of btns) {
      if (b.textContent.trim() === '+ Add' && b.offsetParent !== null) {
        b.click();
        return;
      }
    }
  });
  await sleep(1000);
  
  // Should show a dropdown/menu with available attributes
  text = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('After +Add:', text.substring(0, 500));
  await ebay.screenshot({ path: 'var-add-attr.png' });
  
  // Look for Colour option in the dropdown and click it
  const addedColour = await bf.evaluate(() => {
    // Check for dropdown/popover/menu
    const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"], li');
    for (const item of menuItems) {
      if (item.textContent.trim() === 'Colour') {
        item.click();
        return 'clicked Colour in menu';
      }
    }
    // Try checkbox approach
    const cbs = document.querySelectorAll('input[type="checkbox"]');
    for (const cb of cbs) {
      const label = (cb.closest('label') || cb.parentElement)?.textContent?.trim();
      if (label === 'Colour' && !cb.checked) {
        cb.click();
        return 'checked Colour checkbox';
      }
    }
    return 'Colour not found in dropdown';
  });
  console.log('Added Colour:', addedColour);
  await sleep(1000);
  
  // Click on Colour tab to switch to it
  console.log('\n=== Step 3: Switch to Colour tab ===');
  await bf.evaluate(() => {
    // Find Colour as a tab in the attributes area (not in options)
    const allEls = [...document.querySelectorAll('span, div, button, a')];
    for (const el of allEls) {
      if (el.textContent.trim() === 'Colour' && el.children.length <= 2 && el.offsetParent !== null) {
        // Make sure it's in the attributes section, not the checkbox list
        const rect = el.getBoundingClientRect();
        if (rect.y < 400) { // Attribute tabs are in the top portion
          el.click();
          return;
        }
      }
    }
  });
  await sleep(1000);
  
  text = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('After Colour tab:', text.substring(0, 800));
  const isColourActive = text.includes('- Colour');
  console.log('Colour active:', isColourActive);
  
  if (isColourActive) {
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
    
    // Create Coffee
    await bf.evaluate(() => {
      const links = [...document.querySelectorAll('button, a, span')];
      const createOwn = links.find(l => l.textContent.trim().includes('Create your own'));
      if (createOwn) createOwn.click();
    });
    await sleep(500);
    
    // Type Coffee in the visible input
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
    
    // Click Add button
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
  
  await ebay.screenshot({ path: 'var-colours-done.png' });
  
  // Step 4: Click "Update variations" or "Continue"
  console.log('\n=== Step 4: Update/Continue ===');
  text = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('Before update:', text.substring(0, 800));
  
  await bf.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      const t = b.textContent.trim();
      if ((t === 'Update variations' || t === 'Continue') && b.offsetParent !== null) {
        b.click();
        return;
      }
    }
  });
  await sleep(3000);
  
  text = await bf.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('\nAfter Update:', text.substring(0, 1500));
  await ebay.screenshot({ path: 'var-after-update.png' });
  
  browser.disconnect();
  console.log('\nDone');
})().catch(e => { console.error(e.message); process.exit(1); });
