import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const cdp = await ebayPage.createCDPSession();
await cdp.send('Debugger.enable');
const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: '1082' });

const line140 = scriptSource.split('\n')[140];

// Find the actual uploadFiles method definition (not the call)
// Search for "uploadFiles(" that's preceded by a function-like context
let searchIdx = 0;
const matches = [];
while (true) {
  const idx = line140.indexOf('uploadFiles(', searchIdx);
  if (idx === -1) break;
  
  // Check if this is a definition (preceded by space, =, or {)
  const before = line140.substring(Math.max(0, idx - 20), idx);
  if (before.includes('async ') || before.includes('}') || before.includes('{')) {
    matches.push({ idx, before, code: line140.substring(idx, idx + 1000) });
  }
  searchIdx = idx + 1;
}

for (const m of matches) {
  console.log('=== uploadFiles ===');
  console.log('Before:', m.before);
  console.log(m.code.substring(0, 800));
  console.log('---');
}

// Also search for "isVideo" in the upload logic to understand how images vs videos are filtered
const isVideoIdx = line140.indexOf('isVideo');
if (isVideoIdx > -1) {
  // Find nearby context
  const context = line140.substring(Math.max(0, isVideoIdx - 200), isVideoIdx + 200);
  console.log('\n=== isVideo context ===');
  console.log(context);
}

browser.disconnect();
