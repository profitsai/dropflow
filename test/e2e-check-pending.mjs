import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  const extPage = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
  
  const data = await extPage.evaluate(() => new Promise(r => {
    chrome.storage.local.get(null, items => {
      const result = {};
      for (const [k, v] of Object.entries(items)) {
        if (k === 'pendingListing_1373278465') {
          result[k] = v; // full object
        }
        if (k.startsWith('aliBulk')) result[k] = v;
      }
      r(result);
    });
  }));
  
  const pending = data.pendingListing_1373278465;
  if (pending) {
    console.log('Title:', pending.title);
    console.log('Price:', pending.price, pending.currency);
    console.log('eBayPrice:', pending.ebayPrice);
    console.log('eBayTitle:', pending.ebayTitle);
    console.log('Images:', pending.images?.length);
    console.log('PreDownloaded:', pending.preDownloadedImages?.length);
    console.log('Variations:', pending.variations?.hasVariations, 'axes:', pending.variations?.axes?.length, 'skus:', pending.variations?.skus?.length);
    console.log('Description len:', pending.description?.length);
    console.log('AI Description len:', pending.aiDescription?.length);
  }
  
  console.log('\nBulk state keys:', Object.keys(data).filter(k => k.startsWith('aliBulk')));
  
  // Check if there's an eBay tab that might have been created
  const pages = await browser.pages();
  console.log('\nAll pages:');
  pages.forEach(p => console.log(' ', p.url().substring(0, 120)));
  
  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
