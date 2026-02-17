import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  const pages = await browser.pages();
  console.log('=== ALL PAGES ===');
  for (const p of pages) console.log(' ', p.url());

  const extPage = pages.find(p => p.url().includes('ali-bulk-lister'));
  if (!extPage) { console.log('No ext page'); browser.disconnect(); return; }

  // Get ALL storage
  const all = await extPage.evaluate(() => new Promise(r => chrome.storage.local.get(null, r)));
  const keys = Object.keys(all);
  console.log('\n=== STORAGE KEYS ===', keys.length, 'keys');
  for (const k of keys) {
    const v = all[k];
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    console.log(`  ${k}: ${s.substring(0, 200)}`);
  }

  // Check service worker console for errors
  // Also check if there's a background page we can access
  const targets = browser.targets();
  console.log('\n=== TARGETS ===');
  for (const t of targets) console.log(` ${t.type()}: ${t.url().substring(0, 100)}`);

  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
