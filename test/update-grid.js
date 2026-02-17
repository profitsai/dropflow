const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  const bf = ebay.frames().find(f => f.url().includes('bulkedit'));
  if (!bf) { console.error('No bulkedit frame'); process.exit(1); }
  
  let text = await bf.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('Current state:', text.substring(0, 400));
  
  // Click "Update automatically" if the dialog is showing
  if (text.includes('Update automatically')) {
    console.log('Clicking "Update automatically"...');
    await bf.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === 'Update automatically' || b.textContent.trim().includes('Update automatically')) {
          b.click(); return;
        }
      }
    });
    await sleep(3000);
  } else {
    // Need to click "Update variations" first
    console.log('Clicking "Update variations"...');
    await bf.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === 'Update variations') {
          b.click(); return;
        }
      }
    });
    await sleep(2000);
    
    // Then click "Update automatically"
    await bf.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim().includes('Update automatically')) {
          b.click(); return;
        }
      }
    });
    await sleep(3000);
  }
  
  // Now should be on the grid page
  text = await bf.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('\nGrid state:', text.substring(0, 1500));
  await ebay.screenshot({ path: 'var-grid-ready.png' });
  
  // Check if we have the grid with variation combinations
  const hasGrid = text.includes('Variation combinations');
  const numVariations = text.match(/Number of variations\s+(\d+)/)?.[1];
  console.log('Has grid:', hasGrid, 'Variations:', numVariations);
  
  if (!hasGrid) {
    console.log('Grid not ready yet, taking screenshot...');
    await ebay.screenshot({ path: 'var-no-grid.png' });
    browser.disconnect();
    process.exit(1);
  }
  
  // Fill prices and quantities using "Enter price" / "Enter quantity" bulk actions
  console.log('\n=== Filling prices ===');
  
  // Click "Enter price" header
  await bf.evaluate(() => {
    // Look for "Enter price" text that's clickable
    const allEls = [...document.querySelectorAll('*')];
    for (const el of allEls) {
      if (el.textContent.trim() === 'Enter price' && el.offsetParent !== null) {
        el.click();
        return;
      }
    }
  });
  await sleep(1000);
  
  text = await bf.evaluate(() => document.body.innerText.substring(0, 3000));
  await ebay.screenshot({ path: 'var-after-price-click.png' });
  
  // Check if a price input appeared or if we need to fill each row individually
  const priceInputs = await bf.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')];
    return inputs.filter(i => i.offsetParent !== null).map(i => ({
      type: i.type,
      placeholder: i.placeholder,
      value: i.value,
      name: i.name,
      ariaLabel: i.getAttribute('aria-label'),
    }));
  });
  console.log('Visible inputs:', JSON.stringify(priceInputs, null, 2).substring(0, 1000));
  
  // Try to type the price in any empty visible input
  const filledPrice = await bf.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[type="text"], input[type="number"], input:not([type])')];
    let filled = 0;
    for (const input of inputs) {
      if (input.offsetParent !== null && (!input.value || input.value === '')) {
        const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        ns.call(input, '24.99');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        filled++;
      }
    }
    return filled;
  });
  console.log('Filled price inputs:', filledPrice);
  
  // Look for Apply/Continue/OK
  await bf.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    for (const b of btns) {
      const t = b.textContent.trim();
      if (['Apply', 'Update', 'OK', 'Continue', 'ContinueAdd rows automaticallyUpdate automatically'].includes(t) && b.offsetParent !== null) {
        b.click();
        return;
      }
    }
  });
  await sleep(1000);
  
  // Now fill quantity similarly
  console.log('\n=== Filling quantities ===');
  await bf.evaluate(() => {
    const allEls = [...document.querySelectorAll('*')];
    for (const el of allEls) {
      if (el.textContent.trim() === 'Enter quantity' && el.offsetParent !== null) {
        el.click();
        return;
      }
    }
  });
  await sleep(1000);
  
  await bf.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[type="text"], input[type="number"], input:not([type])')];
    for (const input of inputs) {
      if (input.offsetParent !== null && (!input.value || input.value === '')) {
        const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        ns.call(input, '5');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });
  await sleep(500);
  
  await bf.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    for (const b of btns) {
      const t = b.textContent.trim();
      if (['Apply', 'Update', 'OK', 'Continue'].includes(t) && b.offsetParent !== null) {
        b.click(); return;
      }
    }
  });
  await sleep(1000);
  
  // Alternative: Fill price/qty directly in each row
  console.log('\n=== Filling individual rows ===');
  const rowsFilled = await bf.evaluate(() => {
    const rows = document.querySelectorAll('tr');
    let filled = 0;
    for (const row of rows) {
      const inputs = row.querySelectorAll('input[type="text"], input[type="number"]');
      const tds = row.querySelectorAll('td');
      if (inputs.length >= 2) {
        // Find price and quantity inputs
        for (const input of inputs) {
          if (input.offsetParent !== null && (!input.value || input.value === '0' || input.value === '')) {
            const header = input.getAttribute('aria-label') || input.closest('td')?.getAttribute('data-column') || '';
            const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            
            // Determine if price or qty based on position or header
            const idx = [...row.querySelectorAll('input')].indexOf(input);
            const allInputs = row.querySelectorAll('input');
            // In the grid: SKU | UPC | Dog Size | Quantity | Price
            // Qty is 2nd to last, Price is last
            if (idx === allInputs.length - 1) {
              ns.call(input, '24.99');
            } else if (idx === allInputs.length - 2) {
              ns.call(input, '5');
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            filled++;
          }
        }
      }
    }
    return filled;
  });
  console.log('Rows filled:', rowsFilled);
  
  await sleep(1000);
  await ebay.screenshot({ path: 'var-grid-filled-final.png' });
  
  text = await bf.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('\nFinal grid:', text.substring(0, 2000));
  
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
  
  // Check main page
  await ebay.screenshot({ path: 'var-main-after-save.png' });
  const mainText = await ebay.evaluate(() => document.body.innerText.substring(0, 1000));
  console.log('\nMain page:', mainText.substring(0, 500));
  
  browser.disconnect();
  console.log('\nDone');
})().catch(e => { console.error(e.message); process.exit(1); });
