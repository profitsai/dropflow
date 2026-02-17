const puppeteer = require('puppeteer-core');
const fs = require('fs');
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('5051135836723'));
  await page.bringToFront();
  
  // Wait for iframe to load
  console.log('Waiting for bulkedit iframe...');
  await sleep(5000);
  
  // Get all frames
  const frames = page.frames();
  console.log(`Frames: ${frames.length}`);
  for (const f of frames) {
    console.log(`  Frame: ${f.url()}`);
  }
  
  const bulkFrame = frames.find(f => f.url().includes('bulkedit'));
  if (!bulkFrame) {
    console.log('No bulkedit iframe found!');
    // Try screenshot
    await page.screenshot({ path: 'no-iframe.png' });
    browser.disconnect();
    return;
  }
  
  console.log('Found bulkedit iframe:', bulkFrame.url());
  
  // Wait for iframe content to load
  await sleep(3000);
  
  const frameContent = await bulkFrame.evaluate(() => {
    return {
      text: document.body?.innerText?.substring(0, 2000) || 'empty',
      inputs: Array.from(document.querySelectorAll('input, select, textarea')).map(i => ({
        tag: i.tagName, type: i.type, id: (i.id || '').substring(0, 60),
        placeholder: i.placeholder, value: (i.value || '').substring(0, 50),
        name: i.name
      })),
      buttons: Array.from(document.querySelectorAll('button, [role="button"]')).map(b => ({
        text: b.textContent.trim().substring(0, 60),
        disabled: b.disabled,
        class: (b.className || '').substring(0, 60)
      })).filter(b => b.text),
      links: Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.textContent.trim().substring(0, 60),
        href: a.href
      })).filter(a => a.text)
    };
  }).catch(e => ({ error: e.message }));
  
  console.log('\n--- Bulkedit iframe content ---');
  console.log('Text:', frameContent.text?.substring(0, 500));
  console.log('\nInputs:', JSON.stringify(frameContent.inputs, null, 2));
  console.log('\nButtons:', JSON.stringify(frameContent.buttons?.slice(0, 20), null, 2));
  
  // Take screenshot focused on the dialog
  await page.screenshot({ path: 'var-iframe-loaded.png' });
  fs.copyFileSync('var-iframe-loaded.png', '/Users/pyrite/.openclaw/workspace/var-iframe-loaded.png');
  
  browser.disconnect();
})().catch(e => console.error(e));
