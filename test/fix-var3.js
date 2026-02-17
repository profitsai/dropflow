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
  
  // The Colour attribute is currently active and showing options
  // I can see the standard colors: Beige, Black, Blue, Brown, Clear, Gold, Green, Grey, Multicoloured, Orange, Pink, Purple, Red, Silver, White, Yellow
  // And "Coffee" (custom) is already selected
  
  // Step 1: Click on Colour attribute tag to ensure it's selected
  console.log('1. Ensuring Colour attribute is active...');
  
  // The text shows "- Colour" which means Colour is the active attribute
  // Its options should be showing below
  
  // Let's get the exact DOM structure to understand the option buttons
  const optionInfo = await bulkFrame.evaluate(() => {
    // Find the options section
    const optionsLabel = Array.from(document.querySelectorAll('*')).find(
      el => el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 && el.textContent.trim() === 'Options'
    );
    
    if (!optionsLabel) return { error: 'no options label' };
    
    // Get the parent container and find all buttons
    let container = optionsLabel.parentElement;
    // Try going up a few levels to find all option buttons
    for (let i = 0; i < 5; i++) {
      const btns = container.querySelectorAll('button');
      if (btns.length > 5) {
        return {
          level: i,
          buttons: Array.from(btns).map(b => ({
            text: b.textContent.trim(),
            class: b.className.substring(0, 80),
            selected: b.className.includes('selected') || b.className.includes('active') || 
                      b.getAttribute('aria-pressed') === 'true'
          })).filter(b => b.text.length < 30 && !['Continue', 'Cancel', 'Save', '+ Add', 'Add', 'Update variations'].includes(b.text))
        };
      }
      container = container.parentElement;
    }
    
    return { error: 'no buttons found in options' };
  });
  
  console.log('Option buttons:', JSON.stringify(optionInfo, null, 2));
  
  // Step 2: Select Red, Black colours (Coffee already selected)
  console.log('\n2. Selecting colours: Red, Black...');
  
  // The options should be button-like elements. Let me click them by exact text
  for (const color of ['Red', 'Black']) {
    const result = await bulkFrame.evaluate((name) => {
      // Find buttons whose ONLY text content is the color name
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        // Skip if button has child elements with text (to avoid clicking parent containers)
        const directText = Array.from(b.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
        const innerText = b.textContent.trim();
        
        if (innerText === name || directText === name) {
          // Verify it's in the options area (not a navigation button)
          const rect = b.getBoundingClientRect();
          if (rect.y > 100 && rect.y < 500) { // Options area
            b.click();
            return { clicked: true, x: rect.x, y: rect.y };
          }
        }
      }
      return { clicked: false };
    }, color);
    console.log(`  ${color}: ${JSON.stringify(result)}`);
    await sleep(300);
  }
  
  await sleep(500);
  
  // Check what's selected in the right panel
  const rightPanel = await bulkFrame.evaluate(() => {
    const text = document.body.innerText;
    // Look for the summary section
    const lines = text.split('\n');
    const colourIdx = lines.findIndex(l => l.includes('Colour'));
    const sizeIdx = lines.findIndex(l => l.includes('Dog Size'));
    return { 
      colourLine: colourIdx >= 0 ? lines.slice(colourIdx, colourIdx + 3).join(' | ') : 'not found',
      sizeLine: sizeIdx >= 0 ? lines.slice(sizeIdx, sizeIdx + 3).join(' | ') : 'not found',
      selectedSection: text.match(/Attributes and options you've selected.*?(?:Update|Continue)/s)?.[0]?.substring(0, 300)
    };
  });
  console.log('\nRight panel:', rightPanel);
  
  await page.screenshot({ path: 'var-colours-clicked.png' });
  fs.copyFileSync('var-colours-clicked.png', '/Users/pyrite/.openclaw/workspace/var-colours-clicked.png');
  
  // Step 3: Switch to Dog Size attribute
  console.log('\n3. Switching to Dog Size...');
  await bulkFrame.evaluate(() => {
    // Find and click the Dog Size tag in the attributes area
    // It should be a tag/chip element
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      // Look for elements that contain only "Dog Size" text
      if (el.childNodes.length >= 1) {
        const text = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
        if (text === 'Dog Size' || text === 'Dog Size x') {
          el.click();
          return 'clicked exact';
        }
      }
    }
  });
  await sleep(1000);
  
  // Check what options are shown for Dog Size
  const sizeOptions = await bulkFrame.evaluate(() => {
    const text = document.body.innerText;
    // Find "- Dog Size" which means it's the active attribute
    if (text.includes('- Dog Size')) {
      return { active: true, bodySnippet: text.substring(text.indexOf('- Dog Size'), text.indexOf('- Dog Size') + 300) };
    }
    return { active: false, bodySnippet: text.substring(0, 500) };
  });
  console.log('Dog Size active:', sizeOptions.active);
  console.log('Snippet:', sizeOptions.bodySnippet);
  
  await page.screenshot({ path: 'var-dogsize-active.png' });
  fs.copyFileSync('var-dogsize-active.png', '/Users/pyrite/.openclaw/workspace/var-dogsize-active.png');
  
  // Select sizes: XS, S, M, L, XL
  console.log('\n4. Selecting sizes...');
  for (const size of ['XS', 'S', 'M', 'L', 'XL']) {
    const result = await bulkFrame.evaluate((name) => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === name) {
          const rect = b.getBoundingClientRect();
          if (rect.y > 100 && rect.y < 500) {
            b.click();
            return { clicked: true, y: rect.y };
          }
        }
      }
      return { clicked: false };
    }, size);
    console.log(`  ${size}: ${JSON.stringify(result)}`);
    await sleep(200);
  }
  
  await sleep(500);
  
  // Final check of right panel
  const finalCheck = await bulkFrame.evaluate(() => {
    return document.body.innerText;
  });
  
  // Extract the selected attributes summary
  const selectedStart = finalCheck.indexOf('Attributes and options you\'ve selected');
  const selectedEnd = finalCheck.indexOf('Update variations');
  if (selectedStart >= 0 && selectedEnd >= 0) {
    console.log('\nSelected attributes:', finalCheck.substring(selectedStart, selectedEnd));
  }
  
  await page.screenshot({ path: 'var-all-done.png' });
  fs.copyFileSync('var-all-done.png', '/Users/pyrite/.openclaw/workspace/var-all-done.png');
  
  // Click "Update variations" 
  console.log('\n5. Clicking Update variations...');
  await bulkFrame.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Update variations' && b.offsetParent !== null) {
        b.click();
        return;
      }
    }
  });
  await sleep(5000);
  
  await page.screenshot({ path: 'var-updated.png' });
  fs.copyFileSync('var-updated.png', '/Users/pyrite/.openclaw/workspace/var-updated.png');
  
  // Check the result
  const updateResult = await bulkFrame.evaluate(() => {
    return {
      text: document.body.innerText.substring(0, 2000),
      tables: document.querySelectorAll('table').length,
      rows: document.querySelectorAll('table tr').length,
      inputs: Array.from(document.querySelectorAll('input[id*="prc"], input[id*="qty"]')).map(i => ({
        id: i.id, value: i.value
      })).slice(0, 20)
    };
  }).catch(() => ({ error: 'frame error' }));
  
  console.log('\nUpdate result:', JSON.stringify(updateResult, null, 2).substring(0, 1000));
  
  browser.disconnect();
})().catch(e => console.error(e));
