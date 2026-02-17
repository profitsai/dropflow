const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Download image to local file
async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImage(res.headers.location, filepath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const ws = fs.createWriteStream(filepath);
      res.pipe(ws);
      ws.on('finish', () => { ws.close(); resolve(filepath); });
      ws.on('error', reject);
    }).on('error', reject);
  });
}

// Set value using native property setter (for React/Marko inputs)
async function setInputValue(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                         Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, val);
    else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }, selector, value);
}

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('/lstng'));
  
  if (!page) {
    console.log('No listing form page found!');
    browser.disconnect();
    return;
  }
  
  await page.bringToFront();
  console.log('On listing form:', page.url());
  
  // ========== 1. DOWNLOAD & UPLOAD IMAGES ==========
  console.log('\n=== STEP 1: Upload Images ===');
  
  const imageUrls = [
    'https://ae-pic-a1.aliexpress-media.com/kf/S1cf750c0a3554bbdae157dd2c4d92e26C.jpg',
    'https://ae-pic-a1.aliexpress-media.com/kf/Sc5bfa0e7793d4562a3ffe0bbe3a661166.jpg',
    'https://ae-pic-a1.aliexpress-media.com/kf/Sf7831f8ffa854eccbd953391af468128t.jpg',
    'https://ae-pic-a1.aliexpress-media.com/kf/Sfcb676f3b6ab4f6baf6d5e5e013627ddz.jpg',
    'https://ae-pic-a1.aliexpress-media.com/kf/S84f2d74dd2a742f4904f212aa53aad77H.jpg',
    'https://ae-pic-a1.aliexpress-media.com/kf/Se33197e157b04d5485f24224fa4601e8H.jpg'
  ];
  
  const imgDir = path.join(__dirname, 'images');
  fs.mkdirSync(imgDir, { recursive: true });
  
  const localPaths = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const localPath = path.join(imgDir, `product-${i}.jpg`);
    try {
      await downloadImage(imageUrls[i], localPath);
      // Verify file exists and has content
      const stats = fs.statSync(localPath);
      if (stats.size > 1000) {
        localPaths.push(localPath);
        console.log(`Downloaded image ${i}: ${stats.size} bytes`);
      } else {
        console.log(`Image ${i} too small: ${stats.size} bytes`);
      }
    } catch (e) {
      console.log(`Failed to download image ${i}: ${e.message}`);
    }
  }
  
  if (localPaths.length > 0) {
    // Upload via file input
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.uploadFile(...localPaths);
      console.log(`Uploaded ${localPaths.length} images via file input`);
      await sleep(5000); // Wait for upload to process
    } else {
      console.log('No file input found for image upload');
    }
  }
  
  await page.screenshot({ path: 'after-images.png' });
  fs.copyFileSync('after-images.png', '/Users/pyrite/.openclaw/workspace/after-images.png');
  
  // ========== 2. SET TITLE ==========
  console.log('\n=== STEP 2: Set Title ===');
  const title = 'Warm Fleece Dog Coat Hooded Waterproof Winter Pet Puppy Clothes Small Medium Dogs';
  
  // Find title input
  const titleInput = await page.$('input[id*="TITLE"], input[aria-label*="title"], textarea[id*="TITLE"]');
  if (titleInput) {
    await titleInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await sleep(200);
    await titleInput.type(title, { delay: 10 });
    console.log('Title set');
  } else {
    // Try by evaluating
    await page.evaluate((t) => {
      const inputs = document.querySelectorAll('input, textarea');
      for (const inp of inputs) {
        if (inp.value === 'Dog coat hoodie fleece' || (inp.id || '').includes('TITLE')) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(inp, t);
          else inp.value = t;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          inp.dispatchEvent(new Event('blur', { bubbles: true }));
          return;
        }
      }
    }, title);
    console.log('Title set via evaluate');
  }
  
  await sleep(1000);
  
  // ========== 3. ITEM SPECIFICS ==========
  console.log('\n=== STEP 3: Set Item Specifics ===');
  
  // Click suggested values for item specifics
  // From the buttons we saw: Brand=Unbranded, Type=Hoodie, Size=S, Colour=Multicoloured, Material=Fleece, Gender=Unisex
  const specificsToClick = ['Unbranded', 'Hoodie', 'Fleece', 'Unisex'];
  
  for (const spec of specificsToClick) {
    const clicked = await page.evaluate((text) => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === text) {
          b.click();
          return true;
        }
      }
      return false;
    }, spec);
    if (clicked) console.log(`  Selected: ${spec}`);
    else console.log(`  Not found: ${spec}`);
    await sleep(500);
  }
  
  // ========== 4. SET PRICE ==========
  console.log('\n=== STEP 4: Set Price ===');
  
  // Find price input
  const priceSet = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    for (const inp of inputs) {
      const label = inp.getAttribute('aria-label') || '';
      const id = inp.id || '';
      if (label.toLowerCase().includes('price') || id.includes('PRICE') || id.includes('price')) {
        // Check if it's the main price input (not shipping etc)
        if (id.includes('paymentPolicy') || id.includes('shipping')) continue;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(inp, '24.99');
        else inp.value = '24.99';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
        return id;
      }
    }
    return null;
  });
  console.log('Price input:', priceSet);
  
  await sleep(1000);
  await page.screenshot({ path: 'after-basics.png' });
  fs.copyFileSync('after-basics.png', '/Users/pyrite/.openclaw/workspace/after-basics.png');
  
  // ========== 5. LOOK FOR VARIATIONS OPTION ==========
  console.log('\n=== STEP 5: Check for Variations ===');
  
  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasVariation = bodyText.includes('variation') || bodyText.includes('Variation') || bodyText.includes('VARIATION');
  console.log('Has variation text:', hasVariation);
  
  // Look for variation-related buttons/links
  const varElements = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('button, a, [role="button"]');
    for (const el of allEls) {
      const t = el.textContent.trim().toLowerCase();
      if (t.includes('variation') || t.includes('add variation')) {
        results.push({text: el.textContent.trim(), tag: el.tagName, class: el.className?.substring(0, 50)});
      }
    }
    // Also check for any dropdown about listing format
    const selects = document.querySelectorAll('select');
    selects.forEach(s => {
      const opts = Array.from(s.options).map(o => o.text);
      if (opts.some(o => o.toLowerCase().includes('variation'))) {
        results.push({text: opts.join(', '), tag: 'select', id: s.id});
      }
    });
    return results;
  });
  
  console.log('Variation elements:', varElements);
  
  // Scroll down to see full form
  await page.evaluate(() => window.scrollBy(0, 2000));
  await sleep(1000);
  await page.screenshot({ path: 'listing-bottom.png' });
  fs.copyFileSync('listing-bottom.png', '/Users/pyrite/.openclaw/workspace/listing-bottom.png');
  
  // Check the full form for variation setup
  const fullFormInfo = await page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n').filter(l => l.trim());
    const relevant = lines.filter(l => 
      l.toLowerCase().includes('variation') ||
      l.toLowerCase().includes('format') ||
      l.toLowerCase().includes('quantity') ||
      l.toLowerCase().includes('sku')
    );
    return relevant;
  });
  console.log('Relevant form lines:', fullFormInfo);
  
  console.log('\n=== CURRENT STATE SUMMARY ===');
  console.log('URL:', page.url());
  console.log('Images uploaded:', localPaths.length);
  
  browser.disconnect();
})().catch(e => console.error(e));
