const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const TEST_URL = 'https://a.aliexpress.com/_mMLcP7b';
const RESULT_FILE = '/Users/pyrite/Projects/dropflow-extension/test/FINAL-FINAL-RESULT.md';
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
  // Ping SW to keep it alive
  try {
    await evalSW(browser, 'chrome.runtime.getPlatformInfo()', 5000);
  } catch(e) {}
}

async function run() {
  add('# DropFlow FINAL E2E Test (v6 — SW keepalive from test harness)');
  add(`Started: ${new Date().toISOString()}`);

  let browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
  add('✅ Connected');

  // Close stale eBay/Ali tabs
  const pages = await browser.pages();
  for (const p of pages) {
    const u = p.url();
    if (u.includes('ebay.com.au/lstng') || u.includes('aliexpress.com') || u.includes('ebay.com.au/sl/prelist')) {
      await p.close().catch(()=>{});
      add(`Closed stale tab: ${u.substring(0,80)}`);
    }
  }
  await new Promise(r => setTimeout(r, 2000));

  // Open extension page for messaging
  const extPage = await browser.newPage();
  await extPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 3000));

  // Terminate any existing run
  await extPage.evaluate(async () => {
    try { await chrome.runtime.sendMessage({ type: 'TERMINATE_ALI_BULK_LISTING' }); } catch(e){}
  });
  await new Promise(r => setTimeout(r, 2000));

  // Clear ALL state
  const cleared = await extPage.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => 
      k.startsWith('dropflow_') || k.startsWith('pending') || k.startsWith('aliBulk') || k.startsWith('__dfBuilder')
    );
    if(keys.length) await chrome.storage.local.remove(keys);
    return 'Cleared ' + keys.length + ' keys';
  });
  add(`✅ ${cleared}`);

  // Start SW keepalive pinger (every 5s from test harness)
  const keepaliveInterval = setInterval(async () => {
    try { await pingSW(browser); } catch(e) {
      // Try reconnecting
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
  const stageLog = [];

  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const el = Math.round((Date.now() - t0) / 1000);

    try {
      // Check aliBulkRunning from SW
      let swAlive = false;
      try {
        const running = await evalSW(browser, 'aliBulkRunning', 5000);
        swAlive = true;
        if (running === false) {
          // Listing finished (success or error)
          add(`[${el}s] aliBulkRunning=false → listing process ended`);
          
          // Get result from storage
          const storeDump = await extPage.evaluate(async () => {
            const a = await chrome.storage.local.get(null);
            return JSON.stringify(a, null, 2);
          });
          add('Storage dump:');
          add(storeDump.substring(0, 3000));
          
          // Check tabs for success
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
        // SW died — try to wake it
        try {
          await extPage.evaluate(async () => {
            await chrome.runtime.sendMessage({ type: 'KEEPALIVE_PING' });
          });
        } catch(e2) {}
        continue;
      }

      // Get tab info
      const allPages = await browser.pages();
      const tabUrls = allPages.map(p => p.url()).filter(u => u.includes('ebay') || u.includes('aliexpress'));
      
      // Check for item ID in URLs (success!)
      for (const u of tabUrls) {
        if (u.includes('/itm/')) {
          const m = u.match(/\/itm\/(\d+)/);
          if (m) { final = { r: 'SUCCESS', id: m[1] }; break; }
        }
      }
      if (final) break;

      const line = `[${el}s] SW:alive=${swAlive} tabs=${tabUrls.map(u=>u.substring(0,60)).join(' | ')}`;
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
    if (final.r === 'SUCCESS') add(`## 🎉 VICTORY! eBay Item: ${final.id}`);
    else add(`## Listing ended: ${final.id}`);
  } else {
    add('## ⏰ TIMEOUT');
  }

  // Screenshot all relevant tabs
  try {
    const allPages = await browser.pages();
    let i = 0;
    for (const pg of allPages) {
      if (pg.url().includes('ebay') || pg.url().includes('aliexpress')) {
        await pg.screenshot({ path: `/Users/pyrite/Projects/dropflow-extension/test/final-ss-${i}.png` });
        add(`📸 final-ss-${i}.png (${pg.url().substring(0,80)})`);
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
