const puppeteer = require('puppeteer-core');
const fs = require('fs');
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Simulate a full click inside the iframe using CDP
async function clickInFrame(page, bulkFrame, selector, text) {
  // Get element position relative to iframe
  const pos = await bulkFrame.evaluate((sel, txt) => {
    let el;
    if (txt) {
      // Find by text content
      const btns = document.querySelectorAll(sel || 'button, a, span');
      for (const b of btns) {
        if (b.textContent.trim() === txt && b.offsetParent !== null) {
          el = b; break;
        }
      }
    } else {
      el = document.querySelector(sel);
    }
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width/2, y: rect.y + rect.height/2, w: rect.width, h: rect.height };
  }, selector, text);
  
  if (!pos) return false;
  
  // Get iframe position on the page
  const iframePos = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="bulkedit"]');
    if (!iframe) return { x: 0, y: 0 };
    const rect = iframe.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  
  // Click at absolute position (iframe offset + element position within iframe)
  const absX = iframePos.x + pos.x;
  const absY = iframePos.y + pos.y;
  
  await page.mouse.click(absX, absY);
  return true;
}

// Simulate click with full event chain inside iframe
async function simulateClickInFrame(bulkFrame, text) {
  return await bulkFrame.evaluate((txt) => {
    function simClick(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const view = el.ownerDocument?.defaultView || window;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: view };
      
      el.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false }));
      el.dispatchEvent(new PointerEvent('pointerover', opts));
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.focus();
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      try { el.click(); } catch (_) {}
      return true;
    }
    
    // Find element by exact text
    const allEls = document.querySelectorAll('button, a, span, div, [role="button"], [role="option"]');
    for (const el of allEls) {
      const innerText = el.textContent.trim();
      // Match exact text (the option buttons contain only the option name)
      if (innerText === txt && el.offsetParent !== null) {
        // Make sure this is a small clickable element (not a container)
        const rect = el.getBoundingClientRect();
        if (rect.width < 200 && rect.height < 60) {
          return simClick(el);
        }
      }
    }
    return false;
  }, text);
}

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('5051135836723'));
  await page.bringToFront();
  const bulkFrame = page.frames().find(f => f.url().includes('bulkedit'));
  
  // First check what's the current state
  const state = await bulkFrame.evaluate(() => {
    return document.body.innerText.substring(0, 500);
  });
  console.log('Current state:', state.substring(0, 200));
  
  // If there's an "Update automatically" dialog, click it first  
  const hasAutoUpdate = state.includes('automatically');
  if (hasAutoUpdate) {
    console.log('Clicking "I\'ll do it myself"...');
    await simulateClickInFrame(bulkFrame, "I'll do it myself");
    await sleep(1000);
  }
  
  // Check if we're back on the builder page
  const builderState = await bulkFrame.evaluate(() => {
    const hasCreateYourVar = document.body.innerText.includes('Create your variations');
    const hasEdit = document.body.innerText.includes('Edit');
    return { hasCreateYourVar, hasEdit, text: document.body.innerText.substring(0, 300) };
  });
  console.log('Builder state:', builderState);
  
  // If we see the table/editor, go back to builder
  if (!builderState.hasCreateYourVar) {
    console.log('Clicking Edit to go back to builder...');
    await simulateClickInFrame(bulkFrame, 'Edit');
    await sleep(2000);
  }
  
  // Now we should be on the builder page
  // Dog Size should be active (dark). Let's verify and select options.
  
  console.log('\n=== Setting up Dog Size ===');
  
  // Click Dog Size attribute to make it active
  // The attribute tags are clickable - need to target the right one
  const dogSizeClicked = await bulkFrame.evaluate(() => {
    // Find the Dog Size tag in the attributes section
    // It could be a span inside a div/tag container
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.children.length === 0 || (el.children.length === 1 && el.children[0].tagName === 'SPAN')) {
        const text = el.textContent.trim();
        if (text === 'Dog Size x' || text === 'Dog Size') {
          // Simulate full click
          const rect = el.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const view = el.ownerDocument.defaultView;
          const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view };
          el.dispatchEvent(new PointerEvent('pointerdown', opts));
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          el.focus();
          el.dispatchEvent(new PointerEvent('pointerup', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
          try { el.click(); } catch (_) {}
          return { clicked: true, text, tag: el.tagName, y: rect.y };
        }
      }
    }
    return { clicked: false };
  });
  console.log('Dog Size click:', dogSizeClicked);
  await sleep(500);
  
  // Now select the size options using full event simulation
  // First deselect Coffee from Dog Size
  console.log('Deselecting Coffee...');
  let coffeeResult = await simulateClickInFrame(bulkFrame, 'Coffee');
  console.log('Coffee toggle:', coffeeResult);
  await sleep(300);
  
  // Also try removing from right panel
  await bulkFrame.evaluate(() => {
    // Find "Coffee x" in the right panel and click the x
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.textContent.trim() === 'x' || el.textContent.trim() === '×') {
        const parent = el.parentElement;
        if (parent && parent.textContent.trim().includes('Coffee')) {
          const rect = el.getBoundingClientRect();
          const view = el.ownerDocument.defaultView;
          const opts = { bubbles: true, cancelable: true, clientX: rect.x + rect.width/2, clientY: rect.y + rect.height/2, view };
          el.dispatchEvent(new PointerEvent('pointerdown', opts));
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          el.dispatchEvent(new PointerEvent('pointerup', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
          try { el.click(); } catch (_) {}
          return;
        }
      }
    }
  });
  await sleep(300);
  
  // Select sizes
  console.log('\nSelecting sizes...');
  for (const size of ['XS', 'S', 'M', 'L', 'XL']) {
    const result = await simulateClickInFrame(bulkFrame, size);
    console.log(`  ${size}: ${result}`);
    await sleep(300);
  }
  
  await sleep(500);
  await page.screenshot({ path: 'var-sizes3.png' });
  fs.copyFileSync('var-sizes3.png', '/Users/pyrite/.openclaw/workspace/var-sizes3.png');
  
  // Check right panel
  const rp = await bulkFrame.evaluate(() => {
    const text = document.body.innerText;
    const dsIdx = text.lastIndexOf('Dog Size');
    const cIdx = text.lastIndexOf('Colour');
    return text.substring(Math.min(dsIdx, cIdx), Math.max(dsIdx, cIdx) + 200).substring(0, 300);
  });
  console.log('\nRight panel:', rp);
  
  // Switch to Colour
  console.log('\n=== Setting up Colour ===');
  const colourClicked = await bulkFrame.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.children.length === 0 || (el.children.length === 1 && el.children[0].tagName === 'SPAN')) {
        const text = el.textContent.trim();
        if (text === 'Colour x' || text === 'Colour') {
          const rect = el.getBoundingClientRect();
          // Only click if it's in the attribute tags area (top of builder)
          if (rect.y > 100 && rect.y < 300) {
            const view = el.ownerDocument.defaultView;
            const opts = { bubbles: true, cancelable: true, clientX: rect.x + rect.width/2, clientY: rect.y + rect.height/2, view };
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.focus();
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            try { el.click(); } catch (_) {}
            return { clicked: true, y: rect.y };
          }
        }
      }
    }
    return { clicked: false };
  });
  console.log('Colour click:', colourClicked);
  await sleep(1000);
  
  // Check if colour options are showing
  const colourState = await bulkFrame.evaluate(() => {
    return document.body.innerText.includes('- Colour');
  });
  console.log('Colour active (has "- Colour"):', colourState);
  
  // Select Red, Black
  for (const color of ['Red', 'Black']) {
    const result = await simulateClickInFrame(bulkFrame, color);
    console.log(`  ${color}: ${result}`);
    await sleep(300);
  }
  
  // Add Coffee custom
  console.log('Adding Coffee custom...');
  const createOwn = await bulkFrame.evaluate(() => {
    const link = Array.from(document.querySelectorAll('a, button')).find(
      a => a.textContent.includes('Create your own') && a.offsetParent !== null
    );
    if (link) {
      const rect = link.getBoundingClientRect();
      const view = link.ownerDocument.defaultView;
      const opts = { bubbles: true, cancelable: true, clientX: rect.x + rect.width/2, clientY: rect.y + rect.height/2, view };
      link.dispatchEvent(new MouseEvent('click', opts));
      try { link.click(); } catch (_) {}
      return true;
    }
    return false;
  });
  console.log('Create your own:', createOwn);
  await sleep(500);
  
  // Type Coffee
  const input = await bulkFrame.$('#msku-custom-option-input');
  if (input) {
    await input.click();
    await input.type('Coffee', { delay: 30 });
    console.log('Typed Coffee');
    await sleep(200);
    
    // Click Add button
    await simulateClickInFrame(bulkFrame, 'Add');
    console.log('Clicked Add');
  }
  await sleep(500);
  
  // Final state check
  const finalRp = await bulkFrame.evaluate(() => {
    const text = document.body.innerText;
    return text.substring(text.indexOf('Attributes and options'), text.indexOf('Update') + 20).substring(0, 400);
  });
  console.log('\nFinal state:', finalRp);
  
  await page.screenshot({ path: 'var-final3.png' });
  fs.copyFileSync('var-final3.png', '/Users/pyrite/.openclaw/workspace/var-final3.png');
  
  browser.disconnect();
})().catch(e => console.error(e));
