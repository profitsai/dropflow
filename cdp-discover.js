const WebSocket = require('ws');
const WS = 'ws://127.0.0.1:53104/devtools/browser/c8e788fe-ca0c-49f0-bd0c-bfc1b685dd9c';

let id = 1;
const cbs = {};
const ws = new WebSocket(WS);

ws.on('open', async () => {
  console.log('Connected');
  
  // Try setDiscoverTargets to discover extension targets
  send('Target.setDiscoverTargets', { discover: true });
  
  // Wait for target events
  setTimeout(async () => {
    // Also try getting browser contexts
    const r1 = await call('Target.getBrowserContexts');
    console.log('Browser contexts:', JSON.stringify(r1));
    
    // Try listing targets with filter
    const r2 = await call('Target.getTargets', { filter: [{}] });
    console.log(`\nAll targets (${r2.targetInfos.length}):`);
    for (const t of r2.targetInfos) {
      console.log(`  [${t.type}] ${t.url.substring(0, 120)}`);
    }
    
    // Check if there's a background page instead of service worker
    const bgTarget = r2.targetInfos.find(t => 
      t.url.includes('hikiofeedjngalncoapgpmljpaoeolci')
    );
    console.log('\nDropFlow target:', bgTarget || 'NOT FOUND');
    
    ws.close();
  }, 2000);
});

const discovered = [];
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.id && cbs[msg.id]) { cbs[msg.id](msg.result || msg.error); delete cbs[msg.id]; }
  if (msg.method === 'Target.targetCreated') {
    discovered.push(msg.params.targetInfo);
    console.log('Discovered:', msg.params.targetInfo.type, msg.params.targetInfo.url.substring(0, 100));
  }
});

function send(method, params = {}) {
  ws.send(JSON.stringify({ id: id++, method, params }));
}

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const myId = id++;
    cbs[myId] = resolve;
    ws.send(JSON.stringify({ id: myId, method, params }));
    setTimeout(() => { if (cbs[myId]) { delete cbs[myId]; reject(new Error('timeout')); }}, 10000);
  });
}
