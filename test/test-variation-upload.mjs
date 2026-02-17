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

// First reload to get clean state
await brokenPage.reload({ waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 3000));

// Check current state
const before = await brokenPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return {
    photosCount: data.PHOTOS?.photosInput?.photos?.length || 0,
    inputAccept: document.querySelector('#fehelix-uploader')?.accept
  };
});
console.log('Before:', JSON.stringify(before));

// Modify accept attribute and uploader config
await brokenPage.evaluate(() => {
  const input = document.querySelector('#fehelix-uploader');
  if (input) {
    input.accept = 'image/*,image/heic,image/heif,video/mp4,video/quicktime';
  }
  const uploader = window.sellingUIUploader?.['fehelix-uploader'];
  if (uploader) {
    uploader.config.acceptImage = true;
    uploader.acceptImage = true;
    uploader.config.accept = 'image/*,image/heic,image/heif,video/mp4,video/quicktime';
    uploader.config.maxPhotos = 24;
    // Also need to set maxImages for updateFileCounts
    if (uploader.upload) {
      uploader.upload.maxImages = 24;
    }
  }
});

// Upload via DataTransfer
await brokenPage.evaluate(async (dataUrl) => {
  const [header, b64] = dataUrl.split(',');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const file = new File([blob], 'variation-test.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  
  const input = document.querySelector('#fehelix-uploader');
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, imageData.dataUrl);

console.log('File set, waiting...');
await new Promise(r => setTimeout(r, 15000));

// Check after
const after = await brokenPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return {
    photosCount: data.PHOTOS?.photosInput?.photos?.length || 0,
    firstPhoto: data.PHOTOS?.photosInput?.photos?.[0]?.url?.substring(0, 80)
  };
});
console.log('After:', JSON.stringify(after));

browser.disconnect();
