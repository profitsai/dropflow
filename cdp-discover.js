const WebSocket = require('ws');
const { discoverBrowserWSEndpoint, getCdpTargetFromEnv, cdpEnvHelpText } = require('./lib/cdp');

// Usage:
//   CDP_PORT=9222 node cdp-discover.js
//   CDP_URL=http://127.0.0.1:9222 node cdp-discover.js

async function main() {
  let CDP;
  try {
    CDP = getCdpTargetFromEnv();
  } catch (e) {
    console.error(`[cdp-discover] ${e.message}`);
    if (e.help) console.error(e.help);
    else console.error(cdpEnvHelpText());
    process.exit(2);
  }

  const wsEndpoint = await discoverBrowserWSEndpoint({ host: CDP.host, port: CDP.port, timeoutMs: 30_000, pollMs: 250 });
  console.log(`[cdp-discover] using ${CDP.host}:${CDP.port}`);
  console.log(`[cdp-discover] ws=${wsEndpoint}`);

  let id = 1;
  const cbs = {};
  const ws = new WebSocket(wsEndpoint);

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
        console.log(`  [${t.type}] ${String(t.url || '').substring(0, 120)}`);
      }

      ws.close();
    }, 2000);
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && cbs[msg.id]) {
      cbs[msg.id](msg.result || msg.error);
      delete cbs[msg.id];
    }
    if (msg.method === 'Target.targetCreated') {
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
      setTimeout(() => {
        if (cbs[myId]) {
          delete cbs[myId];
          reject(new Error('timeout'));
        }
      }, 10000);
    });
  }
}

main().catch((e) => {
  console.error('Fatal:', e && (e.stack || e.message) || e);
  process.exit(1);
});
