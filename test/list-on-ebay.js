const puppeteer = require('puppeteer-core');
const fs = require('fs');

const product = JSON.parse(fs.readFileSync('product-data.json', 'utf8'));

// Helper: type into an input with proper event simulation for Marko/React
async function typeIntoInput(page, selector, text) {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.click(selector, { clickCount: 3 }); // Select all
  await page.keyboard.press('Backspace');
  await page.type(selector, text, { delay: 30 });
}

// Helper: simulate realistic click with coordinates
async function realisticClick(page, selector) {
  const el = await page.$(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  const box = await el.boundingBox();
  if (!box) throw new Error(`No bounding box for: ${selector}`);
  await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  // Open a new tab for the eBay listing
  const page = await browser.newPage();
  
  console.log('Step 1: Navigate to eBay listing page...');
  await page.goto('https://www.ebay.com.au/sl/prelist/suggest', { 
    waitUntil: 'networkidle2', 
    timeout: 30000 
  });
  await sleep(3000);
  await page.screenshot({ path: 'ebay-step1.png' });
  
  // Check what's on the page
  const pageState = await page.evaluate(() => {
    return {
      url: location.href,
      title: document.title,
      inputs: Array.from(document.querySelectorAll('input, textarea')).map(el => ({
        type: el.type, id: el.id, placeholder: el.placeholder, name: el.name,
        ariaLabel: el.getAttribute('aria-label')
      })),
      buttons: Array.from(document.querySelectorAll('button')).map(el => ({
        text: el.textContent.trim().substring(0, 50), id: el.id
      }))
    };
  });
  
  console.log('Page URL:', pageState.url);
  console.log('Inputs:', JSON.stringify(pageState.inputs));
  console.log('Buttons:', pageState.buttons.map(b => b.text).join(', '));
  
  // Find the search/title input
  const searchInput = await page.$('input[type="text"], input[placeholder*="tell"], input[placeholder*="search"], input[aria-label*="Tell"], textarea');
  
  if (searchInput) {
    console.log('\nStep 2: Enter product title...');
    await searchInput.click();
    await sleep(500);
    await searchInput.type(product.ebayTitle, { delay: 20 });
    await sleep(1000);
    await page.screenshot({ path: 'ebay-step2.png' });
    
    // Look for search/continue button
    const searchBtn = await page.$('button[type="submit"], button:not([disabled])');
    if (searchBtn) {
      const btnText = await page.evaluate(el => el.textContent.trim(), searchBtn);
      console.log(`Clicking button: "${btnText}"`);
      await searchBtn.click();
    } else {
      console.log('No search button found, pressing Enter');
      await page.keyboard.press('Enter');
    }
    
    await sleep(5000);
    await page.screenshot({ path: 'ebay-step3.png' });
    console.log('After submit URL:', page.url());
  }
  
  // Now we should be on the identify page or listing form
  // Handle the identify/category selection page
  if (page.url().includes('/sl/prelist/identify') || page.url().includes('/sl/prelist')) {
    console.log('\nStep 3: Category identification page...');
    
    // Wait for category suggestions to load
    await sleep(3000);
    
    const identifyState = await page.evaluate(() => {
      const radios = document.querySelectorAll('input[type="radio"], [role="radio"]');
      const options = [];
      radios.forEach(r => {
        const label = r.closest('label') || r.parentElement;
        options.push(label ? label.textContent.trim().substring(0, 100) : r.value);
      });
      
      // Also check for buttons that act as category selectors
      const categoryBtns = document.querySelectorAll('button[class*="category"], [class*="suggestion"] button, [data-testid*="category"]');
      const catTexts = Array.from(categoryBtns).map(b => b.textContent.trim().substring(0, 100));
      
      // Check for "Continue without match" or similar
      const allBtns = Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim().substring(0, 80),
        disabled: b.disabled
      }));
      
      return { radioOptions: options, categoryBtns: catTexts, allBtns, bodySnippet: document.body.innerText.substring(0, 1000) };
    });
    
    console.log('Radio options:', identifyState.radioOptions);
    console.log('Category buttons:', identifyState.categoryBtns);
    console.log('All buttons:', identifyState.allBtns.map(b => `${b.text}${b.disabled ? ' (disabled)' : ''}`).join(', '));
    console.log('Body:', identifyState.bodySnippet.substring(0, 500));
    
    // Try to select first radio/option and click Continue
    const firstRadio = await page.$('input[type="radio"], [role="radio"]');
    if (firstRadio) {
      await firstRadio.click();
      await sleep(1000);
    }
    
    // Look for Continue button
    const continueBtn = await page.evaluateHandle(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        const t = b.textContent.trim().toLowerCase();
        if ((t.includes('continue') || t.includes('next') || t === 'get started') && !b.disabled) {
          return b;
        }
      }
      return null;
    });
    
    if (continueBtn && continueBtn.asElement()) {
      const btnText = await page.evaluate(el => el.textContent.trim(), continueBtn);
      console.log(`Clicking: "${btnText}"`);
      await continueBtn.asElement().click();
      await sleep(5000);
      await page.screenshot({ path: 'ebay-step4.png' });
      console.log('After continue URL:', page.url());
    }
  }
  
  // Keep going through any intermediate pages
  for (let attempt = 0; attempt < 5; attempt++) {
    const url = page.url();
    if (url.includes('/lstng')) {
      console.log('\n=== REACHED LISTING FORM ===');
      break;
    }
    
    console.log(`\nIntermediate page (attempt ${attempt+1}): ${url}`);
    await page.screenshot({ path: `ebay-intermediate-${attempt}.png` });
    
    // Try to find and click continue/next buttons
    const nextAction = await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        const t = b.textContent.trim().toLowerCase();
        if ((t.includes('continue') || t.includes('next') || t.includes('get started') || 
             t.includes('list it') || t === 'start listing') && !b.disabled) {
          b.click();
          return t;
        }
      }
      
      // Try clicking first radio if present
      const radio = document.querySelector('input[type="radio"], [role="radio"]');
      if (radio) { radio.click(); return 'clicked radio'; }
      
      // Try "Continue without match"
      for (const b of btns) {
        if (b.textContent.includes('without') && !b.disabled) {
          b.click();
          return 'without match';
        }
      }
      
      return null;
    });
    
    console.log(`Action taken: ${nextAction}`);
    await sleep(3000);
    
    if (!nextAction) {
      // If no button found, try submitting form or pressing Enter
      await page.keyboard.press('Enter');
      await sleep(3000);
    }
  }
  
  // Now on listing form page
  if (page.url().includes('/lstng')) {
    console.log('\nStep 5: On listing form, taking screenshot...');
    await page.screenshot({ path: 'ebay-listing-form.png', fullPage: false });
    
    // Analyze the form
    const formState = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(el => ({
        type: el.type || el.tagName.toLowerCase(),
        id: el.id,
        name: el.name,
        placeholder: el.placeholder,
        ariaLabel: el.getAttribute('aria-label'),
        value: el.value?.substring(0, 50),
        closest: el.closest('[class*="field"], [class*="section"]')?.className?.substring(0, 80)
      }));
      return { url: location.href, inputs, bodyLength: document.body.innerText.length };
    });
    
    console.log(`Form inputs: ${formState.inputs.length}`);
    for (const inp of formState.inputs) {
      if (inp.id || inp.ariaLabel || inp.placeholder) {
        console.log(`  ${inp.type} | id=${inp.id} | label=${inp.ariaLabel} | ph=${inp.placeholder} | val=${inp.value}`);
      }
    }
  } else {
    console.log('Did not reach listing form. Current URL:', page.url());
    await page.screenshot({ path: 'ebay-stuck.png', fullPage: true });
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
