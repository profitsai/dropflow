const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const RESULT_FILE = '/Users/pyrite/Projects/dropflow-extension/test/FINAL-FINAL-RESULT.md';
const MAX_WAIT_MS = 23 * 60 * 1000;
const POLL_MS = 15000;

const R = [];
const add = m => { const l=`[${new Date().toLocaleTimeString('en-AU',{timeZone:'Australia/Melbourne'})}] ${m}`; console.log(l); R.push(l); };
const save = () => fs.writeFileSync(RESULT_FILE, R.join('\n'));

async function run() {
  add('# DropFlow FINAL E2E — Monitor v2');
  add('Listing was triggered. Monitoring tabs + storage.');
  
  let browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });

  // SW keepalive: ping via extension page every 5s
  const pages0 = await browser.pages();
  let extPage = pages0.find(p => p.url().includes(EXT_ID));
  
  const keepalive = setInterval(async () => {
    try {
      if (extPage && !extPage.isClosed()) {
        await extPage.evaluate(() => chrome.runtime.sendMessage({type:'KEEPALIVE_PING'}).catch(()=>{}));
      }
    } catch(e) {}
  }, 5000);

  const t0 = Date.now();
  let lastLine = '';
  let final = null;
  let noTabCount = 0;

  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const el = Math.round((Date.now() - t0) / 1000);

    try {
      const allPages = await browser.pages();
      const tabUrls = allPages.map(p => p.url());
      const ebayTabs = tabUrls.filter(u => u.includes('ebay'));
      const aliTabs = tabUrls.filter(u => u.includes('aliexpress'));

      // Check for success (item page)
      for (const u of tabUrls) {
        if (u.includes('ebay.com.au/itm/')) {
          const m = u.match(/\/itm\/(\d+)/);
          if (m) { final = { r: 'SUCCESS', id: m[1] }; break; }
        }
      }
      if (final) break;

      // Get storage state
      let storageInfo = '';
      if (extPage && !extPage.isClosed()) {
        try {
          storageInfo = await extPage.evaluate(async () => {
            const all = await chrome.storage.local.get(null);
            const keys = Object.keys(all);
            const dfKeys = keys.filter(k => k.startsWith('__df') || k.includes('bulk'));
            return dfKeys.map(k => {
              const v = all[k];
              return k + '=' + (typeof v === 'object' ? JSON.stringify(v).substring(0,80) : String(v).substring(0,50));
            }).join(' | ');
          });
        } catch(e) {}
      }

      const line = `[${el}s] eBay:${ebayTabs.length} Ali:${aliTabs.length} | ${ebayTabs.map(u=>u.substring(0,60)).join(', ')} | ${storageInfo}`;
      if (line !== lastLine) { add(line); lastLine = line; }
      else console.log(`[${el}s] …`);

      // Detect completion: if no eBay/Ali tabs and it's been a while
      if (ebayTabs.length === 0 && aliTabs.length === 0 && el > 60) {
        noTabCount++;
        if (noTabCount >= 3) {
          add('No eBay/Ali tabs for 3 polls — listing likely complete');
          final = { r: 'ENDED' };
          break;
        }
      } else noTabCount = 0;

      // Screenshot eBay tab occasionally
      if (el % 60 < POLL_MS/1000 + 1) {
        for (const pg of allPages) {
          if (pg.url().includes('ebay.com.au/lstng')) {
            const fname = `/Users/pyrite/Projects/dropflow-extension/test/progress-${el}s.png`;
            await pg.screenshot({ path: fname }).catch(()=>{});
            add(`📸 ${fname}`);
            break;
          }
        }
      }

    } catch(e) {
      add(`[${el}s] ⚠️ ${e.message}`);
      try { browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null }); } catch(e2){}
    }
  }

  clearInterval(keepalive);
  add(''); add('---');
  if (final?.r === 'SUCCESS') add(`## 🎉 VICTORY! eBay Item: ${final.id}`);
  else if (final) add(`## Listing ended (${final.r})`);
  else add('## ⏰ TIMEOUT');

  // Final screenshots + storage
  try {
    const allPages = await browser.pages();
    let i = 0;
    for (const pg of allPages) {
      if (pg.url().includes('ebay') || pg.url().includes('aliexpress')) {
        await pg.screenshot({ path: `/Users/pyrite/Projects/dropflow-extension/test/final-ss-${i}.png` });
        add(`📸 final-ss-${i}.png`);
        i++;
      }
    }
  } catch(e) {}

  try {
    if (extPage && !extPage.isClosed()) {
      const dump = await extPage.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null), null, 2));
      add('```json\n' + dump.substring(0, 5000) + '\n```');
    }
  } catch(e) {}

  add(`\nCompleted: ${new Date().toISOString()}`);
  save();
}

run().catch(e => {
  console.error('Fatal:', e);
  fs.writeFileSync(RESULT_FILE, `# FATAL\n${e.message}\n${e.stack}`);
});
