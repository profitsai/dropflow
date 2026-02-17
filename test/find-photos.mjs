import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const info = await ebayPage.evaluate(() => {
  // Find ALL sections with headers
  const sections = [];
  const headers = document.querySelectorAll('h2, h3');
  for (const h of headers) {
    const text = h.textContent.trim();
    if (text.toLowerCase().includes('photo') || text.toLowerCase().includes('image') || text.toLowerCase().includes('video')) {
      const section = h.closest('section, div[class*="summary"], div[class*="section"]');
      sections.push({
        headerText: text,
        sectionClass: section?.className?.substring(0, 100),
        sectionHtml: section?.innerHTML?.substring(0, 500)
      });
    }
  }
  
  // Also search for any "photo-framework" or uploader elements
  const photoFramework = document.querySelector('[class*="photo-framework"]');
  const uploaderModules = document.querySelectorAll('.uploader-module');
  
  // Check all file inputs on the page
  const allInputs = document.querySelectorAll('input[type="file"]');
  
  // Check for the photo upload specifically - look for "Photos" header
  const allH2 = Array.from(document.querySelectorAll('h2'));
  const photoH2 = allH2.find(h => h.textContent.trim() === 'Photos');
  
  return {
    sections,
    photoFrameworkClass: photoFramework?.className?.substring(0, 100),
    uploaderModuleCount: uploaderModules.length,
    allFileInputs: Array.from(allInputs).map(i => ({ id: i.id, accept: i.accept, type: i.type })),
    photoH2Found: !!photoH2,
    photoH2Parent: photoH2?.closest('div[class]')?.className?.substring(0, 100),
    h2Texts: allH2.map(h => h.textContent.trim())
  };
});

console.log(JSON.stringify(info, null, 2));

browser.disconnect();
