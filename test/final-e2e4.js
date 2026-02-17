const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CDP_URL = 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID = 'hikiofeedjngalncoapgpmljpaoeolci';
const TEST_URL = 'https://a.aliexpress.com/_mMLcP7b';
const RESULT_FILE = '/Users/pyrite/Projects/dropflow-extension/test/FINAL-FINAL-RESULT.md';
const MAX_WAIT_MS = 25 * 60 * 1000;
const POLL_MS = 15000;

const log = (msg) => { const l = `[${new Date().toLocaleTimeString('en-AU',{timeZone:'Australia/Melbourne'})}] ${msg}`; console.log(l); return l; };

async function evalSW(browser, expr) {
  const targets = await browser.targets();
  const sw = targets.find(t => t.url().includes(EXT_ID) && t.type() === 'service_worker');
  if (!sw) throw new Error('SW not found. Targets: ' + targets.map(t=>t.type()).join(','));
  const c = await sw.createCDPSession();
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000 });
  await c.detach();
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function run() {
  const R = [];
  const add = m => R.push(log(m));
  const save = () => fs.writeFileSync(RESULT_FILE, R.join('\n'));

  add('# DropFlow FINAL E2E Test');
  add(`Started: ${new Date().toISOString()}`);

  let browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
  add('✅ Connected');

  // Reload
  try { await evalSW(browser, 'chrome.runtime.reload()'); } catch(e) { add('Reload triggered'); }
  await new Promise(r => setTimeout(r, 6000));
  browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null });
  add('✅ Reconnected');
  await new Promise(r => setTimeout(r, 3000));

  // Clear
  const cleared = await evalSW(browser, `
    new Promise(async res => {
      const all = await chrome.storage.local.get(null);
      const k = Object.keys(all).filter(k => k.startsWith('dropflow_')||k.startsWith('pending')||k.startsWith('aliBulk'));
      if(k.length) await chrome.storage.local.remove(k);
      res('Cleared '+k.length);
    })
  `);
  add(`✅ ${cleared}`);

  // Trigger - call handleStartAliBulkListing directly in SW scope
  const triggerResult = await evalSW(browser, `
    handleStartAliBulkListing({
      links: ['${TEST_URL}'],
      threadCount: 1,
      listingType: 'standard',
      ebayDomain: 'www.ebay.com.au'
    })
  `);
  add(`✅ Triggered: ${JSON.stringify(triggerResult)}`);

  // Monitor
  const t0 = Date.now();
  let last = '';
  let final = null;
  const stages = new Set();

  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const el = Math.round((Date.now() - t0) / 1000);

    try {
      const s = await evalSW(browser, `
        new Promise(async res => {
          const all = await chrome.storage.local.get(null);
          const keys = Object.keys(all).filter(k => k.startsWith('aliBulk')||k.startsWith('dropflow_')||k.startsWith('pending'));
          const o = {};
          for(const k of keys){
            const v = all[k];
            o[k] = typeof v==='object'&&v ? {status:v.status,stage:v.stage,error:v.error,ebayItemId:v.ebayItemId,substage:v.substage} : String(v).substring(0,200);
          }
          res(JSON.stringify(o));
        })
      `);
      const p = JSON.parse(s);
      let line = `[${el}s] `;
      for(const [k,v] of Object.entries(p)){
        if(typeof v==='object'&&v){
          line += `${k}:{s=${v.status},st=${v.stage}`;
          if(v.substage) line += '/'+v.substage;
          if(v.error) line += ',E='+v.error;
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
      try { browser = await puppeteer.connect({ browserWSEndpoint: CDP_URL, defaultViewport: null }); } catch(e2){}
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
      const dump = await evalSW(browser, `new Promise(async r=>{const a=await chrome.storage.local.get(null);r(JSON.stringify(a,null,2))})`);
      add('```json\n'+dump.substring(0,5000)+'\n```');
    } catch(e){}
  }

  if(!final||final.r!=='SUCCESS'){
    try {
      const pages = await browser.pages();
      for(const p of pages) if(p.url().includes('ebay')){
        await p.screenshot({path:'/Users/pyrite/Projects/dropflow-extension/test/final-screenshot.png',fullPage:true});
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
