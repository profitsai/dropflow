const CDP = require('chrome-remote-interface');

(async () => {
  const client = await CDP({ port: 53170 });
  const { Target } = client;
  const targets = await Target.getTargets();
  
  const sw = targets.targetInfos.find(t => t.type === 'service_worker' && t.url.includes('hikiofee'));
  if (!sw) { console.log('No SW found'); process.exit(1); }
  
  console.log('Attaching to SW:', sw.targetId);
  const swClient = await CDP({ port: 53170, target: sw.targetId });
  await swClient.Runtime.enable();
  await swClient.Console.enable();
  
  swClient.Runtime.on('consoleAPICalled', (params) => {
    const text = params.args.map(a => a.value || a.description || '').join(' ');
    console.log(`[SW] ${text.substring(0, 300)}`);
  });
  
  swClient.Runtime.on('exceptionThrown', (params) => {
    console.log(`[SW ERROR] ${params.exceptionDetails?.text || JSON.stringify(params).substring(0, 200)}`);
  });
  
  console.log('Monitoring SW console...');
  await new Promise(r => setTimeout(r, 300000));
})().catch(e => console.error('Error:', e.message));
