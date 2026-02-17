import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Check Marko.Component for hints about how components are stored
const result = await ebayPage.evaluate(() => {
  const MarkoComp = window.Marko?.Component;
  if (!MarkoComp) return { error: 'no Marko.Component' };
  
  // Check prototype
  const proto = MarkoComp.prototype;
  const methods = Object.getOwnPropertyNames(proto).filter(m => typeof proto[m] === 'function');
  
  // Check for component lookup
  // Try window.require for marko modules
  let req = null;
  try {
    if (typeof window.require === 'function') {
      req = Object.keys(window.require.cache || {}).filter(k => k.includes('component')).slice(0, 5);
    }
  } catch(e) {}
  
  // Check $initComponents source
  const initSrc = window.$initComponents?.toString().substring(0, 500);
  
  return { methods, req, initSrc };
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
