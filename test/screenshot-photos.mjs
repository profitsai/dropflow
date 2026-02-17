import puppeteer from 'puppeteer-core';
import fs from 'fs';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Scroll to photos section and screenshot
await ebayPage.evaluate(() => {
  const photoH3 = Array.from(document.querySelectorAll('h3')).find(h => h.textContent.trim() === 'Photos');
  if (photoH3) photoH3.scrollIntoView({ block: 'center' });
});
await new Promise(r => setTimeout(r, 1000));

await ebayPage.screenshot({ path: '/tmp/ebay-photos.png', fullPage: false });
console.log('Screenshot saved to /tmp/ebay-photos.png');

// Check for any overlays/dialogs/modals that might have appeared
const overlays = await ebayPage.evaluate(() => {
  const modals = document.querySelectorAll('[role="dialog"], .lightbox-dialog, [class*="modal"], [class*="overlay"], [class*="drawer"]');
  return Array.from(modals).map(m => ({
    tag: m.tagName,
    class: m.className?.substring(0, 100),
    visible: m.offsetParent !== null || getComputedStyle(m).display !== 'none',
    html: m.innerHTML?.substring(0, 300)
  }));
});
console.log('Overlays:', JSON.stringify(overlays, null, 2));

// Check the full photo section structure more carefully
const photoDetail = await ebayPage.evaluate(() => {
  const section = document.querySelector('.smry--section');
  if (!section) return null;
  
  // Get all descendants with event listeners (React)
  const allEls = section.querySelectorAll('*');
  const clickables = [];
  for (const el of allEls) {
    const tag = el.tagName;
    const cls = el.className?.toString().substring(0, 60) || '';
    if (tag === 'BUTTON' || tag === 'A' || el.getAttribute('role') === 'button' || 
        el.getAttribute('tabindex') || el.getAttribute('onclick')) {
      clickables.push({ tag, class: cls, text: el.textContent?.trim().substring(0, 40) });
    }
  }
  return { 
    fullHtml: section.outerHTML,
    clickables 
  };
});

if (photoDetail) {
  fs.writeFileSync('/tmp/photo-section.html', photoDetail.fullHtml);
  console.log('Photo section HTML saved to /tmp/photo-section.html');
  console.log('Clickables:', JSON.stringify(photoDetail.clickables, null, 2));
}

browser.disconnect();
