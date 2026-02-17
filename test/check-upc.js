const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  
  // Check item specifics for UPC
  const specifics = await ebayPage.evaluate(() => {
    // Look for all input fields that might contain UPC
    const inputs = document.querySelectorAll('input');
    const upcInputs = [];
    for (const inp of inputs) {
      const labels = inp.closest('[class*="attribute"]')?.textContent?.substring(0,100) || '';
      if (/upc|ean|isbn|gtin/i.test(labels) || /upc|ean|isbn|gtin/i.test(inp.name || '') || inp.value === '1') {
        upcInputs.push({
          name: inp.name,
          value: inp.value,
          placeholder: inp.placeholder,
          label: labels.substring(0,80)
        });
      }
    }
    
    // Check if UPC is in the attributes section
    const attrRows = document.querySelectorAll('.attr-row, [class*="attribute-row"], [class*="attr"]');
    const upcRows = [];
    for (const row of attrRows) {
      const text = row.textContent || '';
      if (/upc|ean|isbn|gtin/i.test(text)) {
        upcRows.push(text.substring(0, 150));
      }
    }
    
    return { upcInputs, upcRows };
  });
  console.log(JSON.stringify(specifics, null, 2));
  
  // Also check the variation builder for UPC
  const varUpc = await ebayPage.evaluate(() => {
    const sec = document.querySelector('.summary__variations');
    if (!sec) return 'no section';
    // Find UPC mention
    const text = sec.textContent;
    const upcIdx = text.indexOf('UPC');
    if (upcIdx >= 0) return text.substring(upcIdx, upcIdx + 100);
    return 'no UPC in variations';
  });
  console.log('Var UPC:', varUpc);
  
  browser.disconnect();
})().catch(e => console.error(e));
