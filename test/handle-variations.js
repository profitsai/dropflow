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
  
  // Wait for spinner to disappear
  console.log('Waiting for variations dialog to load...');
  for (let i = 0; i < 20; i++) {
    const hasSpinner = await page.evaluate(() => {
      const spinner = document.querySelector('.msku-dialog__spinner');
      return spinner && spinner.offsetParent !== null;
    });
    if (!hasSpinner) {
      console.log(`Spinner gone after ${i*1000}ms`);
      break;
    }
    await sleep(1000);
  }
  
  await sleep(2000);
  await page.screenshot({ path: 'variations-dialog.png' });
  fs.copyFileSync('variations-dialog.png', '/Users/pyrite/.openclaw/workspace/variations-dialog.png');
  
  // Analyze the variations dialog
  const dialogState = await page.evaluate(() => {
    const dialog = document.querySelector('.msku-dialog');
    if (!dialog) return { error: 'no dialog' };
    
    return {
      text: dialog.textContent.trim().substring(0, 2000),
      inputs: Array.from(dialog.querySelectorAll('input, select, textarea')).map(i => ({
        tag: i.tagName, type: i.type, id: (i.id || '').substring(0, 60),
        placeholder: i.placeholder, value: (i.value || '').substring(0, 50),
        ariaLabel: i.getAttribute('aria-label')
      })),
      buttons: Array.from(dialog.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim().substring(0, 60),
        class: (b.className || '').substring(0, 60),
        disabled: b.disabled,
        visible: b.offsetParent !== null
      })).filter(b => b.text && b.visible),
      // Check for iframe (bulkedit)
      iframes: Array.from(dialog.querySelectorAll('iframe')).map(f => ({
        src: f.src, id: f.id
      }))
    };
  });
  
  console.log('\n--- Variations Dialog ---');
  console.log('Text:', dialogState.text?.substring(0, 500));
  console.log('\nInputs:', JSON.stringify(dialogState.inputs, null, 2));
  console.log('\nButtons:', JSON.stringify(dialogState.buttons, null, 2));
  console.log('\nIframes:', dialogState.iframes);
  
  browser.disconnect();
})().catch(e => console.error(e));
