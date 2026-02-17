const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // Find the ali-bulk-lister page (it's an extension page that can send messages)
  const pages = await browser.pages();
  const extPage = pages.find(p => p.url().includes('ali-bulk-lister'));
  
  if (!extPage) {
    console.error('No ali-bulk-lister page found');
    process.exit(1);
  }
  
  console.log('Found extension page:', extPage.url());
  
  // Send START_ALI_BULK_LISTING with our product URL via the extension page
  const result = await extPage.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: ['https://www.aliexpress.com/item/1005009953521226.html'],
        threadCount: 1,
        ebayDomain: 'www.ebay.com.au',
        listingType: 'standard'
      }, (response) => {
        resolve(response);
      });
    });
  });
  
  console.log('Listing started:', JSON.stringify(result));
  
  // Now monitor - wait for new tabs to appear and track progress
  console.log('Monitoring for 120 seconds...');
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const currentPages = await browser.pages();
    const urls = currentPages.map(p => p.url().substring(0, 100));
    console.log(`[${(i+1)*5}s] Tabs:`, urls.join(' | '));
    
    // Check if eBay listing form appeared
    const ebayLstng = currentPages.find(p => p.url().includes('ebay.com.au/lstng'));
    if (ebayLstng) {
      console.log('eBay listing page found!');
      await ebayLstng.screenshot({ path: 'ebay-listing-progress.png' });
    }
    
    // Check for eBay prelist
    const ebayPrelist = currentPages.find(p => p.url().includes('ebay.com.au/sl/'));
    if (ebayPrelist) {
      console.log('eBay prelist page found!');
    }
  }
  
  browser.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
