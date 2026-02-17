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

// Fetch image via extension
const imageDataUrl = await extPage.evaluate(async () => {
  const r = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url: 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_960x960.jpg' });
  return r.success ? r.dataUrl : null;
});

if (!imageDataUrl) { console.log('Failed to fetch image'); process.exit(1); }
console.log('Image fetched:', Math.round(imageDataUrl.length/1024), 'KB');

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Before
const before = await ebayPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return data.PHOTOS?.photosInput?.photos?.length || 0;
});
console.log('Photos before:', before);

// Upload via Helix
const result = await ebayPage.evaluate(async (dataUrl) => {
  const [header, b64] = dataUrl.split(',');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const file = new File([blob], 'test.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  
  const uploader = window.sellingUIUploader?.['fehelix-uploader'];
  if (!uploader) return { error: 'no uploader' };
  
  const config = { ...uploader.config };
  config.acceptImage = true;
  config.accept = 'image/*,image/jpeg,video/mp4,video/quicktime';
  config.maxImages = 24;
  uploader.acceptImage = true;
  
  let success = false;
  const origEmit = uploader.emitter.emit;
  uploader.emitter.emit = function(name, ...args) {
    if (name === 'upload-success') success = true;
    return origEmit.call(this, name, ...args);
  };
  
  uploader.uploadFiles([file], 'select', config, { numImage: 0, numVideo: 0 });
  
  const start = Date.now();
  while (Date.now() - start < 30000 && !success) await new Promise(r => setTimeout(r, 500));
  uploader.emitter.emit = origEmit;
  
  return { success };
}, imageDataUrl);

console.log('Upload result:', JSON.stringify(result));

await new Promise(r => setTimeout(r, 2000));
const after = await ebayPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return data.PHOTOS?.photosInput?.photos?.length || 0;
});
console.log('Photos after:', after);

browser.disconnect();
