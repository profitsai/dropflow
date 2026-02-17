const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const pages = await browser.pages();
  console.log(`Total tabs: ${pages.length}`);
  for (let i = 0; i < pages.length; i++) {
    const url = pages[i].url();
    const title = await pages[i].title().catch(() => '?');
    console.log(`  ${i}: [${title}] ${url}`);
  }
  
  // Check bulk lister status
  const bulkLister = pages.find(p => p.url().includes('ali-bulk-lister'));
  if (bulkLister) {
    const text = await bulkLister.evaluate(() => document.body.innerText);
    // Look for status/progress info
    const lines = text.split('\n').filter(l => l.trim());
    console.log('\n--- Bulk Lister Status ---');
    for (const line of lines) {
      if (line.includes('status') || line.includes('Status') || line.includes('progress') || 
          line.includes('error') || line.includes('Error') || line.includes('queue') ||
          line.includes('listing') || line.includes('Listing') || line.includes('scraping') ||
          line.includes('running') || line.includes('idle') || line.includes('Processing')) {
        console.log(line.trim());
      }
    }
    // Also dump full text
    console.log('\n--- Full Text ---');
    console.log(text.substring(0, 3000));
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
