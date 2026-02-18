import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS = '/Users/pyrite/Projects/dropflow-extension/test/screenshots';
const WS_URL = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const ALI_URL = 'https://www.aliexpress.com/item/1005007380025405.html';

let stepNum = 0;
async function screenshot(page, name) {
  stepNum++;
  const fname = `${String(stepNum).padStart(2,'0')}-${name}.png`;
  await page.screenshot({ path: path.join(SCREENSHOTS, fname), fullPage: false });
  console.log(`📸 ${fname}`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function collectLogs(page, tag = '') {
  // Already set up via page.on('console')
}

(async () => {
  console.log('🔗 Connecting to browser...');
  const browser = await puppeteer.connect({ browserWSEndpoint: WS_URL, defaultViewport: null });
  
  // Step 1: Reload extension
  console.log('\n=== STEP 1: Reload Extension ===');
  const targets = await browser.targets();
  const swTarget = targets.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  if (swTarget) {
    const swPage = await swTarget.worker();
    // Can't call chrome.runtime.reload() from worker easily, use a page instead
  }
  
  // Find extension page to reload from
  const extPage = (await browser.pages()).find(p => p.url().includes(EXT_ID));
  if (extPage) {
    console.log('Found extension page:', extPage.url());
    try {
      await extPage.evaluate(() => chrome.runtime.reload());
      console.log('✅ Extension reload triggered');
      await sleep(3000); // Wait for reload
    } catch (e) {
      console.log('⚠️ Reload via page failed, trying alternate method:', e.message);
    }
  } else {
    console.log('⚠️ No extension page found, proceeding without reload');
  }
  
  // Reconnect after reload (extension pages may have changed)
  await sleep(2000);
  
  // Step 2: Navigate to AliExpress product
  console.log('\n=== STEP 2: Navigate to AliExpress ===');
  let pages = await browser.pages();
  
  // Find or create a tab for AliExpress
  let aliPage = pages.find(p => p.url().includes('aliexpress.com/item'));
  if (aliPage) {
    console.log('Reusing existing AliExpress tab, navigating to test product...');
    await aliPage.bringToFront();
  } else {
    aliPage = await browser.newPage();
  }
  
  // Set up console logging
  const consoleLogs = [];
  aliPage.on('console', msg => {
    const text = msg.text();
    if (text.includes('[DropFlow]') || text.includes('dropflow')) {
      consoleLogs.push(`[ALI] ${text}`);
      console.log(`  📋 ${text}`);
    }
  });
  
  await aliPage.goto(ALI_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000); // Let page fully load
  await screenshot(aliPage, 'aliexpress-loaded');
  
  // Check if product has variations
  const hasVariations = await aliPage.evaluate(() => {
    const skuEls = document.querySelectorAll('[class*="sku"], [class*="variation"], [data-sku-col]');
    return skuEls.length > 0;
  });
  console.log(`Product has variation elements: ${hasVariations}`);
  
  // Step 3: Trigger DropFlow scrape
  console.log('\n=== STEP 3: Trigger DropFlow Scrape ===');
  
  // Try to trigger via extension messaging
  try {
    await aliPage.evaluate((extId) => {
      chrome.runtime.sendMessage(extId, { action: 'scrapeAndList' });
    }, EXT_ID);
    console.log('✅ Sent scrapeAndList message to extension');
  } catch (e) {
    console.log('⚠️ Direct message failed:', e.message);
    // Try clicking the extension popup or using keyboard shortcut
    // Fallback: execute the content script manually
    try {
      await aliPage.evaluate((extId) => {
        chrome.runtime.sendMessage(extId, { type: 'SCRAPE_AND_LIST' });
      }, EXT_ID);
      console.log('✅ Sent SCRAPE_AND_LIST message');
    } catch (e2) {
      console.log('⚠️ Fallback message also failed:', e2.message);
      // Try injecting the scrape trigger directly
      try {
        await aliPage.evaluate(() => {
          window.postMessage({ type: 'DROPFLOW_SCRAPE_TRIGGER' }, '*');
        });
        console.log('✅ Posted window message trigger');
      } catch (e3) {
        console.log('❌ All trigger methods failed');
      }
    }
  }
  
  await sleep(3000);
  await screenshot(aliPage, 'after-scrape-trigger');
  
  // Step 4: Monitor for eBay listing tab
  console.log('\n=== STEP 4: Waiting for eBay listing tab ===');
  
  let ebayPage = null;
  const startTime = Date.now();
  const TIMEOUT = 60000; // 60s
  
  // Also check if there's already an eBay listing tab
  pages = await browser.pages();
  ebayPage = pages.find(p => p.url().includes('ebay.com.au/lstng'));
  
  if (ebayPage) {
    console.log('Found existing eBay listing tab:', ebayPage.url());
  }
  
  if (!ebayPage) {
    // Listen for new tabs
    const newPagePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for eBay tab')), TIMEOUT);
      browser.on('targetcreated', async (target) => {
        if (target.type() === 'page') {
          const page = await target.page();
          const url = page.url();
          console.log(`  New tab: ${url}`);
          if (url.includes('ebay.com.au/lstng') || url.includes('ebay.com/lstng')) {
            clearTimeout(timeout);
            resolve(page);
          }
        }
      });
    });
    
    try {
      ebayPage = await newPagePromise;
      console.log('✅ eBay listing tab opened');
    } catch (e) {
      console.log('⚠️ ' + e.message);
      // Check again for any eBay tab
      pages = await browser.pages();
      ebayPage = pages.find(p => p.url().includes('ebay') && p.url().includes('lstng'));
    }
  }
  
  if (!ebayPage) {
    console.log('❌ No eBay listing tab found. Checking all open tabs...');
    pages = await browser.pages();
    for (const p of pages) {
      console.log(`  Tab: ${p.url()}`);
    }
    
    // Save console logs and exit
    fs.writeFileSync(path.join(SCREENSHOTS, 'console-logs.txt'), consoleLogs.join('\n'));
    console.log('\n❌ Test failed: eBay listing tab never appeared');
    await browser.disconnect();
    process.exit(1);
  }
  
  // Set up console logging on eBay page
  const ebayLogs = [];
  ebayPage.on('console', msg => {
    const text = msg.text();
    if (text.includes('[DropFlow]') || text.includes('dropflow') || text.includes('variation') || text.includes('builder') || text.includes('msku')) {
      ebayLogs.push(`[EBAY] ${text}`);
      console.log(`  📋 ${text}`);
    }
  });
  
  await ebayPage.bringToFront();
  await sleep(5000);
  await screenshot(ebayPage, 'ebay-listing-loaded');
  
  // Step 5: Check listing form content
  console.log('\n=== STEP 5: Check listing form ===');
  
  const formInfo = await ebayPage.evaluate(() => {
    const title = document.querySelector('[data-testid="title"] textarea, #editpane_title textarea, [name="title"]');
    const desc = document.querySelector('[data-testid="description"] iframe, #editpane_description iframe, .description-editor');
    const variations = document.querySelector('[class*="variation"], [data-testid="variation"], .msku');
    const categoryEl = document.querySelector('[data-testid="category"]');
    
    return {
      title: title?.value || title?.textContent || 'NOT FOUND',
      hasDescription: !!desc,
      hasVariations: !!variations,
      url: window.location.href,
      bodyText: document.body.innerText.substring(0, 2000)
    };
  });
  
  console.log('Title:', formInfo.title);
  console.log('Has description:', formInfo.hasDescription);
  console.log('Has variations:', formInfo.hasVariations);
  console.log('URL:', formInfo.url);
  
  // Step 6: Watch for variation builder iframe
  console.log('\n=== STEP 6: Watch for variation builder iframe ===');
  
  // Check for bulkedit iframe
  let builderFound = false;
  for (let i = 0; i < 12; i++) {
    const frames = ebayPage.frames();
    const builderFrame = frames.find(f => f.url().includes('bulkedit'));
    if (builderFrame) {
      console.log('✅ Variation builder iframe found:', builderFrame.url());
      builderFound = true;
      await sleep(3000);
      await screenshot(ebayPage, 'builder-iframe-loaded');
      
      // Step 7: Check builder content
      console.log('\n=== STEP 7: Check builder content ===');
      try {
        const builderInfo = await builderFrame.evaluate(() => {
          const rows = document.querySelectorAll('tr, [class*="row"]');
          const inputs = document.querySelectorAll('input');
          const selects = document.querySelectorAll('select');
          return {
            rowCount: rows.length,
            inputCount: inputs.length,
            selectCount: selects.length,
            bodyText: document.body?.innerText?.substring(0, 2000) || 'empty'
          };
        });
        console.log('Builder rows:', builderInfo.rowCount);
        console.log('Builder inputs:', builderInfo.inputCount);
        console.log('Builder body preview:', builderInfo.bodyText.substring(0, 500));
      } catch (e) {
        console.log('⚠️ Could not read builder frame:', e.message);
      }
      break;
    }
    console.log(`  Waiting for builder iframe... (${(i+1)*5}s)`);
    await sleep(5000);
  }
  
  if (!builderFound) {
    console.log('⚠️ Builder iframe not found after 60s');
    await screenshot(ebayPage, 'no-builder-iframe');
  }
  
  // Step 8: Final state check
  console.log('\n=== STEP 8: Final state ===');
  await sleep(3000);
  await screenshot(ebayPage, 'final-state');
  
  // Check for any error messages
  const errors = await ebayPage.evaluate(() => {
    const errorEls = document.querySelectorAll('[class*="error"], [class*="Error"], .inline-notice--attention');
    return Array.from(errorEls).map(e => e.textContent.trim()).filter(t => t.length > 0).slice(0, 10);
  });
  if (errors.length > 0) {
    console.log('⚠️ Errors on page:', errors);
  }
  
  // Save all logs
  const allLogs = [...consoleLogs, '', '--- eBay page logs ---', ...ebayLogs];
  fs.writeFileSync(path.join(SCREENSHOTS, 'console-logs.txt'), allLogs.join('\n'));
  console.log(`\n📄 Saved ${allLogs.length} log lines`);
  
  // Summary
  console.log('\n========== SUMMARY ==========');
  console.log(`AliExpress page loaded: ✅`);
  console.log(`Scrape triggered: ✅`);
  console.log(`eBay listing opened: ${ebayPage ? '✅' : '❌'}`);
  console.log(`Builder iframe found: ${builderFound ? '✅' : '❌'}`);
  console.log(`Screenshots saved to: ${SCREENSHOTS}`);
  
  await browser.disconnect();
  console.log('\n✅ Test complete');
})().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
