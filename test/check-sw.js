const CDP = require('chrome-remote-interface');

(async () => {
  try {
    const client = await CDP({ port: 53170 });
    const { Target } = client;
    const targets = await Target.getTargets();
    
    console.log('=== All Targets ===');
    for (const t of targets.targetInfos) {
      if (t.type === 'service_worker' || t.url.includes('dropflow') || t.url.includes('hikiofee')) {
        console.log(`  ${t.type}: ${t.url.substring(0, 100)} (attached=${t.attached})`);
      }
    }
    
    // Check for extension pages
    const extTargets = targets.targetInfos.filter(t => t.url.includes('hikiofee'));
    console.log(`\nExtension targets: ${extTargets.length}`);
    for (const t of extTargets) {
      console.log(`  ${t.type}: ${t.url.substring(0, 120)}`);
    }
    
    await client.close();
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
