const net = require('net');
const http = require('http');
const https = require('https');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms, ratio = 0.2) {
  const delta = ms * ratio;
  return Math.max(0, Math.round(ms + (Math.random() * 2 - 1) * delta));
}

function isTransientCdpError(err) {
  const msg = String(err && (err.message || err));
  const code = err && err.code;
  // Common network/socket failures during CDP startup or under load.
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN'
  ) return true;

  return (
    msg.includes('ECONNREFUSED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('socket hang up') ||
    msg.includes('EPIPE') ||
    msg.includes('WebSocket is not open') ||
    msg.includes('WebSocket was closed') ||
    msg.includes('Target closed') ||
    msg.includes('Protocol error') && msg.includes('Target closed')
  );
}

function validatePort(port, label = 'port') {
  const n = Number(port);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid ${label}: ${port}`);
  }
  return n;
}

async function waitForPortOpen({ host = '127.0.0.1', port, timeoutMs = 30_000, pollMs = 250, log } = {}) {
  port = validatePort(port, 'CDP port');
  const started = Date.now();
  let lastErr;

  while (Date.now() - started < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await new Promise((resolve) => {
      const socket = new net.Socket();
      const done = (v) => {
        try { socket.destroy(); } catch (_) {}
        resolve(v);
      };

      socket.setTimeout(Math.min(1000, pollMs));
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', (e) => { lastErr = e; done(false); });
      socket.connect(port, host);
    });

    if (ok) return;
    // eslint-disable-next-line no-await-in-loop
    await sleep(pollMs);
  }

  const err = new Error(`CDP not ready on ${host}:${port} after ${timeoutMs}ms`);
  err.cause = lastErr;
  throw err;
}

function httpRequestJson(url, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = typeof url === 'string' ? new URL(url) : url;
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname || ''}${u.search || ''}`,
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            const e = new Error(`HTTP ${res.statusCode} for ${u.toString()}`);
            e.code = `HTTP_${res.statusCode}`;
            e.statusCode = res.statusCode;
            e.body = data;
            reject(e);
            return;
          }
          try {
            resolve(JSON.parse(data || '{}'));
          } catch (e) {
            e.message = `Failed to parse JSON from ${u.toString()}: ${e.message}`;
            reject(e);
          }
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      const e = new Error(`timeout after ${timeoutMs}ms`);
      e.code = 'ETIMEDOUT';
      req.destroy(e);
    });
    req.end();
  });
}

/**
 * Discover the *current* Browser CDP websocket endpoint from a CDP host:port.
 * Useful because Multilogin/Chromium can restart and change the /devtools/browser/<id> part.
 */
async function discoverBrowserWSEndpoint({ host = '127.0.0.1', port, timeoutMs = 30_000, pollMs = 250, log } = {}) {
  port = validatePort(port, 'CDP port');
  await waitForPortOpen({ host, port, timeoutMs, pollMs, log });

  const started = Date.now();
  let lastErr;
  while (Date.now() - started < timeoutMs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const version = await httpRequestJson(`http://${host}:${port}/json/version`, { timeoutMs: Math.min(5000, timeoutMs) });
      const ws = version.webSocketDebuggerUrl || version.browserWSEndpoint;
      if (ws && typeof ws === 'string' && ws.startsWith('ws')) return ws;
      const e = new Error('Missing webSocketDebuggerUrl in /json/version');
      e.version = version;
      throw e;
    } catch (e) {
      lastErr = e;
      if (!isTransientCdpError(e) && !(String(e.code || '').startsWith('HTTP_'))) throw e;
      // eslint-disable-next-line no-await-in-loop
      await sleep(pollMs);
    }
  }

  const err = new Error(`CDP /json/version not ready on ${host}:${port} after ${timeoutMs}ms`);
  err.cause = lastErr;
  throw err;
}

/**
 * Connect to a CDP websocket endpoint with retries + exponential backoff.
 *
 * @param {object} opts
 * @param {string} [opts.wsEndpoint] - Puppeteer browserWSEndpoint
 * @param {function} [opts.getWsEndpoint] - async () => wsEndpoint (allows dynamic discovery)
 * @param {function} opts.connect - async function (wsEndpoint) => Browser
 * @param {function} [opts.log] - optional logger
 * @param {number} [opts.retries=5]
 * @param {number} [opts.timeoutMs=30_000] - per-attempt timeout
 * @param {number} [opts.baseDelayMs=250]
 */
