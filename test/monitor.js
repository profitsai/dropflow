const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const RESULT_FILE = '/Users/pyrite/Projects/dropflow-extension/test/FINAL-FINAL-RESULT.md';
const MAX_WAIT_MS = 24 * 60 * 1000; // 24 min remaining approx
const POLL_MS = 15000;

const R = [];
const add = m => { const l=`[${new Date().toLocaleTimeString('en-AU',{timeZone:'Australia/Melbourne'})}] ${m}`; console.log(l); R.push(l); };
const save = () => fs.writeFileSync(RESULT_FILE, R.join('\n'));

async function run() {
  add('# DropFlow FINAL E2E — Monitor (listing already triggered)');
  add(`Started monitoring: ${new Date().toISOString()}`);

  let browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
  
  // Find ext page
  let pages = await browser.pages();
  let extPage = pages.find(p => p.url().includes(EXT_ID));
  if (!extPage) { add('❌ No extension page found'); save(); return; }
  add('✅ Connected to extension page');

  const t0 = Date.now();
  let final = null;
  const stages = new Set();
  let lastLine = '';

  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const el = Math.round((Date.now() - t0) / 1000);

    try {
      // Get ALL storage + tab URLs
      const data = await extPage.evaluate(async () => {
        const all = await chrome.storage.local.get(null);
        return JSON.stringify(all);
      });
      const allData = JSON.parse(data);
      
      // Get tab URLs
      let tabInfo = '';
      try {
        const allPages = await browser.pages();
        const urls = allPages.map(p => p.url()).filter(u => u.includes('ebay') || u.includes('aliexpress'));
        tabInfo = urls.map(u => u.substring(0,80)).join(' | ');
      } catch(e) {}

      // Look for builder locks, status fields, etc.
      let statusInfo = '';
      for (const [k, v] of Object.entries(allData)) {
        if (k.startsWith('__df') || k.includes('status') || k.includes('progress') || k.includes('bulk') || k.includes('listing')) {
          const val = typeof v === 'object' ? JSON.stringify(v).substring(0,150) : String(v).substring(0,100);
          statusInfo += `${k}=${val} `;
        }
      }

      const line = `[${el}s] Tabs: ${tabInfo} | Storage: ${statusInfo || 'no status keys'}`;
      if (line !== lastLine) { add(line); lastLine = line; } else console.log(`[${el}s] …`);

      // Check if eBay listing completed - look for success indicators
      // Check if we have an ebay item page (not lstng form)
      try {
        const allPages = await browser.pages();
        for (const pg of allPages) {
          const url = pg.url();
          // If we see an item ID in the URL after submission
          if (url.includes('ebay.com.au/itm/')) {
            const match = url.match(/\/itm\/(\d+)/);
            if (match) {
              final = { r: 'SUCCESS', id: match[1] };
              break;
            }
          }
          // Check if listing form shows success
          if (url.includes('ebay.com.au/lstng')) {
            const pageContent = await pg.evaluate(() => {
              const success = document.querySelector('[data-testid="listing-success"],.success-message,.confirmation');
              return success ? success.textContent : null;
            }).catch(() => null);
            if (pageContent) {
              add(`eBay page shows: ${pageContent}`);
            }
          }
        }
      } catch(e) {}

      // Check if all tabs closed (listing complete)
      try {
        const allPages = await browser.pages();
        const hasAli = allPages.some(p => p.url().includes('aliexpress'));
        const hasEbayForm = allPages.some(p => p.url().includes('ebay.com.au/lstng'));
        if (!hasAli && !hasEbayForm && el > 60) {
          add('Ali + eBay tabs both closed - listing may be complete');
          // Check storage for results
          const finalData = await extPage.evaluate(async () => {
            const a = await chrome.storage.local.get(null);
            return JSON.stringify(a, null, 2);
          }).catch(() => '{}');
          add('Final storage: ' + finalData.substring(0, 3000));
          final = { r: 'DONE', id: 'check storage' };
        }
      } catch(e) {}

      if (final) break;
    } catch(e) {
      add(`[${el}s] ⚠️ ${e.message}`);
      try {
        browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
        pages = await browser.pages();
        extPage = pages.find(p => p.url().includes(EXT_ID));
      } catch(e2) {}
    }
  }

  add(''); add('---');
  if (final) {
    if (final.r === 'SUCCESS') add(`## 🎉 VICTORY! eBay Item: ${final.id}`);
    else add(`## Result: ${final.r} — ${final.id}`);
  } else {
    add('## ⏰ TIMEOUT');
  }

  // Final screenshot
  try {
    const allPages = await browser.pages();
    let i = 0;
    for (const pg of allPages) {
      if (pg.url().includes('ebay') || pg.url().includes('aliexpress')) {
        const fname = `/Users/pyrite/Projects/dropflow-extension/test/final-screenshot-${i}.png`;
        await pg.screenshot({ path: fname, fullPage: false });
        add(`📸 ${fname}`);
        i++;
      }
    }
  } catch(e) {}

  // Final storage dump
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
