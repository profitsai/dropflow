const puppeteer = require('puppeteer-core');
const fs = require('fs');
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('/identify'));
  
  if (!page) {
    console.log('No identify page found!');
    browser.disconnect();
    return;
  }
  
  await page.bringToFront();
  console.log('On identify page:', page.url());
  
  // Click "Brand New" radio first
  await page.evaluate(() => {
    const radios = document.querySelectorAll('input[type="radio"]');
    if (radios.length > 0) radios[0].click(); // Brand New is first
  });
  await sleep(500);
  
  // Click "Continue to listing" button
  const btnClicked = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      const t = b.textContent.trim();
      if (t.includes('Continue to listing') || t.includes('Continue')) {
        b.click();
        return t;
      }
    }
    return null;
  });
  
  console.log('Clicked:', btnClicked);
  
  // Wait for navigation to /lstng
  try {
    await page.waitForNavigation({ timeout: 15000, waitUntil: 'networkidle2' });
  } catch (e) {
    console.log('Navigation timeout, checking URL...');
  }
  
  await sleep(3000);
  console.log('Current URL:', page.url());
  
  if (page.url().includes('/lstng')) {
    console.log('\n=== REACHED LISTING FORM! ===');
    const draftMatch = page.url().match(/draftId=(\d+)/);
    if (draftMatch) {
      console.log('Draft ID:', draftMatch[1]);
      fs.writeFileSync('draft-id.txt', draftMatch[1]);
    }
    
    // Wait for form to fully load
    await sleep(5000);
    await page.screenshot({ path: 'listing-form.png', fullPage: false });
    fs.copyFileSync('listing-form.png', '/Users/pyrite/.openclaw/workspace/listing-form.png');
    
    // Analyze the form
    const formAnalysis = await page.evaluate(() => {
      const sections = [];
      
      // Get all section headers
      const headers = document.querySelectorAll('h2, h3, [class*="section-title"], [class*="header"]');
      headers.forEach(h => {
        const t = h.textContent.trim();
        if (t.length > 1 && t.length < 80) sections.push(t);
      });
      
      // Get all input fields
      const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.type,
        id: (el.id || '').substring(0, 60),
        name: el.name,
        placeholder: el.placeholder,
        ariaLabel: el.getAttribute('aria-label'),
        value: (el.value || '').substring(0, 50)
      })).filter(i => i.type !== 'hidden');
      
      // Get all buttons
      const btns = Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim().substring(0, 50),
        disabled: b.disabled,
        visible: b.getBoundingClientRect().width > 0
      })).filter(b => b.text && b.visible);
      
      return { sections, inputs, btns, url: location.href };
    });
    
    console.log('\nSections:', formAnalysis.sections);
    console.log('\nInputs:');
    for (const i of formAnalysis.inputs) {
      console.log(`  ${i.tag}[${i.type}] id="${i.id}" label="${i.ariaLabel}" ph="${i.placeholder}" val="${i.value}"`);
    }
    console.log('\nButtons:', formAnalysis.btns.map(b => b.text).join(', '));
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
