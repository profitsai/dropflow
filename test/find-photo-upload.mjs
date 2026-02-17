import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// The photo-framework section only has "Upload from computer" button (which is for VIDEO)
// The actual PHOTOS section must be separate. Let me check the page structure more carefully

const pageStructure = await ebayPage.evaluate(() => {
  // Get all summary sections and their headers
  const summaries = document.querySelectorAll('[class*="summary__"]');
  const sections = [];
  for (const s of summaries) {
    const h2 = s.querySelector(':scope > div > div > div > h2, :scope > div > div > h2');
    if (h2) {
      sections.push({
        class: s.className.substring(0, 80),
        header: h2.textContent.trim(),
        hasUploader: !!s.querySelector('[class*="uploader"]'),
        hasFileInput: !!s.querySelector('input[type="file"]')
      });
    }
  }
  
  // Check if photo section is hidden / needs activation
  // eBay's new "photo-framework" uses a helix component that may need to be clicked
  const photoFramework = document.querySelector('.summary__photos--photo-framework');
  
  // Check for ALL elements that contain "photo" in class/text
  const photoElements = [];
  document.querySelectorAll('*').forEach(el => {
    const cls = el.className?.toString() || '';
    if (cls.includes('photo') && !cls.includes('uploader-ui-ux__photo-icon')) {
      photoElements.push({
        tag: el.tagName,
        class: cls.substring(0, 80),
        text: el.textContent?.trim().substring(0, 40)
      });
    }
  });
  
  return { sections, photoElements: photoElements.slice(0, 20) };
});

console.log(JSON.stringify(pageStructure, null, 2));

// Now let's try clicking the "Upload from computer" button and intercepting the file chooser
const cdp = await ebayPage.createCDPSession();

// Listen for File chooser opened events
cdp.on('Page.fileChooserOpened', (event) => {
  console.log('FILE CHOOSER OPENED!', JSON.stringify(event));
});
await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });

// Click "Upload from computer"
await ebayPage.evaluate(() => {
  const btn = document.querySelector('.summary__photos--photo-framework button.btn--tertiary');
  if (btn) btn.click();
});

await new Promise(r => setTimeout(r, 3000));

// Check for new elements after click
const afterClick = await ebayPage.evaluate(() => {
  const fileInputs = document.querySelectorAll('input[type="file"]');
  return {
    fileInputs: Array.from(fileInputs).map(i => ({ id: i.id, accept: i.accept, name: i.name })),
    dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map(d => ({
      class: d.className?.substring(0, 80),
      visible: getComputedStyle(d).display !== 'none',
      title: d.querySelector('h2')?.textContent?.trim()
    }))
  };
});
console.log('\nAfter click:', JSON.stringify(afterClick, null, 2));

browser.disconnect();
