import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Now PUT the EPS-uploaded image URL to the draft
const epsUrl = 'https://i.ebayimg.com/00/s/NjQwWDY0MA==/z/AIUAAeSwm2Zpk8p9/$_1.JPG?set_id=880000500F';

// Try various draft PUT formats with eBay-hosted URLs
const result = await ebayPage.evaluate(async (imgUrl) => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  
  const payloads = [
    // Format matching eBay's PHOTOS structure
    { PHOTOS: { pictureUrl: [imgUrl] } },
    { pictures: { pictureUrl: [imgUrl] } },
    // Try the eBay API format
    { pictures: [imgUrl] },
    { PHOTOS: { images: [imgUrl] } },
  ];
  
  const results = {};
  for (let i = 0; i < payloads.length; i++) {
    try {
      const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payloads[i])
      });
      const text = await resp.text();
      results[`format${i+1}`] = { status: resp.status, body: text.substring(0, 300) };
    } catch(e) {
      results[`format${i+1}`] = { error: e.message };
    }
  }
  return results;
}, epsUrl);

console.log('PUT results:', JSON.stringify(result, null, 2));

// After PUT, reload and check if photos appear
await ebayPage.reload({ waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 3000));

const photoCheck = await ebayPage.evaluate(() => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  // Check for any visible photo thumbnails
  const imgs = document.querySelectorAll('img');
  const ebayImgs = Array.from(imgs).filter(i => i.src.includes('ebayimg.com'));
  
  // Check the photo section
  const photoSection = document.querySelector('.summary__photos');
  const photoSectionHtml = photoSection?.innerHTML?.substring(0, 500);
  
  return {
    ebayImgCount: ebayImgs.length,
    ebayImgSrcs: ebayImgs.map(i => i.src.substring(0, 80)),
    photoSectionHtml
  };
});

console.log('\nAfter reload:', JSON.stringify(photoCheck, null, 2));

browser.disconnect();
