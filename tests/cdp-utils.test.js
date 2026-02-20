import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';

const {
  isTransientCdpError,
  connectWithRetry,
  CdpReconnectManager,
  discoverBrowserWSEndpoint,
} = require('../lib/cdp');

describe('lib/cdp', () => {
  it('classifies common transient socket errors', () => {
    expect(isTransientCdpError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isTransientCdpError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isTransientCdpError(new Error('WebSocket was closed before the connection was established'))).toBe(true);
    expect(isTransientCdpError(new Error('some other error'))).toBe(false);
  });

  it('connectWithRetry retries transient failures', async () => {
    const connect = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }))
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
      .mockResolvedValueOnce({ ok: true });

    const b = await connectWithRetry({
      wsEndpoint: 'ws://127.0.0.1:1234/devtools/browser/x',
      connect,
      retries: 5,
      timeoutMs: 1000,
      baseDelayMs: 1,
    });

    expect(b).toEqual({ ok: true });
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('CdpReconnectManager retries operation once after transient error', async () => {
    const fakeBrowser = {
      on: vi.fn(),
      disconnect: vi.fn(),
    };
    const connect = vi.fn().mockResolvedValue(fakeBrowser);
    const mgr = new CdpReconnectManager({ connect, maxReconnects: 2 });

    const op = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Target closed'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce('ok');

    const res = await mgr.withBrowser(async (b) => {
      expect(b).toBe(fakeBrowser);
      return op();
    });

    expect(res).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(2); // second connect after forced disconnect
  });

  it('discoverBrowserWSEndpoint reads /json/version and returns webSocketDebuggerUrl', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/json/version') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc' }));
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = addr.port;

    try {
      const ws = await discoverBrowserWSEndpoint({ host: '127.0.0.1', port, timeoutMs: 2000, pollMs: 10 });
      expect(ws).toMatch(/^ws:\/\//);
      expect(ws).toContain('/devtools/browser/abc');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('connectWithRetry can use getWsEndpoint to recover from stale wsEndpoint', async () => {
    const getWsEndpoint = vi.fn()
      .mockResolvedValueOnce('ws://127.0.0.1:1234/devtools/browser/stale')
      .mockResolvedValueOnce('ws://127.0.0.1:1234/devtools/browser/fresh');

    const connect = vi.fn(async (ws) => {
      if (ws.includes('stale')) {
        const e = new Error('Unexpected server response: 404');
        e.code = 'HTTP_404';
        throw e;
      }
      return { ok: true, ws };
    });

    const b = await connectWithRetry({
      getWsEndpoint,
      connect,
      retries: 3,
      timeoutMs: 1000,
      baseDelayMs: 1,
    });

    expect(b.ok).toBe(true);
    expect(b.ws).toContain('fresh');
    expect(connect).toHaveBeenCalledTimes(2);
    expect(getWsEndpoint).toHaveBeenCalledTimes(2);
  });
});
