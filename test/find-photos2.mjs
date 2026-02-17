import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const info = await ebayPage.evaluate(() => {
  // Find the Photos h3 and get its parent container
  const allH3 = Array.from(document.querySelectorAll('h3'));
  const photoH3 = allH3.find(h => h.textContent.trim() === 'Photos');
  
  if (!photoH3) return { error: 'No Photos h3 found', allH3: allH3.map(h => h.textContent.trim()) };
  
  // Walk up to find the container
  let container = photoH3.parentElement;
  for (let i = 0; i < 5 && container; i++) {
    container = container.parentElement;
  }
  
  // Get the photo section's full HTML
  const photoParent = photoH3.closest('[class*="summary"], [class*="smry"], section') || photoH3.parentElement?.parentElement;
  
  return {
    photoH3Class: photoH3.className,
    parentClass: photoH3.parentElement?.className?.substring(0, 100),
    grandparentClass: photoH3.parentElement?.parentElement?.className?.substring(0, 100),
    photoParentHtml: photoParent?.outerHTML?.substring(0, 2000),
    photoParentClass: photoParent?.className?.substring(0, 100)
  };
});

console.log(JSON.stringify(info, null, 2));

browser.disconnect();
