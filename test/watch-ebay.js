const CDP = require('chrome-remote-interface');

(async () => {
  const client = await CDP({ port: 53170 });
  const targets = await client.Target.getTargets();
  
  // Find eBay page
  const ebayTarget = targets.targetInfos.find(t => t.type === 'page' && t.url.includes('ebay.com.au'));
  if (!ebayTarget) { console.log('No eBay page found'); process.exit(1); }
  
  console.log('Attaching to eBay page:', ebayTarget.url.substring(0, 100));
  const ebayClient = await CDP({ port: 53170, target: ebayTarget.targetId });
  await ebayClient.Runtime.enable();
  
  ebayClient.Runtime.on('consoleAPICalled', (params) => {
    const text = params.args.map(a => a.value || a.description || '').join(' ');
    if (text.includes('DropFlow') || text.includes('variation') || text.includes('photo') || 
        text.includes('image') || text.includes('upload') || text.includes('builder') ||
        text.includes('error') || text.includes('Error') || text.includes('fillVariation') ||
        text.includes('MSKU') || text.includes('bulkedit') || text.includes('specifics') ||
        text.includes('title') || text.includes('draft')) {
      console.log(`[EBAY] ${text.substring(0, 300)}`);
    }
  });
  
  ebayClient.Runtime.on('exceptionThrown', (params) => {
    const desc = params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || '';
    console.log(`[EBAY ERROR] ${desc.substring(0, 300)}`);
  });
  
  // Also attach to SW
  const sw = targets.targetInfos.find(t => t.type === 'service_worker' && t.url.includes('hikiofee'));
  if (sw) {
    const swClient = await CDP({ port: 53170, target: sw.targetId });
    await swClient.Runtime.enable();
    swClient.Runtime.on('consoleAPICalled', (params) => {
      const text = params.args.map(a => a.value || a.description || '').join(' ');
      console.log(`[SW] ${text.substring(0, 300)}`);
    });
    swClient.Runtime.on('exceptionThrown', (params) => {
      console.log(`[SW ERROR] ${(params.exceptionDetails?.exception?.description || '').substring(0, 300)}`);
    });
  }
  
  console.log('Watching eBay page + SW console...');
  await new Promise(r => setTimeout(r, 240000));
})().catch(e => console.error('Error:', e.message));
