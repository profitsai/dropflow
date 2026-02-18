/**
 * DropFlow E2E v4 — Full flow via Ali Bulk Lister (corrected marketplace)
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
  try { await page.screenshot({ path: path.join(SCREENSHOTS, fname), fullPage: true }); log(`📸 ${fname}`); }
  catch(e) { log(`📸 FAIL ${fname}: ${e.message.substring(0,80)}`); }
}

function hookConsole(page, source) {
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push({ time: new Date().toISOString(), text, type: msg.type(), source });
    if (/DropFlow|CORS|upload.*image|image.*upload|error|variation|form.?fill/i.test(text) && !/favicon/i.test(text)) {
      log(`  📋 [${source}] ${text.substring(0, 300)}`);
    }
  });
  page.on('pageerror', err => {
    consoleLogs.push({ time: new Date().toISOString(), text: err.message, type: 'error', source });
    log(`  ❌ [${source}] ${err.message.substring(0, 200)}`);
  });
  page.on('requestfailed', req => {
    const url = req.url();
    if (/ebay|alicdn|dropflow/i.test(url)) {
      log(`  🚫 [${source}] FAIL: ${url.substring(0,100)} → ${req.failure()?.errorText}`);
    }
  });
}

(async () => {
  log('Connecting...');
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });

  // Monitor all new targets
  browser.on('targetcreated', async (target) => {
    const url = target.url();
    if (target.type() === 'page' && url && !url.startsWith('about:')) {
      log(`  🆕 New page: ${url.substring(0,100)}`);
      try {
        const p = await target.page();
        if (p) hookConsole(p, url.includes('ebay') ? 'ebay' : 'new-tab');
      } catch {}
    }
  });

  // Close extra tabs (keep at least one)
  log('Cleaning up tabs...');
  const existingPages = await browser.pages();
  for (let i = 1; i < existingPages.length; i++) {
    try { await existingPages[i].close(); } catch {}
  }
  await sleep(1000);

  // Auth
  log('Getting auth tokens...');
  const loginResp = await fetch('https://dropflow-api.onrender.com/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'e2e-test@dropflow.test', password: 'TestPass123!' })
  });
  const authData = await loginResp.json();

  // Open popup to inject tokens
  const tokenPage = await browser.newPage();
  await tokenPage.goto(`chrome-extension://${EXT_ID}/pages/popup/popup.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await sleep(1000);
  await tokenPage.evaluate(async (tokens) => {
    await chrome.storage.local.set({
      accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
      userEmail: tokens.user.email, userId: String(tokens.user.id)
    });
  }, authData);
  await tokenPage.close();
  log('Auth injected ✅');

  // Open Ali Bulk Lister
  log('Opening Ali Bulk Lister...');
  const listerPage = await browser.newPage();
  hookConsole(listerPage, 'lister');
  await listerPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, {
    waitUntil: 'domcontentloaded', timeout: 15000
  });
  await sleep(2000);

  // Configure
  await listerPage.type('#links-input', ALI_URL);
  await sleep(300);
  await listerPage.select('#ebay-marketplace', 'www.ebay.com.au');
  await listerPage.$eval('#thread-count', el => el.value = '1');
  
  // Verify config
  const config = await listerPage.evaluate(() => ({
    links: document.getElementById('link-count')?.textContent,
    marketplace: document.getElementById('ebay-marketplace')?.value,
    threads: document.getElementById('thread-count')?.value
  }));
  log(`Config: ${JSON.stringify(config)}`);
  await shot(listerPage, 'configured');

  // Start listing
  log('🚀 Starting listing...');
  await listerPage.click('#btn-start');
  await sleep(2000);
  await shot(listerPage, 'started');

  // Monitor flow
  let ebayPage = null;
  let phase = 'waiting'; // waiting → scraping → ebay-form → filling → variations → images → complete
  let stableCount = 0;
  let lastState = '';

  for (let tick = 0; tick < 180; tick++) {  // 6 minutes max
    await sleep(2000);
    
    // Check lister progress
    const progress = await listerPage.evaluate(() => ({
      pos: document.getElementById('stat-position')?.textContent,
      total: document.getElementById('stat-total')?.textContent,
      ok: document.getElementById('stat-success')?.textContent,
      fail: document.getElementById('stat-fail')?.textContent,
      bar: document.getElementById('progress-bar')?.style.width,
      rows: document.querySelectorAll('#results-body tr').length,
      running: !document.getElementById('btn-start')?.disabled === false
    })).catch(() => ({}));
    
    // Find eBay form tab
    if (!ebayPage) {
      const allPages = await browser.pages();
      for (const p of allPages) {
        const u = p.url();
        if (u.includes('ebay.com') && (u.includes('/sl/') || u.includes('/lstng') || u.includes('/sell'))) {
          ebayPage = p;
          hookConsole(ebayPage, 'ebay-form');
          log(`🎯 eBay form tab: ${u.substring(0,100)}`);
          phase = 'ebay-form';
          await shot(listerPage, 'lister-at-ebay');
          break;
        }
      }
    }
    
    // Monitor eBay form state
    if (ebayPage) {
      try {
        const ebayState = await ebayPage.evaluate(() => {
          const body = document.body?.innerText || '';
          const url = window.location.href;
          
          // Check for error pages
          if (body.includes('embarrassing') || body.includes('try again later')) return { phase: 'error', url };
          if (body.includes('Sign in') && url.includes('signin')) return { phase: 'login-required', url };
          
          // Check for prelist page
          if (url.includes('/sl/prelist')) return { phase: 'prelist', url, bodyLen: body.length };
          
          // Check for listing form
          if (url.includes('/lstng') || url.includes('/sl/sell') || url.includes('/sl/create')) {
            // Check what's filled
            const title = document.querySelector('input[name*="title" i], [data-testid*="title" i]')?.value || '';
            const imgs = document.querySelectorAll('img[src*="ebayimg"], [class*="photo"] img, [class*="image-upload"] img').length;
            const variations = document.querySelectorAll('[class*="variation" i], [class*="msku" i]').length;
            const condition = document.querySelector('[class*="condition" i] select, [data-testid*="condition"]')?.value || '';
            
            // Check for variation builder
            const hasVarBuilder = !!(document.querySelector('[class*="variation-builder" i], [class*="msku" i], [data-testid*="variation"]'));
            
            // Check buttons
            const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim().substring(0,30)).filter(Boolean);
            
            return {
              phase: 'listing-form', url,
              title: title.substring(0,60), imgs, variations, condition,
              hasVarBuilder, btns: btns.slice(0,10)
            };
          }
          
          return { phase: 'unknown', url: url.substring(0,80), bodyLen: body.length };
        }).catch(e => ({ phase: 'eval-error', error: e.message.substring(0,80) }));
        
        const stateStr = JSON.stringify(ebayState);
        if (stateStr !== lastState) {
          log(`  📊 eBay: ${stateStr}`);
          lastState = stateStr;
          stableCount = 0;
          
          // Screenshot on state change
          await ebayPage.bringToFront();
          await shot(ebayPage, `ebay-${ebayState.phase}`);
          await listerPage.bringToFront();
        } else {
          stableCount++;
        }
        
        // If error, break early
        if (ebayState.phase === 'error') {
          log('❌ eBay listing tool errored');
          await ebayPage.bringToFront();
          await shot(ebayPage, 'ebay-error');
          break;
        }
        
        // If listing form with images and variations, we're close to done
        if (ebayState.phase === 'listing-form' && ebayState.imgs > 0 && ebayState.hasVarBuilder) {
          log('✅ Listing form with images and variations!');
          await ebayPage.bringToFront();
          await shot(ebayPage, 'ebay-success');
          phase = 'success';
        }
        
      } catch(e) {
        // eBay page might have been closed/navigated
        if (e.message.includes('closed') || e.message.includes('detached')) {
          log('  eBay page closed/navigated, looking for new one...');
          ebayPage = null;
        }
      }
    }
    
    // Check if listing complete
    if (progress.ok === '1' || progress.fail === '1') {
      log(`Listing result: success=${progress.ok} fail=${progress.fail}`);
      await shot(listerPage, 'lister-complete');
      
      // Get result details
      const results = await listerPage.evaluate(() => {
        return [...document.querySelectorAll('#results-body tr')].map(r => ({
          cells: [...r.querySelectorAll('td')].map(c => c.textContent.trim().substring(0,100))
        }));
      }).catch(() => []);
      log(`Results: ${JSON.stringify(results)}`);
      break;
    }
    
    // Timeout check with logging
    if (tick > 0 && tick % 15 === 0) {
      log(`  ⏱️  ${tick*2}s elapsed | phase: ${phase} | progress: ${progress.pos}/${progress.total} | logs: ${consoleLogs.length}`);
      await shot(listerPage, `tick-${tick}`);
    }
    
    // If stable for 60s with error or unknown state, break
    if (stableCount > 30 && lastState.includes('error')) {
      log('State stable with error for 60s, breaking');
      break;
    }
  }

  // Final analysis
  log('\n========== FINAL SCREENSHOTS ==========');
  await shot(listerPage, 'final-lister');
  if (ebayPage) {
    try {
      await ebayPage.bringToFront();
      await sleep(2000);
      await shot(ebayPage, 'final-ebay');
      
      // Scroll down on eBay page for full form screenshot
      await ebayPage.evaluate(() => window.scrollBy(0, 500));
      await sleep(1000);
      await shot(ebayPage, 'final-ebay-scrolled');
    } catch {}
  }
  
  // All pages check
  const finalPages = await browser.pages();
  log(`\nFinal pages (${finalPages.length}):`);
  for (const p of finalPages) log(`  ${p.url().substring(0,100)}`);

  // Console log analysis
  log('\n========== E2E v4 RESULTS ==========');
  const dfLogs = consoleLogs.filter(l => /\[DropFlow\]/i.test(l.text));
  const corsLogs = consoleLogs.filter(l => /cors|access-control-allow/i.test(l.text));
  const uploadLogs = consoleLogs.filter(l => /upload/i.test(l.text));
  const variationLogs = consoleLogs.filter(l => /variation|msku/i.test(l.text));
  const errorLogs = consoleLogs.filter(l => l.type === 'error' && !/favicon/i.test(l.text));
  
  log(`Total logs: ${consoleLogs.length}`);
  log(`[DropFlow] logs: ${dfLogs.length}`);
  log(`CORS issues: ${corsLogs.length}`);
  log(`Upload logs: ${uploadLogs.length}`);
  log(`Variation logs: ${variationLogs.length}`);
  log(`Errors: ${errorLogs.length}`);
  
  if (dfLogs.length) {
    log('\n--- [DropFlow] Logs ---');
    dfLogs.forEach(l => log(`  [${l.source}] ${l.text.substring(0, 300)}`));
  }
  if (corsLogs.length) {
    log('\n--- CORS Issues ---');
    corsLogs.forEach(l => log(`  [${l.source}] ${l.text.substring(0, 200)}`));
  }
  if (errorLogs.length) {
    log('\n--- Errors ---');
    errorLogs.slice(-20).forEach(l => log(`  [${l.source}] ${l.text.substring(0, 200)}`));
  }
  
  // Verification checklist
  log('\n--- VERIFICATION CHECKLIST ---');
  log(`✅/❌ CORS errors: ${corsLogs.length === 0 ? '✅ NONE' : `❌ ${corsLogs.length} found`}`);
  log(`✅/❌ eBay form loaded: ${lastState.includes('listing-form') ? '✅' : '❌'}`);
  log(`✅/❌ Variation builder: ${lastState.includes('hasVarBuilder') ? '✅' : '❌'}`);
  log(`✅/❌ Images uploaded: ${/imgs.*[1-9]/.test(lastState) ? '✅' : '❌'}`);
  log(`✅/❌ No JS errors: ${errorLogs.length === 0 ? '✅' : `❌ ${errorLogs.length} errors`}`);
  log('==========================================');
  
  fs.writeFileSync(path.join(SCREENSHOTS, 'console-logs-final.json'), JSON.stringify(consoleLogs, null, 2));
  fs.writeFileSync(path.join(SCREENSHOTS, 'dropflow-logs.json'), JSON.stringify(dfLogs, null, 2));
  
  await browser.disconnect();
  log('Done!');
})().catch(e => {
  console.error(`[E2E] FATAL: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
