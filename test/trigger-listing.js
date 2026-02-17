const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';
const ALI_LINK = 'https://www.aliexpress.com/item/1005009953521226.html';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  let listerPage = pages.find(p => p.url().includes('ali-bulk-lister'));
  
  // Reset first
  await listerPage.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'TERMINATE_ALI_BULK_LISTING' });
  });
  await new Promise(r => setTimeout(r, 1000));
  
  // Start
  const result = await listerPage.evaluate(async (link) => {
    return await chrome.runtime.sendMessage({
      type: 'START_ALI_BULK_LISTING',
      links: [link],
      threadCount: 1,
      listingType: 'standard',
      ebayDomain: 'www.ebay.com.au'
    });
  }, ALI_LINK);
  console.log('Result:', JSON.stringify(result));
  
  browser.disconnect();
})();
