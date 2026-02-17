const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ext = pages.find(p => p.url().includes(EXT_ID));
  const ebay = pages.find(p => p.url().includes('ebay.com.au'));
  
  log('Tabs: ' + pages.map(p => p.url().substring(0, 60)).join(' | '));
  
  // === 1. Get SW console via CDP on service worker target ===
  log('=== Step 1: Service Worker Console ===');
  
  // Open the SW devtools page to capture console
  const swUrl = `chrome-extension://${EXT_ID}/background/service-worker.js`;
  const swPage = await browser.newPage();
  
  // Instead, use the extension page to call into SW
  if (ext) {
    // Check GET_EBAY_HEADERS
    log('\n=== Step 2: GET_EBAY_HEADERS ===');
    const headers = await ext.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_EBAY_HEADERS' }, (resp) => {
          resolve(resp);
        });
        setTimeout(() => resolve({ timeout: true }), 3000);
      });
    });
    log('Headers: ' + JSON.stringify(headers).substring(0, 1000));
    
    // Check all storage
    log('\n=== Step 3: Storage ===');
    const storage = await ext.evaluate(async () => {
      const d = await new Promise(r => chrome.storage.local.get(null, r));
      return { keys: Object.keys(d), data: d };
    });
    log('Keys: ' + JSON.stringify(storage.keys));
    
    // Check _swLogs
    if (storage.data._swLogs) {
      log('SW Logs: ' + JSON.stringify(storage.data._swLogs).substring(0, 2000));
    }
    
    // Check any formfill or df related keys
    for (const k of storage.keys) {
      if (k.includes('df') || k.includes('form') || k.includes('photo') || k.includes('image') || k.includes('pending')) {
        log(`  ${k}: ${JSON.stringify(storage.data[k]).substring(0, 200)}`);
      }
    }
  }
  
  await swPage.close();
  
  // === 4. Check eBay page photos ===
  log('\n=== Step 4: eBay page photo status ===');
  if (ebay) {
    log('eBay URL: ' + ebay.url());
    
    if (ebay.url().includes('/itm/')) {
      // It's the live listing. Photos are already there or not.
      const photos = await ebay.evaluate(() => {
        // Find the image gallery
        const gallery = document.querySelector('.ux-image-carousel, [class*="image-gallery"], .vim-image-gallery');
        const thumbContainer = document.querySelector('.ux-image-carousel-container, [class*="filmstrip"]');
        const allThumbs = thumbContainer ? thumbContainer.querySelectorAll('img') : [];
        const mainImg = document.querySelector('.ux-image-carousel-item img, [class*="image-gallery"] img');
        
        // Count distinct product images (not icons/logos)
        const productImgs = Array.from(document.querySelectorAll('img')).filter(i => {
          const src = i.src || '';
          return src.includes('i.ebayimg.com/images/g/') && !src.includes('icon');
        });
        
        const uniqueSrcs = [...new Set(productImgs.map(i => {
          // Normalize: strip size suffix to get unique image IDs
          const match = i.src.match(/\/g\/([^/]+)\//);
          return match ? match[1] : i.src;
        }))];
        
        return {
          totalProductImgs: productImgs.length,
          uniqueImages: uniqueSrcs.length,
          uniqueIds: uniqueSrcs,
          mainImg: mainImg?.src?.substring(0, 80),
          thumbCount: allThumbs.length
        };
      });
      log('Photos on listing: ' + JSON.stringify(photos, null, 2));
    }
    
    if (ebay.url().includes('/lstng')) {
      // Still on form - check photo upload section
      const formPhotos = await ebay.evaluate(() => {
        const photoSection = document.querySelector('[class*="photo"], [data-testid="photos"]');
        const uploadedImgs = photoSection?.querySelectorAll('img') || [];
        const uploadCount = document.querySelector('[class*="counter"], [class*="count"]');
        return {
          sectionExists: !!photoSection,
          sectionText: photoSection?.textContent?.substring(0, 200),
          imgCount: uploadedImgs.length,
          counterText: uploadCount?.textContent
        };
      });
      log('Form photos: ' + JSON.stringify(formPhotos));
    }
  }
  
  // === 5. Try draft API from the eBay page ===
  log('\n=== Step 5: Draft API ===');
  const DRAFT_ID = '5052101109920';
  
  // We need to be on an ebay.com.au page for same-origin
  // If we're on the live listing, that's ebay.com.au — good enough
  if (ebay && ebay.url().includes('ebay.com.au')) {
    // GET the draft first
    const draft = await ebay.evaluate(async (did) => {
      try {
        const r = await fetch(`/lstng/api/listing_draft/${did}`);
        return { status: r.status, statusText: r.statusText, body: (await r.text()).substring(0, 1000) };
      } catch(e) { return { error: e.message }; }
    }, DRAFT_ID);
    log('Draft GET: ' + JSON.stringify(draft));
    
    // If draft exists, try PUT with photos
    if (draft.status === 200) {
      const imageUrls = [
        "https://ae-pic-a1.aliexpress-media.com/kf/S1cf750c0a3554bbdae157dd2c4d92e26C.jpg",
        "https://ae-pic-a1.aliexpress-media.com/kf/Sc5bfa0e7793d4562a3ffe0bbe3a661166.jpg",
        "https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg",
        "https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg"
      ];
      
      // Parse existing draft to understand structure
      try {
        const draftData = JSON.parse(draft.body);
        log('Draft pictures field: ' + JSON.stringify(draftData.pictures || draftData.photoUrls || 'none').substring(0, 300));
      } catch(e) {
        log('Draft not JSON: ' + draft.body.substring(0, 200));
      }
    }
  }
  
  browser.disconnect();
  log('Done');
})().catch(e => console.error('FATAL:', e.message));
