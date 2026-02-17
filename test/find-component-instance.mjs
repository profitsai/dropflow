import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const result = await ebayPage.evaluate(() => {
  // In Marko 4, components are stored in a global registry
  // The registry is typically in window.$initComponents or similar
  
  // Check what $initComponents does
  const initComp = window.$initComponents;
  
  // Try to find the component tree
  // In Marko 4, components have a unique ID and are stored on DOM nodes
  // The component is stored on the root element via ___markoComponent or similar
  
  // Let's try walking all DOM elements and checking for Marko-specific properties
  const body = document.body;
  const allEls = body.querySelectorAll('*');
  
  const componentEls = [];
  for (const el of allEls) {
    // Check for Marko component reference (different Marko versions use different names)
    const markoComp = el.___markoComponent || el.__markoComponent || el._component;
    if (markoComp && typeof markoComp === 'object') {
      const hasUpdatePhotos = typeof markoComp.updatePhotos === 'function';
      const hasState = !!markoComp.state;
      const statePhotos = markoComp.state?.photos;
      
      componentEls.push({
        tag: el.tagName,
        id: el.id?.substring(0, 30),
        class: el.className?.toString().substring(0, 60),
        hasUpdatePhotos,
        hasState,
        stateKeys: hasState ? Object.keys(markoComp.state).slice(0, 10) : [],
        photos: statePhotos ? statePhotos.length : undefined,
        methods: Object.getOwnPropertyNames(Object.getPrototypeOf(markoComp))
          .filter(m => typeof markoComp[m] === 'function')
          .slice(0, 15)
      });
      
      if (componentEls.length >= 30) break;
    }
  }
  
  return { componentCount: componentEls.length, components: componentEls };
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
