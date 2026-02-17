const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const productData = {
  title: "Warm Fleece Dog Coat Hooded Waterproof Winter Pet Puppy Clothes Small Medium Dog",
  price: 8.12,
  currency: "AUD",
  ebayPrice: 10.56,
  ebayTitle: "Warm Fleece Dog Coat Hooded Waterproof Winter Pet Puppy Clothes Small Medium Dog",
  aiDescription: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.6">
<h2 style="color:#333">Warm Fleece Dog Coat - Waterproof Winter Pet Clothing</h2>
<p>Keep your furry friend warm and dry this winter with this premium fleece-lined dog coat. Features a waterproof exterior shell and cosy hooded design perfect for small to medium-sized dogs.</p>
<h3>Key Features:</h3>
<ul>
<li>Waterproof outer layer protects against rain and wind</li>
<li>Soft fleece lining for maximum warmth and comfort</li>
<li>Hood design provides extra head protection</li>
<li>Easy to put on and take off with secure closures</li>
<li>Available in multiple sizes and colours</li>
<li>Suitable for small to medium dogs including French Bulldogs, Pugs, and more</li>
</ul>
<h3>Perfect For:</h3>
<p>Daily walks, outdoor adventures, and keeping your pet comfortable during cold weather. The lightweight design ensures freedom of movement while providing essential warmth.</p>
<p><strong>Size Guide:</strong> Please measure your dog before ordering. Refer to our size chart for the best fit.</p>
</div>`,
  images: [
    "https://ae-pic-a1.aliexpress-media.com/kf/S1cf750c0a3554bbdae157dd2c4d92e26C.jpg",
    "https://ae-pic-a1.aliexpress-media.com/kf/Sc5bfa0e7793d4562a3ffe0bbe3a661166.jpg",
    "https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg",
    "https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg",
    "https://ae-pic-a1.aliexpress-media.com/kf/S2f0c15bcf20749d5bfe54e3e6e3e4b6eR.jpg"
  ],
  aliexpressUrl: "https://www.aliexpress.com/item/1005009953521226.html",
  sourceType: "aliexpress",
  variations: {
    hasVariations: true,
    axes: [
      {
        name: "Color",
        values: [
          {name: "Red", image: "https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg"},
          {name: "Black", image: "https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg"},
          {name: "Blue", image: "https://ae-pic-a1.aliexpress-media.com/kf/S2f0c15bcf20749d5bfe54e3e6e3e4b6eR.jpg"}
        ]
      },
      {
        name: "Size",
        values: [
          {name: "XS"}, {name: "S"}, {name: "M"}, {name: "L"}, {name: "XL"}
        ]
      }
    ],
    skus: [
      {color: "Red", size: "XS", price: 6.50,  ebayPrice: 8.45,  stock: 5},
      {color: "Red", size: "S",  price: 7.20,  ebayPrice: 9.36,  stock: 3},
      {color: "Red", size: "M",  price: 8.50,  ebayPrice: 11.05, stock: 10},
      {color: "Red", size: "L",  price: 10.00, ebayPrice: 13.00, stock: 0},
      {color: "Red", size: "XL", price: 12.50, ebayPrice: 16.25, stock: 0},
      {color: "Black", size: "XS", price: 7.00,  ebayPrice: 9.10,  stock: 2},
      {color: "Black", size: "S",  price: 7.80,  ebayPrice: 10.14, stock: 0},
      {color: "Black", size: "M",  price: 9.00,  ebayPrice: 11.70, stock: 8},
      {color: "Black", size: "L",  price: 11.00, ebayPrice: 14.30, stock: 4},
      {color: "Black", size: "XL", price: 13.50, ebayPrice: 17.55, stock: 1},
      {color: "Blue", size: "XS", price: 6.80,  ebayPrice: 8.84,  stock: 0},
      {color: "Blue", size: "S",  price: 7.50,  ebayPrice: 9.75,  stock: 6},
      {color: "Blue", size: "M",  price: 8.80,  ebayPrice: 11.44, stock: 4},
      {color: "Blue", size: "L",  price: 10.50, ebayPrice: 13.65, stock: 0},
      {color: "Blue", size: "XL", price: 13.00, ebayPrice: 16.90, stock: 3}
    ],
    imagesByValue: {
      "Red": "https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg",
      "Black": "https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg",
      "Blue": "https://ae-pic-a1.aliexpress-media.com/kf/S2f0c15bcf20749d5bfe54e3e6e3e4b6eR.jpg"
    }
  }
};

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au'));
  const ext = pages.find(p => p.url().includes(EXT_ID));
  
  if (!ebay) { log('No eBay page!'); browser.disconnect(); return; }
  
  // Get the eBay tab's ID from CDP
  const target = ebay.target();
  log('eBay target ID: ' + target._targetId);
  
  // Store the product data using the legacy key so the content script picks it up
  if (ext) {
    await ext.evaluate(async (data) => {
      await new Promise(r => chrome.storage.local.set({ 'pendingListingData': data }, r));
    }, productData);
    log('Product data stored in pendingListingData');
  }
  
  // Now re-inject the content script to trigger checkPendingData
  log('Re-injecting content script...');
  
  // Use extension page to inject via chrome.scripting
  if (ext) {
    const tabId = await ext.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url: '*://*.ebay.com.au/*' });
      return tabs[0]?.id;
    });
    log('eBay tab ID: ' + tabId);
    
    if (tabId) {
      // Store with per-tab key too
      await ext.evaluate(async (data, tid) => {
        await new Promise(r => chrome.storage.local.set({ [`pendingListing_${tid}`]: data }, r));
      }, productData, tabId);
      log('Product data stored with per-tab key too');
      
      // Inject the content script
      const result = await ext.evaluate(async (tid) => {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tid },
            files: ['content-scripts/ebay/form-filler.js']
          });
          return { success: true };
        } catch(e) {
          return { error: e.message };
        }
      }, tabId);
      log('Injection result: ' + JSON.stringify(result));
    }
  }
  
  // Now wait and monitor
  log('Waiting for content script to fill form...');
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    
    const state = await ebay.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="ebayimg"], [class*="uploaded"] img, [class*="photo"] img[src*="http"]');
      const priceInputs = Array.from(document.querySelectorAll('input')).filter(i => {
        const l = (i.getAttribute('aria-label') || i.name || '').toLowerCase();
        return l.includes('price') && i.value && parseFloat(i.value) > 1;
      });
      return {
        url: window.location.href.substring(0, 80),
        photoCount: imgs.length,
        priceCount: priceInputs.length,
      };
    }).catch(() => ({}));
    
    log(`[${i*5}s] photos=${state.photoCount}, prices=${state.priceCount}, url=${state.url}`);
    
    if (i % 6 === 0) {
      await ebay.screenshot({ path: `/Users/pyrite/Projects/dropflow-extension/test/screenshots/fill-${i}.png` });
    }
    
    // Check for bulkedit page (variation builder)
    const allPages = await browser.pages();
    const bulkEdit = allPages.find(p => p.url().includes('bulkedit'));
    if (bulkEdit) {
      log('Variation builder page detected: ' + bulkEdit.url());
      await bulkEdit.screenshot({ path: `/Users/pyrite/Projects/dropflow-extension/test/screenshots/bulkedit-${i}.png` });
    }
    
    if (state.priceCount > 2) {
      log('SUCCESS: Multiple prices found! Variations are filled.');
      await ebay.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/screenshots/variations-done.png', fullPage: true });
      break;
    }
  }
  
  browser.disconnect();
  log('Done');
})().catch(e => console.error('FATAL:', e.message));
