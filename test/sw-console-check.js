const puppeteer = require('puppeteer-core');
const WS = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  
  // Connect to service worker and get console
  const targets = await browser.targets();
  const swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes(EXT_ID));
  
  if (swTarget) {
    const sw = await swTarget.worker();
    
    // Check state
    const state = await sw.evaluate(() => {
      return {
        aliBulkRunning: typeof aliBulkRunning !== 'undefined' ? aliBulkRunning : 'undefined',
        aliBulkAbort: typeof aliBulkAbort !== 'undefined' ? aliBulkAbort : 'undefined',
        aliBulkPaused: typeof aliBulkPaused !== 'undefined' ? aliBulkPaused : 'undefined',
      };
    });
    console.log('Bulk state:', JSON.stringify(state));
    
    // Use CDP to get console messages
    const client = await swTarget.createCDPSession();
    
    // Get stored logs
    const logs = await sw.evaluate(async () => {
      const data = await chrome.storage.local.get('_swLogs');
      return data._swLogs;
    });
    console.log('SW stored logs:', JSON.stringify(logs));
    
    // Enable Runtime and listen for console
    await client.send('Runtime.enable');
    
    // Get any pending console messages 
    console.log('\nListening for SW console for 5 seconds...');
    client.on('Runtime.consoleAPICalled', (params) => {
      const args = params.args.map(a => a.value || a.description || '?').join(' ');
      console.log(`[SW ${params.type}] ${args}`);
    });
    
    await new Promise(r => setTimeout(r, 5000));
    await client.detach();
  }
  
  browser.disconnect();
})().catch(e => console.error(e.message));
