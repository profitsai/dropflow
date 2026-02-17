import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const cdp = await ebayPage.createCDPSession();
await cdp.send('Debugger.enable');
const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: '1082' });

// Find uploadFiles function  
const lines = scriptSource.split('\n');
const line140 = lines[140];

// Search for uploadFiles definition
const uploadFilesIdx = line140.indexOf('uploadFiles(');
if (uploadFilesIdx > -1) {
  // Find the specific function body
  const search = line140.substring(uploadFilesIdx);
  // Find the function that starts with "async uploadFiles" or just "uploadFiles"
  console.log(search.substring(0, 800));
}

// Also search for the uploadFile method (called per-file)
const uploadFileIdx = line140.indexOf('async uploadFile(');
if (uploadFileIdx > -1) {
  console.log('\n=== uploadFile ===');
  console.log(line140.substring(uploadFileIdx, uploadFileIdx + 1000));
}

browser.disconnect();
