import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

let extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));
if (!extPage) {
  extPage = await browser.newPage();
  await extPage.goto('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci/pages/ali-bulk-lister/ali-bulk-lister.html');
  await new Promise(r => setTimeout(r, 2000));
}

// Fetch 3 test images via FETCH_IMAGE (through the service worker)
const testUrls = [
  'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_960x960.jpg',
  'https://ae-pic-a1.aliexpress-media.com/kf/Sd37523b6b7d54a618ed3f6bea4285cdfx.jpg_960x960.jpg',
  'https://ae-pic-a1.aliexpress-media.com/kf/S2a31a59a11514d59b6e27e99b68bb00e7.jpg_960x960.jpg',
];

const files = [];
for (const url of testUrls) {
  try {
    const result = await extPage.evaluate(async (u) => {
      const r = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url: u });
      return { success: r.success, size: r.dataUrl?.length, error: r.error };
    }, url);
    if (result.success) {
      files.push(url);
      console.log(`✓ ${url.substring(55, 85)}... (${Math.round(result.size/1024)}KB)`);
    } else {
      console.log(`✗ ${url.substring(55, 85)}... (${result.error})`);
    }
  } catch(e) {
    console.log(`✗ ${url.substring(55, 85)}... (${e.message})`);
  }
}

console.log(`\n${files.length} images available for upload`);

// Now test on the eBay page with variation listing
const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));
if (!ebayPage) {
  console.log('No eBay listing page found');
  browser.disconnect();
  process.exit(1);
}

// Get before count
const before = await ebayPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return {
    count: data.PHOTOS?.photosInput?.photos?.length || 0,
    inputAccept: document.querySelector('#fehelix-uploader')?.accept,
    hasVariations: !!data.VARIATIONS?.variations?.length
  };
});
console.log('\nBefore:', JSON.stringify(before));

// Fetch images and create Files, then upload via Helix
const uploadResult = await ebayPage.evaluate(async (imageUrls) => {
  // Fetch images through the extension's service worker
  const files = [];
  for (let i = 0; i < imageUrls.length; i++) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url: imageUrls[i] });
      if (resp?.success && resp.dataUrl) {
        const [header, b64] = resp.dataUrl.split(',');
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
        const blob = new Blob([bytes], { type: 'image/jpeg' });
        files.push(new File([blob], `photo-${i+1}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
      }
    } catch(e) {}
  }
  
  if (files.length === 0) return { error: 'No images fetched' };
  
  // Method 0: Helix uploader
  const uploader = window.sellingUIUploader?.['fehelix-uploader'];
  if (!uploader) return { error: 'No uploader found' };
  
  const config = { ...uploader.config };
  config.acceptImage = true;
  config.accept = 'image/*,image/heic,image/heif,image/jpeg,image/png,image/webp,video/mp4,video/quicktime';
  config.maxImages = 24;
  config.maxPhotos = 24;
  uploader.acceptImage = true;
  
  // Track events
  let successCount = 0, failCount = 0;
  const origEmit = uploader.emitter.emit;
  uploader.emitter.emit = function(name, ...args) {
    if (name === 'upload-success') successCount++;
    if (name === 'upload-fail') failCount++;
    return origEmit.call(this, name, ...args);
  };
  
  uploader.uploadFiles(files, 'select', config, { numImage: uploader.totalImagesCount || 0, numVideo: uploader.totalVideosCount || 0 });
  
  // Wait for all uploads
  const start = Date.now();
  while (Date.now() - start < 60000) {
    if (successCount + failCount >= files.length) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  
  uploader.emitter.emit = origEmit;
  
  return { filesCreated: files.length, successCount, failCount };
}, files);

console.log('Upload result:', JSON.stringify(uploadResult, null, 2));

// Check after
await new Promise(r => setTimeout(r, 3000));
const after = await ebayPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return {
    count: data.PHOTOS?.photosInput?.photos?.length || 0,
    photos: data.PHOTOS?.photosInput?.photos?.map(p => p.url?.substring(0, 70))
  };
});
console.log('After:', JSON.stringify(after, null, 2));

browser.disconnect();
