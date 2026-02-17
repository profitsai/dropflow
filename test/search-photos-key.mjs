import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Search for PHOTOS_KEY value
const result = await ebayPage.evaluate(async () => {
  const resp = await fetch('https://ir.ebaystatic.com/rs/c/fehelix/list_qAKT.4e655b28.js');
  const text = await resp.text();
  
  // Search for PHOTOS_KEY definition
  const results = [];
  for (const term of ['PHOTOS_KEY', 'photosKey', 'photos_key']) {
    let idx = text.indexOf(term);
    while (idx > -1) {
      results.push({ term, ctx: text.substring(Math.max(0, idx - 100), idx + 200) });
      idx = text.indexOf(term, idx + 1);
      if (results.length >= 5) break;
    }
  }
  
  // Search for what's emitted in updatePhotos - specifically the DELTA_CHANGE event
  // iS = DELTA_CHANGE
  let idx = text.indexOf('updatePhotos');
  if (idx > -1) {
    const ctx = text.substring(idx, idx + 500);
    results.push({ term: 'updatePhotos', ctx });
  }
  
  return results;
});

for (const r of result) {
  console.log(`=== ${r.term} ===`);
  console.log(r.ctx.substring(0, 300));
  console.log('---');
}

browser.disconnect();
