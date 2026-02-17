const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  
  // Open variation editor
  await ebayPage.evaluate(() => {
    const editBtn = document.querySelector('.summary__variations button[aria-label*="Edit"]');
    if (editBtn) editBtn.click();
  });
  await new Promise(r => setTimeout(r, 5000));
  
  const frames = ebayPage.frames();
  const bulkFrame = frames.find(f => f.url().includes('bulkedit'));
  if (!bulkFrame) { console.log('No bulkedit frame'); browser.disconnect(); return; }
  
  // Explore UPC cell structure in detail
  const upcCellDetail = await bulkFrame.evaluate(() => {
    const table = document.querySelector('table');
    const firstRow = table?.querySelector('tbody tr');
    if (!firstRow) return 'no row';
    const cells = firstRow.querySelectorAll('td');
    const upcCell = cells[4];
    return {
      innerHTML: upcCell.innerHTML,
      checkboxes: Array.from(upcCell.querySelectorAll('input[type="checkbox"]')).map(cb => ({
        checked: cb.checked,
        id: cb.id,
        name: cb.name,
        className: cb.className
      })),
      labels: Array.from(upcCell.querySelectorAll('label')).map(l => ({ 
        text: l.textContent.trim(),
        htmlFor: l.htmlFor
      })),
      spans: Array.from(upcCell.querySelectorAll('span')).map(s => s.textContent.trim()).filter(t => t)
    };
  });
  console.log('UPC cell detail:', JSON.stringify(upcCellDetail, null, 2));
  
  // Click ALL "Does not apply" checkboxes in UPC column
  const dnaResult = await bulkFrame.evaluate(() => {
    const table = document.querySelector('table');
    const rows = table?.querySelectorAll('tbody tr') || [];
    let checked = 0;
    
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 5) continue;
      const upcCell = cells[4];
      
      // Find checkbox in UPC cell
      const cb = upcCell.querySelector('input[type="checkbox"]');
      if (cb) {
        if (!cb.checked) {
          cb.click();
          checked++;
        } else {
          // Already checked
        }
      }
      
      // Also try clicking label text
      const labels = upcCell.querySelectorAll('label, span');
      for (const label of labels) {
        if (/does not apply/i.test(label.textContent)) {
          label.click();
        }
      }
    }
    return { checked, totalRows: rows.length };
  });
  console.log('DNA checkbox result:', dnaResult);
  
  await new Promise(r => setTimeout(r, 1000));
  
  // Verify
  const verifyDna = await bulkFrame.evaluate(() => {
    const table = document.querySelector('table');
    const rows = table?.querySelectorAll('tbody tr') || [];
    const results = [];
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 5) continue;
      const upcCell = cells[4];
      const cb = upcCell.querySelector('input[type="checkbox"]');
      const inp = upcCell.querySelector('input[type="text"]');
      results.push({
        cbChecked: cb?.checked,
        inputValue: inp?.value,
        inputDisabled: inp?.disabled
      });
    }
    return results;
  });
  console.log('After DNA:', JSON.stringify(verifyDna));
  
  // Save and close
  await new Promise(r => setTimeout(r, 500));
  await bulkFrame.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /save/i.test(b.textContent.trim()));
    if (btn) btn.click();
  });
  
  await new Promise(r => setTimeout(r, 5000));
  
  // Final check
  const errors = await ebayPage.evaluate(() => {
    return Array.from(document.querySelectorAll('.summary--error'))
      .map(e => e.textContent.substring(0, 200));
  });
  console.log('\nFinal errors:', errors.length > 0 ? errors : 'NONE! 🎉');
  
  browser.disconnect();
})().catch(e => console.error(e));
