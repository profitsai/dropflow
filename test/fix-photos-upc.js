const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  const draftId = new URL(ebayPage.url()).searchParams.get('draftId');
  
  // === PHOTOS: Upload real images via EPS, then PUT eBay URLs to draft ===
  console.log('=== UPLOADING PHOTOS VIA EPS ===');
  
  // Use AliExpress product images (the actual product)
  const imageUrls = [
    'https://ae01.alicdn.com/kf/S54f1adb2e5eb4e3e953c5d2a42987c05B.jpg',
    'https://ae01.alicdn.com/kf/S0e66e2f8c7e34a77a1e6fa98fec09aa8m.jpg'
  ];
  
  const epsResult = await ebayPage.evaluate(async (imageUrls) => {
    // Get EPS tokens
    let uaek, uaes;
    for (const s of document.querySelectorAll('script:not([src])')) {
      const m = s.textContent.match(/"uaek":"(\d+)","uaes":"([^"]+)"/);
      if (m) { uaek = m[1]; uaes = m[2]; break; }
    }
    if (!uaek) return { error: 'no EPS tokens' };
    
    const ebayUrls = [];
    for (let i = 0; i < imageUrls.length; i++) {
      try {
        // Fetch image
        const resp = await fetch(imageUrls[i]);
        const blob = await resp.blob();
        const file = new File([blob], `photo-${i+1}.jpg`, { type: 'image/jpeg' });
        
        const fd = new FormData();
        fd.append('file', file);
        fd.append('s', 'SuperSize');
        fd.append('n', 'i');
        fd.append('v', '2');
        fd.append('aXRequest', '2');
        fd.append('uaek', uaek);
        fd.append('uaes', uaes);
        
        const uploadResp = await fetch('/image/upload/eBayISAPI.dll?EpsBasic', {
          method: 'POST',
          credentials: 'include',
          body: fd
        });
        const text = await uploadResp.text();
        if (text.startsWith('VERSION:')) {
          const url = text.split(';')[1];
          ebayUrls.push(url);
          console.log(`Image ${i+1} uploaded: ${url}`);
        } else {
          console.log(`Image ${i+1} failed: ${text.substring(0, 100)}`);
        }
      } catch (e) {
        console.log(`Image ${i+1} error: ${e.message}`);
      }
    }
    return { ebayUrls };
  }, imageUrls);
  
  console.log('EPS uploaded URLs:', epsResult.ebayUrls);
  
  if (epsResult.ebayUrls && epsResult.ebayUrls.length > 0) {
    // Try multiple draft API PUT formats with eBay-hosted URLs
    const putResult = await ebayPage.evaluate(async (draftId, ebayUrls) => {
      const payloads = [
        { pictures: { pictureUrl: ebayUrls } },
        { pictures: ebayUrls.map(url => ({ URL: url })) },
        { pictureURL: ebayUrls }
      ];
      const results = [];
      for (const payload of payloads) {
        const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        const text = await resp.text();
        results.push({ status: resp.status, response: text.substring(0, 200) });
        if (resp.ok) break;
      }
      return results;
    }, draftId, epsResult.ebayUrls);
    console.log('Draft PUT with eBay URLs:', JSON.stringify(putResult, null, 2));
  }
  
  // === UPC: Try multiple clearing approaches ===
  console.log('\n=== CLEARING UPC ===');
  const upcResult = await ebayPage.evaluate(async (draftId) => {
    const payloads = [
      // Try to edit the variations themselves with empty UPC
      { variations: [
        { aspects: [{ displayName: "Dog Size", aspectValues: ["S"] }, { displayName: "Features", aspectValues: ["Red"] }], fixedPrice: 4.16, productIdentifiers: { UPC: "" } }
      ]},
      // Try product identifiers at top level
      { productIdentifiers: { UPC: "Does not apply" } },
      // Try clearing via variation attributes
      { variationProductIdentifiers: { UPC: "" } },
      // Try setting condition + UPC together
      { condition: { conditionId: 1000 }, productIdentifiers: { UPC: "Does not apply" } }
    ];
    const results = [];
    for (const payload of payloads) {
      try {
        const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        const text = await resp.text();
        results.push({ 
          format: JSON.stringify(payload).substring(0, 100),
          status: resp.status, 
          response: text.substring(0, 200) 
        });
      } catch (e) {
        results.push({ error: e.message });
      }
    }
    return results;
  }, draftId);
  console.log('UPC clear results:', JSON.stringify(upcResult, null, 2));
  
  // Reload and check
  console.log('\nReloading...');
  await ebayPage.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  
  const finalCheck = await ebayPage.evaluate(() => {
    const errors = Array.from(document.querySelectorAll('.summary--error'))
      .map(e => e.textContent.substring(0, 200));
    const cond = document.querySelector('#summary-condition-field-value')?.textContent?.trim();
    const imgs = document.querySelectorAll('.uploader-thumbnails img[src]');
    return { errors, condition: cond, photoCount: imgs.length };
  });
  console.log('\nFINAL STATE:', JSON.stringify(finalCheck, null, 2));
  
  browser.disconnect();
})().catch(e => console.error(e));
