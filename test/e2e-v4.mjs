import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Use a fresh connection for each operation to avoid stale refs
async function withBrowser(fn) {
  const b = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  try { return await fn(b); } finally { b.disconnect(); }
}

async function getExtPage(browser) {
  return (await browser.pages()).find(p => p.url().includes('ali-bulk-lister'));
}

async function run() {
  // Step 1: Reload extension (fresh connection, then disconnect)
  await withBrowser(async (b) => {
    const ext = await getExtPage(b);
    if (ext) {
      console.log('Reloading extension...');
      await ext.evaluate(() => chrome.runtime.reload());
    }
  });
  await sleep(5000);

  // Step 2: Open ext page if needed and clear state
  await withBrowser(async (b) => {
    let ext = await getExtPage(b);
    if (!ext) {
      ext = await b.newPage();
      await ext.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded' });
      await sleep(1000);
    }
    
    const removed = await ext.evaluate(() => new Promise(r => chrome.storage.local.get(null, items => {
      const keys = Object.keys(items).filter(k => 
        k.startsWith('dropflow_') || k.startsWith('aliBulk') || k.startsWith('pendingListing_') || k.startsWith('__dfBuilder')
      );
      chrome.storage.local.remove(keys, () => r(keys));
    })));
    console.log('Cleared:', removed.length, 'keys');

    // Close eBay tabs
    for (const p of await b.pages()) {
      if (p.url().includes('ebay.com.au/lstng') || p.url().includes('ebay.com.au/sl/')) {
        await p.close().catch(() => {});
      }
    }
  });

  // Step 3: Trigger
  await withBrowser(async (b) => {
    const ext = await getExtPage(b);
    const resp = await ext.evaluate(() => new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: ['https://a.aliexpress.com/_mMLcP7b'],
        marketplace: 'ebay.com.au',
        ebayDomain: 'www.ebay.com.au',
        listingType: 'standard',
        threadCount: 1
      }, r => resolve(r));
    }));
    console.log('Trigger:', JSON.stringify(resp));
  });

  // Step 4: Monitor with SW console - persistent connection
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  
  // Wait for SW to be available, then attach
  let swAttached = false;
  const attachSW = async () => {
    const sw = browser.targets().find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
    if (sw && !swAttached) {
      try {
        const cdp = await sw.createCDPSession();
        await cdp.send('Runtime.enable');
        cdp.on('Runtime.consoleAPICalled', (event) => {
          const text = event.args.map(a => a.value ?? a.description ?? '?').join(' ');
          console.log(`[SW]`, text.substring(0, 400));
        });
        cdp.on('Runtime.exceptionThrown', (event) => {
          console.log(`[EXC]`, event.exceptionDetails?.exception?.description?.substring(0, 300));
        });
        swAttached = true;
        console.log('SW console attached');
      } catch(e) {}
    }
  };
  
  browser.on('targetcreated', async (t) => {
    console.log(`[+] ${t.type()} ${t.url()?.substring(0, 100)}`);
    if (t.url().includes(EXT_ID) && t.type() === 'service_worker') {
      await sleep(500);
      await attachSW();
    }
  });
  browser.on('targetdestroyed', (t) => {
    if (t.type() === 'page' || (t.type() === 'service_worker' && t.url().includes(EXT_ID))) {
      console.log(`[-] ${t.type()} ${t.url()?.substring(0, 100)}`);
      if (t.type() === 'service_worker') swAttached = false;
    }
  });
  
  await attachSW();
  
  const startTime = Date.now();
  while (Date.now() - startTime < 300000) {
    await sleep(15000);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    
    // Poll pages
    try {
      const pages = await browser.pages();
      const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng') || p.url().includes('ebay.com.au/sl/'));
      if (ebay) {
        try {
          const state = await ebay.evaluate(() => ({
            ff: window.__dropflow_form_filler_loaded,
            url: location.href.substring(0, 100)
          }));
          console.log(`[${elapsed}s EBAY]`, JSON.stringify(state));
        } catch(e) {}
      }
      const ali = pages.find(p => p.url().includes('aliexpress.com/item'));
      if (ali) console.log(`[${elapsed}s] Ali tab open`);
    } catch(e) {}
    
    // Poll storage
    try {
      const ext = await getExtPage(browser);
      if (ext) {
        const s = await ext.evaluate(() => new Promise(r => chrome.storage.local.get(null, items => {
          const relevant = {};
          for (const [k,v] of Object.entries(items)) {
            if (k.startsWith('dropflow_') || k.startsWith('pending') || k.startsWith('aliBulk')) {
              relevant[k] = JSON.stringify(v).substring(0, 100);
            }
          }
          r(relevant);
        })));
        const keys = Object.keys(s).filter(k => !k.includes('scripttag') && !k.includes('mainworld') && !k.includes('iframe_test') && !k.includes('price_markup'));
        if (keys.length) console.log(`[${elapsed}s STORE]`, JSON.stringify(Object.fromEntries(keys.map(k => [k, s[k]]))));
      }
    } catch(e) {}
  }
  
  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
