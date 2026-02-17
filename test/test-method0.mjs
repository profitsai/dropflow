import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Inject and test the uploadViaHelixUploader function directly
// First, fetch images via the extension
const extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));
if (!extPage) {
  console.log('No extension page found, trying to open one');
  // Open the extension popup
  const newPage = await browser.newPage();
  await newPage.goto('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci/pages/ali-bulk-lister/ali-bulk-lister.html');
  await new Promise(r => setTimeout(r, 2000));
}

const extPage2 = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));

// Fetch multiple images
const imageUrls = [
  'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_960x960.jpg',
  'https://ae-pic-a1.aliexpress-media.com/kf/S7e7b0b9f12344a2dad6e426ad5ed3c75A.jpg_960x960.jpg',
  'https://ae-pic-a1.aliexpress-media.com/kf/S7c70b1a1a95a4449893f2c2e3a3e8917r.jpg_960x960.jpg'
];

const images = [];
for (const url of imageUrls) {
  const result = await extPage2.evaluate(async (u) => {
    return await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url: u });
  }, url);
  if (result.success) {
    images.push(result.dataUrl);
    console.log(`Fetched: ${url.substring(60, 90)}... (${Math.round(result.dataUrl.length/1024)}KB)`);
  }
}

console.log(`\nFetched ${images.length} images, testing upload...`);

// Count before
const before = await ebayPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return data.PHOTOS?.photosInput?.photos?.length || 0;
});
console.log('Photos before:', before);

// Upload using Method 0 (Helix uploader)
const uploadResult = await ebayPage.evaluate(async (imageDataUrls) => {
  const uploader = window.sellingUIUploader?.['fehelix-uploader'];
  if (!uploader) return { error: 'no uploader' };
  
  // Create File objects from data URLs
  const files = [];
  for (let i = 0; i < imageDataUrls.length; i++) {
    const [header, b64] = imageDataUrls[i].split(',');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    files.push(new File([blob], `product-image-${i+1}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
  }
  
  // Create corrected config
  const config = { ...uploader.config };
  config.acceptImage = true;
  config.accept = 'image/*,image/heic,image/heif,image/jpeg,image/png,image/webp,video/mp4,video/quicktime';
  config.maxImages = 24;
  config.maxPhotos = 24;
  uploader.acceptImage = true;
  
  // Upload all at once
  const events = [];
  const origEmit = uploader.emitter.emit;
  uploader.emitter.emit = function(eventName, ...args) {
    if (eventName === 'upload-success' || eventName === 'upload-fail') {
      events.push({ event: eventName, data: JSON.stringify(args).substring(0, 100) });
    }
    return origEmit.call(this, eventName, ...args);
  };
  
  uploader.uploadFiles(
    files,
    'select',
    config,
    { numImage: uploader.totalImagesCount || 0, numVideo: uploader.totalVideosCount || 0 }
  );
  
  // Wait for all uploads to complete
  const startTime = Date.now();
  while (Date.now() - startTime < 60000) {
    if (events.filter(e => e.event === 'upload-success').length + 
        events.filter(e => e.event === 'upload-fail').length >= files.length) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  
  uploader.emitter.emit = origEmit;
  
  return {
    successCount: events.filter(e => e.event === 'upload-success').length,
    failCount: events.filter(e => e.event === 'upload-fail').length,
    events
  };
}, images);

console.log('Upload result:', JSON.stringify(uploadResult, null, 2));

// Check after
await new Promise(r => setTimeout(r, 3000));
const after = await ebayPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return {
    count: data.PHOTOS?.photosInput?.photos?.length || 0,
    photos: data.PHOTOS?.photosInput?.photos?.map(p => p.url?.substring(0, 60))
  };
});
console.log('Photos after:', JSON.stringify(after, null, 2));

browser.disconnect();
