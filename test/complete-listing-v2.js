const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';
const DRAFT_ID = '5052101109920';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const images = [
  "https://ae-pic-a1.aliexpress-media.com/kf/S1cf750c0a3554bbdae157dd2c4d92e26C.jpg",
  "https://ae-pic-a1.aliexpress-media.com/kf/Sc5bfa0e7793d4562a3ffe0bbe3a661166.jpg",
  "https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg",
  "https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg"
];

// In-stock SKUs only (OOS excluded per bug fix #2)
const inStockSkus = [
  {color: "Red", size: "XS", ebayPrice: 8.45,  stock: 5},
  {color: "Red", size: "S",  ebayPrice: 9.36,  stock: 3},
  {color: "Red", size: "M",  ebayPrice: 11.05, stock: 10},
  {color: "Black", size: "XS", ebayPrice: 9.10,  stock: 2},
  {color: "Black", size: "M",  ebayPrice: 11.70, stock: 8},
  {color: "Black", size: "L",  ebayPrice: 14.30, stock: 4},
  {color: "Black", size: "XL", ebayPrice: 17.55, stock: 1},
  {color: "Blue", size: "S",  ebayPrice: 9.75,  stock: 6},
  {color: "Blue", size: "M",  ebayPrice: 11.44, stock: 4},
  {color: "Blue", size: "XL", ebayPrice: 16.90, stock: 3}
];

