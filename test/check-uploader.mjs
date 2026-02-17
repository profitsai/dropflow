import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const uploaderInfo = await ebayPage.evaluate(() => {
  const uploader = window.sellingUIUploader;
  if (!uploader) return { error: 'no sellingUIUploader' };
  
  const keys = Object.keys(uploader);
  const details = {};
  for (const key of keys) {
    const u = uploader[key];
    details[key] = {
      type: typeof u,
      methods: u ? Object.getOwnPropertyNames(Object.getPrototypeOf(u)).filter(m => typeof u[m] === 'function').slice(0, 20) : [],
      props: u ? Object.keys(u).slice(0, 20) : []
    };
  }
  
  return { keys, details };
});

console.log(JSON.stringify(uploaderInfo, null, 2));

browser.disconnect();
