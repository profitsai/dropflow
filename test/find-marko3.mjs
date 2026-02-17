import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const result = await ebayPage.evaluate(() => {
  // Check data-marko-key elements
  const markoKeyEls = document.querySelectorAll('[data-marko-key]');
  const keyInfo = Array.from(markoKeyEls).map(el => ({
    tag: el.tagName,
    key: el.getAttribute('data-marko-key'),
    class: el.className?.toString().substring(0, 60),
    id: el.id
  }));
  
  // Check window.Marko for component registry access
  const markoObj = window.Marko;
  const markoKeys = markoObj ? Object.keys(markoObj) : [];
  
  // Try to access Marko's component tree
  // Marko 4 uses __marko_component on DOM elements
  const photoSection = document.querySelector('.summary__photos');
  let comp = null;
  if (photoSection) {
    // Walk up the tree looking for __marko* properties
    let el = photoSection;
    while (el) {
      const ownProps = Object.getOwnPropertyNames(el);
      const markoProps = ownProps.filter(p => p.includes('marko') || p.includes('component'));
      if (markoProps.length > 0) {
        comp = { el: el.tagName + '#' + el.id, markoProps };
        break;
      }
      el = el.parentElement;
    }
  }
  
  // Check window.$initComponents() to see if it reveals component instances
  let componentList = null;
  try {
    // This might be a function that initializes components
    componentList = typeof window.$initComponents;
  } catch(e) {}
  
  // Check for Redux store on the page
  const hasReduxStore = typeof window.__REDUX_STORE__;
  const hasStore = typeof window.store;
  
  // Check for eBay's Helix store
  let helixStore = null;
  for (const key of Object.keys(window)) {
    if (key.includes('store') || key.includes('Store') || key.includes('redux') || key.includes('Redux')) {
      helixStore = key;
      break;
    }
  }
  
  return { keyInfo, markoKeys, comp, componentList, hasReduxStore, hasStore, helixStore };
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
