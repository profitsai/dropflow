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

// Test on the working listing (no variations, accepts images)
const workingPage = (await browser.pages()).find(p => p.url().includes('draftId=5053798596022'));

// Listen for network
const cdp = await workingPage.createCDPSession();
cdp.on('Network.responseReceived', (params) => {
  if (params.response.url.includes('EPS') || params.response.url.includes('upload') || 
      params.response.url.includes('image/upload')) {
    console.log(`[NET] ${params.response.status} ${params.response.url.substring(0, 100)}`);
  }
});
await cdp.send('Network.enable');

// Use DataTransfer to set file (simulating what form-filler.js does)
const result = await workingPage.evaluate(async (dataUrl) => {
  const input = document.querySelector('#fehelix-uploader');
  if (!input) return { error: 'no input' };
  
  // Create File from data URL
  const [header, b64] = dataUrl.split(',');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const file = new File([blob], 'product-photo-2.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  
  // Use DataTransfer
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  
  return { success: true, filesSet: input.files.length };
}, imageData.dataUrl);

console.log('DataTransfer result:', JSON.stringify(result));

// Wait for upload
await new Promise(r => setTimeout(r, 15000));

// Check
const afterCheck = await workingPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return {
    photosCount: data.PHOTOS?.photosInput?.photos?.length,
    photos: data.PHOTOS?.photosInput?.photos?.map(p => p.url?.substring(0, 60))
  };
});

console.log('After:', JSON.stringify(afterCheck, null, 2));

browser.disconnect();
