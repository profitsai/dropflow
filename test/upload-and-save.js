const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  
  const frames = ebayPage.frames();
  const picFrame = frames.find(f => f.url().includes('picupload'));
  const bulkFrame = frames.find(f => f.url().includes('bulkedit'));
  
  if (!picFrame) { console.log('No picupload frame'); browser.disconnect(); return; }
  
  // Check what happened after the upload
  const picState = await picFrame.evaluate(() => {
    return {
      body: document.body.innerHTML.substring(0, 2000),
      imgs: Array.from(document.querySelectorAll('img')).map(i => ({ src: i.src?.substring(0, 80), w: i.width, h: i.height })),
      divs: Array.from(document.querySelectorAll('.photo-img, .se-uploader-photo, [class*="thumbnail"], [class*="photo"]'))
        .map(d => ({ class: d.className?.substring(0, 50), text: d.textContent?.substring(0, 50) }))
    };
  });
  console.log('Pic frame state:', JSON.stringify(picState.imgs));
  console.log('Photo divs:', JSON.stringify(picState.divs));
  
  // Upload 3 images via the picframe Helix uploader
  console.log('\nUploading 3 images...');
  const multiUpload = await picFrame.evaluate(() => {
    return new Promise(resolve => {
      const cbId = '__df_multi_' + Date.now();
      const handler = (event) => {
        if (event.data && event.data.type === cbId) {
          window.removeEventListener('message', handler);
          resolve(event.data);
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => { window.removeEventListener('message', handler); resolve({ timeout: true }); }, 60000);
      
      const script = document.createElement('script');
      script.textContent = `
      (async function() {
        var CALLBACK = "${cbId}";
        try {
          var u = window.sellingUIUploader;
          var key = Object.keys(u)[0];
          var inst = u[key];
          
          var colors = ['#cc4444', '#4444cc', '#44cc44'];
          var labels = ['Red Harness', 'Blue Harness', 'Green Harness'];
          var uploaded = 0;
          
          for (var idx = 0; idx < 3; idx++) {
            var canvas = document.createElement('canvas');
            canvas.width = 800; canvas.height = 800;
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = colors[idx];
            ctx.fillRect(0, 0, 800, 800);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 48px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Dog Harness', 400, 350);
            ctx.fillText(labels[idx], 400, 420);
            
            var blob = await new Promise(function(r) { canvas.toBlob(r, 'image/jpeg', 0.9); });
            var file = new File([blob], 'photo-' + (idx+1) + '.jpg', { type: 'image/jpeg' });
            
            var config = Object.assign({}, inst.config);
            config.acceptImage = true;
            config.maxImages = 24;
            inst.acceptImage = true;
            
            var done = false;
            var onDone = function() { done = true; };
            if (inst.emitter) {
              inst.emitter.on('upload-success', onDone);
              inst.emitter.on('upload-fail', onDone);
            }
            
            inst.uploadFiles([file], 'select', config, { numImage: uploaded, numVideo: 0 });
            
            var start = Date.now();
            while (!done && Date.now() - start < 15000) {
              await new Promise(function(r) { setTimeout(r, 500); });
            }
            
            if (inst.emitter) {
              inst.emitter.removeListener('upload-success', onDone);
              inst.emitter.removeListener('upload-fail', onDone);
            }
            
            uploaded++;
            await new Promise(function(r) { setTimeout(r, 1000); });
          }
          
          window.postMessage({
            type: CALLBACK,
            uploaded: uploaded,
            totalImages: inst.totalImagesCount,
            // Check for photo thumbnails
            thumbs: document.querySelectorAll('.se-uploader-photo, img[src*="ebayimg"]').length
          }, '*');
        } catch(e) {
          window.postMessage({ type: CALLBACK, error: e.message }, '*');
        }
      })();
      `;
      document.head.appendChild(script);
      script.remove();
    });
  });
  console.log('Multi-upload result:', JSON.stringify(multiUpload, null, 2));
  
  await new Promise(r => setTimeout(r, 3000));
  
  // Check picframe for thumbnails
  const thumbs = await picFrame.evaluate(() => {
    const imgs = document.querySelectorAll('img[src]');
    return Array.from(imgs).map(i => ({ src: i.src?.substring(0, 80), w: i.width, h: i.height }));
  });
  console.log('Thumbnails:', JSON.stringify(thumbs));
  
  // Check the bulkedit frame's photo count
  if (bulkFrame) {
    const photoCount = await bulkFrame.evaluate(() => {
      const el = Array.from(document.querySelectorAll('*')).find(e => 
        /\d+\/24\s*photos/i.test(e.textContent.trim()) && e.textContent.trim().length < 30
      );
      return el ? el.textContent.trim() : 'not found';
    });
    console.log('Builder photo count:', photoCount);
  }
  
  // Try Save and close
  if (bulkFrame) {
    const saved = await bulkFrame.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => /save/i.test(b.textContent.trim()));
      if (btn) { btn.click(); return 'Clicked: ' + btn.textContent.trim(); }
      return 'no save button';
    });
    console.log('Save:', saved);
  }
  
  await new Promise(r => setTimeout(r, 5000));
  
  // Final check
  const errors = await ebayPage.evaluate(() => {
    return Array.from(document.querySelectorAll('.summary--error'))
      .map(e => e.textContent.substring(0, 150));
  });
  console.log('Final errors:', errors.length === 0 ? 'NONE ✅' : errors);
  
  browser.disconnect();
})().catch(e => console.error(e));
