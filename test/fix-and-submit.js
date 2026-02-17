const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  if (!ebay) { console.error('No eBay page'); process.exit(1); }
  
  const draftId = ebay.url().match(/draftId=(\d+)/)?.[1];
  console.log('Draft ID:', draftId);
  
  // Step 1: Fix UPC issue - clear UPC values in the variation grid
  // Need to open variation editor and fix UPC
  console.log('=== Step 1: Fix UPC in variations ===');
  
  // Click Edit on VARIATIONS section
  await ebay.evaluate(() => {
    // Find the Variations section edit button
    const allText = document.body.innerText;
    const elems = document.querySelectorAll('*');
    for (const el of elems) {
      if (el.textContent.trim() === 'VARIATIONS') {
        const parent = el.closest('section, div') || el.parentElement;
        const editBtn = parent?.querySelector('button, a, [role="button"]');
        if (editBtn && editBtn.textContent.includes('Edit')) {
          editBtn.click();
          return 'clicked';
        }
        // Check parent's parent
        const pp = parent?.parentElement;
        const btns = pp?.querySelectorAll('button, a');
        if (btns) {
          for (const b of btns) {
            if (b.textContent.trim().includes('Edit')) {
              b.click();
              return 'clicked parent';
            }
          }
        }
      }
    }
  });
  await sleep(3000);
  
  // Find bulkedit frame
  let bf = ebay.frames().find(f => f.url().includes('bulkedit'));
  if (!bf) {
    console.log('No bulkedit frame, checking iframes...');
    const frames = ebay.frames();
    frames.forEach(f => console.log('Frame:', f.url().substring(0, 80)));
    
    // Wait more
    await sleep(5000);
    bf = ebay.frames().find(f => f.url().includes('bulkedit'));
  }
  
  if (bf) {
    console.log('Found bulkedit frame');
    await sleep(3000);
    
    // Clear UPC values - they were set to "24.99" accidentally
    const cleared = await bf.evaluate(() => {
      const table = document.querySelector('table');
      if (!table) return { error: 'no table' };
      
      const rows = table.querySelectorAll('tr');
      let cleared = 0;
      
      for (const row of rows) {
        const tds = [...row.querySelectorAll('td')];
        const inputs = [...row.querySelectorAll('input[type="text"]')].filter(i => i.offsetParent);
        
        // Find UPC inputs (they have "24.99" which is wrong)
        for (const input of inputs) {
          if (input.value === '24.99') {
            // Check if this is likely UPC (not price)
            // Price column is the last, UPC is before Dog Size
            const allInputsInRow = inputs;
            const idx = allInputsInRow.indexOf(input);
            if (idx < allInputsInRow.length - 1) {
              // Not the last input, so it's not price - it's UPC, clear it
              const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              ns.call(input, '');
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('blur', { bubbles: true }));
              cleared++;
            }
          }
        }
      }
      return { cleared };
    });
    console.log('Cleared UPCs:', JSON.stringify(cleared));
    
    // Also verify prices are set
    const gridCheck = await bf.evaluate(() => {
      const table = document.querySelector('table');
      if (!table) return { error: 'no table' };
      
      const rows = [...table.querySelectorAll('tr')];
      const data = [];
      for (const row of rows) {
        const inputs = [...row.querySelectorAll('input[type="text"]')].filter(i => i.offsetParent);
        if (inputs.length >= 2) {
          const price = inputs[inputs.length - 1].value;
          const qty = inputs[inputs.length - 2].value;
          data.push({ price, qty, inputCount: inputs.length });
        }
      }
      return data;
    });
    console.log('Grid check:', JSON.stringify(gridCheck));
    
    // If any prices or qtys are empty, fill them
    const needsFilling = gridCheck.some(r => !r.price || !r.qty);
    if (needsFilling) {
      console.log('Filling missing values...');
      await bf.evaluate(() => {
        const table = document.querySelector('table');
        const rows = [...table.querySelectorAll('tr')];
        for (const row of rows) {
          const inputs = [...row.querySelectorAll('input[type="text"]')].filter(i => i.offsetParent);
          if (inputs.length < 2) continue;
          
          const priceInput = inputs[inputs.length - 1];
          const qtyInput = inputs[inputs.length - 2];
          
          const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          
          if (!priceInput.value || priceInput.value === '') {
            priceInput.focus();
            ns.call(priceInput, '24.99');
            priceInput.dispatchEvent(new Event('input', { bubbles: true }));
            priceInput.dispatchEvent(new Event('change', { bubbles: true }));
            priceInput.dispatchEvent(new Event('blur', { bubbles: true }));
          }
          
          if (!qtyInput.value || qtyInput.value === '') {
            qtyInput.focus();
            ns.call(qtyInput, '5');
            qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
            qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
            qtyInput.dispatchEvent(new Event('blur', { bubbles: true }));
          }
        }
      });
    }
    
    await sleep(1000);
    
    // Save and close
    console.log('Saving...');
    await bf.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim() === 'Save and close' && b.offsetParent !== null) {
          b.click(); return;
        }
      }
    });
    await sleep(5000);
  } else {
    console.log('No bulkedit frame available');
  }
  
  // Step 2: Check and fix description
  console.log('\n=== Step 2: Check description ===');
  const descState = await ebay.evaluate(() => {
    // Find TinyMCE iframe
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.body) {
          const text = doc.body.innerText?.trim();
          if (text && text.length > 50) {
            return { hasContent: true, length: text.length, preview: text.substring(0, 100) };
          }
        }
      } catch (e) {}
    }
    return { hasContent: false };
  });
  console.log('Description:', JSON.stringify(descState));
  
  // If description is empty, fill via API
  if (!descState.hasContent) {
    console.log('Filling description via API...');
    const desc = `<div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">
<h2>Warm Fleece Dog Coat with Hood - Waterproof Winter Pet Jacket</h2>
<p>Keep your furry friend warm and dry this winter with our premium fleece-lined dog coat.</p>
<h3>Key Features:</h3>
<ul>
<li><strong>Waterproof Exterior</strong> - Protects against rain and wind</li>
<li><strong>Soft Fleece Lining</strong> - Warm and comfortable</li>
<li><strong>Hooded Design</strong> - Extra protection for head and ears</li>
<li><strong>Easy On/Off</strong> - Velcro closure for quick dressing</li>
</ul>
<h3>Size Guide:</h3>
<table border="1" cellpadding="5" cellspacing="0" style="border-collapse:collapse;">
<tr><th>Size</th><th>Back</th><th>Chest</th></tr>
<tr><td>XS</td><td>20cm</td><td>30cm</td></tr>
<tr><td>S</td><td>25cm</td><td>36cm</td></tr>
<tr><td>M</td><td>30cm</td><td>42cm</td></tr>
<tr><td>L</td><td>35cm</td><td>48cm</td></tr>
<tr><td>XL</td><td>40cm</td><td>54cm</td></tr>
</table></div>`;
    
    await ebay.evaluate(async (desc, draftId) => {
      await fetch(`https://${location.host}/lstng/api/listing_draft/${draftId}?mode=AddItem`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc })
      });
    }, desc, draftId);
    console.log('Description PUT done');
    
    // Reload to show the description
    await ebay.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
  }
  
  // Step 3: Check for errors and fix
  console.log('\n=== Step 3: Final check ===');
  const bodyText = await ebay.evaluate(() => document.body.innerText);
  
  if (bodyText.includes('Looks like something is missing')) {
    const errorText = bodyText.substring(bodyText.indexOf('Looks like'), bodyText.indexOf('Looks like') + 200);
    console.log('Errors:', errorText);
  } else {
    console.log('No error banner');
  }
  
  // Check all sections
  const sections = ['PHOTOS', 'TITLE', 'VARIATIONS', 'DESCRIPTION', 'PRICING'];
  for (const s of sections) {
    const idx = bodyText.indexOf(s);
    if (idx > -1) {
      console.log(s + ':', bodyText.substring(idx, idx + 80).replace(/\n/g, ' '));
    }
  }
  
  await ebay.screenshot({ path: 'pre-submit.png' });
  
  // Step 4: Scroll to bottom and find List It button
  console.log('\n=== Step 4: Submit listing ===');
  await ebay.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1000);
  
  await ebay.screenshot({ path: 'pre-submit-bottom.png' });
  
  // Find and click the "List it" button
  const submitResult = await ebay.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    for (const b of btns) {
      const t = b.textContent.trim().toLowerCase();
      if (t.includes('list it') || t.includes('list item') || t === 'list') {
        b.click();
        return 'clicked: ' + b.textContent.trim();
      }
    }
    return 'not found. Buttons: ' + btns.filter(b => b.offsetParent).map(b => b.textContent.trim()).filter(t => t).join(' | ');
  });
  console.log('Submit:', submitResult);
  
  // Wait and check result
  await sleep(10000);
  const title = await ebay.title();
  console.log('Page title:', title);
  await ebay.screenshot({ path: 'after-submit.png' });
  
  if (title.includes('listing is now live') || (await ebay.evaluate(() => document.body.innerText)).includes('listing is now live')) {
    console.log('\n🎉 LISTING IS LIVE WITH VARIATIONS!');
    const itemId = await ebay.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/ID[-:]?\s*(\d{10,})/);
      return match ? match[1] : 'unknown';
    });
    console.log('Item ID:', itemId);
  } else {
    console.log('Listing not live yet, checking for errors...');
    const errorText = await ebay.evaluate(() => {
      const text = document.body.innerText;
      if (text.includes('Looks like')) {
        return text.substring(text.indexOf('Looks like'), text.indexOf('Looks like') + 300);
      }
      return text.substring(0, 500);
    });
    console.log('Error/state:', errorText);
  }
  
  browser.disconnect();
  console.log('\nDone');
})().catch(e => { console.error(e.message); process.exit(1); });
