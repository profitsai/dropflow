import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));
const imageData = await extPage.evaluate(async () => {
  return await chrome.runtime.sendMessage({ 
    type: 'FETCH_IMAGE', 
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_960x960.jpg'
  });
});

const brokenPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Listen to all uploader events
brokenPage.on('console', msg => {
  const text = msg.text();
  console.log(`[${msg.type()}] ${text.substring(0, 200)}`);
});

const result = await brokenPage.evaluate(async (dataUrl) => {
  const uploader = window.sellingUIUploader?.['fehelix-uploader'];
  if (!uploader) return { error: 'no uploader' };
  
  // Listen for all events from the emitter
  const events = [];
  const origEmit = uploader.emitter.emit;
  uploader.emitter.emit = function(eventName, ...args) {
    events.push({ event: eventName, data: JSON.stringify(args).substring(0, 100) });
    console.log(`[UPLOADER EVENT] ${eventName}: ${JSON.stringify(args).substring(0, 100)}`);
    return origEmit.call(this, eventName, ...args);
  };
  
  // Create File
  const [header, b64] = dataUrl.split(',');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const file = new File([blob], 'direct-upload2.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  
  uploader.acceptImage = true;
  uploader.totalImagesCount = 0;
  
  // Use the original config but override specific fields
  const config = { ...uploader.config };
  config.acceptImage = true;
  config.accept = 'image/*,image/heic,image/heif,video/mp4,video/quicktime';
  config.maxImages = 24;
  config.maxPhotos = 24;
  
  try {
    await uploader.uploadFiles([file], "select", config, { numImage: 0, numVideo: 0 });
    
    // Wait a bit for the upload to process
    await new Promise(r => setTimeout(r, 5000));
    
    return { success: true, events, imageUploadInProgress: uploader.imageUploadInProgress };
  } catch(e) {
    return { error: e.message, events };
  }
}, imageData.dataUrl);

console.log('\nResult:', JSON.stringify(result, null, 2));

// Wait more
await new Promise(r => setTimeout(r, 10000));

const count = await brokenPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return data.PHOTOS?.photosInput?.photos?.length || 0;
});
console.log('Photo count:', count);

browser.disconnect();
