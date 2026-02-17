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
  
  // First, let me understand the exact structure of option buttons
  const btnStructure = await bulkFrame.evaluate(() => {
    // Get all elements with class containing 'option' or 'tag'
    const optBtns = document.querySelectorAll('.msku-option-btn, [class*="option-btn"], [class*="msku-option"]');
    if (optBtns.length > 0) {
      return Array.from(optBtns).slice(0, 10).map(b => ({
        tagName: b.tagName,
        text: b.textContent.trim(),
        innerHtml: b.innerHTML.substring(0, 100),
        class: b.className.substring(0, 80),
        rect: b.getBoundingClientRect()
      }));
    }
    
    // Try broader - all faux-link buttons in the options area
    const allBtns = document.querySelectorAll('.faux-link, [class*="tag-btn"]');
    return { totalFauxLinks: allBtns.length, sample: Array.from(allBtns).slice(0, 5).map(b => ({
      tag: b.tagName, text: b.textContent.trim().substring(0, 30), 
      class: b.className.substring(0, 60), innerHTML: b.innerHTML.substring(0, 100)
    }))};
  });
  console.log('Button structure:', JSON.stringify(btnStructure, null, 2));
  
  // Let me try to find buttons using innerText matching more carefully
  const optionElements = await bulkFrame.evaluate(() => {
    const results = [];
    // Look for all elements that have short text matching size/color names
    const targets = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'Coffee', 'Red', 'Black'];
    
    for (const target of targets) {
      const xpath = `//button[normalize-space()="${target}"] | //span[normalize-space()="${target}"]/ancestor::button[1] | //a[normalize-space()="${target}"]`;
      const xr = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < xr.snapshotLength; i++) {
        const el = xr.snapshotItem(i);
        const rect = el.getBoundingClientRect();
        results.push({
          target,
          tag: el.tagName,
          text: el.textContent.trim(),
          class: (el.className || '').substring(0, 60),
          x: Math.round(rect.x), y: Math.round(rect.y),
          w: Math.round(rect.width), h: Math.round(rect.height)
        });
      }
    }
    return results;
  });
  
  console.log('\nOption elements found:');
  for (const el of optionElements) {
    console.log(`  ${el.target}: ${el.tag} "${el.text}" class="${el.class}" at ${el.x},${el.y} ${el.w}x${el.h}`);
  }
  
  // Now click sizes using coordinates - Dog Size is active
  console.log('\nClicking sizes by coordinates...');
  
  // First remove Coffee from Dog Size by clicking the "Coffee x" tag in right panel
  // or clicking Coffee in the options to deselect it
  const coffeeRemoved = await bulkFrame.evaluate(() => {
    // Find Coffee in the right panel's Dog Size section (has x button)
    const rightTags = document.querySelectorAll('[class*="selected"] button, [class*="summary"] button');
    for (const t of rightTags) {
      if (t.textContent.trim().includes('Coffee') && t.textContent.trim().includes('x')) {
        t.click();
        return 'clicked right panel';
      }
    }
    
    // Or click Coffee in options to deselect
    const xpath = '//button[normalize-space()="Coffee"]';
    const xr = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    if (xr.singleNodeValue) {
      xr.singleNodeValue.click();
      return 'clicked option toggle';
    }
    return 'not found';
  });
  console.log('Coffee removed:', coffeeRemoved);
  await sleep(300);
  
  // Now click each size option
  for (const size of ['XS', 'S', 'M', 'L', 'XL']) {
    const el = optionElements.find(e => e.target === size && e.y > 250 && e.y < 400);
    if (el) {
      await page.mouse.click(el.x + el.w/2, el.y + el.h/2);
      console.log(`  Clicked ${size} at ${el.x + el.w/2}, ${el.y + el.h/2}`);
    } else {
      // Try clicking in iframe using evaluate
      await bulkFrame.evaluate((name) => {
        const xpath = `//button[normalize-space()="${name}"]`;
        const xr = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (xr.singleNodeValue) xr.singleNodeValue.click();
      }, size);
      console.log(`  Clicked ${size} via xpath`);
    }
    await sleep(200);
  }
  
  await sleep(500);
  await page.screenshot({ path: 'var-sizes-selected2.png' });
  fs.copyFileSync('var-sizes-selected2.png', '/Users/pyrite/.openclaw/workspace/var-sizes-selected2.png');
  
  // Check right panel
  const rpState = await bulkFrame.evaluate(() => {
    return document.body.innerText.match(/Dog Size[\s\S]*?Colour[\s\S]*?(?:Update|Cancel)/)?.[0]?.substring(0, 200);
  });
  console.log('\nRight panel state:', rpState);
  
  // Now switch to Colour attribute
  console.log('\nSwitching to Colour...');
  await bulkFrame.evaluate(() => {
    // Click the Colour tag - it's the one that's NOT currently active (doesn't have dark background)
    const xpath = '//span[normalize-space()="Colour"]/ancestor::*[contains(@class,"tag") or contains(@class,"chip")][1] | //span[normalize-space()="Colour x"]/ancestor::*[1]';
    const xr = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    if (xr.singleNodeValue) {
      xr.singleNodeValue.click();
      return 'clicked';
    }
    // Broader - find any clickable with Colour text
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.textContent.trim() === 'Colour x' && el.querySelector) {
        el.click();
        return 'clicked broad';
      }
    }
  });
  await sleep(1000);
  
  // Check if Colour is now active  
  const colourActive = await bulkFrame.evaluate(() => {
    return document.body.innerText.includes('- Colour');
  });
  console.log('Colour active:', colourActive);
  
  await page.screenshot({ path: 'var-colour-active2.png' });
  fs.copyFileSync('var-colour-active2.png', '/Users/pyrite/.openclaw/workspace/var-colour-active2.png');
  
  // Get colour option positions
  const colourOpts = await bulkFrame.evaluate(() => {
    const results = [];
    const targets = ['Red', 'Black', 'Coffee', 'Beige', 'Blue', 'Brown'];
    for (const t of targets) {
      const xpath = `//button[normalize-space()="${t}"]`;
      const xr = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      if (xr.singleNodeValue) {
        const rect = xr.singleNodeValue.getBoundingClientRect();
        results.push({ name: t, x: rect.x, y: rect.y, w: rect.width, h: rect.height });
      }
    }
    return results;
  });
  console.log('Colour options:', colourOpts);
  
  // Remove Coffee from Colour (deselect) and select Red, Black
  // First deselect Coffee
  await bulkFrame.evaluate(() => {
    const xpath = '//button[normalize-space()="Coffee"]';
    const xr = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    if (xr.singleNodeValue) xr.singleNodeValue.click();
  });
  await sleep(200);
  
  // Select Red and Black  
  for (const color of ['Red', 'Black']) {
    await bulkFrame.evaluate((name) => {
      const xpath = `//button[normalize-space()="${name}"]`;
      const xr = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      if (xr.singleNodeValue) xr.singleNodeValue.click();
    }, color);
    console.log(`  Selected: ${color}`);
    await sleep(200);
  }
  
  // Add Coffee as custom  
  await bulkFrame.evaluate(() => {
    const xpath = '//a[contains(text(),"Create your own")]';
    const xr = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    if (xr.singleNodeValue) xr.singleNodeValue.click();
  });
  await sleep(300);
  
  await bulkFrame.evaluate(() => {
    const input = document.getElementById('msku-custom-option-input');
    if (input) {
      input.value = 'Coffee';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(200);
  
  // Click Add
  await bulkFrame.evaluate(() => {
    const xpath = '//button[normalize-space()="Add" and contains(@class, "msku-option-add")]';
    const xr = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    if (xr.singleNodeValue) xr.singleNodeValue.click();
  });
  await sleep(500);
  
  // Final status
  const finalState = await bulkFrame.evaluate(() => {
    const text = document.body.innerText;
    const match = text.match(/Dog Size\n(.*?)\nColour\n(.*?)(?:\n|$)/);
    return { 
      dogSize: match ? match[1] : 'not found',
      colour: match ? match[2] : 'not found',
      fullRightPanel: text.substring(text.indexOf('Dog Size'), text.indexOf('Update') || text.length).substring(0, 300)
    };
  });
  console.log('\nFinal state:', finalState);
  
  await page.screenshot({ path: 'var-final2.png' });
  fs.copyFileSync('var-final2.png', '/Users/pyrite/.openclaw/workspace/var-final2.png');
  
  browser.disconnect();
})().catch(e => console.error(e));
