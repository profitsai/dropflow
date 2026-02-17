const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  const draftId = new URL(ebayPage.url()).searchParams.get('draftId');
  
  // Reload to get fresh state
  await ebayPage.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  
  // Get complete status
  const status = await ebayPage.evaluate(async (id) => {
    // Draft API
    const draft = await fetch(`/lstng/api/listing_draft/${id}?mode=AddItem`, {credentials:'include'}).then(r=>r.json());
    
    // Errors
    const errors = Array.from(document.querySelectorAll('.summary--error'))
      .map(e => e.className.replace('smry summary--error ', '') + ': ' + e.textContent.substring(0, 150));
    
    // Condition
    const condition = document.querySelector('#summary-condition-field-value')?.textContent?.trim();
    
    // Photos in variations section
    const varSection = document.querySelector('.summary__variations');
    const varText = varSection?.textContent || '';
    const photosMatch = varText.match(/(\d+)\s*photo/i);
    const varPhotosCount = photosMatch ? parseInt(photosMatch[1]) : 0;
    
    // Main photos section
    const photoSection = document.querySelector('.summary__photos');
    const photoError = photoSection?.classList.contains('summary--error');
    
    // Pricing
    const vars = draft.VARIATIONS?.variations || [];
    const prices = vars.map(v => v.fixedPrice);
    const uniquePrices = [...new Set(prices)];
    
    // Photos in draft
    const draftStr = JSON.stringify(draft);
    const ebayImgCount = (draftStr.match(/ebayimg\.com/g) || []).length;
    
    // UPC errors
    const varErrors = draft.VARIATIONS?.errorMessages || [];
    
    return {
      draftId: id,
      errors,
      condition,
      photoError,
      variationPhotos: varPhotosCount,
      ebayImagesInDraft: ebayImgCount,
      variationCount: vars.length,
      priceRange: prices.length > 0 ? `$${Math.min(...prices)} - $${Math.max(...prices)}` : 'none',
      uniquePriceCount: uniquePrices.length,
      variationErrors: varErrors.map(e => e.message?.textSpans?.[0]?.text || 'unknown'),
      variationsCompleted: draft.VARIATIONS?.variationsCompleted
    };
  }, draftId);
  
  console.log('\n========================================');
  console.log('  FINAL STATUS REPORT');
  console.log('========================================');
  console.log(`Draft ID: ${status.draftId}`);
  console.log(`\n--- CONDITION ---`);
  console.log(`  Value: ${status.condition} ${status.condition === 'Brand New' ? '✅' : '❌'}`);
  console.log(`\n--- PHOTOS ---`);
  console.log(`  Main section error: ${status.photoError ? '❌' : '✅ No error'}`);
  console.log(`  Variation photos: ${status.variationPhotos} ${status.variationPhotos > 0 ? '✅' : '⚠️'}`);
  console.log(`  eBay images in draft: ${status.ebayImagesInDraft}`);
  console.log(`\n--- VARIATIONS ---`);
  console.log(`  Count: ${status.variationCount}`);
  console.log(`  Completed: ${status.variationsCompleted ? '✅' : '❌'}`);
  console.log(`  Price range: ${status.priceRange} ${status.uniquePriceCount > 1 ? '✅ Per-variant pricing' : '⚠️ Flat pricing'}`);
  console.log(`  Unique prices: ${status.uniquePriceCount}`);
  console.log(`  Errors: ${status.variationErrors.length === 0 ? 'NONE ✅' : status.variationErrors.join(', ')}`);
  console.log(`\n--- PAGE ERRORS ---`);
  console.log(`  ${status.errors.length === 0 ? 'NONE ✅' : status.errors.join('\n  ')}`);
  console.log('========================================\n');
  
  await ebayPage.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/FINAL-STATE.png', fullPage: false });
  
  browser.disconnect();
})().catch(e => console.error(e));
