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
  
  // Step 1: Check "Colour" checkbox in the popup and click Save
  console.log('1. Checking Colour checkbox...');
  await bulkFrame.evaluate(() => {
    const cb = document.getElementById('msku-parent-tag-checkbox-2'); // Colour
    if (cb && !cb.checked) cb.click();
  });
  await sleep(500);
  
  // Click Save
  await bulkFrame.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Save') { b.click(); return; }
    }
  });
  await sleep(1000);
  
  await page.screenshot({ path: 'var-after-save.png' });
  fs.copyFileSync('var-after-save.png', '/Users/pyrite/.openclaw/workspace/var-after-save.png');
  
  // Step 2: Click on "Dog Size" attribute tab and select sizes
  console.log('2. Selecting Dog Size options...');
  await bulkFrame.evaluate(() => {
    // Click Dog Size attribute tag
    const spans = document.querySelectorAll('span, button, div');
    for (const s of spans) {
      if (s.textContent.trim() === 'Dog Size' || s.textContent.trim() === 'Dog Size x') {
        s.click(); return;
      }
    }
  });
  await sleep(500);
  
  // Select sizes
  for (const size of ['XS', 'S', 'M', 'L', 'XL']) {
    const clicked = await bulkFrame.evaluate((name) => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === name && !b.classList.contains('selected')) {
          b.click(); return true;
        }
      }
      return false;
    }, size);
    console.log(`  ${size}: ${clicked ? 'clicked' : 'already selected or not found'}`);
    await sleep(200);
  }
  await sleep(500);
  
  // Step 3: Click on "Colour" attribute tab
  console.log('\n3. Switching to Colour attribute...');
  await bulkFrame.evaluate(() => {
    const spans = document.querySelectorAll('span, button, div');
    for (const s of spans) {
      const t = s.textContent.trim();
      if (t === 'Colour' || t === 'Colour x') {
        s.click(); return true;
      }
    }
    return false;
  });
  await sleep(1000);
  
  // Check what options are available
  const optState = await bulkFrame.evaluate(() => {
    return {
      text: document.body.innerText.substring(0, 1500),
      buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t && t.length < 30)
    };
  });
  console.log('Available buttons:', optState.buttons);
  
  await page.screenshot({ path: 'var-colour-tab.png' });
  fs.copyFileSync('var-colour-tab.png', '/Users/pyrite/.openclaw/workspace/var-colour-tab.png');
  
  // Select Red, Black and create Coffee
  for (const color of ['Red', 'Black']) {
    const clicked = await bulkFrame.evaluate((name) => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === name) { b.click(); return true; }
      }
      return false;
    }, color);
    console.log(`  ${color}: ${clicked ? 'clicked' : 'not found'}`);
    await sleep(300);
  }
  
  // Create Coffee custom option
  console.log('  Creating Coffee custom option...');
  await bulkFrame.evaluate(() => {
    const links = document.querySelectorAll('a, button');
    for (const l of links) {
      if (l.textContent.includes('Create your own')) { l.click(); return; }
    }
  });
  await sleep(500);
  
  // Type in the custom input
  await bulkFrame.evaluate(() => {
    const input = document.getElementById('msku-custom-option-input');
    if (input) {
      input.value = 'Coffee';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(200);
  
  // Click Add button
  await bulkFrame.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Add') { b.click(); return; }
    }
  });
  await sleep(500);
  
  await page.screenshot({ path: 'var-all-selected.png' });
  fs.copyFileSync('var-all-selected.png', '/Users/pyrite/.openclaw/workspace/var-all-selected.png');
  
  // Check the right panel
  const rightPanel = await bulkFrame.evaluate(() => {
    return document.body.innerText.substring(0, 2000);
  });
  console.log('\nFull page text:', rightPanel.substring(0, 600));
  
  // Step 4: Click Continue
  console.log('\n4. Clicking Continue...');
  const contResult = await bulkFrame.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Continue' && b.offsetParent !== null) {
        const disabled = b.disabled || b.classList.contains('disabled');
        if (!disabled) { b.click(); return 'clicked'; }
        return 'disabled';
      }
    }
    return 'not found';
  });
  console.log('Continue result:', contResult);
  await sleep(5000);
  
  await page.screenshot({ path: 'var-next-page.png' });
  fs.copyFileSync('var-next-page.png', '/Users/pyrite/.openclaw/workspace/var-next-page.png');
  
  // Check what's on the next page
  const nextPage = await bulkFrame.evaluate(() => {
    return {
      text: document.body.innerText.substring(0, 2000),
      inputs: Array.from(document.querySelectorAll('input[type="text"], input[type="number"]')).slice(0, 20).map(i => ({
        id: (i.id || '').substring(0, 40),
        placeholder: i.placeholder,
        value: i.value
      })),
      tables: document.querySelectorAll('table').length
    };
  }).catch(() => ({ error: 'frame navigated' }));
  
  console.log('Next page:', JSON.stringify(nextPage, null, 2).substring(0, 1000));
  
  browser.disconnect();
})().catch(e => console.error(e));
