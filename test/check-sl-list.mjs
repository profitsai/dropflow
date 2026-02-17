import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

// Check if there's an /sl/ listing page too
const pages = await browser.pages();
for (const p of pages) {
  console.log(p.url().substring(0, 100));
}

// Open a NEW eBay listing to see what a fresh listing looks like
const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Let me try to create a simple single-item listing (no variations) to see if photos work there
// Actually, let me check an alternative approach: the 5054292507820 listing.
// Let me check if removing variations makes the photo section appear

// More importantly, let me check what a non-variation listing looks like
// Try a different draft
const otherPage = (await browser.pages()).find(p => p.url().includes('draftId=5053900927523'));
if (otherPage) {
  const otherInfo = await otherPage.evaluate(async () => {
    const draftId = new URLSearchParams(window.location.search).get('draftId');
    const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
    const data = await resp.json();
    
    const photos = data.PHOTOS;
    const hasPhotos = photos?.photosInput?.photos;
    
    // Check DOM for photo upload
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const photoSection = document.querySelector('.summary__photos');
    const uploaders = document.querySelectorAll('[class*="uploader"]');
    
    return {
      photosType: photos?._type,
      hasPhotosData: !!hasPhotos,
      photosCount: hasPhotos?.length,
      firstPhoto: hasPhotos?.[0]?.url?.substring(0, 80),
      fileInputCount: fileInputs.length,
      fileInputAccepts: Array.from(fileInputs).map(i => i.accept),
      photoSectionClass: photoSection?.className?.substring(0, 80),
      uploaderCount: uploaders.length,
      hasVariations: !!data.VARIATIONS?.variations?.length
    };
  });
  console.log('\nOther listing:', JSON.stringify(otherInfo, null, 2));
}

browser.disconnect();
