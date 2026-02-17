import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Search the fehelix JS for how FormData is constructed for EPS upload
const bundleUrl = 'https://ir.ebaystatic.com/rs/c/fehelix/list_qAKT.4e655b28.js';
const epsCode = await ebayPage.evaluate(async (url) => {
  const resp = await fetch(url);
  const text = await resp.text();
  
  // Find the EPS upload function - search for FormData usage near "EpsBasic"
  const matches = [];
  
  // Search for FormData.append patterns
  const fdMatches = text.match(/FormData[^}]{0,500}/g);
  if (fdMatches) matches.push(...fdMatches.slice(0, 5).map(m => m.substring(0, 300)));
  
  // Search for "file" field name in append calls
  const appendMatches = text.match(/\.append\([^)]+\)/g);
  if (appendMatches) {
    const fileAppends = appendMatches.filter(m => m.includes('"file"') || m.includes("'file'") || m.includes('file'));
    matches.push(...fileAppends.slice(0, 10));
  }
  
  // Also search for the function that calls EpsBasic
  const epsIdx = text.indexOf('EpsBasic');
  if (epsIdx > -1) {
    // Get surrounding context (2000 chars before and after)
    const start = Math.max(0, epsIdx - 1000);
    const end = Math.min(text.length, epsIdx + 1000);
    matches.push('=== EPS CONTEXT ===');
    matches.push(text.substring(start, end));
  }
  
  return matches;
}, bundleUrl);

for (const m of epsCode) {
  console.log(m.substring(0, 500));
  console.log('---');
}

browser.disconnect();
