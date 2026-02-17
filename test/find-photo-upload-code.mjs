import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const result = await ebayPage.evaluate(async () => {
  const resp = await fetch('https://ir.ebaystatic.com/rs/c/fehelix/595.296de6c9.js');
  const text = await resp.text();
  
  // Find the photo uploader class - it creates an XHR to EPS
  // Search for "uploadToEPS" or photo-specific upload
  const searches = [
    'uploadToEps', 'uploadToEPS', 'epsUpload', 'EpsUpload',
    'srt', // EPS uses 'srt' (session-related token)
    'IMAGEFILE', 'imagefile', // Possible field name
  ];
  
  const results = [];
  for (const term of searches) {
    let idx = text.indexOf(term);
    if (idx > -1) {
      results.push({ term, context: text.substring(Math.max(0, idx - 300), idx + 500) });
    }
  }
  
  // Also search for the XHR-based uploader that eBay uses for images
  // eBay's EPS uploader traditionally uses XMLHttpRequest with multipart/form-data
  let idx = text.indexOf('XMLHttpRequest');
  while (idx > -1) {
    const ctx = text.substring(Math.max(0, idx - 500), idx + 1500);
    if (ctx.includes('upload') || ctx.includes('photo') || ctx.includes('image') || ctx.includes('EPS')) {
      results.push({ term: 'XMLHttpRequest near upload', context: ctx.substring(0, 1000) });
      break;
    }
    idx = text.indexOf('XMLHttpRequest', idx + 1);
  }
  
  return results;
});

for (const r of result) {
  console.log(`\n=== ${r.term} ===`);
  console.log(r.context.substring(0, 600));
}

browser.disconnect();
