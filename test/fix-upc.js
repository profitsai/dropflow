const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  if (!ebay) { console.error('No eBay page'); process.exit(1); }
  
  // Click the "Variations" link in the error banner to scroll to it
  console.log('Clicking Variations error link...');
  await ebay.evaluate(() => {
    const links = document.querySelectorAll('a');
    for (const l of links) {
      if (l.textContent.trim() === 'Variations') {
        l.click();
        return;
      }
    }
  });
  await sleep(1000);
  
  // Scroll to VARIATIONS section
  await ebay.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      if (el.textContent.trim() === 'VARIATIONS' && el.children.length === 0) {
        el.scrollIntoView({ block: 'center' });
        return;
      }
    }
  });
  await sleep(500);
  await ebay.screenshot({ path: 'var-error-section.png' });
  
  // Click Edit on variations
  console.log('Clicking Edit...');
  await ebay.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      if (el.textContent.trim() === 'VARIATIONS') {
        let container = el.parentElement;
        for (let i = 0; i < 5; i++) {
          if (!container) break;
          const editBtns = container.querySelectorAll('a, button');
          for (const b of editBtns) {
            if (b.textContent.trim() === 'Edit') {
              b.click();
              return;
            }
          }
          container = container.parentElement;
        }
      }
    }
  });
  await sleep(5000);
  
  let bf = ebay.frames().find(f => f.url().includes('bulkedit'));
  if (!bf) {
    console.log('Waiting more for bulkedit frame...');
    await sleep(5000);
    bf = ebay.frames().find(f => f.url().includes('bulkedit'));
  }
  
  if (!bf) {
    console.error('No bulkedit frame');
    ebay.frames().forEach(f => console.log('Frame:', f.url().substring(0, 80)));
    process.exit(1);
  }
  
  console.log('Found bulkedit frame');
  await sleep(2000);
  
  // Wait for grid to load
  let gridReady = false;
  for (let i = 0; i < 10; i++) {
    const hasTable = await bf.evaluate(() => !!document.querySelector('table'));
    if (hasTable) { gridReady = true; break; }
    await sleep(1000);
  }
  
  if (!gridReady) {
    console.log('Grid not ready');
    const text = await bf.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('Frame text:', text);
    process.exit(1);
  }
  
  // Analyze the grid columns
  console.log('\n=== Analyzing grid ===');
  const analysis = await bf.evaluate(() => {
    const table = document.querySelector('table');
    const headerRow = table.querySelector('tr');
    const headers = [...headerRow.querySelectorAll('th, td')].map(c => c.textContent.trim());
    
    const dataRows = [...table.querySelectorAll('tr')].slice(1);
    const firstRow = dataRows[0];
    if (!firstRow) return { headers, error: 'no data rows' };
    
    const cells = [...firstRow.querySelectorAll('td')];
    const cellInfo = cells.map((td, idx) => {
      const input = td.querySelector('input[type="text"]');
      return {
        idx,
        header: headers[idx] || '?',
        hasInput: !!input,
        value: input?.value || td.textContent.trim().substring(0, 20)
      };
    });
    
    return { headers, cellInfo, rowCount: dataRows.length };
  });
  console.log('Grid analysis:', JSON.stringify(analysis, null, 2));
  
  // Clear UPC column values
  console.log('\n=== Clearing UPC values ===');
  const clearResult = await bf.evaluate(() => {
    const table = document.querySelector('table');
    const headerRow = table.querySelector('tr');
    const headers = [...headerRow.querySelectorAll('th, td')].map(c => c.textContent.trim());
    
    // Find UPC column index
    const upcIdx = headers.findIndex(h => h.toLowerCase().includes('upc'));
    if (upcIdx === -1) return { error: 'UPC column not found', headers };
    
    const dataRows = [...table.querySelectorAll('tr')].slice(1);
    let cleared = 0;
    
    for (const row of dataRows) {
      const cells = [...row.querySelectorAll('td')];
      if (cells[upcIdx]) {
        const input = cells[upcIdx].querySelector('input[type="text"]');
        if (input && input.value) {
          input.focus();
          const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          ns.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
          cleared++;
        }
      }
    }
    
    return { upcIdx, cleared };
  });
  console.log('Clear result:', JSON.stringify(clearResult));
  
  // Also verify prices and quantities
  const verify = await bf.evaluate(() => {
    const table = document.querySelector('table');
    const headerRow = table.querySelector('tr');
    const headers = [...headerRow.querySelectorAll('th, td')].map(c => c.textContent.trim());
    
    const priceIdx = headers.findIndex(h => h.toLowerCase().includes('price'));
    const qtyIdx = headers.findIndex(h => h.toLowerCase().includes('quantity') || h.toLowerCase().includes('qty'));
    const upcIdx = headers.findIndex(h => h.toLowerCase().includes('upc'));
    
    const dataRows = [...table.querySelectorAll('tr')].slice(1);
    const rowSummary = [];
    
    for (const row of dataRows) {
      const cells = [...row.querySelectorAll('td')];
      const getVal = (idx) => {
        if (idx < 0 || !cells[idx]) return 'n/a';
        const input = cells[idx].querySelector('input[type="text"]');
        return input ? input.value : cells[idx].textContent.trim().substring(0, 15);
      };
      rowSummary.push({ price: getVal(priceIdx), qty: getVal(qtyIdx), upc: getVal(upcIdx) });
    }
    
    return { priceIdx, qtyIdx, upcIdx, rows: rowSummary.slice(0, 3), totalRows: rowSummary.length };
  });
  console.log('Verify:', JSON.stringify(verify, null, 2));
  
  // If prices are empty, fill them
  if (!verify.rows[0]?.price || verify.rows[0]?.price === '') {
    console.log('Filling prices...');
    await bf.evaluate((priceIdx, qtyIdx) => {
      const table = document.querySelector('table');
      const dataRows = [...table.querySelectorAll('tr')].slice(1);
      const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      
      for (const row of dataRows) {
        const cells = [...row.querySelectorAll('td')];
        
        if (priceIdx >= 0 && cells[priceIdx]) {
          const input = cells[priceIdx].querySelector('input[type="text"]');
          if (input && (!input.value || input.value === '')) {
            input.focus();
            ns.call(input, '24.99');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
          }
        }
        
        if (qtyIdx >= 0 && cells[qtyIdx]) {
          const input = cells[qtyIdx].querySelector('input[type="text"]');
          if (input && (!input.value || input.value === '' || input.value === '0')) {
            input.focus();
            ns.call(input, '5');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
          }
        }
      }
    }, verify.priceIdx, verify.qtyIdx);
  }
  
  await sleep(1000);
  await ebay.screenshot({ path: 'var-grid-fixed.png' });
  
  // Save and close
  console.log('\n=== Save and close ===');
  await bf.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim() === 'Save and close' && b.offsetParent !== null) {
        b.click(); return;
      }
    }
  });
  await sleep(5000);
  
  // Check main page
  const mainText = await ebay.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('\nMain page:', mainText.substring(0, 300));
  
  // Check if error is gone
  const hasError = mainText.includes('Looks like something is missing');
  console.log('Has error:', hasError);
  
  if (!hasError) {
    // Try submitting again
    console.log('\n=== Submitting ===');
    await ebay.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1000);
    
    await ebay.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.trim().toLowerCase().includes('list it')) {
          b.click(); return;
        }
      }
    });
    
    await sleep(10000);
    
    const result = await ebay.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('Result:', result.substring(0, 300));
    await ebay.screenshot({ path: 'submit-result.png' });
  }
  
  browser.disconnect();
  console.log('\nDone');
})().catch(e => { console.error(e.message); process.exit(1); });
