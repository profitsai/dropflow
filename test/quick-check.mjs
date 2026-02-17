import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
const page = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));
const count = await page.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  return data.PHOTOS?.photosInput?.photos?.length || 0;
});
console.log('Current photo count:', count);
browser.disconnect();
