import puppeteer from 'puppeteer-core';
const WS = 'ws://127.0.0.1:57542/devtools/browser/299cf9f0-0bf9-4e4d-9284-04884acce8de';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS, defaultViewport: null });
  const pages = await browser.pages();
  console.log('Pages:');
  for (const p of pages) console.log(' ', p.url());

  // Get full storage state
  const extPage = pages.find(p => p.url().includes(EXT_ID));
  if (!extPage) { console.log('No ext page'); browser.disconnect(); return; }

  // Get orchestration state
  const orch = await extPage.evaluate(async () => {
    const data = await chrome.storage.local.get(['dropflow_orchestration_state', 'dropflow_last_fill_results', 'dropflow_variation_log']);
    return data;
  });
  console.log('\nOrchestration:', JSON.stringify(orch.dropflow_orchestration_state, null, 2));
  console.log('\nLast fill results:', JSON.stringify(orch.dropflow_last_fill_results, null, 2));
  
  // Get variation log (full)
  const varLog = await extPage.evaluate(async () => {
    const data = await chrome.storage.local.get(['dropflow_variation_log']);
    return data.dropflow_variation_log;
  });
  console.log('\nVariation flow log:');
  if (Array.isArray(varLog)) {
    for (const entry of varLog) {
      console.log(`  [${entry.timestamp?.slice(11,19) || '?'}] ${entry.step} ${entry.ok !== undefined ? (entry.ok ? '✅' : '❌') : ''} ${entry.reason || ''}`);
    }
  } else {
    console.log(JSON.stringify(varLog)?.substring(0, 2000));
  }

  // Get fill trace
  const trace = await extPage.evaluate(async () => {
    const data = await chrome.storage.local.get(['_dropflow_fillform_trace']);
    return data._dropflow_fillform_trace;
  });
  console.log('\nFill trace:');
  if (Array.isArray(trace)) {
    for (const line of trace) console.log(' ', line);
  }

  browser.disconnect();
}
run().catch(e => console.error(e.message));
