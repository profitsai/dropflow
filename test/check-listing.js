const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  
  // Find the new listing page
  let listingPage = pages.find(p => p.url().includes('5051135186923'));
  
  if (!listingPage) {
    // Check for any eBay listing pages
    console.log('Looking for eBay listing pages...');
    for (const p of pages) {
      if (p.url().includes('ebay.com.au/lstng') || p.url().includes('ebay.com.au/sl/')) {
        console.log('  ', p.url());
      }
    }
    // Open it
    listingPage = await browser.newPage();
    await listingPage.goto('https://www.ebay.com.au/lstng?draftId=5051135186923&mode=AddItem', { waitUntil: 'networkidle2', timeout: 30000 });
  }
  
  console.log('Listing page:', listingPage.url());
  await new Promise(r => setTimeout(r, 3000));
  
  // Full page screenshot
  await listingPage.screenshot({ path: '/Users/pyrite/.openclaw/workspace/new-listing-top.png', fullPage: false });
  
  // Scroll down and take more
  await listingPage.evaluate(() => window.scrollTo(0, 800));
  await new Promise(r => setTimeout(r, 1000));
  await listingPage.screenshot({ path: '/Users/pyrite/.openclaw/workspace/new-listing-mid.png' });
  
  await listingPage.evaluate(() => window.scrollTo(0, 1600));
  await new Promise(r => setTimeout(r, 1000));
  await listingPage.screenshot({ path: '/Users/pyrite/.openclaw/workspace/new-listing-bottom.png' });
  
  await listingPage.evaluate(() => window.scrollTo(0, 2400));
  await new Promise(r => setTimeout(r, 1000));
  await listingPage.screenshot({ path: '/Users/pyrite/.openclaw/workspace/new-listing-bottom2.png' });
  
  // Check for any error messages
  const errors = await listingPage.evaluate(() => {
    const errorEls = document.querySelectorAll('[class*="error"], [class*="Error"], .inline-notice--attention');
    return Array.from(errorEls).map(el => el.textContent.trim()).filter(t => t.length > 0 && t.length < 500);
  });
  if (errors.length) console.log('Errors found:', errors);
  
  browser.disconnect();
})();
