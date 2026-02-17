const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';
const ALI_LINK = 'https://www.aliexpress.com/item/1005009953521226.html';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  let pages = await browser.pages();
  
  // Close extra AliExpress and old eBay tabs
  for (const p of pages) {
    const url = p.url();
    if (url.includes('aliexpress.com/item/') || (url.includes('ebay.com.au/lstng') && url.includes('5051135186923'))) {
      console.log('Closing:', url.substring(0, 60));
      try { await p.close(); } catch(e) {}
    }
  }
  
  // Find/open lister page
  pages = await browser.pages();
  let listerPage = pages.find(p => p.url().includes('ali-bulk-lister'));
  if (!listerPage) {
    listerPage = await browser.newPage();
    await listerPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`);
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Clear logs and reset
  await listerPage.evaluate(async () => {
    await chrome.storage.local.set({ _swLogs: [] });
    await chrome.runtime.sendMessage({ type: 'TERMINATE_ALI_BULK_LISTING' });
  });
  console.log('Cleared logs and reset');
  await new Promise(r => setTimeout(r, 1000));
  
  // Start listing
  console.log('\n=== Starting listing ===');
  const result = await listerPage.evaluate(async (link) => {
    return await chrome.runtime.sendMessage({
      type: 'START_ALI_BULK_LISTING',
      links: [link],
      threadCount: 1,
      listingType: 'standard',
      ebayDomain: 'www.ebay.com.au'
    });
  }, ALI_LINK);
  console.log('Response:', JSON.stringify(result));
  
  // Poll logs every 5 seconds for 3 minutes
  let lastLogCount = 0;
  for (let i = 0; i < 36; i++) {
    await new Promise(r => setTimeout(r, 5000));
    
    const logs = await listerPage.evaluate(async () => {
      const { _swLogs = [] } = await chrome.storage.local.get('_swLogs');
      return _swLogs;
    }).catch(() => []);
    
    if (logs.length > lastLogCount) {
      for (let j = lastLogCount; j < logs.length; j++) {
        const log = logs[j];
        const ts = new Date(log.t).toLocaleTimeString();
        console.log(`[${ts} ${log.l}] ${log.m}`);
      }
      lastLogCount = logs.length;
    }
    
    // Check if listing completed
    const state = await listerPage.evaluate(() => ({
      pos: document.getElementById('stat-position')?.textContent,
      total: document.getElementById('stat-total')?.textContent,
      success: document.getElementById('stat-success')?.textContent,
      fail: document.getElementById('stat-fail')?.textContent,
    }));
    
    if (state.pos === state.total && state.total !== '0' && (parseInt(state.success) + parseInt(state.fail)) > 0) {
      console.log(`\nCompleted! Success: ${state.success}, Failed: ${state.fail}`);
      break;
    }
  }
  
  // Final log dump
  const finalLogs = await listerPage.evaluate(async () => {
    const { _swLogs = [] } = await chrome.storage.local.get('_swLogs');
    return _swLogs;
  });
  
  if (finalLogs.length > lastLogCount) {
    console.log('\n=== Remaining logs ===');
    for (let j = lastLogCount; j < finalLogs.length; j++) {
      const log = finalLogs[j];
      const ts = new Date(log.t).toLocaleTimeString();
      console.log(`[${ts} ${log.l}] ${log.m}`);
    }
  }
  
  console.log(`\nTotal log entries: ${finalLogs.length}`);
  browser.disconnect();
})();
