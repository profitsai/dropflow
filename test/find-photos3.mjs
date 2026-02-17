import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const info = await ebayPage.evaluate(() => {
  const photoH3 = Array.from(document.querySelectorAll('h3')).find(h => h.textContent.trim() === 'Photos');
  if (!photoH3) return { error: 'not found' };
  
  // Get the parent smry--section which contains the photo uploader
  const section = photoH3.closest('.smry--section') || photoH3.parentElement;
  return {
    sectionHtml: section?.outerHTML?.substring(0, 3000),
    sectionClass: section?.className
  };
});

console.log(JSON.stringify(info, null, 2));

browser.disconnect();
