const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  console.log('Tabs:', pages.map(p => p.url()).join('\n'));
  
  // Check SW logs from extension page
  const extPage = pages.find(p => p.url().includes(EXT_ID));
  if (extPage) {
    const logs = await extPage.evaluate(async () => {
      const data = await new Promise(r => chrome.storage.local.get('_swLogs', r));
      return data._swLogs || 'no logs';
    });
    console.log('\nSW Logs (last 2000 chars):', typeof logs === 'string' ? logs.slice(-2000) : JSON.stringify(logs).slice(-2000));
  }
  
  browser.disconnect();
})().catch(e => console.error(e.message));
