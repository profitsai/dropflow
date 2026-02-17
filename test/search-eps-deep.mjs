import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const result = await ebayPage.evaluate(async () => {
  const resp = await fetch('https://ir.ebaystatic.com/rs/c/fehelix/595.296de6c9.js');
  const text = await resp.text();
  
  // Find the upload function that uses XHR or fetch to post to EPS
  // Look for the XHR-based upload which EPS traditionally uses
  const xhrMatches = [];
  let idx = 0;
  while (true) {
    idx = text.indexOf('XMLHttpRequest', idx + 1);
    if (idx === -1) break;
    xhrMatches.push(text.substring(Math.max(0, idx - 200), idx + 800));
    if (xhrMatches.length >= 3) break;
  }
  
  // Also look for the actual EPS upload handler
  // Search for "file" being appended to FormData near photo-related code
  const uploadMatches = [];
  idx = 0;
  while (true) {
    idx = text.indexOf('.append("file"', idx + 1);
    if (idx === -1) {
      idx = 0;
      while (true) {
        idx = text.indexOf(".append('file'", idx + 1);
        if (idx === -1) break;
        uploadMatches.push(text.substring(Math.max(0, idx - 300), idx + 300));
        if (uploadMatches.length >= 3) break;
      }
      break;
    }
    uploadMatches.push(text.substring(Math.max(0, idx - 300), idx + 300));
    if (uploadMatches.length >= 3) break;
  }
  
  // Search for the XHR upload that uses FormData
  const xhrUploadCode = [];
  idx = 0;
  while (true) {
    idx = text.indexOf('.open("POST"', idx + 1);
    if (idx === -1) {
      idx = 0;
      while (true) {
        idx = text.indexOf(".open('POST'", idx + 1);
        if (idx === -1) break;
        xhrUploadCode.push(text.substring(Math.max(0, idx - 500), idx + 500));
        if (xhrUploadCode.length >= 3) break;
      }
      break;
    }
    xhrUploadCode.push(text.substring(Math.max(0, idx - 500), idx + 500));
    if (xhrUploadCode.length >= 3) break;
  }
  
  return { xhrCount: xhrMatches.length, uploadMatches, xhrUploadCode };
});

console.log('Upload .append("file"):', result.uploadMatches.length);
for (const m of result.uploadMatches) console.log(m.substring(0, 400), '\n---');

console.log('\nXHR POST:', result.xhrUploadCode.length);
for (const m of result.xhrUploadCode) console.log(m.substring(0, 600), '\n---');

browser.disconnect();
