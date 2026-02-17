import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Reload the page to see if photos were added
await ebayPage.reload({ waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 3000));

// Check the draft data again
const photosData = await ebayPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
  const data = await resp.json();
  
  // Check if photos were added
  const photos = data.PHOTOS;
  const hasImages = photos?.images || photos?.pictureUrl || photos?.pictures;
  
  // Also check page DOM for any photo thumbnails
  const thumbnails = document.querySelectorAll('[class*="uploader-thumbnail"] img, [class*="photo-thumbnail"] img');
  
  return { 
    photosKeys: Object.keys(photos || {}),
    hasImages,
    photosType: photos?._type,
    thumbnailCount: thumbnails.length,
    fullPhotos: JSON.stringify(photos).substring(0, 500)
  };
});

console.log(JSON.stringify(photosData, null, 2));

browser.disconnect();
