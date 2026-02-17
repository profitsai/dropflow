import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const extPage = (await browser.pages()).find(p => p.url().includes('chrome-extension://hikiofeedjngalncoapgpmljpaoeolci'));
const imageData = await extPage.evaluate(async () => {
  return await chrome.runtime.sendMessage({ 
    type: 'FETCH_IMAGE', 
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_640x640.jpg' 
  });
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// Instead of trying to hack the existing video uploader, let me try a completely different
// approach: bypass the component entirely and upload to EPS + update the draft directly

const result = await ebayPage.evaluate(async (dataUrl) => {
  // Step 1: Extract EPS config from page scripts
  let uaek, uaes;
  const scripts = document.querySelectorAll('script:not([src])');
  for (const s of scripts) {
    const text = s.textContent;
    const match = text.match(/"uaek":"(\d+)","uaes":"([^"]+)"/);
    if (match) {
      uaek = match[1];
      uaes = match[2];
      break;
    }
  }
  if (!uaek) return { error: 'No EPS config found' };

  // Step 2: Upload to EPS via XHR
  const [header, b64] = dataUrl.split(',');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const file = new File([blob], 'product-photo-1.jpg', { type: 'image/jpeg' });

  const epsUrl = await new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('s', 'SuperSize');
    fd.append('n', 'i');
    fd.append('v', '2');
    fd.append('aXRequest', '2');
    fd.append('uaek', uaek);
    fd.append('uaes', uaes);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/image/upload/eBayISAPI.dll?EpsBasic', true);
    xhr.withCredentials = true;
    xhr.onload = () => {
      // Parse response: "VERSION:2;https://i.ebayimg.com/..."
      const text = xhr.responseText;
      if (text.startsWith('VERSION:')) {
        const url = text.split(';')[1];
        resolve(url);
      } else {
        reject(new Error('EPS error: ' + text.substring(0, 100)));
      }
    };
    xhr.onerror = () => reject(new Error('XHR error'));
    xhr.timeout = 30000;
    xhr.send(fd);
  });

  if (!epsUrl) return { error: 'EPS upload failed' };
  
  // Step 3: Now we have an eBay-hosted image URL. 
  // Try to update the draft via the API with the correct format.
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  
  // Get the SRT token (CSRF)
  // Look for it in the page's script data
  let srt = null;
  for (const s of scripts) {
    const text = s.textContent;
    const srtMatch = text.match(/"srt"\s*:\s*"([^"]+)"/);
    if (srtMatch) {
      srt = srtMatch[1];
      break;
    }
  }
  
  // Try the draft PUT with SRT token
  const putPayloads = [
    { PHOTOS: { photosInput: { photos: [{ url: epsUrl }] } }, srt },
    { PHOTOS: { photosInput: { photos: [{ url: epsUrl, uploaded: true, state: 'READY' }] } }, srt },
  ];
  
  const putResults = {};
  for (let i = 0; i < putPayloads.length; i++) {
    try {
      const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(putPayloads[i])
      });
      const text = await resp.text();
      putResults[`format${i+1}`] = { status: resp.status, body: text.substring(0, 300) };
    } catch(e) {
      putResults[`format${i+1}`] = { error: e.message };
    }
  }
  
  return { epsUrl, srt: !!srt, putResults };
}, imageData.dataUrl);

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
