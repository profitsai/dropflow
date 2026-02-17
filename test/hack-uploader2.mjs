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

// Listen to console for errors
ebayPage.on('console', msg => {
  if (msg.type() === 'error' || msg.text().includes('upload') || msg.text().includes('photo') || msg.text().includes('EPS')) {
    console.log(`[CONSOLE ${msg.type()}] ${msg.text()}`);
  }
});

const result = await ebayPage.evaluate(async (dataUrl) => {
  const uploader = window.sellingUIUploader?.['fehelix-uploader'];
  if (!uploader) return { error: 'no uploader' };
  
  // Reconfigure
  uploader.config.acceptImage = true;
  uploader.acceptImage = true;
  uploader.config.accept = 'image/jpeg,image/png,image/webp';
  if (uploader.input) {
    uploader.input.accept = 'image/jpeg,image/png,image/webp';
  }
  
  // Create File
  const [header, b64] = dataUrl.split(',');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const file = new File([blob], 'product-photo-1.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  
  // Listen for events from the emitter
  const events = [];
  const origEmit = uploader.emitter.emit.bind(uploader.emitter);
  uploader.emitter.emit = function(eventName, ...args) {
    events.push({ event: eventName, args: JSON.stringify(args).substring(0, 200) });
    return origEmit(eventName, ...args);
  };
  
  try {
    const promise = uploader.uploadFiles([file]);
    const uploadResult = await promise;
    return { 
      success: true, 
      result: JSON.stringify(uploadResult)?.substring(0, 300),
      events,
      totalImages: uploader.totalImagesCount,
      totalVideos: uploader.totalVideosCount
    };
  } catch(e) {
    return { error: e.message, stack: e.stack?.substring(0, 500), events };
  }
}, imageData.dataUrl);

console.log('Result:', JSON.stringify(result, null, 2));

browser.disconnect();
