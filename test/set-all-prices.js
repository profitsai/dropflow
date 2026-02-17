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
  
  // Open the variation editor again
  console.log('1. Opening variation editor...');
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Edit') {
        const parent = b.closest('section, div');
        if (parent && parent.textContent.includes('Variation')) {
          b.scrollIntoView({ block: 'center' });
          b.click();
          return;
        }
      }
    }
  });
  
  await sleep(8000);
  
  const bulkFrame = page.frames().find(f => f.url().includes('bulkedit'));
  if (!bulkFrame) {
    console.log('No iframe!');
    browser.disconnect();
    return;
  }
  
  console.log('Iframe found');
  await sleep(3000);
  
  // Set all prices using JavaScript in the iframe
  // The price inputs have value '0.00' and are at x=1406
  console.log('\n2. Setting all prices to 24.99...');
  
  const priceResult = await bulkFrame.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"]');
    let count = 0;
    for (const inp of inputs) {
      if (inp.value === '0.00' || inp.value === '24.99') {
        const rect = inp.getBoundingClientRect();
        // Price inputs are the rightmost text inputs (x > 1300)
        if (rect.x > 1300 && rect.width > 50 && rect.width < 200) {
          // Use native setter
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(inp, '24.99');
          else inp.value = '24.99';
          inp.dispatchEvent(new Event('focus', { bubbles: true }));
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          inp.dispatchEvent(new Event('blur', { bubbles: true }));
          count++;
        }
      }
    }
    return count;
  });
  console.log(`Set price on ${priceResult} inputs`);
  
  // Also set quantities to 5
  console.log('Setting quantities to 5...');
  const qtyResult = await bulkFrame.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"]');
    let count = 0;
    for (const inp of inputs) {
      if (inp.value === '1') {
        const rect = inp.getBoundingClientRect();
        // Quantity inputs are the second-to-rightmost (x around 1200-1300)
        if (rect.x > 1150 && rect.x < 1350 && rect.width > 50 && rect.width < 200) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(inp, '5');
          else inp.value = '5';
          inp.dispatchEvent(new Event('focus', { bubbles: true }));
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          inp.dispatchEvent(new Event('blur', { bubbles: true }));
          count++;
        }
      }
    }
    return count;
  });
  console.log(`Set qty on ${qtyResult} inputs`);
  
  // Also clear the UPC field that has '24.99' from the earlier mistake
  await bulkFrame.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"]');
    for (const inp of inputs) {
      if (inp.value === '24.99') {
        const rect = inp.getBoundingClientRect();
        // UPC/SKU fields are wider (w=222) and at x around 780
        if (rect.x < 1000 && rect.width > 200) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(inp, '');
          else inp.value = '';
          inp.dispatchEvent(new Event('focus', { bubbles: true }));
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          inp.dispatchEvent(new Event('blur', { bubbles: true }));
        }
      }
    }
  });
  console.log('Cleared any bad UPC values');
  
  // Verify
  const verification = await bulkFrame.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"]');
    const prices = [];
    const qtys = [];
    for (const inp of inputs) {
      const rect = inp.getBoundingClientRect();
      if (rect.x > 1300 && rect.width > 50) prices.push(inp.value);
      if (rect.x > 1150 && rect.x < 1350 && rect.width > 50) qtys.push(inp.value);
    }
    return { prices: [...new Set(prices)], qtys: [...new Set(qtys)] };
  });
  console.log('Price values:', verification.prices);
  console.log('Qty values:', verification.qtys);
  
  // Now also try clicking each price cell and typing - the JS setter might not work
  // Let me click one price cell to verify
  const io = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="bulkedit"]');
    const rect = iframe.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  
  // Click the first price input and check if value shows
  const firstPricePos = await bulkFrame.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"]');
    for (const inp of inputs) {
      const rect = inp.getBoundingClientRect();
      if (rect.x > 1300 && rect.width > 50 && rect.y > 0) {
        return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
      }
    }
    return null;
  });
  
  if (firstPricePos) {
    await page.mouse.click(io.x + firstPricePos.x, io.y + firstPricePos.y);
    await sleep(200);
    // Select all and type
    await page.keyboard.down('Meta');
    await page.keyboard.press('a');
    await page.keyboard.up('Meta');
    await page.keyboard.type('24.99', { delay: 20 });
    await page.keyboard.press('Tab'); // Move to next field
    await sleep(200);
    console.log('Manually typed price in first cell');
  }
  
  await page.screenshot({ path: '/Users/pyrite/.openclaw/workspace/prices-set.png' });
  
  // Now Save and close
  console.log('\n3. Save and close...');
  await bulkFrame.evaluate(() => window.scrollTo(0, 99999));
  await sleep(500);
  
  const sncPos = await bulkFrame.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Save and close' && b.offsetParent !== null) {
        const rect = b.getBoundingClientRect();
        return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
      }
    }
    return null;
  });
  
  if (sncPos) {
    const newIo = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[src*="bulkedit"]');
      const rect = iframe.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    });
    await page.mouse.click(newIo.x + sncPos.x, newIo.y + sncPos.y);
    console.log('Clicked Save and close');
  }
  
  await sleep(5000);
  
  // Check errors
  const errors = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*="error"], [role="alert"]'))
      .filter(e => e.offsetParent !== null)
      .map(e => e.textContent.trim().substring(0, 150));
  });
  console.log('\nErrors:', errors);
  
  if (errors.length === 0 || !errors.some(e => e.includes('price'))) {
    console.log('\n*** READY TO LIST! ***');
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
