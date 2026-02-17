import puppeteer from 'puppeteer-core';

const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  
  // List all pages
  const pages = await browser.pages();
  console.log('=== PAGES ===');
  for (const p of pages) console.log(' ', p.url());
  
  // Find ext page
  let extPage = null;
  for (const p of pages) {
    if (p.url().includes('ali-bulk-lister')) { extPage = p; break; }
  }
  
  if (extPage) {
    // Check storage
    const storage = await extPage.evaluate(() => {
      return new Promise(resolve => {
        chrome.storage.local.get(null, items => {
          // Filter to relevant keys
          const relevant = {};
          for (const [k, v] of Object.entries(items)) {
            if (k.startsWith('dropflow_') || k.startsWith('aliBulk') || k.startsWith('ali_bulk') || k === 'lastScrapedProduct') {
              relevant[k] = typeof v === 'string' && v.length > 500 ? v.substring(0, 500) + '...' : 
                            typeof v === 'object' ? JSON.stringify(v).substring(0, 500) : v;
            }
          }
          return relevant;
        });
      });
    });
    console.log('\n=== STORAGE ===');
    console.log(JSON.stringify(storage, null, 2));
  }

  // Check for AliExpress tab
  const aliTab = pages.find(p => p.url().includes('aliexpress.com'));
  if (aliTab) console.log('\n=== ALI TAB FOUND:', aliTab.url());

  // Check for eBay listing tab
  const ebayTab = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  if (ebayTab) {
    console.log('\n=== EBAY TAB:', ebayTab.url());
    try {
      const formFiller = await ebayTab.evaluate(() => window.__dropflow_form_filler_loaded);
      console.log('Form filler loaded:', formFiller);
      const title = await ebayTab.evaluate(() => {
        const el = document.querySelector('[data-testid="title"] input, #title input, input[name="title"]');
        return el ? el.value : 'not found';
      });
      console.log('Title field:', title);
    } catch(e) { console.log('eBay tab eval error:', e.message); }
  }

  browser.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
