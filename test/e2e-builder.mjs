import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const WS = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const SS = '/Users/pyrite/Projects/dropflow-extension/test/screenshots';
const PRODUCT_URL = 'https://www.aliexpress.com/item/1005007380025405.html';

let stepN = 0;
async function ss(page, label) {
  stepN++;
  const f = `step${String(stepN).padStart(2,'0')}_${label}.png`;
  try { await page.screenshot({ path: path.join(SS, f) }); console.log(`📸 ${f}`); }
  catch(e) { console.log(`📸 FAIL ${f}: ${e.message}`); }
}

const allLogs = [];
function log(msg) { console.log(msg); allLogs.push(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

async function run() {
  log('Connecting...');
  const browser = await puppeteer.connect({ browserWSEndpoint: WS, defaultViewport: null });
  log('Connected ✅');

  // Step 1: Skip reload - just ensure SW is active by opening popup
  log('\n=== STEP 1: Wake extension ===');
  const wakePage = await browser.newPage();
  await wakePage.goto(`chrome-extension://${EXT_ID}/pages/popup/popup.html`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(e => log('popup: ' + e.message));
  await new Promise(r => setTimeout(r, 2000));
  await ss(wakePage, 'popup');
  
  // Use popup page to trigger reload
  await wakePage.evaluate(() => chrome.runtime.reload()).catch(e => log('reload via popup: ' + e.message));
  await new Promise(r => setTimeout(r, 4000));
  
  // Re-open popup to wake SW after reload
  await wakePage.goto(`chrome-extension://${EXT_ID}/pages/popup/popup.html`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
  log('Extension reloaded & popup reopened');
  await wakePage.close().catch(() => {});

  // Step 2: Trigger listing flow via the popup/extension page
  // We'll use an extension page context to send the message to the SW
  log('\n=== STEP 2: Trigger AliExpress listing ===');
  const triggerPage = await browser.newPage();
  await triggerPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1000));
  
  // Trigger the bulk listing via chrome.runtime.sendMessage
  const triggerResult = await triggerPage.evaluate(async (url) => {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        payload: {
          links: [url],
          threadCount: 1,
          listingType: 'standard'
        }
      });
      return JSON.stringify(resp);
    } catch(e) {
      return 'Error: ' + e.message;
    }
  }, PRODUCT_URL);
  log('Trigger result: ' + triggerResult);
  await ss(triggerPage, 'trigger');

  // Step 3: Monitor for eBay page
  log('\n=== STEP 3: Monitor flow (up to 3 min) ===');
  
  let ebayPage = null;
  let lastScreenshotTime = 0;
  const startTime = Date.now();
  const maxWait = 180000;
  
  browser.on('targetcreated', async (target) => {
    const url = target.url();
    if (url && (url.includes('ebay') || url.includes('bulkedit'))) {
      log(`[NEW TAB] ${url}`);
    }
  });

  // Also capture SW logs by polling from extension page context
  const logPoll = setInterval(async () => {
    try {
      const swState = await triggerPage.evaluate(async () => {
        try {
          const resp = await chrome.runtime.sendMessage({ type: 'GET_ALI_BULK_STATUS' });
          return JSON.stringify(resp);
        } catch(e) { return e.message; }
      });
      if (swState && swState !== 'undefined') log(`[SW_STATUS] ${swState}`);
    } catch(_) {}
  }, 10000);

  while (Date.now() - startTime < maxWait) {
    await new Promise(r => setTimeout(r, 3000));
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    
    // Check all pages for eBay
    const pages = await browser.pages();
    for (const p of pages) {
      try {
        const url = p.url();
        if (url.includes('ebay') && !url.includes('chrome-extension') && !ebayPage) {
          ebayPage = p;
          log(`[${elapsed}s] ✅ Found eBay page: ${url}`);
          
          p.on('console', m => {
            const t = m.text();
            if (t.includes('DropFlow') || t.includes('[DF]')) log(`[EBAY] ${t}`);
          });
          
          await ss(p, 'ebay_found');
        }
      } catch(_) {}
    }

    if (ebayPage) {
      try {
        const frames = ebayPage.frames();
        for (const frame of frames) {
          const furl = frame.url();
          if (!furl || furl === 'about:blank') continue;
          
          const state = await frame.evaluate(() => {
            try {
              const chips = document.querySelectorAll('.attr-chip, [class*="chip"], .listbox-component--option, .smeBulkEditVariation__axis');
              const table = document.querySelector('.ve-table, table, [class*="pricing"], .smeBulkEditVariation__table');
              const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
              const chipTexts = [...chips].map(el => el.textContent.trim()).filter(Boolean).slice(0, 15);
              const tableRows = table ? table.querySelectorAll('tr, .ve-table-body-tr').length : 0;
              
              // Check for builder root
              const builderRoot = document.querySelector('.smeBulkEditVariation, [class*="variation-builder"], [class*="VariationBuilder"]');
              
              return {
                url: location.href.substring(0, 80),
                chips: chips.length,
                chipTexts,
                hasTable: !!table,
                tableRows,
                inputs: inputs.length,
                hasBuilder: !!builderRoot,
                bodyLen: (document.body?.innerText || '').length
              };
            } catch(e) { return { error: e.message }; }
          }).catch(() => null);
          
          if (state && (state.hasBuilder || state.chips > 0 || state.hasTable)) {
            log(`[${elapsed}s] BUILDER: chips=${state.chips} table=${state.hasTable}(${state.tableRows}rows) inputs=${state.inputs} chipTexts=${JSON.stringify(state.chipTexts)}`);
            
            if (state.hasTable && state.tableRows > 1) {
              log(`🎉 PRICING TABLE with ${state.tableRows} rows!`);
              await ss(ebayPage, 'pricing_table_success');
              
              // Get pricing data
              const pricingData = await frame.evaluate(() => {
                const rows = document.querySelectorAll('tr, .ve-table-body-tr');
                return [...rows].slice(0, 15).map(r => r.textContent.trim().substring(0, 200));
              }).catch(() => []);
              log('Pricing rows:\n' + pricingData.join('\n'));
              
              clearInterval(logPoll);
              fs.writeFileSync(path.join(SS, 'final-log.txt'), allLogs.join('\n'));
              browser.disconnect();
              return;
            }
          }
        }
      } catch(_) {}
      
      // Periodic eBay screenshot
      if (Date.now() - lastScreenshotTime > 15000) {
        lastScreenshotTime = Date.now();
        await ss(ebayPage, `ebay_${elapsed}s`);
      }
    } else if (elapsed % 20 === 0) {
      // List all pages while waiting
      log(`[${elapsed}s] Waiting for eBay page... Open pages:`);
      for (const p of pages) {
        try { log(`  ${p.url().substring(0, 100)}`); } catch(_) {}
      }
    }
  }

  log('\n⏰ Timeout reached');
  clearInterval(logPoll);
  
  if (ebayPage) await ss(ebayPage, 'timeout_ebay');
  
  // Final dump
  const pages = await browser.pages();
  log('\nAll pages:');
  for (const p of pages) { try { log(`  ${p.url()}`); } catch(_) {} }
  
  // Get final SW state
  try {
    const finalState = await triggerPage.evaluate(async () => {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_ALI_BULK_STATUS' });
      return JSON.stringify(resp);
    });
    log('Final SW state: ' + finalState);
  } catch(_) {}
  
  fs.writeFileSync(path.join(SS, 'final-log.txt'), allLogs.join('\n'));
  browser.disconnect();
  log('Done.');
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
