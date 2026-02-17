const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  
  // Check all targets for service worker
  const cdp = await pages[0].createCDPSession();
  const {targetInfos} = await cdp.send('Target.getTargets');
  
  const swTargets = targetInfos.filter(t => t.type === 'service_worker');
  console.log('Service workers:', swTargets.map(t => t.url));
  
  const extSW = swTargets.find(t => t.url.includes(EXT_ID));
  console.log('DropFlow SW:', extSW || 'NOT FOUND');
  
  // Try to check from lister page if chrome.runtime works
  const listerPage = pages.find(p => p.url().includes('ali-bulk-lister'));
  if (listerPage) {
    const result = await listerPage.evaluate(async () => {
      try {
        // Just ping the service worker
        const resp = await chrome.runtime.sendMessage({ type: 'PING' });
        return { success: true, resp };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });
    console.log('SW ping result:', result);
  }
  
  await cdp.detach();
  browser.disconnect();
})();
