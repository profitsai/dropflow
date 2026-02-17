/**
 * Minimal test: directly test photo upload + draft verification on eBay.
 * Opens eBay prelist, navigates to form, and tests photo functions.
 */
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = require('fs');
const EXT = 'hikiofeedjngalncoapgpmljpaoeolci';
const WS = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const log = [];
function L(msg) { const t = new Date().toISOString().substr(11,12); const line = `[${t}] ${msg}`; console.log(line); log.push(line); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // Close extra tabs
  const pages = await browser.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close().catch(() => {});
  
  // Open eBay prelist - this will go to the suggest page
  L('Opening eBay prelist...');
  const ebayPage = await browser.newPage();
  ebayPage.on('console', msg => {
    if (msg.text().includes('DropFlow')) L('[EBAY] ' + msg.text().substring(0, 500));
  });
  
  await ebayPage.goto('https://www.ebay.com.au/sl/prelist/suggest', {
    waitUntil: 'networkidle2', timeout: 30000
  }).catch(() => {});
  await sleep(3000);
  
  // Search for a product to get to the form
  L('Searching for product...');
  const searchInput = await ebayPage.$('input[type="text"], input[placeholder*="search" i], input[name="keyword" i]');
  if (searchInput) {
    await searchInput.type('LED dog collar leash glow dark nylon', { delay: 30 });
    await sleep(500);
    // Press enter or click search button
    await ebayPage.keyboard.press('Enter');
    await sleep(5000);
  } else {
    L('No search input found');
  }
  
  L('Current URL: ' + ebayPage.url());
  
  // Wait for navigation to identify page or form page
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const url = ebayPage.url();
    L('URL check: ' + url.substring(0, 80));
    
    if (url.includes('/lstng')) {
      L('Reached listing form!');
      break;
    }
    
    if (url.includes('/identify')) {
      L('On identify page, looking for "Continue without match"...');
      const continueBtn = await ebayPage.$('button[data-testid="continue-without-match"], [data-testid="cwm-btn"]');
      if (continueBtn) {
        await continueBtn.click();
        L('Clicked continue without match');
        await sleep(3000);
      } else {
        // Try text-based search
        const buttons = await ebayPage.$$('button');
        for (const btn of buttons) {
          const text = await ebayPage.evaluate(b => b.textContent.trim().toLowerCase(), btn);
          if (text.includes('continue without') || text.includes('sell it yourself') || text.includes('skip')) {
            await btn.click();
            L('Clicked: ' + text);
            await sleep(3000);
            break;
          }
        }
      }
    }
  }
  
  const finalUrl = ebayPage.url();
  L('Final URL: ' + finalUrl);
  
  if (!finalUrl.includes('/lstng')) {
    L('Could not reach listing form page');
    // Write what we have
    fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PHOTO-PERSIST-FIX.md',
      '# Photo Persist Fix Test\n\n## Run: ' + new Date().toISOString() + '\n\n```\n' + log.join('\n') + '\n```\n\n## Status: Could not reach form page\n'
    );
    browser.disconnect();
    return;
  }
  
  // Now on the form page — test photo upload functions
  L('Testing photo upload on form page...');
  await sleep(5000);
  
  // Check if form filler loaded (should auto-inject via manifest)
  const loaded = await ebayPage.evaluate(() => window.__dropflow_form_filler_loaded);
  L('Form filler loaded: ' + loaded);
  
  // Test getDraftData function
  const draftTest = await ebayPage.evaluate(async () => {
    try {
      // Get ebay context
      const resp = await chrome.runtime.sendMessage({ type: 'GET_EBAY_HEADERS' });
      if (!resp || !resp.draftId) return { error: 'no ebay context', resp };
      
      // Test getDraftData
      const draft = await getDraftData(resp);
      const photoCount = await getDraftPhotoCount(resp);
      
      return {
        draftId: resp.draftId,
        hasDraft: !!draft,
        photoCount,
        draftKeys: draft ? Object.keys(draft).slice(0, 20) : []
      };
    } catch(e) {
      return { error: e.message };
    }
  }).catch(e => ({ evalError: e.message }));
  
  L('Draft test: ' + JSON.stringify(draftTest));
  
  // Test image upload to EPS
  const testImages = [
    'https://ae04.alicdn.com/kf/S58c4bfe442ac41a1ae651f345a5a49c4M.jpg',
    'https://ae04.alicdn.com/kf/Sf8c9e1b0f9c74c4a9e78e3c7e7c2e4d8N.jpg'
  ];
  
  const uploadTest = await ebayPage.evaluate(async (images) => {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_EBAY_HEADERS' });
      if (!resp?.draftId) return { error: 'no context' };
      
      const result = await ensurePhotosInDraft(images, resp, null);
      const afterCount = await getDraftPhotoCount(resp);
      
      return { 
        ensureResult: result,
        afterPhotoCount: afterCount
      };
    } catch(e) {
      return { error: e.message };
    }
  }, testImages).catch(e => ({ evalError: e.message }));
  
  L('Upload test: ' + JSON.stringify(uploadTest));
  
  // Write report
  fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PHOTO-PERSIST-FIX.md',
    '# Photo Persist Fix Test\n\n## Run: ' + new Date().toISOString() + '\n\n```\n' + log.join('\n') + '\n```\n'
  );
  L('Report written');
  
  browser.disconnect();
})().catch(e => { L('FATAL: ' + e.message); console.error(e); });
