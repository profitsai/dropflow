import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const cdp = await ebayPage.createCDPSession();
await cdp.send('Debugger.enable');
const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: '1082' });

const line140 = scriptSource.split('\n')[140];

// Search for uploadFile method (might not be "async")
let searchIdx = 0;
while (true) {
  const idx = line140.indexOf('uploadFile(', searchIdx);
  if (idx === -1) break;
  
  const before = line140.substring(Math.max(0, idx - 30), idx);
  // Skip the call sites, find the definition
  if (before.includes('}') || before.includes('async') || before.endsWith(' ')) {
    console.log('Found at', idx);
    console.log('Before:', before);
    console.log(line140.substring(idx, idx + 1500));
    console.log('---');
  }
  searchIdx = idx + 1;
}

browser.disconnect();
