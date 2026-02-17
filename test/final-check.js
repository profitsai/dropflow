const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  
  const errors = await ebayPage.evaluate(() => {
    return Array.from(document.querySelectorAll('.summary--error'))
      .map(e => ({ class: e.className.substring(0, 80), text: e.textContent.substring(0, 200) }));
  });
  console.log('Errors:', JSON.stringify(errors, null, 2));
  
  // Check condition
  const cond = await ebayPage.evaluate(() => {
    return document.querySelector('#summary-condition-field-value')?.textContent?.trim();
  });
  console.log('Condition:', cond);
  
  // Check photos
  const photos = await ebayPage.evaluate(() => {
    const section = document.querySelector('.summary__photos');
    const hasError = section?.classList.contains('summary--error');
    const imgs = section?.querySelectorAll('img[src]') || [];
    return {
      hasError,
      imgCount: imgs.length,
      sectionText: section?.textContent?.substring(0, 200)
    };
  });
  console.log('Photos:', photos);
  
  // Check variations
  const vars = await ebayPage.evaluate(() => {
    const section = document.querySelector('.summary__variations');
    const hasError = section?.classList.contains('summary--error');
    return { hasError, text: section?.textContent?.substring(0, 200) };
  });
  console.log('Variations:', vars);
  
  // Take screenshot
  await ebayPage.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/final-state.png', fullPage: false });
  
  browser.disconnect();
})().catch(e => console.error(e));
