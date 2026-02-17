const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  const draftId = new URL(ebayPage.url()).searchParams.get('draftId');
  
  const draft = await ebayPage.evaluate(async (id) => {
    const r = await fetch(`/lstng/api/listing_draft/${id}?mode=AddItem`, {credentials:'include'});
    return r.json();
  }, draftId);
  
  // Check every field that could hold photos
  const photos = draft.PHOTOS || {};
  const draftStr = JSON.stringify(draft);
  
  console.log('PHOTOS keys:', Object.keys(photos));
  console.log('PHOTOS pictureUrl:', photos.pictureUrl);
  console.log('PHOTOS pictures:', photos.pictures);
  
  // Search for ebayimg
  const ebayImgMatches = draftStr.match(/ebayimg\.com[^"']*/g);
  console.log('ebayimg URLs in full draft:', ebayImgMatches);
  
  // Check if photos section has error indicators
  const photoError = await ebayPage.evaluate(() => {
    const photoSection = document.querySelector('.summary__photos');
    if (!photoSection) return 'no photo section';
    return {
      hasError: photoSection.classList.contains('summary--error'),
      classes: photoSection.className,
      text: photoSection.textContent.substring(0, 300)
    };
  });
  console.log('Photo section DOM:', JSON.stringify(photoError));
  
  // Check if the variation photos need uploading (the "Upload photos" text in variations)
  const varPhotos = await ebayPage.evaluate(() => {
    const varSection = document.querySelector('.summary__variations');
    if (!varSection) return 'no var section';
    const text = varSection.textContent;
    return text.includes('Upload photos') ? 'variation photos needed' : 'variation photos OK';
  });
  console.log('Variation photos:', varPhotos);
  
  browser.disconnect();
})().catch(e => console.error(e));
