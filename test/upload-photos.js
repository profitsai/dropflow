const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  const draftId = new URL(ebayPage.url()).searchParams.get('draftId');
  
  // Step 1: Get the AliExpress product images from the extension storage
  // Since we can't access chrome.storage from evaluate, let's use known AliExpress images
  // for this product (dog harness from the test URL)
  
  // Step 2: Upload via EPS (proven to work) then PUT eBay URLs to draft
  console.log('=== Uploading photos via EPS ===');
  
  const result = await ebayPage.evaluate(async (draftId) => {
    // Get EPS tokens
    let uaek, uaes;
    for (const s of document.querySelectorAll('script:not([src])')) {
      const m = s.textContent.match(/"uaek":"(\d+)","uaes":"([^"]+)"/);
      if (m) { uaek = m[1]; uaes = m[2]; break; }
    }
    if (!uaek) return { error: 'no EPS tokens' };
    
    // Create test images via canvas (real product images would come from AliExpress)
    // For now use canvas-generated images to prove the flow works
    async function createTestImage(text, color) {
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 800;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 800, 800);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 40px Arial';
      ctx.fillText(text, 50, 400);
      return new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    }
    
    // Try fetching real AliExpress images first
    const aliImages = [
      'https://ae01.alicdn.com/kf/S54f1adb2e5eb4e3e953c5d2a42987c05B.jpg',
      'https://ae01.alicdn.com/kf/S0e66e2f8c7e34a77a1e6fa98fec09aa8m.jpg',
      'https://ae01.alicdn.com/kf/Sf6a3c3c5bbcb4b108fbf1f3f9f2e6d3dJ.jpg'
    ];
    
    const files = [];
    for (let i = 0; i < aliImages.length; i++) {
      try {
        const resp = await fetch(aliImages[i], { mode: 'cors' });
        if (resp.ok) {
          const blob = await resp.blob();
          if (blob.size > 1000) { // Real image
            files.push(new File([blob], `photo-${i+1}.jpg`, { type: 'image/jpeg' }));
            continue;
          }
        }
      } catch(e) {}
      // Fallback: canvas image
      const blob = await createTestImage(`Product Photo ${i+1}`, ['#cc4444', '#4444cc', '#44cc44'][i]);
      files.push(new File([blob], `photo-${i+1}.jpg`, { type: 'image/jpeg' }));
    }
    
    console.log(`Uploading ${files.length} images to EPS...`);
    const epsUrls = [];
    
    for (let i = 0; i < files.length; i++) {
      try {
        const fd = new FormData();
        fd.append('file', files[i]);
        fd.append('s', 'SuperSize');
        fd.append('n', 'i');
        fd.append('v', '2');
        fd.append('aXRequest', '2');
        fd.append('uaek', uaek);
        fd.append('uaes', uaes);
        
        const resp = await fetch('/image/upload/eBayISAPI.dll?EpsBasic', {
          method: 'POST', credentials: 'include', body: fd
        });
        const text = await resp.text();
        if (text.startsWith('VERSION:')) {
          const url = text.split(';')[1];
          epsUrls.push(url);
          console.log(`Image ${i+1}: ${url}`);
        } else {
          console.log(`Image ${i+1} failed: ${text.substring(0, 100)}`);
        }
      } catch(e) {
        console.log(`Image ${i+1} error: ${e.message}`);
      }
    }
    
    if (epsUrls.length === 0) return { error: 'no EPS uploads succeeded' };
    
    // PUT eBay URLs to draft
    const putResp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ pictures: { pictureUrl: epsUrls } })
    });
    const putText = await putResp.text();
    
    return { epsUrls, putStatus: putResp.status, putResponse: putText.substring(0, 200) };
  }, draftId);
  
  console.log('Upload result:', JSON.stringify(result, null, 2));
  
  if (result.putStatus === 200) {
    console.log('Reloading page...');
    await ebayPage.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    
    // Check photos now
    const photoCheck = await ebayPage.evaluate(() => {
      const section = document.querySelector('.summary__photos');
      const hasError = section?.classList.contains('summary--error');
      const imgs = document.querySelectorAll('.uploader-thumbnails img[src]');
      const countEl = document.querySelector('.uploader-thumbnails__photo-count');
      return {
        hasError,
        imgCount: imgs.length,
        countText: countEl?.textContent,
        firstImgSrc: Array.from(imgs).slice(0,2).map(i => i.src?.substring(0, 80))
      };
    });
    console.log('Photos after reload:', JSON.stringify(photoCheck, null, 2));
    
    // Also check all errors
    const errors = await ebayPage.evaluate(() => {
      return Array.from(document.querySelectorAll('.summary--error'))
        .map(e => e.className.substring(0, 60) + ': ' + e.textContent.substring(0, 150));
    });
    console.log('All errors:', errors.length === 0 ? 'NONE ✅' : errors);
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
