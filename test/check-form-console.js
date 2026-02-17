const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  const pages = await browser.pages();
  const lstng = pages.find(p => p.url().includes('/lstng'));
  
  if (!lstng) {
    console.log('No listing page found');
    process.exit(1);
  }
  
  console.log('Listing page:', lstng.url());
  
  // Enable console logging
  const client = await lstng.createCDPSession();
  await client.send('Runtime.enable');
  
  // Get existing console messages (Runtime.consoleAPICalled only gets new ones)
  // Instead, evaluate to check for DropFlow state
  const state = await lstng.evaluate(() => {
    // Check if DropFlow form-filler left any state
    const results = {};
    
    // Scroll the page to see what's there
    const body = document.body.innerHTML;
    results.hasVariationSection = body.includes('variation') || body.includes('Variation');
    results.hasVariationBuilder = body.includes('variation-builder') || body.includes('VariationBuilder');
    
    // Look for the variations section specifically
    const sections = document.querySelectorAll('[data-testid], section, [class*="section"]');
    results.sectionTexts = Array.from(sections).map(s => ({
      testid: s.getAttribute('data-testid'),
      text: s.textContent?.substring(0, 80)
    })).filter(s => s.text?.toLowerCase().includes('variation') || s.testid?.includes('variation'));
    
    // Check for iframe (variation builder is often in an iframe)
    const iframes = document.querySelectorAll('iframe');
    results.iframes = Array.from(iframes).map(f => f.src?.substring(0, 120));
    
    // Find the price input
    const priceInput = document.querySelector('input[aria-label*="rice"], input[name*="rice"]');
    results.priceValue = priceInput?.value;
    results.priceLabel = priceInput?.getAttribute('aria-label');
    
    // Check for any variation-related buttons
    const buttons = Array.from(document.querySelectorAll('button'));
    results.varButtons = buttons.filter(b => 
      b.textContent?.toLowerCase().includes('variation') || 
      b.textContent?.toLowerCase().includes('add variation')
    ).map(b => b.textContent?.trim()?.substring(0, 50));
    
    return results;
  });
  
  console.log('Form state:', JSON.stringify(state, null, 2));
  
  // Scroll down and take full-page screenshot
  await lstng.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(r => setTimeout(r, 1000));
  await lstng.screenshot({ path: 'price-test-form-bottom.png' });
  
  // Scroll to middle
  await lstng.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await new Promise(r => setTimeout(r, 500));
  await lstng.screenshot({ path: 'price-test-form-middle.png' });
  
  // Listen for new console messages for 10 seconds
  console.log('\nListening for console messages...');
  client.on('Runtime.consoleAPICalled', (params) => {
    const args = params.args.map(a => a.value || a.description || '?').join(' ');
    if (args.includes('DropFlow') || args.includes('dropflow')) {
      console.log(`[PAGE ${params.type}] ${args}`);
    }
  });
  
  await new Promise(r => setTimeout(r, 10000));
  await client.detach();
  browser.disconnect();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
