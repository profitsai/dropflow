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

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Helper to set a React-compatible input value
async function setInputValue(page, selector, value) {
  await page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('Element not found: ' + sel);
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
}

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  if (!ebay) { console.error('No eBay lstng page'); process.exit(1); }
  
  await ebay.bringToFront();
  const draftId = ebay.url().match(/draftId=(\d+)/)?.[1];
  console.log('Draft ID:', draftId);
  
  // === STEP 1: Fill Description via draft API ===
  console.log('\n=== Step 1: Description via API ===');
  const descResult = await ebay.evaluate(async (desc, draftId) => {
    const url = `https://${location.host}/lstng/api/listing_draft/${draftId}?mode=AddItem`;
    const resp = await fetch(url, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc })
    });
    return { ok: resp.ok, status: resp.status, text: (await resp.text()).substring(0, 200) };
  }, DESCRIPTION, draftId);
  console.log('Description PUT:', JSON.stringify(descResult));
  
  // Also fill via TinyMCE DOM
  console.log('Filling description via DOM...');
  await ebay.evaluate((desc) => {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.body && doc.designMode === 'on') {
          doc.body.innerHTML = desc;
          return true;
        }
        // Try body with contenteditable
        if (doc && doc.body && doc.body.isContentEditable) {
          doc.body.innerHTML = desc;
          return true;
        }
      } catch (e) { /* cross-origin */ }
    }
    // Fallback: find contenteditable div
    const ce = document.querySelector('[contenteditable="true"]');
    if (ce) { ce.innerHTML = desc; return true; }
    return false;
  }, DESCRIPTION);
  
  // === STEP 2: Set Price ===
  console.log('\n=== Step 2: Price ===');
  const priceResult = await ebay.evaluate(async (draftId) => {
    const url = `https://${location.host}/lstng/api/listing_draft/${draftId}?mode=AddItem`;
    const resp = await fetch(url, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: { value: 24.99, currency: 'AUD' } })
    });
    return { ok: resp.ok, status: resp.status };
  }, draftId);
  console.log('Price PUT:', JSON.stringify(priceResult));
  
  // Also set price in DOM
  await ebay.evaluate(() => {
    const priceInputs = document.querySelectorAll('input');
    for (const input of priceInputs) {
      const label = input.getAttribute('aria-label') || '';
      const placeholder = input.getAttribute('placeholder') || '';
      if (label.toLowerCase().includes('price') || placeholder.includes('$')) {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, '24.99');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  });
  
  // === STEP 3: Set Quantity ===
  console.log('\n=== Step 3: Quantity ===');
  await ebay.evaluate(async (draftId) => {
    const url = `https://${location.host}/lstng/api/listing_draft/${draftId}?mode=AddItem`;
    await fetch(url, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 10 })
    });
  }, draftId);
  
  // === STEP 4: Set SKU ===
  console.log('\n=== Step 4: SKU ===');
  await ebay.evaluate(async (draftId) => {
    const url = `https://${location.host}/lstng/api/listing_draft/${draftId}?mode=AddItem`;
    await fetch(url, {
      method: 'PUT',
      credentials: 'include', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: '1005009953521226' })
    });
  }, draftId);
  
  // === STEP 5: Handle Variations - Click Edit button ===
  console.log('\n=== Step 5: Variations ===');
  
  // Scroll to VARIATIONS section
  await ebay.evaluate(() => {
    const sections = document.body.innerText;
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.textContent.trim() === 'VARIATIONS' && (el.tagName === 'H2' || el.tagName === 'H3' || el.tagName === 'SPAN' || el.tagName === 'DIV')) {
        el.scrollIntoView({ block: 'center' });
        return;
      }
    }
  });
  await sleep(1000);
  
  // Click the "Edit" button next to VARIATIONS
  const editClicked = await ebay.evaluate(() => {
    // Find VARIATIONS text then find nearby Edit button
    const allText = document.querySelectorAll('*');
    for (const el of allText) {
      if (el.textContent.trim() === 'VARIATIONS' || el.textContent.trim() === 'Variations') {
        const container = el.closest('section, div, [class*="section"]') || el.parentElement;
        if (container) {
          const editBtn = container.querySelector('button, a, [role="button"]');
          if (editBtn && editBtn.textContent.includes('Edit')) {
            editBtn.click();
            return 'clicked: ' + editBtn.textContent.trim();
          }
          // Try siblings
          const parent = container.parentElement;
          if (parent) {
            const btns = parent.querySelectorAll('button, a, [role="button"]');
            for (const btn of btns) {
              if (btn.textContent.trim().includes('Edit')) {
                btn.click();
                return 'clicked sibling: ' + btn.textContent.trim();
              }
            }
          }
        }
      }
    }
    
    // Fallback: find any "Edit" link near variations text
    const body = document.body.innerHTML;
    const varIndex = body.indexOf('VARIATION');
    if (varIndex > -1) {
      const editButtons = [...document.querySelectorAll('a, button')].filter(b => b.textContent.trim() === 'Edit');
      // The variations Edit is likely the 2nd or 3rd Edit button
      if (editButtons.length > 0) {
        return 'found ' + editButtons.length + ' edit buttons';
      }
    }
    return 'not found';
  });
  console.log('Edit variations:', editClicked);
  
  await sleep(2000);
  await ebay.screenshot({ path: 'after-edit-click.png' });
  
  // Check for variation builder dialog/iframe
  const checkDialog = await ebay.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]');
    const iframes = [...document.querySelectorAll('iframe')].map(f => f.src);
    return { dialogs: dialogs.length, iframes };
  });
  console.log('After edit click:', JSON.stringify(checkDialog));
  
  // Check for bulkedit iframe
  const bulkeditFrame = await ebay.evaluate(() => {
    const iframes = document.querySelectorAll('iframe');
    for (const f of iframes) {
      if (f.src.includes('bulkedit') || f.src.includes('msku')) {
        return f.src;
      }
    }
    return null;
  });
  console.log('Bulkedit frame:', bulkeditFrame);
  
  // Take screenshot
  await ebay.screenshot({ path: 'variation-state.png' });
  
  browser.disconnect();
  console.log('\nDone');
})().catch(e => { console.error(e.message); process.exit(1); });
