const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/itm/'));
  
  // Scroll to the msku section
  await ebay.evaluate(() => {
    const el = document.querySelector('.x-sku, [class*="x-sku"]');
    if (el) el.scrollIntoView({ block: 'start' });
    else {
      // find "Dog Size" text
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.includes('Dog Size')) {
          walker.currentNode.parentElement.scrollIntoView({ block: 'start' });
          break;
        }
      }
    }
  });
  await sleep(500);
  await ebay.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/screenshots/sku-section.png' });
  
  // Get the msku options more carefully
  const msku = await ebay.evaluate(() => {
    const container = document.querySelector('.x-sku, [class*="msku"]');
    if (!container) return { error: 'no container' };
    return {
      html: container.innerHTML.substring(0, 2000),
      text: container.innerText,
      children: container.children.length
    };
  });
  console.log('MSKU text:', msku.text);
  console.log('MSKU html snippet:', msku.html?.substring(0, 500));
  
  browser.disconnect();
})().catch(e => console.error('FATAL:', e.message));
