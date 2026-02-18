/**
 * E2E v5: Fixed message format — payload fields at top level.
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
  console.log(`[${ts}] ${msg}`);
  allLogs.push(`[${ts}] ${msg}`);
}

let stepN = 0;
async function ss(page, label) {
  stepN++;
  const f = `v5_${String(stepN).padStart(2, '0')}_${label}.png`;
  try { await page.screenshot({ path: path.join(SS, f) }); log(`📸 ${f}`); }
  catch (e) { log(`📸 FAIL: ${e.message}`); }
}

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS, defaultViewport: null });
  log('Connected');

  // Close old pages
  for (const p of await browser.pages()) {
    const url = p.url();
    if (url.includes('ebay.com') || url.includes('aliexpress.com/item') || 
        (url.includes(EXT_ID) && url.includes('ali-bulk'))) {
      await p.close().catch(() => {});
      log(`Closed: ${url.substring(0, 60)}`);
    }
  }

  // Terminate any running job first
  const extPage = await browser.newPage();
  await extPage.goto(`chrome-extension://${EXT_ID}/pages/popup/popup.html`, {
    waitUntil: 'domcontentloaded', timeout: 10000
  }).catch(() => {});
  await new Promise(r => setTimeout(r, 1000));

  const termResult = await extPage.evaluate(() => new Promise(res => {
    chrome.runtime.sendMessage({ type: 'TERMINATE_ALI_BULK_LISTING' }, r => res(JSON.stringify(r)));
  }));
  log('Terminate: ' + termResult);
  await new Promise(r => setTimeout(r, 2000));

  // Set up monitoring
  let ebayPage = null;
  let ebayPageCdp = null;
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      const url = target.url();
      if (url && !url.includes('about:blank')) log(`[NEW] ${url.substring(0, 80)}`);
    }
  });

  // Trigger with CORRECT message format: { type, links, threadCount, ... } (not nested payload)
  log('\n=== Trigger ===');
  const trigResult = await extPage.evaluate(async (url) => {
    return new Promise(resolve => {
      const t = setTimeout(() => resolve('TIMEOUT'), 15000);
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: [url],
        threadCount: 1,
        listingType: 'standard'
      }, resp => {
        clearTimeout(t);
        resolve(JSON.stringify(resp));
      });
    });
  }, PRODUCT_URL);
  log('Trigger: ' + trigResult);

  // Monitor
  log('\n=== Monitor (5 min) ===');
  const start = Date.now();
  let pricingFound = false;

  while (Date.now() - start < 300000 && !pricingFound) {
    await new Promise(r => setTimeout(r, 4000));
    const elapsed = Math.round((Date.now() - start) / 1000);

    if (!ebayPage) {
      for (const p of await browser.pages()) {
        try {
          const url = p.url();
          if (url.includes('ebay.com') && (url.includes('lstng') || url.includes('bulkedit'))) {
            ebayPage = p;
            log(`[${elapsed}s] ✅ eBay: ${url}`);
            await ss(p, 'ebay');
            
            // CDP console - capture EVERYTHING
            ebayPageCdp = await p.createCDPSession();
            await ebayPageCdp.send('Runtime.enable');
            ebayPageCdp.on('Runtime.consoleAPICalled', ({ args }) => {
              const text = args.map(a => a.value ?? a.description ?? '').join(' ');
              // Much broader filter - capture all DropFlow and form-related logs
              if (/DropFlow|\[DF\]|variation|builder|axis|chip|fillForm|STEP|specific|iframe|lock|combo|pricing|table|option|attribute|_dfLog|image|upload|draft|scrape|description|title|condition|category/i.test(text)) {
                log(`[E] ${text.substring(0, 500)}`);
              }
            });
            break;
          }
        } catch {}
      }
    }

    if (ebayPage) {
      try {
        for (const frame of ebayPage.frames()) {
          const furl = frame.url();
          if (!furl || furl === 'about:blank' || furl.includes('devicebind')) continue;

          const state = await frame.evaluate(() => {
            try {
              const chips = document.querySelectorAll('.attr-chip, [class*="chip"], .listbox-component--option');
              const table = document.querySelector('.ve-table, table, [class*="pricing"]');
              const builder = document.querySelector('.smeBulkEditVariation, [class*="variation-builder"]');
              return {
                chips: chips.length,
                chipTexts: [...chips].map(c => c.textContent.trim()).slice(0, 10),
                hasTable: !!table,
                tableRows: table?.querySelectorAll('tr').length || 0,
                hasBuilder: !!builder
              };
            } catch { return null; }
          }).catch(() => null);

          if (state?.hasBuilder || state?.chips > 0 || (state?.hasTable && state?.tableRows > 1)) {
            log(`[${elapsed}s] BUILDER: chips=${state.chips} table=${state.hasTable}(${state.tableRows}r) ${JSON.stringify(state.chipTexts)}`);
            if (state.hasTable && state.tableRows > 1) {
              log('🎉 PRICING TABLE!');
              await ss(ebayPage, 'pricing');
              pricingFound = true;
              break;
            }
          }
        }

        if (elapsed % 30 === 0) await ss(ebayPage, `p_${elapsed}s`);
      } catch {}
    } else if (elapsed % 15 === 0) {
      const urls = (await browser.pages()).map(p => { try { return p.url().substring(0, 50); } catch { return '?'; } });
      log(`[${elapsed}s] Waiting... ${urls.join(' | ')}`);
    }
  }

  // Final
  log('\n=== FINAL ===');
  if (ebayPage) {
    await ebayPage.evaluate(() => {
      const h = [...document.querySelectorAll('h2,h3')].find(h => /variation/i.test(h.textContent));
      if (h) h.scrollIntoView({ block: 'start' });
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
    await ss(ebayPage, 'final');
  }

  log(pricingFound ? '\n✅ PASS' : '\n❌ FAIL');
  fs.writeFileSync(path.join(SS, 'v5-log.txt'), allLogs.join('\n'));
  await extPage.close().catch(() => {});
  browser.disconnect();
}

run().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
