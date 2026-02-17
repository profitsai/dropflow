import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));

// Fetch the image
const imageData = await extPage.evaluate(async () => {
  const resp = await chrome.runtime.sendMessage({ 
    type: 'FETCH_IMAGE', 
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_640x640.jpg' 
  });
  return resp;
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Try EPS upload
const result = await ebayPage.evaluate(async (dataUrl) => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  
  // Convert data URL to blob
  const [header, base64] = dataUrl.split(',');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  
  const results = {};
  
  // Try eBay EPS (Picture Services) endpoints
  const epsEndpoints = [
    'https://api.ebay.com.au/ws/api.dll',  // Trading API
    'https://www.ebay.com.au/cgi-bin/eps/photo_upload',
    `https://www.ebay.com.au/lstng/api/photoUpload`,
    `https://www.ebay.com.au/lstng/api/listing_draft/${draftId}/photoUpload`,
    `https://www.ebay.com.au/lstng/api/imageUpload`,
    // The Helix photo upload endpoint pattern
    `https://www.ebay.com.au/lstng/api/listing_draft/${draftId}/upload/photo`,
  ];
  
  for (const ep of epsEndpoints) {
    try {
      const fd = new FormData();
      fd.append('file', blob, 'photo.jpg');
      fd.append('pictureType', 'JPEG');
      
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
  
  // Also try: Trigger the photo upload widget by modifying the URL
  // eBay's /lstng page might have a photo upload iframe
  // Check for any XHR/fetch interceptors that eBay uses
  
  return results;
}, imageData.dataUrl);

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
