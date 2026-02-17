import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Search the main listing bundle for PhotosViewHelix handling
const result = await ebayPage.evaluate(async () => {
  const resp = await fetch('https://ir.ebaystatic.com/rs/c/fehelix/list_qAKT.4e655b28.js');
  const text = await resp.text();
  
  const results = [];
  
  // Search for PhotosViewHelix
  let idx = text.indexOf('PhotosViewHelix');
  while (idx > -1) {
    results.push({ label: 'PhotosViewHelix', ctx: text.substring(Math.max(0, idx - 300), idx + 500) });
    idx = text.indexOf('PhotosViewHelix', idx + 1);
    if (results.length >= 3) break;
  }
  
  // Search for photo-related Redux/Store actions
  for (const term of ['PHOTO_UPLOAD', 'ADD_PHOTO', 'SET_PHOTO', 'PHOTOS_UPDATE', 'photoAction', 'updatePhotos']) {
    idx = text.indexOf(term);
    if (idx > -1) {
      results.push({ label: term, ctx: text.substring(Math.max(0, idx - 200), idx + 300) });
    }
  }
  
  // Look for the photo component's render/input handling
  for (const term of ['photosInput', 'maxPhotoCount', 'photoExtractionEnabled']) {
    idx = text.indexOf(term);
    if (idx > -1) {
      results.push({ label: term, ctx: text.substring(Math.max(0, idx - 200), idx + 400) });
    }
  }
  
  return results;
});

for (const r of result) {
  console.log(`\n=== ${r.label} ===`);
  console.log(r.ctx.substring(0, 500));
}

browser.disconnect();
