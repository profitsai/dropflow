import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Find what event handler is on the file input for change events
const result = await ebayPage.evaluate(() => {
  const input = document.querySelector('#fehelix-uploader');
  if (!input) return { error: 'no input' };
  
  // Check for addEventListener-based handlers
  // We can't directly access them, but we can check React/Marko event delegation
  
  // Check parent elements for event handlers
  let el = input;
  const handlers = [];
  while (el) {
    const events = el.onchange || el.oninput;
    if (events) handlers.push({ tag: el.tagName, class: el.className?.substring(0, 50), handler: 'onchange/oninput' });
    
    // Check for Marko event bindings (data-w-on* attributes)
    const attrs = Array.from(el.attributes || []);
    for (const attr of attrs) {
      if (attr.name.startsWith('data-w-on') || attr.name.includes('change') || attr.name.includes('event')) {
        handlers.push({ tag: el.tagName, attr: attr.name, value: attr.value?.substring(0, 80) });
      }
    }
    el = el.parentElement;
    if (handlers.length > 5) break;
  }
  
  // Check for the uploader's event handling
  const uploader = window.sellingUIUploader?.['fehelix-uploader'];
  if (uploader) {
    // Check if it has a browse/change handler
    const browseStr = uploader.browse?.toString().substring(0, 300);
    const hasChangeListener = !!uploader.input?._changeListener;
    
    return { handlers, browseStr, hasChangeListener, uploaderProps: Object.keys(uploader) };
  }
  
  return { handlers };
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
