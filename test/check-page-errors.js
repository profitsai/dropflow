const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  
  // Get the full error text from the page
  const errors = await ebayPage.evaluate(() => {
    const errorEls = document.querySelectorAll('.summary--error, [class*="error"], [class*="inline-notice--error"]');
    return Array.from(errorEls).map(e => ({
      class: e.className?.substring(0,100),
      text: e.textContent?.substring(0,300)
    }));
  });
  console.log('ERRORS:', JSON.stringify(errors, null, 2));
  
  // Check if Helix uploader exists
  const helixCheck = await ebayPage.evaluate(() => {
    return {
      hasSellingUIUploader: !!window.sellingUIUploader,
      uploaderKeys: window.sellingUIUploader ? Object.keys(window.sellingUIUploader) : [],
      hasUploadFiles: window.sellingUIUploader ? Object.keys(window.sellingUIUploader).map(k => typeof window.sellingUIUploader[k]?.uploadFiles) : []
    };
  });
  console.log('HELIX:', JSON.stringify(helixCheck));
  
  // Check variation section details
  const varSection = await ebayPage.evaluate(() => {
    const sec = document.querySelector('.summary__variations');
    if (!sec) return 'no .summary__variations';
    return sec.innerHTML.substring(0, 2000);
  });
  console.log('VAR HTML:', varSection.substring(0, 1000));
  
  browser.disconnect();
})().catch(e => console.error(e));
