import puppeteer from 'puppeteer-core';
import fs from 'fs';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));
const imageData = await extPage.evaluate(async () => {
  return await chrome.runtime.sendMessage({ 
    type: 'FETCH_IMAGE', 
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_640x640.jpg' 
  });
});
const base64 = imageData.dataUrl.split(',')[1];
fs.writeFileSync('/tmp/test-photo.jpg', Buffer.from(base64, 'base64'));

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Close variations dialog if open
await ebayPage.evaluate(() => {
  const closeBtn = document.querySelector('.fullscreen-dialog__close');
  if (closeBtn) closeBtn.click();
});
await new Promise(r => setTimeout(r, 1000));

// Scroll to top
await ebayPage.evaluate(() => window.scrollTo(0, 0));
await new Promise(r => setTimeout(r, 500));

// Look for the photo section header showing "Photos" (not Video) 
// Or try scrolling to look for a Photos section
await ebayPage.evaluate(() => {
  // Look at ALL sections
  const sections = document.querySelectorAll('.smry');
  for (const s of sections) {
    const h2 = s.querySelector('h2');
    if (h2) {
      console.log('Section:', h2.textContent.trim(), '- Class:', s.className.substring(0, 60));
    }
  }
});

// The "Photos" section might actually be rendered but hidden/collapsed
// because the Helix photo framework replaces it
// Let me check the section that contains the video uploader more carefully
// Maybe the video section IS the combined video+photo section

// Check if there's a tabbed interface or expandable section for photos
const photoUI = await ebayPage.evaluate(() => {
  const photoSection = document.querySelector('.summary__photos--photo-framework');
  if (!photoSection) return { error: 'no section' };
  
  // Check for tabs, segmented controls, or collapsible sections
  const tabs = photoSection.querySelectorAll('[role="tab"], [role="tablist"], [class*="tab"]');
  const collapsible = photoSection.querySelectorAll('[class*="collapsible"], [class*="accordion"], [class*="expand"]');
  const links = photoSection.querySelectorAll('a, [class*="link"]');
  
  // Check for "See photo options" or similar links
  const allText = photoSection.innerText;
  
  return {
    tabCount: tabs.length,
    collapsibleCount: collapsible.length,
    linkCount: links.length,
    links: Array.from(links).map(l => ({ text: l.textContent?.trim().substring(0, 50), class: l.className?.substring(0, 50) })),
    innerText: allText.substring(0, 500)
  };
});

console.log('Photo UI:', JSON.stringify(photoUI, null, 2));

// Maybe we need to use the "See photo options" link to enable "Import from web"
// Then import photos via URL

// Let me first check for "See photo options" or "photo options" text
const optionsLink = await ebayPage.evaluate(() => {
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const text = el.textContent?.trim().toLowerCase();
    if (text && (text === 'see photo options' || text === 'photo options' || 
        text === 'add photos' || text === 'photos')) {
      if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') {
        return { 
          tag: el.tagName, 
          text: el.textContent.trim(), 
          class: el.className?.substring(0, 80),
          id: el.id 
        };
      }
    }
  }
  return null;
});

console.log('Options link:', JSON.stringify(optionsLink, null, 2));

browser.disconnect();
