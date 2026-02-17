// DropFlow Keep-Alive Offscreen Document
// This page exists solely to keep the service worker alive during long-running operations.
// It's created by the SW and destroyed when no longer needed.

// Aggressive ping every 10s (MV3 SW dies after ~30s inactivity; 20s was too close to the limit)
setInterval(() => {
  chrome.runtime.sendMessage({ type: 'KEEPALIVE_PING' }).catch(() => {});
}, 10000);

// Also maintain a persistent port connection (more reliable than message-based keepalive)
function connectPort() {
  try {
    const port = chrome.runtime.connect({ name: 'dropflow-keepalive' });
    port.onDisconnect.addListener(() => {
      // SW died — reconnect after a short delay (this also wakes the SW)
      setTimeout(connectPort, 1000);
    });
    // Ping on the port too
    setInterval(() => {
      try { port.postMessage({ type: 'ping' }); } catch(e) { /* port closed */ }
    }, 15000);
  } catch(e) {
    setTimeout(connectPort, 2000);
  }
}
connectPort();
