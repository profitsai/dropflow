const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const TEST_URL = 'https://a.aliexpress.com/_mMLcP7b';
const RESULT_FILE = '/Users/pyrite/Projects/dropflow-extension/test/SW-PERSIST-FIX.md';
const MAX_WAIT_MS = 25 * 60 * 1000;
const POLL_MS = 10000;

const log = (msg) => { const l = `[${new Date().toLocaleTimeString('en-AU',{timeZone:'Australia/Melbourne'})}] ${msg}`; console.log(l); return l; };

async function findSW(browser) {
  // Try multiple approaches
  const targets = await browser.targets();
  let sw = targets.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  if (sw) return sw;
  
  // Force SW to wake by opening popup
  try {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${EXT_ID}/pages/popup/popup.html`);
    await new Promise(r => setTimeout(r, 3000));
    await page.close();
  } catch(e) {}
  
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const t = await browser.targets();
    sw = t.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
    if (sw) return sw;
  }
  return null;
}

async function evalSW(browser, expr) {
  const sw = await findSW(browser);
  if (!sw) throw new Error('SW not found');
  const c = await sw.createCDPSession();
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000 });
  await c.detach();
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function run() {
  const R = [];
  const add = m => R.push(log(m));
  const save = () => fs.writeFileSync(RESULT_FILE, R.join('\n'));

  add('# DropFlow SW Persistence + MSKU Price Fix Test');
  add(`Started: ${new Date().toISOString()}`);
  add(`Test URL: ${TEST_URL}`);
  add('');

  let browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
  add('✅ Connected to browser');

  // Reload extension
  try {
    const sw = await findSW(browser);
    if (sw) {
      const c = await sw.createCDPSession();
      await c.send('Runtime.enable');
      await c.send('Runtime.evaluate', { expression: 'chrome.runtime.reload()', awaitPromise: false, returnByValue: true });
      await c.detach();
    }
  } catch(e) { add('Extension reload triggered: ' + e.message); }
  
  await new Promise(r => setTimeout(r, 8000));
  
  // Reconnect
  try { browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null }); } catch(e) {}
  add('✅ Reconnected after reload');
  
  // Wait for SW to come up
  await new Promise(r => setTimeout(r, 5000));
  
  // Find SW
  let sw = await findSW(browser);
  if (!sw) {
    add('❌ SW not found — code may have syntax error');
    save();
    return;
  }
  add('✅ SW found');

  // Clear old state
  try {
    const cleared = await evalSW(browser, `
      new Promise(async res => {
        const all = await chrome.storage.local.get(null);
        const k = Object.keys(all).filter(k => k.startsWith('dropflow_')||k.startsWith('pending')||k.startsWith('aliBulk')||k==='_dropflow_orchestration');
        if(k.length) await chrome.storage.local.remove(k);
        res('Cleared '+k.length+' keys');
      })
    `);
    add(`✅ ${cleared}`);
  } catch(e) { add('Clear failed: ' + e.message); }

  // Trigger listing via extension page (sendMessage from page context goes to SW)
  try {
    const extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${EXT_ID}/pages/popup/popup.html`);
    await new Promise(r => setTimeout(r, 2000));
    const triggerResult = await extPage.evaluate((testUrl) => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'START_ALI_BULK_LISTING',
          links: [testUrl],
          threadCount: 1,
          listingType: 'standard',
          ebayDomain: 'www.ebay.com.au'
        }, (response) => {
          resolve(response);
        });
      });
    }, TEST_URL);
    add(`✅ Triggered: ${JSON.stringify(triggerResult)}`);
    await extPage.close();
  } catch(e) {
    add('❌ Trigger failed: ' + e.message);
    save();
    return;
  }
  add('');

  // Monitor
  const t0 = Date.now();
  let lastLine = '';
  let final = null;
  let swDeaths = 0;
  let orchStages = [];

  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const el = Math.round((Date.now() - t0) / 1000);

    try {
      const s = await evalSW(browser, `
        new Promise(async res => {
          const all = await chrome.storage.local.get(null);
          const orch = all['_dropflow_orchestration'] || null;
          const variationResult = all['dropflow_variation_result'] || null;
          const lastFill = all['dropflow_last_fill_results'] || null;
          const pendingKeys = Object.keys(all).filter(k => k.startsWith('pendingListing_'));
          const running = typeof aliBulkRunning !== 'undefined' ? aliBulkRunning : 'unknown';
          const keepAlive = typeof keepAliveActive !== 'undefined' ? keepAliveActive : 'unknown';
          res(JSON.stringify({ orchestration: orch, variationResult, lastFill, pendingCount: pendingKeys.length, running, keepAlive }));
        })
      `);
      const p = JSON.parse(s);
      
      let line = `[${el}s] `;
      
      if (p.orchestration) {
        const o = p.orchestration;
        if (!orchStages.includes(o.stage)) orchStages.push(o.stage);
        const age = o.updatedAt ? Math.round((Date.now() - o.updatedAt) / 1000) : '?';
        line += `ORCH:${o.stage}(${age}s) `;
      }
      
      line += `run=${p.running} ka=${p.keepAlive} pend=${p.pendingCount} `;
      
      if (p.variationResult) {
        line += `VAR:prices=${p.variationResult.filledPrices} pop=${p.variationResult.populated} `;
      }
      
      if (p.lastFill) {
        const lf = p.lastFill;
        line += `FILL:[T=${lf.title?1:0} P=${lf.price?1:0} D=${lf.description?1:0} I=${lf.images?1:0} V=${lf.variations?1:0} VP=${lf.variationPrices?1:0} L=${lf.listed?1:0}] `;
        if (lf.listed) final = { r: 'SUCCESS', fill: lf };
      }
      
      if (line !== lastLine) { add(line); lastLine = line; } else console.log(`[${el}s] …`);
      if (final) break;
      
      // Detect completion
      if (p.pendingCount === 0 && p.running === false && el > 60 && p.lastFill) {
        final = { r: p.lastFill.listed ? 'SUCCESS' : 'PARTIAL', fill: p.lastFill };
        break;
      }
      
    } catch(e) {
      swDeaths++;
      add(`[${el}s] ⚠️ SW access failed (death #${swDeaths}): ${e.message.substring(0, 100)}`);
      try { browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null }); } catch(e2) {}
      await new Promise(r => setTimeout(r, 5000));
      
      // Check orchestration state survival
      try {
        const orchCheck = await evalSW(browser, `
          new Promise(async res => {
            const d = await chrome.storage.local.get('_dropflow_orchestration');
            res(JSON.stringify(d['_dropflow_orchestration'] || null));
          })
        `);
        if (orchCheck && orchCheck !== 'null') {
          const o = JSON.parse(orchCheck);
          add(`[${el}s] ✅ Orchestration state SURVIVED: stage=${o.stage}`);
        }
      } catch(e2) {}
    }
  }

  add(''); add('---');
  add('## Summary');
  add(`- SW Deaths: ${swDeaths}`);
  add(`- Orchestration stages: ${orchStages.join(' → ') || 'none'}`);
  add('');
  
  if (final) {
    if (final.r === 'SUCCESS') add('## 🎉 SUCCESS');
    else add(`## ⚠️ ${final.r}`);
    add('```json');
    add(JSON.stringify(final.fill, null, 2));
    add('```');
  } else {
    add('## ⏰ TIMEOUT');
    try {
      const dump = await evalSW(browser, `
        new Promise(async r => {
          const a = await chrome.storage.local.get(null);
          const rel = {};
          for (const [k,v] of Object.entries(a)) {
            if (k.startsWith('dropflow_')||k.startsWith('pending')||k==='_dropflow_orchestration') rel[k]=v;
          }
          r(JSON.stringify(rel,null,2));
        })
      `);
      add('```json');
      add(dump.substring(0, 8000));
      add('```');
    } catch(e) { add(`Dump failed: ${e.message}`); }
  }

  // Screenshot
  try {
    const pages = await browser.pages();
    for (const p of pages) {
      if (p.url().includes('ebay')) {
        await p.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/sw-persist-screenshot.png', fullPage: true });
        add('📸 sw-persist-screenshot.png');
        break;
      }
    }
  } catch(e) {}

  add(`\nCompleted: ${new Date().toISOString()}`);
  save();
  console.log('Done → ' + RESULT_FILE);
}

run().catch(e => {
  console.error('Fatal:', e);
  fs.writeFileSync(RESULT_FILE, `# FATAL\n${e.message}\n${e.stack}`);
});
