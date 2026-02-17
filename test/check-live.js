const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  for (const p of pages) console.log('Page:', p.url().substring(0, 100));
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  if (!ebayPage) { console.log('No eBay page'); browser.disconnect(); return; }
  console.log('Using:', ebayPage.url());
  
  // Check current errors
  const errors = await ebayPage.evaluate(() => {
    return Array.from(document.querySelectorAll('.summary--error'))
      .map(e => e.textContent.substring(0, 200));
  });
  console.log('Errors:', errors);
  
  // Check condition
  const cond = await ebayPage.evaluate(() => 
    document.querySelector('#summary-condition-field-value')?.textContent?.trim()
  );
  console.log('Condition:', cond);
  
  // Check variations section for UPC error
  const varSection = await ebayPage.evaluate(() => {
    const sec = document.querySelector('.summary__variations');
    return sec?.textContent?.substring(0, 300);
  });
  console.log('Variations:', varSection?.substring(0, 200));
  
  // Check pricing in variations
  const draftId = new URL(ebayPage.url()).searchParams.get('draftId');
  const draft = await ebayPage.evaluate(async (id) => {
    const r = await fetch(`/lstng/api/listing_draft/${id}?mode=AddItem`, {credentials:'include'});
    return r.json();
  }, draftId);
  
  const vars = draft.VARIATIONS?.variations || [];
  console.log('\nVariation prices:');
  for (const v of vars) {
    const aspects = v.aspects.map(a => a.aspectValues[0]).join('/');
    console.log(`  ${aspects}: $${v.fixedPrice}`);
  }
  
  // Check photos
  console.log('\nPhotos in draft:', draft.PHOTOS?.pictureUrl || draft.PHOTOS?.pictures || 'none');
  
  // Check if there are eBay images
  const draftStr = JSON.stringify(draft);
  const imgUrls = draftStr.match(/https:\/\/i\.ebayimg\.com[^"']*/g);
  console.log('eBay image URLs:', imgUrls?.length || 0);
  
  browser.disconnect();
})().catch(e => console.error(e));
