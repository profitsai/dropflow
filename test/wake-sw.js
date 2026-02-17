const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const pages = await browser.pages();
  
  // Navigate to chrome://extensions to check extension status
  const extPage = pages.find(p => p.url().includes('chrome://extensions'));
  if (extPage) {
    await extPage.bringToFront();
    // Take screenshot
    await extPage.screenshot({ path: 'extensions-page.png' });
    console.log('Extensions page screenshot saved');
    
    // Try to click the service worker link or toggle dev mode
    const extInfo = await extPage.evaluate(() => {
      // Chrome extensions page uses shadow DOM
      const manager = document.querySelector('extensions-manager');
      if (!manager) return 'no manager';
      const shadow = manager.shadowRoot;
      if (!shadow) return 'no shadow';
      return shadow.innerHTML.substring(0, 500);
    });
    console.log('Extension manager:', extInfo);
  }
  
  // Alternative: reload the bulk lister page to wake up the SW
  const bulkLister = pages.find(p => p.url().includes('ali-bulk-lister'));
  if (bulkLister) {
    console.log('Reloading bulk lister to wake service worker...');
    await bulkLister.reload({ waitUntil: 'networkidle0', timeout: 15000 }).catch(e => console.log('Reload timeout, continuing'));
    await new Promise(r => setTimeout(r, 3000));
    
    // Check if SW is now active
    const swTarget = browser.targets().find(t => t.type() === 'service_worker');
    console.log('Service worker after reload:', swTarget ? swTarget.url() : 'STILL NOT FOUND');
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
