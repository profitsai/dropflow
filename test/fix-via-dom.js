const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  
  // === UPC FIX: Click Edit on variations, find and clear UPC ===
  console.log('=== Clicking Edit on Variations ===');
  
  // Click the Edit button on variations section
  await ebayPage.evaluate(() => {
    const editBtn = document.querySelector('.summary__variations button[aria-label*="Edit"]');
    if (editBtn) editBtn.click();
    else console.log('No edit button found');
  });
  await new Promise(r => setTimeout(r, 3000));
  
  // Check what appeared after clicking Edit
  const afterEdit = await ebayPage.evaluate(() => {
    // Check for dialogs, modals, iframes
    const dialog = document.querySelector('.lightbox-dialog, [role="dialog"], .msku-dialog, .variation-editor');
    const iframes = document.querySelectorAll('iframe');
    const url = window.location.href;
    return {
      hasDialog: !!dialog,
      dialogClass: dialog?.className?.substring(0, 100),
      iframeCount: iframes.length,
      iframeSrcs: Array.from(iframes).map(f => f.src?.substring(0, 100)),
      currentUrl: url,
      bodyText: document.body.textContent.substring(0, 300)
    };
  });
  console.log('After Edit click:', JSON.stringify(afterEdit, null, 2));
  
  // Check if we're now on a different page (variation builder)
  await new Promise(r => setTimeout(r, 2000));
  const currentUrl = await ebayPage.url();
  console.log('Current URL:', currentUrl);
  
  // If we're on the variation builder page, look for UPC field
  const upcSearch = await ebayPage.evaluate(() => {
    const allInputs = document.querySelectorAll('input');
    const upcInputs = [];
    for (const inp of allInputs) {
      const ctx = inp.closest('tr, div, li')?.textContent?.substring(0, 100) || '';
      if (/upc|ean|isbn|gtin|barcode/i.test(ctx) || inp.value === '1') {
        upcInputs.push({
          value: inp.value,
          name: inp.name,
          placeholder: inp.placeholder,
          ariaLabel: inp.getAttribute('aria-label'),
          context: ctx.substring(0, 80)
        });
      }
    }
    return upcInputs;
  });
  console.log('UPC inputs found:', JSON.stringify(upcSearch, null, 2));
  
  // Look for any dialog/lightbox content
  const dialogContent = await ebayPage.evaluate(() => {
    const lightbox = document.querySelector('.lightbox-dialog__main, [role="dialog"]');
    if (lightbox) return lightbox.textContent.substring(0, 500);
    return 'no dialog found';
  });
  console.log('Dialog content:', dialogContent.substring(0, 300));
  
  // Screenshot
  await ebayPage.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/after-edit-click.png', fullPage: false });
  
  browser.disconnect();
})().catch(e => console.error(e));
