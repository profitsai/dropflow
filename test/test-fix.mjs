import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

// First reload the extension to pick up code changes
const extPage = (await browser.pages()).find(p => p.url().includes('chrome://extensions'));
if (extPage) {
  // Click the reload button for our extension
  await extPage.evaluate(() => {
    // The extensions page has a reload button
    const devToggle = document.querySelector('extensions-manager')?.shadowRoot
      ?.querySelector('extensions-item-list')?.shadowRoot
      ?.querySelectorAll('extensions-item');
    // Can't easily access shadow DOM, let's use chrome.management API instead
  });
}

// Reload extension via chrome.management
const anyExtPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));
if (anyExtPage) {
  await anyExtPage.evaluate(async () => {
    await chrome.runtime.reload();
  });
}

await new Promise(r => setTimeout(r, 3000));

// Now navigate to a fresh listing
const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));
if (ebayPage) {
  await ebayPage.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  
  // Count photos before
  const before = await ebayPage.evaluate(async () => {
    const draftId = new URLSearchParams(window.location.search).get('draftId');
    const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
    const data = await resp.json();
    return data.PHOTOS?.photosInput?.photos?.length || 0;
  });
  console.log('Photos before:', before);
  
  // Now trigger the form fill with the pending listing data
  const storageData = await anyExtPage?.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith('pendingListing_'));
    const listing = keys.map(k => ({ key: k, title: all[k]?.title?.substring(0, 40), imageCount: all[k]?.images?.length, preDownCount: all[k]?.preDownloadedImages?.filter(Boolean)?.length }));
    return listing;
  }) || [];
  console.log('Pending listings:', JSON.stringify(storageData, null, 2));
}

browser.disconnect();
