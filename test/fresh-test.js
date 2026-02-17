const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:53170/devtools/browser/62367bbf-e195-4eb9-ad09-0505332d0acc',
    defaultViewport: null
  });

  // Close all eBay tabs
  const pages = await browser.pages();
  for (const p of pages) {
    if (p.url().includes('ebay.com') || p.url().includes('aliexpress.com')) {
      console.log('Closing:', p.url().substring(0, 80));
      try { await p.close(); } catch(e) {}
    }
  }
  
  // Find bulk lister page
  let bulkPage = (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
  if (!bulkPage) {
    bulkPage = await browser.newPage();
    await bulkPage.goto('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci/pages/ali-bulk-lister/ali-bulk-lister.html', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));
  }

  // Set up markup and keepalive
  await bulkPage.evaluate(() => {
    chrome.storage.local.set({ dropflow_price_markup: 30 });
    if (typeof startKeepAlive === 'function') startKeepAlive();
  });

  // Set up monitoring for all new pages
  browser.on('targetcreated', async (target) => {
    const url = target.url();
    console.log(`[TARGET] ${target.type()}: ${url.substring(0, 100)}`);
    if (target.type() === 'page') {
      try {
        const page = await target.page();
        if (page) {
          page.on('console', (msg) => {
            const text = msg.text();
            if (text.includes('DropFlow') || text.includes('[DropFlow')) {
              console.log(`[PAGE ${url.substring(0, 30)}] ${text.substring(0, 250)}`);
            }
          });
        }
      } catch(e) {}
    }
  });

  // Monitor SW via keepalive pings
  const swWatchInterval = setInterval(async () => {
    try {
      const result = await bulkPage.evaluate(() => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'KEEPALIVE_PING' }, (resp) => {
            resolve(resp ? 'alive' : 'no-response');
          });
          setTimeout(() => resolve('timeout'), 2000);
        });
      });
      if (result !== 'alive') console.log(`[SW CHECK] ${result}`);
    } catch(e) {
      console.log(`[SW CHECK] ERROR: ${e.message}`);
    }
  }, 10000);

  console.log('\n=== TRIGGERING BULK LISTING ===');
  const startResp = await bulkPage.evaluate(() => {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: ['https://www.aliexpress.com/item/1005006280952147.html'],
        marketplace: 'ebay.com.au',
        ebayDomain: 'www.ebay.com.au',
        listingType: 'standard'
      }, resolve);
      setTimeout(() => resolve('timeout'), 5000);
    });
  });
  console.log('Start response:', JSON.stringify(startResp));

  // Wait and monitor
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    
    // Check what pages are open
    const currentPages = await browser.pages();
    const urls = currentPages.map(p => p.url().substring(0, 80));
    const ebayPage = currentPages.find(p => p.url().includes('ebay.com.au/lstng'));
    
    if (ebayPage && i % 6 === 0) {
      try {
        const status = await ebayPage.evaluate(() => {
          return JSON.stringify({
            filler: typeof window.__dropflow_form_filler_loaded,
            url: window.location.href.substring(0, 80)
          });
        });
        console.log(`[STATUS ${i*5}s] eBay: ${status}`);
      } catch(e) {
        console.log(`[STATUS ${i*5}s] eBay eval error: ${e.message.substring(0, 60)}`);
      }
    }
    
    if (i % 12 === 0) {
      console.log(`[STATUS ${i*5}s] Pages: ${urls.join(' | ')}`);
    }
  }

  clearInterval(swWatchInterval);
  console.log('Done');
})().catch(e => console.error('FATAL:', e));
