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
  
  // Scroll to Variations section and click Edit
  console.log('1. Opening variation editor...');
  const editPos = await page.evaluate(() => {
    const headers = document.querySelectorAll('h2, h3');
    for (const h of headers) {
      if (h.textContent.includes('VARIATION')) {
        const section = h.closest('section') || h.parentElement?.parentElement;
        if (section) {
          const editBtn = section.querySelector('button');
          if (editBtn) {
            const rect = editBtn.getBoundingClientRect();
            return { x: rect.x + rect.width/2, y: rect.y + rect.height/2, text: editBtn.textContent.trim() };
          }
        }
      }
    }
    return null;
  });
  
  if (editPos) {
    console.log(`Clicking Edit at ${editPos.x}, ${editPos.y}`);
    await page.mouse.click(editPos.x, editPos.y);
  } else {
    console.log('Edit button not found, trying alternative...');
    // Try to find any Edit button near Variations text
    await page.evaluate(() => {
      const all = document.querySelectorAll('button');
      for (const b of all) {
        if (b.textContent.trim() === 'Edit') {
          const parent = b.closest('section');
          if (parent && parent.textContent.includes('Variation')) {
            b.click();
            return;
          }
        }
      }
    });
  }
  
  // Wait for iframe
  await sleep(8000);
  
  let bulkFrame = page.frames().find(f => f.url().includes('bulkedit'));
  if (!bulkFrame) {
    console.log('Still no iframe. Taking screenshot...');
    await page.screenshot({ path: '/Users/pyrite/.openclaw/workspace/no-iframe-debug.png' });
    
    // Maybe the dialog is there but needs time
    await sleep(5000);
    bulkFrame = page.frames().find(f => f.url().includes('bulkedit'));
  }
  
  if (!bulkFrame) {
    console.log('FATAL: No bulkedit iframe found');
    browser.disconnect();
    return;
  }
  
  // Wait for frame content  
  console.log('Iframe found. Waiting for content...');
  await sleep(3000);
  
  const frameText = await bulkFrame.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Frame text:', frameText.substring(0, 200));
  
  // Get iframe offset
  const io = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="bulkedit"]');
    const rect = iframe.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  
  // Scroll to the table area in the iframe
  await bulkFrame.evaluate(() => {
    const table = document.querySelector('table');
    if (table) table.scrollIntoView();
  });
  await sleep(500);
  
  // Click "Enter price" button
  console.log('\n2. Setting bulk price...');
  const epPos = await bulkFrame.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Enter price' && b.offsetParent !== null) {
        const rect = b.getBoundingClientRect();
        return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
      }
    }
    return null;
  });
  
  if (epPos) {
    await page.mouse.click(io.x + epPos.x, io.y + epPos.y);
    console.log('Clicked Enter price');
    await sleep(1500);
    
    // Now find the price input that appeared
    // It might be a new input row at the top of the table
    const priceInputs = await bulkFrame.evaluate(() => {
      const inputs = document.querySelectorAll('input');
      return Array.from(inputs).filter(i => i.offsetParent !== null && i.getBoundingClientRect().width > 0)
        .map(i => ({
          id: i.id,
          type: i.type,
          value: i.value,
          x: i.getBoundingClientRect().x,
          y: i.getBoundingClientRect().y,
          w: i.getBoundingClientRect().width,
          h: i.getBoundingClientRect().height,
          class: (i.className || '').substring(0, 40)
        }));
    });
    console.log('Visible inputs:', priceInputs);
    
    // Find the bulk price input (should be near the Enter price button)
    const priceInput = priceInputs.find(i => i.y > 100 && i.w > 50 && i.w < 300);
    if (priceInput) {
      await page.mouse.click(io.x + priceInput.x + priceInput.w/2, io.y + priceInput.y + priceInput.h/2);
      await sleep(200);
      await page.keyboard.down('Meta');
      await page.keyboard.press('a');
      await page.keyboard.up('Meta');
      await page.keyboard.type('24.99', { delay: 20 });
      console.log('Typed 24.99');
      
      // Find and click save
      const saveBtn = await bulkFrame.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          if (b.textContent.trim() === 'Save' && b.offsetParent !== null) {
            const rect = b.getBoundingClientRect();
            if (rect.y > 100 && rect.width > 0) return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
          }
        }
        return null;
      });
      if (saveBtn) {
        await page.mouse.click(io.x + saveBtn.x, io.y + saveBtn.y);
        console.log('Saved price');
      }
      await sleep(2000);
    }
  }
  
  // Set quantity
  console.log('\n3. Setting bulk quantity...');
  const eqPos = await bulkFrame.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Enter quantity' && b.offsetParent !== null) {
        const rect = b.getBoundingClientRect();
        return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
      }
    }
    return null;
  });
  
  if (eqPos) {
    await page.mouse.click(io.x + eqPos.x, io.y + eqPos.y);
    console.log('Clicked Enter quantity');
    await sleep(1500);
    
    const qtyInputs = await bulkFrame.evaluate(() => {
      const inputs = document.querySelectorAll('input');
      return Array.from(inputs).filter(i => i.offsetParent !== null && i.getBoundingClientRect().width > 0 && i.getBoundingClientRect().y > 100)
        .map(i => ({
          id: i.id, x: i.getBoundingClientRect().x, y: i.getBoundingClientRect().y,
          w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height
        }));
    });
    
    const qtyInput = qtyInputs.find(i => i.w > 50 && i.w < 300);
    if (qtyInput) {
      await page.mouse.click(io.x + qtyInput.x + qtyInput.w/2, io.y + qtyInput.y + qtyInput.h/2);
      await sleep(200);
      await page.keyboard.down('Meta');
      await page.keyboard.press('a');
      await page.keyboard.up('Meta');
      await page.keyboard.type('5', { delay: 20 });
      
      const saveBtn = await bulkFrame.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          if (b.textContent.trim() === 'Save' && b.offsetParent !== null) {
            const rect = b.getBoundingClientRect();
            if (rect.y > 100) return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
          }
        }
        return null;
      });
      if (saveBtn) {
        await page.mouse.click(io.x + saveBtn.x, io.y + saveBtn.y);
        console.log('Saved quantity');
      }
      await sleep(2000);
    }
  }
  
  // Save and close
  console.log('\n4. Save and close...');
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
  
  // Check final state
  const errors = await page.evaluate(() => {
    const errorEls = document.querySelectorAll('[class*="error"], [role="alert"]');
    return Array.from(errorEls).filter(e => e.offsetParent !== null).map(e => e.textContent.trim().substring(0, 100));
  });
  console.log('\nFinal errors:', errors);
  
  await page.screenshot({ path: '/Users/pyrite/.openclaw/workspace/final-state.png' });
  
  browser.disconnect();
})().catch(e => console.error(e));
