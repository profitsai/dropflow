import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  const extPage = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
  
  // Get ALL storage - full dump
  const all = await extPage.evaluate(() => new Promise(r => chrome.storage.local.get(null, r)));
  
  // Print everything
  for (const [k, v] of Object.entries(all)) {
    const s = JSON.stringify(v);
    console.log(`\n=== ${k} (${s.length} chars) ===`);
    console.log(s.substring(0, 1000));
  }

  // Also check if the service worker has any in-memory state
  const targets = browser.targets();
  const swTarget = targets.find(t => t.url().includes('hikiofeedjngalncoapgpmljpaoeolci') && t.type() === 'service_worker');
  if (swTarget) {
    const sw = await swTarget.worker();
    const swState = await sw.evaluate(() => {
      // Check for any global state about the bulk listing process
      const g = globalThis;
      return {
        aliBulkRunning: g.aliBulkRunning,
        aliBulkQueue: g.aliBulkQueue ? g.aliBulkQueue.length : undefined,
        currentBulkThread: g.currentBulkThread,
        // Check for any pending promises
      };
    });
    console.log('\n=== SW STATE ===', JSON.stringify(swState));
  }

  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
