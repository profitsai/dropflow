const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';

const DESCRIPTION = `<div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">
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
</div>`;

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  const extPage = pages.find(p => p.url().includes('chrome-extension://'));
  
  if (!ebay) { console.error('No eBay page'); process.exit(1); }
  
  // Build full product data with SKUs
  const colors = ['Red', 'Black', 'Coffee'];
  const sizes = ['XS', 'S', 'M', 'L', 'XL'];
  const skus = [];
  for (const color of colors) {
    for (const size of sizes) {
      skus.push({
        specifics: { Color: color, Size: size },
        price: 8.12,
        ebayPrice: 24.99,
        stock: 5,
      });
    }
  }
  
  const productData = {
    title: "Warm Fleece Dog Coat With Hooded Waterproof Winter Pet Puppy Clothes For Small Medium Dogs",
    ebayTitle: "Warm Fleece Dog Coat Hooded Waterproof Winter Pet Puppy Clothes Small Medium Dog",
    price: 8.12,
    currency: 'AUD',
    ebayPrice: 24.99,
    images: [
      "https://ae-pic-a1.aliexpress-media.com/kf/S1cf750c0a3554bbdae157dd2c4d92e26C.jpg",
      "https://ae-pic-a1.aliexpress-media.com/kf/Sc5bfa0e7793d4562a3ffe0bbe3a661166.jpg",
    ],
    variations: {
      hasVariations: true,
      axes: [
        { name: "Color", values: [{ name: "Red" }, { name: "Black" }, { name: "Coffee" }] },
        { name: "Size", values: [{ name: "XS" }, { name: "S" }, { name: "M" }, { name: "L" }, { name: "XL" }] }
      ],
      skus: skus,
    },
    source: 'aliexpress',
    sourceUrl: 'https://www.aliexpress.com/item/1005009953521226.html',
    listingType: 'standard',
    description: DESCRIPTION,
    itemSpecifics: { Type: 'Coat/Jacket', Material: 'Fleece', Brand: 'Unbranded' }
  };
  
  // Re-store pending data
  console.log('Re-storing pending data...');
  await extPage.evaluate(async (data) => {
    await chrome.storage.local.set({ pendingListingData: data });
  }, productData);
  
  // Clear the form-filler loaded flag
  await ebay.evaluate(() => { window.__dropflow_form_filler_loaded = false; });
  
  // Re-inject form filler
  const tabId = await extPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: '*://*.ebay.com.au/*' });
    return tabs[0]?.id;
  });
  
  console.log('Re-injecting form filler on tab', tabId);
  await extPage.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content-scripts/ebay/form-filler.js']
    });
  }, tabId);
  
  console.log('Injected. Monitoring...');
  
  // Listen for page console logs
  ebay.on('console', msg => {
    const text = msg.text();
    if (text.includes('DropFlow')) {
      console.log('  [FF]', text.substring(0, 150));
    }
  });
  
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const url = ebay.url();
    const title = await ebay.title().catch(() => '');
    
    if (i % 3 === 0) {
      console.log(`[${(i+1)*5}s] ${url.substring(0, 80)} | ${title.substring(0, 40)}`);
      await ebay.screenshot({ path: `refill-${i}.png` });
    }
    
    if (title.includes('listing is now live')) {
      console.log('\n=== LISTING IS LIVE! ===');
      await ebay.screenshot({ path: 'var-listing-live.png' });
      break;
    }
    
    // Check if we navigated to bulkedit (variation builder)
    if (url.includes('bulkedit')) {
      console.log('In variation builder!');
    }
  }
  
  browser.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
