const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';
const ALI_LINK = 'https://www.aliexpress.com/item/1005009953521226.html';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  
  // Close old unnecessary tabs (previous listing drafts, extra AliExpress)
  for (const p of pages) {
    const url = p.url();
    if (url.includes('5051135836723') || url.includes('prelist/suggest')) {
      console.log('Closing tab:', url.substring(0, 80));
      await p.close();
    }
  }
  
  // Find lister page
  let listerPage = pages.find(p => p.url().includes('ali-bulk-lister'));
  if (!listerPage) {
    listerPage = await browser.newPage();
    await listerPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`);
  }
  
  // Listen to ALL new targets (to catch new tabs opened by the extension)
  const browserCDP = await browser.target().createCDPSession();
  
  // Monitor new targets and attach console logging
  browserCDP.on('Target.targetCreated', async ({targetInfo}) => {
    console.log(`[TARGET CREATED] ${targetInfo.type}: ${targetInfo.url?.substring(0, 100)}`);
  });
  browserCDP.on('Target.targetDestroyed', ({targetId}) => {
    console.log(`[TARGET DESTROYED] ${targetId}`);
  });
  await browserCDP.send('Target.setDiscoverTargets', { discover: true });
  
  // Setup monitoring: whenever a new page appears, attach console listeners
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      try {
        const page = await target.page();
        if (!page) return;
        const url = target.url();
        console.log(`[NEW PAGE] ${url}`);
        
        page.on('console', msg => {
          const text = msg.text();
          if (text.includes('DropFlow') || text.includes('dropflow') || text.includes('[DF]')) {
            console.log(`[PAGE ${url.substring(0, 40)}] ${text}`);
          }
        });
        page.on('pageerror', err => {
          console.log(`[PAGE ERROR ${url.substring(0, 40)}] ${err.message.substring(0, 200)}`);
        });
      } catch (e) {}
    }
  });
  
  // Also listen to existing eBay/AliExpress tabs
  const existingPages = await browser.pages();
  for (const page of existingPages) {
    const url = page.url();
    if (url.includes('ebay') || url.includes('aliexpress') || url.includes('chrome-extension://')) {
      page.on('console', msg => {
        const text = msg.text();
        if (text.includes('DropFlow') || text.includes('dropflow') || text.includes('[DF]')) {
          console.log(`[EXISTING ${url.substring(0, 40)}] ${text}`);
        }
      });
    }
  }
  
  // Reset the aliBulkRunning flag by sending terminate first
  await listerPage.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'TERMINATE_ALI_BULK_LISTING' });
  });
  console.log('Reset: sent TERMINATE');
  await new Promise(r => setTimeout(r, 1000));
  
  // Start the listing
  console.log('\n=== Starting AliExpress Bulk Listing ===');
  const result = await listerPage.evaluate(async (link) => {
    const resp = await chrome.runtime.sendMessage({
      type: 'START_ALI_BULK_LISTING',
      links: [link],
      threadCount: 1,
      listingType: 'standard',
      ebayDomain: 'www.ebay.com.au'
    });
    return resp;
  }, ALI_LINK);
  console.log('Start response:', JSON.stringify(result));
  
  if (result.error) {
    console.log('FAILED TO START:', result.error);
    browser.disconnect();
    return;
  }
  
  // Monitor for 3 minutes
  console.log('Monitoring for 180 seconds...');
  
  // Periodically check for new pages with DropFlow logs
  for (let i = 0; i < 36; i++) {
    await new Promise(r => setTimeout(r, 5000));
    
    // Check all current pages for new eBay listing tabs
    const currentPages = await browser.pages();
    for (const p of currentPages) {
      const url = p.url();
      if (url.includes('/lstng') && !url.includes('5051135186923') && !url.includes('5051135836723')) {
        console.log(`[CHECK ${i*5}s] New eBay listing tab: ${url}`);
      }
    }
    
    // Check SW status
    const {targetInfos} = await browserCDP.send('Target.getTargets');
    const sw = targetInfos.find(t => t.url.includes(EXT_ID));
    if (!sw) {
      console.log(`[CHECK ${i*5}s] ⚠️ SW not visible as target`);
    }
  }
  
  // Final screenshot of lister
  await listerPage.screenshot({ path: '/Users/pyrite/.openclaw/workspace/run-with-logs.png' });
  
  // Check results
  const state = await listerPage.evaluate(() => {
    return {
      pos: document.getElementById('stat-position')?.textContent,
      total: document.getElementById('stat-total')?.textContent,
      success: document.getElementById('stat-success')?.textContent,
      fail: document.getElementById('stat-fail')?.textContent,
      rows: Array.from(document.querySelectorAll('#results-body tr')).map(tr => tr.textContent.trim())
    };
  });
  console.log('\nFinal state:', JSON.stringify(state, null, 2));
  
  browser.disconnect();
})();
