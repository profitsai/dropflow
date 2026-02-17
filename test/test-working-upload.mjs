import puppeteer from 'puppeteer-core';
import fs from 'fs';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

// Download image
const extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));
const imageData = await extPage.evaluate(async () => {
  return await chrome.runtime.sendMessage({ 
    type: 'FETCH_IMAGE', 
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_640x640.jpg' 
  });
});
const base64 = imageData.dataUrl.split(',')[1];
const imgPath = '/tmp/test-photo.jpg';
fs.writeFileSync(imgPath, Buffer.from(base64, 'base64'));

// Test on the working listing (no variations, file input accepts images)
const workingPage = (await browser.pages()).find(p => p.url().includes('draftId=5053798596022'));
if (!workingPage) { console.log('Working page not found'); process.exit(1); }

// Use Puppeteer's file chooser interception
const [fileChooser] = await Promise.all([
  workingPage.waitForFileChooser({ timeout: 5000 }),
  workingPage.evaluate(() => {
    const input = document.querySelector('#fehelix-uploader');
    if (input) input.click();
  })
]);

console.log('File chooser opened! isMultiple:', fileChooser.isMultiple());
await fileChooser.accept([imgPath]);
console.log('File accepted!');

// Wait for upload
await new Promise(r => setTimeout(r, 10000));

// Check if photo was uploaded
const afterUpload = await workingPage.evaluate(() => {
  const imgs = document.querySelectorAll('.summary__photos img');
  const ebayImgs = Array.from(imgs).filter(i => i.src.includes('ebayimg.com'));
  return {
    totalImgs: imgs.length,
    ebayImgs: ebayImgs.length,
    ebayImgSrcs: ebayImgs.map(i => i.src.substring(0, 80)),
    uploaderText: document.querySelector('.summary__photos')?.innerText?.substring(0, 200)
  };
});

console.log('After upload:', JSON.stringify(afterUpload, null, 2));

browser.disconnect();
