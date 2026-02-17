const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  const draftId = new URL(ebayPage.url()).searchParams.get('draftId');
  
  // Get full draft data for PHOTOS and VARIATIONS
  const draft = await ebayPage.evaluate(async (draftId) => {
    const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
    return resp.json();
  }, draftId);
  
  // Check photos
  const photos = draft.PHOTOS || {};
  console.log('PHOTOS pictureUrl:', photos.pictureUrl || photos.pictures || 'none');
  console.log('PHOTOS images:', photos.images || 'none');
  
  // Check for any image-related fields
  const draftStr = JSON.stringify(draft);
  const imgMatches = draftStr.match(/ebayimg\.com[^"']*/g);
  console.log('eBay images in draft:', imgMatches || 'none');
  
  // Check variations for UPC
  const vars = draft.VARIATIONS || {};
  console.log('\nVariation errors:', JSON.stringify(vars.errorMessages));
  
  // Check if there's a productDetails or identifiers in variations
  const varStr = JSON.stringify(vars);
  const upcIdx = varStr.toLowerCase().indexOf('upc');
  if (upcIdx >= 0) console.log('UPC context:', varStr.substring(Math.max(0,upcIdx-50), upcIdx+100));
  
  // Look for photos-related fields more broadly
  const allPhotos = draftStr.match(/"picture[^"]*":/gi);
  console.log('\nPicture fields in draft:', allPhotos || 'none');
  
  // Check if the variation has per-variation UPC
  for (let i = 0; i < Math.min(vars.variations?.length || 0, 2); i++) {
    console.log(`\nVariation ${i}:`, JSON.stringify(vars.variations[i]));
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
