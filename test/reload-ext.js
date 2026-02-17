const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  
  // Find chrome://extensions page
  let extPage = pages.find(p => p.url().includes('chrome://extensions'));
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto('chrome://extensions');
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Reload the extension via the extensions page
  // The reload button is inside shadow DOM
  const reloaded = await extPage.evaluate((extId) => {
    // Access extensions-manager shadow root
    const manager = document.querySelector('extensions-manager');
    if (!manager || !manager.shadowRoot) return 'no manager';
    
    const itemList = manager.shadowRoot.querySelector('extensions-item-list');
    if (!itemList || !itemList.shadowRoot) return 'no item list';
    
    const items = itemList.shadowRoot.querySelectorAll('extensions-item');
    for (const item of items) {
      if (item.id === extId) {
        const sr = item.shadowRoot;
        if (!sr) return 'no shadow root on item';
        
        // Find the reload button (appears for unpacked extensions in dev mode)
        const reloadBtn = sr.querySelector('#dev-reload-button') || 
                          sr.querySelector('[id*="reload"]') ||
                          sr.querySelector('cr-icon-button[title="Reload"]');
        if (reloadBtn) {
          reloadBtn.click();
          return 'clicked reload';
        }
        
        // Alternative: look for all buttons
        const buttons = sr.querySelectorAll('cr-icon-button, cr-button, button');
        const btnTexts = Array.from(buttons).map(b => `${b.id}|${b.title}|${b.textContent?.trim()}`);
        return 'no reload btn found, buttons: ' + btnTexts.join(', ');
      }
    }
    return 'extension not found in list';
  }, EXT_ID);
  
  console.log('Reload result:', reloaded);
  await new Promise(r => setTimeout(r, 3000));
  
  // Verify SW is back
  const cdp = await browser.target().createCDPSession();
  const {targetInfos} = await cdp.send('Target.getTargets');
  const sw = targetInfos.find(t => t.url.includes(EXT_ID));
  console.log('SW after reload:', sw ? 'found' : 'NOT found');
  
  browser.disconnect();
})();
