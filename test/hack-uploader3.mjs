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

ebayPage.on('console', msg => {
  const text = msg.text();
  if (text.includes('upload') || text.includes('photo') || text.includes('EPS') || 
      text.includes('error') || text.includes('Error')) {
    console.log(`[CONSOLE] ${text.substring(0, 200)}`);
  }
});

const result = await ebayPage.evaluate(async (dataUrl) => {
  const uploader = window.sellingUIUploader?.['fehelix-uploader'];
  if (!uploader) return { error: 'no uploader' };
  
  // Reconfigure for images
  uploader.config.acceptImage = true;
  uploader.config.acceptVideo = false;
  uploader.acceptImage = true;
  uploader.acceptVideo = false;
  uploader.config.accept = 'image/jpeg,image/png,image/webp';
  uploader.config.maxPhotos = 24;
  uploader.config.maxVideos = 0;
  if (uploader.input) {
    uploader.input.accept = 'image/jpeg,image/png,image/webp';
  }
  
  // Fix the updateFileCounts issue - it needs numImage and numVideo
  uploader.totalImagesCount = 0;
  uploader.totalVideosCount = 0;
  
  // Patch updateFileCounts to accept the right format
  const origUpdateFileCounts = uploader.updateFileCounts;
  uploader.updateFileCounts = function(counts) {
    if (!counts) counts = { numImage: 0, numVideo: 0 };
    return origUpdateFileCounts.call(this, counts);
  };
  
  // Create File
  const [header, b64] = dataUrl.split(',');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const file = new File([blob], 'product-photo-1.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  
  // Listen for events
  const events = [];
  if (uploader.emitter && uploader.emitter.on) {
    for (const evt of ['upload-begin', 'upload-success', 'upload-fail', 'upload-error', 'upload-complete']) {
      uploader.emitter.on(evt, (...args) => {
        events.push({ event: evt, data: JSON.stringify(args).substring(0, 200) });
      });
    }
  }
  
  try {
    await uploader.uploadFiles([file]);
    return { 
      success: true,
      events,
      totalImages: uploader.totalImagesCount,
    };
  } catch(e) {
    return { error: e.message, stack: e.stack?.substring(0, 500), events };
  }
}, imageData.dataUrl);

console.log('Result:', JSON.stringify(result, null, 2));

await new Promise(r => setTimeout(r, 3000));

browser.disconnect();
