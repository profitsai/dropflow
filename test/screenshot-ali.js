const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const aliPages = pages.filter(p => p.url().includes('aliexpress'));
  
  for (let i = 0; i < aliPages.length; i++) {
    await aliPages[i].screenshot({ path: `ali-debug-${i}.png` });
    console.log(`Screenshot ${i}: ${aliPages[i].url()}`);
    
    // Also check the actual HTML
    const html = await aliPages[i].evaluate(() => document.body.innerHTML.substring(0, 2000));
    console.log(`HTML preview ${i}: ${html.substring(0, 500)}`);
  }
  
  browser.disconnect();
})().catch(e => console.error(e.message));
