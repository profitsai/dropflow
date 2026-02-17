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

// Reload to get clean state
await brokenPage.reload({ waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 3000));

// Count before
const before = await brokenPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return data.PHOTOS?.photosInput?.photos?.length || 0;
});
console.log('Before:', before);

// Directly call uploadFiles with corrected config
const result = await brokenPage.evaluate(async (dataUrl) => {
  const uploader = window.sellingUIUploader?.['fehelix-uploader'];
  if (!uploader) return { error: 'no uploader' };
  
  // Create File from data URL
  const [header, b64] = dataUrl.split(',');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const file = new File([blob], 'direct-upload.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  
  // Set acceptImage to true 
  uploader.acceptImage = true;
  uploader.totalImagesCount = 0;
  
  // Create a modified config that accepts images
  const config = {
    ...uploader.config,
    acceptImage: true,
    acceptVideo: true,
    accept: 'image/*,image/heic,image/heif,video/mp4,video/quicktime',
    maxImages: 24,
    maxPhotos: 24,
    maxVideos: 1,
  };
  
  // Call uploadFiles directly with corrected config
  try {
    const fileList = [file]; // Array of File objects
    await uploader.uploadFiles(
      fileList, 
      "select", 
      config, 
      { numImage: 0, numVideo: 0 }
    );
    return { success: true };
  } catch(e) {
    return { error: e.message, stack: e.stack?.substring(0, 500) };
  }
}, imageData.dataUrl);

console.log('Upload result:', JSON.stringify(result, null, 2));

// Wait for upload to complete
await new Promise(r => setTimeout(r, 15000));

// Check after
const after = await brokenPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return data.PHOTOS?.photosInput?.photos?.length || 0;
});
console.log('After:', after);

browser.disconnect();
