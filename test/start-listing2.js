const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const pages = await browser.pages();
  const bulkLister = pages.find(p => p.url().includes('ali-bulk-lister'));
  await bulkLister.bringToFront();
  
  // Clear and set URL
  await bulkLister.evaluate(() => {
    const textarea = document.getElementById('links-input');
    textarea.value = 'https://www.aliexpress.com/item/1005009953521226.html';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  });
  
  // Ensure AU marketplace
  await bulkLister.evaluate(() => {
    const sel = document.getElementById('ebay-marketplace');
    sel.value = 'www.ebay.com.au';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('thread-count').value = '1';
  });
  
  await new Promise(r => setTimeout(r, 500));
  
  // Verify
  const linkCount = await bulkLister.evaluate(() => {
    const el = document.getElementById('link-count');
    return el ? el.textContent : document.body.innerText.match(/(\d+) links? detected/)?.[0];
  });
  console.log(`Links: ${linkCount}`);
  
  // Click Start
  await bulkLister.click('#btn-start');
  console.log('Started listing!');
  
  // Monitor
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    
    const status = await bulkLister.evaluate(() => {
      const progress = document.querySelector('.progress-text, #progress-text, .progress');
      const table = document.querySelectorAll('table tbody tr');
      const rows = Array.from(table).map(r => 
        Array.from(r.cells).map(c => c.textContent.trim().substring(0, 80)).join(' | ')
      );
      const bodyText = document.body.innerText;
      const posMatch = bodyText.match(/Position:\s*(\d+)\s*\/\s*(\d+)/);
      const successMatch = bodyText.match(/Success:\s*(\d+)/);
      const failedMatch = bodyText.match(/Failed:\s*(\d+)/);
      return {
        position: posMatch ? posMatch[0] : null,
        success: successMatch ? successMatch[0] : null, 
        failed: failedMatch ? failedMatch[0] : null,
        rows,
        progress: progress ? progress.textContent.trim() : null
      };
    });
    
    console.log(`[${(i+1)*5}s] ${status.position || ''} ${status.success || ''} ${status.failed || ''}`);
    if (status.rows.length) {
      for (const r of status.rows) console.log(`  Row: ${r}`);
    }
    
    // Check for new listing/prelist tabs
    const allPages = await browser.pages();
    for (const p of allPages) {
      const url = p.url();
      if (url.includes('/sl/prelist') || (url.includes('/lstng') && !url.includes('5023329324423'))) {
        console.log(`  NEW TAB: ${url}`);
      }
    }
    
    // Check completion
    if (status.success && parseInt(status.success.match(/\d+/)?.[0]) > 0) {
      console.log('SUCCESS! Listing completed!');
      await bulkLister.screenshot({ path: 'listing-success.png', fullPage: true });
      break;
    }
    if (status.failed && parseInt(status.failed.match(/\d+/)?.[0]) > 0) {
      console.log('FAILED - checking details...');
      await bulkLister.screenshot({ path: 'listing-failed.png', fullPage: true });
      // Continue monitoring - don't break
    }
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
