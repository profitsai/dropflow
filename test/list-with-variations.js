const puppeteer = require('puppeteer-core');
const fs = require('fs');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const extPage = pages.find(p => p.url().includes('chrome-extension://'));
  if (!extPage) { console.error('No extension page'); process.exit(1); }
  
  // Build proper product data with SKUs
  const colors = ['Red', 'Black', 'Coffee'];
  const sizes = ['XS', 'S', 'M', 'L', 'XL'];
  const basePrice = 8.12;
  
  const skus = [];
  for (const color of colors) {
    for (const size of sizes) {
      skus.push({
        specifics: { Color: color, Size: size },
        price: basePrice,
        ebayPrice: 24.99,
        stock: (color === 'Red' && ['XS','S','M'].includes(size)) ? 5 : 0,
        image: color === 'Red' ? 'https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg' :
               color === 'Black' ? 'https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg' :
               'https://ae-pic-a1.aliexpress-media.com/kf/Sb89fb2276757499bb4efd5f33b297367c.jpg'
      });
    }
  }
  
  const productData = {
    title: "Warm Fleece Dog Coat With Hooded Waterproof Winter Pet Puppy Clothes For Small Medium Dogs Cats French Bulldog Hoodie Costume",
    ebayTitle: "Warm Fleece Dog Coat Hooded Waterproof Winter Pet Puppy Clothes Small Medium Dog",
    price: basePrice,
    currency: 'AUD',
    ebayPrice: 24.99,
    images: [
      "https://ae-pic-a1.aliexpress-media.com/kf/S1cf750c0a3554bbdae157dd2c4d92e26C.jpg",
      "https://ae-pic-a1.aliexpress-media.com/kf/Sc5bfa0e7793d4562a3ffe0bbe3a661166.jpg",
      "https://ae-pic-a1.aliexpress-media.com/kf/Sf7831f8ffa854eccbd953391af468128t.jpg",
      "https://ae-pic-a1.aliexpress-media.com/kf/Sfcb676f3b6ab4f6baf6d5e5e013627ddz.jpg",
      "https://ae-pic-a1.aliexpress-media.com/kf/S84f2d74dd2a742f4904f212aa53aad77H.jpg",
      "https://ae-pic-a1.aliexpress-media.com/kf/Se33197e157b04d5485f24224fa4601e8H.jpg"
    ],
    variations: {
      hasVariations: true,
      axes: [
        {
          name: "Color",
          values: [
            { name: "Red", image: "https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg" },
            { name: "Black", image: "https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg" },
            { name: "Coffee", image: "https://ae-pic-a1.aliexpress-media.com/kf/Sb89fb2276757499bb4efd5f33b297367c.jpg" }
          ]
        },
        {
          name: "Size",
          values: [
            { name: "XS" }, { name: "S" }, { name: "M" }, { name: "L" }, { name: "XL" }
          ]
        }
      ],
      skus: skus,
      imagesByValue: {
        "Red": "https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg",
        "Black": "https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg",
        "Coffee": "https://ae-pic-a1.aliexpress-media.com/kf/Sb89fb2276757499bb4efd5f33b297367c.jpg"
      }
    },
    source: 'aliexpress',
    sourceUrl: 'https://www.aliexpress.com/item/1005009953521226.html',
    aliexpressUrl: 'https://www.aliexpress.com/item/1005009953521226.html',
    listingType: 'standard',
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
    itemSpecifics: {
      Type: 'Coat/Jacket',
      Material: 'Fleece',
      Brand: 'Unbranded',
    }
  };
  
  // Store with the correct key
  console.log('Storing product data with variations...');
  console.log('SKUs:', skus.length, 'In-stock:', skus.filter(s => s.stock > 0).length);
  
  const stored = await extPage.evaluate(async (data) => {
    await chrome.storage.local.remove(['pendingListingData']);
    await chrome.storage.local.set({ pendingListingData: data });
    const check = await chrome.storage.local.get('pendingListingData');
    const d = check.pendingListingData;
    return `stored: hasVariations=${d.variations?.hasVariations}, skus=${d.variations?.skus?.length}, axes=${d.variations?.axes?.length}`;
  }, productData);
  console.log(stored);
  
  // Close any existing eBay tabs
  for (const p of pages) {
    if (p.url().includes('ebay.com.au') && !p.url().includes('chrome-extension')) {
      try { await p.close(); } catch(e) {}
    }
  }
  
  // Open eBay prelist 
  console.log('\nOpening eBay prelist...');
  const newTabId = await extPage.evaluate(async () => {
    const tab = await chrome.tabs.create({ url: 'https://www.ebay.com.au/sl/prelist/suggest', active: true });
    return tab.id;
  });
  console.log('Tab created:', newTabId);
  
  // Set up form filler injection 
  await extPage.evaluate(async (tabId) => {
    const listener = async (changeTabId, changeInfo, tab) => {
      if (changeTabId !== tabId) return;
      if (changeInfo.status === 'complete' && tab.url) {
        const u = tab.url;
        if (u.includes('/lstng') || u.includes('/sl/prelist') || u.includes('/sl/list') || u.includes('bulkedit')) {
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
  
  // Monitor
  console.log('\nMonitoring...');
  let lastUrl = '';
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const currentPages = await browser.pages();
    const ebay = currentPages.find(p => p.url().includes('ebay.com.au'));
    if (ebay) {
      const url = ebay.url();
      if (url !== lastUrl) {
        console.log(`[${(i+1)*5}s] ${url.substring(0, 120)}`);
        lastUrl = url;
      }
      
      if (url.includes('/lstng') && i % 4 === 0) {
        await ebay.screenshot({ path: `var-progress-${i}.png` });
        console.log(`  Screenshot: var-progress-${i}.png`);
      }
      
      // Check if listing was submitted
      const title = await ebay.title().catch(() => '');
      if (title.includes('listing is now live') || title.includes('Congratulations')) {
        console.log('\n=== LISTING IS LIVE! ===');
        await ebay.screenshot({ path: 'listing-live-final.png' });
        break;
      }
    } else {
      if (i % 6 === 0) console.log(`[${(i+1)*5}s] No eBay page`);
    }
  }
  
  browser.disconnect();
  console.log('\nDone');
})().catch(e => { console.error(e.message); process.exit(1); });
