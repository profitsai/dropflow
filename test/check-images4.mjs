import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));

// Test FETCH_IMAGE
const testUrl = 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_640x640.jpg';
console.log('Testing FETCH_IMAGE for:', testUrl);
const r = await extPage.evaluate(async (url) => {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url });
    return { success: resp?.success, error: resp?.error, dataSize: resp?.dataUrl?.length };
  } catch(e) { return { error: e.message }; }
}, testUrl);
console.log('FETCH_IMAGE result:', JSON.stringify(r));

// Check the eBay page for upload state  
const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));
if (ebayPage) {
  console.log('\nChecking eBay page:', ebayPage.url().substring(0, 80));
  
  // Check for file inputs and photo upload area
  const domInfo = await ebayPage.evaluate(() => {
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const photoSection = document.querySelector('[data-testid="photos"]') || 
                         document.querySelector('.photo-upload') ||
                         document.querySelector('[class*="photo"]') ||
                         document.querySelector('[class*="Photo"]');
    const uploadedImages = document.querySelectorAll('[class*="uploaded-image"], [class*="photo-item"] img, [class*="image-preview"]');
    
    return {
      fileInputCount: fileInputs.length,
      fileInputIds: Array.from(fileInputs).map(i => ({ id: i.id, accept: i.accept, name: i.name, hidden: i.offsetParent === null })),
      photoSectionFound: !!photoSection,
      photoSectionClass: photoSection?.className?.substring(0, 100),
      uploadedImageCount: uploadedImages.length,
    };
  });
  console.log('eBay DOM:', JSON.stringify(domInfo, null, 2));
}

browser.disconnect();
