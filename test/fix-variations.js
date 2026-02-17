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
    console.log('No bulkedit frame');
    browser.disconnect();
    return;
  }
  
  // Click "Edit" to go back to attribute selection
  console.log('Clicking Edit to go back...');
  await bulkFrame.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Edit') { b.click(); return; }
    }
  });
  await sleep(2000);
  
  // Now I should be back on the attribute selection page
  // Check state
  const state = await bulkFrame.evaluate(() => {
    const attrs = [];
    const tags = document.querySelectorAll('[class*="tag"], [class*="chip"]');
    tags.forEach(t => attrs.push(t.textContent.trim()));
    
    const options = [];
    const optBtns = document.querySelectorAll('button');
    optBtns.forEach(b => {
      const t = b.textContent.trim();
      if (t && t.length < 30 && !['Continue', 'Cancel', 'Save', '+ Add', 'Edit'].includes(t)) {
        options.push(t);
      }
    });
    
    return { attrs, options };
  });
  console.log('Attributes:', state.attrs);
  console.log('Options visible:', state.options);
  
  await page.screenshot({ path: 'var-edit-back.png' });
  fs.copyFileSync('var-edit-back.png', '/Users/pyrite/.openclaw/workspace/var-edit-back.png');
  
  // I see the issue - the builder has Dog Size with "Coffee" as an option
  // I need to:
  // 1. Remove Coffee from Dog Size
  // 2. Add proper sizes (XS, S, M, L, XL) to Dog Size  
  // 3. Add Colour with Red, Black, Coffee
  
  // First, let me understand the UI better - the active/selected attribute shows its options below
  // Click Dog Size to make it active
  console.log('\nActivating Dog Size attribute...');
  await bulkFrame.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
        const t = el.textContent.trim();
        if (t === 'Dog Size' || t === 'Dog Size x') {
          el.click();
          return 'clicked';
        }
      }
    }
    // Also try the parent tag
    const btns = document.querySelectorAll('button, span, div');
    for (const b of btns) {
      if (b.textContent.trim().startsWith('Dog Size')) {
        b.click();
        return 'clicked parent';
      }
    }
  });
  await sleep(500);
  
  // Check what options are shown now
  const dogSizeState = await bulkFrame.evaluate(() => {
    return {
      text: document.body.innerText,
      optionBtns: Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim(),
        selected: b.classList.contains('selected') || b.style.background?.includes('blue') || 
                  b.getAttribute('aria-pressed') === 'true',
        class: (b.className || '').substring(0, 60)
      })).filter(b => b.text && b.text.length < 30)
    };
  });
  
  // Find the option buttons (they should be in the Options section)
  console.log('All buttons:');
  for (const b of dogSizeState.optionBtns) {
    console.log(`  "${b.text}" selected=${b.selected} class="${b.class}"`);
  }
  
  // The current state should show Dog Size options with Coffee selected
  // I need to deselect Coffee and select XS, S, M, L, XL
  
  // First deselect Coffee if it's an option
  await bulkFrame.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Coffee') {
        // This might be in the "selected options" area
        const x = b.querySelector('[class*="close"], [class*="remove"]');
        if (x) x.click();
        else b.click(); // Toggle off
        return;
      }
    }
  });
  await sleep(300);
  
  // Select proper sizes
  console.log('\nSelecting proper sizes...');
  for (const size of ['XS', 'S', 'M', 'L', 'XL']) {
    await bulkFrame.evaluate((name) => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === name) {
          b.click();
          return true;
        }
      }
      return false;
    }, size);
    console.log(`  Clicked: ${size}`);
    await sleep(200);
  }
  
  await sleep(500);
  await page.screenshot({ path: 'var-sizes-done.png' });
  fs.copyFileSync('var-sizes-done.png', '/Users/pyrite/.openclaw/workspace/var-sizes-done.png');
  
  // Now check if Colour attribute exists. If not, add it
  console.log('\nChecking for Colour attribute...');
  const hasColour = await bulkFrame.evaluate(() => {
    return document.body.innerText.includes('Colour x') || document.body.innerText.includes('Colour\nx');
  });
  
  if (!hasColour) {
    console.log('Adding Colour attribute...');
    await bulkFrame.evaluate(() => {
      const links = document.querySelectorAll('a, button');
      for (const l of links) {
        if (l.textContent.includes('+ Add')) { l.click(); return; }
      }
    });
    await sleep(500);
    
    await bulkFrame.evaluate(() => {
      const cb = document.getElementById('msku-parent-tag-checkbox-2'); // Colour
      if (cb && !cb.checked) cb.click();
    });
    await sleep(200);
    
    await bulkFrame.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === 'Save') { b.click(); return; }
      }
    });
    await sleep(1000);
  }
  
  // Switch to Colour attribute
  console.log('Switching to Colour...');
  await bulkFrame.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
        if (el.textContent.trim() === 'Colour') {
          el.click();
          return;
        }
      }
    }
    // Broader search
    const tags = document.querySelectorAll('button, span, div, a');
    for (const t of tags) {
      if (t.textContent.trim() === 'Colour' || t.textContent.trim() === 'Colour x') {
        t.click();
        return;
      }
    }
  });
  await sleep(1000);
  
  // Check what colour options are available
  const colourBtns = await bulkFrame.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t && t.length < 25);
  });
  console.log('Available buttons:', colourBtns);
  
  await page.screenshot({ path: 'var-colour-options.png' });
  fs.copyFileSync('var-colour-options.png', '/Users/pyrite/.openclaw/workspace/var-colour-options.png');
  
  // Select Red and Black
  for (const color of ['Red', 'Black']) {
    const clicked = await bulkFrame.evaluate((name) => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === name) { b.click(); return true; }
      }
      return false;
    }, color);
    console.log(`  ${color}: ${clicked ? 'selected' : 'NOT FOUND'}`);
    await sleep(200);
  }
  
  // Create Coffee custom colour
  console.log('  Creating custom: Coffee');
  await bulkFrame.evaluate(() => {
    const links = document.querySelectorAll('a, button, [role="link"]');
    for (const l of links) {
      if (l.textContent.includes('Create your own')) { l.click(); return; }
    }
  });
  await sleep(500);
  
  // Type Coffee and press Enter
  await bulkFrame.evaluate(() => {
    const input = document.getElementById('msku-custom-option-input');
    if (input) {
      input.focus();
      input.value = 'Coffee';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(200);
  
  // Find and click the Add button near the custom input
  await bulkFrame.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Add' && b.offsetParent !== null) {
        b.click(); return;
      }
    }
  });
  await sleep(500);
  
  // Check right panel for selected attributes
  const rightPanelText = await bulkFrame.evaluate(() => {
    // The right panel shows "Attributes and options you've selected"
    return document.body.innerText;
  });
  
  // Look for selected attributes summary
  const selectedMatch = rightPanelText.match(/Attributes and options.*?Continue/s);
  console.log('\nSelected summary:', selectedMatch ? selectedMatch[0].substring(0, 300) : 'not found');
  
  await page.screenshot({ path: 'var-final-setup.png' });
  fs.copyFileSync('var-final-setup.png', '/Users/pyrite/.openclaw/workspace/var-final-setup.png');
  
  // Click Continue
  console.log('\nClicking Continue...');
  await bulkFrame.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Continue' && !b.disabled && b.offsetParent !== null) {
        b.click();
        return;
      }
    }
  });
  await sleep(5000);
  
  await page.screenshot({ path: 'var-pricing-page.png' });
  fs.copyFileSync('var-pricing-page.png', '/Users/pyrite/.openclaw/workspace/var-pricing-page.png');
  
  // Check the pricing/table page
  const pricingState = await bulkFrame.evaluate(() => {
    return {
      text: document.body.innerText.substring(0, 2000),
      tables: document.querySelectorAll('table').length,
      inputs: Array.from(document.querySelectorAll('input[type="text"], input[type="number"]')).slice(0, 30).map(i => ({
        id: (i.id || '').substring(0, 40),
        value: i.value
      }))
    };
  }).catch(() => ({ error: 'frame changed' }));
  
  console.log('\nPricing page:');
  console.log(pricingState.text?.substring(0, 600));
  console.log('Tables:', pricingState.tables);
  console.log('Inputs:', pricingState.inputs?.slice(0, 10));
  
  browser.disconnect();
})().catch(e => console.error(e));
