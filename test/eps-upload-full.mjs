import puppeteer from 'puppeteer-core';
import fs from 'fs';

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

// Get the full EPS config
const epsConfig = await ebayPage.evaluate(() => {
  const scripts = document.querySelectorAll('script:not([src])');
  for (const s of scripts) {
    const text = s.textContent;
    const idx = text.indexOf('"endpoint":"https://mach');
    if (idx > -1) {
      // Find the enclosing object
      let start = idx;
      let depth = 0;
      while (start > 0) {
        start--;
        if (text[start] === '}') depth++;
        if (text[start] === '{') {
          if (depth === 0) break;
          depth--;
        }
      }
      let end = idx;
      depth = 0;
      while (end < text.length) {
        if (text[end] === '{') depth++;
        if (text[end] === '}') {
          depth--;
          if (depth === 0) { end++; break; }
        }
        end++;
      }
      try {
        return JSON.parse(text.substring(start, end));
      } catch(e) {
        return { raw: text.substring(start, Math.min(end, start + 3000)) };
      }
    }
  }
  return null;
});

console.log('EPS Config:', JSON.stringify(epsConfig, null, 2));

// Now upload using these EPS parameters
const uploadResult = await ebayPage.evaluate(async (dataUrl, config) => {
  // Convert data URL to blob
  const [header, base64] = dataUrl.split(',');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
  
  const fd = new FormData();
  fd.append('file', file);
  
  // Add EPS parameters from the config
  if (config.s) fd.append('s', config.s);
  if (config.n) fd.append('n', config.n);
  if (config.v) fd.append('v', config.v);
  if (config.uaek) fd.append('uaek', config.uaek);
  if (config.uaes) fd.append('uaes', config.uaes);
  if (config.aXRequest) fd.append('aXRequest', config.aXRequest);
  if (config.wm !== undefined) fd.append('wm', config.wm);
  
  // Try the http2Endpoint (same-origin, avoids CORS)
  try {
    const resp = await fetch(config.http2Endpoint, {
      method: 'POST',
      body: fd,
      credentials: 'include'
    });
    const text = await resp.text();
    return { status: resp.status, body: text.substring(0, 1000) };
  } catch(e) {
    return { error: e.message };
  }
}, imageData.dataUrl, epsConfig);

console.log('\nUpload result:', JSON.stringify(uploadResult, null, 2));

browser.disconnect();
