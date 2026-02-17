import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Search the JS for what happens after EPS upload success
// Look for how the uploaded URL is saved/associated with the draft
const result = await ebayPage.evaluate(async () => {
  const resp = await fetch('https://ir.ebaystatic.com/rs/c/fehelix/595.296de6c9.js');
  const text = await resp.text();
  
  const results = [];
  
  // Search for "upload-success" event handler
  let idx = text.indexOf('upload-success');
  if (idx > -1) {
    results.push({ label: 'upload-success', ctx: text.substring(Math.max(0, idx - 200), idx + 800) });
  }
  
  // Search for the function that handles EPS response (parsing "VERSION:2;url")
  idx = text.indexOf('VERSION:');
  if (idx === -1) idx = text.indexOf('VERSION');
  if (idx > -1) {
    results.push({ label: 'VERSION', ctx: text.substring(Math.max(0, idx - 500), idx + 500) });
  }
  
  // Search for "picurl" or "pictureUrl" handling after upload
  idx = text.indexOf('picurl');
  if (idx === -1) idx = text.indexOf('pictureUrl');
  if (idx > -1) {
    results.push({ label: 'picurl', ctx: text.substring(Math.max(0, idx - 200), idx + 500) });
  }
  
  // Search for how the photo is associated with draft - "saveDraft" or "updateDraft" near photo
  for (const term of ['saveDraft', 'updateDraft', 'SAVE_DRAFT', 'UPDATE_DRAFT', 'draftUpdate']) {
    idx = text.indexOf(term);
    if (idx > -1) {
      const ctx = text.substring(Math.max(0, idx - 200), idx + 300);
      if (ctx.includes('photo') || ctx.includes('image') || ctx.includes('picture')) {
        results.push({ label: term, ctx });
      }
    }
  }
  
  // Search for the Marko component that handles photo state
  idx = text.indexOf('setFileAndOrder');
  if (idx > -1) {
    results.push({ label: 'setFileAndOrder', ctx: text.substring(Math.max(0, idx - 300), idx + 800) });
  }
  
  return results;
});

for (const r of result) {
  console.log(`\n=== ${r.label} ===`);
  console.log(r.ctx.substring(0, 600));
}

browser.disconnect();
