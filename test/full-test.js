const puppeteer = require('puppeteer-core');
const CDP = require('chrome-remote-interface');

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:53170/devtools/browser/62367bbf-e195-4eb9-ad09-0505332d0acc',
    defaultViewport: null
  });

  // Open bulk lister page
  const bulkPage = await browser.newPage();
  await bulkPage.goto('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci/pages/ali-bulk-lister/ali-bulk-lister.html', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  // Set markup and keepalive
  await bulkPage.evaluate(() => {
    chrome.storage.local.set({ dropflow_price_markup: 30 });
    if (typeof startKeepAlive === 'function') startKeepAlive();
  });
  console.log('Setup complete');

  // Monitor SW health
  let swChecksFailed = 0;
  const swWatch = setInterval(async () => {
    try {
      const r = await bulkPage.evaluate(() => 
        new Promise(resolve => {
          chrome.runtime.sendMessage({ type: 'KEEPALIVE_PING' }, resp => resolve(resp?.pong ? 'alive' : 'no-pong'));
          setTimeout(() => resolve('timeout'), 3000);
        })
      );
      if (r !== 'alive') { swChecksFailed++; console.log(`[SW] ${r} (fails: ${swChecksFailed})`); }
      else swChecksFailed = 0;
    } catch(e) { swChecksFailed++; console.log(`[SW] error: ${e.message.substring(0, 60)} (fails: ${swChecksFailed})`); }
  }, 15000);

  // Trigger listing
  console.log('\n=== STARTING LISTING ===');
  const resp = await bulkPage.evaluate(() => 
    new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: ['https://www.aliexpress.com/item/1005006280952147.html'],
        marketplace: 'ebay.com.au',
        ebayDomain: 'www.ebay.com.au',
        listingType: 'standard'
      }, resolve);
      setTimeout(() => resolve('timeout'), 5000);
    })
  );
  console.log('Response:', JSON.stringify(resp));

  // Poll status every 10s
  for (let i = 0; i < 36; i++) { // 6 minutes
    await new Promise(r => setTimeout(r, 10000));
    
    const pages = await browser.pages();
    const urls = pages.map(p => p.url());
    
    // Check for eBay form page
    const ebayPage = pages.find(p => p.url().includes('ebay.com.au/lstng'));
    
    // Check storage for progress
    try {
      const status = await bulkPage.evaluate(() => new Promise(async (resolve) => {
        const data = await chrome.storage.local.get([
          'dropflow_last_fill_results', 'dropflow_variation_steps'
        ]);
        const allData = await chrome.storage.local.get(null);
        const pendingKeys = Object.keys(allData).filter(k => k.startsWith('pendingListing_'));
        resolve({
          fillResults: data.dropflow_last_fill_results ? 'exists' : null,
          varSteps: (data.dropflow_variation_steps || []).length,
          lastStep: (data.dropflow_variation_steps || []).slice(-1)[0]?.step || null,
          pendingKeys: pendingKeys.length
        });
      }));
      
      const ebayUrl = urls.find(u => u.includes('ebay.com')) || '';
      const aliUrl = urls.find(u => u.includes('aliexpress.com')) || '';
      console.log(`[${i*10}s] ebay=${ebayUrl.substring(0, 60)} ali=${aliUrl ? 'open' : 'closed'} pending=${status.pendingKeys} varSteps=${status.varSteps} lastStep=${status.lastStep || '-'} fill=${status.fillResults || '-'}`);
      
      if (status.fillResults) {
        console.log('=== FORM FILL COMPLETE ===');
        // Get full results
        const fullResults = await bulkPage.evaluate(() => 
          chrome.storage.local.get('dropflow_last_fill_results').then(d => JSON.stringify(d.dropflow_last_fill_results, null, 2))
        );
        console.log(fullResults);
        break;
      }
    } catch(e) {
      console.log(`[${i*10}s] Error checking status: ${e.message.substring(0, 60)}`);
    }
  }

  clearInterval(swWatch);
  console.log('\n=== DONE ===');
  browser.disconnect();
})().catch(e => console.error('FATAL:', e));
