const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXT = 'hikiofeedjngalncoapgpmljpaoeolci';
const WS = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // Wake SW
  let targets = await browser.targets();
  let sw = targets.find(t => t.url().includes(EXT) && t.type() === 'service_worker');
  if (!sw) {
    const p = await browser.newPage();
    await p.goto('chrome-extension://' + EXT + '/background/service-worker.js');
    await sleep(3000);
    await p.close();
    targets = await browser.targets();
    sw = targets.find(t => t.url().includes(EXT) && t.type() === 'service_worker');
  }
  console.log('SW:', sw ? 'ALIVE' : 'DEAD');
  
  // Find eBay page
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay') && p.url().includes('/lstng'));
  if (!ebayPage) { console.log('No eBay page'); browser.disconnect(); return; }
  console.log('eBay:', ebayPage.url());

  // Get tab IDs from SW
  const swCdp = await sw.createCDPSession();
  
  // Listen to SW console
  swCdp.on('Runtime.consoleAPICalled', (event) => {
    const text = event.args.map(a => a.value || a.description || '').join(' ');
    if (text.includes('DropFlow') || text.includes('Ali') || text.includes('error')) {
      console.log('[SW]', text.substring(0, 400));
    }
  });
  await swCdp.send('Runtime.enable');

  // Find all eBay tab IDs and inject form filler
  const injectExpr = `
    chrome.tabs.query({url: '*://*.ebay.com.au/lstng*'}).then(tabs => {
      const promises = tabs.map(tab => 
        chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['content-scripts/ebay/form-filler.js']
        }).then(() => 'tab ' + tab.id + ' injected')
        .catch(e => 'tab ' + tab.id + ' error: ' + e.message)
      );
      return Promise.all(promises);
    }).then(r => JSON.stringify(r))
  `;
  const injectResult = await swCdp.send('Runtime.evaluate', {
    expression: injectExpr,
    awaitPromise: true
  });
  console.log('Inject:', injectResult.result?.value);

  await sleep(3000);

  // Monitor eBay page console
  ebayPage.on('console', msg => {
    const text = msg.text();
    if (text.includes('DropFlow')) console.log('[EBAY]', text.substring(0, 400));
  });

  const loaded = await ebayPage.evaluate(() => window.__dropflow_form_filler_loaded).catch(() => false);
  console.log('Form filler loaded:', loaded);

  // Wait up to 5 minutes for form fill
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    
    // Check fill results in storage
    try {
      const extPage = (await browser.pages()).find(p => p.url().includes(EXT));
      if (extPage) {
        const results = await extPage.evaluate(() => 
          chrome.storage.local.get('dropflow_last_fill_results').then(d => d.dropflow_last_fill_results)
        ).catch(() => null);
        if (results) {
          console.log('✅ FILL RESULTS:', JSON.stringify(results, null, 2));
          break;
        }
      }
    } catch (_) {}
    
    if (i % 6 === 0) console.log('Waiting...', i * 5 + 's');
  }
  
  browser.disconnect();
})().catch(e => console.error('FATAL:', e.message));
