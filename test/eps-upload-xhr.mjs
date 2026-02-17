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

// Try with XHR instead of fetch (EPS traditionally uses XHR)
const result = await ebayPage.evaluate(async (dataUrl) => {
  return new Promise((resolve) => {
    // Convert data URL to blob
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
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/image/upload/eBayISAPI.dll?EpsBasic', true);
    xhr.withCredentials = true;
    
    xhr.onload = () => {
      resolve({ status: xhr.status, response: xhr.responseText.substring(0, 1000) });
    };
    xhr.onerror = (e) => {
      resolve({ error: 'XHR error', status: xhr.status, statusText: xhr.statusText });
    };
    xhr.ontimeout = () => {
      resolve({ error: 'timeout' });
    };
    xhr.timeout = 30000;
    
    xhr.send(fd);
  });
}, imageData.dataUrl);

console.log('XHR result:', JSON.stringify(result, null, 2));

// Check if there's a security token needed
const securityInfo = await ebayPage.evaluate(() => {
  // Check for CSRF tokens in cookies
  const cookies = document.cookie.split(';').map(c => c.trim());
  const securityCookies = cookies.filter(c => 
    c.startsWith('s=') || c.startsWith('srt=') || c.startsWith('np=') || 
    c.startsWith('nonsession=') || c.startsWith('ds2=')
  );
  
  return { securityCookies: securityCookies.map(c => c.substring(0, 30) + '...') };
});
console.log('\nSecurity:', JSON.stringify(securityInfo, null, 2));

browser.disconnect();
