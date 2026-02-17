import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Find the setup function in the uploader code
const result = await ebayPage.evaluate(async () => {
  const resp = await fetch('https://ir.ebaystatic.com/rs/c/fehelix/422.b01313ac.js');
  const text = await resp.text();
  
  // Find the setup method
  const idx = text.indexOf('setup(');
  if (idx === -1) return { error: 'no setup' };
  
  // Get context around setup
  return { setup: text.substring(idx, idx + 1000) };
});

console.log(result.setup?.substring(0, 800));

browser.disconnect();
