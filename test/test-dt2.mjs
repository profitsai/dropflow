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

// Test DataTransfer more carefully
const result = await workingPage.evaluate(async (dataUrl) => {
  const [header, b64] = dataUrl.split(',');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const file = new File([blob], 'test.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  
  // Method 1: DataTransfer on existing input
  const input = document.querySelector('#fehelix-uploader');
  const dt = new DataTransfer();
  dt.items.add(file);
  
  // Check if DataTransfer has the file
  const dtInfo = { dtFileCount: dt.files.length, dtFileSize: dt.files[0]?.size };
  
  // Set files
  input.files = dt.files;
  const afterSet = { inputFiles: input.files.length };
  
  // Method 2: Create a new input element
  const newInput = document.createElement('input');
  newInput.type = 'file';
  newInput.accept = 'image/*';
  const dt2 = new DataTransfer();
  dt2.items.add(file);
  newInput.files = dt2.files;
  const newInputResult = { newInputFiles: newInput.files.length };
  
  return { dtInfo, afterSet, newInputResult };
}, imageData.dataUrl);

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
