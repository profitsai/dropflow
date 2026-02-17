import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const result = await ebayPage.evaluate(() => {
  // Marko uses __marko on elements for component tree
  // Let's check Symbol properties too
  const body = document.body;
  
  // Check for Symbol-based properties on elements
  const symbolCheck = [];
  const el = document.querySelector('.summary__photos');
  if (el) {
    const symbols = Object.getOwnPropertySymbols(el);
    symbolCheck.push({ tag: 'summary__photos', symbols: symbols.map(s => s.toString()) });
    
    // Check parent
    const parent = el.parentElement;
    if (parent) {
      const parentSymbols = Object.getOwnPropertySymbols(parent);
      symbolCheck.push({ tag: 'parent', symbols: parentSymbols.map(s => s.toString()) });
    }
  }
  
  // Also try to find the global component registry
  // Check window for any component lookup functions
  const windowFunctions = [];
  for (const key of Object.getOwnPropertyNames(window)) {
    try {
      if (typeof window[key] === 'function' && key.length < 20 && key.startsWith('$')) {
        windowFunctions.push(key);
      }
    } catch(e) {}
  }
  
  // Check if Marko stores components under a different global
  const markoGlobals = [];
  for (const key of Object.getOwnPropertyNames(window)) {
    if (key.toLowerCase().includes('component') || key.toLowerCase().includes('marko') ||
        key === '$MK' || key === '$C' || key === '$c') {
      markoGlobals.push(key);
    }
  }
  
  return { symbolCheck, windowFunctions, markoGlobals };
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
