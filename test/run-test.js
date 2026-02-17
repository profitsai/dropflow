const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:53170/devtools/browser/62367bbf-e195-4eb9-ad09-0505332d0acc',
    defaultViewport: null
  });

  const pages = await browser.pages();
  console.log(`Open pages: ${pages.length}`);
  for (const p of pages) console.log(`  ${p.url().substring(0, 100)}`);

  // Find the bulk lister page
  let bulkPage = pages.find(p => p.url().includes('ali-bulk-lister'));
  if (!bulkPage) {
    console.log('Opening bulk lister page...');
    bulkPage = await browser.newPage();
    await bulkPage.goto('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci/pages/ali-bulk-lister/ali-bulk-lister.html', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));
  }

  // Set markup
  await bulkPage.evaluate(() => {
    chrome.storage.local.set({ dropflow_price_markup: 30 });
  });
  console.log('Set price markup to 30%');

  // Start keepalive from the page
  await bulkPage.evaluate(() => {
    if (typeof startKeepAlive === 'function') startKeepAlive();
  });
  console.log('Started keepalive');

  // Listen to console on ALL pages
  const logHandler = (source) => (msg) => {
    const text = msg.text();
    if (text.includes('DropFlow') || text.includes('variation') || text.includes('fillVariation') || 
        text.includes('photo') || text.includes('image') || text.includes('upload') ||
        text.includes('keep-alive') || text.includes('keepalive') || text.includes('MSKU') ||
        text.includes('builder') || text.includes('error') || text.includes('Error')) {
      console.log(`[${source}] ${text.substring(0, 200)}`);
    }
  };

  // Monitor new pages for their console
  browser.on('targetcreated', async (target) => {
    console.log(`[NEW TARGET] ${target.type()}: ${target.url().substring(0, 100)}`);
    if (target.type() === 'page') {
      try {
        const page = await target.page();
        if (page) page.on('console', logHandler(target.url().substring(0, 50)));
      } catch(e) {}
    }
  });

  for (const p of pages) {
    p.on('console', logHandler(p.url().substring(0, 50)));
  }

  // Also monitor service worker
  // Trigger the bulk listing
  console.log('\n=== TRIGGERING BULK LISTING ===');
  await bulkPage.evaluate(() => {
    chrome.runtime.sendMessage({
      type: 'START_ALI_BULK_LISTING',
      links: ['https://www.aliexpress.com/item/1005006280952147.html'],
      marketplace: 'ebay.com.au',
      ebayDomain: 'www.ebay.com.au',
      listingType: 'standard'
    }).then(r => console.log('START response:', JSON.stringify(r)));
  });

  // Monitor for 5 minutes
  console.log('Monitoring for 5 minutes...');
  await new Promise(r => setTimeout(r, 300000));

  console.log('Done monitoring');
})().catch(e => console.error('FATAL:', e.message));
