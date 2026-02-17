const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au'));
  if (!ebay) { log('No eBay page'); browser.disconnect(); return; }
  
  log('eBay URL: ' + ebay.url());
  
  // Check if identify page - select Brand New condition and click Continue
  const result = await ebay.evaluate(() => {
    // Click "Brand New" radio
    const radios = document.querySelectorAll('input[type="radio"][name="condition"]');
    for (const r of radios) {
      if (r.value === '1000') { // 1000 = Brand New
        r.click();
        // Also click the label
        const label = r.closest('label') || r.parentElement;
        if (label) label.click();
        break;
      }
    }
    
    return { clicked: true, url: window.location.href };
  });
  log('Selected condition: ' + JSON.stringify(result));
  
  await sleep(1000);
  
  // Click Continue to listing
  const continueResult = await ebay.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, a'));
    const btn = buttons.find(b => b.textContent?.includes('Continue to listing') || b.textContent?.includes('Continue'));
    if (btn) {
      btn.click();
      return { clicked: true, text: btn.textContent.trim() };
    }
    return { clicked: false, buttons: buttons.map(b => b.textContent?.trim()).filter(t => t).slice(0, 10) };
  });
  log('Continue: ' + JSON.stringify(continueResult));
  
  await sleep(5000);
  log('After continue URL: ' + ebay.url());
  
  // Check what page we're on now
  const pageState = await ebay.evaluate(() => {
    return {
      url: window.location.href,
      title: document.title,
      bodyText: document.body?.innerText?.substring(0, 500)
    };
  });
  log('Page state: ' + JSON.stringify(pageState).substring(0, 500));
  
  await ebay.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/screenshots/after-identify.png' });
  
  browser.disconnect();
})().catch(e => console.error('FATAL:', e.message));
