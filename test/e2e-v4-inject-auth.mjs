/**
 * DropFlow E2E v4 — Inject auth tokens, then run full flow
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CDP_URL = 'http://127.0.0.1:57542';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const SCREENSHOTS = '/Users/pyrite/Projects/dropflow-extension/test/screenshots';
const ALI_URL = 'https://www.aliexpress.com/item/1005006995032850.html';

let stepNum = 0;
const log = msg => console.log(`[E2E] ${msg}`);
const consoleLogs = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function shot(page, label) {
  stepNum++;
  const fname = `${String(stepNum).padStart(2,'0')}-${label}.png`;
  try { await page.screenshot({ path: path.join(SCREENSHOTS, fname), fullPage: false }); log(`📸 ${fname}`); }
  catch(e) { log(`📸 FAIL ${fname}: ${e.message}`); }
}

function hookConsole(page, source) {
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push({ time: new Date().toISOString(), text, type: msg.type(), source });
    if (/DropFlow|dropflow|CORS|cors|upload|image/i.test(text)) {
      log(`  📋 [${source}] ${text.substring(0, 250)}`);
    }
  });
  page.on('pageerror', err => {
    consoleLogs.push({ time: new Date().toISOString(), text: err.message, type: 'error', source });
    log(`  ❌ [${source}] ${err.message.substring(0, 200)}`);
  });
}

(async () => {
  log('Connecting...');
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
  
  // Step 0: Get fresh tokens
  log('Step 0: Getting fresh auth tokens...');
  const loginResp = await fetch('https://dropflow-api.onrender.com/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'e2e-test@dropflow.test', password: 'TestPass123!' })
  });
  const authData = await loginResp.json();
  log(`Auth: ${loginResp.status} - user: ${authData.user?.email}`);
  
  if (!authData.accessToken) {
    log('FATAL: No access token');
    process.exit(1);
  }

  // Inject tokens via extension page that has chrome.storage access
  const pages = await browser.pages();
  let extPage = pages.find(p => p.url().includes(`chrome-extension://${EXT_ID}`));
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${EXT_ID}/pages/popup/popup.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1000);
  }
  
  const injected = await extPage.evaluate(async (tokens) => {
    try {
      await chrome.storage.local.set({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        userEmail: tokens.user.email,
        userId: String(tokens.user.id)
      });
      // Verify
      const stored = await chrome.storage.local.get(['accessToken', 'userEmail']);
      return { ok: true, email: stored.userEmail, hasToken: !!stored.accessToken };
    } catch(e) {
      return { ok: false, error: e.message };
    }
  }, authData);
  log(`Token injection: ${JSON.stringify(injected)}`);
  
  if (!injected.ok) {
    log('FATAL: Could not inject tokens');
    process.exit(1);
  }

  // Step 1: Reload extension to pick up new auth state
  log('Step 1: Reloading extension...');
  // Navigate to extensions page to reload
  const reloadPage = await browser.newPage();
  await reloadPage.goto(`chrome://extensions/?id=${EXT_ID}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await sleep(2000);
  
  const reloaded = await reloadPage.evaluate((extId) => {
    try {
      const mgr = document.querySelector('extensions-manager');
      if (!mgr?.shadowRoot) return 'no manager';
      const detail = mgr.shadowRoot.querySelector('extensions-detail-view');
      if (detail?.shadowRoot) {
        const btn = detail.shadowRoot.querySelector('#dev-reload-button');
        if (btn) { btn.click(); return 'reloaded'; }
      }
      return 'button not found';
    } catch(e) { return e.message; }
  }, EXT_ID);
  log(`Extension reload: ${reloaded}`);
  await sleep(4000);
  
  // Close helper pages
  try { await reloadPage.close(); } catch {}
  
  // Verify auth is still set after reload
  const popupPage = await browser.newPage();
  hookConsole(popupPage, 'popup');
  await popupPage.goto(`chrome-extension://${EXT_ID}/pages/popup/popup.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await sleep(3000);
  await shot(popupPage, 'popup-after-auth');
  
  // Check if auth prompt is hidden
  const authState = await popupPage.evaluate(() => {
    const authPrompt = document.getElementById('auth-prompt');
    const mainContent = document.querySelector('.main-content, #main-content, .nav-cards');
    return {
      authPromptVisible: authPrompt?.style.display !== 'none' && authPrompt?.offsetParent !== null,
      authPromptDisplay: authPrompt?.style.display,
      mainContentVisible: mainContent?.style.display !== 'none',
      bodyHTML: document.body.innerHTML.substring(0, 500)
    };
  });
  log(`Auth state: ${JSON.stringify(authState)}`);

  // Step 2: Navigate to AliExpress product
  log('Step 2: Navigating to AliExpress product...');
  let aliPage = (await browser.pages()).find(p => p.url().includes('aliexpress'));
  if (!aliPage) aliPage = await browser.newPage();
  hookConsole(aliPage, 'aliexpress');
  
  await aliPage.goto(ALI_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(8000);
  await shot(aliPage, 'aliexpress-product');
  log(`Title: ${await aliPage.title()}`);
  
  // Check for content script injection
  const contentScript = await aliPage.evaluate(() => {
    return {
      dfElements: document.querySelectorAll('[id*="dropflow"], [class*="dropflow"]').length,
      iframes: [...document.querySelectorAll('iframe')].filter(f => f.src?.includes('dropflow') || f.src?.includes('chrome-extension')).map(f => f.src.substring(0, 80))
    };
  });
  log(`Content script presence: ${JSON.stringify(contentScript)}`);
  
  // Step 3: Trigger scrape
  log('Step 3: Triggering scrape...');
  
  // Try sending message from content script context
  const scrapeResult = await aliPage.evaluate(async (extId) => {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(extId, { type: 'SCRAPE_ALIEXPRESS', url: window.location.href }, (resp) => {
          if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
          else resolve({ ok: true, resp });
        });
      } catch(e) {
        resolve({ error: e.message });
      }
      // Timeout
      setTimeout(() => resolve({ error: 'timeout' }), 5000);
    });
  }, EXT_ID).catch(e => ({ error: e.message }));
  log(`Scrape trigger result: ${JSON.stringify(scrapeResult)}`);
  
  await sleep(3000);
  await shot(aliPage, 'after-scrape-trigger');
  
  // If direct message didn't work, try via popup
  if (scrapeResult.error) {
    log('Direct message failed, trying popup approach...');
    
    // Check what the popup shows now
    const popupHTML = await popupPage.evaluate(() => document.body.innerHTML.substring(0, 1000));
    log(`Popup HTML: ${popupHTML.substring(0, 300)}`);
    
    // Look for AliExpress Lister nav card
    const navCards = await popupPage.evaluate(() => {
      return [...document.querySelectorAll('.nav-card, a')].map(a => ({
        text: a.textContent.trim().substring(0, 50),
        href: a.href
      }));
    });
    log(`Nav cards: ${JSON.stringify(navCards)}`);
    
    // Click AliExpress Lister
    const aliListerClicked = await popupPage.evaluate(() => {
      const cards = [...document.querySelectorAll('.nav-card, a')];
      const aliCard = cards.find(c => /aliexpress.*lister/i.test(c.textContent));
      if (aliCard) { aliCard.click(); return aliCard.textContent.trim().substring(0, 50); }
      return null;
    });
    log(`AliExpress Lister clicked: ${aliListerClicked}`);
    await sleep(3000);
    await shot(popupPage, 'popup-ali-lister');
  }
  
  // Check for the AliExpress lister page/tab
  await sleep(5000);
  const allPages = await browser.pages();
  log(`Open pages (${allPages.length}):`);
  for (const p of allPages) {
    const url = p.url();
    log(`  ${url.substring(0, 100)}`);
  }
  
  // Look for the lister/form page
  let listerPage = allPages.find(p => {
    const u = p.url();
    return (u.includes(EXT_ID) && (u.includes('lister') || u.includes('form') || u.includes('ebay') || u.includes('pdp')));
  });
  
  // Also check for eBay.com pages
  let ebayPage = allPages.find(p => p.url().includes('ebay.com'));
  
  if (listerPage) {
    log(`Found lister page: ${listerPage.url()}`);
    hookConsole(listerPage, 'lister');
    await listerPage.bringToFront();
    await sleep(3000);
    await shot(listerPage, 'lister-page');
  } else if (ebayPage) {
    log(`Found eBay page: ${ebayPage.url()}`);
    listerPage = ebayPage;
    hookConsole(listerPage, 'ebay');
    await listerPage.bringToFront();
    await sleep(3000);
    await shot(listerPage, 'ebay-page');
  }
  
  // Let's look at the content scripts manifest to understand the flow
  log('Checking extension manifest for content scripts...');
  const manifestPage = await browser.newPage();
  await manifestPage.goto(`chrome-extension://${EXT_ID}/manifest.json`, { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
  const manifest = await manifestPage.evaluate(() => {
    try { return JSON.parse(document.body.innerText || document.querySelector('pre')?.textContent || '{}'); }
    catch { return {}; }
  });
  await manifestPage.close();
  
  if (manifest.content_scripts) {
    log(`Content scripts:`);
    manifest.content_scripts.forEach((cs, i) => {
      log(`  [${i}] matches: ${cs.matches?.join(', ')} → ${cs.js?.join(', ')}`);
    });
  }
  if (manifest.permissions) log(`Permissions: ${manifest.permissions.join(', ')}`);
  if (manifest.web_accessible_resources) {
    log(`Web accessible: ${JSON.stringify(manifest.web_accessible_resources).substring(0, 200)}`);
  }
  
  // Check service worker logs
  log('Checking service worker...');
  const swTargets = await browser.targets();
  const swTarget = swTargets.find(t => t.url().includes('service-worker'));
  if (swTarget) {
    log(`SW target: ${swTarget.url()}`);
    try {
      const worker = await swTarget.worker();
      if (worker) {
        hookConsole({ on: (evt, fn) => worker.on(evt === 'console' ? 'console' : evt, fn) }, 'sw');
      }
    } catch(e) { log(`SW worker access: ${e.message}`); }
  }
  
  // Now look at how scraping actually works in the content script
  log('Examining content script behavior on AliExpress page...');
  await aliPage.bringToFront();
  
  // Check if content script created any UI
  const uiCheck = await aliPage.evaluate(() => {
    // Check shadow roots
    const allEls = document.querySelectorAll('*');
    let shadowHosts = 0;
    for (const el of allEls) {
      if (el.shadowRoot) shadowHosts++;
    }
    
    // Check for injected buttons/overlays
    const fixedEls = [...document.querySelectorAll('*')].filter(el => {
      const style = getComputedStyle(el);
      return style.position === 'fixed' && style.zIndex > 9000;
    });
    
    return {
      shadowHosts,
      highZIndexFixed: fixedEls.map(el => ({
        tag: el.tagName, id: el.id || '', 
        cls: (el.className?.toString() || '').substring(0, 30),
        text: el.textContent?.substring(0, 50)
      }))
    };
  });
  log(`UI check: ${JSON.stringify(uiCheck)}`);

  // Let's look at the actual product scraper code to understand the trigger
  log('Reading product scraper source...');
  const scraperSource = fs.readFileSync('/Users/pyrite/Projects/dropflow-extension/extension/content-scripts/aliexpress/product-scraper.js', 'utf8');
  
  // Find how scraping is triggered
  const triggerMatches = scraperSource.match(/chrome\.runtime\.onMessage|addEventListener|DOMContentLoaded|window\.load|MutationObserver/g);
  log(`Scraper triggers: ${JSON.stringify(triggerMatches)}`);
  
  // Check first 50 lines for init logic
  const scraperLines = scraperSource.split('\n').slice(0, 80);
  log(`Scraper init:\n${scraperLines.filter(l => l.trim() && !l.trim().startsWith('//')).slice(0, 30).join('\n')}`);
  
  // Check the message types
  const msgTypes = fs.readFileSync('/Users/pyrite/Projects/dropflow-extension/extension/lib/message-types.js', 'utf8');
  log(`Message types:\n${msgTypes.substring(0, 1000)}`);
  
  // Check service worker message handling
  const swSource = fs.readFileSync('/Users/pyrite/Projects/dropflow-extension/extension/background/service-worker.js', 'utf8');
  const msgHandlers = swSource.match(/case ['"].*?['"]/g);
  log(`SW message handlers: ${JSON.stringify(msgHandlers?.slice(0, 20))}`);

  // Wait and monitor for any automatic content script action
  log('Waiting 30s for any automatic content script activity...');
  for (let i = 0; i < 6; i++) {
    await sleep(5000);
    log(`  ${(i+1)*5}s... (${consoleLogs.length} logs so far)`);
  }
  
  await shot(aliPage, 'after-wait');
  
  // Summary
  log('\n========== E2E v4 RESULTS ==========');
  log(`Total console logs: ${consoleLogs.length}`);
  const dfLogs = consoleLogs.filter(l => /DropFlow/i.test(l.text));
  log(`[DropFlow] logs: ${dfLogs.length}`);
  dfLogs.forEach(l => log(`  ${l.source}: ${l.text.substring(0, 200)}`));
  
  const errors = consoleLogs.filter(l => l.type === 'error');
  log(`Errors: ${errors.length}`);
  errors.slice(0, 10).forEach(l => log(`  ${l.source}: ${l.text.substring(0, 200)}`));
  
  const corsLogs = consoleLogs.filter(l => /cors/i.test(l.text));
  log(`CORS issues: ${corsLogs.length}`);
  
  log(`Screenshots: ${stepNum}`);
  log('====================================');
  
  fs.writeFileSync(path.join(SCREENSHOTS, 'console-logs.json'), JSON.stringify(consoleLogs, null, 2));
  
  await browser.disconnect();
  log('Done!');
})().catch(e => {
  console.error(`[E2E] FATAL: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
