import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Search eBay's page scripts for photo upload URL patterns
const scriptInfo = await ebayPage.evaluate(() => {
  // Get all script sources
  const scripts = Array.from(document.querySelectorAll('script[src]'))
    .map(s => s.src)
    .filter(s => s.includes('uploader') || s.includes('photo') || s.includes('image') || s.includes('media'));
  
  // Also search inline scripts for upload-related URLs
  const inlineMatches = [];
  document.querySelectorAll('script:not([src])').forEach(s => {
    const text = s.textContent;
    if (text.includes('upload') || text.includes('photo') || text.includes('EPS')) {
      const urlMatches = text.match(/["'](\/[^"']*(?:upload|photo|image|eps|media)[^"']*?)["']/gi);
      if (urlMatches) inlineMatches.push(...urlMatches.slice(0, 5));
    }
  });
  
  // Check for global config/state that might contain upload URLs
  const globals = {};
  const checkGlobals = ['__LISTING_CONFIG__', '__NEXT_DATA__', 'SellCoreConfig', 'helix', '__helix'];
  for (const g of checkGlobals) {
    if (window[g]) {
      globals[g] = JSON.stringify(window[g]).substring(0, 300);
    }
  }
  
  // Check for Marko component state that handles photos
  // eBay uses Marko (not React) for their listing form
  const photoComponents = [];
  document.querySelectorAll('[data-widget-id]').forEach(el => {
    const cls = el.className?.toString() || '';
    if (cls.includes('photo') || cls.includes('uploader') || cls.includes('image')) {
      photoComponents.push({ 
        widgetId: el.getAttribute('data-widget-id'),
        class: cls.substring(0, 80)
      });
    }
  });
  
  return { scripts, inlineMatches, globals, photoComponents };
});

console.log(JSON.stringify(scriptInfo, null, 2));

// Also search for the Helix photo framework JS bundle
const allScripts = await ebayPage.evaluate(() => {
  return Array.from(document.querySelectorAll('script[src]'))
    .map(s => s.src)
    .filter(s => s.includes('helix') || s.includes('listing') || s.includes('lstng'));
});
console.log('\nListing-related scripts:', JSON.stringify(allScripts, null, 2));

browser.disconnect();
