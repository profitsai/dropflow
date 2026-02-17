const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const pages = await browser.pages();
  const bulkLister = pages.find(p => p.url().includes('ali-bulk-lister'));
  
  if (!bulkLister) {
    console.error('Bulk lister page not found!');
    browser.disconnect();
    return;
  }
  
  await bulkLister.bringToFront();
  console.log('Switched to bulk lister tab');
  
  // Take screenshot to see current state
  await bulkLister.screenshot({ path: 'bulk-lister-state.png', fullPage: true });
  console.log('Screenshot saved: bulk-lister-state.png');
  
  // Get the page content/state
  const state = await bulkLister.evaluate(() => {
    // Check what's on the page
    const body = document.body.innerText.substring(0, 2000);
    const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(el => ({
      type: el.type || el.tagName,
      id: el.id,
      name: el.name,
      placeholder: el.placeholder,
      value: el.value?.substring(0, 100)
    }));
    const buttons = Array.from(document.querySelectorAll('button')).map(el => ({
      text: el.textContent.trim().substring(0, 50),
      id: el.id,
      class: el.className?.substring(0, 50)
    }));
    return { body, inputs, buttons };
  });
  
  console.log('\n--- Page Text (first 2000 chars) ---');
  console.log(state.body);
  console.log('\n--- Inputs ---');
  console.log(JSON.stringify(state.inputs, null, 2));
  console.log('\n--- Buttons ---');
  console.log(JSON.stringify(state.buttons, null, 2));
  
  browser.disconnect();
})().catch(e => console.error(e));
