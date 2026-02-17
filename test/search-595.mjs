import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const result = await ebayPage.evaluate(async () => {
  const resp = await fetch('https://ir.ebaystatic.com/rs/c/fehelix/595.296de6c9.js');
  const text = await resp.text();
  
  const results = [];
  
  // Find EpsBasic context
  let idx = text.indexOf('EpsBasic');
  if (idx > -1) {
    results.push({ label: 'EpsBasic', context: text.substring(Math.max(0, idx - 800), idx + 800) });
  }
  
  // Find FormData with photo/image
  idx = 0;
  while (true) {
    idx = text.indexOf('new FormData', idx + 1);
    if (idx === -1) break;
    const ctx = text.substring(idx, Math.min(text.length, idx + 500));
    if (!ctx.includes('videoFile')) {
      results.push({ label: 'FormData', context: text.substring(Math.max(0, idx - 100), idx + 500) });
      break;
    }
  }
  
  // Search for the upload function that posts to EPS
  idx = text.indexOf('uploadType');
  if (idx > -1) {
    results.push({ label: 'uploadType', context: text.substring(Math.max(0, idx - 300), idx + 500) });
  }
  
  return results;
});

for (const r of result) {
  console.log(`\n=== ${r.label} ===`);
  console.log(r.context.substring(0, 600));
}

browser.disconnect();
