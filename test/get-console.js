const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au'));
  const ext = pages.find(p => p.url().includes(EXT_ID));
  
  // Get SW logs from storage
  if (ext) {
    const logs = await ext.evaluate(async () => {
      const d = await new Promise(r => chrome.storage.local.get('_swLogs', r));
      return d._swLogs || [];
    });
    console.log('SW Logs:', JSON.stringify(logs).substring(0, 3000));
  }
  
  // Check what the form looks like now - full scroll
  if (ebay) {
    // Get all visible sections and their state
    const fullState = await ebay.evaluate(() => {
      // Scroll to top first
      window.scrollTo(0, 0);
      
      // Get all input values
      const allInputs = Array.from(document.querySelectorAll('input, select, textarea'));
      const filled = allInputs.filter(i => i.value && i.value.length > 0).map(i => ({
        type: i.type || i.tagName,
        name: i.name || i.getAttribute('aria-label') || i.id || '',
        value: String(i.value).substring(0, 50)
      }));
      
      // Check variations section
      const editBtn = Array.from(document.querySelectorAll('button, a, [role="button"]')).find(el => {
        const parent = el.closest('[class*="variation"], [data-testid*="variation"]') || el.parentElement;
        return el.textContent?.trim() === 'Edit' && parent?.textContent?.includes('Variation');
      });
      
      return {
        filledInputs: filled,
        hasVariationEdit: !!editBtn,
        variationEditText: editBtn?.textContent?.trim()
      };
    });
    
    console.log('Filled inputs:', JSON.stringify(fullState.filledInputs, null, 2));
    console.log('Has variation edit button:', fullState.hasVariationEdit);
  }
  
  browser.disconnect();
})().catch(e => console.error('FATAL:', e.message));
