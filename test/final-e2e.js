const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const TEST_URL = 'https://a.aliexpress.com/_mMLcP7b';
const RESULT_FILE = '/Users/pyrite/Projects/dropflow-extension/test/FINAL-FINAL-RESULT.md';
const MAX_WAIT_MS = 25 * 60 * 1000;
const POLL_MS = 15000;

function log(msg) {
  const ts = new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Melbourne' });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  return line;
}

async function getSWTarget(browser) {
  const targets = await browser.targets();
  const sw = targets.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  if (!sw) throw new Error('Service worker target not found');
  return sw;
}

async function evalSW(browser, expr) {
  const sw = await getSWTarget(browser);
  const client = await sw.createCDPSession();
  await client.send('Runtime.enable');
  const result = await client.send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 30000
  });
  await client.detach();
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

async function run() {
  const results = [];
  const addResult = (msg) => results.push(log(msg));

  addResult('# DropFlow FINAL E2E Test');
  addResult(`Started: ${new Date().toISOString()}`);

  let browser;
  try {
    browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
    addResult('✅ Connected to browser via CDP');
  } catch (e) {
    addResult(`❌ Failed to connect: ${e.message}`);
    fs.writeFileSync(RESULT_FILE, results.join('\n'));
    return;
  }

  // Step 1: Reload extension
  try {
    addResult('Reloading extension...');
    await evalSW(browser, 'chrome.runtime.reload()');
  } catch (e) {
    addResult('Extension reload triggered (expected disconnect)');
  }

  await new Promise(r => setTimeout(r, 6000));

  // Reconnect
  try {
    browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
    addResult('✅ Reconnected after reload');
  } catch (e) {
    addResult(`❌ Reconnect failed: ${e.message}`);
    fs.writeFileSync(RESULT_FILE, results.join('\n'));
    return;
  }

  // Step 2: Clear ALL state
  try {
    const clearExpr = `
      new Promise(async (resolve) => {
        const all = await chrome.storage.local.get(null);
        const keys = Object.keys(all).filter(k =>
          k.startsWith('dropflow_') || k.startsWith('pending') || k.startsWith('aliBulk')
        );
        if (keys.length > 0) await chrome.storage.local.remove(keys);
        resolve('Cleared ' + keys.length + ' keys: ' + keys.join(', '));
      })
    `;
    const clearResult = await evalSW(browser, clearExpr);
    addResult(`✅ State cleared: ${clearResult}`);
  } catch (e) {
    addResult(`⚠️ Clear state issue: ${e.message}`);
  }

  // Step 3: Trigger START_ALI_BULK_LISTING
  try {
    const triggerExpr = `
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'START_ALI_BULK_LISTING',
          urls: ['${TEST_URL}'],
          ebaySite: 'ebay.com.au',
          listingType: 'standard',
          threadCount: 1
        }, (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(JSON.stringify(response));
        });
      })
    `;
    const triggerResult = await evalSW(browser, triggerExpr);
    addResult(`✅ Triggered: ${triggerResult}`);
  } catch (e) {
    addResult(`❌ Trigger failed: ${e.message}`);
    fs.writeFileSync(RESULT_FILE, results.join('\n'));
    return;
  }

  // Step 4: Monitor
  const startTime = Date.now();
  let lastStatus = '';
  let finalStatus = null;
  const stagesSeen = new Set();

  while (Date.now() - startTime < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    try {
      const statusExpr = `
        new Promise(async (resolve) => {
          const all = await chrome.storage.local.get(null);
          const bulkKeys = Object.keys(all).filter(k => k.startsWith('aliBulk') || k.startsWith('dropflow_') || k.startsWith('pending'));
          const summary = {};
          for (const k of bulkKeys) {
            const val = all[k];
            if (typeof val === 'object' && val !== null) {
              summary[k] = { status: val.status, stage: val.stage, error: val.error, ebayItemId: val.ebayItemId, progress: val.progress };
            } else {
              summary[k] = val;
            }
          }
          resolve(JSON.stringify(summary));
        })
      `;
      const status = await evalSW(browser, statusExpr);
      const parsed = JSON.parse(status);

      // Extract meaningful info
      let statusLine = `[${elapsed}s] `;
      const entries = Object.entries(parsed);
      if (entries.length === 0) {
        statusLine += 'No state keys found';
      } else {
        for (const [k, v] of entries) {
          if (typeof v === 'object' && v !== null) {
            statusLine += `${k}: status=${v.status} stage=${v.stage}`;
            if (v.stage) stagesSeen.add(v.stage);
            if (v.error) statusLine += ` ERROR=${v.error}`;
            if (v.ebayItemId) statusLine += ` ebayItemId=${v.ebayItemId}`;
          } else {
            statusLine += `${k}=${JSON.stringify(v).substring(0, 100)} `;
          }
        }
      }

      if (statusLine !== lastStatus) {
        addResult(statusLine);
        lastStatus = statusLine;
      } else {
        console.log(`[${elapsed}s] (no change)`);
      }

      // Check for completion or error
      for (const [k, v] of entries) {
        if (typeof v === 'object' && v !== null) {
          if (v.status === 'complete' || v.status === 'success' || v.ebayItemId) {
            finalStatus = { result: 'SUCCESS', ebayItemId: v.ebayItemId, data: v };
            break;
          }
          if (v.status === 'error' || v.status === 'failed') {
            finalStatus = { result: 'FAILED', error: v.error, data: v };
            break;
          }
        }
      }

      if (finalStatus) break;
    } catch (e) {
      addResult(`[${elapsed}s] ⚠️ Poll error: ${e.message}`);
      // SW might have restarted, try reconnecting
      try {
        browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
        addResult(`[${elapsed}s] Reconnected`);
      } catch (e2) {
        addResult(`[${elapsed}s] ❌ Reconnect failed: ${e2.message}`);
      }
    }
  }

  // Final summary
  addResult('');
  addResult('---');
  addResult(`## Stages seen: ${[...stagesSeen].join(', ') || 'none'}`);
  
  if (finalStatus) {
    if (finalStatus.result === 'SUCCESS') {
      addResult(`## 🎉 VICTORY! eBay Item ID: ${finalStatus.ebayItemId}`);
      addResult(`Full data: ${JSON.stringify(finalStatus.data, null, 2)}`);
    } else {
      addResult(`## ❌ FAILED`);
      addResult(`Error: ${finalStatus.error}`);
      addResult(`Full data: ${JSON.stringify(finalStatus.data, null, 2)}`);
      
      // Try to take a screenshot of any open eBay tab
      try {
        const pages = await browser.pages();
        for (const page of pages) {
          if (page.url().includes('ebay')) {
            await page.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/final-error-screenshot.png', fullPage: true });
            addResult('Screenshot saved: final-error-screenshot.png');
            break;
          }
        }
      } catch (e) { }
    }
  } else {
    addResult('## ⏰ TIMEOUT - No completion after 25 minutes');
    
    // Get final full state dump
    try {
      const dump = await evalSW(browser, `
        new Promise(async (resolve) => {
          const all = await chrome.storage.local.get(null);
          resolve(JSON.stringify(all, null, 2));
        })
      `);
      addResult('Final state dump:');
      addResult('```json');
      addResult(dump);
      addResult('```');
    } catch (e) { }

    // Screenshot any eBay tabs
    try {
      const pages = await browser.pages();
      for (const page of pages) {
        if (page.url().includes('ebay')) {
          await page.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/final-timeout-screenshot.png', fullPage: true });
          addResult('Screenshot saved: final-timeout-screenshot.png');
          break;
        }
      }
    } catch (e) { }
  }

  addResult(`\nCompleted: ${new Date().toISOString()}`);
  
  fs.writeFileSync(RESULT_FILE, results.join('\n'));
  console.log(`\nResults written to ${RESULT_FILE}`);
}

run().catch(e => {
  console.error('Fatal:', e);
  fs.writeFileSync(RESULT_FILE, `# FATAL ERROR\n${e.message}\n${e.stack}`);
});
