import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

let extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));
if (!extPage) {
  extPage = await browser.newPage();
  await extPage.goto('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci/pages/ali-bulk-lister/ali-bulk-lister.html');
  await new Promise(r => setTimeout(r, 2000));
}

const allKeys = await extPage.evaluate(async () => {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all);
});
console.log('All storage keys:', allKeys);

browser.disconnect();
