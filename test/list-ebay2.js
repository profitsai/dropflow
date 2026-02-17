const puppeteer = require('puppeteer-core');
const fs = require('fs');

const product = JSON.parse(fs.readFileSync('product-data.json', 'utf8'));
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const page = await browser.newPage();
  
  console.log('Step 1: Navigate to prelist page...');
  await page.goto('https://www.ebay.com.au/sl/prelist/suggest', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);
  
  // Type the title
  const inputSel = 'input[placeholder*="Tell us"]';
  await page.waitForSelector(inputSel, { timeout: 10000 });
  await page.click(inputSel);
  await sleep(300);
  await page.type(inputSel, 'Dog coat hoodie waterproof fleece winter pet clothes', { delay: 20 });
  await sleep(500);
  
  // Click the search button (the blue magnifying glass)
  // It's a button with an SVG icon
  const clicked = await page.evaluate(() => {
    // Find the search button - it should be near the input
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      const svg = b.querySelector('svg');
      const rect = b.getBoundingClientRect();
      // The search button should be visible and have an SVG (magnifying glass)
      if (svg && rect.width > 0 && rect.height > 0) {
        console.log('Found search button:', b.className, rect.x, rect.y);
        b.click();
        return `clicked: ${b.className} at ${rect.x},${rect.y}`;
      }
    }
    return 'no button found';
  });
  console.log('Button click result:', clicked);
  
  // Also try keyboard Enter
  await page.keyboard.press('Enter');
  
  await sleep(5000);
  console.log('After search URL:', page.url());
  await page.screenshot({ path: 'ebay-after-search.png' });
  
  // Check if we're on identify page
  if (page.url().includes('/identify')) {
    console.log('\nStep 2: On identify page...');
    await sleep(2000);
    
    // Get page state
    const state = await page.evaluate(() => {
      return document.body.innerText.substring(0, 2000);
    });
    console.log('Page text:', state.substring(0, 1000));
    
    // Look for category options and "Continue without a product match"
    const actions = await page.evaluate(() => {
      // Try to find radio buttons or category links
      const results = [];
      
      // Check for condition dropdown
      const conditionBtns = document.querySelectorAll('[data-testid*="condition"], [class*="condition"]');
      conditionBtns.forEach(b => results.push('condition: ' + b.textContent.trim().substring(0, 50)));
      
      // Check for product matches
      const matches = document.querySelectorAll('[class*="product-match"], [class*="catalog-match"]');
      matches.forEach(m => results.push('match: ' + m.textContent.trim().substring(0, 80)));
      
      // All links
      const links = document.querySelectorAll('a');
      links.forEach(l => {
        if (l.textContent.includes('without') || l.textContent.includes('Continue')) {
          results.push('link: ' + l.textContent.trim() + ' href=' + l.href);
        }
      });
      
      // All buttons with text
      const btns = document.querySelectorAll('button');
      btns.forEach(b => {
        const t = b.textContent.trim();
        if (t && t.length > 1 && t.length < 80) results.push('btn: ' + t + (b.disabled ? ' [disabled]' : ''));
      });
      
      return results;
    });
    
    console.log('Available actions:', actions);
    
    // Try to click "Continue without product match" or select a category
    const continueResult = await page.evaluate(() => {
      // First try: "Continue without match" link/button
      const btns = document.querySelectorAll('button, a');
      for (const b of btns) {
        const t = b.textContent.trim().toLowerCase();
        if (t.includes('continue without') || t.includes('without a match') || t.includes('without product')) {
          b.click();
          return 'clicked: ' + t;
        }
      }
      
      // Second try: Select "New" condition and click Continue
      const newBtns = document.querySelectorAll('[data-testid*="NEW"], input[value*="NEW"]');
      for (const b of newBtns) {
        b.click();
        return 'selected NEW';
      }
      
      // Third try: any Continue button
      for (const b of btns) {
        const t = b.textContent.trim().toLowerCase();
        if (t === 'continue' && !b.disabled) {
          b.click();
          return 'clicked continue';
        }
      }
      
      return 'no action';
    });
    
    console.log('Continue result:', continueResult);
    await sleep(5000);
    console.log('After continue URL:', page.url());
    await page.screenshot({ path: 'ebay-after-identify.png' });
  }
  
  // Handle any remaining intermediate pages
  for (let i = 0; i < 5; i++) {
    const url = page.url();
    if (url.includes('/lstng')) break;
    
    console.log(`\nIntermediate page: ${url}`);
    
    // Auto-click continue/next
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button, a');
      for (const b of btns) {
        const t = b.textContent.trim().toLowerCase();
        if ((t.includes('continue') || t.includes('get started') || t.includes('list it')) && !b.disabled) {
          b.click();
          return;
        }
      }
      // Click first radio if any
      const radio = document.querySelector('input[type="radio"]');
      if (radio) radio.click();
    });
    
    await sleep(5000);
    await page.screenshot({ path: `ebay-nav-${i}.png` });
  }
  
  console.log('\nFinal URL:', page.url());
  
  if (page.url().includes('/lstng')) {
    console.log('\n=== REACHED LISTING FORM! ===');
    await page.screenshot({ path: 'ebay-listing-form.png', fullPage: false });
    
    // Save the draft ID for later
    const draftMatch = page.url().match(/draftId=(\d+)/);
    if (draftMatch) {
      console.log('Draft ID:', draftMatch[1]);
      fs.writeFileSync('draft-id.txt', draftMatch[1]);
    }
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
