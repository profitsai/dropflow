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
    const timeout = setTimeout(() => reject(new Error('timeout')), 10000);
    const handler = (data) => {
      const resp = JSON.parse(data.toString());
      if (resp.id === id) {
        ws.removeListener('message', handler);
        clearTimeout(timeout);
        if (resp.error) reject(new Error(JSON.stringify(resp.error)));
        else resolve(resp.result);
      }
    };
    ws.on('message', handler);
  });
}

(async () => {
  const ws = new WebSocket(CDP_URL);
  await new Promise(r => ws.on('open', r));
  
  const { targetInfos } = await sendCDP(ws, 'Target.getTargets');
  const swTarget = targetInfos.find(t => t.url.includes(EXT_ID) && t.type === 'service_worker');
  if (!swTarget) { console.log('SW NOT FOUND'); ws.close(); return; }
  
  const { sessionId } = await sendCDP(ws, 'Target.attachToTarget', { targetId: swTarget.targetId, flatten: true });
  await sendCDP(ws, 'Runtime.enable', {}, sessionId);
  
  // Log ALL events from the SW session for debugging
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.sessionId === sessionId && msg.method) {
      console.log('EVENT:', msg.method, JSON.stringify(msg.params).substring(0, 300));
    }
  });
  
  // Test
  const evalResult = await sendCDP(ws, 'Runtime.evaluate', { expression: 'console.log("HELLO FROM SW"); 42;' }, sessionId);
  console.log('eval result:', JSON.stringify(evalResult));
  
  await new Promise(r => setTimeout(r, 2000));
  console.log('Done waiting');
  ws.close();
})();
