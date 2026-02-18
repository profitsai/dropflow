/**
 * Fresh E2E v2: Don't reload extension. Open trigger page AFTER monitoring setup.
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
  const f = `fresh2_${String(stepN).padStart(2,'0')}_${label}.png`;
  try { await page.screenshot({ path: path.join(SS, f) }); log(`📸 ${f}`); }
  catch(e) { log(`📸 FAIL: ${e.message}`); }
}

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS, defaultViewport: null });
  log('Connected');

  // Close any old ebay/ali pages 
  for (const p of await browser.pages()) {
    const url = p.url();
    if (url.includes('ebay.com/lstng') || url.includes('aliexpress.com/item')) {
      log(`Closing: ${url.substring(0, 60)}`);
      await p.close().catch(() => {});
    }
  }
  await new Promise(r => setTimeout(r, 1000));

  // Set up target monitoring FIRST
  let ebayPage = null;
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      const url = target.url();
      if (url && url !== 'about:blank') log(`[NEW] ${url.substring(0, 100)}`);
    }
  });

  // Open trigger page and send message (no reload - keep existing SW)
  log('\n=== Trigger listing ===');
  const triggerPage = await browser.newPage();
  await triggerPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { 
    waitUntil: 'domcontentloaded', timeout: 10000 
  }).catch(e => log('nav: ' + e.message));
  await new Promise(r => setTimeout(r, 1500));

  // Send message with a timeout wrapper
  const result = await triggerPage.evaluate(async (url) => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve('TIMEOUT after 15s'), 15000);
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        payload: { links: [url], threadCount: 1, listingType: 'standard' }
      }, (resp) => {
        clearTimeout(timeout);
        resolve(JSON.stringify(resp));
      });
    });
  }, PRODUCT_URL);
  log('Trigger result: ' + result);

  // Monitor
  log('\n=== Monitor (4 min) ===');
  const startTime = Date.now();
  const maxWait = 240000;
  let pricingFound = false;
  let ebayPageCdp = null;

  while (Date.now() - startTime < maxWait && !pricingFound) {
    await new Promise(r => setTimeout(r, 5000));
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // Find eBay page
    if (!ebayPage) {
      for (const p of await browser.pages()) {
        try {
          const url = p.url();
          if (url.includes('ebay.com') && (url.includes('lstng') || url.includes('bulkedit') || url.includes('sell'))) {
            ebayPage = p;
            log(`[${elapsed}s] ✅ eBay: ${url}`);
            await ss(p, 'ebay_found');

            // Attach CDP console monitoring
            ebayPageCdp = await p.createCDPSession();
            await ebayPageCdp.send('Runtime.enable');
            ebayPageCdp.on('Runtime.consoleAPICalled', (params) => {
              const text = params.args.map(a => a.value ?? a.description ?? '').join(' ');
              if (text.includes('DropFlow') || text.includes('[DF]') || text.includes('variation') ||
                  text.includes('builder') || text.includes('axis') || text.includes('chip') ||
                  text.includes('fillForm') || text.includes('STEP') || text.includes('specifics') ||
                  text.includes('iframe') || text.includes('bulkedit') || text.includes('lock')) {
                log(`[E] ${text.substring(0, 300)}`);
              }
            });
            break;
          }
        } catch(_) {}
      }
    }

    if (ebayPage) {
      try {
        // Check variation state in all frames
        const frames = ebayPage.frames();
        for (const frame of frames) {
          const furl = frame.url();
          if (!furl || furl === 'about:blank' || furl.includes('devicebind')) continue;

          const state = await frame.evaluate(() => {
            try {
              const chips = document.querySelectorAll('.attr-chip, [class*="chip"], .listbox-component--option');
              const table = document.querySelector('.ve-table, table, [class*="pricing"]');
              const builder = document.querySelector('.smeBulkEditVariation, [class*="variation-builder"]');
              const tableRows = table ? table.querySelectorAll('tr, .ve-table-body-tr').length : 0;
              return {
                chips: chips.length,
                chipTexts: [...chips].map(c => c.textContent.trim()).slice(0, 8),
                hasTable: !!table,
                tableRows,
                hasBuilder: !!builder,
              };
            } catch { return null; }
          }).catch(() => null);

          if (state && (state.hasBuilder || state.chips > 0 || state.hasTable)) {
            log(`[${elapsed}s] BUILDER: chips=${state.chips} table=${state.hasTable}(${state.tableRows}r) chipTexts=${JSON.stringify(state.chipTexts)}`);
            if (state.hasTable && state.tableRows > 1) {
              log('🎉 PRICING TABLE POPULATED!');
              await ss(ebayPage, 'pricing_success');
              pricingFound = true;
              break;
            }
          }
        }

        if (elapsed % 20 === 0) await ss(ebayPage, `progress_${elapsed}s`);
      } catch(_) {}
    } else if (elapsed % 15 === 0) {
      const urls = (await browser.pages()).map(p => { try { return p.url(); } catch { return '?'; } });
      log(`[${elapsed}s] Waiting... pages: ${urls.map(u => u.substring(0, 60)).join(', ')}`);
    }
  }

  log('\n=== DONE ===');
  if (ebayPage) {
    // Scroll to variations and screenshot
    await ebayPage.evaluate(() => {
      const h = [...document.querySelectorAll('h2,h3,h4')].find(h => /variation/i.test(h.textContent));
      if (h) h.scrollIntoView({ block: 'start' });
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
    await ss(ebayPage, 'final_variations');
  }

  log(pricingFound ? '✅ PASS' : '❌ PRICING TABLE NOT FOUND');
  fs.writeFileSync(path.join(SS, 'fresh2-log.txt'), allLogs.join('\n'));
  browser.disconnect();
}

run().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
