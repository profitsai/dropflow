import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const info = await ebayPage.evaluate(() => {
  // Find ALL uploader-related elements
  const uploaders = document.querySelectorAll('[class*="uploader"], [class*="photo-framework"], [class*="summary__photos"]');
  
  const results = [];
  for (const u of uploaders) {
    // Check ancestor context
    const inVariations = !!u.closest('[class*="variation"], [class*="msku"]');
    const inDialog = !!u.closest('[role="dialog"], [class*="dialog"]');
    
    results.push({
      tag: u.tagName,
      class: u.className?.substring(0, 120),
      inVariations,
      inDialog,
      hasFileInput: !!u.querySelector('input[type="file"]'),
      hasButton: !!u.querySelector('button'),
      buttonText: u.querySelector('button')?.textContent?.trim().substring(0, 50),
    });
  }
  
  // Also check the main summary__photos section specifically
  const mainPhotos = document.querySelector('.summary__photos');
  const mainPhotoHtml = mainPhotos?.outerHTML?.substring(0, 1500);
  
  return { uploaderCount: results.length, uploaders: results, mainPhotoHtml };
});

console.log(JSON.stringify(info, null, 2));

browser.disconnect();
