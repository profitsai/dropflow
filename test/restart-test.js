const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const TEST_URL = 'https://a.aliexpress.com/_mMLcP7b';
const RESULT_FILE = '/Users/pyrite/Projects/dropflow-extension/test/FINAL-FINAL-RESULT.md';
const MAX_WAIT_MS = 22 * 60 * 1000;
const POLL_MS = 15000;

const R = [];
const add = m => { const l=`[${new Date().toLocaleTimeString('en-AU',{timeZone:'Australia/Melbourne'})}] ${m}`; console.log(l); R.push(l); };
const save = () => fs.writeFileSync(RESULT_FILE, R.join('\n'));

async function run() {
  add('# DropFlow FINAL E2E Test — Post condition-dialog fix');
  add(`Started: ${new Date().toISOString()}`);

  let browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
  
  // Close ALL stale tabs
  for (const p of await browser.pages()) {
    const u = p.url();
    if (u.includes('ebay.com.au') || u.includes('aliexpress') || u.includes('ebay.com.au/sl')) {
      await p.close().catch(()=>{});
      add(`Closed: ${u.substring(0,60)}`);
    }
  }
  await new Promise(r => setTimeout(r, 1000));

  // Reload extension to pick up code changes
  let extPage = (await browser.pages()).find(p => p.url().includes(EXT_ID));
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
  }

  // Reload extension
  try {
    await extPage.evaluate(() => chrome.runtime.reload());
  } catch(e) {}
  add('Extension reload triggered');
  await new Promise(r => setTimeout(r, 6000));

  // Reconnect
  browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
  await new Promise(r => setTimeout(r, 3000));
  
  extPage = (await browser.pages()).find(p => p.url().includes(EXT_ID));
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 3000));
  }
  add('✅ Reconnected, extension page ready');

  // Terminate + clear
  await extPage.evaluate(async () => {
    try { await chrome.runtime.sendMessage({ type: 'TERMINATE_ALI_BULK_LISTING' }); } catch(e){}
  }).catch(()=>{});
  await new Promise(r => setTimeout(r, 2000));

  const cleared = await extPage.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => 
      k.startsWith('dropflow_') || k.startsWith('pending') || k.startsWith('aliBulk') || k.startsWith('__dfBuilder')
    );
    if(keys.length) await chrome.storage.local.remove(keys);
    return 'Cleared ' + keys.length;
  });
  add(`✅ ${cleared}`);

  // SW keepalive pinger
  const keepalive = setInterval(async () => {
    try { if (extPage && !extPage.isClosed()) await extPage.evaluate(() => chrome.runtime.sendMessage({type:'KEEPALIVE_PING'}).catch(()=>{})); } catch(e) {}
  }, 5000);

  // Trigger
  const result = await extPage.evaluate(async (url) => {
    try {
      return JSON.stringify(await chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING', links: [url], threadCount: 1, listingType: 'standard', ebayDomain: 'www.ebay.com.au'
      }));
    } catch(e) { return 'ERROR: ' + e.message; }
  }, TEST_URL);
  add(`✅ Triggered: ${result}`);
  if (result.startsWith('ERROR')) { clearInterval(keepalive); save(); return; }

  // Monitor
  const t0 = Date.now();
  let lastLine = '';
  let final = null;
  let noTabCount = 0;
  let screenshotCount = 0;

  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const el = Math.round((Date.now() - t0) / 1000);

    try {
      const allPages = await browser.pages();
      const tabUrls = allPages.map(p => p.url());
      const ebayUrls = tabUrls.filter(u => u.includes('ebay'));
      const aliUrls = tabUrls.filter(u => u.includes('aliexpress'));

      // Success check
      for (const u of tabUrls) {
        const m = u.match(/ebay\.com\.au\/itm\/(\d+)/);
        if (m) { final = { r: 'SUCCESS', id: m[1] }; break; }
      }
      if (final) break;

      // Build status line
      const line = `[${el}s] eBay:${ebayUrls.length} Ali:${aliUrls.length} ${ebayUrls.map(u=>u.substring(30,70)).join(',')}`;
      if (line !== lastLine) { add(line); lastLine = line; }
      else console.log(`[${el}s] …`);

      // Periodic screenshot
      if (el % 60 === 0 || (el > 0 && el % 60 < POLL_MS/1000 + 1 && screenshotCount < 15)) {
        for (const pg of allPages) {
          if (pg.url().includes('ebay.com.au/lstng')) {
            const fname = `/Users/pyrite/Projects/dropflow-extension/test/progress-${screenshotCount}.png`;
            await pg.screenshot({ path: fname }).catch(()=>{});
            screenshotCount++;
            break;
          }
        }
      }

      // Detect end
      if (ebayUrls.length === 0 && aliUrls.length === 0 && el > 120) {
        noTabCount++;
        if (noTabCount >= 3) { final = { r: 'ENDED' }; break; }
      } else noTabCount = 0;

    } catch(e) {
      add(`[${el}s] ⚠️ ${e.message}`);
      try { browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null }); } catch(e2){}
    }
  }

  clearInterval(keepalive);
  add(''); add('---');
  if (final?.r === 'SUCCESS') add(`## 🎉 VICTORY! eBay Item: ${final.id}`);
  else if (final) add(`## Ended: ${final.r}`);
  else add('## ⏰ TIMEOUT');

  // Final screenshots
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

  // Storage dump
  try {
    if (extPage && !extPage.isClosed()) {
      const dump = await extPage.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null), null, 2));
      add('```json\n' + dump.substring(0, 5000) + '\n```');
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
