const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const TEST_URL = 'https://a.aliexpress.com/_mMLcP7b';
const RESULT_FILE = '/Users/pyrite/Projects/dropflow-extension/test/TIMEOUT-FIX-RESULT.md';
const MAX_WAIT_MS = 25 * 60 * 1000;
const POLL_MS = 10000;

const ts = () => new Date().toLocaleTimeString('en-AU',{timeZone:'Australia/Melbourne'});
const R = [];
const add = m => { const l=`[${ts()}] ${m}`; console.log(l); R.push(l); };
const save = () => fs.writeFileSync(RESULT_FILE, R.join('\n'));

async function evalSW(browser, expr, timeout=30000) {
  const targets = await browser.targets();
  const sw = targets.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  if (!sw) throw new Error('SW not found');
  const c = await sw.createCDPSession();
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
  await c.detach();
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function pingSW(browser) {
  try { await evalSW(browser, 'chrome.runtime.getPlatformInfo()', 5000); } catch(e) {}
}

async function reloadExtension(browser) {
  const targets = await browser.targets();
  const extTarget = targets.find(t => t.url().includes('chrome://extensions'));
  let extPage;
  if (extTarget) {
    extPage = await extTarget.page();
  } else {
    extPage = await browser.newPage();
    await extPage.goto('chrome://extensions', { waitUntil: 'domcontentloaded' });
  }
  // Use chrome.management API from an extension page instead
  const p = await browser.newPage();
  await p.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await p.evaluate(async (id) => {
    await chrome.management.setEnabled(id, false);
    await new Promise(r => setTimeout(r, 1000));
    await chrome.management.setEnabled(id, true);
  }, EXT_ID).catch(() => {});
  await p.close().catch(() => {});
  if (extTarget) {} else { await extPage.close().catch(() => {}); }
  await new Promise(r => setTimeout(r, 3000));
}

async function run() {
  add('# DropFlow Timeout Fix E2E Test');
  add(`Timeouts increased from 600s (10min) → 1200s (20min)`);
  add(`Started: ${new Date().toISOString()}`);
  add('');

  let browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
  add('✅ Connected to browser');

  // Reload extension to pick up timeout changes
  add('Reloading extension...');
  await reloadExtension(browser);
  // Reconnect after reload
  browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
  add('✅ Extension reloaded');

  // Close stale tabs
  const pages = await browser.pages();
  for (const p of pages) {
    const u = p.url();
    if (u.includes('ebay.com.au/lstng') || u.includes('aliexpress.com') || u.includes('ebay.com.au/sl/prelist')) {
      await p.close().catch(()=>{});
      add(`Closed stale tab: ${u.substring(0,80)}`);
    }
  }
  await new Promise(r => setTimeout(r, 2000));

  // Open extension page
  const extPage = await browser.newPage();
  await extPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 3000));

  // Terminate any existing run
  await extPage.evaluate(async () => {
    try { await chrome.runtime.sendMessage({ type: 'TERMINATE_ALI_BULK_LISTING' }); } catch(e){}
  });
  await new Promise(r => setTimeout(r, 2000));

  // Clear state
  const cleared = await extPage.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => 
      k.startsWith('dropflow_') || k.startsWith('pending') || k.startsWith('aliBulk') || k.startsWith('__dfBuilder')
    );
    if(keys.length) await chrome.storage.local.remove(keys);
    return 'Cleared ' + keys.length + ' keys';
  });
  add(`✅ ${cleared}`);

  // SW keepalive
  const keepaliveInterval = setInterval(async () => {
    try { await pingSW(browser); } catch(e) {
      try { browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null }); } catch(e2){}
    }
  }, 5000);

  // Trigger listing
  const result = await extPage.evaluate(async (url) => {
    try {
      const r = await chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: [url],
        threadCount: 1,
        listingType: 'standard',
        ebayDomain: 'www.ebay.com.au'
      });
      return JSON.stringify(r);
    } catch(e) { return 'ERROR: ' + e.message; }
  }, TEST_URL);
  add(`✅ Triggered: ${result}`);
  if (result.startsWith('ERROR')) { clearInterval(keepaliveInterval); save(); return; }

  // Monitor
  const t0 = Date.now();
  let lastLine = '';
  let final = null;

  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const el = Math.round((Date.now() - t0) / 1000);

    try {
      let swAlive = false;
      try {
        const running = await evalSW(browser, 'aliBulkRunning', 5000);
        swAlive = true;
        if (running === false) {
          add(`[${el}s] aliBulkRunning=false → listing ended`);
          const storeDump = await extPage.evaluate(async () => {
            const a = await chrome.storage.local.get(null);
            return JSON.stringify(a, null, 2);
          });
          add('Storage dump:');
          add(storeDump.substring(0, 3000));
          
          const allPages = await browser.pages();
          for (const pg of allPages) {
            const u = pg.url();
            if (u.includes('/itm/')) {
              const m = u.match(/\/itm\/(\d+)/);
              if (m) { final = { r: 'SUCCESS', id: m[1] }; break; }
            }
          }
          if (!final) final = { r: 'ENDED', id: 'check logs' };
          break;
        }
      } catch(e) {
        add(`[${el}s] ⚠️ SW unreachable: ${e.message}`);
        try {
          await extPage.evaluate(async () => {
            await chrome.runtime.sendMessage({ type: 'KEEPALIVE_PING' });
          });
        } catch(e2) {}
        continue;
      }

      const allPages = await browser.pages();
      const tabUrls = allPages.map(p => p.url()).filter(u => u.includes('ebay') || u.includes('aliexpress'));
      
      for (const u of tabUrls) {
        if (u.includes('/itm/')) {
          const m = u.match(/\/itm\/(\d+)/);
          if (m) { final = { r: 'SUCCESS', id: m[1] }; break; }
        }
      }
      if (final) break;

      // Get SW console for stage info
      let stageInfo = '';
      try {
        stageInfo = await evalSW(browser, `
          (function() {
            try {
              const state = { running: aliBulkRunning };
              return JSON.stringify(state);
            } catch(e) { return e.message; }
          })()
        `, 5000);
      } catch(e) {}

      const line = `[${el}s] SW:alive tabs=${tabUrls.map(u=>u.substring(0,60)).join(' | ')} ${stageInfo}`;
      if (line !== lastLine) { add(line); lastLine = line; }
      else console.log(`[${el}s] …`);
      
    } catch(e) {
      add(`[${el}s] ⚠️ ${e.message}`);
      try { browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null }); } catch(e2){}
    }
  }

  clearInterval(keepaliveInterval);
  add(''); add('---');
  
  if (final) {
    if (final.r === 'SUCCESS') add(`## 🎉 SUCCESS! eBay Item: ${final.id}`);
    else add(`## Listing ended: ${final.id}`);
  } else {
    add('## ⏰ TIMEOUT (25 min)');
  }

  // Screenshots
  try {
    const allPages = await browser.pages();
    let i = 0;
    for (const pg of allPages) {
      if (pg.url().includes('ebay') || pg.url().includes('aliexpress')) {
        await pg.screenshot({ path: `/Users/pyrite/Projects/dropflow-extension/test/timeout-fix-ss-${i}.png` });
        add(`📸 timeout-fix-ss-${i}.png (${pg.url().substring(0,80)})`);
        i++;
      }
    }
  } catch(e) {}

  // Final storage
  try {
    const dump = await extPage.evaluate(async () => {
      const a = await chrome.storage.local.get(null);
      return JSON.stringify(a, null, 2);
    });
    add('```json\n' + dump.substring(0, 5000) + '\n```');
  } catch(e) {}

  add(`\nCompleted: ${new Date().toISOString()}`);
  save();
  console.log('Done → ' + RESULT_FILE);
}

run().catch(e => {
  console.error('Fatal:', e);
  fs.writeFileSync(RESULT_FILE, `# FATAL\n${e.message}\n${e.stack}`);
});
