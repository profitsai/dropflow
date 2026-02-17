const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  if (!ebay) { console.error('No eBay page'); process.exit(1); }
  
  const frames = ebay.frames();
  const bf = frames.find(f => f.url().includes('bulkedit'));
  if (!bf) { console.error('No bulkedit frame'); process.exit(1); }
  
  console.log('Found bulkedit frame');
  
  // Step 1: Understand current state better
  const state = await bf.evaluate(() => {
    const text = document.body.innerText;
    // Find all attribute tabs/buttons
    const tabs = [...document.querySelectorAll('[class*="tab"], [role="tab"], [class*="attribute"]')];
    const tabTexts = tabs.map(t => t.textContent.trim());
    
    // Find checkboxes and their labels
    const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')];
    const cbInfo = checkboxes.map(cb => {
      const label = cb.closest('label') || cb.parentElement;
      return { checked: cb.checked, text: label?.textContent?.trim()?.substring(0, 50) };
    });
    
    return { tabTexts: tabTexts.slice(0, 20), checkboxes: cbInfo };
  });
  console.log('State:', JSON.stringify(state, null, 2).substring(0, 1000));
  
  // Step 2: Click on "Dog Size" tab/attribute first
  console.log('\n=== Clicking Dog Size ===');
  const clickDogSize = await bf.evaluate(() => {
    // Find and click Dog Size
    const elements = document.querySelectorAll('*');
    for (const el of elements) {
      const text = el.textContent?.trim();
      if (text === 'Dog Size' && (el.tagName === 'SPAN' || el.tagName === 'DIV' || el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'LI')) {
        el.click();
        return 'clicked: ' + el.tagName;
      }
    }
    return 'not found';
  });
  console.log('Dog Size click:', clickDogSize);
  await sleep(1000);
  
  // Step 3: Get available size options and select them
  const sizeState = await bf.evaluate(() => {
    const text = document.body.innerText;
    const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')];
    return {
      text: text.substring(0, 1500),
      cbCount: checkboxes.length,
      cbLabels: checkboxes.map(cb => {
        const label = cb.closest('label') || cb.parentElement;
        return { checked: cb.checked, text: label?.textContent?.trim()?.substring(0, 30) };
      })
    };
  });
  console.log('After Dog Size click:', JSON.stringify(sizeState, null, 2).substring(0, 1500));
  
  // Step 4: Select all size options (XS, S, M, L, XL)
  console.log('\n=== Selecting sizes ===');
  const sizesToSelect = ['XS', 'S', 'M', 'L', 'XL'];
  for (const size of sizesToSelect) {
    const selected = await bf.evaluate((sizeVal) => {
      const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')];
      for (const cb of checkboxes) {
        const label = cb.closest('label') || cb.parentElement;
        const text = label?.textContent?.trim();
        if (text === sizeVal && !cb.checked) {
          cb.click();
          return 'selected: ' + text;
        } else if (text === sizeVal && cb.checked) {
          return 'already selected: ' + text;
        }
      }
      return 'not found: ' + sizeVal;
    }, size);
    console.log(selected);
  }
  
  await sleep(500);
  
  // Step 5: Now add Colour attribute
  // First check if there's a "Colour" attribute to click, or if we need to "Create your own"
  console.log('\n=== Adding Colour ===');
  
  // Check if Colour is available as a predefined attribute
  const addColour = await bf.evaluate(() => {
    // Look for Colour in the attributes section
    const elements = document.querySelectorAll('*');
    for (const el of elements) {
      const text = el.textContent?.trim();
      if ((text === 'Colour' || text === 'Color') && el.offsetParent !== null) {
        // Check if it's a clickable attribute
        if (el.tagName === 'SPAN' || el.tagName === 'DIV' || el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'LI') {
          el.click();
          return 'clicked existing: ' + text + ' (' + el.tagName + ')';
        }
      }
    }
    
    // Need to find "+ Add" button to add Colour attribute
    const addBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim().includes('+ Add') || b.textContent.trim() === 'Add');
    if (addBtn) {
      return 'found Add button: ' + addBtn.textContent.trim();
    }
    
    return 'neither Colour nor Add found';
  });
  console.log('Add Colour:', addColour);
  
  await sleep(1000);
  
  // Take screenshot to see current state
  await ebay.screenshot({ path: 'var-builder-state1.png' });
  
  // Get full builder text
  const builderText = await bf.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('\nBuilder text:', builderText.substring(0, 1500));
  
  browser.disconnect();
  console.log('\nDone');
})().catch(e => { console.error(e.message); process.exit(1); });
