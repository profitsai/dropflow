const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  const draftId = new URL(ebayPage.url()).searchParams.get('draftId');
  
  // Test 1: Check if EPS tokens exist on page
  const epsCheck = await ebayPage.evaluate(() => {
    const scripts = document.querySelectorAll('script:not([src])');
    for (const s of scripts) {
      const text = s.textContent;
      const match = text.match(/"uaek":"(\d+)","uaes":"([^"]+)"/);
      if (match) return { uaek: match[1], uaes: match[2].substring(0, 20) + '...' };
    }
    return null;
  });
  console.log('EPS tokens:', epsCheck);
  
  // Test 2: Try "Import from web" feature
  // This is eBay's built-in feature to import photos from URLs
  const importTest = await ebayPage.evaluate(async (draftId) => {
    // Try PUT with a real image URL to the draft
    const testImageUrl = 'https://ae01.alicdn.com/kf/S54f1adb2e5eb4e3e953c5d2a42987c05B.jpg';
    
    const payloads = [
      // Format 1: pictures array with pictureUrl
      { pictures: { pictureUrl: [testImageUrl] } },
      // Format 2: pictures.pictureURL (array of strings)
      { pictures: { pictureURL: [testImageUrl] } },
      // Format 3: Top-level pictureURL
      { pictureURL: [testImageUrl] },
      // Format 4: eBay's actual format from network captures
      { pictures: [{ URL: testImageUrl }] }
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
          format: JSON.stringify(payload).substring(0, 80),
          status: resp.status,
          ok: resp.ok,
          response: text.substring(0, 300)
        });
        if (resp.ok) {
          // Check if reload is needed
          try {
            const data = JSON.parse(text);
            if (data.reload) results[results.length-1].needsReload = true;
          } catch(_) {}
          break; // Stop on first success
        }
      } catch (e) {
        results.push({ format: JSON.stringify(payload).substring(0, 80), error: e.message });
      }
    }
    return results;
  }, draftId);
  console.log('Draft API PUT results:', JSON.stringify(importTest, null, 2));
  
  // Test 3: Try EPS upload with a real image
  if (epsCheck) {
    console.log('\nTesting EPS upload...');
    const epsResult = await ebayPage.evaluate(async () => {
      // Get EPS tokens
      let uaek, uaes;
      const scripts = document.querySelectorAll('script:not([src])');
      for (const s of scripts) {
        const match = s.textContent.match(/"uaek":"(\d+)","uaes":"([^"]+)"/);
        if (match) { uaek = match[1]; uaes = match[2]; break; }
      }
      
      // Create a minimal JPEG (smaller but valid)
      // Use a canvas to create a real image
      const canvas = document.createElement('canvas');
      canvas.width = 500;
      canvas.height = 500;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 500, 500);
      ctx.fillStyle = '#ffffff';
      ctx.font = '30px Arial';
      ctx.fillText('Test Photo', 150, 260);
      
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      const file = new File([blob], 'test-photo.jpg', { type: 'image/jpeg' });
      
      const fd = new FormData();
      fd.append('file', file);
      fd.append('s', 'SuperSize');
      fd.append('n', 'i');
      fd.append('v', '2');
      fd.append('aXRequest', '2');
      fd.append('uaek', uaek);
      fd.append('uaes', uaes);
      
      try {
        const resp = await fetch('/image/upload/eBayISAPI.dll?EpsBasic', {
          method: 'POST',
          credentials: 'include',
          body: fd
        });
        const text = await resp.text();
        return { status: resp.status, ok: resp.ok, response: text.substring(0, 300) };
      } catch (e) {
        return { error: e.message };
      }
    });
    console.log('EPS upload result:', JSON.stringify(epsResult, null, 2));
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
