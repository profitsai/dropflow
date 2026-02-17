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
  
  const iframeOffset = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="bulkedit"]');
    const rect = iframe.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  
  async function clickInFrame(text) {
    const pos = await bulkFrame.evaluate((txt) => {
      const els = document.querySelectorAll('button, a, li, span');
      for (const el of els) {
        if (el.textContent.trim() === txt && el.offsetParent !== null) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0) return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
        }
      }
      return null;
    }, text);
    if (!pos) return false;
    await page.mouse.click(iframeOffset.x + pos.x, iframeOffset.y + pos.y);
    return true;
  }
  
  // Scroll down to see the variation table
  console.log('Scrolling to variation table...');
  await bulkFrame.evaluate(() => {
    const table = document.querySelector('table');
    if (table) table.scrollIntoView({ block: 'start' });
  });
  await sleep(1000);
  
  // Click "Enter price" to set bulk price
  console.log('1. Setting price for all variations...');
  await clickInFrame('Enter price');
  await sleep(1000);
  
  // Check for price input
  const priceInputState = await bulkFrame.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    for (const inp of inputs) {
      if (inp.offsetParent !== null && (inp.id.includes('prc') || inp.placeholder?.includes('price'))) {
        const rect = inp.getBoundingClientRect();
        return { id: inp.id, x: rect.x + rect.width/2, y: rect.y + rect.height/2, value: inp.value };
      }
    }
    return null;
  });
  
  console.log('Price input:', priceInputState);
  
  if (priceInputState) {
    await page.mouse.click(iframeOffset.x + priceInputState.x, iframeOffset.y + priceInputState.y);
    await sleep(200);
    // Select all and type new price
    await page.keyboard.down('Meta');
    await page.keyboard.press('a');
    await page.keyboard.up('Meta');
    await page.keyboard.type('24.99', { delay: 20 });
    console.log('Typed price: 24.99');
    await sleep(200);
    
    // Click Save button for the price
    await clickInFrame('Save');
    await sleep(1000);
  }
  
  await page.screenshot({ path: 'var-price-set.png' });
  
  // Click "Enter quantity" to set bulk quantity
  console.log('\n2. Setting quantity for all variations...');
  await clickInFrame('Enter quantity');
  await sleep(1000);
  
  const qtyInputState = await bulkFrame.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    for (const inp of inputs) {
      if (inp.offsetParent !== null && (inp.id.includes('qty') || inp.placeholder?.includes('quantity'))) {
        const rect = inp.getBoundingClientRect();
        return { id: inp.id, x: rect.x + rect.width/2, y: rect.y + rect.height/2, value: inp.value };
      }
    }
    return null;
  });
  
  console.log('Qty input:', qtyInputState);
  
  if (qtyInputState) {
    await page.mouse.click(iframeOffset.x + qtyInputState.x, iframeOffset.y + qtyInputState.y);
    await sleep(200);
    await page.keyboard.down('Meta');
    await page.keyboard.press('a');
    await page.keyboard.up('Meta');
    await page.keyboard.type('5', { delay: 20 });
    console.log('Typed quantity: 5');
    await sleep(200);
    
    await clickInFrame('Save');
    await sleep(1000);
  }
  
  await page.screenshot({ path: 'var-qty-set.png' });
  
  // Click "Save and close" to close the variation editor and go back to main form
  console.log('\n3. Clicking Save and close...');
  
  // First scroll down to see Save and close button
  await bulkFrame.evaluate(() => window.scrollTo(0, 99999));
  await sleep(500);
  
  const saved = await clickInFrame('Save and close');
  console.log('Save and close clicked:', saved);
  await sleep(5000);
  
  // Check if we're back on the main listing form
  const url = page.url();
  console.log('URL after save:', url);
  
  // Take screenshot of main form
  await page.screenshot({ path: 'after-var-save.png' });
  fs.copyFileSync('after-var-save.png', '/Users/pyrite/.openclaw/workspace/after-var-save.png');
  
  // Check the form state
  const formState = await page.evaluate(() => {
    return {
      text: document.body.innerText.substring(0, 500),
      hasVariations: document.body.innerText.includes('15 variations') || document.body.innerText.includes('Variation')
    };
  });
  console.log('Form has variations:', formState.hasVariations);
  console.log('Form text:', formState.text.substring(0, 300));
  
  browser.disconnect();
})().catch(e => console.error(e));
