import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const result = await ebayPage.evaluate(() => {
  // Marko 4+ uses data attributes and global component registry
  // Check for global Marko references
  const globals = [];
  for (const key of Object.keys(window)) {
    if (key.includes('marko') || key.includes('component') || key.includes('Marko') || 
        key === '$components' || key === '__components') {
      globals.push(key);
    }
  }
  
  // Check for Marko's internal registry
  // In Marko 4, components are tracked via data-marko attributes
  const markoElements = document.querySelectorAll('[data-marko]');
  const markoKeyElements = document.querySelectorAll('[data-marko-key]');
  
  // Also check for the component lookup
  // Marko 4's window.$initComponents or window.$components
  const initComponents = typeof window.$initComponents;
  const registry = typeof window.$c;
  
  // Look at the photo section's DOM for any hidden properties
  const photoSection = document.querySelector('.summary__photos');
  if (photoSection) {
    const el = photoSection.firstElementChild;
    if (el) {
      const allProps = Object.getOwnPropertyNames(el);
      const hiddenProps = allProps.filter(p => p.startsWith('_') || p.startsWith('$'));
      globals.push('photo-child-props: ' + JSON.stringify(hiddenProps));
    }
  }
  
  // Check if triggerUploadFromExternal exists (seen in the code)
  const hasTrigger = typeof window.triggerUploadFromExternal;
  
  // Check for window.hasOwnProperty("triggerHelixPhotoUpload")
  const hasTriggerHelix = 'triggerHelixPhotoUpload' in window;
  const hasTriggerUpload = 'triggerUploadFromExternal' in window;
  
  return { 
    globals: globals.slice(0, 10), 
    markoElementCount: markoElements.length,
    markoKeyCount: markoKeyElements.length,
    initComponents,
    registry,
    hasTrigger,
    hasTriggerHelix,
    hasTriggerUpload
  };
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
