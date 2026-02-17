import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));
const imageData = await extPage.evaluate(async () => {
  return await chrome.runtime.sendMessage({ 
    type: 'FETCH_IMAGE', 
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_640x640.jpg' 
  });
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Search eBay's JS for the EPS upload configuration
const epsConfig = await ebayPage.evaluate(() => {
  // Search all inline scripts for EPS-related configuration
  const scripts = document.querySelectorAll('script:not([src])');
  const epsMatches = [];
  for (const s of scripts) {
    const text = s.textContent;
    if (text.includes('EpsBasic') || text.includes('eps') || text.includes('EPS') || text.includes('photoUpload')) {
      // Extract relevant context around the match
      const patterns = [
        /photoUpload[^}]{0,300}/g,
        /EpsBasic[^}]{0,300}/g,
        /uploadUrl[^}]{0,200}/g,
        /epsUrl[^}]{0,200}/g,
        /"token"[^}]{0,200}/g
      ];
      for (const p of patterns) {
        const matches = text.match(p);
        if (matches) epsMatches.push(...matches.map(m => m.substring(0, 200)));
      }
    }
  }
  
  // Also check for Marko component widget config
  const widgets = document.querySelectorAll('[data-w-config]');
  const widgetConfigs = [];
  for (const w of widgets) {
    const config = w.getAttribute('data-w-config');
    if (config && (config.includes('photo') || config.includes('upload') || config.includes('eps'))) {
      widgetConfigs.push(config.substring(0, 300));
    }
  }
  
  return { epsMatches, widgetConfigs };
});

console.log(JSON.stringify(epsConfig, null, 2));

// Also search the fehelix JS bundles for EPS upload params
// Look at the main listing bundle
const bundleUrl = 'https://ir.ebaystatic.com/rs/c/fehelix/list_qAKT.4e655b28.js';
const bundleContent = await ebayPage.evaluate(async (url) => {
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    // Search for EPS-related code
    const matches = [];
    const patterns = [
      /EpsBasic[^;]{0,200}/g,
      /uploadUrl[^;]{0,200}/g,
      /photoUpload[^;]{0,200}/g,
      /formData[^;]{0,200}/g,
    ];
    for (const p of patterns) {
      const found = text.match(p);
      if (found) matches.push(...found.map(m => m.substring(0, 150)));
    }
    return { length: text.length, matches };
  } catch(e) { return { error: e.message }; }
}, bundleUrl);

console.log('\nBundle analysis:', JSON.stringify(bundleContent, null, 2));

browser.disconnect();
