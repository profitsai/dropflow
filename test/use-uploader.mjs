import puppeteer from 'puppeteer-core';

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

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const uploaderDetail = await ebayPage.evaluate(() => {
  const u = window.sellingUIUploader?.['fehelix-uploader'];
  if (!u) return { error: 'no uploader' };
  
  return {
    config: JSON.stringify(u.config || {}).substring(0, 500),
    acceptVideo: u.acceptVideo,
    acceptImage: u.acceptImage,
    uploaderId: u.uploaderId,
    totalImagesCount: u.totalImagesCount,
    totalVideosCount: u.totalVideosCount,
    epsDomain: u.epsDomain,
    // Check input element
    inputId: u.input?.id,
    inputAccept: u.input?.accept,
  };
});

console.log('Uploader detail:', JSON.stringify(uploaderDetail, null, 2));

// The uploader exists but it's for video. The PHOTO uploader might not be initialized
// because the photo section is in the Helix framework.
// 
// Key insight: The photo section shows "Video" header and only video upload.
// But the draft has a PHOTOS section. This means the photo upload might need to 
// happen through a completely different path.
//
// Let me try: Use the EPS upload directly (which we know works) and then 
// emit the right events to the Marko component to register the uploaded photo.

// Try to find the Marko photo component
const markoInfo = await ebayPage.evaluate(() => {
  // Look for Marko components on the page
  const photoSection = document.querySelector('.summary__photos');
  if (!photoSection) return { error: 'no photo section' };
  
  // Check for __components or __marko
  const keys = [];
  for (const key in photoSection) {
    if (key.startsWith('__') || key.startsWith('$')) {
      keys.push(key);
    }
  }
  
  // Try to find the component via Marko's internal API
  const markoComponent = photoSection.closest('[data-marko-key]') || photoSection.closest('[data-widget-id]');
  
  // Check for __component on DOM elements
  let comp = null;
  let el = photoSection;
  while (el && !comp) {
    comp = el.__component || el.component;
    if (!comp) {
      for (const k of Object.keys(el)) {
        if (k.startsWith('$w')) {
          comp = el[k];
          break;
        }
      }
    }
    el = el.parentElement;
  }
  
  return { 
    keys, 
    markoComponent: !!markoComponent,
    hasComponent: !!comp,
    componentKeys: comp ? Object.keys(comp).slice(0, 20) : [],
    componentType: comp?.constructor?.name
  };
});

console.log('\nMarko info:', JSON.stringify(markoInfo, null, 2));

browser.disconnect();
