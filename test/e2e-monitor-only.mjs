import puppeteer from 'puppeteer-core';
const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  
  // Attach to SW console - log EVERYTHING
  const swTarget = browser.targets().find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  if (swTarget) {
    const cdp = await swTarget.createCDPSession();
    await cdp.send('Runtime.enable');
    cdp.on('Runtime.consoleAPICalled', (event) => {
      const text = event.args.map(a => a.value ?? a.description ?? JSON.stringify(a)).join(' ');
      console.log(`[SW:${event.type}]`, text.substring(0, 400));
    });
    cdp.on('Runtime.exceptionThrown', (event) => {
      console.log(`[SW:EXC]`, event.exceptionDetails?.text, event.exceptionDetails?.exception?.description?.substring(0, 300));
    });
    console.log('Attached to SW, listening to ALL console...');
  } else {
    console.log('No SW found!');
  }

  // Track pages
  browser.on('targetcreated', (t) => console.log('[+]', t.type(), t.url()?.substring(0, 100)));
  browser.on('targetdestroyed', (t) => console.log('[-]', t.type(), t.url()?.substring(0, 100)));

  // Just wait and log
  await sleep(300000);
  browser.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
