import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  
  // Find SW
  const swTarget = browser.targets().find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  if (!swTarget) {
    // Wake it up
    const extPage = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
    if (extPage) {
      await extPage.evaluate(() => chrome.runtime.sendMessage({ type: 'PING' }));
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  const swTarget2 = browser.targets().find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  if (!swTarget2) { console.log('No SW target'); browser.disconnect(); return; }
  
  const sw = await swTarget2.worker();
  
  // Check bulk state in SW memory
  const state = await sw.evaluate(() => {
    const g = globalThis;
    return {
      // Common patterns for bulk state
      aliBulkRunning: g.aliBulkRunning,
      bulkQueue: g.bulkQueue,
      currentLinks: g.currentLinks,
      // Look at all enumerable globals that might be relevant
      globalKeys: Object.keys(g).filter(k => k.toLowerCase().includes('bulk') || k.toLowerCase().includes('ali') || k.toLowerCase().includes('listing')),
    };
  });
  console.log('SW in-memory state:', JSON.stringify(state, null, 2));

  // Also use CDP to get recent console messages from the SW
  const cdpSession = await swTarget2.createCDPSession();
  await cdpSession.send('Runtime.enable');
  
  // Evaluate to check recent logs (not possible directly, but check error state)
  const evalResult = await sw.evaluate(() => {
    // Return any stored error state
    return new Promise(resolve => {
      chrome.storage.local.get(['aliBulkRunning', 'aliBulkError', 'lastBulkError'], resolve);
    });
  });
  console.log('Storage state:', JSON.stringify(evalResult));

  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
