import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Check the Marko component tree by looking at internal DOM properties
const result = await ebayPage.evaluate(() => {
  // Try to find components by checking all DOM elements for internal Marko properties
  const found = [];
  const stack = [document.body];
  const checked = new Set();
  
  while (stack.length > 0 && found.length < 50) {
    const el = stack.pop();
    if (!el || checked.has(el)) continue;
    checked.add(el);
    
    // Check all properties (including non-enumerable)
    try {
      const allProps = Object.getOwnPropertyNames(el);
      for (const prop of allProps) {
        if (prop.length > 20) continue; // Skip long props
        try {
          const val = el[prop];
          if (val && typeof val === 'object' && val.state && typeof val.emit === 'function') {
            const stateKeys = Object.keys(val.state);
            const hasPhotos = stateKeys.includes('photos') || stateKeys.includes('files');
            const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(val))
              .filter(m => typeof val[m] === 'function')
              .slice(0, 20);
            
            found.push({
              prop,
              tag: el.tagName,
              id: el.id?.substring(0, 30),
              class: el.className?.toString().substring(0, 40),
              stateKeys,
              hasPhotos,
              methods
            });
          }
        } catch(e) {}
      }
    } catch(e) {}
    
    // Add children to stack
    for (const child of el.children || []) {
      stack.push(child);
    }
  }
  
  return found;
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
