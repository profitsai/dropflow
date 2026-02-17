import puppeteer from 'puppeteer-core';
import fs from 'fs';

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

// Save to temp file
const base64 = imageData.dataUrl.split(',')[1];
const imgPath = '/tmp/test-photo.jpg';
fs.writeFileSync(imgPath, Buffer.from(base64, 'base64'));

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Try using the sellingUIUploader's uploadFiles method with a photo
// First reconfigure it to accept images
const result = await ebayPage.evaluate(async (dataUrl) => {
  const uploader = window.sellingUIUploader?.['fehelix-uploader'];
  if (!uploader) return { error: 'no uploader' };
  
  // Check if we can modify the config
  const originalAcceptImage = uploader.config.acceptImage;
  const originalAccept = uploader.config.accept;
  
  // Temporarily reconfigure to accept images
  uploader.config.acceptImage = true;
  uploader.acceptImage = true;
  uploader.config.accept = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';
  
  // Update the input element too
  if (uploader.input) {
    uploader.input.accept = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';
  }
  
  // Create a File object from the data URL
  const [header, b64] = dataUrl.split(',');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const file = new File([blob], 'product-photo-1.jpg', { type: 'image/jpeg' });
  
  // Try calling uploadFiles
  try {
    const uploadResult = uploader.uploadFiles([file]);
    return { 
      success: true, 
      uploadResult: String(uploadResult),
      reconfigured: true
    };
  } catch(e) {
    return { error: e.message, stack: e.stack?.substring(0, 300) };
  }
}, imageData.dataUrl);

console.log('Upload result:', JSON.stringify(result, null, 2));

// Wait and check if something happened
await new Promise(r => setTimeout(r, 5000));

// Check for any changes
const afterCheck = await ebayPage.evaluate(() => {
  const uploader = window.sellingUIUploader?.['fehelix-uploader'];
  return {
    totalImagesCount: uploader?.totalImagesCount,
    totalVideosCount: uploader?.totalVideosCount,
    processedFiles: uploader?.processedFiles?.length || 0
  };
});

console.log('After check:', JSON.stringify(afterCheck, null, 2));

browser.disconnect();
