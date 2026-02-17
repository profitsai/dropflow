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
  
  // First, fix the title
  console.log('Fixing title...');
  await page.evaluate(() => {
    // Find by current value
    const inputs = document.querySelectorAll('input, textarea');
    for (const inp of inputs) {
      if (inp.value.includes('Dog coat hoodie fleece')) {
        inp.focus();
        inp.select();
        document.execCommand('selectAll');
        document.execCommand('insertText', false, 'Warm Fleece Dog Coat Hooded Waterproof Winter Pet Puppy Clothes Small Medium Dogs');
        return 'done';
      }
    }
    return 'not found';
  });
  await sleep(500);
  
  // Add description
  console.log('Adding description...');
  await page.evaluate(() => {
    // Find the description iframe or contenteditable div
    const iframe = document.querySelector('iframe[class*="desc"], iframe[id*="desc"]');
    if (iframe) {
      const doc = iframe.contentDocument;
      doc.body.innerHTML = '<p>Warm Fleece Dog Coat with Hood - Waterproof Winter Pet Clothes</p><ul><li>Material: Warm fleece with waterproof outer layer</li><li>Hooded design for extra warmth</li><li>Suitable for small to medium dogs</li><li>Easy to put on with buckle closure</li><li>Available in multiple colors and sizes</li></ul>';
      return 'iframe';
    }
    
    // Try contenteditable
    const editable = document.querySelector('[contenteditable="true"]');
    if (editable) {
      editable.focus();
      document.execCommand('insertHTML', false, '<p>Warm Fleece Dog Coat with Hood - Waterproof Winter Pet Clothes</p><ul><li>Material: Warm fleece with waterproof outer layer</li><li>Hooded design for extra warmth</li><li>Suitable for small to medium dogs</li><li>Easy to put on with buckle closure</li><li>Available in multiple colors and sizes</li></ul>');
      return 'contenteditable';
    }
    
    // Try textarea
    const ta = document.querySelector('textarea[placeholder*="description"], [class*="desc"] textarea');
    if (ta) {
      ta.value = 'Warm Fleece Dog Coat with Hood - Waterproof Winter Pet Clothes. Material: Warm fleece with waterproof outer layer. Hooded design for extra warmth. Suitable for small to medium dogs. Easy to put on with buckle closure. Available in multiple colors and sizes.';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'textarea';
    }
    
    return 'not found';
  });
  await sleep(500);
  
  // Now click the Variations Edit button
  console.log('Clicking Variations Edit button...');
  
  // First scroll to it
  await page.evaluate(() => {
    const headers = document.querySelectorAll('h2, h3');
    for (const h of headers) {
      if (h.textContent.includes('Variation')) {
        h.scrollIntoView({ block: 'center' });
        return;
      }
    }
  });
  await sleep(500);
  await page.screenshot({ path: 'before-var-click.png' });
  fs.copyFileSync('before-var-click.png', '/Users/pyrite/.openclaw/workspace/before-var-click.png');
  
  const clickResult = await page.evaluate(() => {
    // Find the Edit button within Variations section
    const headers = document.querySelectorAll('h2, h3');
    for (const h of headers) {
      if (h.textContent.includes('Variation')) {
        const section = h.closest('section') || h.parentElement?.parentElement;
        if (section) {
          const editBtn = section.querySelector('button');
          if (editBtn) {
            editBtn.click();
            return 'clicked edit in section';
          }
        }
        // Try sibling
        const nextBtn = h.parentElement?.querySelector('button');
        if (nextBtn) {
          nextBtn.click();
          return 'clicked sibling button';
        }
      }
    }
    return 'no button found';
  });
  
  console.log('Click result:', clickResult);
  await sleep(5000);
  
  // Check what happened - might navigate to a new page or show a modal
  console.log('Current URL:', page.url());
  
  // Check for new pages/tabs
  const allPages = await browser.pages();
  for (const p of allPages) {
    const url = p.url();
    if (url.includes('bulkedit') || url.includes('variation')) {
      console.log('New variation page:', url);
    }
  }
  
  await page.screenshot({ path: 'after-var-click.png' });
  fs.copyFileSync('after-var-click.png', '/Users/pyrite/.openclaw/workspace/after-var-click.png');
  
  // Check if a modal/panel appeared
  const modal = await page.evaluate(() => {
    const overlays = document.querySelectorAll('[class*="modal"], [class*="overlay"], [class*="dialog"], [role="dialog"]');
    const results = [];
    overlays.forEach(o => {
      if (o.offsetParent !== null || getComputedStyle(o).display !== 'none') {
        results.push({
          class: (o.className || '').substring(0, 80),
          text: o.textContent.trim().substring(0, 300)
        });
      }
    });
    return results;
  });
  console.log('Modals/overlays:', modal);
  
  browser.disconnect();
})().catch(e => console.error(e));
