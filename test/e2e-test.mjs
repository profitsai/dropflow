import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

// Get the extension page
let extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));
if (!extPage) {
  extPage = await browser.newPage();
  await extPage.goto('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci/pages/ali-bulk-lister/ali-bulk-lister.html');
  await new Promise(r => setTimeout(r, 2000));
}

// Check what product data is available
const productInfo = await extPage.evaluate(async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith('pendingListing_'));
  return keys.map(k => ({
    key: k,
    title: all[k]?.title?.substring(0, 50),
    imageCount: all[k]?.images?.length || 0,
    preDownCount: all[k]?.preDownloadedImages?.filter(Boolean)?.length || 0,
    hasVariations: !!all[k]?.variations?.hasVariations
  }));
});

console.log('Available products:', JSON.stringify(productInfo, null, 2));

// Use the one with 12 images and 8 pre-downloaded
const product = productInfo.find(p => p.imageCount > 0);
if (product) {
  console.log(`\nUsing: ${product.title} (${product.imageCount} images, ${product.preDownCount} pre-downloaded)`);
  
  // Get the actual product data
  const productData = await extPage.evaluate(async (key) => {
    const all = await chrome.storage.local.get(key);
    const data = all[key];
    return {
      images: data.images?.slice(0, 3),
      preDownloadedImages: data.preDownloadedImages?.slice(0, 3).map(d => d ? d.length : null)
    };
  }, product.key);
  
  console.log('Image URLs:', productData.images?.map(u => u?.substring(0, 80)));
  console.log('Pre-downloaded sizes:', productData.preDownloadedImages?.map(s => s ? Math.round(s/1024) + 'KB' : null));
}

browser.disconnect();
