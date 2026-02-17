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
  
  const iframeOffset = { x: 0, y: 63 }; // from earlier
  
  // === 1. Fix the title ===
  console.log('1. Setting title...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  
  // Find and scroll to title input
  const titleSet = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input, textarea');
    for (const inp of inputs) {
      if (inp.value.includes('Dog coat hoodie fleece') || (inp.id || '').includes('TITLE')) {
        inp.focus();
        inp.select();
        document.execCommand('selectAll');
        document.execCommand('insertText', false, 'Warm Fleece Dog Coat Hooded Waterproof Winter Pet Puppy Clothes Small Medium Dogs');
        return true;
      }
    }
    return false;
  });
  console.log('Title set:', titleSet);
  await sleep(500);
  
  // === 2. Add description ===
  console.log('\n2. Adding description...');
  
  // First check "Show HTML code" checkbox
  await page.evaluate(() => {
    const cbs = document.querySelectorAll('input[type="checkbox"]');
    for (const cb of cbs) {
      const label = cb.closest('label') || document.querySelector(`label[for="${cb.id}"]`);
      if (label && label.textContent.includes('HTML')) {
        if (!cb.checked) cb.click();
        return;
      }
    }
  });
  await sleep(500);
  
  // Try to type in the description area
  const descSet = await page.evaluate(() => {
    // Try contenteditable
    const editable = document.querySelector('[contenteditable="true"]');
    if (editable) {
      editable.focus();
      editable.innerHTML = '<h2>Warm Fleece Dog Coat with Hood</h2><p>Keep your pet warm and dry this winter with our premium hooded dog coat.</p><ul><li>Warm fleece lining with waterproof outer layer</li><li>Hooded design for extra warmth and protection</li><li>Buckle closure for easy on/off</li><li>Suitable for small to medium dogs (French Bulldogs, Chihuahuas, Shih Tzus)</li><li>Available in Red, Black, and Coffee colours</li><li>Sizes: XS, S, M, L, XL</li></ul><p>Perfect for winter walks, rainy days, and keeping your furry friend comfortable.</p>';
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      return 'contenteditable';
    }
    
    // Try iframe
    const iframe = document.querySelector('iframe[class*="desc"], iframe[id*="desc"]');
    if (iframe && iframe.contentDocument) {
      iframe.contentDocument.body.innerHTML = '<h2>Warm Fleece Dog Coat with Hood</h2><p>Keep your pet warm and dry this winter.</p><ul><li>Warm fleece lining</li><li>Waterproof outer layer</li><li>Hooded design</li><li>Available in Red, Black, Coffee</li><li>Sizes: XS, S, M, L, XL</li></ul>';
      return 'iframe';
    }
    
    return 'not found';
  });
  console.log('Description set:', descSet);
  await sleep(500);
  
  // === 3. Go back into variations to set prices ===
  console.log('\n3. Setting variation prices...');
  
  // Click the Edit button in the Variations section
  await page.evaluate(() => {
    const headers = document.querySelectorAll('h2, h3');
    for (const h of headers) {
      if (h.textContent.includes('VARIATION') || h.textContent.includes('Variation')) {
        h.scrollIntoView({ block: 'center' });
        break;
      }
    }
  });
  await sleep(500);
  
  // Find and click the Edit button in Variations section
  await page.evaluate(() => {
    const headers = document.querySelectorAll('h2, h3');
    for (const h of headers) {
      if (h.textContent.includes('VARIATION')) {
        const section = h.closest('section') || h.parentElement?.parentElement;
        if (section) {
          const editBtn = section.querySelector('button');
          if (editBtn) editBtn.click();
        }
        break;
      }
    }
  });
  
  await sleep(5000); // Wait for iframe to load
  
  // Get the bulkedit iframe
  const bulkFrame = page.frames().find(f => f.url().includes('bulkedit'));
  if (!bulkFrame) {
    console.log('No bulkedit iframe - variation editor may not have opened');
    
    // Try scrolling to see the pricing section and set price there
    await page.evaluate(() => {
      const headers = document.querySelectorAll('h2');
      for (const h of headers) {
        if (h.textContent.includes('PRICING')) {
          h.scrollIntoView({ block: 'start' });
          break;
        }
      }
    });
    await sleep(500);
    
    // Try to set price in the main pricing input
    const priceSet = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input');
      for (const inp of inputs) {
        const label = inp.getAttribute('aria-label') || '';
        const id = inp.id || '';
        // Find the item price input
        if ((label.toLowerCase().includes('price') || id.includes('PRICE')) && 
            !id.includes('payment') && !id.includes('shipping') && !id.includes('switch')) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(inp, '24.99');
          else inp.value = '24.99';
          inp.dispatchEvent(new Event('focus', { bubbles: true }));
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          inp.dispatchEvent(new Event('blur', { bubbles: true }));
          return `set on ${id}`;
        }
      }
      return 'not found';
    });
    console.log('Price set result:', priceSet);
  } else {
    console.log('Bulkedit iframe found, setting prices...');
    
    // Wait for content to load
    await sleep(3000);
    
    // Click "Enter price" button
    const enterPricePos = await bulkFrame.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === 'Enter price' && b.offsetParent !== null) {
          const rect = b.getBoundingClientRect();
          return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
        }
      }
      return null;
    });
    
    if (enterPricePos) {
      // Recalculate iframe offset
      const newOffset = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="bulkedit"]');
        const rect = iframe.getBoundingClientRect();
        return { x: rect.x, y: rect.y };
      });
      
      await page.mouse.click(newOffset.x + enterPricePos.x, newOffset.y + enterPricePos.y);
      console.log('Clicked Enter price');
      await sleep(1000);
      
      // Now there should be a bulk price input
      const bulkPriceInput = await bulkFrame.evaluate(() => {
        const inputs = document.querySelectorAll('input');
        for (const inp of inputs) {
          if (inp.offsetParent !== null && inp.getBoundingClientRect().width > 0) {
            const rect = inp.getBoundingClientRect();
            // The bulk price input appears near the button
            if (rect.y > 100) {
              return { id: inp.id, x: rect.x + rect.width/2, y: rect.y + rect.height/2, type: inp.type };
            }
          }
        }
        return null;
      });
      
      console.log('Bulk price input:', bulkPriceInput);
      
      if (bulkPriceInput) {
        const newOffset2 = await page.evaluate(() => {
          const iframe = document.querySelector('iframe[src*="bulkedit"]');
          const rect = iframe.getBoundingClientRect();
          return { x: rect.x, y: rect.y };
        });
        
        await page.mouse.click(newOffset2.x + bulkPriceInput.x, newOffset2.y + bulkPriceInput.y);
        await sleep(200);
        await page.keyboard.down('Meta');
        await page.keyboard.press('a');
        await page.keyboard.up('Meta');
        await page.keyboard.type('24.99', { delay: 20 });
        console.log('Typed price: 24.99');
        
        // Click Save
        await sleep(200);
        const savePos = await bulkFrame.evaluate(() => {
          const btns = document.querySelectorAll('button');
          for (const b of btns) {
            if (b.textContent.trim() === 'Save' && b.offsetParent !== null) {
              const rect = b.getBoundingClientRect();
              if (rect.width > 0 && rect.y > 100) return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
            }
          }
          return null;
        });
        
        if (savePos) {
          const newOffset3 = await page.evaluate(() => {
            const iframe = document.querySelector('iframe[src*="bulkedit"]');
            const rect = iframe.getBoundingClientRect();
            return { x: rect.x, y: rect.y };
          });
          await page.mouse.click(newOffset3.x + savePos.x, newOffset3.y + savePos.y);
          console.log('Clicked Save for price');
          await sleep(1000);
        }
      }
      
      // Now set quantity
      console.log('\nSetting quantity...');
      const enterQtyPos = await bulkFrame.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          if (b.textContent.trim() === 'Enter quantity' && b.offsetParent !== null) {
            const rect = b.getBoundingClientRect();
            return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
          }
        }
        return null;
      });
      
      if (enterQtyPos) {
        const qo = await page.evaluate(() => {
          const iframe = document.querySelector('iframe[src*="bulkedit"]');
          const rect = iframe.getBoundingClientRect();
          return { x: rect.x, y: rect.y };
        });
        await page.mouse.click(qo.x + enterQtyPos.x, qo.y + enterQtyPos.y);
        await sleep(1000);
        
        // Find qty input
        const qtyInput = await bulkFrame.evaluate(() => {
          const inputs = document.querySelectorAll('input');
          for (const inp of inputs) {
            if (inp.offsetParent !== null && inp.getBoundingClientRect().width > 0) {
              const rect = inp.getBoundingClientRect();
              if (rect.y > 100) return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
            }
          }
          return null;
        });
        
        if (qtyInput) {
          await page.mouse.click(qo.x + qtyInput.x, qo.y + qtyInput.y);
          await sleep(200);
          await page.keyboard.down('Meta');
          await page.keyboard.press('a');
          await page.keyboard.up('Meta');
          await page.keyboard.type('5', { delay: 20 });
          
          // Save
          const sp = await bulkFrame.evaluate(() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
              if (b.textContent.trim() === 'Save' && b.offsetParent !== null) {
                const rect = b.getBoundingClientRect();
                if (rect.width > 0 && rect.y > 100) return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
              }
            }
            return null;
          });
          if (sp) {
            await page.mouse.click(qo.x + sp.x, qo.y + sp.y);
            console.log('Saved quantity');
          }
          await sleep(1000);
        }
      }
      
      // Save and close
      console.log('\nSave and close...');
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
        const so = await page.evaluate(() => {
          const iframe = document.querySelector('iframe[src*="bulkedit"]');
          const rect = iframe.getBoundingClientRect();
          return { x: rect.x, y: rect.y };
        });
        await page.mouse.click(so.x + sncPos.x, so.y + sncPos.y);
        console.log('Clicked Save and close');
      }
      await sleep(5000);
    }
  }
  
  // Take final screenshots
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await page.screenshot({ path: '/Users/pyrite/.openclaw/workspace/final-form-top.png' });
  
  await page.evaluate(() => window.scrollTo(0, 99999));
  await sleep(500);
  await page.screenshot({ path: '/Users/pyrite/.openclaw/workspace/final-form-bottom.png' });
  
  // Check for errors
  const errors = await page.evaluate(() => {
    const errorEls = document.querySelectorAll('[class*="error"], [class*="alert"], [role="alert"]');
    return Array.from(errorEls).filter(e => e.offsetParent !== null).map(e => e.textContent.trim().substring(0, 150));
  });
  console.log('\nErrors:', errors);
  
  browser.disconnect();
})().catch(e => console.error(e));
