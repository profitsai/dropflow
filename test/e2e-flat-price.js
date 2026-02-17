const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const ALI_URL = 'https://www.aliexpress.com/item/1005006995032850.html';

const logs = [];
function log(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  logs.push(line);
}

function writeResults(success) {
  const content = `# Flat Price E2E Test Result\n\n**Date:** ${new Date().toISOString()}\n**Status:** ${success ? '✅ SUCCESS' : '❌ INCOMPLETE/TIMEOUT'}\n\n## Console Log\n\n\`\`\`\n${logs.join('\n')}\n\`\`\`\n`;
  fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/FLAT-PRICE-E2E-RESULT.md', content);
  log('Results written');
}

(async () => {
  log('Connecting to browser via CDP...');
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
  log('Connected');

  const pages = await browser.pages();
  log(`Found ${pages.length} existing tabs`);

  // Attach console listeners to ALL pages
  const attachConsole = (p, label) => {
    p.on('console', msg => log(`[${label}] ${msg.type()}: ${msg.text()}`));
    p.on('pageerror', err => log(`[${label}] PAGE_ERROR: ${err?.message || String(err)}`));
  };
  for (let i = 0; i < pages.length; i++) {
    attachConsole(pages[i], `tab${i}:${pages[i].url().substring(0, 50)}`);
  }

  // Watch for new pages
  browser.on('targetcreated', async target => {
    if (target.type() === 'page') {
      try {
        const p = await target.page();
        if (p) {
          const url = p.url();
          log(`New tab opened: ${url}`);
          attachConsole(p, url.includes('ebay') ? 'ebay' : 'new');
        }
      } catch (e) {}
    }
  });

  // Navigate first tab to AliExpress
  const page = pages[0];
  log(`Navigating to ${ALI_URL}...`);
  await page.goto(ALI_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  log('AliExpress page loaded');
  await new Promise(r => setTimeout(r, 5000));

  // Find the extension SW and send message via CDP
  log('Finding extension service worker...');
  const targets = await browser.targets();
  for (const t of targets) {
    log(`  target: type=${t.type()} url=${t.url().substring(0, 100)}`);
  }

  const swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes(EXT_ID));
  if (!swTarget) {
    log('ERROR: Extension service worker not found!');
    writeResults(false);
    process.exit(1);
  }

  log(`Found SW: ${swTarget.url()}`);
  const sw = await swTarget.worker();
  
  // Directly call handleStartAliBulkListing from within the SW context
  log('Calling handleStartAliBulkListing directly...');
  const triggerResult = await sw.evaluate((aliUrl) => {
    // handleStartAliBulkListing is in module scope, but we can dispatch via the onMessage listener
    // by creating a fake MessageEvent. Actually, just use the global function reference.
    // The SW uses `const` bindings in module scope, so we need to trigger the switch case.
    // Workaround: directly invoke the exported handler
    return self.__dropflowStartAliBulk ? 
      self.__dropflowStartAliBulk({ links: [aliUrl], threadCount: 1, ebayDomain: 'www.ebay.com.au' }) :
      { error: '__dropflowStartAliBulk not exposed' };
  }, ALI_URL).catch(e => ({ error: e.message }));
  log(`Trigger result: ${JSON.stringify(triggerResult)}`);

  // Monitor for 15 minutes
  log('Monitoring... (15 min timeout)');
  const startTime = Date.now();
  const MAX_WAIT = 15 * 60 * 1000;

  const check = async () => {
    while (Date.now() - startTime < MAX_WAIT) {
      await new Promise(r => setTimeout(r, 15000));
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const allPages = await browser.pages();
      const urls = await Promise.all(allPages.map(async p => { try { return p.url(); } catch { return '?'; } }));
      log(`[${elapsed}s] Tabs: ${urls.map(u => u.substring(0, 100)).join(' | ')}`);

      // Check for success signals
      for (const p of allPages) {
        try {
          const url = p.url();
          const title = await p.title().catch(() => '');
          if (/congratulations|successfully|listing confirmed/i.test(title)) {
            log(`SUCCESS: "${title}" at ${url}`);
            writeResults(true);
            process.exit(0);
          }
          // Check for eBay listing page with "listed" confirmation
          if (url.includes('ebay') && /listed|success|confirm/i.test(title)) {
            log(`POSSIBLE SUCCESS: "${title}" at ${url}`);
          }
        } catch {}
      }

      // Periodic log flush
      if (elapsed % 60 === 0) {
        writeResults(false);
      }
    }
    log('TIMEOUT');
    writeResults(false);
    process.exit(0);
  };

  await check();

})().catch(err => {
  log(`FATAL: ${err.message}\n${err.stack}`);
  writeResults(false);
  process.exit(1);
});
