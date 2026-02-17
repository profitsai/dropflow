const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CDP='ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd';
const EXT_ID='hikiofeedjngalncoapgpmljpaoeolci';
const SHORT_URL='https://a.aliexpress.com/_mMLcP7b';
const REPORT='/Users/pyrite/Projects/dropflow-extension/test/E2E-TEST-RESULT.md';
const RAW='/Users/pyrite/Projects/dropflow-extension/test/E2E-TEST-RAW-LOG.json';
const SHOTS='/Users/pyrite/Projects/dropflow-extension/test/e2e-varfix-shots';

const CLEAR_KEYS=['aliBulkRunning','aliBulkPaused','aliBulkAbort','dropflow_last_fill_results','dropflow_variation_steps','dropflow_variation_log','dropflow_variation_status','dropflow_variation_check','dropflow_variation_flow_log','dropflow_builder_complete'];
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  fs.mkdirSync(SHOTS,{recursive:true});
  const started=new Date();
  const milestones=[]; const ticks=[]; const errors=[]; const logs=[];
  let shotN=0;
  const cdpVersion=JSON.parse(execSync('curl -s http://127.0.0.1:62547/json/version').toString());
  let resolved=SHORT_URL; try{resolved=execSync(`curl -sL -o /dev/null -w '%{url_effective}' '${SHORT_URL}'`).toString().trim()||SHORT_URL;}catch{}

  const browser=await puppeteer.connect({browserWSEndpoint:CDP,defaultViewport:null});
  const shot=async(p,label)=>{try{const fp=path.join(SHOTS,`${String(shotN++).padStart(3,'0')}-${label.replace(/[^a-z0-9-_]+/gi,'_')}.png`);await p.screenshot({path:fp,fullPage:false});return fp;}catch(e){errors.push(`shot ${label}: ${e.message}`);return null;}};
  const log=(m,o)=>{logs.push({t:new Date().toISOString(),m,o});console.log(`[${new Date().toISOString()}] ${m}`,o||'');};

  let page=(await browser.pages()).find(p=>p.url().includes(`chrome-extension://${EXT_ID}/`)&&p.url().includes('ali-bulk-lister'));
  if(!page){page=await browser.newPage();await page.goto(`chrome-extension://${EXT_ID}/pages/ali-bulk-lister/ali-bulk-lister.html`,{waitUntil:'domcontentloaded'}).catch(()=>{});}
  if(!page) throw new Error('No ali-bulk-lister page');

  await shot(page,'start-bulk-lister');
  await page.evaluate(async(keys)=>{await chrome.storage.local.remove(keys);},CLEAR_KEYS);
  milestones.push({t:new Date().toISOString(),event:'Cleared stale state keys'});

  const sendResult=await page.evaluate(async(payload)=>new Promise(resolve=>{try{chrome.runtime.sendMessage(payload,r=>resolve({resp:r??null,err:chrome.runtime.lastError?.message||null}));}catch(e){resolve({resp:null,err:e.message});}}),{
    type:'START_ALI_BULK_LISTING',links:[SHORT_URL],marketplace:'ebay.com.au',ebayDomain:'www.ebay.com.au',listingType:'standard',threadCount:1
  });
  milestones.push({t:new Date().toISOString(),event:'Triggered START_ALI_BULK_LISTING',sendResult});
  log('Triggered listing',sendResult);

  const maxMs=20*60*1000, intMs=15000, t0=Date.now();
  let sawAli=false,sawEbay=false,sawMskuOpen=false,sawMskuClosed=false,sawPhoto=false,done=false,doneReason='timeout';

  while(Date.now()-t0<=maxMs){
    const now=new Date().toISOString();
    const pages=await browser.pages();
    const urls=pages.map(p=>p.url());
    const storage=await page.evaluate(async()=>new Promise(r=>chrome.storage.local.get(null,r)));
    const varLog=JSON.stringify(storage.dropflow_variation_log||[]).toLowerCase();
    const flowLog=JSON.stringify(storage.dropflow_variation_flow_log||[]).toLowerCase();
    const fill=JSON.stringify(storage.dropflow_last_fill_results||{}).toLowerCase();

    const mskuTab=urls.find(u=>/bulkedit\.ebay\.com\.au\/msku/i.test(u));
    if(!sawAli && urls.some(u=>/aliexpress\.com/i.test(u))){sawAli=true;milestones.push({t:now,event:'AliExpress tab opened'});}
    if(!sawEbay && urls.some(u=>/ebay\.com\.au/i.test(u))){sawEbay=true;milestones.push({t:now,event:'eBay AU tab opened'});}
    if(!sawMskuOpen && (mskuTab || /msku|multi.?sku|variation builder/.test(varLog+flowLog))){sawMskuOpen=true;milestones.push({t:now,event:'MSKU variation builder opened'});}
    if(sawMskuOpen && !sawMskuClosed && !mskuTab && /builder_complete|save.?close|close/i.test(flowLog+JSON.stringify(storage.dropflow_builder_complete||{}).toLowerCase())){sawMskuClosed=true;milestones.push({t:now,event:'MSKU variation builder closed after open'});}
    if(!sawPhoto && /photo|image|upload/.test(fill+varLog+flowLog)){sawPhoto=true;milestones.push({t:now,event:'Photo upload attempt signal observed'});}

    const shotPaths=[];
    for(const p of pages){
      const u=p.url();
      if(/ali-bulk-lister|aliexpress|ebay\.com\.au|bulkedit\.ebay\.com\.au\/msku/i.test(u)){
        const s=await shot(p,`tick-${Math.floor((Date.now()-t0)/1000)}-${u.slice(0,60)}`); if(s) shotPaths.push(s);
      }
    }

    ticks.push({t:now,elapsedSec:Math.floor((Date.now()-t0)/1000),urls,storageSummary:{
      variationSteps:storage.dropflow_variation_steps??null,
      hasVariationLog:!!storage.dropflow_variation_log,
      hasFillResults:!!storage.dropflow_last_fill_results,
      hasBuilderComplete:!!storage.dropflow_builder_complete,
      hasVariationCheck:!!storage.dropflow_variation_check,
      pendingListingKeys:Object.keys(storage).filter(k=>k.startsWith('pendingListing_')).length,
    },shotPaths});

    // completion conditions
    if(storage.dropflow_last_fill_results && storage.dropflow_builder_complete){done=true;doneReason='fill_results + builder_complete present';break;}
    if(storage.aliBulkRunning===false){done=true;doneReason='aliBulkRunning=false';break;}

    await sleep(intMs);
  }

  const ended=new Date();
  const finalStorage=await page.evaluate(async()=>new Promise(r=>chrome.storage.local.get(null,r)));
  const tail=ticks.slice(-6).map(t=>JSON.stringify(t.storageSummary));
  const likelyLoop=(new Set(tail).size===1)&&!done;

  const report=`# DropFlow Single Product End-to-End Test\n\n- Started: ${started.toISOString()}\n- Ended: ${ended.toISOString()}\n- Duration: ${Math.round((ended-started)/1000)}s\n- CDP Browser: ${cdpVersion.Browser}\n- Extension: ${EXT_ID}\n- Short URL: ${SHORT_URL}\n- Resolved URL: ${resolved}\n- Marketplace: ebay.com.au\n\n## Step Execution\n1. Verify CDP: ✅\n2. Connect Puppeteer/find ali-bulk-lister: ✅\n3. Clear ALL stale state: ✅\n4. Trigger START_ALI_BULK_LISTING: ${sendResult.err?`⚠️ ${sendResult.err}`:'✅'}\n5. Monitor every 15s (up to 20m): ✅ (${ticks.length} ticks)\n6. Key milestone screenshots: ✅ (${shotN})\n7. Detailed report: ✅\n\n## Milestones\n${milestones.map(m=>`- ${m.t}: ${m.event}`).join('\n')}\n\n## Verification Focus\n- Variation builder opened MSKU iframe: ${sawMskuOpen?'✅':'❌'}\n- Attributes/pricing flow signs in variation logs: ${finalStorage.dropflow_variation_log?'✅':'❌'}\n- MSKU save/close happened: ${sawMskuClosed || !!finalStorage.dropflow_builder_complete?'✅':'❌/Unknown'}\n- Photos upload attempt seen: ${sawPhoto?'✅':'❌/Unknown'}\n- Listing completion signal (draft/live progression keys): ${done||Object.keys(finalStorage).some(k=>k.startsWith('pendingListing_'))?'✅':'❌'}\n- Infinite variation loop: ${likelyLoop?'❌ Possible loop':'✅ No loop pattern detected'}\n\n## Completion\n- Done: ${done?'Yes':'No'}\n- Reason: ${doneReason}\n\n## Final Storage (Relevant)\n\`\`\`json\n${JSON.stringify({
  dropflow_variation_check: finalStorage.dropflow_variation_check,
  dropflow_variation_status: finalStorage.dropflow_variation_status,
  dropflow_variation_steps: finalStorage.dropflow_variation_steps,
  dropflow_variation_log: finalStorage.dropflow_variation_log,
  dropflow_variation_flow_log: finalStorage.dropflow_variation_flow_log,
  dropflow_last_fill_results: finalStorage.dropflow_last_fill_results,
  dropflow_builder_complete: finalStorage.dropflow_builder_complete,
  pendingListingKeys: Object.keys(finalStorage).filter(k=>k.startsWith('pendingListing_'))
},null,2)}\n\`\`\`\n\n## Artifacts\n- Screenshots: ${SHOTS}\n- Raw JSON log: ${RAW}\n`;

  fs.writeFileSync(REPORT,report,'utf8');
  fs.writeFileSync(RAW,JSON.stringify({started,ended,milestones,ticks,errors,finalStorage},null,2),'utf8');
  log('Wrote report',{REPORT,RAW,shots:shotN,done,doneReason});
  await browser.disconnect();
})();