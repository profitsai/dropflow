import puppeteer from 'puppeteer-core';
import fs from 'fs';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const workingPage = (await browser.pages()).find(p => p.url().includes('draftId=5053798596022'));

// Listen for console messages
workingPage.on('console', msg => {
  const text = msg.text();
  if (text.includes('upload') || text.includes('photo') || text.includes('EPS') || 
      text.includes('error') || text.includes('Error') || text.includes('image')) {
    console.log(`[CONSOLE ${msg.type()}] ${text.substring(0, 300)}`);
  }
});

// Download a larger image for upload (at least 500x500)
const extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));
const imageData = await extPage.evaluate(async () => {
  return await chrome.runtime.sendMessage({ 
    type: 'FETCH_IMAGE', 
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg' // Full res, no size suffix
  });
});

if (!imageData.success) {
  console.log('Image fetch failed:', imageData.error);
  // Try with a different URL format
  const imageData2 = await extPage.evaluate(async () => {
    return await chrome.runtime.sendMessage({ 
      type: 'FETCH_IMAGE', 
      url: 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_960x960.jpg'
    });
  });
  console.log('Retry result:', imageData2.success, imageData2.dataUrl?.length);
}

const base64 = (imageData.success ? imageData : imageData2 || imageData).dataUrl?.split(',')[1];
if (!base64) { console.log('No image data'); process.exit(1); }
const imgPath = '/tmp/test-photo-large.jpg';
fs.writeFileSync(imgPath, Buffer.from(base64, 'base64'));
console.log('Image saved:', fs.statSync(imgPath).size, 'bytes');

// Intercept network requests to see what happens
const cdp = await workingPage.createCDPSession();
cdp.on('Network.responseReceived', (params) => {
  if (params.response.url.includes('EPS') || params.response.url.includes('eps') || 
      params.response.url.includes('upload') || params.response.url.includes('image/upload')) {
    console.log(`[NET] ${params.response.status} ${params.response.url.substring(0, 100)}`);
  }
});
await cdp.send('Network.enable');

// Use file chooser interception  
const [fileChooser] = await Promise.all([
  workingPage.waitForFileChooser({ timeout: 5000 }),
  workingPage.evaluate(() => {
    const input = document.querySelector('#fehelix-uploader');
    if (input) input.click();
  })
]);

await fileChooser.accept([imgPath]);
console.log('File accepted, waiting for upload...');

// Wait longer for upload
await new Promise(r => setTimeout(r, 15000));

// Check result
const result = await workingPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  
  const imgs = document.querySelectorAll('img');
  const ebayImgs = Array.from(imgs).filter(i => i.src?.includes('ebayimg.com'));
  
  const uploaderState = window.sellingUIUploader?.['fehelix-uploader'];
  
  return {
    photosInput: data.PHOTOS?.photosInput,
    ebayImgCount: ebayImgs.length,
    ebayImgSrcs: ebayImgs.map(i => i.src.substring(0, 80)),
    uploaderTotal: uploaderState?.totalImagesCount,
    uploaderProcessed: uploaderState?.processedFiles?.length
  };
});

console.log('\nResult:', JSON.stringify(result, null, 2));

browser.disconnect();
