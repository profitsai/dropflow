const puppeteer = require('puppeteer-core');
const { discoverBrowserWSEndpoint, getCdpTargetFromEnv, cdpEnvHelpText } = require('../lib/cdp');

async function connectBrowser() {
  let CDP;
  try {
    CDP = getCdpTargetFromEnv();
  } catch (e) {
    console.error(`[verify-all] ${e.message}`);
    if (e.help) console.error(e.help);
    else console.error(cdpEnvHelpText());
    process.exit(2);
  }
  const ws = await discoverBrowserWSEndpoint({ host: CDP.host, port: CDP.port, timeoutMs: 30_000, pollMs: 250 });
  return puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
}

(async () => {
  const browser = await connectBrowser();
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  const draftId = ebayPage ? new URL(ebayPage.url()).searchParams.get('draftId') : null;

  // Reload since both UPC clear and photo PUT returned {reload: true}
  console.log('Reloading page...');
  await ebayPage.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Check all errors
  const errors = await ebayPage.evaluate(() => {
    return Array.from(document.querySelectorAll('.summary--error'))
      .map(e => e.textContent.substring(0, 200));
  });
  console.log('Remaining errors:', errors.length > 0 ? errors : 'NONE!');

  // Check condition
  const cond = await ebayPage.evaluate(() => {
    const v = document.querySelector('#summary-condition-field-value');
    return v?.textContent?.trim();
  });
  console.log('Condition:', cond);

  // Check photos
  const photos = await ebayPage.evaluate(() => {
    const imgs = document.querySelectorAll('.uploader-thumbnails img[src]');
    const countEl = document.querySelector('.uploader-thumbnails__photo-count');
    return {
      imgCount: imgs.length,
      countText: countEl?.textContent,
      firstImgSrc: imgs[0]?.src?.substring(0, 80)
    };
  });
  console.log('Photos:', photos);

  // Check variations
  const vars = await ebayPage.evaluate(() => {
    const sec = document.querySelector('.summary__variations');
    const hasError = sec?.classList.contains('summary--error');
    return {
      hasError,
      text: sec?.textContent?.substring(0, 200)
    };
  });
  console.log('Variations:', vars);

  // Take screenshot
  await ebayPage.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/after-fix.png', fullPage: false });
  console.log('Screenshot saved to after-fix.png', { draftId });

  browser.disconnect();
})().catch(e => console.error(e));
