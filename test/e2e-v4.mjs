/**
 * DropFlow E2E v4 — Full flow: AliExpress scrape → eBay listing with variations + images
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CDP_URL = 'http://127.0.0.1:57542';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const SCREENSHOTS = '/Users/pyrite/Projects/dropflow-extension/test/screenshots';
const ALI_PRODUCT = 'https://www.aliexpress.com/item/1005006995032850.html';

let stepNum = 0;
const log = (msg) => console.log(`[E2E] ${msg}`);
const consoleLogs = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function shot(page, label) {
  stepNum++;
  const fname = `${String(stepNum).padStart(2, '0')}-${label}.png`;
  try {
    await page.screenshot({ path: path.join(SCREENSHOTS, fname), fullPage: false });
    log(`📸 ${fname}`);
  } catch(e) { log(`📸 FAIL ${fname}: ${e.message}`); }
}

function hookConsole(page, source) {
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push({ time: new Date().toISOString(), text, type: msg.type(), source });
    if (text.includes('DropFlow') || text.includes('dropflow') || text.includes('CORS') || text.includes('cors')) {
      log(`  📋 [${source}] ${text.substring(0, 200)}`);
    }
  });
  page.on('pageerror', err => {
    consoleLogs.push({ time: new Date().toISOString(), text: err.message, type: 'error', source });
    log(`  ❌ [${source}] ${err.message.substring(0, 200)}`);
  });
}

(async () => {
  log('Connecting to Multilogin browser...');
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
  const pages = await browser.pages();
  log(`Found ${pages.length} pages`);
  for (const p of pages) log(`  - ${p.url().substring(0, 100)}`);

  // Step 1: Reload extension via chrome://extensions page
  log('Step 1: Reloading extension...');
  let extPage = pages.find(p => p.url().includes('chrome://extensions'));
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto('chrome://extensions', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000);
  }
  
  // Enable developer mode and reload extension
  await extPage.evaluate((extId) => {
    // Try to enable dev mode
    const mgr = document.querySelector('extensions-manager');
    if (mgr && mgr.shadowRoot) {
      const toolbar = mgr.shadowRoot.querySelector('extensions-toolbar');
      if (toolbar && toolbar.shadowRoot) {
        const toggle = toolbar.shadowRoot.querySelector('#devMode');
        if (toggle && !toggle.checked) toggle.click();
      }
    }
  }, EXT_ID);
  await sleep(1000);
  
  // Navigate to specific extension to find reload button
  await extPage.goto(`chrome://extensions/?id=${EXT_ID}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await sleep(2000);
  await shot(extPage, 'extensions-page');
  
  // Try reloading via chrome.management API from the extensions page
  const reloaded = await extPage.evaluate(async (extId) => {
    try {
      // Deep shadow DOM traversal for extension detail page
      const mgr = document.querySelector('extensions-manager');
      if (!mgr?.shadowRoot) return 'no manager';
      const detail = mgr.shadowRoot.querySelector('extensions-detail-view');
      if (detail?.shadowRoot) {
        const reloadBtn = detail.shadowRoot.querySelector('#dev-reload-button');
        if (reloadBtn) { reloadBtn.click(); return 'clicked detail reload'; }
      }
      const itemList = mgr.shadowRoot.querySelector('extensions-item-list');
      if (itemList?.shadowRoot) {
        const items = itemList.shadowRoot.querySelectorAll('extensions-item');
        for (const item of items) {
          if (item.id === extId) {
            const btn = item.shadowRoot?.querySelector('#dev-reload-button');
            if (btn) { btn.click(); return 'clicked item reload'; }
          }
        }
      }
      return 'reload button not found';
    } catch(e) { return e.message; }
  }, EXT_ID);
  log(`Extension reload: ${reloaded}`);
  await sleep(3000);

  // Step 2: Navigate to AliExpress product
  log('Step 2: Navigating to AliExpress...');
  let page = pages.find(p => !p.url().startsWith('chrome') && !p.url().startsWith('about'));
  if (!page) page = await browser.newPage();
  hookConsole(page, 'aliexpress');
  
  await page.goto(ALI_PRODUCT, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(8000);
  await shot(page, 'aliexpress-loaded');
  log(`AliExpress URL: ${page.url()}`);
  
  // Check if we got redirected or blocked
  const pageTitle = await page.title();
  log(`Page title: ${pageTitle}`);

  // Step 3: Trigger DropFlow scrape
  log('Step 3: Looking for DropFlow UI...');
  
  // Check for content script injection
  const dfUI = await page.evaluate(() => {
    const dfEls = [];
    document.querySelectorAll('[id*="dropflow"], [class*="dropflow"]').forEach(el => {
      dfEls.push({ tag: el.tagName, id: String(el.id || ''), cls: String(el.className || '').substring(0, 50) });
    });
    // Also check for shadow DOMs and iframes
    const iframes = document.querySelectorAll('iframe');
    const iframeInfo = [...iframes].map(f => ({ src: f.src?.substring(0, 100) || '', id: f.id }));
    return { dfEls, iframes: iframeInfo };
  });
  log(`DropFlow elements: ${JSON.stringify(dfUI)}`);
  
  // Open popup to trigger scrape
  log('Opening extension popup...');
  const popupUrl = `chrome-extension://${EXT_ID}/pages/popup/popup.html`;
  const popupPage = await browser.newPage();
  hookConsole(popupPage, 'popup');
  await popupPage.goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await sleep(2000);
  await shot(popupPage, 'popup');
  
  // Get popup HTML to understand structure
  const popupHTML = await popupPage.evaluate(() => document.body?.innerHTML?.substring(0, 2000) || 'empty');
  log(`Popup HTML preview: ${popupHTML.substring(0, 500)}`);
  
  // Find and click the main action button
  const buttons = await popupPage.evaluate(() => {
    return [...document.querySelectorAll('button, a, [role="button"], [onclick]')].map(b => ({
      text: b.textContent?.trim().substring(0, 50),
      tag: b.tagName, id: b.id, cls: b.className?.toString().substring(0, 50),
      disabled: b.disabled
    }));
  });
  log(`Popup buttons: ${JSON.stringify(buttons)}`);
  
  // Click the first actionable button (likely "Scrape" or "Start")
  for (const sel of [
    'button:not([disabled])', '#scrape', '#start', '[data-action]',
    'a.btn', '.btn-primary', 'button.primary'
  ]) {
    const el = await popupPage.$(sel);
    if (el) {
      const txt = await popupPage.evaluate(e => e.textContent?.trim(), el);
      log(`Clicking: "${txt}" (${sel})`);
      await el.click();
      await sleep(2000);
      await shot(popupPage, 'popup-clicked');
      break;
    }
  }
  
  // Switch back to AliExpress page
  await page.bringToFront();
  await sleep(5000);
  await shot(page, 'after-scrape');
  
  // Step 4-5: Monitor for eBay form, iframe, new tab
  log('Step 4: Monitoring for eBay form...');
  
  let ebayPage = null;
  let ebayFrame = null;
  
  for (let i = 0; i < 60; i++) {
    // Check new tabs
    const currentPages = await browser.pages();
    for (const p of currentPages) {
      const url = p.url();
      if (url.includes('ebay.com') || (url.includes(EXT_ID) && !url.includes('popup'))) {
        if (!ebayPage || ebayPage.url() !== url) {
          ebayPage = p;
          log(`Found eBay/DropFlow page: ${url.substring(0, 100)}`);
          hookConsole(ebayPage, 'ebay-page');
        }
      }
    }
    
    // Check iframes on AliExpress page
    const frames = page.frames();
    for (const f of frames) {
      if (f.url().includes(EXT_ID) || f.url().includes('ebay')) {
        ebayFrame = f;
        log(`Found DropFlow iframe: ${f.url().substring(0, 100)}`);
      }
    }
    
    if (ebayPage || ebayFrame) break;
    
    if (i % 5 === 4) {
      log(`  Waiting... ${(i+1)*2}s`);
      await shot(page, `waiting-${i}`);
    }
    await sleep(2000);
  }
  
  // Work with whatever we found
  const targetPage = ebayPage || page;
  const targetFrame = ebayFrame;
  
  if (!ebayPage && !ebayFrame) {
    log('⚠️  No eBay form/iframe found after 2 minutes');
    
    // Check all page URLs again
    const allP = await browser.pages();
    log('All open pages:');
    for (const p of allP) {
      log(`  ${p.url()}`);
      // Check each page for DropFlow content
      const hasDF = await p.evaluate(() => {
        return {
          iframes: [...document.querySelectorAll('iframe')].map(f => f.src?.substring(0, 80)),
          dfElements: document.querySelectorAll('[class*="dropflow"], [id*="dropflow"]').length
        };
      }).catch(() => null);
      if (hasDF) log(`    DF content: ${JSON.stringify(hasDF)}`);
    }
    
    await shot(page, 'no-ebay-form');
  } else {
    log('✅ Found eBay listing interface');
    
    if (ebayPage) {
      await ebayPage.bringToFront();
      await sleep(5000);
    }
    
    // Wait for form to load and populate
    log('Step 5: Monitoring form population...');
    
    const evalTarget = ebayFrame || ebayPage || page;
    
    // Take periodic screenshots as form populates
    for (let phase = 0; phase < 6; phase++) {
      await sleep(10000);
      await shot(targetPage, `form-phase-${phase}`);
      
      // Check form state
      const state = await evalTarget.evaluate(() => {
        const getText = sel => document.querySelector(sel)?.value || document.querySelector(sel)?.textContent?.trim()?.substring(0, 80) || '';
        return {
          title: getText('[name="title"], #title, input[type="text"]'),
          hasImages: document.querySelectorAll('img[src*="http"], .uploaded-image, [class*="photo"] img').length,
          hasVariations: document.querySelectorAll('[class*="variation"], [class*="chip"], [class*="option"]').length,
          hasPricing: document.querySelectorAll('input[type="number"], [class*="price"]').length,
          buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim().substring(0, 30)).filter(Boolean).slice(0, 10),
          errors: [...document.querySelectorAll('[class*="error"]:not([style*="none"])')]
            .map(e => e.textContent.trim().substring(0, 80)).filter(Boolean).slice(0, 5)
        };
      }).catch(e => ({ error: e.message }));
      
      log(`Phase ${phase}: ${JSON.stringify(state)}`);
      
      // If we see images and variations, we're in good shape
      if (state.hasImages > 0 && state.hasVariations > 0) {
        log('✅ Images and variations detected!');
      }
    }
    
    // Final comprehensive check
    log('Step 6-7: Final state check...');
    await shot(targetPage, 'final-form');
    
    // CORS check
    const corsErrors = consoleLogs.filter(l => 
      /cors|blocked|access-control/i.test(l.text)
    );
    log(`\n🔍 CORS errors: ${corsErrors.length}`);
    corsErrors.forEach(e => log(`  ❌ ${e.text.substring(0, 150)}`));
    
    // Image upload check
    const imageCheck = await evalTarget.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="http"]');
      const uploadBtns = document.querySelectorAll('[class*="upload"], input[type="file"]');
      return {
        loadedImages: imgs.length,
        imgSrcs: [...imgs].slice(0, 5).map(i => i.src.substring(0, 80)),
        uploadButtons: uploadBtns.length
      };
    }).catch(e => ({ error: e.message }));
    log(`🖼️  Images: ${JSON.stringify(imageCheck)}`);
    
    // Step 8: Check List button
    log('Step 8: Checking List button...');
    const listCheck = await evalTarget.evaluate(() => {
      const btns = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')];
      const listBtn = btns.find(b => /^(list|submit|publish)$/i.test(b.textContent.trim()));
      const allBtns = btns.map(b => ({ 
        text: b.textContent.trim().substring(0, 30), 
        disabled: b.disabled,
        visible: b.offsetParent !== null 
      })).filter(b => b.text);
      return { listBtn: listBtn ? { text: listBtn.textContent.trim(), disabled: listBtn.disabled } : null, allBtns };
    }).catch(e => ({ error: e.message }));
    log(`List button: ${JSON.stringify(listCheck)}`);
    
    await shot(targetPage, 'final-state');
  }
  
  // Summary
  log('\n========== E2E v4 RESULTS ==========');
  const dfLogs = consoleLogs.filter(l => l.text.includes('DropFlow'));
  const corsCount = consoleLogs.filter(l => /cors|blocked|access-control/i.test(l.text)).length;
  const errorLogs = consoleLogs.filter(l => l.type === 'error');
  log(`Total console logs: ${consoleLogs.length}`);
  log(`[DropFlow] logs: ${dfLogs.length}`);
  log(`CORS errors: ${corsCount}`);
  log(`JS errors: ${errorLogs.length}`);
  log(`Screenshots taken: ${stepNum}`);
  
  if (dfLogs.length) {
    log('\n--- DropFlow Logs ---');
    dfLogs.forEach(l => log(`  ${l.source}: ${l.text.substring(0, 150)}`));
  }
  if (errorLogs.length) {
    log('\n--- Errors ---');
    errorLogs.slice(0, 20).forEach(l => log(`  ${l.source}: ${l.text.substring(0, 150)}`));
  }
  log('====================================');
  
  fs.writeFileSync(path.join(SCREENSHOTS, 'console-logs.json'), JSON.stringify(consoleLogs, null, 2));
  
  await browser.disconnect();
  log('Done!');
})().catch(e => {
  console.error(`[E2E] FATAL: ${e.message}`);
  process.exit(1);
});
