const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  if (!ebayPage) { console.log('No eBay page'); return; }
  
  const draftId = new URL(ebayPage.url()).searchParams.get('draftId');
  console.log('Draft ID:', draftId);
  
  // === FIX 1: Click condition ===
  console.log('\n=== FIX 1: CONDITION ===');
  const condResult = await ebayPage.evaluate(() => {
    const btn = document.querySelector('button.condition-recommendation-value');
    if (btn) {
      btn.click();
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return 'Clicked: ' + btn.textContent.trim();
    }
    return 'No condition button found';
  });
  console.log('Condition:', condResult);
  await new Promise(r => setTimeout(r, 2000));
  
  // Verify condition was set
  const condCheck = await ebayPage.evaluate(() => {
    const condValue = document.querySelector('#summary-condition-field-value');
    const condRecoBtn = document.querySelector('button.condition-recommendation-value');
    return {
      value: condValue?.textContent?.trim(),
      recoButtonsStillVisible: !!condRecoBtn
    };
  });
  console.log('Condition after click:', condCheck);

  // === FIX 2: PHOTOS - Test Helix uploader via main world ===
  console.log('\n=== FIX 2: PHOTOS ===');
  const helixCheck = await ebayPage.evaluate(() => {
    return new Promise(resolve => {
      const script = document.createElement('script');
      const cbId = '__dropflow_helix_check_' + Date.now();
      const handler = (event) => {
        if (event.data && event.data.type === cbId) {
          window.removeEventListener('message', handler);
          resolve(event.data);
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => { window.removeEventListener('message', handler); resolve({ timeout: true }); }, 5000);
      
      script.textContent = `
        (function() {
          var id = "${cbId}";
          var u = window.sellingUIUploader;
          if (!u) { window.postMessage({ type: id, hasUploader: false }, '*'); return; }
          var key = Object.keys(u)[0];
          var inst = key ? u[key] : null;
          window.postMessage({ 
            type: id, 
            hasUploader: true, 
            key: key,
            hasUploadFiles: inst ? typeof inst.uploadFiles : 'no instance',
            config: inst && inst.config ? { accept: inst.config.accept, acceptImage: inst.config.acceptImage, maxImages: inst.config.maxImages } : null,
            totalImages: inst ? inst.totalImagesCount : null
          }, '*');
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    });
  });
  console.log('Helix uploader status:', JSON.stringify(helixCheck, null, 2));
  
  // === FIX 3: UPC - Try to clear via API ===
  console.log('\n=== FIX 3: UPC ===');
  
  // Get ebay headers from page
  const headers = await ebayPage.evaluate(() => {
    // Get CSRF token
    const meta = document.querySelector('meta[name="csrf-token"]');
    const csrfToken = meta ? meta.content : null;
    // Get x-ebay headers from cookies
    return {
      csrfToken,
      cookie: document.cookie.substring(0, 200)
    };
  });
  console.log('CSRF token:', headers.csrfToken ? 'found' : 'not found');
  
  // Try to clear UPC via draft API PUT directly from the page context
  const upcClear = await ebayPage.evaluate(async (draftId) => {
    const results = [];
    const payloads = [
      { variations: { productDetails: { UPC: '' } } },
      { variations: { productDetails: { UPC: 'Does not apply' } } },
      { productDetails: { UPC: 'Does not apply' } },
      { productDetails: { UPC: '' } }
    ];
    
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
          payload: JSON.stringify(payload).substring(0, 80),
          status: resp.status,
          ok: resp.ok,
          resp: text.substring(0, 200)
        });
        if (resp.ok) break;
      } catch (e) {
        results.push({ payload: JSON.stringify(payload).substring(0, 80), error: e.message });
      }
    }
    return results;
  }, draftId);
  console.log('UPC clear attempts:', JSON.stringify(upcClear, null, 2));
  
  browser.disconnect();
})().catch(e => console.error(e));
