const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const pages = await browser.pages();
  console.log(`Open tabs: ${pages.length}`);
  for (const p of pages) {
    console.log(`  - ${await p.url()}`);
  }
  
  // Check for extension targets
  const targets = browser.targets();
  const extTargets = targets.filter(t => t.url().startsWith('chrome-extension://'));
  console.log(`\nExtension targets: ${extTargets.length}`);
  for (const t of extTargets) {
    console.log(`  - ${t.type()} | ${t.url()}`);
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
