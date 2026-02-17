import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// First close any open dialogs
await ebayPage.evaluate(async () => {
  const closeBtn = document.querySelector('.fullscreen-dialog__close');
  if (closeBtn) closeBtn.click();
  await new Promise(r => setTimeout(r, 1000));
});

// Wait for page to settle
await new Promise(r => setTimeout(r, 1500));

// Now find the photo area on the main form (not inside variations)
const photoAreaInfo = await ebayPage.evaluate(async () => {
  // The PHOTOS section should be on the main form — look for the photo-framework
  const photoFramework = document.querySelector('.summary__photos--photo-framework');
  if (!photoFramework) return { error: 'No photo framework found' };

  // Look for clickable photo upload triggers
  const allButtons = photoFramework.querySelectorAll('button, [role="button"], a');
  const buttons = Array.from(allButtons).map(b => ({
    tag: b.tagName, text: b.textContent?.trim().substring(0, 50), class: b.className?.substring(0, 80)
  }));
  
  // Look more broadly on the page for photo-related elements outside variations
  const photoH2 = Array.from(document.querySelectorAll('h2')).find(h => h.textContent.includes('Photo'));
  
  // Also check if the photo section is actually rendered as a separate section
  const summaryDivs = document.querySelectorAll('div[class*="summary__"]');
  const photoRelated = [];
  for (const d of summaryDivs) {
    if (d.className.includes('photo') || d.className.includes('image')) {
      photoRelated.push(d.className.substring(0, 100));
    }
  }
  
  return { buttons, photoH2: !!photoH2, photoRelated };
});

console.log('Photo area:', JSON.stringify(photoAreaInfo, null, 2));

// Screenshot the top of the page
await ebayPage.evaluate(() => window.scrollTo(0, 0));
await new Promise(r => setTimeout(r, 1000));
await ebayPage.screenshot({ path: '/tmp/ebay-top.png' });
console.log('Screenshot saved to /tmp/ebay-top.png');

browser.disconnect();
