const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  
  // Wait for iframe to load
  await new Promise(r => setTimeout(r, 3000));
  
  // Get all frames
  const frames = ebayPage.frames();
  console.log('Frames:', frames.map(f => f.url().substring(0, 100)));
  
  const bulkFrame = frames.find(f => f.url().includes('bulkedit'));
  if (!bulkFrame) {
    console.log('No bulkedit frame found');
    browser.disconnect();
    return;
  }
  
  console.log('Found bulkedit frame:', bulkFrame.url().substring(0, 120));
  
  // Wait for frame to be ready
  await new Promise(r => setTimeout(r, 3000));
  
  // Look for UPC field in the iframe
  const iframeContent = await bulkFrame.evaluate(() => {
    // Search for UPC/identifier fields
    const allInputs = document.querySelectorAll('input');
    const results = [];
    for (const inp of allInputs) {
      const row = inp.closest('tr, div, li, [class*="row"]');
      const ctx = row ? row.textContent.substring(0, 100) : '';
      if (/upc|ean|isbn|gtin|barcode|identifier/i.test(ctx) || inp.value === '1') {
        results.push({
          value: inp.value,
          name: inp.name,
          id: inp.id,
          ariaLabel: inp.getAttribute('aria-label'),
          placeholder: inp.placeholder,
          context: ctx.substring(0, 80)
        });
      }
    }
    
    // Also get page structure
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,button,label')).map(e => e.textContent.trim()).filter(t => t.length < 50 && t.length > 0).slice(0, 20);
    
    return { upcInputs: results, headings, bodyText: document.body?.textContent?.substring(0, 500) };
  }).catch(e => ({ error: e.message }));
  
  console.log('Iframe content:', JSON.stringify(iframeContent, null, 2));
  
  // Screenshot the iframe content area
  await ebayPage.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/msku-dialog.png', fullPage: false });
  
  browser.disconnect();
})().catch(e => console.error(e));
