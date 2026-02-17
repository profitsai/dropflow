import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));
const imageData = await extPage.evaluate(async () => {
  return await chrome.runtime.sendMessage({ 
    type: 'FETCH_IMAGE', 
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_640x640.jpg' 
  });
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Intercept ALL network requests during our upload attempt
const cdp = await ebayPage.createCDPSession();
const responses = [];
cdp.on('Network.responseReceived', (params) => {
  if (params.response.url.includes('upload') || params.response.url.includes('photo') || 
      params.response.url.includes('image') || params.response.url.includes('EPS') ||
      params.response.url.includes('eps')) {
    responses.push({ url: params.response.url.substring(0, 120), status: params.response.status });
  }
});
await cdp.send('Network.enable');

const result = await ebayPage.evaluate(async (dataUrl) => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  
  // Convert data URL to blob
  const [header, base64] = dataUrl.split(',');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  
  const results = {};
  
  // Try EPS upload via eBayISAPI.dll
  try {
    const fd = new FormData();
    fd.append('file', blob, 'photo.jpg');
    
    const resp = await fetch('/image/upload/eBayISAPI.dll?EpsBasic', {
      method: 'POST',
      body: fd,
      credentials: 'include'
    });
    
    const text = await resp.text();
    results.eps = { status: resp.status, body: text.substring(0, 500) };
  } catch(e) {
    results.eps = { error: e.message };
  }
  
  // Try add_photo_from_mobile endpoint
  try {
    const fd2 = new FormData();
    fd2.append('file', blob, 'photo.jpg');
    
    const resp2 = await fetch(`/lstng/api/listing_draft/${draftId}/add_photo_from_mobile`, {
      method: 'POST',
      body: fd2,
      credentials: 'include'
    });
    
    const text2 = await resp2.text();
    results.mobile = { status: resp2.status, body: text2.substring(0, 500) };
  } catch(e) {
    results.mobile = { error: e.message };
  }

  // Try image-background-remove endpoint (just to understand the API pattern)  
  try {
    const resp3 = await fetch(`/lstng/api/image-background-remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_640x640.jpg' }),
      credentials: 'include'
    });
    const text3 = await resp3.text();
    results.bgRemove = { status: resp3.status, body: text3.substring(0, 300) };
  } catch(e) {
    results.bgRemove = { error: e.message };
  }
  
  return results;
}, imageData.dataUrl);

console.log(JSON.stringify(result, null, 2));
console.log('\nNetwork responses:', JSON.stringify(responses, null, 2));

browser.disconnect();
