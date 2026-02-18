/**
 * Fresh E2E test: Close existing pages, trigger new listing, capture all logs from the start.
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const WS = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const SS = '/Users/pyrite/Projects/dropflow-extension/test/screenshots';
const PRODUCT_URL = 'https://www.aliexpress.com/item/1005007380025405.html';

const allLogs = [];
function log(msg) { 
  const ts = new Date().toISOString().slice(11,19); 
  const line = `[${ts}] ${msg}`;
  console.log(line); 
  allLogs.push(line); 
}

let stepN = 0;
async function ss(page, label) {
  stepN++;
  const f = `fresh${String(stepN).padStart(2,'0')}_${label}.png`;
  try { await page.screenshot({ path: path.join(SS, f) }); log(`📸 ${f}`); }
  catch(e) { log(`📸 FAIL ${f}: ${e.message}`); }
}

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS, defaultViewport: null });
  log('Connected');

  // Close existing eBay and AliExpress pages
  const existingPages = await browser.pages();
  for (const p of existingPages) {
    const url = p.url();
    if (url.includes('ebay.com/lstng') || url.includes('aliexpress.com/item') || url.includes('ali-bulk-lister')) {
      log(`Closing: ${url.substring(0, 80)}`);
      await p.close().catch(() => {});
    }
  }
  await new Promise(r => setTimeout(r, 2000));

  // Wake and reload extension
  log('\n=== Reload extension ===');
  const wakePage = await browser.newPage();
  await wakePage.goto(`chrome-extension://${EXT_ID}/pages/popup/popup.html`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  await wakePage.evaluate(() => chrome.runtime.reload()).catch(e => log('reload: ' + e.message));
  await new Promise(r => setTimeout(r, 5000));
  
  // Reopen popup to wake SW
  await wakePage.goto(`chrome-extension://${EXT_ID}/pages/popup/popup.html`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
  log('Extension reloaded');
  await wakePage.close().catch(() => {});

  // Set up new tab listener BEFORE triggering
  log('\n=== Set up monitoring ===');
  const newPages = [];
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      try {
        const p = await target.page();
        if (p) {
          const url = target.url();
          log(`[TARGET] New page: ${url?.substring(0, 100)}`);
          newPages.push(p);
          
          // Attach console listener immediately
          p.on('console', m => {
            const text = m.text();
            // Capture ALL DropFlow logs
            if (text.includes('DropFlow') || text.includes('[DF]') || text.includes('dropflow')) {
              log(`[PAGE:${p.url().substring(0, 40)}] ${text}`);
            }
          });

          // Also try CDP-level console capture
          try {
            const cdp = await p.createCDPSession();
            await cdp.send('Runtime.enable');
            cdp.on('Runtime.consoleAPICalled', (params) => {
              const text = params.args.map(a => a.value ?? a.description ?? '').join(' ');
              if (text.includes('DropFlow') || text.includes('[DF]') || text.includes('dropflow') || text.includes('variation') || text.includes('builder') || text.includes('axis') || text.includes('chip')) {
                log(`[CDP:${p.url().substring(0, 40)}] ${text}`);
              }
            });
          } catch(_) {}
        }
      } catch(_) {}
    }
  });

  // Trigger listing via extension page
  log('\n=== Trigger listing ===');
  const triggerPage = await browser.newPage();
  await triggerPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1000));

  const result = await triggerPage.evaluate(async (url) => {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        payload: { links: [url], threadCount: 1, listingType: 'standard' }
      });
      return JSON.stringify(resp);
    } catch(e) { return 'Error: ' + e.message; }
  }, PRODUCT_URL);
  log('Trigger: ' + result);

  // Also attach to SW for console logs
  try {
    const swTargets = await browser.targets();
    const sw = swTargets.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
    if (sw) {
      log(`SW found: ${sw.url().substring(0, 60)}`);
      // Can't easily get SW console with puppeteer... but content script logs should be enough
    }
  } catch(_) {}

  // Monitor for up to 4 minutes
  log('\n=== Monitoring (4 min max) ===');
  const startTime = Date.now();
  const maxWait = 240000;
  let ebayPage = null;
  let variationTableFound = false;

  while (Date.now() - startTime < maxWait && !variationTableFound) {
    await new Promise(r => setTimeout(r, 5000));
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    const pages = await browser.pages();
    for (const p of pages) {
      try {
        const url = p.url();
        if (url.includes('ebay.com') && !url.includes('chrome-extension') && !ebayPage) {
          ebayPage = p;
          log(`[${elapsed}s] ✅ eBay page found: ${url}`);
          await ss(p, 'ebay_found');
          
          // Attach detailed console monitoring
          const cdp = await p.createCDPSession();
          await cdp.send('Runtime.enable');
          await cdp.send('Log.enable');
          
          cdp.on('Runtime.consoleAPICalled', (params) => {
            const text = params.args.map(a => a.value ?? a.description ?? '').join(' ');
            if (text.includes('DropFlow') || text.includes('variation') || text.includes('builder') || 
                text.includes('axis') || text.includes('chip') || text.includes('fillForm') ||
                text.includes('[DF]') || text.includes('specifics') || text.includes('STEP')) {
              log(`[EBAY_CDP] ${text}`);
            }
          });
        }
      } catch(_) {}
    }

    if (ebayPage) {
      try {
        // Check ALL frames for variation builder state
        const frames = ebayPage.frames();
        for (const frame of frames) {
          const furl = frame.url();
          if (!furl || furl === 'about:blank' || furl.includes('devicebind')) continue;

          const state = await frame.evaluate(() => {
            try {
              // Check for variation builder elements
              const body = document.body?.innerText || '';
              const hasVariation = body.includes('Variation') || body.includes('variation');
              const chips = document.querySelectorAll('.attr-chip, [class*="chip"], .listbox-component--option');
              const table = document.querySelector('.ve-table, table.variation-table, [class*="pricing-table"]');
              const builder = document.querySelector('.smeBulkEditVariation, [class*="variation-builder"]');
              
              // Get all inputs with values
              const filledInputs = [...document.querySelectorAll('input')].filter(i => i.value).map(i => ({
                name: i.name || i.getAttribute('aria-label') || i.placeholder || '',
                value: i.value.substring(0, 50)
              })).slice(0, 10);

              return {
                url: location.href.substring(0, 80),
                hasVariation,
                chips: chips.length,
                chipTexts: [...chips].map(c => c.textContent.trim()).slice(0, 10),
                hasTable: !!table,
                tableRows: table?.querySelectorAll('tr').length || 0,
                hasBuilder: !!builder,
                filledInputs,
                bodyLen: body.length
              };
            } catch(e) { return { error: e.message }; }
          }).catch(() => null);

          if (state && (state.hasBuilder || state.chips > 0 || state.hasTable)) {
            log(`[${elapsed}s] FRAME ${furl.substring(0, 60)}: builder=${state.hasBuilder} chips=${state.chips} table=${state.hasTable}(${state.tableRows}r)`);
            if (state.chipTexts.length) log(`  Chips: ${JSON.stringify(state.chipTexts)}`);
            if (state.filledInputs.length) log(`  Inputs: ${JSON.stringify(state.filledInputs)}`);

            if (state.hasTable && state.tableRows > 1) {
              log(`🎉 PRICING TABLE: ${state.tableRows} rows`);
              await ss(ebayPage, 'pricing_table_success');
              
              const tableData = await frame.evaluate(() => {
                const rows = [...document.querySelectorAll('tr')];
                return rows.slice(0, 15).map(r => r.textContent.trim().substring(0, 200));
              }).catch(() => []);
              log('Table rows:\n' + tableData.join('\n'));
              variationTableFound = true;
              break;
            }
          }
        }

        // Periodic screenshots
        if (elapsed % 20 === 0) await ss(ebayPage, `progress_${elapsed}s`);

      } catch(e) { /* page navigating */ }
    } else if (elapsed % 15 === 0) {
      log(`[${elapsed}s] Still waiting for eBay page...`);
    }
  }

  // Final state
  log('\n=== FINAL STATE ===');
  if (ebayPage) {
    await ss(ebayPage, 'final');
    
    // Scroll to variation section
    await ebayPage.evaluate(() => {
      const h = [...document.querySelectorAll('h2,h3,h4')].find(h => /variation/i.test(h.textContent));
      if (h) h.scrollIntoView({ block: 'start' });
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
    await ss(ebayPage, 'final_variations');
  }
  
  const pages = await browser.pages();
  log('Open pages:');
  for (const p of pages) { try { log(`  ${p.url()}`); } catch(_) {} }
  
  if (variationTableFound) {
    log('\n✅ TEST PASSED: Variation pricing table was populated');
  } else {
    log('\n❌ TEST INCOMPLETE: Pricing table not found within timeout');
  }

  fs.writeFileSync(path.join(SS, 'fresh-test-log.txt'), allLogs.join('\n'));
  browser.disconnect();
  log('Done');
}

run().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
