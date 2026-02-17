import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  
  // Open and wait longer for dynamic content
  const page = await browser.newPage();
  console.log('Navigating...');
  await page.goto('https://www.aliexpress.com/item/1005006995032850.html', { 
    waitUntil: 'networkidle2', 
    timeout: 30000 
  }).catch(e => console.log('Nav:', e.message));
  
  await sleep(3000);
  
  // Screenshot
  await page.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/ali-page.png', fullPage: false });
  console.log('Screenshot saved');
  
  // Check page title and URL
  console.log('URL:', page.url());
  console.log('Title:', await page.title());
  
  // Check for product title on page
  const domData = await page.evaluate(() => {
    const title = document.querySelector('h1, [data-pl="product-title"]');
    const price = document.querySelector('[class*="price"], .product-price');
    const images = document.querySelectorAll('img[src*="alicdn.com"]');
    return {
      titleText: title?.textContent?.trim()?.substring(0, 100),
      priceText: price?.textContent?.trim()?.substring(0, 50),
      imageCount: images.length,
      bodyLen: document.body.innerHTML.length,
      hasLoginWall: !!document.querySelector('[class*="login"], [class*="Login"]'),
      url: location.href
    };
  });
  console.log('DOM data:', JSON.stringify(domData, null, 2));
  
  await page.close();
  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
