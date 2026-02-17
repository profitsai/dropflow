import puppeteer from 'puppeteer-core';

const CDP = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const EXT_PAGE = `chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function findPage(browser, match) {
  for (const p of await browser.pages()) {
    if (p.url().includes(match)) return p;
  }
  return null;
}

async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: CDP, defaultViewport: null });
  console.log('Connected');

  // Find ext page
  let extPage = await findPage(browser, 'ali-bulk-lister');
  if (!extPage) {
    console.log('Opening ext page...');
    extPage = await browser.newPage();
    await extPage.goto(EXT_PAGE, { waitUntil: 'domcontentloaded' });
  }
  console.log('Ext page ready');

  // Reload extension
  console.log('Reloading extension...');
  await extPage.evaluate(() => chrome.runtime.reload());
  await sleep(4000);

  // Re-open ext page after reload
  extPage = await findPage(browser, 'ali-bulk-lister');
  if (!extPage) {
    extPage = await browser.newPage();
    await extPage.goto(EXT_PAGE, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
  }
  console.log('Ext page after reload:', extPage.url());

  // Clear state
  await extPage.evaluate(() => chrome.storage.local.remove([
    'aliBulkRunning','aliBulkPaused','aliBulkAbort',
    'dropflow_last_fill_results','dropflow_variation_steps',
    'dropflow_variation_log','dropflow_variation_status',
    'dropflow_variation_check','dropflow_variation_flow_log',
    'dropflow_builder_complete','dropflow_variation_scripttag_diag',
    'dropflow_3dot_debug','dropflow_3dot_strategy'
  ]));
  console.log('State cleared');

  // Also close old eBay listing tabs to avoid confusion
  for (const p of await browser.pages()) {
    if (p.url().includes('ebay.com.au/lstng') && p !== extPage) {
      console.log('Closing old eBay tab:', p.url());
      await p.close();
    }
  }

  // Trigger
  console.log('Triggering...');
  const resp = await extPage.evaluate(() => {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: ['https://a.aliexpress.com/_mMLcP7b'],
        marketplace: 'ebay.com.au',
        ebayDomain: 'www.ebay.com.au',
        listingType: 'standard',
        threadCount: 1
      }, r => resolve(r));
    });
  });
  console.log('Response:', JSON.stringify(resp));
  console.log('DONE - test triggered');
}

run().catch(e => { console.error(e); process.exit(1); });
