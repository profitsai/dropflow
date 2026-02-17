const puppeteer = require('puppeteer-core');
const fs = require('fs');
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  // Find the already-open prelist page from previous attempts
  let pages = await browser.pages();
  let page = pages.find(p => p.url().includes('/sl/prelist/suggest'));
  
  if (!page) {
    page = await browser.newPage();
    await page.goto('https://www.ebay.com.au/sl/prelist/suggest', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);
  }
  
  await page.bringToFront();
  
  // Clear and re-type
  const inputSel = 'input[placeholder*="Tell us"]';
  await page.waitForSelector(inputSel, { timeout: 10000 });
  await page.click(inputSel, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await sleep(300);
  await page.type(inputSel, 'Dog coat hoodie fleece', { delay: 30 });
  await sleep(1000);
  
  // Find and click the blue search button by its position
  const searchBtnInfo = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    const results = [];
    for (const b of btns) {
      const rect = b.getBoundingClientRect();
      const svg = b.querySelector('svg');
      const text = b.textContent.trim();
      results.push({
        text: text.substring(0, 40),
        class: (b.className || '').substring(0, 80),
        x: Math.round(rect.x), y: Math.round(rect.y),
        w: Math.round(rect.width), h: Math.round(rect.height),
        hasSvg: !!svg,
        visible: rect.width > 0 && rect.height > 0
      });
    }
    return results;
  });
  
  console.log('All buttons:');
  for (const b of searchBtnInfo) {
    console.log(`  "${b.text}" class="${b.class}" pos=${b.x},${b.y} size=${b.w}x${b.h} svg=${b.hasSvg} vis=${b.visible}`);
  }
  
  // The search button should be the big round blue one with SVG, next to the input
  // It should be around x=1140-1200 based on the screenshot
  const searchBtn = searchBtnInfo.find(b => b.hasSvg && b.visible && b.w > 40 && b.y > 100 && b.y < 250);
  
  if (searchBtn) {
    console.log(`\nClicking search button at ${searchBtn.x + searchBtn.w/2}, ${searchBtn.y + searchBtn.h/2}`);
    await page.mouse.click(searchBtn.x + searchBtn.w/2, searchBtn.y + searchBtn.h/2);
  } else {
    console.log('No search button identified, trying to click at expected position');
    // Based on screenshot, button is at approximately x=1155, y=183
    await page.mouse.click(1155, 183);
  }
  
  await sleep(8000);
  console.log('After search URL:', page.url());
  
  // Copy screenshot
  await page.screenshot({ path: 'ebay-after-search2.png' });
  fs.copyFileSync('ebay-after-search2.png', '/Users/pyrite/.openclaw/workspace/ebay-after-search2.png');
  
  // If on identify page, handle it
  if (page.url().includes('/identify')) {
    console.log('On identify page!');
    await sleep(3000);
    
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
    console.log(bodyText.substring(0, 500));
    
    await page.screenshot({ path: 'ebay-identify.png' });
    fs.copyFileSync('ebay-identify.png', '/Users/pyrite/.openclaw/workspace/ebay-identify.png');
    
    // Look for "Continue without match" or condition selection
    // Try clicking "Continue without a product match" button
    await page.evaluate(() => {
      const allEls = document.querySelectorAll('button, a, [role="button"]');
      for (const el of allEls) {
        const text = el.textContent.toLowerCase();
        if (text.includes('without') || text.includes('no match') || text.includes("don't see")) {
          el.click();
          return;
        }
      }
    });
    
    await sleep(3000);
    
    // Select condition "New" if present
    await page.evaluate(() => {
      const radios = document.querySelectorAll('input[type="radio"]');
      for (const r of radios) {
        const label = r.closest('label') || document.querySelector(`label[for="${r.id}"]`);
        if (label && label.textContent.toLowerCase().includes('new')) {
          r.click();
          return;
        }
      }
      // Try clicking text that says "New"
      const spans = document.querySelectorAll('span, div, button');
      for (const s of spans) {
        if (s.textContent.trim() === 'New' || s.textContent.trim() === 'New with tags') {
          s.click();
          return;
        }
      }
    });
    
    await sleep(1000);
    
    // Click Continue
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim().toLowerCase() === 'continue' && !b.disabled) {
          b.click();
          return;
        }
      }
    });
    
    await sleep(5000);
    console.log('After identify URL:', page.url());
    await page.screenshot({ path: 'ebay-after-identify2.png' });
    fs.copyFileSync('ebay-after-identify2.png', '/Users/pyrite/.openclaw/workspace/ebay-after-identify2.png');
  }
  
  // Continue clicking through until /lstng
  for (let i = 0; i < 5; i++) {
    if (page.url().includes('/lstng')) {
      console.log('\n=== REACHED LISTING FORM! ===');
      const draftMatch = page.url().match(/draftId=(\d+)/);
      if (draftMatch) {
        console.log('Draft ID:', draftMatch[1]);
        fs.writeFileSync('draft-id.txt', draftMatch[1]);
      }
      break;
    }
    
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        const t = b.textContent.trim().toLowerCase();
        if ((t === 'continue' || t.includes('get started')) && !b.disabled) {
          b.click();
          return;
        }
      }
    });
    await sleep(5000);
  }
  
  console.log('Final URL:', page.url());
  await page.screenshot({ path: 'ebay-final.png' });
  fs.copyFileSync('ebay-final.png', '/Users/pyrite/.openclaw/workspace/ebay-final.png');
  
  browser.disconnect();
})().catch(e => console.error(e));
