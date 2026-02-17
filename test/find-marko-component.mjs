import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const result = await ebayPage.evaluate(() => {
  // Marko components are stored on DOM elements via internal properties
  // Try to find the photo component by walking the DOM
  
  function findMarkoComponent(el, maxDepth = 10) {
    if (!el || maxDepth <= 0) return null;
    
    // Check for Marko component reference
    for (const key of Object.keys(el)) {
      if (key.startsWith('$w') || key.startsWith('__component') || key === '___component') {
        return { key, el: el.tagName + '.' + (el.className?.toString().substring(0, 50) || '') };
      }
    }
    
    // Also check non-enumerable properties
    const desc = Object.getOwnPropertyNames(el);
    for (const key of desc) {
      if (key.startsWith('$w') || key === '___component') {
        return { key, el: el.tagName + '.' + (el.className?.toString().substring(0, 50) || '') };
      }
    }
    
    return findMarkoComponent(el.parentElement, maxDepth - 1);
  }
  
  // Try all elements in the page that might have photo components
  const photoSection = document.querySelector('.summary__photos');
  const allElements = photoSection ? Array.from(photoSection.querySelectorAll('*')) : [];
  allElements.unshift(photoSection);
  
  for (const el of allElements) {
    if (!el) continue;
    const result = findMarkoComponent(el, 3);
    if (result) return result;
  }
  
  // Fallback: check ALL elements in document for Marko components
  const allDocElements = document.querySelectorAll('*');
  const markoElements = [];
  for (const el of allDocElements) {
    for (const key of Object.keys(el)) {
      if (key.startsWith('$w')) {
        markoElements.push({ 
          key, 
          tag: el.tagName, 
          class: el.className?.toString().substring(0, 60),
          methods: Object.keys(el[key] || {}).filter(k => typeof el[key][k] === 'function').slice(0, 10)
        });
        break;
      }
    }
    if (markoElements.length >= 20) break;
  }
  
  return { foundInPhotoSection: false, markoElements };
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
