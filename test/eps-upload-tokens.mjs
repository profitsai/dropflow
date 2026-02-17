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

const result = await ebayPage.evaluate(async (dataUrl) => {
  // Extract EPS config from page scripts
  const scripts = document.querySelectorAll('script:not([src])');
  let epsConfig = null;
  for (const s of scripts) {
    const text = s.textContent;
    const match = text.match(/"uaek":"(\d+)","uaes":"([^"]+)"/);
    if (match) {
      const endpointMatch = text.match(/"http2Endpoint":"([^"]+)"/);
      epsConfig = {
        uaek: match[1],
        uaes: match[2],
        endpoint: endpointMatch?.[1] || '/image/upload/eBayISAPI.dll?EpsBasic'
      };
      break;
    }
  }
  
  if (!epsConfig) return { error: 'No EPS config found' };

  return new Promise((resolve) => {
    const [header, base64] = dataUrl.split(',');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    
    const fd = new FormData();
    fd.append('file', file);
    fd.append('s', 'SuperSize');
    fd.append('n', 'i');
    fd.append('v', '2');
    fd.append('aXRequest', '2');
    fd.append('uaek', epsConfig.uaek);
    fd.append('uaes', epsConfig.uaes);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', epsConfig.endpoint, true);
    xhr.withCredentials = true;
    
    xhr.onload = () => {
      resolve({ status: xhr.status, response: xhr.responseText.substring(0, 1000), epsConfig });
    };
    xhr.onerror = () => {
      resolve({ error: 'XHR error' });
    };
    xhr.timeout = 30000;
    xhr.send(fd);
  });
}, imageData.dataUrl);

console.log('Result:', JSON.stringify(result, null, 2));

browser.disconnect();
