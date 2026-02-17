import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));

// Get eBay headers from service worker
const headers = await extPage.evaluate(async () => {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_EBAY_HEADERS' });
    return resp;
  } catch(e) { return { error: e.message }; }
});
console.log('eBay headers:', JSON.stringify(headers, null, 2));

// Now test on the eBay page directly 
const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// First, let's intercept eBay's own requests to learn the draft API format
// Enable request interception to observe what eBay sends
const cdpSession = await ebayPage.createCDPSession();
await cdpSession.send('Network.enable');

// Make a GET to see what the current draft looks like
const draftResult = await ebayPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  if (!draftId) return { error: 'no draftId' };
  
  try {
    const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, {
      credentials: 'include'
    });
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    const data = await resp.json();
    // Find the pictures/images section
    return {
      keys: Object.keys(data),
      pictures: data.pictures,
      images: data.images,
      pictureURL: data.pictureURL,
      pictureDetails: data.pictureDetails,
      photoUrl: data.photoUrl,
      // Also check nested
      draftPictures: data.draft?.pictures,
      listingPictures: data.listing?.pictures,
      // Return a trimmed version
      fullDataKeys: JSON.stringify(data).substring(0, 500)
    };
  } catch(e) { return { error: e.message }; }
});

console.log('\nDraft data:', JSON.stringify(draftResult, null, 2));

browser.disconnect();
