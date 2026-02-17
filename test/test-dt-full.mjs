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

const workingPage = (await browser.pages()).find(p => p.url().includes('draftId=5053798596022'));

// Count current photos
const beforeCount = await workingPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return data.PHOTOS?.photosInput?.photos?.length || 0;
});
console.log('Before:', beforeCount, 'photos');

// Upload via DataTransfer
const dtResult = await workingPage.evaluate(async (dataUrl) => {
  const [header, b64] = dataUrl.split(',');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const file = new File([blob], 'dt-test.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  
  const input = document.querySelector('#fehelix-uploader');
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  
  // Dispatch events
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  
  return { filesSet: input.files.length };
}, imageData.dataUrl);

console.log('DT result:', JSON.stringify(dtResult));

// Wait for upload
await new Promise(r => setTimeout(r, 15000));

// Check
const afterCount = await workingPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return data.PHOTOS?.photosInput?.photos?.length || 0;
});
console.log('After:', afterCount, 'photos');

browser.disconnect();