// Axes after OOS pruning: all 3 colors have in-stock sizes
const colorValues = ["Red", "Black", "Blue"];
const sizeValues = [...new Set(inStockSkus.map(s => s.size))]; // XS, S, M, L, XL

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au'));
  
  if (!ebay) { log('No eBay page!'); browser.disconnect(); return; }
  log('eBay URL: ' + ebay.url());
  
  // Step 1: Upload photos via draft API PUT
  log('=== STEP 1: Upload photos via draft API ===');
  const photoResult = await ebay.evaluate(async (draftId, imageUrls) => {
    const results = [];
    
    // Try multiple payload formats
    const payloads = [
      // Format 1: pictureURL array
      { pictureURL: imageUrls },
      // Format 2: pictures array with url key
      { pictures: imageUrls.map(url => ({ url })) },
      // Format 3: image urls in item
      { item: { pictures: imageUrls.map(url => ({ originalImageUrl: url })) } },
    ];
    
    for (let i = 0; i < payloads.length; i++) {
      try {
        const resp = await fetch(`/sl/api/draft/${draftId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloads[i])
        });
        const data = await resp.json().catch(() => resp.text());
        results.push({ format: i, status: resp.status, data: JSON.stringify(data).substring(0, 200) });
        if (resp.ok) break;
      } catch(e) {
        results.push({ format: i, error: e.message });
      }
    }
    return results;
  }, DRAFT_ID, images);
  log('Photo upload results: ' + JSON.stringify(photoResult));
  
  // Step 2: Also try uploading via eBay Media API (fetch blob → upload)
  log('=== STEP 2: Upload via Media API ===');
  const mediaResult = await ebay.evaluate(async (imageUrls) => {
    const results = [];
    for (const url of imageUrls.slice(0, 4)) {
      try {
        // Fetch the image
        const resp = await fetch(url);
        if (!resp.ok) { results.push({ url: url.substring(0, 50), error: 'fetch failed' }); continue; }
        const blob = await resp.blob();
        
        // Upload to eBay's media endpoint
        const fd = new FormData();
        fd.append('file', blob, 'image.jpg');
        
        const uploadResp = await fetch('/sl/api/media/upload', {
          method: 'POST',
          body: fd
        });
        const data = await uploadResp.text();
        results.push({ url: url.substring(0, 50), status: uploadResp.status, data: data.substring(0, 100) });
      } catch(e) {
        results.push({ url: url.substring(0, 50), error: e.message });
      }
    }
    return results;
  }, images);
  log('Media API results: ' + JSON.stringify(mediaResult));
  
  // Step 3: Fill required item specifics (Brand, UPC)
  log('=== STEP 3: Fill item specifics ===');
  
  // Fill Brand = Unbranded
  await ebay.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label, span, div'));
    const brandLabel = labels.find(l => l.textContent?.trim() === 'Brand');
    if (brandLabel) {
      // Find the associated input/select
      const section = brandLabel.closest('[class*="field"], [class*="row"], tr');
      if (section) {
        const input = section.querySelector('input[type="text"]');
        const select = section.querySelector('select');
        if (input) {
          input.focus();
          input.value = 'Unbranded';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
    
    // Click "Unbranded" in frequently selected
    const links = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    const unbrandedLink = links.find(l => l.textContent?.trim() === 'Unbranded');
    if (unbrandedLink) unbrandedLink.click();
  });
  await sleep(1000);
  log('Brand set to Unbranded');
  
  // Fill UPC = Does not apply
  await ebay.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label, span, div'));
    const upcLabel = labels.find(l => l.textContent?.trim() === 'UPC');
    if (upcLabel) {
      const section = upcLabel.closest('[class*="field"], [class*="row"], tr');
      if (section) {
        const input = section.querySelector('input[type="text"]');
        if (input) {
          input.focus();
          input.value = 'Does not apply';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
  });
  await sleep(1000);
  log('UPC set');
  
  // Step 4: Click the variation Edit button
  log('=== STEP 4: Click Variations Edit ===');
  const editResult = await ebay.evaluate(() => {
    // Find the Variations section
    const sections = document.querySelectorAll('h2, h3, [class*="section"]');
    for (const sec of sections) {
      if (sec.textContent?.includes('VARIATION') || sec.textContent?.includes('Variation')) {
        // Find Edit button nearby
        const parent = sec.closest('section, [class*="section"], [class*="group"]') || sec.parentElement;
        const editBtn = parent?.querySelector('button, a, [role="button"]') || 
          Array.from(document.querySelectorAll('button')).find(b => {
            const r = b.getBoundingClientRect();
            const sr = sec.getBoundingClientRect();
            return Math.abs(r.top - sr.top) < 50 && b.textContent?.trim() === 'Edit';
          });
        if (editBtn) {
          editBtn.scrollIntoView({ block: 'center' });
          editBtn.click();
          return { clicked: true, text: editBtn.textContent?.trim() };
        }
      }
    }
    
    // Fallback: find any Edit button near "Variations" text
    const allBtns = Array.from(document.querySelectorAll('button, [role="button"], a'));
    for (const btn of allBtns) {
      if (btn.textContent?.trim() === 'Edit') {
        const nearby = btn.parentElement?.textContent || '';
        if (nearby.includes('ariation')) {
          btn.click();
          return { clicked: true, text: 'Edit (fallback)', nearby: nearby.substring(0, 50) };
        }
      }
    }
    
    return { clicked: false };
  });
  log('Edit click: ' + JSON.stringify(editResult));
  
  await sleep(5000);
  await ebay.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/screenshots/after-edit-click.png' });
  
  // Check what happened after clicking Edit
  const allPages = await browser.pages();
  log('Tabs after edit: ' + allPages.map(p => p.url().substring(0, 80)).join(' | '));
  
  // Look for variation builder (could be iframe or new page)
  let builderPage = allPages.find(p => p.url().includes('bulkedit'));
  
  if (!builderPage) {
    // Check if there's an iframe
    const hasIframe = await ebay.evaluate(() => {
      const iframes = document.querySelectorAll('iframe');
      return Array.from(iframes).map(f => ({ src: f.src?.substring(0, 100), id: f.id, name: f.name }));
    });
    log('Iframes: ' + JSON.stringify(hasIframe));
    
    // Also check if variation builder opened inline
    const pageContent = await ebay.evaluate(() => document.body.innerText.substring(0, 2000));
    log('Page content: ' + pageContent.substring(0, 500));
  }
  
  // Wait a bit more and re-check
  await sleep(5000);
  const allPages2 = await browser.pages();
  builderPage = allPages2.find(p => p.url().includes('bulkedit'));
  log('Builder page: ' + (builderPage?.url() || 'not found'));
  
  // Check iframes again
  const iframes = await ebay.evaluate(() => {
    return Array.from(document.querySelectorAll('iframe')).map(f => ({
      src: f.src, id: f.id, name: f.name, w: f.offsetWidth, h: f.offsetHeight
    }));
  });
  log('All iframes: ' + JSON.stringify(iframes));
  
  await ebay.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/screenshots/variation-builder.png', fullPage: true });
  
  browser.disconnect();
  log('Done - check screenshots');
})().catch(e => console.error('FATAL:', e.message));
