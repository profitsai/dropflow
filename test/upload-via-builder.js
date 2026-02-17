const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  
  // Open variation editor
  console.log('Opening variation editor...');
  await ebayPage.evaluate(() => {
    const editBtn = document.querySelector('.summary__variations button[aria-label*="Edit"]');
    if (editBtn) editBtn.click();
  });
  await new Promise(r => setTimeout(r, 5000));
  
  const frames = ebayPage.frames();
  console.log('All frames:', frames.map(f => f.url().substring(0, 80)));
  
  const bulkFrame = frames.find(f => f.url().includes('bulkedit'));
  if (!bulkFrame) { console.log('No bulkedit frame'); browser.disconnect(); return; }
  
  // Check for photo upload areas in the builder
  const photoInfo = await bulkFrame.evaluate(() => {
    const body = document.body.textContent;
    const hasDefaultPhotos = body.includes('Add default photos') || body.includes('Default photos');
    
    // Find all file inputs
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
    
    // Find photo-related buttons/links
    const photoLinks = Array.from(document.querySelectorAll('a, button, [role="button"]'))
      .filter(el => /photo|image|upload|add.*photo/i.test(el.textContent) && el.offsetParent !== null)
      .map(el => ({ tag: el.tagName, text: el.textContent.trim().substring(0, 50), class: el.className?.substring(0, 50) }));
    
    // Check for the serial/photo input
    const serialInput = document.querySelector('input[name="serial"]');
    
    return {
      hasDefaultPhotos,
      fileInputCount: fileInputs.length,
      fileInputAccepts: fileInputs.map(i => i.accept),
      photoLinks,
      serialInputValue: serialInput?.value
    };
  });
  console.log('Photo info in builder:', JSON.stringify(photoInfo, null, 2));
  
  // Look for the picupload iframe
  const picFrame = frames.find(f => f.url().includes('picupload'));
  if (picFrame) {
    console.log('\nFound picupload frame:', picFrame.url().substring(0, 100));
    const picInfo = await picFrame.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'))
        .filter(el => el.offsetParent !== null)
        .map(el => el.textContent.trim().substring(0, 40));
      return {
        fileInputs: inputs.map(i => ({ accept: i.accept, name: i.name, id: i.id })),
        buttons,
        bodyText: document.body.textContent.substring(0, 500)
      };
    }).catch(e => ({ error: e.message }));
    console.log('Picupload frame info:', JSON.stringify(picInfo, null, 2));
    
    // Try uploading via file input in picupload frame
    if (picInfo.fileInputs && picInfo.fileInputs.length > 0) {
      console.log('\nUploading via picupload file input...');
      
      // Create a test image and upload via file input
      const uploaded = await picFrame.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 800; canvas.height = 800;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#3366cc';
        ctx.fillRect(0, 0, 800, 800);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 48px Arial';
        ctx.fillText('Dog Harness', 200, 380);
        ctx.fillText('Red Size S', 240, 440);
        
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
        const file = new File([blob], 'product-photo-1.jpg', { type: 'image/jpeg' });
        
        const input = document.querySelector('input[type="file"]');
        if (!input) return { error: 'no file input' };
        
        // Set file via DataTransfer
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        
        return { success: true, accept: input.accept };
      });
      console.log('Upload result:', uploaded);
      
      // Wait for upload processing
      await new Promise(r => setTimeout(r, 5000));
      
      // Check if photo appeared
      const afterUpload = await picFrame.evaluate(() => {
        const imgs = document.querySelectorAll('img[src]');
        return {
          imgCount: imgs.length,
          imgSrcs: Array.from(imgs).slice(0, 3).map(i => i.src.substring(0, 80))
        };
      }).catch(e => ({ error: e.message }));
      console.log('After upload:', afterUpload);
    }
  } else {
    console.log('No picupload frame found');
    
    // Try the "Add default photos" link in the builder
    const addPhotoResult = await bulkFrame.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, button, [role="button"], span'));
      const addPhoto = links.find(el => 
        /add.*default.*photo|default.*photo/i.test(el.textContent.trim()) && 
        el.offsetParent !== null
      );
      if (addPhoto) {
        addPhoto.click();
        return 'Clicked: ' + addPhoto.textContent.trim();
      }
      return 'No add photo link found. Links: ' + links.filter(l => l.offsetParent !== null && l.textContent.trim().length < 40).map(l => l.textContent.trim()).slice(0, 20).join(', ');
    });
    console.log('Add photo result:', addPhotoResult);
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
