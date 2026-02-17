import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const cdp = await ebayPage.createCDPSession();
await cdp.send('Debugger.enable');
const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: '1082' });

const line140 = scriptSource.split('\n')[140];

// Find uploadFile method
const idx = line140.indexOf('async uploadFile(');
if (idx > -1) {
  console.log(line140.substring(idx, idx + 2000));
}

browser.disconnect();
