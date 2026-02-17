import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// The EPS uploader is likely in a specific chunk - let's check each one
const scripts = [
  'https://ir.ebaystatic.com/rs/c/fehelix/49.4937a158.js',
  'https://ir.ebaystatic.com/rs/c/fehelix/305.79891145.js',
  'https://ir.ebaystatic.com/rs/c/fehelix/422.b01313ac.js',
  'https://ir.ebaystatic.com/rs/c/fehelix/635.78cebd78.js',
  'https://ir.ebaystatic.com/rs/c/fehelix/196.a74a9cf5.js',
  'https://ir.ebaystatic.com/rs/c/fehelix/595.296de6c9.js',
  'https://ir.ebaystatic.com/rs/c/fehelix/675.d0054cc7.js',
];

for (const url of scripts) {
  const result = await ebayPage.evaluate(async (u) => {
    const resp = await fetch(u);
    const text = await resp.text();
    
    if (text.includes('EpsBasic') || text.includes('photoUpload') || 
        text.includes('uploadPhoto') || text.includes('eps_url') ||
        (text.includes('FormData') && text.includes('image'))) {
      
      // Find EPS-related code
      const idx = text.indexOf('EpsBasic');
      if (idx > -1) {
        const start = Math.max(0, idx - 500);
        return { chunk: u.split('/').pop(), context: text.substring(start, idx + 1000) };
      }
      
      // Find photo upload FormData
      let fIdx = 0;
      while (true) {
        fIdx = text.indexOf('FormData', fIdx + 1);
        if (fIdx === -1) break;
        const ctx = text.substring(fIdx, fIdx + 300);
        if (ctx.includes('image') || ctx.includes('photo') || ctx.includes('picture')) {
          return { chunk: u.split('/').pop(), context: text.substring(Math.max(0, fIdx - 200), fIdx + 500) };
        }
      }
      
      return { chunk: u.split('/').pop(), hasMatch: true, size: text.length };
    }
    return null;
  }, url);
  
  if (result) {
    console.log(`\n=== ${result.chunk} ===`);
    if (result.context) console.log(result.context.substring(0, 800));
    else console.log('Has match, size:', result.size);
  }
}

browser.disconnect();
