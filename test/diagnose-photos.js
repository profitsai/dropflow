const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // === 1. Connect to service worker via CDP and get console logs ===
  log('=== Step 1: Service Worker console logs ===');
  
  // Get all targets
  const cdpBrowser = await browser.target().createCDPSession().catch(() => null);
  const targets = await browser._connection.send('Target.getTargets');
  const swTarget = targets.targetInfos.find(t => 
    t.type === 'service_worker' && t.url.includes(EXT_ID)
  );
  
  if (swTarget) {
    log('Found SW target: ' + swTarget.targetId);
    
    // Attach to the service worker
    const { sessionId } = await browser._connection.send('Target.attachToTarget', {
      targetId: swTarget.targetId,
      flatten: true
    });
    
    // Enable console and get stored messages
    // We can't get past messages, but let's check storage for logs
    log('SW attached, sessionId: ' + sessionId);
  } else {
    log('No service worker target found!');
    const allSW = targets.targetInfos.filter(t => t.type === 'service_worker');
    log('All SW targets: ' + JSON.stringify(allSW.map(t => t.url)));
  }
  
  // === 2. Check ebayContext / GET_EBAY_HEADERS ===
  log('\n=== Step 2: Check ebayContext ===');
  const pages = await browser.pages();
  const ext = pages.find(p => p.url().includes(EXT_ID));
  
  if (ext) {
    const headers = await ext.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_EBAY_HEADERS' }, (resp) => {
          resolve(resp || { error: 'no response' });
        });
        setTimeout(() => resolve({ error: 'timeout' }), 3000);
      });
    });
    log('GET_EBAY_HEADERS result: ' + JSON.stringify(headers).substring(0, 500));
  }
  
  // === 3. Check formfill result in storage ===
  log('\n=== Step 3: Check storage for formfill results ===');
  if (ext) {
    const storage = await ext.evaluate(async () => {
      const d = await new Promise(r => chrome.storage.local.get(null, r));
      const relevant = {};
      for (const [k, v] of Object.entries(d)) {
        if (k.includes('formfill') || k.includes('_df') || k.includes('photo') || 
            k.includes('image') || k.includes('draft') || k.includes('pending') ||
            k.includes('Log') || k.includes('log') || k.includes('sw') ||
            k.includes('ebay')) {
          relevant[k] = typeof v === 'string' ? v.substring(0, 200) : 
                        typeof v === 'object' ? JSON.stringify(v).substring(0, 200) : v;
        }
      }
      return { relevant, allKeys: Object.keys(d) };
    });
    log('All storage keys: ' + JSON.stringify(storage.allKeys));
    log('Relevant storage: ' + JSON.stringify(storage.relevant, null, 2));
  }
  
  // === 4. Check the eBay page state ===
  log('\n=== Step 4: Check eBay page ===');
  const ebay = pages.find(p => p.url().includes('ebay.com.au'));
  if (ebay) {
    log('eBay URL: ' + ebay.url());
    
    // Is it on the listing form or the live listing?
    const isForm = ebay.url().includes('/lstng');
    const isLive = ebay.url().includes('/itm/');
    log(`Page type: form=${isForm}, live=${isLive}`);
    
    if (isLive) {
      // Check how many photos are on the live listing
      const photoInfo = await ebay.evaluate(() => {
        const allImgs = document.querySelectorAll('img');
        const ebayImgs = Array.from(allImgs).filter(i => i.src?.includes('ebayimg'));
        const thumbs = ebayImgs.filter(i => i.src?.includes('s-l140') || i.src?.includes('s-l96'));
        const large = ebayImgs.filter(i => i.src?.includes('s-l500') || i.src?.includes('s-l1600'));
        return {
          totalEbayImgs: ebayImgs.length,
          thumbs: thumbs.length,
          large: large.length,
          thumbSrcs: thumbs.map(i => i.src.substring(0, 80)),
          largeSrcs: large.map(i => i.src.substring(0, 80))
        };
      });
      log('Photo info on live listing: ' + JSON.stringify(photoInfo, null, 2));
    }
  }
  
  // === 5. Try draft API PUT for photos ===
  log('\n=== Step 5: Try draft API PUT ===');
  const DRAFT_ID = '5052101109920';
  
  if (ebay) {
    // First, check if we can GET the draft
    const draftGet = await ebay.evaluate(async (draftId) => {
      try {
        const resp = await fetch(`/lstng/api/listing_draft/${draftId}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });
        const text = await resp.text();
        return { status: resp.status, body: text.substring(0, 500) };
      } catch(e) {
        return { error: e.message };
      }
    }, DRAFT_ID);
    log('Draft GET: ' + JSON.stringify(draftGet));
    
    // Try multiple PUT formats for photos
    const imageUrls = [
      "https://ae-pic-a1.aliexpress-media.com/kf/S1cf750c0a3554bbdae157dd2c4d92e26C.jpg",
      "https://ae-pic-a1.aliexpress-media.com/kf/Sc5bfa0e7793d4562a3ffe0bbe3a661166.jpg",
      "https://ae-pic-a1.aliexpress-media.com/kf/S15d6dab586f2486c8ee5d20704582899a.jpg",
      "https://ae-pic-a1.aliexpress-media.com/kf/Sdd42651e632041e797aa7d5531dd9f091.jpg"
    ];
    
    const putFormats = [
      // Format A: pictures array with imageUrl
      { pictures: imageUrls.map((url, i) => ({ imageUrl: url, order: i })) },
      // Format B: pictureURL array
      { pictureURL: imageUrls },
      // Format C: photoUrls
      { photoUrls: imageUrls },
      // Format D: nested under listing
      { listing: { pictures: imageUrls.map(url => ({ imageUrl: url })) } },
      // Format E: images array
      { images: imageUrls.map(url => ({ url })) },
    ];
    
    for (let i = 0; i < putFormats.length; i++) {
      const result = await ebay.evaluate(async (draftId, payload) => {
        try {
          const resp = await fetch(`/lstng/api/listing_draft/${draftId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const text = await resp.text();
          return { status: resp.status, body: text.substring(0, 300) };
        } catch(e) {
          return { error: e.message };
        }
      }, DRAFT_ID, putFormats[i]);
      log(`PUT format ${i}: ${JSON.stringify(result)}`);
      if (result.status === 200 || result.status === 204) {
        log('SUCCESS with format ' + i);
        break;
      }
    }
  }
  
  browser.disconnect();
  log('Done');
})().catch(e => console.error('FATAL:', e.message));
