const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  
  const frames = ebayPage.frames();
  const bulkFrame = frames.find(f => f.url().includes('bulkedit'));
  if (!bulkFrame) { console.log('No bulkedit frame'); browser.disconnect(); return; }
  
  // Get table structure with column headers
  const tableInfo = await bulkFrame.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return 'no table';
    
    // Get headers
    const headers = Array.from(table.querySelectorAll('thead th, thead td')).map(th => th.textContent.trim());
    
    // Get first data row details
    const firstRow = table.querySelector('tbody tr');
    if (!firstRow) return { headers, noRows: true };
    
    const cells = Array.from(firstRow.querySelectorAll('td'));
    const cellDetails = cells.map((td, i) => {
      const inputs = Array.from(td.querySelectorAll('input'));
      return {
        index: i,
        text: td.textContent.substring(0, 50).trim(),
        inputs: inputs.map(inp => ({
          type: inp.type,
          name: inp.name,
          value: inp.value,
          placeholder: inp.placeholder,
          ariaLabel: inp.getAttribute('aria-label'),
          className: inp.className.substring(0, 50)
        }))
      };
    });
    
    return { headers, cells: cellDetails };
  });
  console.log('Table structure:', JSON.stringify(tableInfo, null, 2));
  
  // Now find and clear all UPC fields (the ones with placeholder "Enter UPC/EAN/ISBN")
  const clearResult = await bulkFrame.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    let cleared = 0;
    for (const inp of inputs) {
      const ph = (inp.placeholder || '').toLowerCase();
      const ariaLabel = (inp.getAttribute('aria-label') || '').toLowerCase();
      const cellText = (inp.closest('td')?.textContent || '').toLowerCase();
      
      if (/upc|ean|isbn/i.test(ph) || /upc|ean|isbn/i.test(ariaLabel) || /enter upc/i.test(cellText)) {
        if (inp.value && inp.value !== '' && inp.value !== 'Does not apply') {
          console.log('Clearing UPC input: value=' + inp.value);
          // Use React-compatible value setting
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (nativeSetter) nativeSetter.call(inp, '');
          else inp.value = '';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          inp.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
          cleared++;
        }
      }
    }
    
    // Also check for "Does not apply" checkboxes next to UPC fields
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    let dnaClicked = 0;
    for (const cb of checkboxes) {
      const ctx = (cb.closest('td')?.textContent || '').toLowerCase();
      if (/does not apply/i.test(ctx) && /upc|ean|isbn/i.test(ctx)) {
        if (!cb.checked) {
          cb.click();
          dnaClicked++;
        }
      }
    }
    
    return { cleared, dnaClicked };
  });
  console.log('UPC clear result:', clearResult);
  
  // Also try clicking "Does not apply" for each UPC row
  const dnaResult = await bulkFrame.evaluate(() => {
    // Find all "Does not apply" elements
    const dnaElements = Array.from(document.querySelectorAll('*')).filter(e => 
      e.textContent.trim() === 'Does not apply' && e.offsetParent !== null
    );
    console.log('Found', dnaElements.length, 'DNA elements');
    let clicked = 0;
    for (const el of dnaElements) {
      // Check if it's a checkbox label or link
      const checkbox = el.querySelector('input[type="checkbox"]') || el.closest('label')?.querySelector('input[type="checkbox"]');
      if (checkbox && !checkbox.checked) {
        checkbox.click();
        clicked++;
      }
    }
    return { dnaCount: dnaElements.length, clicked };
  });
  console.log('DNA click result:', dnaResult);
  
  // Now click "Save and close"
  await new Promise(r => setTimeout(r, 1000));
  const saveResult = await bulkFrame.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const saveBtn = buttons.find(b => /save and close|save/i.test(b.textContent.trim()));
    if (saveBtn) {
      saveBtn.click();
      return 'Clicked: ' + saveBtn.textContent.trim();
    }
    return 'No save button found. Buttons: ' + buttons.map(b => b.textContent.trim().substring(0, 30)).join(', ');
  });
  console.log('Save result:', saveResult);
  
  await new Promise(r => setTimeout(r, 5000));
  
  // Check if dialog closed and errors resolved
  const finalErrors = await ebayPage.evaluate(() => {
    return Array.from(document.querySelectorAll('.summary--error'))
      .map(e => e.textContent.substring(0, 200));
  });
  console.log('Final errors:', finalErrors.length > 0 ? finalErrors : 'NONE! 🎉');
  
  browser.disconnect();
})().catch(e => console.error(e));
