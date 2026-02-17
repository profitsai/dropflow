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
  if (!bulkFrame) {
    console.log('No bulkedit frame!');
    browser.disconnect();
    return;
  }
  
  console.log('=== Setting up variations ===');
  
  // Step 1: Remove "Features" attribute (click X)
  console.log('\n1. Removing Features attribute...');
  await bulkFrame.evaluate(() => {
    // Find the X button on Features tag
    const tags = document.querySelectorAll('[class*="tag"], [class*="chip"]');
    for (const tag of tags) {
      if (tag.textContent.includes('Features')) {
        const xBtn = tag.querySelector('button, [class*="close"], [class*="remove"]');
        if (xBtn) { xBtn.click(); return 'removed'; }
        // Try the x text
        const spans = tag.querySelectorAll('span');
        for (const s of spans) {
          if (s.textContent.trim() === 'x' || s.textContent.trim() === '×') {
            s.click(); return 'clicked x span';
          }
        }
      }
    }
    return 'not found';
  });
  await sleep(1000);
  
  // Step 2: Click "Dog Size" attribute to select it
  console.log('2. Selecting Dog Size attribute...');
  await bulkFrame.evaluate(() => {
    const tags = document.querySelectorAll('[class*="tag"], [class*="chip"], button');
    for (const tag of tags) {
      if (tag.textContent.trim().includes('Dog Size')) {
        tag.click();
        return true;
      }
    }
    return false;
  });
  await sleep(1000);
  
  // Select size options: XS, S, M, L, XL
  console.log('3. Selecting size options...');
  const sizes = ['XS', 'S', 'M', 'L', 'XL'];
  for (const size of sizes) {
    await bulkFrame.evaluate((sizeName) => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === sizeName) {
          b.click();
          return true;
        }
      }
      return false;
    }, size);
    console.log(`  Selected size: ${size}`);
    await sleep(300);
  }
  await sleep(500);
  
  // Take screenshot to see current state
  await page.screenshot({ path: 'var-sizes-selected.png' });
  fs.copyFileSync('var-sizes-selected.png', '/Users/pyrite/.openclaw/workspace/var-sizes-selected.png');
  
  // Step 3: Add Colour attribute via "+ Add"
  console.log('\n4. Adding Colour attribute...');
  
  // First check what attributes are available in the "+Add" dropdown
  const addClicked = await bulkFrame.evaluate(() => {
    const links = document.querySelectorAll('a, button, [role="button"]');
    for (const l of links) {
      if (l.textContent.trim().includes('+ Add') || l.textContent.trim().includes('Add')) {
        l.click();
        return true;
      }
    }
    return false;
  });
  console.log('Clicked + Add:', addClicked);
  await sleep(1000);
  
  // Check what appeared
  const addState = await bulkFrame.evaluate(() => {
    return {
      text: document.body.innerText.substring(0, 2000),
      checkboxes: Array.from(document.querySelectorAll('input[type="checkbox"]')).map(cb => ({
        id: cb.id,
        checked: cb.checked,
        label: cb.closest('label')?.textContent?.trim() || 
               document.querySelector(`label[for="${cb.id}"]`)?.textContent?.trim() || ''
      })),
      allButtons: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim().substring(0, 40)).filter(t => t)
    };
  });
  console.log('Available checkboxes:', addState.checkboxes);
  console.log('Buttons:', addState.allButtons);
  
  // Look for Colour in the checkboxes or dropdown
  const colourAdded = await bulkFrame.evaluate(() => {
    // Check for Colour checkbox
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    for (const cb of checkboxes) {
      const label = cb.closest('label')?.textContent || 
                    document.querySelector(`label[for="${cb.id}"]`)?.textContent || '';
      if (label.includes('Colour') || label.includes('Color')) {
        cb.checked = true;
        cb.click();
        return 'checked colour';
      }
    }
    
    // Try clicking a button named Colour
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim().includes('Colour') || b.textContent.trim().includes('Color')) {
        b.click();
        return 'clicked colour button';
      }
    }
    
    return 'colour not found';
  });
  console.log('Colour add result:', colourAdded);
  await sleep(1000);
  
  await page.screenshot({ path: 'var-colour-added.png' });
  fs.copyFileSync('var-colour-added.png', '/Users/pyrite/.openclaw/workspace/var-colour-added.png');
  
  // Now check what's displayed - might need to select Colour attribute and add options
  const currentState = await bulkFrame.evaluate(() => {
    return {
      text: document.body.innerText.substring(0, 3000),
      buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t).slice(0, 30)
    };
  });
  console.log('\nCurrent buttons:', currentState.buttons);
  
  // Click on the Colour attribute to show its options
  await bulkFrame.evaluate(() => {
    const tags = document.querySelectorAll('[class*="tag"], [class*="chip"], button, span');
    for (const tag of tags) {
      const t = tag.textContent.trim();
      if (t === 'Colour' || t === 'Colour x' || t === 'Color') {
        tag.click();
        return true;
      }
    }
    return false;
  });
  await sleep(1000);
  
  // Select color options: Red, Black, Coffee (may need to create custom)
  console.log('\n5. Selecting colour options...');
  
  // First check available colors
  const availColors = await bulkFrame.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t && t.length < 30);
  });
  console.log('Available buttons:', availColors);
  
  // Click Red, Black
  for (const color of ['Red', 'Black']) {
    const clicked = await bulkFrame.evaluate((colorName) => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === colorName) {
          b.click();
          return true;
        }
      }
      return false;
    }, color);
    if (clicked) console.log(`  Selected: ${color}`);
    else console.log(`  Not found: ${color}`);
    await sleep(300);
  }
  
  // Create "Coffee" as custom option
  console.log('  Creating custom option: Coffee');
  // Click "+ Create your own"
  await bulkFrame.evaluate(() => {
    const links = document.querySelectorAll('a, button');
    for (const l of links) {
      if (l.textContent.includes('Create your own') || l.textContent.includes('create your own')) {
        l.click();
        return true;
      }
    }
    return false;
  });
  await sleep(500);
  
  // Type "Coffee" in the custom option input
  const customInput = await bulkFrame.$('#msku-custom-option-input');
  if (customInput) {
    await customInput.click();
    await customInput.type('Coffee');
    // Press Enter or click Add
    await bulkFrame.keyboard.press('Enter');
    console.log('  Added custom: Coffee');
  }
  await sleep(500);
  
  await page.screenshot({ path: 'var-colors-selected.png' });
  fs.copyFileSync('var-colors-selected.png', '/Users/pyrite/.openclaw/workspace/var-colors-selected.png');
  
  // Check right panel to see selected attributes
  const rightPanel = await bulkFrame.evaluate(() => {
    const panel = document.querySelector('[class*="selected"], [class*="right"]');
    return panel ? panel.textContent.trim().substring(0, 500) : document.body.innerText.substring(0, 2000);
  });
  console.log('\nRight panel / full text:', rightPanel.substring(0, 500));
  
  // Click Continue
  console.log('\n6. Clicking Continue...');
  const continueClicked = await bulkFrame.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Continue' && !b.disabled) {
        b.click();
        return true;
      }
    }
    return false;
  });
  console.log('Continue clicked:', continueClicked);
  await sleep(5000);
  
  // Check what happened next - should be a pricing/quantity page
  await page.screenshot({ path: 'var-after-continue.png' });
  fs.copyFileSync('var-after-continue.png', '/Users/pyrite/.openclaw/workspace/var-after-continue.png');
  
  const nextState = await bulkFrame.evaluate(() => {
    return {
      text: document.body.innerText.substring(0, 2000),
      inputs: Array.from(document.querySelectorAll('input[type="text"], input[type="number"]')).map(i => ({
        id: (i.id || '').substring(0, 40), placeholder: i.placeholder, value: i.value?.substring(0, 30),
        ariaLabel: i.getAttribute('aria-label')
      })).slice(0, 20),
      buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t).slice(0, 15)
    };
  }).catch(e => ({ error: e.message }));
  
  console.log('\nNext page text:', nextState.text?.substring(0, 500));
  console.log('Inputs:', JSON.stringify(nextState.inputs, null, 2));
  console.log('Buttons:', nextState.buttons);
  
  browser.disconnect();
})().catch(e => console.error(e));
