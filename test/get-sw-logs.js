const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // Attach to SW via CDP to read console
  const cdpBrowser = await browser.target().createCDPSession();
  const {targetInfos} = await cdpBrowser.send('Target.getTargets');
  const swTarget = targetInfos.find(t => t.url.includes(EXT_ID) && t.type === 'service_worker');
  
  if (!swTarget) {
    console.log('SW not found as target. Checking all targets:');
    targetInfos.forEach(t => console.log(`  ${t.type}: ${t.url.substring(0, 80)}`));
    browser.disconnect();
    return;
  }
  
  console.log('Found SW:', swTarget.targetId);
  
  // Attach to the SW target
  const {sessionId} = await cdpBrowser.send('Target.attachToTarget', { 
    targetId: swTarget.targetId, flatten: true 
  });
  
  // Enable Runtime and Console on the SW session
  // With flatten=true, we send to the child session via sessionId
  const ws = browser.wsEndpoint();
  
  // Actually, let's use a simpler approach - use the page to query the SW
  const pages = await browser.pages();
  const listerPage = pages.find(p => p.url().includes('ali-bulk-lister'));
  
  if (listerPage) {
    // Check if there are any stored logs or errors
    const info = await listerPage.evaluate(async () => {
      // Try to get listing status from storage
      const storage = await chrome.storage.local.get(null);
      const keys = Object.keys(storage);
      const relevantKeys = keys.filter(k => 
        k.includes('ali') || k.includes('bulk') || k.includes('listing') || k.includes('log') || k.includes('error')
      );
      const relevant = {};
      for (const k of relevantKeys) {
        relevant[k] = storage[k];
      }
      return { totalKeys: keys.length, relevantKeys, relevant };
    });
    console.log('Storage info:', JSON.stringify(info, null, 2));
  }
  
  browser.disconnect();
})();
