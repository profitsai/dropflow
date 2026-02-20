const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { discoverBrowserWSEndpoint, getCdpTargetFromEnv, cdpEnvHelpText } = require('../lib/cdp');

async function connectBrowser() {
  let CDP;
  try {
    CDP = getCdpTargetFromEnv();
  } catch (e) {
    console.error(`[store-and-go] ${e.message}`);
    if (e.help) console.error(e.help);
    else console.error(cdpEnvHelpText());
    process.exit(2);
  }
  const ws = await discoverBrowserWSEndpoint({ host: CDP.host, port: CDP.port, timeoutMs: 30_000, pollMs: 250 });
  return puppeteer.connect({ browserWSEndpoint: ws });
}

(async () => {
  const browser = await connectBrowser();
  const pages = await browser.pages();
  const extPage = pages.find(p => p.url().includes('ali-bulk-lister') || p.url().includes('chrome-extension://'));

  if (!extPage) { console.error('No extension page'); process.exit(1); }

  // Load the good product data we already have
  const rawData = JSON.parse(fs.readFileSync('/Users/pyrite/Projects/dropflow-extension/test/product-data.json', 'utf8'));

  // Enhance with required fields for the form filler
  const productData = {
    ...rawData,
    ebayPrice: 24.99,
    source: 'aliexpress',
    sourceUrl: rawData.aliexpressUrl,
    listingType: 'standard',
    ebayTitle: rawData.ebayTitle || rawData.title.substring(0, 80),
    // Generate a simple description
    description: `<div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">
<h2>Warm Fleece Dog Coat with Hood - Waterproof Winter Pet Jacket</h2>
<p>Keep your furry friend warm and dry this winter with our premium fleece-lined dog coat. Features a cosy hood and waterproof outer shell, perfect for cold weather walks.</p>
<h3>Key Features:</h3>
<ul>
<li><strong>Waterproof Exterior</strong> - Protects against rain and wind</li>
<li><strong>Soft Fleece Lining</strong> - Warm and comfortable</li>
<li><strong>Hooded Design</strong> - Extra protection for head and ears</li>
<li><strong>Easy On/Off</strong> - Velcro closure for quick dressing</li>
<li><strong>Leash Hole</strong> - Back opening for lead attachment</li>
</ul>
<h3>Suitable For:</h3>
<p>Small to medium dogs including French Bulldogs, Pugs, Chihuahuas, and similar breeds. Please check size chart for the perfect fit.</p>
<h3>Size Guide:</h3>
<table border="1" cellpadding="5" cellspacing="0" style="border-collapse:collapse;">
<tr><th>Size</th><th>Back Length</th><th>Chest</th><th>Weight</th></tr>
<tr><td>XS</td><td>20cm</td><td>30cm</td><td>1-2kg</td></tr>
<tr><td>S</td><td>25cm</td><td>36cm</td><td>2-4kg</td></tr>
<tr><td>M</td><td>30cm</td><td>42cm</td><td>4-6kg</td></tr>
<tr><td>L</td><td>35cm</td><td>48cm</td><td>6-9kg</td></tr>
<tr><td>XL</td><td>40cm</td><td>54cm</td><td>9-13kg</td></tr>
</table>
<p><em>Please measure your dog before ordering. Allow 1-2cm for comfort.</em></p>
</div>`,
    // Item specifics for the form filler
    itemSpecifics: {
      Type: 'Coat/Jacket',
      Material: 'Fleece',
      Brand: 'Unbranded',
      Colour: 'Red',
      'Dog Size': 'S',
    }
  };

  // Close any existing eBay tabs first
  const ebayPages = pages.filter(p => p.url().includes('ebay.com.au'));
  for (const p of ebayPages) {
    try { await p.close(); } catch(e) {}
  }

  // Store in the correct key
  console.log('Storing product data...');
  const stored = await extPage.evaluate(async (data) => {
    // Clear old data
    await chrome.storage.local.remove(['pendingListingData', 'pendingProductData']);
    // Store with the correct key
    await chrome.storage.local.set({ pendingListingData: data });
    // Verify
    const check = await chrome.storage.local.get('pendingListingData');
    return check.pendingListingData ? 'stored OK - ' + check.pendingListingData.title?.substring(0,40) : 'FAILED';
  }, productData);
  console.log('Storage:', stored);

  // Open eBay prelist page
  console.log('Opening eBay prelist...');
  const newTabId = await extPage.evaluate(async () => {
    const tab = await chrome.tabs.create({ url: 'https://www.ebay.com.au/sl/prelist/suggest', active: true });
    return tab.id;
  });
  console.log('Tab created:', newTabId);

  // Set up form filler injection listener
  await extPage.evaluate(async (tabId) => {
    const listener = async (changeTabId, changeInfo, tab) => {
      if (changeTabId !== tabId) return;
      if (changeInfo.status === 'complete' && tab.url) {
        const u = tab.url;
        if (u.includes('/lstng') || u.includes('/sl/prelist') || u.includes('/sl/list')) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId, allFrames: true },
              files: ['content-scripts/ebay/form-filler.js']
            });
            console.log('Injected form-filler on:', u.substring(0, 80));
          } catch (e) {
            console.log('Inject err:', e.message);
          }
        }
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => chrome.tabs.onUpdated.removeListener(listener), 300000);
  }, newTabId);

  // Monitor progress
  console.log('\nMonitoring...');
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const currentPages = await browser.pages();
    const ebay = currentPages.find(p => p.url().includes('ebay.com.au'));
    if (ebay) {
      const url = ebay.url();
      console.log(`[${(i+1)*5}s] ${url.substring(0, 100)}`);

      // Check form filler status
      const status = await ebay.evaluate(() => {
        return {
          loaded: !!window.__dropflow_form_filler_loaded,
          title: document.title?.substring(0, 60),
          url: location.pathname
        };
      }).catch(() => ({ error: 'eval failed' }));

      if (status.loaded) console.log('  Form filler is loaded');

      if (url.includes('/lstng') && i % 3 === 0) {
        await ebay.screenshot({ path: `progress-${i}.png` });
        console.log('  Screenshot saved');
      }
    } else {
      console.log(`[${(i+1)*5}s] No eBay page`);
    }
  }

  browser.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
