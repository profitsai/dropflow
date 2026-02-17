import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd'
});

const ebayPage = (await browser.pages()).find(p => p.url().includes('draftId=5054292507820'));

// First, let's intercept the headers from eBay's own requests
// We'll trigger a minor change (like clicking something) and capture the CSRF token

const result = await ebayPage.evaluate(async () => {
  const draftId = new URLSearchParams(window.location.search).get('draftId');
  
  // Get cookies for auth
  const cookies = document.cookie;
  
  // Try getting CSRF token from meta tags or page
  const csrfMeta = document.querySelector('meta[name="csrf-token"]') ||
                   document.querySelector('meta[name="_csrf"]') ||
                   document.querySelector('input[name="_csrf"]');
  const csrfToken = csrfMeta?.content || csrfMeta?.value;
  
  // Look for eBay's auth tokens in page scripts
  const scripts = document.querySelectorAll('script');
  let authToken = null;
  for (const s of scripts) {
    const text = s.textContent;
    if (text.includes('csrf') || text.includes('token')) {
      const match = text.match(/"csrfToken"\s*:\s*"([^"]+)"/);
      if (match) authToken = match[1];
    }
  }
  
  // Try PUT with various image URL formats
  const imageUrl = 'https://ae-pic-a1.aliexpress-media.com/kf/S737c02cfd4b74daab2aaac83ec5a8407g.jpg_640x640.jpg';
  
  // Read current draft to get the structure
  const draftResp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, { 
    credentials: 'include' 
  });
  const draft = await draftResp.json();
  
  // Get the headers that eBay's own code uses
  // Look for x-csrf-token in the page state
  const xcsrf = draft.meta?.csrfToken || null;
  
  // Try PUT with PHOTOS key matching eBay's Helix format
  const putPayloads = [
    // Format 1: Top-level PHOTOS with pictureUrl array
    { PHOTOS: { pictureUrl: [imageUrl] } },
    // Format 2: pictures key
    { pictures: { pictureUrl: [imageUrl] } },
    // Format 3: PHOTOS with images array  
    { PHOTOS: { images: [{ url: imageUrl }] } },
    // Format 4: External URL import
    { PHOTOS: { externalImageUrl: imageUrl } },
  ];
  
  const results = {};
  for (let i = 0; i < putPayloads.length; i++) {
    try {
      const resp = await fetch(`/lstng/api/listing_draft/${draftId}?mode=AddItem`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(putPayloads[i])
      });
      const text = await resp.text();
      results[`format${i+1}`] = { 
        status: resp.status, 
        body: text.substring(0, 300) 
      };
    } catch(e) {
      results[`format${i+1}`] = { error: e.message };
    }
  }
  
  return { csrfToken, authToken, xcsrf, results };
});

console.log(JSON.stringify(result, null, 2));

browser.disconnect();
