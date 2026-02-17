import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const brokenPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));
await brokenPage.reload({ waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 3000));

const info = await brokenPage.evaluate(() => ({
  fileInputAccept: document.querySelector('#fehelix-uploader')?.accept,
  fileInputCount: document.querySelectorAll('input[type="file"]').length,
  allInputAccepts: Array.from(document.querySelectorAll('input[type="file"]')).map(i => ({ id: i.id, accept: i.accept })),
  photosHeader: document.querySelector('.summary__photos h2')?.textContent?.trim()
}));

console.log(JSON.stringify(info, null, 2));

browser.disconnect();
