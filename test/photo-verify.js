const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:60589/devtools/browser/550ee1ba-f1a2-4dfc-ac3b-91ea1a6858cc';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/itm/'));
  if (!ebay) { console.log('No listing page'); browser.disconnect(); return; }
  
  // Scroll to top to see image gallery
  await ebay.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  
  // Click through thumbnails to verify multiple photos
  const thumbInfo = await ebay.evaluate(() => {
    const thumbs = document.querySelectorAll('.ux-image-carousel-item button, [class*="filmstrip"] button, [class*="thumbnail"] button, [class*="image-treatment"] button');
    const imgBtns = Array.from(document.querySelectorAll('button')).filter(b => {
      const img = b.querySelector('img');
      return img && img.src?.includes('ebayimg');
    });
    return {
      thumbBtns: thumbs.length,
      imgBtns: imgBtns.length,
      srcs: imgBtns.map(b => b.querySelector('img')?.src?.substring(0, 80))
    };
  });
  console.log('Thumbnails:', JSON.stringify(thumbInfo, null, 2));
  
  // Screenshot the gallery
  await ebay.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/screenshots/photo-gallery.png' });
  
  // Get the full image gallery HTML to understand the structure
  const galleryHTML = await ebay.evaluate(() => {
    const gallery = document.querySelector('.ux-image-carousel, [class*="image-gallery"]');
    if (!gallery) return 'No gallery found';
    // Count actual carousel items
    const items = gallery.querySelectorAll('.ux-image-carousel-item, [class*="carousel-item"]');
    return {
      itemCount: items.length,
      galleryClass: gallery.className?.substring(0, 60)
    };
  });
  console.log('Gallery:', JSON.stringify(galleryHTML));
  
  browser.disconnect();
})().catch(e => console.error('FATAL:', e.message));
