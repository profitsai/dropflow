import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Approach: Create a file chooser interceptor, then click the photo area  
// to see if it triggers a file chooser (which would mean there IS a file input mechanism)

// Use Puppeteer's waitForFileChooser
const [fileChooser] = await Promise.all([
  ebayPage.waitForFileChooser({ timeout: 5000 }).catch(() => null),
  ebayPage.evaluate(() => {
    // Try clicking the "Upload photos" button in the Variations section 
    // (the one that's NOT the video uploader)
    const uploadBtn = Array.from(document.querySelectorAll('button')).find(b => 
      b.textContent.includes('Upload photos')
    );
    if (uploadBtn) {
      uploadBtn.click();
      return 'clicked Upload photos';
    }
    return 'not found';
  })
]);

if (fileChooser) {
  console.log('FILE CHOOSER OPENED! Accept types:', fileChooser.isMultiple());
  // We can programmatically select files!
  // For now just cancel it
  await fileChooser.cancel();
  console.log('This is the mechanism we need to use.');
} else {
  console.log('No file chooser opened from variation photos button');
  
  // Try the main "Upload from computer" button (video area)
  const [fc2] = await Promise.all([
    ebayPage.waitForFileChooser({ timeout: 5000 }).catch(() => null),
    ebayPage.evaluate(() => {
      const btn = document.querySelector('.summary__photos--photo-framework button.btn--tertiary');
      if (btn) btn.click();
      return btn ? 'clicked' : 'not found';
    })
  ]);
  
  if (fc2) {
    console.log('FILE CHOOSER from video button! Accept:', fc2.isMultiple());
    await fc2.cancel();
  } else {
    console.log('No file chooser from video button either');
  }
}

// Let me try another approach - look at how eBay's photo framework actually works
// Check for the Helix photo uploader component
const helixInfo = await ebayPage.evaluate(() => {
  // Check if there's a React/Marko/Helix component state we can access
  const photoSection = document.querySelector('.summary__photos--photo-framework');
  if (!photoSection) return { error: 'no photo section' };
  
  // Check for __helix or React fiber
  const keys = Object.keys(photoSection).filter(k => k.startsWith('__'));
  
  // Look at all event listeners
  const allElements = photoSection.querySelectorAll('*');
  const withOnClick = [];
  for (const el of allElements) {
    if (el.onclick) withOnClick.push({ tag: el.tagName, class: el.className?.substring(0, 60) });
  }
  
  return { internalKeys: keys, elementsWithOnClick: withOnClick };
});

console.log('Helix info:', JSON.stringify(helixInfo, null, 2));

browser.disconnect();
