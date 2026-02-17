import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const result = await ebayPage.evaluate(() => {
  const wpr = window.widget_platform_renderedComponents;
  if (!wpr) return 'not found';
  
  // Check the 'w' property - might be widget list
  const w = wpr.w;
  if (Array.isArray(w)) {
    return { wIsArray: true, wLength: w.length, wEntries: w.slice(0, 5).map(e => JSON.stringify(e).substring(0, 100)) };
  }
  
  // Check all properties
  const details = {};
  for (const key of Object.keys(wpr)) {
    const val = wpr[key];
    details[key] = { 
      type: typeof val, 
      isArray: Array.isArray(val),
      length: val?.length,
      value: JSON.stringify(val)?.substring(0, 200)
    };
  }
  
  return details;
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
