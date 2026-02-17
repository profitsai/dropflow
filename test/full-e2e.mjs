import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const TEST_URL = 'https://a.aliexpress.com/_mMLcP7b';
const RESULTS_FILE = '/Users/pyrite/Projects/dropflow-extension/test/FULL-E2E-FINAL.md';

const log = (msg) => {
  const ts = new Date().toLocaleTimeString('en-AU', {timeZone: 'Australia/Melbourne'});
  const line = `[${ts}] ${msg}`;
  console.log(line);
  return line;
};

let results = ['# DropFlow Full E2E Test Results', `**Date**: ${new Date().toISOString()}`, '---', ''];

const addResult = (msg) => {
  results.push(log(msg));
};

async function run() {
  // Connect
  addResult('Connecting to browser via CDP...');
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  addResult('Connected.');

  // Find bulk lister page
  let pages = await browser.pages();
  let bulkPage = pages.find(p => p.url().includes(EXT_ID));
  if (!bulkPage) {
    addResult('No extension page found, opening one...');
    bulkPage = await browser.newPage();
    await bulkPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded' });
  }
  addResult(`Extension page: ${bulkPage.url()}`);

  // Step 1: Reload extension
  addResult('## Step 1: Reloading extension...');
  try {
    await bulkPage.evaluate(() => chrome.runtime.reload());
  } catch(e) {
    addResult('Extension reload triggered (page disconnected as expected)');
  }
  
  await new Promise(r => setTimeout(r, 5000));
  
  // Reconnect
  const browser2 = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  pages = await browser2.pages();
  bulkPage = await browser2.newPage();
  await bulkPage.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  addResult('Reconnected after reload.');

  // Step 2: Clear all state
  addResult('## Step 2: Clearing all state...');
  const cleared = await bulkPage.evaluate(() => {
    return new Promise(resolve => {
      chrome.storage.local.get(null, (all) => {
        const keys = Object.keys(all).filter(k => 
          k.startsWith('dropflow_') || k.startsWith('pending') || k.startsWith('aliBulk')
        );
        if (keys.length === 0) return resolve('No keys to clear');
        chrome.storage.local.remove(keys, () => resolve(`Cleared ${keys.length} keys: ${keys.join(', ')}`));
      });
    });
  });
  addResult(cleared);

  // Step 3: Trigger bulk listing
  addResult('## Step 3: Triggering START_ALI_BULK_LISTING...');
  await bulkPage.evaluate((url) => {
    chrome.runtime.sendMessage({
      action: 'START_ALI_BULK_LISTING',
      urls: [url],
      marketplace: 'ebay.com.au',
      listingType: 'standard',
      threadCount: 1
    });
  }, TEST_URL);
  addResult('Message sent. Monitoring...');

  // Step 4: Monitor
  addResult('## Step 4: Monitoring progress...');
  
  const startTime = Date.now();
  const MAX_WAIT = 20 * 60 * 1000; // 20 minutes
  let lastStatus = '';
  let screenshotCount = 0;
  let completed = false;
  let ebayItemId = null;

  while (Date.now() - startTime < MAX_WAIT && !completed) {
    await new Promise(r => setTimeout(r, 15000));
    
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    
    // Check storage state
    let state;
    try {
      state = await bulkPage.evaluate(() => {
        return new Promise(resolve => {
          chrome.storage.local.get(null, (all) => {
            const relevant = {};
            for (const [k, v] of Object.entries(all)) {
              if (k.startsWith('dropflow_') || k.startsWith('pending') || k.startsWith('aliBulk')) {
                // Truncate large values
                if (typeof v === 'string' && v.length > 500) {
                  relevant[k] = v.substring(0, 500) + '...';
                } else if (typeof v === 'object') {
                  relevant[k] = JSON.stringify(v).substring(0, 500);
                } else {
                  relevant[k] = v;
                }
              }
            }
            resolve(relevant);
          });
        });
      });
    } catch(e) {
      addResult(`[${elapsed}s] Error reading storage: ${e.message}`);
      // Try to reconnect
      try {
        const br = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
        pages = await br.pages();
        bulkPage = pages.find(p => p.url().includes(EXT_ID));
        if (!bulkPage) {
          addResult(`[${elapsed}s] Lost extension page, cannot recover`);
          break;
        }
      } catch(e2) {
        addResult(`[${elapsed}s] Cannot reconnect: ${e2.message}`);
        break;
      }
      continue;
    }

    const stateStr = JSON.stringify(state);
    if (stateStr !== lastStatus) {
      lastStatus = stateStr;
      addResult(`[${elapsed}s] State changed:`);
      for (const [k, v] of Object.entries(state)) {
        addResult(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      }
    } else {
      // Even if state hasn't changed, check tabs for eBay activity
      try {
        const allPages = await (await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null })).pages();
        const ebayPages = allPages.filter(p => p.url().includes('ebay'));
        if (ebayPages.length > 0) {
          for (const ep of ebayPages) {
            const url = ep.url();
            const title = await ep.title().catch(() => 'unknown');
            
            // Check for successful listing
            if (url.includes('SuccessfullyListed') || url.includes('ViewItem')) {
              const match = url.match(/[?&]itemId=(\d+)|\/itm\/(\d+)/);
              if (match) {
                ebayItemId = match[1] || match[2];
                addResult(`## 🎉 SUCCESS! Item listed! ID: ${ebayItemId}`);
                completed = true;
                break;
              }
            }
            
            // Screenshot eBay page periodically
            if (elapsed % 60 < 20) {
              screenshotCount++;
              const ssPath = `/Users/pyrite/Projects/dropflow-extension/test/e2e-ss-${screenshotCount}.png`;
              await ep.screenshot({ path: ssPath }).catch(() => {});
              addResult(`[${elapsed}s] eBay page: ${title} | ${url}`);
            }
          }
        }
      } catch(e) {
        // ignore reconnection issues for tab checking
      }
      
      if (!completed) {
        console.log(`[${elapsed}s] No state change...`);
      }
    }

    // Check for errors in state
    if (stateStr.includes('"error"') || stateStr.includes('"failed"') || stateStr.includes('"ERROR"')) {
      addResult(`## ❌ Error detected in state!`);
      // Take a screenshot of all eBay pages
      try {
        const br = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
        const allP = await br.pages();
        for (const p of allP) {
          if (p.url().includes('ebay')) {
            screenshotCount++;
            const ssPath = `/Users/pyrite/Projects/dropflow-extension/test/e2e-error-${screenshotCount}.png`;
            await p.screenshot({ path: ssPath, fullPage: true }).catch(() => {});
            addResult(`Screenshot saved: ${ssPath}`);
            addResult(`Page URL: ${p.url()}`);
          }
        }
      } catch(e) {}
    }

    // Check for completion states
    if (stateStr.includes('"completed"') || stateStr.includes('"listed"') || stateStr.includes('"done"')) {
      addResult('## Completion state detected!');
      completed = true;
    }
  }

  if (!completed) {
    addResult('## ⏰ Timed out after 20 minutes');
    // Final screenshot
    try {
      const br = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
      const allP = await br.pages();
      for (const p of allP) {
        if (p.url().includes('ebay') || p.url().includes('aliexpress')) {
          screenshotCount++;
          const ssPath = `/Users/pyrite/Projects/dropflow-extension/test/e2e-final-${screenshotCount}.png`;
          await p.screenshot({ path: ssPath, fullPage: true }).catch(() => {});
          addResult(`Final screenshot: ${ssPath} (${p.url()})`);
        }
      }
    } catch(e) {}
  }

  // Write results
  results.push('', '---', `**Total time**: ${Math.round((Date.now() - startTime) / 1000)}s`);
  if (ebayItemId) results.push(`**eBay Item ID**: ${ebayItemId}`);
  fs.writeFileSync(RESULTS_FILE, results.join('\n'));
  addResult(`Results written to ${RESULTS_FILE}`);
  
  process.exit(0);
}

run().catch(e => {
  addResult(`## FATAL: ${e.message}`);
  fs.writeFileSync(RESULTS_FILE, results.join('\n'));
  console.error(e);
  process.exit(1);
});
