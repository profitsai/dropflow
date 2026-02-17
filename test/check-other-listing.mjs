import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const otherPage = (await browser.pages()).find(p => p.url().includes('draftId=5053798596022'));
if (otherPage) {
  const info = await otherPage.evaluate(async () => {
    const draftId = new URLSearchParams(window.location.search).get('draftId');
    const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
    const data = await resp.json();
    
    const photos = data.PHOTOS;
    const photosInput = photos?.photosInput;
    
    // Check DOM
    const allSections = document.querySelectorAll('.smry');
    const sectionHeaders = [];
    for (const s of allSections) {
      const h2 = s.querySelector('h2');
      if (h2) sectionHeaders.push(h2.textContent.trim());
    }
    
    const fileInputs = document.querySelectorAll('input[type="file"]');
    
    return {
      photosType: photos?._type,
      photosInputKeys: photosInput ? Object.keys(photosInput) : [],
      photosData: photosInput?.photos ? photosInput.photos.length : 'none',
      firstPhotoUrl: photosInput?.photos?.[0]?.url?.substring(0, 80),
      sectionHeaders,
      fileInputs: Array.from(fileInputs).map(i => ({ id: i.id, accept: i.accept })),
      hasVariations: !!data.VARIATIONS?.variations?.length
    };
  });
  console.log(JSON.stringify(info, null, 2));
}

browser.disconnect();
