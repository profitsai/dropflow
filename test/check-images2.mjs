import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

// Find extension background/service worker target
const targets = browser.targets();
for (const t of targets) {
  console.log(t.type(), t.url()?.substring(0, 100));
}

// Get the service worker
const swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('hikiofeedjngalncoapgpmljpaoeolci'));
if (swTarget) {
  const sw = await swTarget.worker();
  
  // Check storage
  const data = await sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all);
    const productKeys = keys.filter(k => k.includes('roduct') || k.includes('ali'));
    const result = {};
    for (const k of productKeys) {
      const val = all[k];
      if (val && typeof val === 'object' && val.images) {
        result[k] = {
          title: val.title?.substring(0, 50),
          imageCount: val.images?.length,
          firstImage: val.images?.[0]?.substring(0, 100),
          hasPreDownloaded: Array.isArray(val.preDownloadedImages),
          preDownloadedCount: val.preDownloadedImages?.filter(Boolean)?.length || 0,
        };
      }
    }
    return { totalKeys: keys.length, productKeys, result };
  });
  console.log('\nStorage:', JSON.stringify(data, null, 2));

  // Try FETCH_IMAGE
  if (Object.keys(data.result).length > 0) {
    const first = Object.values(data.result)[0];
    if (first?.firstImage) {
      console.log('\nTesting FETCH_IMAGE:', first.firstImage);
      const fetchResult = await sw.evaluate(async (url) => {
        const result = await handleFetchImage({ url });
        return { success: result.success, error: result.error, size: result.dataUrl?.length };
      }, first.firstImage);
      console.log('Result:', JSON.stringify(fetchResult));
    }
  }
}

browser.disconnect();
