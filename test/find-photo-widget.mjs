import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const result = await ebayPage.evaluate(() => {
  const wpr = window.widget_platform_renderedComponents;
  const w = wpr?.w;
  if (!Array.isArray(w)) return 'no widgets';
  
  const photoWidgets = [];
  for (let i = 0; i < w.length; i++) {
    const entry = w[i];
    const str = JSON.stringify(entry);
    if (str.includes('Photo') || str.includes('photo') || str.includes('PHOTO') || 
        str.includes('uploader') || str.includes('image') || str.includes('EPS')) {
      photoWidgets.push({ index: i, entry: str.substring(0, 500) });
    }
  }
  
  return { total: w.length, photoWidgets };
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
