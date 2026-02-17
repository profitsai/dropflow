const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d' });
  const pages = await browser.pages();
  
  // Find extension ID by looking at existing extension pages or service workers
  console.log('=== All pages ===');
  for (const p of pages) {
    const url = p.url();
    if (url.includes('chrome-extension://') || url.includes('dropflow') || url.includes('ali-bulk')) {
      console.log('EXTENSION PAGE:', url);
    }
  }
  
  // Check service workers via CDP
  const target = pages[0];
  const cdp = await target.createCDPSession();
  
  // Try to find extension service worker
  const {targetInfos} = await cdp.send('Target.getTargets');
  console.log('\n=== Service Workers & Extension Targets ===');
  for (const t of targetInfos) {
    if (t.type === 'service_worker' || t.url.includes('chrome-extension://')) {
      console.log(`${t.type}: ${t.url} (id: ${t.targetId})`);
    }
  }
  
  // Extract extension ID
  const extTarget = targetInfos.find(t => t.url.includes('chrome-extension://') && t.url.includes('cenanjfpigoolnfedgefalledflcodaj'));
  const anyExtTarget = targetInfos.find(t => t.url.includes('chrome-extension://'));
  
  if (extTarget) {
    console.log('\nDropFlow extension found:', extTarget.url);
  } else if (anyExtTarget) {
    console.log('\nFound extension (not DropFlow?):', anyExtTarget.url);
  } else {
    console.log('\nNo extension targets found. Extension may not be loaded.');
  }
  
  // List ALL targets for debugging
  console.log('\n=== ALL targets ===');
  for (const t of targetInfos) {
    console.log(`  ${t.type}: ${t.url.substring(0, 100)}`);
  }
  
  await cdp.detach();
  browser.disconnect();
})();
