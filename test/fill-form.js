const puppeteer = require('puppeteer-core');
const fs = require('fs');
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('/lstng') && p.url().includes('5051135836723'));
  
  if (!page) {
    console.log('Listing page not found');
    browser.disconnect();
    return;
  }
  
  await page.bringToFront();
  console.log('On listing form');
  
  // Check images status
  await page.screenshot({ path: 'form-current.png' });
  fs.copyFileSync('form-current.png', '/Users/pyrite/.openclaw/workspace/form-current.png');
  
  // Set title using evaluate (safer than clicking)
  console.log('Setting title...');
  await page.evaluate(() => {
    const title = 'Warm Fleece Dog Coat Hooded Waterproof Winter Pet Puppy Clothes Small Medium Dogs';
    const inputs = document.querySelectorAll('input, textarea');
    for (const inp of inputs) {
      const id = inp.id || '';
      if (id.includes('TITLE') || inp.value === 'Dog coat hoodie fleece') {
        const proto = inp.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(inp, title);
        else inp.value = title;
        inp.dispatchEvent(new Event('focus', { bubbles: true }));
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
        console.log('Title set on:', id);
        return true;
      }
    }
    return false;
  });
  await sleep(1000);
  
  // Click item specific suggestion buttons
  console.log('Setting item specifics...');
  const specifics = ['Unbranded', 'Hoodie', 'Fleece', 'Unisex'];
  for (const spec of specifics) {
    await page.evaluate((text) => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === text && b.offsetParent !== null) {
          b.click();
          return true;
        }
      }
      return false;
    }, spec);
    console.log(`  Clicked: ${spec}`);
    await sleep(500);
  }
  
  // Set price - find the Buy It Now price input
  console.log('Setting price...');
  await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    for (const inp of inputs) {
      const id = inp.id || '';
      // The price input typically has PRICE in the id but not paymentPolicy or shipping
      if (id.includes('PRICE') && !id.includes('payment') && !id.includes('shipping') && !id.includes('switch') && !id.includes('se-textbox')) {
        // Look for the main price input - usually has a numeric type or placeholder with $
        const parent = inp.closest('[class*="price"]');
        if (parent || inp.type === 'text') {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(inp, '24.99');
          else inp.value = '24.99';
          inp.dispatchEvent(new Event('focus', { bubbles: true }));
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          inp.dispatchEvent(new Event('blur', { bubbles: true }));
          console.log('Price set on:', id);
          return true;
        }
      }
    }
    return false;
  });
  await sleep(1000);
  
  // Set quantity
  console.log('Setting quantity...');
  await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    for (const inp of inputs) {
      const id = inp.id || '';
      if (id.toLowerCase().includes('quantity') || id.toLowerCase().includes('qty')) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(inp, '10');
        else inp.value = '10';
        inp.dispatchEvent(new Event('focus', { bubbles: true }));
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      }
    }
    return false;
  });
  await sleep(500);
  
  // Now look for the variations link/button
  console.log('\nLooking for variation controls...');
  
  // Scroll through the entire page to find variation-related content
  for (let scrollY = 0; scrollY < 5000; scrollY += 800) {
    await page.evaluate(y => window.scrollTo(0, y), scrollY);
    await sleep(200);
  }
  
  const varInfo = await page.evaluate(() => {
    const text = document.body.innerText;
    const results = { 
      hasVariation: false, 
      variationButtons: [],
      allSections: []
    };
    
    // Check for variation section
    if (text.includes('ariation')) results.hasVariation = true;
    
    // Find all section headers
    const headers = document.querySelectorAll('h2, h3, [class*="section-title"], legend');
    headers.forEach(h => {
      const t = h.textContent.trim();
      if (t.length > 1 && t.length < 80) results.allSections.push(t);
    });
    
    // Find variation button/link
    const allEls = document.querySelectorAll('button, a, [role="button"], [role="link"]');
    for (const el of allEls) {
      const t = el.textContent.trim();
      if (t.toLowerCase().includes('variation') || t.toLowerCase().includes('add option')) {
        results.variationButtons.push({
          text: t.substring(0, 80),
          tag: el.tagName,
          href: el.href || '',
          visible: el.offsetParent !== null
        });
      }
    }
    
    return results;
  });
  
  console.log('Has variation text:', varInfo.hasVariation);
  console.log('Sections:', varInfo.allSections);
  console.log('Variation buttons:', varInfo.variationButtons);
  
  // Take full page screenshots (top and bottom)
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await page.screenshot({ path: 'form-top.png' });
  fs.copyFileSync('form-top.png', '/Users/pyrite/.openclaw/workspace/form-top.png');
  
  await page.evaluate(() => window.scrollTo(0, 1500));
  await sleep(500);
  await page.screenshot({ path: 'form-middle.png' });
  fs.copyFileSync('form-middle.png', '/Users/pyrite/.openclaw/workspace/form-middle.png');
  
  await page.evaluate(() => window.scrollTo(0, 3000));
  await sleep(500);
  await page.screenshot({ path: 'form-bottom.png' });
  fs.copyFileSync('form-bottom.png', '/Users/pyrite/.openclaw/workspace/form-bottom.png');
  
  browser.disconnect();
})().catch(e => console.error(e));
