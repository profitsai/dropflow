import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const result = await ebayPage.evaluate(() => {
  // The Marko component stores itself on the DOM element as el.___markoComponent_
  // or via the component ID. Let me check with the right property name.
  
  // In Marko 4, the component lookup key is based on the component ID
  // Elements with id like "s0-1-0-24-..." have components stored with "__component_" prefix
  
  // Let's check elements with IDs that match eBay's component ID pattern
  const idsToCheck = [];
  document.querySelectorAll('[id^="s0-"]').forEach(el => {
    if (el.id.length < 30) idsToCheck.push(el.id);
  });
  
  // For each element, check ALL property keys for component references
  const found = [];
  for (const id of idsToCheck.slice(0, 50)) {
    const el = document.getElementById(id);
    if (!el) continue;
    
    const allKeys = [];
    for (const key in el) {
      if (typeof el[key] === 'object' && el[key] !== null && key.length < 30) {
        try {
          if (el[key].state || el[key].emit || el[key].__marko) {
            allKeys.push(key);
          }
        } catch(e) {}
      }
    }
    
    if (allKeys.length > 0) {
      found.push({ id, keys: allKeys });
    }
  }
  
  // Also try directly: Marko 4 uses document.getElementById(id).component
  // or el.__component
  // But eBay uses a webpack build that may rename these
  
  // Alternative: Look for the Redux/Flux store pattern
  // The code shows events being dispatched - there might be a central store
  
  // Search for the component registry in Marko's internals
  // The $initComponents function seems to contain the registry logic
  // It uses _A_ and _B_ methods
  
  // Let me try to search for the actual photo model update mechanism
  // The `updatePhotos` function emits VALUE_CHANGE with type VARIATIONS_PHOTOS_UPDATE
  // and DELTA_CHANGE. These are Redux-like actions dispatched to a store.
  
  // Check if there's a dispatch function or store accessible via the page
  const hasDispatch = typeof window.dispatch;
  const hasGetState = typeof window.getState;
  
  return { found: found.slice(0, 10), hasDispatch, hasGetState, idCount: idsToCheck.length };
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
