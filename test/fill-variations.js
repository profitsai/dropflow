const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const ebay = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  if (!ebay) { console.error('No eBay page'); process.exit(1); }
  
  await ebay.bringToFront();
  
  // Wait for the bulkedit iframe to load
  console.log('Waiting for bulkedit iframe to load...');
  await sleep(5000);
  
  // Get all frames
  const frames = ebay.frames();
  console.log('Frames:', frames.length);
  frames.forEach(f => console.log('  -', f.url().substring(0, 100)));
  
  // Find the bulkedit frame
  const bulkFrame = frames.find(f => f.url().includes('bulkedit'));
  if (!bulkFrame) {
    console.error('No bulkedit frame found. Taking screenshot...');
    await ebay.screenshot({ path: 'no-bulkedit.png' });
    
    // Maybe need to click Edit again
    console.log('Trying to click Edit variations again...');
    await ebay.evaluate(() => {
      const editButtons = [...document.querySelectorAll('a, button')].filter(b => b.textContent.trim() === 'Edit');
      // Find the one near VARIATIONS text
      for (const btn of editButtons) {
        const rect = btn.getBoundingClientRect();
        if (rect.y > 0) {
          btn.click();
          return 'clicked at y=' + rect.y;
        }
      }
    });
    await sleep(5000);
    
    const frames2 = ebay.frames();
    const bulkFrame2 = frames2.find(f => f.url().includes('bulkedit'));
    if (!bulkFrame2) {
      console.error('Still no bulkedit frame');
      await ebay.screenshot({ path: 'still-no-bulkedit.png' });
      browser.disconnect();
      process.exit(1);
    }
  }
  
  const bf = bulkFrame || ebay.frames().find(f => f.url().includes('bulkedit'));
  console.log('\nBulkedit frame URL:', bf.url().substring(0, 100));
  
  // Wait for content to load
  await sleep(3000);
  
  // Get the variation builder content
  const builderContent = await bf.evaluate(() => {
    return {
      text: document.body?.innerText?.substring(0, 2000) || 'empty',
      buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => t),
      inputs: [...document.querySelectorAll('input')].map(i => ({ type: i.type, placeholder: i.placeholder, value: i.value })),
      selects: [...document.querySelectorAll('select')].length,
      links: [...document.querySelectorAll('a')].map(a => a.textContent.trim()).filter(t => t),
    };
  }).catch(e => ({ error: e.message }));
  console.log('\nBuilder content:', JSON.stringify(builderContent, null, 2).substring(0, 2000));
  
  // Take a screenshot - but we need to screenshot the full page since the iframe is visible
  await ebay.screenshot({ path: 'variation-builder.png' });
  
  browser.disconnect();
  console.log('\nDone');
})().catch(e => { console.error(e.message); process.exit(1); });
