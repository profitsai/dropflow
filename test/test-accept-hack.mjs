import puppeteer from 'puppeteer-core';
import fs from 'fs';

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
const base64 = imageData.dataUrl.split(',')[1];
fs.writeFileSync('/tmp/test-photo-hack.jpg', Buffer.from(base64, 'base64'));

// Test on the broken listing (with variations, video-only input)
const brokenPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Intercept network
const cdp = await brokenPage.createCDPSession();
cdp.on('Network.responseReceived', (params) => {
  if (params.response.url.includes('EPS') || params.response.url.includes('upload') || 
      params.response.url.includes('image/upload')) {
    console.log(`[NET] ${params.response.status} ${params.response.url.substring(0, 100)}`);
  }
});
await cdp.send('Network.enable');

// Modify the accept attribute and use file chooser
await brokenPage.evaluate(() => {
  const input = document.querySelector('#fehelix-uploader');
  if (input) {
    input.accept = 'image/*,image/heic,image/heif,video/mp4,video/quicktime';
    console.log('Accept modified to:', input.accept);
    
    // Also update the sellingUIUploader config
    const uploader = window.sellingUIUploader?.['fehelix-uploader'];
    if (uploader) {
      uploader.config.acceptImage = true;
      uploader.acceptImage = true;
      uploader.config.accept = 'image/*,image/heic,image/heif,video/mp4,video/quicktime';
    }
  }
});

const [fileChooser] = await Promise.all([
  brokenPage.waitForFileChooser({ timeout: 5000 }),
  brokenPage.evaluate(() => {
    const input = document.querySelector('#fehelix-uploader');
    if (input) input.click();
  })
]);

console.log('File chooser opened!');
await fileChooser.accept(['/tmp/test-photo-hack.jpg']);
console.log('File accepted!');

await new Promise(r => setTimeout(r, 15000));

// Check result
const result = await brokenPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return {
    photosCount: data.PHOTOS?.photosInput?.photos?.length,
    firstPhoto: data.PHOTOS?.photosInput?.photos?.[0]?.url?.substring(0, 80)
  };
});

console.log('Result:', JSON.stringify(result, null, 2));

browser.disconnect();
