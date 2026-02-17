const WebSocket = require('ws');
const CDP_URL = 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d';
const EXT_ID = 'cenanjfpigoolnfedgefalledflcodaj';

let idCounter = 1;
function sendCDP(ws, method, params = {}, sessionId = undefined) {
  const id = idCounter++;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      const resp = JSON.parse(data.toString());
      if (resp.id === id) {
        ws.removeListener('message', handler);
        if (resp.error) reject(new Error(JSON.stringify(resp.error)));
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
  
  const { targetInfos } = await sendCDP(ws, 'Target.getTargets');
  const swTarget = targetInfos.find(t => t.url.includes(EXT_ID) && t.type === 'service_worker');
  
  if (!swTarget) { console.log('SW NOT FOUND'); ws.close(); return; }
  console.log('SW target:', swTarget.targetId);
  
  const { sessionId } = await sendCDP(ws, 'Target.attachToTarget', { targetId: swTarget.targetId, flatten: true });
  
  // Enable ALL relevant domains
  await sendCDP(ws, 'Runtime.enable', {}, sessionId);
  await sendCDP(ws, 'Log.enable', {}, sessionId).catch(() => {});
  
  // Set up listeners BEFORE testing
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.sessionId === sessionId && msg.method) {
      if (msg.method === 'Runtime.consoleAPICalled') {
        const { type, args, timestamp } = msg.params;
        const text = args.map(a => {
          if (a.type === 'string') return a.value;
          if (a.type === 'number') return String(a.value);
          return a.description || JSON.stringify(a.value) || `[${a.type}]`;
        }).join(' ');
        const ts = new Date(timestamp).toLocaleTimeString();
        console.log(`[${ts} ${type}] ${text}`);
      } else if (msg.method === 'Log.entryAdded') {
        const e = msg.params.entry;
        console.log(`[LOG ${e.level}] ${e.text}`);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const ex = msg.params.exceptionDetails;
        console.log(`[EXCEPTION] ${ex.text} ${ex.exception?.description || ''}`);
      } else if (msg.method === 'Inspector.targetCrashed') {
        console.log('[SW CRASHED!!!]');
      }
    }
  });
  
  // Test: evaluate console.log in SW
  console.log('Testing SW console capture...');
  await sendCDP(ws, 'Runtime.evaluate', { expression: 'console.log("[TEST] SW monitor is working!")' }, sessionId);
  
  await new Promise(r => setTimeout(r, 500));
  console.log('\n=== Monitoring SW (Ctrl+C to stop) ===\n');
  
  // Keep alive
  await new Promise(() => {});
})();
