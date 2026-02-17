import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Take a screenshot of the photo area
const photoInfo = await ebayPage.evaluate(() => {
  const photoSection = document.querySelector('.summary__photos') || 
                       document.querySelector('[class*="summary__photos"]');
  if (photoSection) {
    // Get all interactive elements
    const buttons = photoSection.querySelectorAll('button, [role="button"]');
    const inputs = photoSection.querySelectorAll('input');
    const iframes = photoSection.querySelectorAll('iframe');
    
    // Get the HTML structure (trimmed)
    const html = photoSection.innerHTML.substring(0, 3000);
    
    return {
      found: true,
      className: photoSection.className,
      buttons: Array.from(buttons).map(b => ({ 
        tag: b.tagName, 
        class: b.className?.substring(0, 80), 
        text: b.textContent?.trim().substring(0, 50),
        ariaLabel: b.getAttribute('aria-label')
      })),
      inputs: Array.from(inputs).map(i => ({ id: i.id, type: i.type, accept: i.accept, name: i.name })),
      iframes: Array.from(iframes).map(f => ({ src: f.src?.substring(0, 100), id: f.id })),
      html: html
    };
  }
  return { found: false };
});

console.log(JSON.stringify(photoInfo, null, 2));

browser.disconnect();
