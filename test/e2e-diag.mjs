import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  
  // Screenshot the extensions error page
  const extErrorPage = (await browser.pages()).find(p => p.url().includes('chrome://extensions'));
  if (extErrorPage) {
    await extErrorPage.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/ext-errors.png', fullPage: true });
    console.log('Saved ext-errors.png');
  }

  // Wake up the service worker by messaging from ext page
  const extPage = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
  if (extPage) {
    try {
      const resp = await extPage.evaluate(() => {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'PING' }, r => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError.message);
            else resolve(r);
          });
        });
      });
      console.log('PING response:', JSON.stringify(resp));
    } catch(e) {
      console.log('PING failed:', e.message);
    }

    // Check storage for any error/status keys
    const data = await extPage.evaluate(() => new Promise(r => {
      chrome.storage.local.get(null, items => {
        const keys = Object.keys(items).filter(k => 
          k.includes('bulk') || k.includes('Bulk') || k.includes('pending') || k.includes('error') || k.includes('scrape')
        );
        const filtered = {};
        keys.forEach(k => filtered[k] = JSON.stringify(items[k]).substring(0, 300));
        r(filtered);
      });
    }));
    console.log('Relevant storage:', JSON.stringify(data, null, 2));
  }

  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
