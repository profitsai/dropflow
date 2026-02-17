const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  
  // Reload extension
  const extPage = await browser.newPage();
  await extPage.goto('chrome://extensions');
  await new Promise(r => setTimeout(r, 1000));
  
  // Use CDP to reload extension
  const client = await extPage.target().createCDPSession();
  
  // Navigate to extension management and reload
  await extPage.evaluate(() => {
    // Try to find and click the reload button for the extension
    const mgr = document.querySelector('extensions-manager');
    if (mgr && mgr.shadowRoot) {
      const list = mgr.shadowRoot.querySelector('extensions-item-list');
      if (list && list.shadowRoot) {
        const items = list.shadowRoot.querySelectorAll('extensions-item');
        for (const item of items) {
          if (item.shadowRoot) {
            const name = item.shadowRoot.querySelector('#name');
            if (name && name.textContent.includes('DropFlow')) {
              const reloadBtn = item.shadowRoot.querySelector('#dev-reload-button');
              if (reloadBtn) reloadBtn.click();
            }
          }
        }
      }
    }
  });
  
  console.log('Extension reload triggered. Waiting 2s...');
  await new Promise(r => setTimeout(r, 2000));
  await extPage.close();
  
  // Now navigate the eBay page to reload it
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  if (ebayPage) {
    console.log('Reloading eBay page...');
    await ebayPage.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    console.log('eBay page reloaded. Waiting for form to load...');
    await new Promise(r => setTimeout(r, 5000));
    
    // Clear extension state to allow re-fill
    await ebayPage.evaluate(() => {
      try {
        chrome.storage.local.remove([
          'dropflow_last_fill_results',
          'dropflow_variation_log',
          'dropflow_variation_check',
          'dropflow_fill_in_progress'
        ]);
      } catch(e) {}
    }).catch(() => {});
    
    console.log('State cleared.');
  }
  
  browser.disconnect();
  console.log('Done. Extension reloaded, page refreshed, state cleared.');
})().catch(e => console.error(e));
