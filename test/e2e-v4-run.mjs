/**
 * DropFlow E2E v4 — Full flow via Ali Bulk Lister
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
  catch(e) { log(`📸 FAIL ${fname}: ${e.message.substring(0,80)}`); }
}

function hookConsole(page, source) {
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push({ time: new Date().toISOString(), text, type: msg.type(), source });
    if (/DropFlow|dropflow|CORS|cors|upload|image|error|fail|blocked/i.test(text)) {
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

  // Hook new target creation to monitor all new pages
  browser.on('targetcreated', async (target) => {
    log(`  🆕 Target created: ${target.type()} → ${target.url().substring(0,100)}`);
    if (target.type() === 'page') {
      try {
        const p = await target.page();
        if (p) hookConsole(p, `new-${target.url().includes('ebay') ? 'ebay' : 'page'}`);
      } catch {}
    }
  });

  // Step 0: Fresh auth tokens
  log('Step 0: Auth...');
  const loginResp = await fetch('https://dropflow-api.onrender.com/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'e2e-test@dropflow.test', password: 'TestPass123!' })
  });
  const authData = await loginResp.json();
  log(`Auth: ${authData.user?.email}`);

  // Inject tokens via extension page
  let extPage = (await browser.pages()).find(p => p.url().includes(`chrome-extension://${EXT_ID}`));
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${EXT_ID}/pages/popup/popup.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1000);
  }
  
  await extPage.evaluate(async (tokens) => {
    await chrome.storage.local.set({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      userEmail: tokens.user.email,
      userId: String(tokens.user.id)
    });
  }, authData);
  log('Tokens injected');

  // Close all non-essential pages
  const pages = await browser.pages();
  for (const p of pages) {
    const u = p.url();
    if (!u.includes('extensions') && u !== 'about:blank') {
      try { await p.close(); } catch {}
    }
  }

  // Step 1: Open Ali Bulk Lister
  log('Step 1: Opening Ali Bulk Lister...');
  const listerPage = await browser.newPage();
  hookConsole(listerPage, 'lister');
  await listerPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, {
    waitUntil: 'domcontentloaded', timeout: 15000
  });
  await sleep(2000);
  await shot(listerPage, 'lister-opened');

  // Step 2: Paste AliExpress URL and configure
  log('Step 2: Configuring listing...');
  
  // Type the URL
  await listerPage.type('#links-input', ALI_URL);
  await sleep(500);
  
  // Check link count
  const linkCount = await listerPage.$eval('#link-count', el => el.textContent);
  log(`Links detected: ${linkCount}`);
  
  // Set thread count to 1 for easier monitoring
  await listerPage.$eval('#thread-count', el => el.value = '1');
  
  // Set eBay marketplace
  const marketplaceSelect = await listerPage.$('#ebay-marketplace');
  if (marketplaceSelect) {
    await listerPage.select('#ebay-marketplace', 'ebay.com.au');
    log('Set marketplace: ebay.com.au');
  }
  
  await shot(listerPage, 'lister-configured');

  // Step 3: Click Start
  log('Step 3: Starting bulk listing...');
  await listerPage.click('#btn-start');
  await sleep(3000);
  await shot(listerPage, 'lister-started');

  // Step 4-7: Monitor the entire flow
  log('Step 4: Monitoring flow...');
  
  let ebayPageFound = false;
  let ebayPage = null;
  let lastProgress = '';
  
  // Monitor for up to 5 minutes
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    
    // Check lister progress
    const progress = await listerPage.evaluate(() => {
      return {
        position: document.getElementById('stat-position')?.textContent || '',
        total: document.getElementById('stat-total')?.textContent || '',
        success: document.getElementById('stat-success')?.textContent || '',
        fail: document.getElementById('stat-fail')?.textContent || '',
        progressBar: document.getElementById('progress-bar')?.style.width || '',
        resultRows: document.querySelectorAll('#results-body tr').length,
        isRunning: document.getElementById('btn-pause')?.style.display !== 'none'
      };
    }).catch(() => ({}));
    
    const progressStr = JSON.stringify(progress);
    if (progressStr !== lastProgress) {
      log(`  Progress: ${progressStr}`);
      lastProgress = progressStr;
    }
    
    // Check for new eBay pages
    if (!ebayPageFound) {
      const allPages = await browser.pages();
      for (const p of allPages) {
        const url = p.url();
        if (url.includes('ebay.com') && (url.includes('sell') || url.includes('create') || url.includes('lstng') || url.includes('sl/'))) {
          ebayPage = p;
          ebayPageFound = true;
          hookConsole(ebayPage, 'ebay-form');
          log(`🎯 eBay form detected: ${url}`);
          break;
        }
        // Also check for AliExpress tab opened by extension
        if (url.includes('aliexpress.com/item') && !url.includes('popup')) {
          hookConsole(p, 'ali-tab');
        }
      }
    }
    
    // If eBay page found, take screenshots periodically
    if (ebayPage && i % 10 === 0) {
      try {
        await ebayPage.bringToFront();
        await shot(ebayPage, `ebay-form-${i}`);
        
        // Check form state
        const formState = await ebayPage.evaluate(() => {
          // Check for iframe (eBay uses iframes extensively)
          const iframes = [...document.querySelectorAll('iframe')].map(f => f.src?.substring(0,80));
          
          // Look for variation builder elements
          const allText = document.body?.innerText?.substring(0, 2000) || '';
          const hasVariation = /variation|option|color|size/i.test(allText);
          const hasImage = document.querySelectorAll('img[src*="ebayimg"], img[src*="upload"]').length;
          const hasTitle = document.querySelector('input[name*="title"], [data-testid*="title"]')?.value || '';
          
          return { iframes: iframes.slice(0,5), hasVariation, hasImage, hasTitle: hasTitle.substring(0,80) };
        }).catch(() => ({}));
        log(`  eBay form: ${JSON.stringify(formState)}`);
        
        await listerPage.bringToFront();
      } catch(e) {
        log(`  eBay page check error: ${e.message.substring(0,80)}`);
      }
    }
    
    // Check if complete
    if (progress.success === '1' || progress.fail === '1' || !progress.isRunning) {
      if (i > 10) { // Give it at least 20s
        log('Listing appears complete or stopped');
        break;
      }
    }
    
    // Log every 30s
    if (i % 15 === 14) {
      log(`  ${(i+1)*2}s elapsed, ${consoleLogs.length} console logs`);
      await shot(listerPage, `progress-${Math.floor(i/15)}`);
    }
  }
  
  // Final screenshots
  await shot(listerPage, 'lister-final');
  
  if (ebayPage) {
    try {
      await ebayPage.bringToFront();
      await sleep(2000);
      await shot(ebayPage, 'ebay-final');
      
      // Detailed eBay form analysis
      log('\n=== eBay Form Analysis ===');
      
      // Check for variation images
      const analysis = await ebayPage.evaluate(() => {
        const body = document.body?.innerText || '';
        return {
          url: window.location.href,
          bodyLength: body.length,
          bodyPreview: body.substring(0, 500),
          images: document.querySelectorAll('img').length,
          inputs: document.querySelectorAll('input').length,
          buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim().substring(0,30)).filter(Boolean).slice(0,10)
        };
      }).catch(() => ({}));
      log(`Analysis: ${JSON.stringify(analysis)}`);
    } catch {}
  }
  
  // Get results from the lister
  const results = await listerPage.evaluate(() => {
    const rows = document.querySelectorAll('#results-body tr');
    return [...rows].map(r => {
      const cells = r.querySelectorAll('td');
      return [...cells].map(c => c.textContent.trim().substring(0,80)).join(' | ');
    });
  }).catch(() => []);
  log(`\nResults table: ${JSON.stringify(results)}`);
  
  // Summary
  log('\n========== E2E v4 FINAL RESULTS ==========');
  const dfLogs = consoleLogs.filter(l => /DropFlow/i.test(l.text));
  const corsLogs = consoleLogs.filter(l => /cors|access-control/i.test(l.text));
  const uploadLogs = consoleLogs.filter(l => /upload|image.*upload/i.test(l.text));
  const errorLogs = consoleLogs.filter(l => l.type === 'error');
  
  log(`Total console logs: ${consoleLogs.length}`);
  log(`[DropFlow] logs: ${dfLogs.length}`);
  log(`CORS issues: ${corsLogs.length}`);
  log(`Upload-related logs: ${uploadLogs.length}`);
  log(`JS errors: ${errorLogs.length}`);
  log(`eBay form found: ${ebayPageFound}`);
  log(`Screenshots: ${stepNum}`);
  
  if (dfLogs.length) {
    log('\n--- DropFlow Logs (last 30) ---');
    dfLogs.slice(-30).forEach(l => log(`  [${l.source}] ${l.text.substring(0, 200)}`));
  }
  if (corsLogs.length) {
    log('\n--- CORS Issues ---');
    corsLogs.forEach(l => log(`  [${l.source}] ${l.text.substring(0, 200)}`));
  }
  if (errorLogs.length) {
    log('\n--- JS Errors (last 20) ---');
    errorLogs.slice(-20).forEach(l => log(`  [${l.source}] ${l.text.substring(0, 200)}`));
  }
  log('==========================================');
  
  fs.writeFileSync(path.join(SCREENSHOTS, 'console-logs-v4.json'), JSON.stringify(consoleLogs, null, 2));
  
  await browser.disconnect();
  log('Done!');
})().catch(e => {
  console.error(`[E2E] FATAL: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
