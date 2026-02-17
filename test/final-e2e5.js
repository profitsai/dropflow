const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const TEST_URL = 'https://a.aliexpress.com/_mMLcP7b';
const RESULT_FILE = '/Users/pyrite/Projects/dropflow-extension/test/FINAL-FINAL-RESULT.md';
const MAX_WAIT_MS = 25 * 60 * 1000;
const POLL_MS = 15000;

const ts = () => new Date().toLocaleTimeString('en-AU',{timeZone:'Australia/Melbourne'});
const R = [];
const add = m => { const l=`[${ts()}] ${m}`; console.log(l); R.push(l); };
const save = () => fs.writeFileSync(RESULT_FILE, R.join('\n'));

async function findOrCreateExtPage(browser) {
  const pages = await browser.pages();
  let p = pages.find(p => p.url().includes(EXT_ID));
  if (!p) {
    p = await browser.newPage();
    await p.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
  }
  return p;
}

async function run() {
  add('# DropFlow FINAL E2E Test');
  add(`Started: ${new Date().toISOString()}`);

  let browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
  add('✅ Connected');

  // Don't reload - just clear state and go. Reload seems to break SW registration.
  // Instead, open extension page and use it to communicate with SW.
  
  const extPage = await findOrCreateExtPage(browser);
  add(`✅ Extension page: ${extPage.url().substring(0,80)}`);

  // Wait for SW to be ready (the page load should wake it)
  await new Promise(r => setTimeout(r, 3000));

  // Check SW status from page context
  const swCheck = await extPage.evaluate(async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'PING' });
      return 'SW responded: ' + JSON.stringify(r);
    } catch(e) { return 'SW error: ' + e.message; }
  });
  add(`SW check: ${swCheck}`);

  // Terminate any existing run
  try {
    await extPage.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: 'TERMINATE_ALI_BULK_LISTING' });
    });
    await new Promise(r => setTimeout(r, 2000));
  } catch(e) {}

  // Clear state
  const cleared = await extPage.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith('dropflow_')||k.startsWith('pending')||k.startsWith('aliBulk'));
    if(keys.length) await chrome.storage.local.remove(keys);
    return 'Cleared ' + keys.length + ' keys: ' + keys.slice(0,10).join(', ');
  });
  add(`✅ ${cleared}`);

  // Trigger
  const result = await extPage.evaluate(async (url) => {
    try {
      const r = await chrome.runtime.sendMessage({
        type: 'START_ALI_BULK_LISTING',
        links: [url],
        threadCount: 1,
        listingType: 'standard',
        ebayDomain: 'www.ebay.com.au'
      });
      return JSON.stringify(r);
    } catch(e) { return 'ERROR: ' + e.message; }
  }, TEST_URL);
  add(`✅ Triggered: ${result}`);

  if (result.startsWith('ERROR')) { save(); return; }

  // Monitor via storage
  const t0 = Date.now();
  let last = '';
  let final = null;
  const stages = new Set();

  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const el = Math.round((Date.now() - t0) / 1000);

    try {
      const s = await extPage.evaluate(async () => {
        const all = await chrome.storage.local.get(null);
        const keys = Object.keys(all).filter(k => k.startsWith('aliBulk')||k.startsWith('dropflow_')||k.startsWith('pending'));
        const o = {};
        for(const k of keys){
          const v = all[k];
          o[k] = typeof v==='object'&&v ? {status:v.status,stage:v.stage,error:v.error,ebayItemId:v.ebayItemId,substage:v.substage} : String(v).substring(0,200);
        }
        return JSON.stringify(o);
      });
      const p = JSON.parse(s);
      let line = `[${el}s] `;
      for(const [k,v] of Object.entries(p)){
        if(typeof v==='object'&&v){
          line += `${k}:{s=${v.status},st=${v.stage}`;
          if(v.substage) line += '/'+v.substage;
          if(v.error) line += ',E='+String(v.error).substring(0,200);
          if(v.ebayItemId) line += ',id='+v.ebayItemId;
          line += '} ';
          if(v.stage) stages.add(v.stage);
        } else line += `${k}=${v} `;
      }

      if(line !== last){ add(line); last = line; } else console.log(`[${el}s] …`);

      for(const [k,v] of Object.entries(p)){
        if(typeof v==='object'&&v){
          if(v.status==='complete'||v.status==='success'||v.ebayItemId) final = {r:'SUCCESS',id:v.ebayItemId,d:v};
          if(v.status==='error'||v.status==='failed') final = {r:'FAILED',e:v.error,d:v};
        }
      }
      if(final) break;
    } catch(e){
      add(`[${el}s] ⚠️ ${e.message}`);
      // Page might have closed, try to find another or reconnect
      try {
        browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
      } catch(e2){}
    }
  }

  add(''); add('---');
  add(`Stages: ${[...stages].join(', ')||'none'}`);
  if(final){
    if(final.r==='SUCCESS') add(`## 🎉 VICTORY! eBay Item: ${final.id}`);
    else add(`## ❌ FAILED: ${final.e}`);
    add('```json\n'+JSON.stringify(final.d,null,2)+'\n```');
  } else {
    add('## ⏰ TIMEOUT');
    try {
      const dump = await extPage.evaluate(async()=>{const a=await chrome.storage.local.get(null);return JSON.stringify(a,null,2)});
      add('```json\n'+dump.substring(0,5000)+'\n```');
    } catch(e){}
  }

  // Screenshot
  if(!final||final.r!=='SUCCESS'){
    try {
      const pages = await browser.pages();
      for(const pg of pages) if(pg.url().includes('ebay.com.au/lstng')){
        await pg.screenshot({path:'/Users/pyrite/Projects/dropflow-extension/test/final-screenshot.png',fullPage:true});
        add('📸 final-screenshot.png'); break;
      }
    } catch(e){}
  }

  add(`\nCompleted: ${new Date().toISOString()}`);
  save();
  console.log('Done → ' + RESULT_FILE);
}

run().catch(e => {
  console.error('Fatal:', e);
  fs.writeFileSync(RESULT_FILE, `# FATAL\n${e.message}\n${e.stack}`);
});
