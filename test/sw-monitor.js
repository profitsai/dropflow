// Attaches to the DropFlow service worker via CDP and captures its console output
const WebSocket = require('ws');

const CDP_URL = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

async function sendCDP(ws, method, params = {}, sessionId = undefined) {
  const id = Math.floor(Math.random() * 100000);
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      const resp = JSON.parse(data.toString());
      if (resp.id === id) {
        ws.removeListener('message', handler);
        if (resp.error) reject(new Error(resp.error.message));
        else resolve(resp.result);
      }
    };
    ws.on('message', handler);
    setTimeout(() => { ws.removeListener('message', handler); reject(new Error('timeout')); }, 10000);
  });
}

(async () => {
  const ws = new WebSocket(CDP_URL);
  await new Promise(r => ws.on('open', r));
  
  // Find SW target
  const { targetInfos } = await sendCDP(ws, 'Target.getTargets');
  const swTarget = targetInfos.find(t => t.url.includes(EXT_ID));
  
  if (!swTarget) {
    console.log('SW not found. Waking it up...');
    // We need to wake it by sending a message from an extension page
    // For now just report
    console.log('Available targets:');
    targetInfos.filter(t => t.type === 'service_worker' || t.url.includes('chrome-extension')).forEach(t => 
      console.log(`  ${t.type}: ${t.url.substring(0, 80)}`));
    ws.close();
    return;
  }
  
  console.log('Found SW:', swTarget.targetId, swTarget.url.substring(0, 80));
  
  // Attach to SW with flatten mode
  const { sessionId } = await sendCDP(ws, 'Target.attachToTarget', { 
    targetId: swTarget.targetId, flatten: true 
  });
  console.log('Attached, sessionId:', sessionId);
  
  // Enable Runtime domain on SW session to get console API calls
  await sendCDP(ws, 'Runtime.enable', {}, sessionId);
  console.log('Runtime.enable done');
  
  // Listen for console API calls
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.sessionId === sessionId) {
      if (msg.method === 'Runtime.consoleAPICalled') {
        const { type, args } = msg.params;
        const text = args.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
        console.log(`[SW ${type}] ${text}`);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const ex = msg.params.exceptionDetails;
        console.log(`[SW EXCEPTION] ${ex.text}: ${ex.exception?.description || ''}`);
      } else if (msg.method === 'Inspector.targetCrashed') {
        console.log('[SW CRASHED!!!]');
      }
    }
  });
  
  // Also enable Inspector to detect crashes
  try { await sendCDP(ws, 'Inspector.enable', {}, sessionId); } catch(e) {}
  
  console.log('\n=== Monitoring SW console (Ctrl+C to stop) ===\n');
  
  // Keep running
  await new Promise(() => {});
})();
