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

async function getTarget(browser, preferType) {
  const targets = await browser.targets();
  const extTargets = targets.filter(t => t.url().includes(EXT_ID));
  if (preferType) {
    const t = extTargets.find(t => t.type() === preferType);
    if (t) return t;
  }
  // Priority: service_worker > background_page > anything
  return extTargets.find(t => t.type() === 'service_worker')
    || extTargets.find(t => t.type() === 'background_page')
    || extTargets[0];
}

async function evalOn(browser, expr, preferType) {
  const target = await getTarget(browser, preferType);
  if (!target) throw new Error('No extension target found');
  const client = await target.createCDPSession();
  await client.send('Runtime.enable');
  const result = await client.send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 30000
  });
  await client.detach();
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function run() {
  const results = [];
  const addResult = (msg) => results.push(log(msg));
  const writeResults = () => fs.writeFileSync(RESULT_FILE, results.join('\n'));

  addResult('# DropFlow FINAL E2E Test');
  addResult(`Started: ${new Date().toISOString()}`);

  let browser;
  try {
    browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
    addResult('✅ Connected to browser');
  } catch (e) {
    addResult(`❌ Connect failed: ${e.message}`);
    writeResults(); return;
  }

  // Reload extension
  try {
    addResult('Reloading extension...');
    await evalOn(browser, 'chrome.runtime.reload()', 'service_worker');
  } catch (e) {
    addResult('Reload triggered (expected disconnect)');
  }
  await new Promise(r => setTimeout(r, 6000));
  
  browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
  addResult('✅ Reconnected');
  await new Promise(r => setTimeout(r, 3000));

  // Clear state - use SW
  try {
    const r = await evalOn(browser, `
      new Promise(async (resolve) => {
        const all = await chrome.storage.local.get(null);
        const keys = Object.keys(all).filter(k => k.startsWith('dropflow_') || k.startsWith('pending') || k.startsWith('aliBulk'));
        if (keys.length > 0) await chrome.storage.local.remove(keys);
        resolve('Cleared ' + keys.length + ' keys');
      })
    `, 'service_worker');
    addResult(`✅ ${r}`);
  } catch (e) {
    addResult(`⚠️ Clear: ${e.message}`);
  }

  // Trigger - directly call the handler on the SW
  try {
    // First check what's available in the SW scope
    const triggerResult = await evalOn(browser, `
      new Promise((resolve, reject) => {
        // We're in the SW context, so we can dispatch the message internally
        // by calling the handler directly or using the same sendMessage pattern
        const msg = {
          type: 'START_ALI_BULK_LISTING',
          urls: ['${TEST_URL}'],
          ebaySite: 'ebay.com.au',
          listingType: 'standard',
          threadCount: 1
        };
        // Try dispatching through the message listener
        if (typeof handleMessage === 'function') {
          handleMessage(msg, {}, (resp) => resolve(JSON.stringify(resp)));
        } else {
          // Emit through chrome.runtime
          chrome.runtime.sendMessage(msg, (resp) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(JSON.stringify(resp));
          });
        }
      })
    `, 'service_worker');
    addResult(`✅ Triggered: ${triggerResult}`);
  } catch (e) {
    addResult(`⚠️ sendMessage failed, trying dispatchEvent approach...`);
    // Alternative: simulate the onMessage event
    try {
      const r2 = await evalOn(browser, `
        new Promise((resolve, reject) => {
          // In MV3 SW, listeners are registered. Let's try self.dispatchEvent
          const msg = {
            type: 'START_ALI_BULK_LISTING',
            urls: ['${TEST_URL}'],
            ebaySite: 'ebay.com.au',
            listingType: 'standard',
            threadCount: 1
          };
          // Get all listeners
          const listeners = chrome.runtime.onMessage._listeners || [];
          if (listeners.length > 0) {
            listeners[0](msg, { id: chrome.runtime.id }, (resp) => resolve(JSON.stringify(resp)));
          } else {
            // Last resort: just set storage directly to trigger
            chrome.storage.local.set({
              aliBulkActive: true,
              aliBulkConfig: {
                urls: ['${TEST_URL}'],
                ebaySite: 'ebay.com.au',
                listingType: 'standard',
                threadCount: 1
              }
            }, () => resolve('Set storage directly'));
          }
        })
      `, 'service_worker');
      addResult(`✅ Alt trigger: ${r2}`);
    } catch (e2) {
      addResult(`❌ All trigger methods failed: ${e2.message}`);
      writeResults(); return;
    }
  }

  // Monitor
  const startTime = Date.now();
  let lastStatus = '';
  let finalStatus = null;
  const stagesSeen = new Set();

  while (Date.now() - startTime < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    try {
      const status = await evalOn(browser, `
        new Promise(async (resolve) => {
          const all = await chrome.storage.local.get(null);
          const keys = Object.keys(all).filter(k => k.startsWith('aliBulk') || k.startsWith('dropflow_') || k.startsWith('pending'));
          const summary = {};
          for (const k of keys) {
            const val = all[k];
            if (typeof val === 'object' && val !== null) {
              summary[k] = { status: val.status, stage: val.stage, error: val.error, ebayItemId: val.ebayItemId, substage: val.substage, currentUrl: val.currentUrl };
            } else {
              summary[k] = String(val).substring(0, 200);
            }
          }
          resolve(JSON.stringify(summary));
        })
      `, 'service_worker');
      
      const parsed = JSON.parse(status);
      let statusLine = `[${elapsed}s] `;
      const entries = Object.entries(parsed);
      
      if (entries.length === 0) {
        statusLine += 'No state keys';
      } else {
        for (const [k, v] of entries) {
          if (typeof v === 'object' && v !== null) {
            statusLine += `${k}:{status=${v.status},stage=${v.stage}`;
            if (v.substage) statusLine += `/${v.substage}`;
            if (v.error) statusLine += `,err=${v.error}`;
            if (v.ebayItemId) statusLine += `,itemId=${v.ebayItemId}`;
            statusLine += '} ';
            if (v.stage) stagesSeen.add(v.stage);
          } else {
            statusLine += `${k}=${v} `;
          }
        }
      }

      if (statusLine !== lastStatus) {
        addResult(statusLine);
        lastStatus = statusLine;
      } else {
        console.log(`[${elapsed}s] (unchanged)`);
      }

      for (const [k, v] of entries) {
        if (typeof v === 'object' && v !== null) {
          if (v.status === 'complete' || v.status === 'success' || v.ebayItemId) {
            finalStatus = { result: 'SUCCESS', ebayItemId: v.ebayItemId, data: v };
          }
          if (v.status === 'error' || v.status === 'failed') {
            finalStatus = { result: 'FAILED', error: v.error, data: v };
          }
        }
      }
      if (finalStatus) break;
    } catch (e) {
      addResult(`[${elapsed}s] ⚠️ Poll error: ${e.message}`);
      try { browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null }); } catch(e2){}
    }
  }

  addResult('');
  addResult('---');
  addResult(`## Stages seen: ${[...stagesSeen].join(', ') || 'none'}`);

  if (finalStatus) {
    if (finalStatus.result === 'SUCCESS') {
      addResult(`## 🎉 VICTORY! eBay Item ID: ${finalStatus.ebayItemId}`);
    } else {
      addResult(`## ❌ FAILED: ${finalStatus.error}`);
    }
    addResult('```json');
    addResult(JSON.stringify(finalStatus.data, null, 2));
    addResult('```');
  } else {
    addResult('## ⏰ TIMEOUT');
  }

  // Screenshot on failure
  if (!finalStatus || finalStatus.result !== 'SUCCESS') {
    try {
      const pages = await browser.pages();
      for (const page of pages) {
        if (page.url().includes('ebay')) {
          await page.screenshot({ path: '/Users/pyrite/Projects/dropflow-extension/test/final-screenshot.png', fullPage: true });
          addResult('📸 Screenshot: final-screenshot.png');
          break;
        }
      }
    } catch (e) {}
  }

  addResult(`\nCompleted: ${new Date().toISOString()}`);
  writeResults();
  console.log(`Results written to ${RESULT_FILE}`);
}

run().catch(e => {
  console.error('Fatal:', e);
  fs.writeFileSync(RESULT_FILE, `# FATAL ERROR\n${e.message}\n${e.stack}`);
});
