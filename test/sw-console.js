const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const swTarget = browser.targets().find(t => t.type() === 'service_worker');
  if (!swTarget) {
    console.log('No service worker found!');
    browser.disconnect();
    return;
  }
  
  const sw = await swTarget.worker();
  
  // Listen to console output
  sw.on('console', msg => {
    console.log(`[SW ${msg.type()}] ${msg.text()}`);
  });
  
  // Also check bulk lister for new progress
  const pages = await browser.pages();
  const bulkLister = pages.find(p => p.url().includes('ali-bulk-lister'));
  
  console.log('Listening to service worker console for 60s...');
  
  // Also periodically check bulk lister status
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    if (bulkLister) {
      const status = await bulkLister.evaluate(() => {
        const body = document.body.innerText;
        const pos = body.match(/Position:\s*\d+\s*\/\s*\d+/)?.[0];
        const succ = body.match(/Success:\s*\d+/)?.[0];
        const fail = body.match(/Failed:\s*\d+/)?.[0];
        const rows = Array.from(document.querySelectorAll('table tbody tr')).map(r =>
          Array.from(r.cells).map(c => c.textContent.trim().substring(0, 60)).join(' | ')
        );
        return { pos, succ, fail, rows };
      });
      console.log(`[${(i+1)*5}s] ${status.pos} ${status.succ} ${status.fail} rows:${status.rows.length}`);
      if (status.rows.length) status.rows.forEach(r => console.log(`  ${r}`));
    }
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
