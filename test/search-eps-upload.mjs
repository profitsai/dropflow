import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Search ALL fehelix bundles for FormData.append with file uploads
const scripts = await ebayPage.evaluate(() => {
  return Array.from(document.querySelectorAll('script[src]'))
    .map(s => s.src)
    .filter(s => s.includes('fehelix'));
});

for (const script of scripts) {
  const result = await ebayPage.evaluate(async (url) => {
    const resp = await fetch(url);
    const text = await resp.text();
    
    // Search for FormData append patterns near photo/image/EPS
    const results = [];
    
    // Look for the photo upload function
    const photoUploadIdx = text.indexOf('photoUploader');
    if (photoUploadIdx === -1) return null;
    
    // Find FormData usage
    let searchStart = 0;
    while (true) {
      const idx = text.indexOf('FormData', searchStart);
      if (idx === -1 || idx > text.length - 100) break;
      
      // Get context
      const context = text.substring(idx, Math.min(text.length, idx + 500));
      if (context.includes('append') && !context.includes('videoFile')) {
        results.push(context.substring(0, 400));
      }
      searchStart = idx + 1;
      if (results.length >= 3) break;
    }
    
    // Also search for "file" in append calls
    let start2 = 0;
    const appendResults = [];
    while (true) {
      const idx = text.indexOf('.append(', start2);
      if (idx === -1) break;
      const context = text.substring(idx, Math.min(text.length, idx + 100));
      if (!context.includes('videoFile')) {
        appendResults.push(context.substring(0, 80));
      }
      start2 = idx + 1;
      if (appendResults.length >= 20) break;
    }
    
    return { url: url.split('/').pop(), results, appendResults };
  }, script);
  
  if (result) {
    console.log(JSON.stringify(result, null, 2));
  }
}

browser.disconnect();
