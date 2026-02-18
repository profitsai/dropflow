/**
 * E2E Monitor — attach to the existing eBay listing page and monitor builder progress.
 * The listing was already created by the previous run.
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const WS = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const SS = '/Users/pyrite/Projects/dropflow-extension/test/screenshots';

const allLogs = [];
function log(msg) { const ts = new Date().toISOString().slice(11,19); console.log(msg); allLogs.push(`[${ts}] ${msg}`); }

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS, defaultViewport: null });
  log('Connected');

  const pages = await browser.pages();
  log(`Found ${pages.length} pages`);
  
  let ebayPage = null;
  for (const p of pages) {
    const url = p.url();
    log(`  Page: ${url.substring(0, 100)}`);
    if (url.includes('ebay.com') && url.includes('lstng')) {
      ebayPage = p;
    }
  }

  if (!ebayPage) {
    log('❌ No eBay listing page found');
    browser.disconnect();
    return;
  }

  log(`\nMonitoring eBay page: ${ebayPage.url()}`);

  // Enable CDP for the page to capture ALL console logs including from content scripts
  const cdp = await ebayPage.createCDPSession();
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  cdp.on('Runtime.consoleAPICalled', (params) => {
    const text = params.args.map(a => {
      if (a.value !== undefined) return String(a.value);
      if (a.description) return a.description;
      if (a.preview) return JSON.stringify(a.preview.properties?.map(p => `${p.name}:${p.value}`));
      return a.type;
    }).join(' ');
    log(`[CONSOLE] ${text}`);
  });

  cdp.on('Log.entryAdded', (params) => {
    log(`[LOG] ${params.entry.level}: ${params.entry.text}`);
  });

  // Also capture from all frames via page-level listener  
  ebayPage.on('console', m => log(`[PAGE_CONSOLE] ${m.text()}`));

  // Take initial full-page state
  // Evaluate page state
  const pageState = await ebayPage.evaluate(() => {
    const body = document.body;
    const text = body?.innerText || '';
    
    // Check for variation-related content
    const hasVariationSection = text.includes('Variation') || text.includes('variation');
    const hasDescDetails = text.includes('Description') || text.includes('DESCRIPTION');
    
    // Look for iframe
    const iframes = document.querySelectorAll('iframe');
    const iframeSrcs = [...iframes].map(f => f.src).filter(Boolean);
    
    // Look for dialog/modal
    const dialogs = document.querySelectorAll('[role="dialog"], .lightbox-dialog, [class*="dialog"]');
    const dialogTexts = [...dialogs].map(d => d.textContent?.trim().substring(0, 200));
    
    return {
      title: document.title,
      hasVariationSection,
      hasDescDetails,
      iframes: iframeSrcs,
      dialogs: dialogTexts,
      bodyLength: text.length,
      // Get all section headers
      sections: [...document.querySelectorAll('h2, h3, [class*="section-title"]')].map(el => el.textContent?.trim()).filter(Boolean).slice(0, 20)
    };
  });
  
  log('\nPage state:');
  log(JSON.stringify(pageState, null, 2));

  // Check if there's an OK dialog to dismiss
  const dismissed = await ebayPage.evaluate(() => {
    const btns = [...document.querySelectorAll('button, [role="button"]')];
    const okBtn = btns.find(b => b.textContent.trim() === 'OK' && b.offsetParent !== null);
    if (okBtn) { okBtn.click(); return true; }
    return false;
  });
  if (dismissed) log('Dismissed OK dialog');

  // Scroll down to see if there's a variation section
  await ebayPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(r => setTimeout(r, 2000));
  
  let stepN = 100;
  const ssFn = async (label) => {
    stepN++;
    const f = `mon${String(stepN).padStart(3,'0')}_${label}.png`;
    await ebayPage.screenshot({ path: path.join(SS, f) }).catch(() => {});
    log(`📸 ${f}`);
  };
  
  await ssFn('scrolled_bottom');

  // Scroll to different sections
  await ebayPage.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 1000));
  await ssFn('scroll_top');

  // Check storage for DropFlow diagnostic data
  const diagData = await ebayPage.evaluate(async () => {
    try {
      const keys = ['dropflow_product_data', 'dropflow_variation_check', 'dropflow_form_progress', 
                     'dropflow_pending_listing', 'dropflow_variation_mainworld_diag', 'dropflow_variation_scripttag_diag',
                     'dropflow_variation_diag'];
      const result = await chrome.storage?.local?.get(keys);
      // Summarize large objects
      const summary = {};
      for (const [k, v] of Object.entries(result || {})) {
        if (typeof v === 'object' && v !== null) {
          const str = JSON.stringify(v);
          summary[k] = str.length > 500 ? str.substring(0, 500) + '...' : str;
        } else {
          summary[k] = v;
        }
      }
      return summary;
    } catch(e) { return { error: e.message }; }
  });
  log('\nStorage diagnostics:');
  log(JSON.stringify(diagData, null, 2));

  // Now monitor for 60 seconds to capture ongoing form filler activity
  log('\n=== Monitoring console for 60s ===');
  await new Promise(r => setTimeout(r, 60000));
  
  await ssFn('after_monitor');
  
  // Final page state
  const finalState = await ebayPage.evaluate(() => {
    const frames = [...document.querySelectorAll('iframe')];
    return {
      url: location.href,
      iframes: frames.map(f => ({ src: f.src?.substring(0, 100), visible: f.offsetParent !== null })),
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map(d => d.textContent?.trim().substring(0, 100))
    };
  });
  log('\nFinal state: ' + JSON.stringify(finalState, null, 2));

  fs.writeFileSync(path.join(SS, 'monitor-log.txt'), allLogs.join('\n'));
  browser.disconnect();
  log('Done');
}

run().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
