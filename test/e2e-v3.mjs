/**
 * E2E v3: Reload extension (reset state), close old pages, trigger fresh listing.
 * Open the trigger page AFTER reload, from a fresh context.
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
  const ts = new Date().toISOString().slice(11, 19); 
  const line = `[${ts}] ${msg}`;
  console.log(line); 
  allLogs.push(line); 
}

let stepN = 0;
async function ss(page, label) {
  stepN++;
  const f = `v3_${String(stepN).padStart(2, '0')}_${label}.png`;
  try { await page.screenshot({ path: path.join(SS, f) }); log(`📸 ${f}`); }
  catch (e) { log(`📸 FAIL: ${e.message}`); }
}

function save() {
  fs.writeFileSync(path.join(SS, 'v3-log.txt'), allLogs.join('\n'));
}

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS, defaultViewport: null });
  log('Connected');

  // 1. Close ALL eBay/AliExpress/extension pages
  for (const p of await browser.pages()) {
    const url = p.url();
    if (url.includes('ebay.com') || url.includes('aliexpress.com/item') || 
        (url.includes(EXT_ID) && !url.includes('extensions'))) {
      log(`Closing: ${url.substring(0, 60)}`);
      await p.close().catch(() => {});
    }
  }
  await new Promise(r => setTimeout(r, 1000));

  // 2. Reload extension to reset SW state (aliBulkRunning etc.)
  log('\n=== Reload extension ===');
  // Open a fresh page and navigate to extension popup to reload
  const reloadPage = await browser.newPage();
  await reloadPage.goto(`chrome-extension://${EXT_ID}/pages/popup/popup.html`, { 
    waitUntil: 'domcontentloaded', timeout: 10000 
  }).catch(() => {});
  
  const reloaded = await reloadPage.evaluate(() => {
    try { chrome.runtime.reload(); return true; }
    catch (e) { return e.message; }
  });
  log('Reload: ' + reloaded);
  await reloadPage.close().catch(() => {});
  
  // Wait for SW to restart
  await new Promise(r => setTimeout(r, 6000));

  // 3. Set up target monitoring
  let ebayPage = null;
  let ebayPageCdp = null;
  
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      const url = target.url();
      if (url && url !== 'about:blank') {
        log(`[NEW_PAGE] ${url.substring(0, 100)}`);
      }
    }
  });

  // 4. Open FRESH trigger page and send message
  log('\n=== Trigger ===');
  const triggerPage = await browser.newPage();
  await triggerPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, {
    waitUntil: 'domcontentloaded', timeout: 10000
  }).catch(e => log('trigger nav: ' + e.message));
  await new Promise(r => setTimeout(r, 2000));

  const trigResult = await triggerPage.evaluate(async (url) => {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve('TIMEOUT'), 20000);
      try {
        chrome.runtime.sendMessage({
          type: 'START_ALI_BULK_LISTING',
          payload: { links: [url], threadCount: 1, listingType: 'standard' }
        }, (resp) => {
          clearTimeout(t);
          resolve(JSON.stringify(resp));
        });
      } catch (e) {
        clearTimeout(t);
        resolve('ERROR: ' + e.message);
      }
    });
  }, PRODUCT_URL);
  log('Result: ' + trigResult);

  if (trigResult.includes('error') || trigResult === 'TIMEOUT') {
    log('⚠️ Trigger may have failed, continuing to monitor...');
  }

  // 5. Monitor for eBay page and builder progress
  log('\n=== Monitor (5 min) ===');
  const startTime = Date.now();
  const maxWait = 300000;
  let pricingFound = false;

  while (Date.now() - startTime < maxWait && !pricingFound) {
    await new Promise(r => setTimeout(r, 4000));
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // Find eBay page if not found yet
    if (!ebayPage) {
      for (const p of await browser.pages()) {
        try {
          const url = p.url();
          if (url.includes('ebay.com') && (url.includes('lstng') || url.includes('bulkedit'))) {
            ebayPage = p;
            log(`[${elapsed}s] ✅ eBay page: ${url}`);
            await ss(p, 'ebay_found');

            // CDP console monitoring - capture EVERYTHING from content scripts
            ebayPageCdp = await p.createCDPSession();
            await ebayPageCdp.send('Runtime.enable');
            
            ebayPageCdp.on('Runtime.consoleAPICalled', (params) => {
              const text = params.args.map(a => a.value ?? a.description ?? '').join(' ');
              // Capture ALL DropFlow and variation-related logs
              if (text.includes('DropFlow') || text.includes('[DF]') || text.includes('variation') ||
                  text.includes('builder') || text.includes('axis') || text.includes('chip') ||
                  text.includes('fillForm') || text.includes('STEP') || text.includes('specifics') ||
                  text.includes('iframe') || text.includes('bulkedit') || text.includes('lock') ||
                  text.includes('combo') || text.includes('pricing') || text.includes('table') ||
                  text.includes('option') || text.includes('attribute') || text.includes('scrape') ||
                  text.includes('draft') || text.includes('image') || text.includes('_dfLog')) {
                log(`[E:${elapsed}s] ${text.substring(0, 400)}`);
              }
            });
            break;
          }
        } catch (_) {}
      }
    }

    if (ebayPage) {
      try {
        const frames = ebayPage.frames();
        for (const frame of frames) {
          const furl = frame.url();
          if (!furl || furl === 'about:blank' || furl.includes('devicebind')) continue;

          const state = await frame.evaluate(() => {
            try {
              const chips = document.querySelectorAll('.attr-chip, [class*="chip"], .listbox-component--option, .smeBulkEditVariation__axis');
              const table = document.querySelector('.ve-table, table, [class*="pricing"]');
              const builder = document.querySelector('.smeBulkEditVariation, [class*="variation-builder"], [class*="VariationBuilder"]');
              const tableRows = table ? table.querySelectorAll('tr, .ve-table-body-tr').length : 0;
              
              // Also check for variation-related text
              const body = document.body?.innerText || '';
              const varSectionMatch = body.match(/Variation[^]*?(?=Description|Pricing|$)/i);
              
              return {
                chips: chips.length,
                chipTexts: [...chips].map(c => c.textContent.trim()).slice(0, 10),
                hasTable: !!table,
                tableRows,
                hasBuilder: !!builder,
                variationText: varSectionMatch ? varSectionMatch[0].substring(0, 200) : null
              };
            } catch { return null; }
          }).catch(() => null);

          if (state && (state.hasBuilder || state.chips > 0 || state.hasTable || state.variationText)) {
            log(`[${elapsed}s] STATE: chips=${state.chips} table=${state.hasTable}(${state.tableRows}r) builder=${state.hasBuilder}`);
            if (state.chipTexts?.length) log(`  Chips: ${JSON.stringify(state.chipTexts)}`);
            if (state.variationText) log(`  VarText: ${state.variationText.substring(0, 100)}`);
            
            if (state.hasTable && state.tableRows > 1) {
              log(`🎉 PRICING TABLE: ${state.tableRows} rows!`);
              await ss(ebayPage, 'pricing_table');
              
              const tableData = await frame.evaluate(() => {
                return [...document.querySelectorAll('tr')].slice(0, 15).map(r => r.textContent.trim().substring(0, 200));
              }).catch(() => []);
              log('Rows:\n' + tableData.join('\n'));
              pricingFound = true;
              break;
            }
          }
        }

        if (elapsed % 30 === 0) await ss(ebayPage, `progress_${elapsed}s`);
      } catch (_) {}
    } else if (elapsed % 20 === 0) {
      const urls = [];
      for (const p of await browser.pages()) { try { urls.push(p.url().substring(0, 50)); } catch {} }
      log(`[${elapsed}s] Waiting... [${urls.join(', ')}]`);
    }
  }

  // Final
  log('\n=== RESULT ===');
  if (ebayPage) {
    await ebayPage.evaluate(() => {
      const h = [...document.querySelectorAll('h2,h3,h4')].find(h => /variation/i.test(h.textContent));
      if (h) h.scrollIntoView({ block: 'start' });
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
    await ss(ebayPage, 'final_variation');
    
    // Get full variation section text
    const varText = await ebayPage.evaluate(() => {
      const sections = document.body?.innerText || '';
      const match = sections.match(/VARIATIONS?\s*[\s\S]*?(?=CONDITION|DESCRIPTION|PRICING|$)/i);
      return match ? match[0].substring(0, 1000) : 'Not found';
    }).catch(() => 'Error');
    log('Variation section text: ' + varText);
  }

  log(pricingFound ? '\n✅ PASS: Pricing table populated' : '\n❌ FAIL: Pricing table not found');
  save();
  browser.disconnect();
}

run().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
