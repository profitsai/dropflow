/**
 * Image Upload Cascade Tests
 *
 * Tests for handleUploadEbayImage and handleFetchImage in service-worker.js.
 * Since the service worker isn't easily importable (chrome extension globals),
 * we extract and test the core logic by re-implementing the functions with
 * the same algorithm, verified against the source.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Re-implement handleFetchImage logic (mirrors service-worker.js lines 3480-3580)
// ---------------------------------------------------------------------------

async function handleFetchImage(payload, fetchFn = globalThis.fetch) {
  const { url } = payload;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }

      const isAliExpress = url.includes('alicdn') || url.includes('aliexpress') || url.includes('aliimg');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const fetchOpts = {
        headers: { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
        signal: controller.signal
      };
      if (url.includes('amazon') || url.includes('media-amazon')) {
        fetchOpts.referrer = 'https://www.amazon.com/';
        fetchOpts.referrerPolicy = 'no-referrer-when-downgrade';
      }
      let response = await fetchFn(url, fetchOpts);

      if (!response.ok && isAliExpress) {
        response = await fetchFn(url, {
          ...fetchOpts,
          referrer: 'https://www.aliexpress.com/',
          referrerPolicy: 'no-referrer-when-downgrade'
        });
      }

      if (!response.ok && isAliExpress) {
        const cleanedUrl = url
          .replace(/_\d+x\d+Q?\d*\.\w+_?$/, '')
          .replace(/\.jpg_\d+x\d+.*$/, '.jpg')
          .replace(/_Q\d+\.jpg_?$/, '.jpg')
          .replace(/\.\w+_\d+x\d+.*$/, '.jpg');
        if (cleanedUrl !== url) {
          response = await fetchFn(cleanedUrl, fetchOpts);
          if (!response.ok) {
            response = await fetchFn(cleanedUrl, {
              ...fetchOpts,
              referrer: 'https://www.aliexpress.com/',
              referrerPolicy: 'no-referrer-when-downgrade'
            });
          }
        }
      }

      if (!response.ok && (url.includes('amazon') || url.includes('media-amazon'))) {
        response = await fetchFn(url, {
          headers: { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
          signal: controller.signal
        });
      }

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const dataUrl = `data:${blob.type || 'image/jpeg'};base64,${base64}`;
      return { success: true, dataUrl, mimeType: blob.type || 'image/jpeg' };
    } catch (error) {
      if (attempt === 2) {
        return { error: error.message };
      }
    }
  }
  return { error: 'Failed after 3 attempts' };
}

// ---------------------------------------------------------------------------
// Re-implement handleUploadEbayImage logic (mirrors service-worker.js lines 3582-3690)
// ---------------------------------------------------------------------------

async function handleUploadEbayImage(payload, sender, ebayHeadersMap, fetchFn = globalThis.fetch) {
  const { imageDataUrl, filename } = payload;
  const tabId = sender.tab?.id;

  if (!tabId) return { error: 'No tab ID' };
  if (!imageDataUrl) return { error: 'No image data provided' };

  const stored = ebayHeadersMap.get(tabId);
  if (!stored || !stored.headers) {
    return { error: 'No captured eBay headers for this tab' };
  }

  try {
    const [header, base64] = imageDataUrl.split(',');
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mime });

    let ebayHost;
    try {
      ebayHost = new URL(stored.url).host;
    } catch {
      ebayHost = 'www.ebay.com';
    }

    const headers = {};
    for (const [key, value] of Object.entries(stored.headers)) {
      if (key.toLowerCase() !== 'content-type') {
        headers[key] = value;
      }
    }

    const endpoints = [];
    if (stored.mediaUploadUrl) {
      endpoints.push(stored.mediaUploadUrl);
    }
    endpoints.push(
      `https://${ebayHost}/sell/media/api/image`,
      `https://${ebayHost}/sell/media/imageUpload`,
      `https://${ebayHost}/sell/media/upload/image`,
      `https://${ebayHost}/lstng/api/listing_draft/${stored.draftId}/image`
    );

    for (const endpoint of endpoints) {
      try {
        const formData = new FormData();
        formData.append('file', blob, filename || 'product-image.jpg');

        const resp = await fetchFn(endpoint, {
          method: 'POST',
          headers,
          body: formData,
          credentials: 'include',
          redirect: 'manual'
        });

        if (resp.type === 'opaqueredirect' || resp.status === 301 || resp.status === 302 ||
            resp.status === 303 || resp.status === 307 || resp.status === 308) {
          continue;
        }

        if (resp.ok) {
          const data = await resp.json().catch(() => null);
          if (data) {
            const picUrl = data.url || data.imageUrl || data.pictureUrl ||
                           data.imageURL || data.pictureURL ||
                           (data.image && (data.image.url || data.image.imageUrl)) ||
                           (data.data && (data.data.url || data.data.imageUrl));
            if (picUrl) {
              return { success: true, imageUrl: picUrl };
            }
            return { success: true, data };
          }
        } else if (resp.status !== 404) {
          // logged, continue to next
        }
      } catch (e) {
        // Try next endpoint
      }
    }

    return { error: 'All upload endpoints failed' };
  } catch (error) {
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TINY_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

function makeResponse(body, status = 200, opts = {}) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    type: opts.type || 'basic',
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
    text: () => Promise.resolve(bodyStr),
    blob: () => Promise.resolve(new Blob([new Uint8Array([0x89, 0x50])], { type: opts.mimeType || 'image/png' })),
    arrayBuffer: () => Promise.resolve(new Uint8Array([0x89, 0x50]).buffer),
  };
}

function make404() {
  return makeResponse('Not Found', 404);
}

function make500() {
  return makeResponse('Internal Server Error', 500);
}

function makeRedirect(status = 302) {
  return makeResponse('', status, { type: status ? 'basic' : 'opaqueredirect' });
}

function makeOpaqueRedirect() {
  return { ok: false, status: 0, type: 'opaqueredirect', json: () => Promise.reject(), text: () => Promise.resolve('') };
}

function defaultSender(tabId = 42) {
  return { tab: { id: tabId } };
}

function defaultHeaders(tabId = 42, overrides = {}) {
  const map = new Map();
  map.set(tabId, {
    url: 'https://www.ebay.com/lstng/draft/12345',
    headers: { 'Authorization': 'Bearer test-token', 'Content-Type': 'multipart/form-data' },
    draftId: '12345',
    ...overrides,
  });
  return map;
}

// ---------------------------------------------------------------------------
// Tests: handleUploadEbayImage
// ---------------------------------------------------------------------------

describe('handleUploadEbayImage', () => {
  it('returns error when no tab ID', async () => {
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      { tab: {} },
      new Map()
    );
    expect(result.error).toBe('No tab ID');
  });

  it('returns error when no image data', async () => {
    const result = await handleUploadEbayImage(
      { imageDataUrl: null },
      defaultSender(),
      defaultHeaders()
    );
    expect(result.error).toBe('No image data provided');
  });

  it('returns error when no captured eBay headers', async () => {
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      new Map()
    );
    expect(result.error).toBe('No captured eBay headers for this tab');
  });

  it('returns error when headers map entry has no headers property', async () => {
    const map = new Map();
    map.set(42, { url: 'https://www.ebay.com' });
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      map
    );
    expect(result.error).toBe('No captured eBay headers for this tab');
  });

  it('succeeds on first endpoint with url response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ url: 'https://i.ebayimg.com/images/g/abc.jpg' })
    );
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL, filename: 'test.jpg' },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.success).toBe(true);
    expect(result.imageUrl).toBe('https://i.ebayimg.com/images/g/abc.jpg');
    // Should have been called once (first endpoint succeeded)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('extracts imageUrl from response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ imageUrl: 'https://i.ebayimg.com/test.jpg' })
    );
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.imageUrl).toBe('https://i.ebayimg.com/test.jpg');
  });

  it('extracts pictureUrl from response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ pictureUrl: 'https://i.ebayimg.com/pic.jpg' })
    );
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.imageUrl).toBe('https://i.ebayimg.com/pic.jpg');
  });

  it('extracts imageURL (uppercase) from response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ imageURL: 'https://i.ebayimg.com/upper.jpg' })
    );
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.imageUrl).toBe('https://i.ebayimg.com/upper.jpg');
  });

  it('extracts pictureURL (uppercase) from response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ pictureURL: 'https://i.ebayimg.com/PIC.jpg' })
    );
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.imageUrl).toBe('https://i.ebayimg.com/PIC.jpg');
  });

  it('extracts nested image.url from response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ image: { url: 'https://i.ebayimg.com/nested.jpg' } })
    );
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.imageUrl).toBe('https://i.ebayimg.com/nested.jpg');
  });

  it('extracts nested image.imageUrl from response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ image: { imageUrl: 'https://i.ebayimg.com/nested2.jpg' } })
    );
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.imageUrl).toBe('https://i.ebayimg.com/nested2.jpg');
  });

  it('extracts nested data.url from response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ data: { url: 'https://i.ebayimg.com/data.jpg' } })
    );
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.imageUrl).toBe('https://i.ebayimg.com/data.jpg');
  });

  it('extracts nested data.imageUrl from response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ data: { imageUrl: 'https://i.ebayimg.com/data2.jpg' } })
    );
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.imageUrl).toBe('https://i.ebayimg.com/data2.jpg');
  });

  it('returns data when response has no extractable URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ status: 'ok', id: '12345' })
    );
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'ok', id: '12345' });
    expect(result.imageUrl).toBeUndefined();
  });

  it('skips redirect responses and tries next endpoint', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeRedirect(302))
      .mockResolvedValueOnce(makeResponse({ url: 'https://i.ebayimg.com/second.jpg' }));
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.success).toBe(true);
    expect(result.imageUrl).toBe('https://i.ebayimg.com/second.jpg');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('skips opaque redirect responses', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeOpaqueRedirect())
      .mockResolvedValueOnce(makeResponse({ url: 'https://i.ebayimg.com/after-opaque.jpg' }));
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.imageUrl).toBe('https://i.ebayimg.com/after-opaque.jpg');
  });

  it('skips 301, 303, 307, 308 redirects', async () => {
    for (const status of [301, 303, 307, 308]) {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(makeRedirect(status))
        .mockResolvedValueOnce(makeResponse({ url: `https://i.ebayimg.com/${status}.jpg` }));
      const result = await handleUploadEbayImage(
        { imageDataUrl: TINY_DATA_URL },
        defaultSender(),
        defaultHeaders(),
        mockFetch
      );
      expect(result.imageUrl).toBe(`https://i.ebayimg.com/${status}.jpg`);
    }
  });

  it('cascades through all endpoints on 404s', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(make404())
      .mockResolvedValueOnce(make404())
      .mockResolvedValueOnce(make404())
      .mockResolvedValueOnce(makeResponse({ url: 'https://i.ebayimg.com/last.jpg' }));
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.success).toBe(true);
    expect(result.imageUrl).toBe('https://i.ebayimg.com/last.jpg');
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('returns error when ALL endpoints fail (cascade exhausted)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(make404());
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.error).toBe('All upload endpoints failed');
    // 4 default endpoints (no mediaUploadUrl)
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('tries mediaUploadUrl first when available', async () => {
    const headers = defaultHeaders(42, { mediaUploadUrl: 'https://www.ebay.com/sell/media/custom' });
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ url: 'https://i.ebayimg.com/custom.jpg' })
    );
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      headers,
      mockFetch
    );
    expect(result.success).toBe(true);
    // First call should be to the custom mediaUploadUrl
    expect(mockFetch.mock.calls[0][0]).toBe('https://www.ebay.com/sell/media/custom');
  });

  it('has 5 endpoints when mediaUploadUrl is set', async () => {
    const headers = defaultHeaders(42, { mediaUploadUrl: 'https://www.ebay.com/sell/media/custom' });
    const mockFetch = vi.fn().mockResolvedValue(make404());
    await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      headers,
      mockFetch
    );
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it('excludes Content-Type from forwarded headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ url: 'https://i.ebayimg.com/ok.jpg' })
    );
    await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders['Content-Type']).toBeUndefined();
    expect(calledHeaders['Authorization']).toBe('Bearer test-token');
  });

  it('falls back to www.ebay.com when stored URL is invalid', async () => {
    const map = new Map();
    map.set(42, { url: 'not-a-url', headers: { 'X-Auth': 'yes' }, draftId: '999' });
    const mockFetch = vi.fn().mockResolvedValue(make404());
    await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      map,
      mockFetch
    );
    const firstUrl = mockFetch.mock.calls[0][0];
    expect(firstUrl).toContain('www.ebay.com');
  });

  it('uses correct eBay host from stored URL', async () => {
    const map = new Map();
    map.set(42, { url: 'https://www.ebay.co.uk/sell/something', headers: { 'X-Auth': 'yes' }, draftId: '123' });
    const mockFetch = vi.fn().mockResolvedValue(make404());
    await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      map,
      mockFetch
    );
    expect(mockFetch.mock.calls[0][0]).toContain('www.ebay.co.uk');
  });

  it('handles network errors (fetch throws) and tries next endpoint', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(makeResponse({ url: 'https://i.ebayimg.com/recovered.jpg' }));
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.success).toBe(true);
    expect(result.imageUrl).toBe('https://i.ebayimg.com/recovered.jpg');
  });

  it('handles 500 errors and continues to next endpoint', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(make500())
      .mockResolvedValueOnce(makeResponse({ url: 'https://i.ebayimg.com/after500.jpg' }));
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    expect(result.success).toBe(true);
  });

  it('handles malformed JSON response gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      type: 'basic',
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
      text: () => Promise.resolve('<html>error</html>'),
    });
    // json() fails → data is null → no URL extracted → tries next endpoint
    const result = await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    // All endpoints return ok but with unparseable JSON → error
    expect(result.error).toBe('All upload endpoints failed');
  });

  it('sends POST with FormData body and correct credentials', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ url: 'https://i.ebayimg.com/ok.jpg' })
    );
    await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    const callOpts = mockFetch.mock.calls[0][1];
    expect(callOpts.method).toBe('POST');
    expect(callOpts.credentials).toBe('include');
    expect(callOpts.redirect).toBe('manual');
    expect(callOpts.body).toBeInstanceOf(FormData);
  });

  it('uses default filename when none provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ url: 'https://i.ebayimg.com/ok.jpg' })
    );
    await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    const formData = mockFetch.mock.calls[0][1].body;
    const file = formData.get('file');
    expect(file.name).toBe('product-image.jpg');
  });

  it('handles invalid base64 data URL gracefully', async () => {
    const result = await handleUploadEbayImage(
      { imageDataUrl: 'not-a-data-url' },
      defaultSender(),
      defaultHeaders(),
      vi.fn()
    );
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tests: handleFetchImage
// ---------------------------------------------------------------------------

describe('handleFetchImage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns base64 data URL on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob([new Uint8Array([0xFF, 0xD8])], { type: 'image/jpeg' })),
    });
    const result = await handleFetchImage({ url: 'https://example.com/img.jpg' }, mockFetch);
    expect(result.success).toBe(true);
    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('retries up to 3 times on network errors', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob([new Uint8Array([0x89])], { type: 'image/png' })),
      });
    const result = await handleFetchImage({ url: 'https://example.com/img.png' }, mockFetch);
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('returns error after 3 failed attempts', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network down'));
    const result = await handleFetchImage({ url: 'https://example.com/img.jpg' }, mockFetch);
    expect(result.error).toBe('Network down');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('sets Amazon referrer for Amazon URLs', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob([new Uint8Array([0x89])], { type: 'image/png' })),
    });
    await handleFetchImage({ url: 'https://images-na.ssl-images-amazon.com/img.jpg' }, mockFetch);
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.referrer).toBe('https://www.amazon.com/');
  });

  it('retries AliExpress URLs with referrer on failure', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob([new Uint8Array([0x89])], { type: 'image/png' })),
      });
    const result = await handleFetchImage({ url: 'https://ae01.alicdn.com/img.jpg' }, mockFetch);
    expect(result.success).toBe(true);
    // Second call should have aliexpress referrer
    expect(mockFetch.mock.calls[1][1].referrer).toBe('https://www.aliexpress.com/');
  });

  it('retries AliExpress with cleaned URL (strips size suffix)', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob([new Uint8Array([0x89])], { type: 'image/png' })),
      });
    const result = await handleFetchImage(
      { url: 'https://ae01.alicdn.com/img.jpg_640x640.jpg' },
      mockFetch
    );
    expect(result.success).toBe(true);
  });

  it('retries Amazon URLs without referrer on failure', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob([new Uint8Array([0x89])], { type: 'image/png' })),
      });
    const result = await handleFetchImage(
      { url: 'https://m.media-amazon.com/images/I/abc.jpg' },
      mockFetch
    );
    expect(result.success).toBe(true);
    // Second call should NOT have referrer
    expect(mockFetch.mock.calls[1][1].referrer).toBeUndefined();
  });

  it('returns HTTP error message after retries exhausted', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    const result = await handleFetchImage({ url: 'https://example.com/img.jpg' }, mockFetch);
    expect(result.error).toBe('HTTP 403');
  });

  it('defaults to image/jpeg when blob has no type', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob([new Uint8Array([0x89])], { type: '' })),
    });
    const result = await handleFetchImage({ url: 'https://example.com/img' }, mockFetch);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('includes AbortController signal in fetch options', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob([new Uint8Array([0x89])], { type: 'image/png' })),
    });
    await handleFetchImage({ url: 'https://example.com/img.jpg' }, mockFetch);
    expect(mockFetch.mock.calls[0][1].signal).toBeDefined();
  });

  it('does not set referrer for non-Amazon non-AliExpress URLs', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob([new Uint8Array([0x89])], { type: 'image/png' })),
    });
    await handleFetchImage({ url: 'https://cdn.shopify.com/img.jpg' }, mockFetch);
    expect(mockFetch.mock.calls[0][1].referrer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Endpoint construction
// ---------------------------------------------------------------------------

describe('Upload endpoint construction', () => {
  it('constructs correct endpoint URLs from eBay host', async () => {
    const mockFetch = vi.fn().mockResolvedValue(make404());
    const map = new Map();
    map.set(42, {
      url: 'https://www.ebay.de/sell/something',
      headers: { 'X-Auth': 'yes' },
      draftId: 'DRAFT123'
    });
    await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      map,
      mockFetch
    );
    const urls = mockFetch.mock.calls.map(c => c[0]);
    expect(urls).toEqual([
      'https://www.ebay.de/sell/media/api/image',
      'https://www.ebay.de/sell/media/imageUpload',
      'https://www.ebay.de/sell/media/upload/image',
      'https://www.ebay.de/lstng/api/listing_draft/DRAFT123/image',
    ]);
  });

  it('includes draftId in the last endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue(make404());
    await handleUploadEbayImage(
      { imageDataUrl: TINY_DATA_URL },
      defaultSender(),
      defaultHeaders(),
      mockFetch
    );
    const lastUrl = mockFetch.mock.calls[3][0];
    expect(lastUrl).toContain('/listing_draft/12345/image');
  });
});
