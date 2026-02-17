const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const cdp = await browser.target().createCDPSession();
  const {targetInfos} = await cdp.send('Target.getTargets');
  
  const sw = targetInfos.find(t => t.url.includes(EXT_ID));
  console.log('SW:', sw ? `${sw.type} - ${sw.url.substring(0, 80)}` : 'NOT FOUND');
  
  // Check pages
  const pages = await browser.pages();
  console.log('Pages:');
  for (const p of pages) {
    const url = p.url();
    if (url.includes('aliexpress') || url.includes('ebay') || url.includes('chrome-extension')) {
      console.log(' ', url.substring(0, 100));
    }
  }
  
  // Ping SW
  const listerPage = pages.find(p => p.url().includes('ali-bulk-lister'));
  if (listerPage) {
    const ping = await listerPage.evaluate(async () => {
      try {
        return await chrome.runtime.sendMessage({ type: 'PING' });
      } catch (e) { return { error: e.message }; }
    });
    console.log('Ping:', JSON.stringify(ping));
  }
  
  await cdp.detach();
  browser.disconnect();
})();
