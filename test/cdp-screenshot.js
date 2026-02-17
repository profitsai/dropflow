const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  if (!ebayPage) { console.log('No eBay page found. URLs:', pages.map(p=>p.url())); process.exit(1); }
  console.log('Found:', ebayPage.url());
  await ebayPage.screenshot({ path: '/tmp/ebay-current.png', fullPage: false });
  
  // Get draft API data
  const draftData = await ebayPage.evaluate(() => {
    return fetch('/lstng/api/listing_draft/5054299089522?mode=AddItem').then(r=>r.json()).catch(e=>e.message);
  });
  require('fs').writeFileSync('/tmp/ebay-draft.json', JSON.stringify(draftData, null, 2));
  
  // Get extension storage
  const storageData = await ebayPage.evaluate(() => {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get(['dropflow_variation_log', 'dropflow_last_fill_results', 'dropflow_product_data'], resolve);
      } catch(e) { resolve({error: e.message}); }
    });
  }).catch(e => ({error: e.message}));
  require('fs').writeFileSync('/tmp/ebay-storage.json', JSON.stringify(storageData, null, 2));
  
  // Check condition elements
  const conditionInfo = await ebayPage.evaluate(() => {
    const els = document.querySelectorAll('[data-testid*="condition"], [class*="condition"], [id*="condition"], select[name*="condition"], [data-testid*="CONDITION"]');
    return Array.from(els).map(e => ({tag: e.tagName, id: e.id, testid: e.dataset?.testid, class: e.className?.substring?.(0,80), text: e.textContent?.substring(0,100)}));
  });
  require('fs').writeFileSync('/tmp/ebay-condition.json', JSON.stringify(conditionInfo, null, 2));
  
  // Check photo section
  const photoInfo = await ebayPage.evaluate(() => {
    const els = document.querySelectorAll('[data-testid*="photo"], [data-testid*="image"], [class*="photo"], [class*="upload"], [data-testid*="PHOTO"]');
    return Array.from(els).map(e => ({tag: e.tagName, id: e.id, testid: e.dataset?.testid, class: e.className?.substring?.(0,80), text: e.textContent?.substring(0,100)}));
  });
  require('fs').writeFileSync('/tmp/ebay-photo.json', JSON.stringify(photoInfo, null, 2));
  
  // Check variation section
  const varInfo = await ebayPage.evaluate(() => {
    const els = document.querySelectorAll('[data-testid*="variation"], [data-testid*="VARIATION"], [class*="variation"], [data-testid*="msku"]');
    return Array.from(els).map(e => ({tag: e.tagName, id: e.id, testid: e.dataset?.testid, class: e.className?.substring?.(0,80), text: e.textContent?.substring(0,150)}));
  });
  require('fs').writeFileSync('/tmp/ebay-variation.json', JSON.stringify(varInfo, null, 2));
  
  console.log('Done - screenshots and data saved');
  browser.disconnect();
})().catch(e => console.error(e));
