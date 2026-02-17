import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Try uploading a photo via the draft API with the correct PHOTOS format
// First fetch an image via the extension
const extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));

const imageData = await extPage.evaluate(async () => {
  const resp = await chrome.runtime.sendMessage({ 
    type: 'FETCH_IMAGE', 
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_640x640.jpg' 
  });
  return resp;
});

console.log('Image fetched:', imageData.success, 'size:', imageData.dataUrl?.length);

// Now try to upload via eBay's photo upload endpoint
// First, let's find out what endpoints eBay's Helix photo framework uses
// by intercepting network requests
const cdp = await ebayPage.createCDPSession();

const requests = [];
cdp.on('Network.requestWillBeSent', (params) => {
  if (params.request.url.includes('photo') || params.request.url.includes('image') || 
      params.request.url.includes('media') || params.request.url.includes('upload') ||
      params.request.url.includes('picture')) {
    requests.push({ url: params.request.url.substring(0, 120), method: params.request.method });
  }
});
await cdp.send('Network.enable');

// Try various upload approaches on the eBay page

// Approach 1: Try eBay's picture upload API 
const uploadResult = await ebayPage.evaluate(async (dataUrl) => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  
  // Convert data URL to blob
  const [header, base64] = dataUrl.split(',');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  
  const results = {};
  
  // Try: /lstng/api/listing_draft/{draftId}/photo  
  const endpoints = [
    `/lstng/api/listing_draft/${draftId}/photo`,
    `/lstng/api/listing_draft/${draftId}/image`,
    `/lstng/api/listing_draft/${draftId}/photos`,
    `/sell/media/api/image`,
    `/api/merch/photo/upload`,
  ];
  
  for (const ep of endpoints) {
    try {
      const fd = new FormData();
      fd.append('file', blob, 'photo.jpg');
      
      const resp = await fetch(ep, {
        method: 'POST',
        body: fd,
        credentials: 'include'
      });
      
      const text = await resp.text();
      results[ep] = { status: resp.status, body: text.substring(0, 200) };
    } catch(e) {
      results[ep] = { error: e.message };
    }
  }
  
  return results;
}, imageData.dataUrl);

console.log('\nUpload results:', JSON.stringify(uploadResult, null, 2));
console.log('\nIntercepted requests:', JSON.stringify(requests, null, 2));

browser.disconnect();
