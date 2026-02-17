const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';
const ALI_LINK = 'https://www.aliexpress.com/item/1005009953521226.html';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  
  let listerPage = pages.find(p => p.url().includes('ali-bulk-lister'));
  if (!listerPage) {
    listerPage = await browser.newPage();
    await listerPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`);
  }
  
  // Listen to ALL console messages
  listerPage.on('console', msg => {
    console.log(`[${msg.type()}] ${msg.text()}`);
  });
  listerPage.on('pageerror', err => console.log('PAGE_ERROR:', err.message));
  
  // Also monitor the service worker via CDP - attach to it
  const cdp = await browser.target().createCDPSession();
  
  // Get all targets
  const {targetInfos} = await cdp.send('Target.getTargets');
  
  // Enable target discovery to catch SW logs
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  
  // Directly invoke the bulk listing via evaluate to see the response
  const result = await listerPage.evaluate(async (link) => {
    try {
      // Import message types
      const resp = await chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: [link],
        threadCount: 1,
        listingType: 'standard',
        ebayDomain: 'www.ebay.com.au'
      });
      return { resp };
    } catch (e) {
      return { error: e.message };
    }
  }, ALI_LINK);
  
  console.log('START response:', JSON.stringify(result));
  
  if (result.error || result.resp?.error) {
    console.log('Failed to start. Error:', result.error || result.resp.error);
    browser.disconnect();
    return;
  }
  
  console.log('Bulk listing started! Monitoring for 60 seconds...');
  
  // Monitor for 60 seconds
  await new Promise(r => setTimeout(r, 60000));
  
  await listerPage.screenshot({ path: '/Users/pyrite/.openclaw/workspace/extension-run2.png' });
  console.log('Screenshot saved');
  
  browser.disconnect();
})();
