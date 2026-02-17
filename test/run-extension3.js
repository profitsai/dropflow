const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';
const ALI_LINK = 'https://www.aliexpress.com/item/1005009953521226.html';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // First, let's check the current state of tabs
  const pages = await browser.pages();
  console.log('=== Current tabs ===');
  for (const p of pages) console.log(' ', p.url().substring(0, 120));
  
  // Check if there's already a result from the previous run
  let listerPage = pages.find(p => p.url().includes('ali-bulk-lister'));
  if (listerPage) {
    // Check the progress/results on the page
    const state = await listerPage.evaluate(() => {
      const pos = document.getElementById('stat-position')?.textContent;
      const total = document.getElementById('stat-total')?.textContent;
      const success = document.getElementById('stat-success')?.textContent;
      const fail = document.getElementById('stat-fail')?.textContent;
      const progressVisible = document.getElementById('progress-section')?.style.display;
      const rows = [];
      document.querySelectorAll('#results-body tr').forEach(tr => {
        rows.push(tr.textContent.trim());
      });
      return { pos, total, success, fail, progressVisible, rows };
    });
    console.log('\n=== Lister Page State ===');
    console.log(JSON.stringify(state, null, 2));
  }
  
  // Check for any new tabs that the SW might have opened (eBay listing, AliExpress)
  console.log('\n=== Looking for new eBay/AliExpress tabs ===');
  for (const p of pages) {
    const url = p.url();
    if (url.includes('ebay.com.au/sl/') || url.includes('ebay.com.au/lstng') || url.includes('ebay.com.au/sell')) {
      console.log('eBay listing tab:', url);
    }
    if (url.includes('aliexpress.com/item/')) {
      console.log('AliExpress tab:', url);
    }
  }
  
  // Now try to attach to the service worker to see its console
  const cdpBrowser = await browser.target().createCDPSession();
  const {targetInfos} = await cdpBrowser.send('Target.getTargets');
  
  // Find the extension SW
  const swTarget = targetInfos.find(t => t.url.includes(EXT_ID));
  console.log('\nSW target:', swTarget ? `${swTarget.type}: ${swTarget.url}` : 'NOT FOUND');
  
  // Try attaching to SW if found
  if (swTarget) {
    try {
      const {sessionId} = await cdpBrowser.send('Target.attachToTarget', { 
        targetId: swTarget.targetId, flatten: true 
      });
      console.log('Attached to SW, sessionId:', sessionId);
    } catch (e) {
      console.log('Could not attach to SW:', e.message);
    }
  }
  
  // Check if aliBulkRunning is still true - send a message
  if (listerPage) {
    const status = await listerPage.evaluate(async () => {
      try {
        // Try starting again - if running, it'll say "already running"
        const resp = await chrome.runtime.sendMessage({
          type: 'START_ALI_BULK_LISTING',
          links: ['https://test.com'],
          threadCount: 1,
          ebayDomain: 'www.ebay.com.au'
        });
        return resp;
      } catch (e) {
        return { error: e.message };
      }
    });
    console.log('\nBulk lister status check:', JSON.stringify(status));
  }
  
  await listerPage?.screenshot({ path: '/Users/pyrite/.openclaw/workspace/extension-state.png' });
  console.log('Screenshot saved');
  
  browser.disconnect();
})();
