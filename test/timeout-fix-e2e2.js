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

async function getSWStatus(browser) {
  try {
    const targets = await browser.targets();
    const sw = targets.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
    if (!sw) return { alive: false, error: 'no SW target' };
    const c = await sw.createCDPSession();
    await c.send('Runtime.enable');
    const r = await c.send('Runtime.evaluate', { 
      expression: `JSON.stringify({ running: typeof aliBulkRunning !== 'undefined' ? aliBulkRunning : 'undef' })`,
      returnByValue: true, timeout: 5000 
    });
    await c.detach();
    if (r.exceptionDetails) return { alive: true, error: 'eval fail' };
    return { alive: true, ...JSON.parse(r.result.value) };
  } catch(e) { return { alive: false, error: e.message.substring(0,80) }; }
}

async function pingSW(browser) {
  try {
    const targets = await browser.targets();
    const sw = targets.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
    if (sw) { const c = await sw.createCDPSession(); await c.send('Runtime.enable'); await c.send('Runtime.evaluate', { expression: '1+1', returnByValue: true, timeout: 3000 }); await c.detach(); }
  } catch(e) {}
}

async function run() {
  add('# DropFlow Timeout Fix E2E Test (v2)');
  add(`Timeouts: 600s→1200s (20min). Test URL: ${TEST_URL}`);
  add(`Started: ${new Date().toISOString()}`);
  add('');

  let browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
  add('✅ Connected');

  // Close stale tabs
  for (const p of await browser.pages()) {
    const u = p.url();
    if (u.includes('ebay.com.au/lstng') || u.includes('aliexpress.com') || u.includes('ebay.com.au/sl/prelist') || u.includes('ali-bulk-lister')) {
      await p.close().catch(()=>{});
      add(`Closed: ${u.substring(0,80)}`);
    }
  }
  await new Promise(r => setTimeout(r, 2000));

  // Open extension page
  const extPage = await browser.newPage();
  await extPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 3000));

  // Terminate + clear
  await extPage.evaluate(async () => {
    try { await chrome.runtime.sendMessage({ type: 'TERMINATE_ALI_BULK_LISTING' }); } catch(e){}
  });
  await new Promise(r => setTimeout(r, 2000));

  const cleared = await extPage.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => 
      k.startsWith('dropflow_') || k.startsWith('pending') || k.startsWith('aliBulk') || k.startsWith('__dfBuilder')
    );
    if(keys.length) await chrome.storage.local.remove(keys);
    return keys.length;
  });
  add(`✅ Cleared ${cleared} keys`);

  // Verify SW is alive before triggering
  const swCheck = await getSWStatus(browser);
  add(`SW status: ${JSON.stringify(swCheck)}`);

  // Keepalive
  const keepalive = setInterval(async () => { try { await pingSW(browser); } catch(e) {} }, 5000);

  // Trigger
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
  if (result.startsWith('ERROR')) { clearInterval(keepalive); save(); return; }

  // Monitor loop
  const t0 = Date.now();
  let lastLog = '';
  let final = null;

  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const el = Math.round((Date.now() - t0) / 1000);

    try {
      const sw = await getSWStatus(browser);
      
      // Check if listing ended
      if (sw.running === false) {
        add(`[${el}s] ✅ aliBulkRunning=false → listing process ended`);
        
        // Check for success
        for (const pg of await browser.pages()) {
          const u = pg.url();
          const m = u.match(/\/itm\/(\d+)/);
          if (m) { final = { r: 'SUCCESS', id: m[1] }; break; }
        }
        if (!final) {
          // Check storage for error info
          const info = await extPage.evaluate(async () => {
            const a = await chrome.storage.local.get(null);
            const relevant = {};
            for (const [k,v] of Object.entries(a)) {
              if (k.startsWith('dropflow_') || k.startsWith('aliBulk') || k.startsWith('pending')) relevant[k] = v;
            }
            return JSON.stringify(relevant, null, 2);
          }).catch(() => 'unavailable');
          add('Storage: ' + info.substring(0, 2000));
          final = { r: 'ENDED' };
        }
        break;
      }

      // Get tab URLs
      const allPages = await browser.pages();
      const tabs = allPages.map(p => p.url()).filter(u => u.includes('ebay') || u.includes('aliexpress'));
      
      // Check for success URL
      for (const u of tabs) {
        const m = u.match(/\/itm\/(\d+)/);
        if (m) { final = { r: 'SUCCESS', id: m[1] }; break; }
      }
      if (final) break;

      const line = `[${el}s] SW:${JSON.stringify(sw)} tabs:[${tabs.map(u=>u.substring(0,70)).join(', ')}]`;
      if (line !== lastLog) { add(line); lastLog = line; }
      
    } catch(e) {
      add(`[${el}s] ⚠️ ${e.message}`);
      try { browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null }); } catch(e2){}
    }
  }

  clearInterval(keepalive);
  add(''); add('---');
  
  if (final?.r === 'SUCCESS') add(`## 🎉 SUCCESS! eBay Item: ${final.id}`);
  else if (final) add(`## Listing ended without success`);
  else add('## ⏰ TIMEOUT (25 min)');

  // Screenshots
  try {
    let i = 0;
    for (const pg of await browser.pages()) {
      if (pg.url().includes('ebay') || pg.url().includes('aliexpress')) {
        await pg.screenshot({ path: `/Users/pyrite/Projects/dropflow-extension/test/timeout-fix-ss-${i}.png`, fullPage: false });
        add(`📸 timeout-fix-ss-${i}.png (${pg.url().substring(0,80)})`);
        i++;
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
