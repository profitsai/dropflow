const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const SHORT_URL = 'https://a.aliexpress.com/_mMLcP7b';
const REPORT_PATH = '/Users/pyrite/Projects/dropflow-extension/test/SINGLE-TEST-RESULT.md';
const SHOT_DIR = '/Users/pyrite/Projects/dropflow-extension/test/single-test-shots';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const startedAt = new Date();
  const logs = [];
  const snapshots = [];
  const errors = [];

  function log(msg, obj) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    logs.push(obj ? `${line} ${JSON.stringify(obj)}` : line);
    console.log(line, obj || '');
  }

  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });

  const seenPages = new WeakSet();
  async function attachPage(page) {
    if (!page || seenPages.has(page)) return;
    seenPages.add(page);
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      const entry = `[console:${type}] ${text}`;
      logs.push(entry);
      if (type === 'error' || /error|failed|exception/i.test(text)) errors.push(entry);
    });
    page.on('pageerror', (err) => {
      const entry = `[pageerror] ${err.message}`;
      logs.push(entry);
      errors.push(entry);
    });
  }

  for (const p of await browser.pages()) await attachPage(p);
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      try { await attachPage(await target.page()); } catch {}
    }
  });

  const findExtContext = async () => {
    for (const t of browser.targets()) {
      const u = t.url() || '';
      if (u.startsWith(`chrome-extension://${EXT_ID}/`) && (t.type() === 'service_worker' || t.type() === 'background_page' || t.type() === 'page')) {
        if (t.type() === 'service_worker') {
          const w = await t.worker();
          if (w) return { kind: 'worker', ctx: w, target: t };
        } else if (t.type() === 'page') {
          const p = await t.page();
          if (p) return { kind: 'page', ctx: p, target: t };
        }
      }
    }
    return null;
  };

  let ext = await findExtContext();
  if (!ext) {
    // Try opening extension root page to get a usable context
    const p = await browser.newPage();
    await attachPage(p);
    await p.goto(`chrome-extension://${EXT_ID}/`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await sleep(1000);
    ext = await findExtContext();
  }

  if (!ext) throw new Error('Could not find extension execution context');

  log('Using extension context', { kind: ext.kind, url: ext.target.url(), type: ext.target.type() });

  const clearResult = await ext.ctx.evaluate(async () => {
    const keys = ['aliBulkRunning','aliBulkPaused','aliBulkAbort','dropflow_last_fill_results','dropflow_variation_steps','dropflow_variation_log'];
    await chrome.storage.local.remove(keys);
    return new Promise((resolve) => chrome.storage.local.get(keys, (v) => resolve(v)));
  });
  log('Cleared stale keys', clearResult);

  const startPayload = {
    type: 'START_ALI_BULK_LISTING',
    links: [SHORT_URL],
    marketplace: 'ebay.com.au',
    ebayDomain: 'www.ebay.com.au',
    listingType: 'standard',
    threadCount: 1,
  };

  const sendResult = await ext.ctx.evaluate(async (payload) => {
    return await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (resp) => {
          const err = chrome.runtime.lastError?.message || null;
          resolve({ resp: resp ?? null, err });
        });
      } catch (e) {
        resolve({ resp: null, err: e.message });
      }
    });
  }, startPayload);
  log('Sent START_ALI_BULK_LISTING', sendResult);

  const monitorKeys = ['aliBulkRunning','aliBulkPaused','aliBulkAbort','dropflow_last_fill_results','dropflow_variation_steps','dropflow_variation_log'];
  const maxMs = 15 * 60 * 1000;
  const intervalMs = 10 * 1000;
  const t0 = Date.now();
  let iter = 0;
  let completed = false;

  while (Date.now() - t0 < maxMs) {
    iter++;

    const allTargets = browser.targets().map(t => ({ type: t.type(), url: t.url() }));

    let storage = null;
    try {
      storage = await ext.ctx.evaluate(async (keys) => {
        return await new Promise((resolve) => chrome.storage.local.get(keys, (v) => resolve(v)));
      }, monitorKeys);
    } catch (e) {
      errors.push(`storage-read-failed: ${e.message}`);
    }

    const step = {
      t: new Date().toISOString(),
      iter,
      elapsedSec: Math.round((Date.now() - t0) / 1000),
      tabs: allTargets.filter(t => t.type === 'page').map(t => t.url),
      storage,
    };
    snapshots.push(step);
    log('Monitor tick', step);

    const pages = await browser.pages();
    let shotCount = 0;
    for (const p of pages) {
      const u = p.url();
      if (/aliexpress|ebay\.com\.au|chrome-extension:\/\//i.test(u)) {
        try {
          const file = path.join(SHOT_DIR, `iter${String(iter).padStart(3,'0')}_${shotCount}.png`);
          await p.screenshot({ path: file, fullPage: true });
          shotCount++;
        } catch (e) {
          errors.push(`screenshot-failed ${u}: ${e.message}`);
        }
      }
    }

    const running = storage?.aliBulkRunning;
    const paused = storage?.aliBulkPaused;
    if (iter > 2 && running === false && !paused) {
      completed = true;
      log('Detected aliBulkRunning false; marking complete');
      break;
    }

    await sleep(intervalMs);
  }

  const endedAt = new Date();
  const finalStorage = await ext.ctx.evaluate(async (keys) => {
    return await new Promise((resolve) => chrome.storage.local.get(keys, (v) => resolve(v)));
  }, monitorKeys).catch(() => null);

  // Bug heuristics
  const variationStepsCounts = snapshots
    .map(s => s.storage?.dropflow_variation_steps)
    .filter(v => typeof v === 'number');
  const variationLikelyLoop = variationStepsCounts.length > 8 && variationStepsCounts.slice(-5).every(v => v === variationStepsCounts[variationStepsCounts.length - 1]) && (finalStorage?.aliBulkRunning === true);

  const fillResults = finalStorage?.dropflow_last_fill_results || snapshots.map(s => s.storage?.dropflow_last_fill_results).find(Boolean);
  const photosSignal = JSON.stringify(fillResults || {}).match(/photo|image|upload/i) ? 'possible' : 'unknown';

  const report = `# DropFlow Single Product Test Result\n\n- Started: ${startedAt.toISOString()}\n- Ended: ${endedAt.toISOString()}\n- Duration: ${Math.round((endedAt - startedAt)/1000)}s\n- CDP: alive\n- Extension ID: ${EXT_ID}\n- Product URL: ${SHORT_URL}\n\n## Step Results\n1. CDP check: ✅\n2. Cleared stale keys: ✅\n3. Sent START_ALI_BULK_LISTING: ${sendResult.err ? `⚠️ error: ${sendResult.err}` : '✅'}\n4. Monitored every 10s: ✅ (${snapshots.length} ticks)\n\n## Final Storage Snapshot\n\n\`\`\`json\n${JSON.stringify(finalStorage, null, 2)}\n\`\`\`\n\n## Bug Verification\n- Bug 1 (variation builder loop): ${variationLikelyLoop ? '❌ Possible looping detected' : '✅ No clear looping pattern detected'}\n- Bug 2 (photos upload): ${photosSignal === 'possible' ? '✅/⚠️ fill results contain photo/image/upload signals' : '⚠️ Could not confirm from storage alone'}\n- Bug 3 (bulk flag clears): ${(finalStorage && finalStorage.aliBulkRunning === false) ? '✅ aliBulkRunning=false' : '❌ not cleared or unknown'}\n\n## Tabs Observed\n${[...new Set(snapshots.flatMap(s => s.tabs || []))].map(u => `- ${u}`).join('\n')}\n\n## Console Errors\n${errors.length ? errors.map(e => `- ${e}`).join('\n') : '- None captured'}\n\n## Monitoring Log (condensed)\n\`\`\`json\n${JSON.stringify(snapshots, null, 2)}\n\`\`\`\n\n## Artifacts\n- Screenshots dir: ${SHOT_DIR}\n`;

  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  const rawLogPath = '/Users/pyrite/Projects/dropflow-extension/test/SINGLE-TEST-RAW-LOG.txt';
  fs.writeFileSync(rawLogPath, logs.join('\n'), 'utf8');

  console.log(`Report written to ${REPORT_PATH}`);
  console.log(`Raw log written to ${rawLogPath}`);

  await browser.disconnect();

  if (!completed) process.exitCode = 2;
})();
