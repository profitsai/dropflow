import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const targets = browser.targets();
for (const t of targets) {
  console.log(`${t.type()} | ${t.url()}`);
}

// Use the extension page to access chrome.storage
const extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));
if (extPage) {
  console.log('\nUsing extension page:', extPage.url().substring(0, 80));
  
  const data = await extPage.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all);
    const result = {};
    for (const k of keys) {
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
    return { totalKeys: keys.length, productKeyCount: Object.keys(result).length, result };
  });
  console.log('\nStorage:', JSON.stringify(data, null, 2));

  // Test FETCH_IMAGE via sendMessage
  if (Object.keys(data.result).length > 0) {
    const first = Object.values(data.result)[0];
    if (first?.firstImage) {
      console.log('\nTesting FETCH_IMAGE for:', first.firstImage);
      const r = await extPage.evaluate(async (url) => {
        try {
          const resp = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url });
          return { success: resp?.success, error: resp?.error, dataSize: resp?.dataUrl?.length };
        } catch(e) { return { error: e.message }; }
      }, first.firstImage);
      console.log('FETCH_IMAGE result:', JSON.stringify(r));
    }
  }
}

browser.disconnect();
