const puppeteer = require('puppeteer-core');

const DRAFT_ID = '5051335987822';
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';

const IMAGES = [
  "https://ae-pic-a1.aliexpress-media.com/kf/S1cf750c0a3554bbdae157dd2c4d92e26C.jpg",
  "https://ae-pic-a1.aliexpress-media.com/kf/Sc5bfa0e7793d4562a3ffe0bbe3a661166.jpg",
  "https://ae-pic-a1.aliexpress-media.com/kf/Sf7831f8ffa854eccbd953391af468128t.jpg",
  "https://ae-pic-a1.aliexpress-media.com/kf/Sfcb676f3b6ab4f6baf6d5e5e013627ddz.jpg",
  "https://ae-pic-a1.aliexpress-media.com/kf/S84f2d74dd2a742f4904f212aa53aad77H.jpg",
  "https://ae-pic-a1.aliexpress-media.com/kf/Se33197e157b04d5485f24224fa4601e8H.jpg"
];

const DESCRIPTION = `<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
<h2>Warm Fleece Dog Coat with Hood - Waterproof Winter Pet Jacket</h2>
<p>Keep your furry friend warm and dry this winter with our premium fleece-lined dog coat. Designed with a cosy hood and waterproof outer shell, this jacket is perfect for cold weather walks.</p>
<h3>Key Features:</h3>
<ul>
<li><strong>Waterproof Exterior</strong> - Protects against rain and wind</li>
<li><strong>Soft Fleece Lining</strong> - Keeps your pet warm and comfortable</li>
<li><strong>Hooded Design</strong> - Extra protection for your dog's head and ears</li>
<li><strong>Easy On/Off</strong> - Simple velcro closure for quick dressing</li>
<li><strong>Leash Hole</strong> - Convenient opening on the back for lead attachment</li>
</ul>
<h3>Suitable For:</h3>
<p>Small to medium dogs including French Bulldogs, Pugs, Chihuahuas, Dachshunds, and similar breeds. Please check our size chart to ensure the perfect fit for your pet.</p>
<h3>Size Guide:</h3>
<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">
<tr><th>Size</th><th>Back Length</th><th>Chest</th><th>Weight</th></tr>
<tr><td>XS</td><td>20cm</td><td>30cm</td><td>1-2kg</td></tr>
<tr><td>S</td><td>25cm</td><td>36cm</td><td>2-4kg</td></tr>
<tr><td>M</td><td>30cm</td><td>42cm</td><td>4-6kg</td></tr>
<tr><td>L</td><td>35cm</td><td>48cm</td><td>6-9kg</td></tr>
<tr><td>XL</td><td>40cm</td><td>54cm</td><td>9-13kg</td></tr>
</table>
<p><em>Please measure your dog before ordering and allow 1-2cm for comfort.</em></p>
</div>`;

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  if (!ebay) { console.error('No eBay listing page found'); process.exit(1); }
  await ebay.bringToFront();

  // Step 1: Get eBay headers by intercepting a request
  console.log('=== Step 1: Getting eBay API headers ===');
  const headers = await ebay.evaluate(async (draftId) => {
    // First, try to get the draft to capture cookies/headers
    const url = `https://${location.host}/lstng/api/listing_draft/${draftId}?mode=AddItem`;
    try {
      const resp = await fetch(url, { method: 'GET', credentials: 'include' });
      if (resp.ok) {
        const data = await resp.json();
        console.log('Draft GET successful, keys:', Object.keys(data));
        // Extract relevant headers we need
        return { success: true, host: location.host };
      } else {
        return { success: false, status: resp.status, text: await resp.text().catch(() => '') };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }, DRAFT_ID);
  console.log('Headers check:', JSON.stringify(headers));

  // Step 2: Upload images via draft API PUT  
  console.log('\n=== Step 2: Uploading images via draft API ===');
  const imageResult = await ebay.evaluate(async (draftId, images) => {
    const url = `https://${location.host}/lstng/api/listing_draft/${draftId}?mode=AddItem`;
    
    // Try multiple payload formats for images
    const payloads = [
      { pictures: images.map(u => ({ url: u })) },
      { pictureUrls: images },
      { images: images.map(u => ({ imageUrl: u })) },
      { listing: { pictures: images.map(u => ({ url: u })) } },
      { pictureURL: images },
    ];
    
    for (let i = 0; i < payloads.length; i++) {
      try {
        const resp = await fetch(url, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloads[i])
        });
        const text = await resp.text();
        console.log(`Image payload ${i}: ${resp.status}`, text.substring(0, 200));
        if (resp.ok) return { success: true, payload: i, response: text.substring(0, 300) };
      } catch (e) {
        console.log(`Image payload ${i} error:`, e.message);
      }
    }
    return { success: false };
  }, DRAFT_ID, IMAGES);
  console.log('Image upload result:', JSON.stringify(imageResult).substring(0, 500));

  // Step 3: Set description via draft API PUT
  console.log('\n=== Step 3: Setting description ===');
  const descResult = await ebay.evaluate(async (draftId, desc) => {
    const url = `https://${location.host}/lstng/api/listing_draft/${draftId}?mode=AddItem`;
    
    const payloads = [
      { description: desc },
      { listing: { description: desc } },
      { htmlDescription: desc },
    ];
    
    for (let i = 0; i < payloads.length; i++) {
      try {
        const resp = await fetch(url, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloads[i])
        });
        const text = await resp.text();
        console.log(`Desc payload ${i}: ${resp.status}`, text.substring(0, 200));
        if (resp.ok) return { success: true, payload: i };
      } catch (e) {
        console.log(`Desc payload ${i} error:`, e.message);
      }
    }
    return { success: false };
  }, DRAFT_ID, DESCRIPTION);
  console.log('Description result:', JSON.stringify(descResult));

  // Step 4: Fill description via DOM (TinyMCE iframe) as fallback
  console.log('\n=== Step 4: Filling description via DOM ===');
  const domDescResult = await ebay.evaluate(async (desc) => {
    // Find the description iframe (TinyMCE)
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.body && (doc.body.getAttribute('data-id') || doc.designMode === 'on' || iframe.id?.includes('mce'))) {
          doc.body.innerHTML = desc;
          doc.body.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true, method: 'tinymce-iframe' };
        }
      } catch (e) { /* cross-origin */ }
    }
    
    // Try "Show HTML code" checkbox approach
    const htmlCheckbox = [...document.querySelectorAll('input[type="checkbox"]')].find(
      el => el.closest('label')?.textContent?.includes('HTML') || 
            el.getAttribute('aria-label')?.includes('HTML')
    );
    if (htmlCheckbox) {
      return { success: false, found: 'html-checkbox' };
    }
    
    return { success: false, iframeCount: iframes.length };
  }, DESCRIPTION);
  console.log('DOM description result:', JSON.stringify(domDescResult));

  // Step 5: Fill item specifics  
  console.log('\n=== Step 5: Filling item specifics ===');
  // Fill Type = Coat/Jacket
  const specificsResult = await ebay.evaluate(async () => {
    const results = [];
    
    // Helper to find dropdown/combobox by label
    function findFieldByLabel(labelText) {
      const labels = [...document.querySelectorAll('label, span, div')];
      for (const l of labels) {
        if (l.textContent.trim().toLowerCase().startsWith(labelText.toLowerCase())) {
          const container = l.closest('[class*="field"], [class*="row"], [class*="spec"]') || l.parentElement;
          if (container) {
            const select = container.querySelector('select');
            const input = container.querySelector('input[type="text"], input:not([type])');
            const btn = container.querySelector('button, [role="combobox"], [role="listbox"]');
            return { select, input, btn, container };
          }
        }
      }
      return null;
    }
    
    return { message: 'Item specifics helper ready' };
  });
  
  // Let me try clicking on Type dropdown and selecting Coat/Jacket
  // First scroll to item specifics section
  await ebay.evaluate(() => {
    const sections = [...document.querySelectorAll('h3, h2, [class*="section"]')];
    const specifics = sections.find(s => s.textContent.includes('ITEM SPECIFICS') || s.textContent.includes('Item specifics'));
    if (specifics) specifics.scrollIntoView({ block: 'center' });
  });
  await new Promise(r => setTimeout(r, 1000));

  // Take screenshot to see item specifics section
  await ebay.screenshot({ path: 'specifics-section.png' });
  
  console.log('\n=== Step 6: Check current form state ===');
  // Get the draft data to see what's already set
  const draftData = await ebay.evaluate(async (draftId) => {
    const url = `https://${location.host}/lstng/api/listing_draft/${draftId}?mode=AddItem`;
    try {
      const resp = await fetch(url, { credentials: 'include' });
      if (resp.ok) {
        const data = await resp.json();
        return { keys: Object.keys(data), 
                 pictures: data.pictures || data.pictureUrls,
                 description: data.description ? data.description.substring(0,100) : null,
                 title: data.title,
                 price: data.price,
                 specifics: data.itemSpecifics || data.aspects };
      }
      return { error: resp.status };
    } catch (e) { return { error: e.message }; }
  }, DRAFT_ID);
  console.log('Draft data:', JSON.stringify(draftData, null, 2).substring(0, 2000));

  browser.disconnect();
  console.log('\nDone!');
})().catch(e => { console.error(e); process.exit(1); });