async function connectWithRetry({ wsEndpoint, getWsEndpoint, connect, log, retries = 5, timeoutMs = 30_000, baseDelayMs = 250 } = {}) {
  if (!wsEndpoint && typeof getWsEndpoint !== 'function') throw new Error('connectWithRetry: wsEndpoint or getWsEndpoint is required');
  if (typeof connect !== 'function') throw new Error('connectWithRetry: connect fn is required');

  let attempt = 0;
  let lastErr;
  let lastWs = wsEndpoint;

  while (attempt <= retries) {
    const startedAt = Date.now();
    try {
      // eslint-disable-next-line no-await-in-loop
      const ws = typeof getWsEndpoint === 'function' ? await getWsEndpoint() : wsEndpoint;
      lastWs = ws;
      log?.(`[cdp] connect attempt ${attempt + 1}/${retries + 1} ws=${ws}`);
      // eslint-disable-next-line no-await-in-loop
      const browser = await promiseTimeout(connect(ws), timeoutMs);
      log?.(`[cdp] connect ok in ${Date.now() - startedAt}ms`);
      return browser;
    } catch (e) {
      lastErr = e;
      const transient = isTransientCdpError(e) || String(e?.message || '').includes('Unexpected server response');
      log?.(`[cdp] connect fail in ${Date.now() - startedAt}ms transient=${transient} code=${e?.code || ''} msg=${String(e?.message || e).slice(0, 200)}`);
      if (!transient || attempt === retries) break;

      const delay = jitter(baseDelayMs * Math.pow(2, attempt), 0.25);
      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);
      attempt++;
    }
  }

  const err = new Error(`CDP connect failed after ${attempt + 1} attempt(s): ${lastWs || wsEndpoint || '<dynamic>'}`);
  err.cause = lastErr;
  throw err;
}

function promiseTimeout(p, ms) {
  if (!ms || ms <= 0) return p;
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => {
      const e = new Error(`timeout after ${ms}ms`);
      e.code = 'ETIMEDOUT';
      reject(e);
    }, ms);
  });
  return Promise.race([p.finally(() => clearTimeout(t)), timeout]);
}

/**
 * Minimal reconnect wrapper for long-running CDP jobs.
 *
 * Usage:
 *   const mgr = new CdpReconnectManager({ connect: () => puppeteer.connect(...) })
 *   const browser = await mgr.getBrowser();
 *   ...
 *   await mgr.withBrowser(async (b) => { ... }) // retries on disconnect
 */
class CdpReconnectManager {
  constructor({ connect, maxReconnects = 5 } = {}) {
    if (typeof connect !== 'function') throw new Error('CdpReconnectManager: connect fn is required');
    this._connect = connect;
    this._maxReconnects = maxReconnects;
    this._browser = null;
    this._connecting = null;
    this._reconnects = 0;
  }

  async getBrowser() {
    if (this._browser) return this._browser;
    if (this._connecting) return this._connecting;

    this._connecting = (async () => {
      const b = await this._connect();
      b.on?.('disconnected', () => {
        this._browser = null;
      });
      this._browser = b;
      this._connecting = null;
      return b;
    })().catch((e) => {
      this._connecting = null;
      throw e;
    });

    return this._connecting;
  }

  async withBrowser(fn) {
    let lastErr;
    for (let i = 0; i <= this._maxReconnects; i++) {
      try {
        const b = await this.getBrowser();
        // eslint-disable-next-line no-await-in-loop
        return await fn(b);
      } catch (e) {
        lastErr = e;
        if (!isTransientCdpError(e)) throw e;

        // Force reconnect next iteration
        try { this._browser?.disconnect?.(); } catch (_) {}
        this._browser = null;
        this._connecting = null;
        this._reconnects++;
        // eslint-disable-next-line no-await-in-loop
        await sleep(jitter(250 * Math.pow(2, i), 0.25));
      }
    }
    const err = new Error(`CDP operation failed after reconnects=${this._reconnects}`);
    err.cause = lastErr;
    throw err;
  }
}

function cdpEnvHelpText() {
  return [
    'CDP configuration:',
    '  - CDP_HOST (default: 127.0.0.1)',
    '  - CDP_PORT (required unless CDP_URL is set)',
    '  - CDP_URL  (optional override, e.g. http://127.0.0.1:9222)',
    '',
    'Examples:',
    '  CDP_PORT=9222 node live-e2e-test.js',
    '  CDP_URL=http://127.0.0.1:9222 node test/run-10x-batch.js',
  ].join('\n');
}

function getCdpTargetFromEnv({ hostDefault = '127.0.0.1' } = {}) {
  const envUrl = process.env.CDP_URL;
  if (envUrl) {
    const u = new URL(envUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error(`CDP_URL must be http(s)://host:port (got ${envUrl})`);
    }
    const port = validatePort(u.port, 'CDP_URL port');
    const host = u.hostname || hostDefault;
    return { host, port, baseUrl: `${u.protocol}//${host}:${port}` };
  }

  const host = process.env.CDP_HOST || hostDefault;
  const portRaw = process.env.CDP_PORT;
  if (!portRaw) {
    const e = new Error('Missing CDP_PORT (or set CDP_URL instead)');
    e.help = cdpEnvHelpText();
    throw e;
  }
  const port = validatePort(portRaw, 'CDP port');
  return { host, port, baseUrl: `http://${host}:${port}` };
}

module.exports = {
  sleep,
  isTransientCdpError,
  validatePort,
  waitForPortOpen,
  discoverBrowserWSEndpoint,
  connectWithRetry,
  CdpReconnectManager,
  getCdpTargetFromEnv,
  cdpEnvHelpText,
};
