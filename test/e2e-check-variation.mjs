/**
 * Check the eBay listing's variation section state and storage diagnostics
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const WS = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const SS = '/Users/pyrite/Projects/dropflow-extension/test/screenshots';

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS, defaultViewport: null });
  const pages = await browser.pages();
  
  const ebayPage = pages.find(p => p.url().includes('ebay.com') && p.url().includes('lstng'));
  if (!ebayPage) { console.log('No eBay page'); browser.disconnect(); return; }
  
  console.log('eBay page:', ebayPage.url());

  // Dismiss any OK dialogs first
  await ebayPage.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    btns.filter(b => b.textContent.trim() === 'OK' && b.offsetParent !== null).forEach(b => b.click());
  });
  await new Promise(r => setTimeout(r, 1000));

  // Find the Variation section
  const variationState = await ebayPage.evaluate(() => {
    // Find section headers
    const headers = [...document.querySelectorAll('h2, h3, h4, [class*="section-title"], legend')];
    const varHeader = headers.find(h => /variation/i.test(h.textContent));
    
    if (!varHeader) return { found: false, headers: headers.map(h => h.textContent.trim()).slice(0, 20) };
    
    // Get the variation section container
    let container = varHeader.parentElement;
    for (let i = 0; i < 5 && container; i++) {
      if (container.querySelector('button') || container.querySelector('a') || container.classList.length > 1) break;
      container = container.parentElement;
    }
    
    const text = container?.innerText || '';
    const buttons = [...(container?.querySelectorAll('button, a, [role="button"]') || [])].map(b => b.textContent.trim()).filter(Boolean);
    
    return {
      found: true,
      headerText: varHeader.textContent.trim(),
      sectionText: text.substring(0, 500),
      buttons,
      // Check if there's a "Add" or "Create" variation button
      hasAddButton: buttons.some(b => /add|create|specify/i.test(b)),
    };
  });
  
  console.log('\n=== VARIATION SECTION ===');
  console.log(JSON.stringify(variationState, null, 2));

  // Scroll to variation section and screenshot
  await ebayPage.evaluate(() => {
    const headers = [...document.querySelectorAll('h2, h3, h4')];
    const varHeader = headers.find(h => /variation/i.test(h.textContent));
    if (varHeader) varHeader.scrollIntoView({ block: 'start' });
  });
  await new Promise(r => setTimeout(r, 1000));
  await ebayPage.screenshot({ path: path.join(SS, 'variation_section.png') });
  console.log('📸 variation_section.png');

  // Check storage for DropFlow data
  const storage = await ebayPage.evaluate(async () => {
    try {
      const data = await chrome.storage.local.get(null);
      const keys = Object.keys(data);
      const summary = {};
      for (const k of keys) {
        if (k.includes('dropflow') || k.includes('DropFlow') || k.includes('df_')) {
          const val = data[k];
          const str = JSON.stringify(val);
          summary[k] = str.length > 800 ? str.substring(0, 800) + `...(${str.length} chars)` : val;
        }
      }
      return { dropflowKeys: Object.keys(summary).length, allKeys: keys.length, data: summary };
    } catch(e) { return { error: e.message }; }
  });
  
  console.log('\n=== STORAGE ===');
  console.log(JSON.stringify(storage, null, 2));

  // Check if form-filler content script is loaded
  const csState = await ebayPage.evaluate(() => {
    return {
      dfLoaded: !!window.__dropflow_form_filler_loaded,
      dfTimestamp: window.__dropflow_form_filler_ts,
      dfInjectedAt: window.__dropflow_injected_at
    };
  });
  console.log('\n=== CONTENT SCRIPT STATE ===');
  console.log(JSON.stringify(csState, null, 2));

  browser.disconnect();
  console.log('\nDone');
}

run().catch(e => console.error('FATAL:', e.message, e.stack));
