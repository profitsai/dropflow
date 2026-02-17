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
  
  // Scroll to Variations section
  await page.evaluate(() => {
    const headers = document.querySelectorAll('h2, h3');
    for (const h of headers) {
      if (h.textContent.includes('Variation')) {
        h.scrollIntoView({ block: 'start' });
        return h.textContent;
      }
    }
  });
  await sleep(1000);
  await page.screenshot({ path: 'variations-section.png' });
  fs.copyFileSync('variations-section.png', '/Users/pyrite/.openclaw/workspace/variations-section.png');
  
  // Get the full variations section content
  const varSection = await page.evaluate(() => {
    const headers = document.querySelectorAll('h2, h3');
    for (const h of headers) {
      if (h.textContent.includes('Variation')) {
        // Get the section container
        const section = h.closest('section') || h.parentElement?.parentElement;
        if (section) {
          return {
            html: section.innerHTML.substring(0, 3000),
            text: section.textContent.trim().substring(0, 1000),
            buttons: Array.from(section.querySelectorAll('button, a, [role="button"]')).map(b => ({
              text: b.textContent.trim().substring(0, 80),
              tag: b.tagName,
              class: (b.className || '').substring(0, 60),
              href: b.href || ''
            })),
            inputs: Array.from(section.querySelectorAll('input, select')).map(i => ({
              type: i.type, id: i.id?.substring(0, 60), value: i.value?.substring(0, 50)
            }))
          };
        }
      }
    }
    return null;
  });
  
  if (varSection) {
    console.log('Variations section text:', varSection.text);
    console.log('Buttons:', JSON.stringify(varSection.buttons, null, 2));
    console.log('Inputs:', JSON.stringify(varSection.inputs, null, 2));
  } else {
    console.log('Variations section container not found');
    
    // Try to find variation-related elements anywhere
    const varEls = await page.evaluate(() => {
      const results = [];
      const allEls = document.querySelectorAll('*');
      for (const el of allEls) {
        const text = el.textContent.trim();
        const ownText = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 ? text : '';
        if (ownText.toLowerCase().includes('variation') && ownText.length < 100) {
          results.push({
            tag: el.tagName,
            text: ownText.substring(0, 80),
            class: (el.className || '').substring(0, 60),
            parent: el.parentElement?.tagName
          });
        }
      }
      return results;
    });
    console.log('Variation text elements:', varEls);
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
