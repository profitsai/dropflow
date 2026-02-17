import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Check the VARIATIONS section in the draft data for photo fields
const varData = await ebayPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  
  const variations = data.VARIATIONS;
  if (!variations) return { error: 'no variations section' };
  
  return {
    type: variations._type,
    keys: Object.keys(variations).slice(0, 30),
    // Look for photo-related fields
    photosInput: variations.photosInput,
    photos: variations.photos,
    pictureUrl: variations.pictureUrl,
    variationPhotos: JSON.stringify(variations).match(/"photo|"picture|"image/gi)?.slice(0, 10),
    // Get a preview of the full structure
    preview: JSON.stringify(variations).substring(0, 1000)
  };
});

console.log(JSON.stringify(varData, null, 2));

browser.disconnect();
