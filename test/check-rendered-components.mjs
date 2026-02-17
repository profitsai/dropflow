import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const result = await ebayPage.evaluate(() => {
  // Check widget_platform_renderedComponents
  const wpr = window.widget_platform_renderedComponents;
  if (wpr) {
    return { 
      type: typeof wpr,
      isArray: Array.isArray(wpr),
      keys: Object.keys(wpr).slice(0, 20),
      length: wpr.length,
      first: wpr[0] ? JSON.stringify(wpr[0]).substring(0, 200) : null,
      entries: Array.isArray(wpr) ? wpr.map(e => JSON.stringify(e).substring(0, 100)).slice(0, 10) : null
    };
  }
  
  // Check $affehelix
  const af = window.$affehelix;
  const afType = typeof af;
  let afResult = null;
  if (af && typeof af === 'function') {
    try { afResult = af.toString().substring(0, 200); } catch(e) {}
  } else if (af && typeof af === 'object') {
    afResult = Object.keys(af).slice(0, 20);
  }
  
  return { wpr: 'not found', afType, afResult };
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
