import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const cdp = await ebayPage.createCDPSession();

// Get script source
const { scriptSource } = await cdp.send('Debugger.enable');
const { scriptSource: src } = await cdp.send('Debugger.getScriptSource', { scriptId: '1082' });

// Get the handler code around line 140, col 13480
const lines = src.split('\n');
const line140 = lines[140] || '';
const handlerContext = line140.substring(Math.max(0, 13480 - 200), 13480 + 500);

console.log('Handler context:');
console.log(handlerContext);

browser.disconnect();
