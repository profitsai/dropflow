const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  
  // First check if dialog is still open
  const dialogOpen = await ebayPage.evaluate(() => !!document.querySelector('.msku-dialog'));
  console.log('MSKU dialog open:', dialogOpen);
  
  if (!dialogOpen) {
    // Re-open it
    await ebayPage.evaluate(() => {
      const editBtn = document.querySelector('.summary__variations button[aria-label*="Edit"]');
      if (editBtn) editBtn.click();
    });
    await new Promise(r => setTimeout(r, 5000));
  }
  
  const frames = ebayPage.frames();
  const bulkFrame = frames.find(f => f.url().includes('bulkedit'));
  if (!bulkFrame) { console.log('No bulkedit frame'); browser.disconnect(); return; }
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Clear ALL UPC fields by column position (column 4)
  const result = await bulkFrame.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return { error: 'no table' };
    
    const rows = table.querySelectorAll('tbody tr');
    let cleared = 0;
    let dnaChecked = 0;
    
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 5) continue;
      
      const upcCell = cells[4]; // UPC column
      if (!upcCell) continue;
      
      // Find and clear the UPC input
      const upcInput = upcCell.querySelector('input[type="text"]');
      if (upcInput && upcInput.value && upcInput.value !== '') {
        console.log('Clearing UPC value:', upcInput.value);
        
        // Focus, clear, blur - React-compatible
        upcInput.focus();
        upcInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(upcInput, '');
        else upcInput.value = '';
        
        upcInput.dispatchEvent(new Event('input', { bubbles: true }));
        upcInput.dispatchEvent(new Event('change', { bubbles: true }));
        upcInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        upcInput.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
        upcInput.blur();
        cleared++;
      }
      
      // Also check the "Does not apply" checkbox in this cell
      const checkbox = upcCell.querySelector('input[type="checkbox"]');
      if (checkbox && !checkbox.checked) {
        checkbox.click();
        dnaChecked++;
      }
    }
    
    return { rowCount: rows.length, cleared, dnaChecked };
  });
  console.log('UPC clear result:', result);
  
  await new Promise(r => setTimeout(r, 1000));
  
  // Verify UPC fields are empty
  const verify = await bulkFrame.evaluate(() => {
    const table = document.querySelector('table');
    const rows = table.querySelectorAll('tbody tr');
    const upcValues = [];
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 5) continue;
      const upcInput = cells[4]?.querySelector('input[type="text"]');
      if (upcInput) upcValues.push(upcInput.value);
    }
    return upcValues;
  });
  console.log('UPC values after clear:', verify);
  
  // Now also upload default photos via the builder's photo upload
  // Check for "Add default photos" section
  const photoSection = await bulkFrame.evaluate(() => {
    const text = document.body.textContent;
    const hasDefaultPhotos = text.includes('Add default photos');
    const hasPhotoUpload = !!document.querySelector('input[type="file"]');
    const fileInputAccept = document.querySelector('input[type="file"]')?.accept;
    return { hasDefaultPhotos, hasPhotoUpload, fileInputAccept };
  });
  console.log('Photo section in builder:', photoSection);
  
  // Click Save button
  await new Promise(r => setTimeout(r, 500));
  const saveResult = await bulkFrame.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const saveBtn = buttons.find(b => /save/i.test(b.textContent.trim()) && b.offsetParent !== null);
    if (saveBtn) {
      saveBtn.click();
      return 'Clicked: ' + saveBtn.textContent.trim();
    }
    return 'No save button found';
  });
  console.log('Save:', saveResult);
  
  // Wait for dialog to close
  await new Promise(r => setTimeout(r, 5000));
  
  // Check final state
  const errors = await ebayPage.evaluate(() => {
    return Array.from(document.querySelectorAll('.summary--error'))
      .map(e => e.textContent.substring(0, 200));
  });
  console.log('\nFinal errors:', errors.length > 0 ? errors : 'NONE! 🎉');
  
  browser.disconnect();
})().catch(e => console.error(e));
