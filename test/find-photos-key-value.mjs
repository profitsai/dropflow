import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

const result = await ebayPage.evaluate(async () => {
  const resp = await fetch('https://ir.ebaystatic.com/rs/c/fehelix/list_qAKT.4e655b28.js');
  const text = await resp.text();
  
  // Search for at.PHOTOS_KEY definition
  // at is likely a module with constants
  // Search for "PHOTOS_KEY:" or PHOTOS_KEY="
  const results = [];
  
  for (const pattern of [
    /PHOTOS_KEY\s*[:=]\s*["']([^"']+)["']/,
    /PHOTOS_KEY\s*[:=]\s*([a-zA-Z_]+)/
  ]) {
    const match = text.match(pattern);
    if (match) {
      results.push({ pattern: pattern.toString(), match: match[0], value: match[1] });
    }
  }
  
  // Search for the constant definition module
  let idx = text.indexOf('PHOTOS_KEY:');
  if (idx === -1) idx = text.indexOf('PHOTOS_KEY=');
  if (idx > -1) {
    results.push({ ctx: text.substring(Math.max(0, idx - 100), idx + 200) });
  }
  
  // Also find gn and iS variable names (the event names)
  // gn is DELTA_CHANGE event name
  idx = text.indexOf('{OPEN_PANEL_MODAL:tS,DELTA_CHANGE:iS,VALUE_CHANGE:Lw');
  if (idx > -1) {
    results.push({ events: text.substring(idx, idx + 200) });
  }
  
  return results;
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
