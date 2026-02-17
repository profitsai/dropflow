const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';
const ALI_URL = 'https://www.aliexpress.com/item/1005009953521226.html';
const EBAY_MARKET = 'ebay.com.au';

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
  fs.appendFileSync('PROGRESS.md', `- ${ts}: ${msg}\n`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function shot(page, name) {
  await page.screenshot({ path: `real-test-${name}.png`, fullPage: false });
  log(`Screenshot: real-test-${name}.png`);
}

async function findPage(browser, match) {
  const pages = await browser.pages();
  return pages.find(p => p.url().includes(match));
}

async function getSwTarget(browser) {
  const targets = await browser.targets();
  return targets.find(t => t.type() === 'service_worker' && t.url().includes(EXT_ID));
}

async function evalInSw(browser, code) {
  const swTarget = await getSwTarget(browser);
  if (!swTarget) throw new Error('Service worker not found');
  const sw = await swTarget.worker();
  return sw.evaluate(new Function('return ' + code));
}

(async () => {
  fs.writeFileSync('PROGRESS.md', '# Real E2E Test Progress\n\n');
  log('Starting real E2E test');
  
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  log('Connected to browser');
  
  // List tabs
  const pages = await browser.pages();
  log(`${pages.length} tabs open`);

  // Step 1: Close existing eBay/AliExpress tabs
  for (const p of pages) {
    const url = p.url();
    if (url.includes('ebay.com') || url.includes('aliexpress.com')) {
      log(`Closing: ${url.substring(0, 60)}`);
      await p.close().catch(() => {});
    }
  }
  await sleep(1000);

  // Step 2: Reload extension
  log('Reloading extension...');
  const extPage = await browser.newPage();
  await extPage.goto('chrome://extensions', { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);
  
  const reloaded = await extPage.evaluate((extId) => {
    const mgr = document.querySelector('extensions-manager');
    if (!mgr || !mgr.shadowRoot) return 'no-mgr';
    const items = mgr.shadowRoot.querySelector('extensions-item-list');
    if (!items || !items.shadowRoot) return 'no-items';
    const allItems = items.shadowRoot.querySelectorAll('extensions-item');
    for (const item of allItems) {
      if (item.id === extId) {
        const devReload = item.shadowRoot?.querySelector('#dev-reload-button');
        if (devReload) { devReload.click(); return 'reloaded-dev'; }
        // Try the 3-dot menu approach
        const detailBtn = item.shadowRoot?.querySelector('[id="detailsButton"]');
        return 'found-no-reload';
      }
    }
    return 'not-found';
  }, EXT_ID);
  log('Extension reload: ' + reloaded);
  await sleep(3000);
  await extPage.close();

  // Step 3: Set markup to 30%
  log('Setting markup to 30%...');
  const settingsPage = await browser.newPage();
  await settingsPage.goto(`chrome-extension://${EXT_ID}/pages/settings/settings.html`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
  await sleep(1000);
  await settingsPage.evaluate(() => {
    chrome.storage.local.set({
      'dropflow_price_markup': 30,
      'dropflow_markup_type': 'percentage'
    });
  });
  log('Markup set to 30%');
  
  // Verify SW is alive
  const swTarget = await getSwTarget(browser);
  if (!swTarget) {
    log('ERROR: Service worker not found!');
    await settingsPage.close();
    return;
  }
  log('Service worker is alive');
  await settingsPage.close();

  // Step 4: Navigate to AliExpress product
  log('Opening AliExpress product page...');
  const aliPage = await browser.newPage();
  await aliPage.goto(ALI_URL, { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => log('Ali nav: ' + e.message));
  await sleep(5000);
  await shot(aliPage, 'ali-loaded');
  
  // Step 5: Trigger bulk listing via service worker
  log('Triggering START_ALI_BULK_LISTING...');
  const sw = await swTarget.worker();
  const triggerResult = await sw.evaluate((url, market) => {
    return new Promise((resolve) => {
      // The service worker listens for messages
      const handler = (msg) => {
        if (msg.type === 'START_ALI_BULK_LISTING') return; // ignore echo
        resolve(JSON.stringify(msg));
      };
      
      // Directly call the handler
      try {
        // Access the bulk listing function directly
        if (typeof handleAliBulkListing === 'function') {
          handleAliBulkListing({ links: [url], marketplace: market, listingType: 'standard' });
          resolve('called-direct');
        } else {
          // Dispatch via chrome.runtime
          chrome.runtime.sendMessage({
            type: 'START_ALI_BULK_LISTING',
            data: { links: [url], marketplace: market, listingType: 'standard' }
          }, (response) => {
            resolve(JSON.stringify(response || 'no-response'));
          });
        }
      } catch (e) {
        resolve('error: ' + e.message);
      }
    });
  }, ALI_URL, EBAY_MARKET);
  log('Trigger result: ' + triggerResult);

  // Step 6: Monitor progress
  log('Monitoring flow...');
  let phase = 'waiting';
  let ebayPage = null;
  
  for (let i = 0; i < 120; i++) { // up to 10 minutes
    await sleep(5000);
    
    const allPages = await browser.pages();
    const urls = allPages.map(p => p.url());
    
    // Check for eBay tab
    const ebayTab = allPages.find(p => p.url().includes('ebay.com.au'));
    const aliTab = allPages.find(p => p.url().includes('aliexpress.com'));
    
    // Check SW state
    let swState = '';
    try {
      swState = await sw.evaluate(() => {
        // Check bulk listing state
        const keys = Object.keys(self).filter(k => k.toLowerCase().includes('bulk') || k.toLowerCase().includes('queue'));
        return JSON.stringify({ keys, tabCount: 0 });
      }).catch(() => 'sw-eval-failed');
    } catch(e) {
      swState = 'sw-dead';
    }
    
    if (i % 6 === 0) { // every 30s
      log(`[${i*5}s] tabs=${allPages.length}, hasEbay=${!!ebayTab}, hasAli=${!!aliTab}, sw=${swState}`);
      if (aliTab) await shot(aliTab, `monitor-ali-${i}`);
      if (ebayTab) await shot(ebayTab, `monitor-ebay-${i}`);
    }

    // If AliExpress scrape seems stuck (>60s with no eBay tab)
    if (i === 12 && !ebayTab && aliTab) {
      log('Scrape seems stuck after 60s. Trying manual content script injection...');
      try {
        // Try injecting the content script manually
        const injected = await sw.evaluate((url) => {
          return new Promise(async (resolve) => {
            try {
              const [tab] = await chrome.tabs.query({ url: '*://*.aliexpress.com/*' });
              if (!tab) { resolve('no-ali-tab'); return; }
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content-scripts/aliexpress/product-scraper.js']
              });
              resolve('injected-ok');
            } catch(e) {
              resolve('inject-err: ' + e.message);
            }
          });
        }, ALI_URL);
        log('Manual injection: ' + injected);
      } catch(e) {
        log('Injection error: ' + e.message);
      }
    }
    
    // If still stuck at 90s, try MAIN world injection
    if (i === 18 && !ebayTab && aliTab) {
      log('Still stuck at 90s. Trying MAIN world injection...');
      try {
        const injected2 = await sw.evaluate(() => {
          return new Promise(async (resolve) => {
            try {
              const [tab] = await chrome.tabs.query({ url: '*://*.aliexpress.com/*' });
              if (!tab) { resolve('no-ali-tab'); return; }
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: 'MAIN',
                files: ['content-scripts/aliexpress/product-scraper.js']
              });
              resolve('main-world-injected');
            } catch(e) {
              resolve('main-inject-err: ' + e.message);
            }
          });
        });
        log('MAIN world injection: ' + injected2);
      } catch(e) {
        log('MAIN injection error: ' + e.message);
      }
    }

    // If still no eBay tab after 2 min, try scraping manually and storing data
    if (i === 24 && !ebayTab) {
      log('2 min with no eBay tab. Attempting manual scrape via page evaluate...');
      if (aliTab) {
        try {
          const productData = await aliTab.evaluate(() => {
            // Try to extract product data from the page
            const data = {};
            
            // Try __INIT_STORE_DATA__
            try {
              if (window.__INIT_STORE_DATA__) {
                const store = window.__INIT_STORE_DATA__;
                data.source = 'INIT_STORE_DATA';
                data.raw = JSON.stringify(store).substring(0, 500);
              }
            } catch(e) {}
            
            // Try runParams
            try {
              if (window.runParams) {
                data.source = 'runParams';
                data.raw = JSON.stringify(window.runParams).substring(0, 500);
              }
            } catch(e) {}
            
            // DOM fallback
            data.title = document.querySelector('h1')?.textContent?.trim() || '';
            data.price = document.querySelector('[class*="price"]')?.textContent?.trim() || '';
            data.images = [...document.querySelectorAll('img[src*="alicdn"]')].map(i => i.src).slice(0, 5);
            
            return data;
          });
          log('Manual scrape data: ' + JSON.stringify(productData).substring(0, 200));
        } catch(e) {
          log('Manual scrape error: ' + e.message);
        }
      }
    }
    
    // eBay form detected - monitor it
    if (ebayTab && !ebayPage) {
      ebayPage = ebayTab;
      phase = 'ebay-form';
      log('eBay tab detected! URL: ' + ebayTab.url().substring(0, 100));
    }
    
    if (ebayPage) {
      const ebayUrl = ebayPage.url();
      
      // Check if we're on the listing form (not prelist)
      if (ebayUrl.includes('/sl/sell') || ebayUrl.includes('/sl/list')) {
        phase = 'listing-form';
      }
      
      // Check for variations table
      if (phase === 'listing-form') {
        const formState = await ebayPage.evaluate(() => {
          const variationsSection = document.querySelector('[data-testid="variations"], [class*="variation"], #variations');
          const hasVariations = !!variationsSection;
          const listButton = document.querySelector('button[data-testid*="list"], button[class*="list-button"]');
          const title = document.querySelector('input[name="title"], [data-testid="title-input"]')?.value || '';
          
          // Check for iframe (variation builder)
          const iframes = [...document.querySelectorAll('iframe')].map(f => f.src).filter(s => s.includes('bulkedit'));
          
          return { hasVariations, hasListButton: !!listButton, title: title.substring(0, 50), iframes };
        }).catch(() => ({}));
        
        if (i % 6 === 0) log('Form state: ' + JSON.stringify(formState));
        
        // If we see variations or the form seems complete, take detailed screenshots
        if (formState.hasVariations || formState.iframes?.length > 0) {
          log('Variations detected! Taking detailed screenshots...');
          await shot(ebayPage, 'variations-found');
          
          // Scroll to variations
          await ebayPage.evaluate(() => {
            const varSection = document.querySelector('[data-testid="variations"], [class*="variation"], #variations');
            if (varSection) varSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
          await sleep(1000);
          await shot(ebayPage, 'variations-scrolled');
          
          // Try to read variation table data
          const varData = await ebayPage.evaluate(() => {
            const rows = document.querySelectorAll('table tr, [role="row"]');
            return [...rows].slice(0, 20).map(r => r.textContent?.trim().substring(0, 100));
          }).catch(() => []);
          log('Variation rows: ' + JSON.stringify(varData).substring(0, 500));
          
          // Check prices and quantities
          const priceQtyData = await ebayPage.evaluate(() => {
            const inputs = [...document.querySelectorAll('input')];
            const priceInputs = inputs.filter(i => i.name?.includes('price') || i.getAttribute('aria-label')?.includes('rice'));
            const qtyInputs = inputs.filter(i => i.name?.includes('qty') || i.name?.includes('quantity') || i.getAttribute('aria-label')?.includes('uantity'));
            return {
              prices: priceInputs.map(i => ({ name: i.name, value: i.value })),
              quantities: qtyInputs.map(i => ({ name: i.name, value: i.value }))
            };
          }).catch(() => ({}));
          log('Price/Qty data: ' + JSON.stringify(priceQtyData).substring(0, 500));
          
          phase = 'variations-visible';
        }
      }
      
      // Check if listing was submitted
      if (ebayUrl.includes('listed') || ebayUrl.includes('success') || ebayUrl.includes('congrat')) {
        log('LISTING SUBMITTED SUCCESSFULLY!');
        await shot(ebayPage, 'success');
        phase = 'done';
        break;
      }
    }
    
    if (phase === 'done') break;
  }
  
  // Final state
  log('Test complete. Final phase: ' + phase);
  const finalPages = await browser.pages();
  for (const p of finalPages) {
    const url = p.url();
    if (url.includes('ebay.com.au')) {
      await shot(p, 'final-ebay');
    }
  }
  
  // Write report
  const report = `# Real E2E Test Report
  
**Date**: ${new Date().toISOString()}
**Product**: Warm Fleece Dog Coat (${ALI_URL})
**Marketplace**: ${EBAY_MARKET}
**Markup**: 30%
**Final Phase**: ${phase}

## Results
- See PROGRESS.md for detailed timeline
- Screenshots: real-test-*.png
`;
  fs.writeFileSync('REAL-TEST-REPORT.md', report);
  
  log('Report written to REAL-TEST-REPORT.md');
  browser.disconnect();
})().catch(e => {
  log('FATAL: ' + e.message);
  console.error(e);
});
