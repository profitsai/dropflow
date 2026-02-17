import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

// Check the working listing
const workingPage = (await browser.pages()).find(p => p.url().includes('draftId=5053798596022'));
if (workingPage) {
  const info = await workingPage.evaluate(async () => {
    const draftId = new URLSearchParams(window.location.search).get('draftId');
    const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
    const data = await resp.json();
    
    return {
      draftId,
      hasVariationsData: !!data.VARIATIONS?.variations?.length,
      variationsCount: data.VARIATIONS?.variations?.length || 0,
      photosHeaderText: document.querySelector('.summary__photos h2')?.textContent?.trim(),
      photoSectionClass: document.querySelector('.summary__photos')?.className?.substring(0, 100),
      fileInputAccept: document.querySelector('#fehelix-uploader')?.accept
    };
  });
  console.log('Working (5053798596022):', JSON.stringify(info, null, 2));
}

// Check the broken listing
const brokenPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));
if (brokenPage) {
  const info = await brokenPage.evaluate(async () => {
    const draftId = new URLSearchParams(window.location.search).get('draftId');
    const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { credentials: 'include' });
    const data = await resp.json();
    
    return {
      draftId,
      hasVariationsData: !!data.VARIATIONS?.variations?.length,
      variationsCount: data.VARIATIONS?.variations?.length || 0,
      photosHeaderText: document.querySelector('.summary__photos h2')?.textContent?.trim(),
      photoSectionClass: document.querySelector('.summary__photos')?.className?.substring(0, 100),
      fileInputAccept: document.querySelector('#fehelix-uploader')?.accept
    };
  });
  console.log('Broken (5054292507820):', JSON.stringify(info, null, 2));
}

browser.disconnect();
