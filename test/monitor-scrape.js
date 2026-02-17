const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  log('Monitoring scrape...');
  
  let capturedData = null;
  let onFormPage = false;
  
  for (let i = 0; i < 90; i++) { // 7.5 min max
    await sleep(5000);
    
    const pages = await browser.pages();
    const urls = pages.map(p => p.url().substring(0, 100));
    
    // Check storage for pending listing data
    const extPage = pages.find(p => p.url().includes(EXT_ID));
    if (extPage && !capturedData) {
      const storage = await extPage.evaluate(async () => {
        const d = await new Promise(r => chrome.storage.local.get(null, r));
        const pending = {};
        for (const [k, v] of Object.entries(d)) {
          if (k.startsWith('pendingListing_')) {
            pending[k] = v;
          }
        }
        return pending;
      }).catch(() => null);
      
      if (storage) {
        const keys = Object.keys(storage);
        if (keys.length > 0) {
          capturedData = storage[keys[0]];
          log('CAPTURED pending listing data!');
          log('  Title: ' + capturedData.title?.substring(0, 80));
          log('  Price: $' + capturedData.price);
          log('  HasVariations: ' + capturedData.variations?.hasVariations);
          log('  Axes: ' + capturedData.variations?.axes?.map(a => a.name).join(', '));
          log('  SKUs: ' + capturedData.variations?.skus?.length);
          if (capturedData.variations?.skus?.length > 0) {
            log('  SKU samples:');
            for (const s of capturedData.variations.skus.slice(0, 5)) {
              log('    ' + JSON.stringify(s));
            }
          }
          log('  Images: ' + capturedData.images?.length);
          fs.writeFileSync('/Users/pyrite/Projects/dropflow-extension/test/real-scraped-data.json', JSON.stringify(capturedData, null, 2));
          log('  Saved to real-scraped-data.json');
        }
      }
    }
    
    // Check for eBay form page
    const ebayPage = pages.find(p => p.url().includes('ebay.com.au/lstng'));
    if (ebayPage && !onFormPage) {
      onFormPage = true;
      log('ON FORM PAGE: ' + ebayPage.url().substring(0, 100));
    }
    
    // Log tab state periodically
    if (i % 6 === 0) {
      log(`[${i*5}s] ${urls.length} tabs: ${urls.join(' | ')}`);
    }
    
    // Check for completion signal
    if (extPage) {
      const fillResult = await extPage.evaluate(async () => {
        const d = await new Promise(r => chrome.storage.local.get('dropflow_last_fill_results', r));
        return d.dropflow_last_fill_results;
      }).catch(() => null);
      
      if (fillResult) {
        log('FORM FILL COMPLETE!');
        log('  ' + JSON.stringify(fillResult).substring(0, 300));
        break;
      }
    }
    
    // If on form page for 30s+, take a screenshot
    if (onFormPage && ebayPage && i % 6 === 0) {
      await ebayPage.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/scrape-monitor-' + i + '.png' });
    }
  }
  
  log('Monitoring complete');
  browser.disconnect();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
