import puppeteer from 'puppeteer-core';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:57542', defaultViewport: null });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (/error|fail|block|SOCKS/i.test(msg.text()))
      console.log(`[console] ${msg.text().substring(0,200)}`);
  });
  page.on('requestfailed', req => {
    console.log(`[FAIL] ${req.url().substring(0,100)} → ${req.failure()?.errorText}`);
  });
  
  console.log('Navigating to ebay.com.au...');
  try {
    await page.goto('https://www.ebay.com.au', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`Title: ${await page.title()}`);
    console.log(`URL: ${page.url()}`);
    
    // Check if logged in
    const loginState = await page.evaluate(() => {
      const signIn = document.querySelector('a[href*="signin"], [data-signin]');
      const myEbay = document.querySelector('a[href*="myebay"], #gh-ug');
      return { hasSignIn: !!signIn, hasMyEbay: !!myEbay, username: document.querySelector('#gh-un, #gh-ug a')?.textContent?.trim() };
    });
    console.log(`Login state: ${JSON.stringify(loginState)}`);
    
    // Try listing page
    console.log('\nNavigating to sell page...');
    await page.goto('https://www.ebay.com.au/sl/prelist/suggest', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`Title: ${await page.title()}`);
    console.log(`URL: ${page.url()}`);
    await sleep(5000);
    
    await page.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/screenshots/ebay-check.png' });
    
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500));
    console.log(`Body: ${bodyText}`);
  } catch(e) {
    console.error(`Error: ${e.message}`);
  }
  
  await browser.disconnect();
})();
