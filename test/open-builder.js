const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  
  // Check if dialog is already open
  const dialogOpen = await ebayPage.evaluate(() => {
    const dialog = document.querySelector('.msku-dialog');
    return {
      exists: !!dialog,
      visible: dialog ? dialog.offsetParent !== null || dialog.offsetHeight > 0 : false
    };
  });
  console.log('Dialog:', dialogOpen);
  
  if (!dialogOpen.exists) {
    // Scroll to variations section first
    await ebayPage.evaluate(() => {
      const sec = document.querySelector('.summary__variations');
      if (sec) sec.scrollIntoView({ behavior: 'smooth' });
    });
    await new Promise(r => setTimeout(r, 1000));
    
    // Click Edit button
    const clicked = await ebayPage.evaluate(() => {
      // Try multiple selectors for the edit button
      const selectors = [
        '.summary__variations button[aria-label*="Edit"]',
        '.summary__variations .summary__header-edit-button',
        '.summary__variations button'
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn) {
          btn.click();
          return `Clicked: ${sel} - "${btn.textContent.trim()}"`;
        }
      }
      return 'No button found';
    });
    console.log('Edit click:', clicked);
    
    // Wait for builder to load
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const frames = ebayPage.frames();
      const bulkFrame = frames.find(f => f.url().includes('bulkedit'));
      if (bulkFrame) {
        console.log(`Builder loaded after ${i+1}s`);
        break;
      }
      if (i % 5 === 4) {
        const allFrames = frames.map(f => f.url().substring(0, 60));
        console.log(`Still waiting... frames: ${allFrames.join(', ')}`);
      }
    }
  }
  
  const frames = ebayPage.frames();
  const bulkFrame = frames.find(f => f.url().includes('bulkedit'));
  if (!bulkFrame) {
    console.log('Builder never loaded. Frames:', frames.map(f => f.url().substring(0, 80)));
    
    // Check for dialog content
    const dialogContent = await ebayPage.evaluate(() => {
      const dialog = document.querySelector('.msku-dialog, .lightbox-dialog, [role="dialog"]');
      if (dialog) return dialog.innerHTML.substring(0, 500);
      return 'no dialog';
    });
    console.log('Dialog HTML:', dialogContent.substring(0, 300));
    
    browser.disconnect();
    return;
  }
  
  // Builder is open — check for photo upload
  await new Promise(r => setTimeout(r, 2000));
  
  // Find "Add default photos" section
  const defaultPhotos = await bulkFrame.evaluate(() => {
    // Look for the default photos section
    const text = document.body.textContent;
    const sections = Array.from(document.querySelectorAll('*')).filter(el => 
      /default.*photo|add.*default/i.test(el.textContent.trim()) &&
      el.textContent.trim().length < 100 && el.offsetParent !== null
    );
    return sections.map(s => ({
      tag: s.tagName,
      text: s.textContent.trim().substring(0, 80),
      class: s.className?.substring(0, 50)
    }));
  });
  console.log('Default photos sections:', JSON.stringify(defaultPhotos, null, 2));
  
  // Click "Add default photos" to open photo upload
  const clickResult = await bulkFrame.evaluate(() => {
    const el = Array.from(document.querySelectorAll('a, button, [role="button"], span, div'))
      .find(e => /add default photos/i.test(e.textContent.trim()) && e.textContent.trim().length < 50 && e.offsetParent !== null);
    if (el) {
      el.click();
      return 'Clicked: ' + el.tagName + ' "' + el.textContent.trim() + '"';
    }
    return 'Not found';
  });
  console.log('Click add default photos:', clickResult);
  
  await new Promise(r => setTimeout(r, 3000));
  
  // Check frames again — picupload iframe should appear
  const newFrames = ebayPage.frames();
  const picFrame = newFrames.find(f => f.url().includes('picupload'));
  console.log('Picupload frame:', picFrame ? picFrame.url().substring(0, 100) : 'not found');
  console.log('All frames now:', newFrames.map(f => f.url().substring(0, 80)));
  
  // If picupload frame found, upload via file input
  if (picFrame) {
    const fileInputInfo = await picFrame.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="file"]');
      return Array.from(inputs).map(i => ({ accept: i.accept, name: i.name, id: i.id, class: i.className }));
    }).catch(e => [{ error: e.message }]);
    console.log('File inputs in picupload:', fileInputInfo);
    
    if (fileInputInfo.length > 0 && !fileInputInfo[0].error) {
      // Upload a real image
      const fileInput = await picFrame.$('input[type="file"]');
      if (fileInput) {
        // Create temp file
        const fs = require('fs');
        const { createCanvas } = (() => {
          try { return require('canvas'); } catch(e) { return { createCanvas: null }; }
        })();
        
        // Upload via page evaluation
        const uploadResult = await picFrame.evaluate(async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 800; canvas.height = 800;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#cc4444';
          ctx.fillRect(0, 0, 800, 800);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 48px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('Dog Harness', 400, 380);
          ctx.fillText('Product Photo', 400, 440);
          
          const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
          const file = new File([blob], 'product-photo.jpg', { type: 'image/jpeg' });
          
          const input = document.querySelector('input[type="file"]');
          if (!input) return { error: 'no input' };
          
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          
          return { success: true, fileName: file.name, fileSize: file.size };
        });
        console.log('File upload:', uploadResult);
        
        await new Promise(r => setTimeout(r, 5000));
        
        // Check result
        const afterUpload = await picFrame.evaluate(() => {
          const imgs = document.querySelectorAll('img[src]:not([src*="data:image/svg"])');
          return Array.from(imgs).map(i => i.src.substring(0, 80));
        }).catch(e => [e.message]);
        console.log('Images after upload:', afterUpload);
      }
    }
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
