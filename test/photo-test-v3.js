/**
 * Photo test v3: Navigates to an eBay listing form via full page load
 * (not SPA navigation) so content script injects properly.
 */
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = require('fs');
const EXT = 'hikiofeedjngalncoapgpmljpaoeolci';
const WS = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const log = [];
function L(msg) { const t = new Date().toISOString().substr(11,12); const line = `[${t}] ${msg}`; console.log(line); log.push(line); }

async function ensureSW(browser) {
  let targets = await browser.targets();
  let sw = targets.find(t => t.url().includes(EXT) && t.type() === 'service_worker');
  if (sw) return sw;
  const p = await browser.newPage();
  await p.goto('chrome-extension://' + EXT + '/background/service-worker.js');
  await sleep(3000);
  await p.close();
  targets = await browser.targets();
  return targets.find(t => t.url().includes(EXT) && t.type() === 'service_worker');
}

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // Clean up
  const pages = await browser.pages();
  for (let i = 1; i < pages.length; i++) await pages[i].close().catch(() => {});
  
  // The previous test created a draft. Let's reload that eBay form page 
  // (full page load) so content script injects fresh.
  // We'll use the draft ID from the previous test or create a new one.
  
  // First, go to prelist to create a fresh draft via normal flow
  L('Creating fresh listing draft...');
  const ebayPage = await browser.newPage();
  ebayPage.on('console', msg => {
    if (msg.text().includes('DropFlow')) L('[EBAY] ' + msg.text().substring(0, 500));
  });
  
  // Go to prelist suggest
  await ebayPage.goto('https://www.ebay.com.au/sl/prelist/suggest', {
    waitUntil: 'networkidle2', timeout: 30000
  }).catch(() => {});
  await sleep(3000);
  
  // Type a title to search
  const searchInput = await ebayPage.$('input[type="text"]');
  if (searchInput) {
    await searchInput.type('LED dog collar leash safety nylon glow dark', { delay: 30 });
    await ebayPage.keyboard.press('Enter');
    L('Searched');
    await sleep(5000);
  }
  
  // Wait for navigation to lstng form
  let draftUrl = null;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const url = ebayPage.url();
    if (url.includes('/lstng')) {
      draftUrl = url;
      L('Got draft URL: ' + url.substring(0, 80));
      break;
    }
    // Handle identify page
    if (url.includes('/identify')) {
      const buttons = await ebayPage.$$('button');
      for (const btn of buttons) {
        const text = await ebayPage.evaluate(b => b.textContent.trim().toLowerCase(), btn);
        if (text.includes('continue without') || text.includes('yourself') || text.includes('skip')) {
          await btn.click();
          L('Skipped identify: ' + text.substring(0, 40));
          await sleep(3000);
          break;
        }
      }
    }
  }
  
  if (!draftUrl) {
    L('Could not get draft URL');
    fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PHOTO-PERSIST-FIX.md',
      '# Photo Persist Fix - FAILED\n\n```\n' + log.join('\n') + '\n```\n');
    browser.disconnect(); return;
  }
  
  // NOW: reload the page via full navigation to get fresh content script
  L('Reloading form page for fresh content script...');
  await ebayPage.goto(draftUrl, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await sleep(5000);
  
  // Verify content script loaded
  const loaded = await ebayPage.evaluate(() => !!window.__dropflow_form_filler_loaded);
  L('Form filler loaded: ' + loaded);
  
  const hasCR = await ebayPage.evaluate(() => typeof chrome?.runtime?.sendMessage === 'function');
  L('chrome.runtime available: ' + hasCR);
  
  if (!hasCR) {
    L('chrome.runtime not available — content script not injected');
    // Force inject via SW
    const sw = await ensureSW(browser);
    if (sw) {
      const swCdp = await sw.createCDPSession();
      const tabId = await ebayPage.evaluate(() => {
        // Can't get tab ID without chrome.runtime, try via CDP
        return null;
      });
      // Get eBay tab ID from SW
      const tidResult = await swCdp.send('Runtime.evaluate', {
        expression: `chrome.tabs.query({url: '*://*.ebay.com.au/lstng*'}).then(tabs => tabs.map(t => t.id))`,
        awaitPromise: true
      });
      const tabIds = JSON.parse(tidResult.result?.value || '[]');
      L('eBay tab IDs: ' + JSON.stringify(tabIds));
      
      if (tabIds.length > 0) {
        const injectR = await swCdp.send('Runtime.evaluate', {
          expression: `chrome.scripting.executeScript({
            target: { tabId: ${tabIds[0]}, allFrames: true },
            files: ['content-scripts/ebay/form-filler.js']
          }).then(() => 'ok').catch(e => e.message)`,
          awaitPromise: true
        });
        L('Inject result: ' + injectR.result?.value);
        await sleep(3000);
      }
      await swCdp.detach().catch(() => {});
    }
  }
  
  // Now test the photo functions
  L('Testing photo functions...');
  
  const testResult = await ebayPage.evaluate(async () => {
    const results = {};
    
    // 1. Get eBay headers
    try {
      const ebayCtx = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_EBAY_HEADERS' }, resolve);
      });
      results.hasContext = !!ebayCtx;
      results.draftId = ebayCtx?.draftId || null;
      results.hasHeaders = !!ebayCtx?.headers;
      
      if (ebayCtx?.draftId) {
        // 2. Test getDraftData
        const draft = await getDraftData(ebayCtx);
        results.draftDataOk = !!draft;
        if (draft) {
          results.draftPictures = draft.pictures?.pictureUrl?.length || 0;
          results.draftTitle = draft.title?.substring(0, 40) || '(none)';
        }
        
        // 3. Test getDraftPhotoCount
        results.photoCount = await getDraftPhotoCount(ebayCtx);
        
        // 4. Upload test images via EPS + draft PUT
        const testUrls = [
          'https://ae04.alicdn.com/kf/S58c4bfe442ac41a1ae651f345a5a49c4M.jpg'
        ];
        results.ensurePhotos = await ensurePhotosInDraft(testUrls, ebayCtx, null);
        
        // 5. Verify photos after upload
        results.photoCountAfter = await getDraftPhotoCount(ebayCtx);
        
        // 6. Test waitForDraftPhotos
        results.waitResult = await waitForDraftPhotos(ebayCtx, 10000);
      }
    } catch(e) {
      results.error = e.message;
    }
    
    return results;
  }).catch(e => ({ evalError: e.message }));
  
  L('Photo test results:\n' + JSON.stringify(testResult, null, 2));
  
  // Write report
  const status = testResult.ensurePhotos ? '✅ PASSED' : '❌ FAILED';
  fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/PHOTO-PERSIST-FIX.md',
    `# Photo Persist Fix Test - ${status}\n\n## Run: ${new Date().toISOString()}\n\n## Results\n\`\`\`json\n${JSON.stringify(testResult, null, 2)}\n\`\`\`\n\n## Log\n\`\`\`\n${log.join('\n')}\n\`\`\`\n`
  );
  L('Report written');
  
  browser.disconnect();
})().catch(e => { L('FATAL: ' + e.message); console.error(e); });
