import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Let me look more carefully at the Helix photo component code to understand the upload flow
const code = await ebayPage.evaluate(async () => {
  const resp = await fetch('https://ir.ebaystatic.com/rs/c/fehelix/list_qAKT.4e655b28.js');
  const text = await resp.text();
  
  // Find HANDLE_PHOTO_UPLOAD handler
  const idx = text.indexOf('HANDLE_PHOTO_UPLOAD');
  if (idx > -1) {
    // Find the function body
    return text.substring(Math.max(0, idx - 100), idx + 500);
  }
  return null;
});

console.log('HANDLE_PHOTO_UPLOAD:', code?.substring(0, 500));

// Search for the actual Aq function (HANDLE_PHOTO_UPLOAD handler)
const handlerCode = await ebayPage.evaluate(async () => {
  const resp = await fetch('https://ir.ebaystatic.com/rs/c/fehelix/list_qAKT.4e655b28.js');
  const text = await resp.text();
  
  // Find Aq which is the HANDLE_PHOTO_UPLOAD handler
  // Search for patterns like "const Aq=" or "Aq="
  const results = [];
  
  // Search for UPDATE_FILES handler (hq)
  let idx = text.indexOf('UPDATE_FILES');
  if (idx > -1) {
    results.push({ label: 'UPDATE_FILES', ctx: text.substring(Math.max(0, idx - 200), idx + 500) });
  }
  
  // Search for SET_FILES_AFTER_UPLOAD
  idx = text.indexOf('SET_FILES_AFTER_UPLO');
  if (idx > -1) {
    results.push({ label: 'SET_FILES_AFTER_UPLOAD', ctx: text.substring(idx, idx + 800) });
  }
  
  // Search for how web import works - "Import from web" 
  idx = text.indexOf('importFromWeb');
  if (idx === -1) idx = text.indexOf('ImportFromWeb');
  if (idx === -1) idx = text.indexOf('IMPORT_FROM_WEB');
  if (idx === -1) idx = text.indexOf('import_from_web');
  if (idx > -1) {
    results.push({ label: 'importFromWeb', ctx: text.substring(Math.max(0, idx - 200), idx + 500) });
  }
  
  // Search for "externalImageUrl" or "fromWeb"
  idx = text.indexOf('externalImageUrl');
  if (idx === -1) idx = text.indexOf('fromWeb');
  if (idx === -1) idx = text.indexOf('FROM_WEB');
  if (idx > -1) {
    results.push({ label: 'fromWeb', ctx: text.substring(Math.max(0, idx - 200), idx + 500) });
  }
  
  return results;
});

for (const r of handlerCode) {
  console.log(`\n=== ${r.label} ===`);
  console.log(r.ctx.substring(0, 600));
}

browser.disconnect();
