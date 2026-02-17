const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au'));
  const ext = pages.find(p => p.url().includes(EXT_ID));
  
  if (ext) {
    const storage = await ext.evaluate(async () => {
      const d = await new Promise(r => chrome.storage.local.get(null, r));
      return Object.keys(d).map(k => `${k}: ${JSON.stringify(d[k]).substring(0, 100)}`);
    });
    log('Storage keys:\n' + storage.join('\n'));
  }
  
  if (ebay) {
    log('eBay URL: ' + ebay.url());
    
    // Get full form state
    const formState = await ebay.evaluate(() => {
      const titleInput = document.querySelector('#title-input') || 
        document.querySelector('[data-testid="title"] input') ||
        Array.from(document.querySelectorAll('input[type="text"]')).find(i => i.value && i.value.length > 20);
      
      const photoZone = document.querySelector('[class*="photo"], [class*="upload"], [data-testid="photos"]');
      const imgs = document.querySelectorAll('img[src*="ebayimg"], img[src*="i.ebayimg"]');
      
      const descIframe = document.querySelector('iframe[id*="description"], iframe[title*="description"]');
      
      const varSection = Array.from(document.querySelectorAll('button, a, [role="button"]')).find(el => 
        el.textContent?.toLowerCase().includes('variation'));
      
      const allSections = Array.from(document.querySelectorAll('h2, h3, [class*="section-title"]')).map(s => s.textContent?.trim());
      
      return {
        url: window.location.href,
        titleValue: titleInput?.value || 'NO TITLE INPUT FOUND',
        photoCount: imgs.length,
        hasDescIframe: !!descIframe,
        variationButton: varSection?.textContent?.trim(),
        sections: allSections,
        bodySnippet: document.body.innerText.substring(0, 1000)
      };
    });
    log('Form state: ' + JSON.stringify(formState, null, 2));
    
    await ebay.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/screenshots/form-state.png', fullPage: true });
  }
  
  browser.disconnect();
})().catch(e => console.error('FATAL:', e.message));
