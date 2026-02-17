import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

// First, download an image and save it locally
const extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));
const imageData = await extPage.evaluate(async () => {
  return await chrome.runtime.sendMessage({ 
    type: 'FETCH_IMAGE', 
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_640x640.jpg' 
  });
});

// Save to temp file
const base64 = imageData.dataUrl.split(',')[1];
const imgPath = '/tmp/test-upload-photo.jpg';
fs.writeFileSync(imgPath, Buffer.from(base64, 'base64'));
console.log('Saved test image:', imgPath, fs.statSync(imgPath).size, 'bytes');

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Scroll to where the photo section should be and look for it 
// eBay's Helix photo section might not be visible. Let me check the page structure again
// with the variation dialog closed.

// Check if there's a collapsed/hidden photo section that needs to be expanded
const photoCheck = await ebayPage.evaluate(() => {
  // First close any open variations dialog
  const closeBtn = document.querySelector('.fullscreen-dialog__close');
  if (closeBtn) closeBtn.click();
  
  // Check the page structure - the summary__photos section
  const photoSection = document.querySelector('.summary__photos');
  if (!photoSection) return { error: 'no summary__photos section' };
  
  // Check if there's a hidden file input or drag area
  const html = photoSection.outerHTML;
  const hasDropzone = html.includes('dropzone');
  const hasFileInput = html.includes('type="file"');
  
  // Check for the "See photo options" link that might expand the photo uploader
  const seeOptions = Array.from(document.querySelectorAll('button, a, [role="button"]')).find(el => 
    el.textContent.includes('See photo options') || el.textContent.includes('photo options')
  );
  
  // The photo section header says "Video" - but the class says "summary__photos"
  // Check if "Photos" section is elsewhere or needs to be enabled
  const heading = photoSection.querySelector('h2')?.textContent?.trim();
  
  return { 
    heading, 
    hasDropzone, 
    hasFileInput,
    seeOptionsFound: !!seeOptions,
    seeOptionsText: seeOptions?.textContent?.trim()
  };
});

console.log('Photo check:', JSON.stringify(photoCheck, null, 2));

await new Promise(r => setTimeout(r, 1000));

// The photo section heading says "Video" - there's no separate "Photos" section on the main form.
// But looking at the draft data, the PHOTOS section exists.
// The photo uploader UI might need to be triggered by clicking "See photo options"
// or clicking the photo area.

// Let me try an aggressive approach: create a file input, inject it into the photo section,
// and trigger an upload through eBay's internal component

// Actually, let me first try the simplest approach that might work:
// Use the video uploader's "Upload from computer" button but intercept the file chooser
// and provide an image instead.

// Wait - the video input accepts only "video/mp4,video/quicktime". 
// But what if we modify the accept attribute?

// Or better: Let me try creating our OWN file input in the photo area and trigger eBay's
// internal handler

// First, let me check what the Helix uploader expects by looking at the inline script data
const uploaderConfig = await ebayPage.evaluate(() => {
  const scripts = document.querySelectorAll('script:not([src])');
  for (const s of scripts) {
    const text = s.textContent;
    const idx = text.indexOf('EpsBasic');
    if (idx > -1) {
      // Find the full config object around EpsBasic
      let start = idx;
      let braceCount = 0;
      while (start > 0) {
        start--;
        if (text[start] === '{') {
          braceCount++;
          if (braceCount === 1) break;
        }
        if (text[start] === '}') braceCount--;
      }
      
      // Find the end of this object
      let end = start;
      braceCount = 0;
      while (end < text.length) {
        if (text[end] === '{') braceCount++;
        if (text[end] === '}') {
          braceCount--;
          if (braceCount === 0) { end++; break; }
        }
        end++;
      }
      
      return text.substring(start, Math.min(end, start + 2000));
    }
  }
  return null;
});

console.log('\nUploader config:', uploaderConfig?.substring(0, 1000));

browser.disconnect();
