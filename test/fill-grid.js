const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  const bf = ebay.frames().find(f => f.url().includes('bulkedit'));
  if (!bf) { console.error('No bulkedit frame'); process.exit(1); }
  
  // First, let me try to add Colour via Edit → +Add → Save workflow
  console.log('=== Adding Colour attribute ===');
  
  // Click Edit to go back to attribute selection
  await bf.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a')];
    for (const b of btns) {
      if (b.textContent.trim() === 'Edit' && b.offsetParent !== null) {
        b.click();
        return;
      }
    }
  });
  await sleep(1500);
  
  let text = await bf.evaluate(() => document.body.innerText.substring(0, 1500));
  console.log('After Edit:', text.substring(0, 400));
  
  // Click +Add
  await bf.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a, span')];
    for (const b of btns) {
      if (b.textContent.trim() === '+ Add' && b.offsetParent !== null) {
        b.click();
        return;
      }
    }
  });
  await sleep(1000);
  
  // Now the dropdown should appear. Check Colour checkbox
  await bf.evaluate(() => {
    const cbs = document.querySelectorAll('input[type="checkbox"]');
    for (const cb of cbs) {
      const label = (cb.closest('label') || cb.parentElement)?.textContent?.trim();
      if (label === 'Colour' && !cb.checked) {
        cb.click();
        return;
      }
    }
  });
  await sleep(500);
  
  // Now click Save button in the dropdown
  // The dropdown text was: "Add variation attribute FeaturesDog SizeGenderMaterialColourModelMPNDog BreedThemeCountry of Origin Add your own attribute SaveCancel"
  // So Save should be there
  const saveResult = await bf.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    // Find buttons in the dropdown/popover area
    for (const b of btns) {
      const t = b.textContent.trim();
      const rect = b.getBoundingClientRect();
      if (t === 'Save' && rect.width > 0 && rect.height > 0) {
        console.log('Clicking Save at', rect.x, rect.y);
        b.click();
        return 'clicked Save at ' + Math.round(rect.x) + ',' + Math.round(rect.y);
      }
    }
    return 'Save not found. Buttons: ' + btns.filter(b => b.offsetParent).map(b => b.textContent.trim()).join(' | ');
  });
  console.log('Save:', saveResult);
  await sleep(1000);
  
  text = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('After Save:', text.substring(0, 500));
  await ebay.screenshot({ path: 'var-grid-after-save.png' });
  
  // Now check if Colour tab appeared
  const hasColour = text.includes('Colour');
  console.log('Has Colour:', hasColour);
  
  if (hasColour && text.includes('Attributes') && text.includes('Options')) {
    // Click on Colour tab
    console.log('\nSwitching to Colour tab...');
    // Need to find Colour as an attribute tab (not in the dropdown)
    await bf.evaluate(() => {
      const allEls = [...document.querySelectorAll('*')];
      for (const el of allEls) {
        const t = el.textContent?.trim();
        // Looking for the Colour chip/tab in the "Attributes" row
        if ((t === 'Colour' || t === 'Colour x') && el.offsetParent !== null) {
          const rect = el.getBoundingClientRect();
          // Should be in the attributes row area (y < 300 or so)
          if (rect.height > 0 && rect.height < 50) {
            el.click();
            return;
          }
        }
      }
    });
    await sleep(1000);
    
    text = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
    console.log('After Colour click:', text.substring(0, 500));
    
    if (text.includes('- Colour')) {
      console.log('Colour is active! Selecting options...');
      // Select Red, Black
      for (const c of ['Red', 'Black']) {
        await bf.evaluate((colour) => {
          const lis = document.querySelectorAll('li[role="button"]');
          for (const li of lis) {
            if (li.textContent.trim() === colour) { li.click(); return; }
          }
        }, c);
        console.log('Selected:', c);
        await sleep(300);
      }
      
      // Create Coffee
      await bf.evaluate(() => {
        const links = [...document.querySelectorAll('button, a, span')];
        for (const l of links) {
          if (l.textContent.trim().includes('Create your own') && l.offsetParent !== null) {
            l.click();
            return;
          }
        }
      });
      await sleep(500);
      
      await bf.evaluate(() => {
        const inputs = [...document.querySelectorAll('input[type="text"]')];
        for (const input of inputs) {
          if (input.offsetParent !== null && !input.value) {
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
      
      await bf.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        for (const b of btns) {
          if (b.textContent.trim() === 'Add' && b.offsetParent !== null) {
            b.click(); return;
          }
        }
      });
      await sleep(500);
      
      console.log('Colours selected!');
    }
    
    // Click Update variations
    await bf.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === 'Update variations' && b.offsetParent !== null) {
          b.click(); return;
        }
      }
    });
    await sleep(2000);
    
    // Auto-add rows
    text = await bf.evaluate(() => document.body.innerText);
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
    }
  }
  
  // Now we should have a grid. Let's fill prices and quantities
  console.log('\n=== Filling prices and quantities ===');
  text = await bf.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('Grid state:', text.substring(0, 1000));
  await ebay.screenshot({ path: 'var-grid-state.png' });
  
  // Use "Enter price" / "Enter quantity" bulk actions
  // First click "Enter price" to set a bulk price
  const bulkPrice = await bf.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a, span')];
    for (const b of btns) {
      if (b.textContent.trim() === 'Enter price' && b.offsetParent !== null) {
        b.click();
        return 'clicked Enter price';
      }
    }
    return 'Enter price not found';
  });
  console.log(bulkPrice);
  await sleep(500);
  
  // Type price
  await bf.evaluate(() => {
    // Find the input that appeared for bulk price
    const inputs = [...document.querySelectorAll('input[type="text"], input[type="number"]')];
    for (const input of inputs) {
      if (input.offsetParent !== null && (!input.value || input.value === '')) {
        input.focus();
        const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        ns.call(input, '24.99');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  });
  await sleep(300);
  
  // Confirm/Apply the bulk price
  await bf.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    for (const b of btns) {
      const t = b.textContent.trim();
      if ((t === 'Apply' || t === 'Update' || t === 'OK' || t === 'Confirm' || t === 'Update automatically') && b.offsetParent !== null) {
        b.click();
        return;
      }
    }
    // Press Enter
    const input = document.activeElement;
    if (input && input.tagName === 'INPUT') {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }
  });
  await sleep(1000);
  
  // Now bulk quantity
  const bulkQty = await bf.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a, span')];
    for (const b of btns) {
      if (b.textContent.trim() === 'Enter quantity' && b.offsetParent !== null) {
        b.click();
        return 'clicked Enter quantity';
      }
    }
    return 'Enter quantity not found';
  });
  console.log(bulkQty);
  await sleep(500);
  
  await bf.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[type="text"], input[type="number"]')];
    for (const input of inputs) {
      if (input.offsetParent !== null && (!input.value || input.value === '')) {
        input.focus();
        const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        ns.call(input, '5');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  });
  await sleep(300);
  
  await bf.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    for (const b of btns) {
      const t = b.textContent.trim();
      if ((t === 'Apply' || t === 'Update' || t === 'OK' || t === 'Update automatically') && b.offsetParent !== null) {
        b.click(); return;
      }
    }
    const input = document.activeElement;
    if (input && input.tagName === 'INPUT') {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }
  });
  await sleep(1000);
  
  // Take screenshot of final grid
  await ebay.screenshot({ path: 'var-grid-filled.png' });
  text = await bf.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('\nGrid after filling:', text.substring(0, 1500));
  
  // Click "Save and close"
  console.log('\n=== Save and close ===');
  await bf.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Save and close' && b.offsetParent !== null) {
        b.click(); return;
      }
    }
  });
  await sleep(3000);
  
  // Check main page state
  const mainText = await ebay.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('\nMain page:', mainText.substring(0, 800));
  await ebay.screenshot({ path: 'var-after-save-close.png' });
  
  browser.disconnect();
  console.log('\nDone');
})().catch(e => { console.error(e.message); process.exit(1); });
