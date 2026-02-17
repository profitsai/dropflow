import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// The DELTA_CHANGE event sends {name: PHOTOS_KEY, value: urls[]} to a handler
// This handler calls a Redux-like action which PUTs to the draft API
// Let me find the actual API call format by looking at the delta handler

const result = await ebayPage.evaluate(async () => {
  const resp = await fetch('https://ir.ebaystatic.com/rs/c/fehelix/list_qAKT.4e655b28.js');
  const text = await resp.text();
  
  // Search for the function that handles delta changes and sends to API
  const results = [];
  
  // Find "deltaUpdate" or "saveDelta" or the API call
  for (const term of ['deltaChange', 'delta_change', 'delta-change', 'saveDelta', 'DELTA', 
                        'updateDraftPhotos', 'listing_draft']) {
    let idx = text.indexOf(term);
    if (idx > -1 && !results.some(r => Math.abs(r.idx - idx) < 100)) {
      results.push({ term, idx, ctx: text.substring(Math.max(0, idx - 100), idx + 400) });
    }
  }
  
  // Search for the PUT/POST call format for photos
  // Look for fetch calls near "photos" or "PHOTOS"
  let idx = 0;
  while (true) {
    idx = text.indexOf('listing_draft', idx + 1);
    if (idx === -1) break;
    const ctx = text.substring(Math.max(0, idx - 200), idx + 400);
    if (ctx.includes('photo') || ctx.includes('PHOTO') || ctx.includes('picture')) {
      results.push({ term: 'listing_draft+photo', idx, ctx });
      break;
    }
  }
  
  return results;
});

for (const r of result) {
  console.log(`\n=== ${r.term} ===`);
  console.log(r.ctx.substring(0, 500));
}

browser.disconnect();
