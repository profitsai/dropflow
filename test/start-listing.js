const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const pages = await browser.pages();
  const bulkLister = pages.find(p => p.url().includes('ali-bulk-lister'));
  await bulkLister.bringToFront();
  
  // Clear textarea and set our product URL
  await bulkLister.evaluate(() => {
    const textarea = document.getElementById('links-input');
    textarea.value = 'https://www.aliexpress.com/item/1005009953521226.html';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  });
  
  // Verify marketplace is AU
  const marketplace = await bulkLister.evaluate(() => document.getElementById('ebay-marketplace').value);
  console.log(`Marketplace: ${marketplace}`);
  
  // Set threads to 1 for single product
  await bulkLister.evaluate(() => {
    document.getElementById('thread-count').value = '1';
  });
  
  // Verify link count
  await new Promise(r => setTimeout(r, 500));
  const linkCount = await bulkLister.evaluate(() => {
    const el = document.getElementById('link-count') || document.querySelector('.link-count');
    return el ? el.textContent : 'not found';
  });
  console.log(`Link count: ${linkCount}`);
  
  // Click Start Listing
  await bulkLister.click('#btn-start');
  console.log('Clicked Start Listing!');
  
  // Monitor progress for up to 3 minutes
  for (let i = 0; i < 36; i++) {
    await new Promise(r => setTimeout(r, 5000));
    
    const status = await bulkLister.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr, .listing-row, .product-row');
      const statusEls = document.querySelectorAll('.status, [class*="status"]');
      const logEl = document.getElementById('log') || document.querySelector('.log, [class*="log"]');
      return {
        rows: Array.from(rows).map(r => r.textContent.trim().substring(0, 200)),
        statuses: Array.from(statusEls).map(s => s.textContent.trim().substring(0, 100)),
        log: logEl ? logEl.textContent.trim().substring(0, 500) : null,
        bodySnippet: document.body.innerText.substring(0, 300)
      };
    });
    
    console.log(`\n--- Check ${i+1} (${(i+1)*5}s) ---`);
    if (status.rows.length) console.log('Rows:', status.rows);
    if (status.statuses.length) console.log('Statuses:', status.statuses);
    if (status.log) console.log('Log:', status.log);
    
    // Check all pages for new tabs (eBay listing pages)
    const allPages = await browser.pages();
    const newTabs = allPages.filter(p => {
      const url = p.url();
      return url.includes('/lstng') || url.includes('/sl/prelist') || url.includes('bulkedit');
    });
    if (newTabs.length) {
      console.log('New listing tabs:', newTabs.map(p => p.url()));
    }
    
    // Check if done
    const bodyText = status.bodySnippet.toLowerCase();
    if (bodyText.includes('completed') || bodyText.includes('success') || bodyText.includes('listed')) {
      console.log('LISTING APPEARS COMPLETE!');
      break;
    }
    if (bodyText.includes('error') || bodyText.includes('failed')) {
      console.log('ERROR DETECTED - taking screenshot');
      await bulkLister.screenshot({ path: 'listing-error.png', fullPage: true });
      // Don't break - let it continue trying
    }
  }
  
  await bulkLister.screenshot({ path: 'listing-final.png', fullPage: true });
  console.log('Final screenshot saved');
  
  browser.disconnect();
})().catch(e => console.error(e));
