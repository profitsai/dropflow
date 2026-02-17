const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  
  const frames = ebayPage.frames();
  const picFrame = frames.find(f => f.url().includes('picupload'));
  if (!picFrame) { console.log('No picupload frame'); browser.disconnect(); return; }
  
  // Check Helix uploader in picupload frame
  const uploaderCheck = await picFrame.evaluate(() => {
    return new Promise(resolve => {
      const script = document.createElement('script');
      const cbId = '__df_pic_check_' + Date.now();
      const handler = (event) => {
        if (event.data && event.data.type === cbId) {
          window.removeEventListener('message', handler);
          resolve(event.data);
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => { window.removeEventListener('message', handler); resolve({ timeout: true }); }, 3000);
      
      script.textContent = `
        (function() {
          var id = "${cbId}";
          var u = window.sellingUIUploader;
          var result = { hasUploader: !!u };
          if (u) {
            var key = Object.keys(u)[0];
            result.key = key;
            var inst = u[key];
            if (inst) {
              result.hasUploadFiles = typeof inst.uploadFiles;
              result.config = inst.config ? { accept: inst.config.accept, acceptImage: inst.config.acceptImage, maxPhotos: inst.config.maxPhotos } : null;
              result.totalImages = inst.totalImagesCount;
            }
          }
          window.postMessage({ type: id, ...result }, '*');
        })();
      `;
      document.head.appendChild(script);
      script.remove();
    });
  });
  console.log('Picframe uploader:', JSON.stringify(uploaderCheck, null, 2));
  
  // If Helix uploader exists in picframe, upload via it
  if (uploaderCheck.hasUploader && uploaderCheck.hasUploadFiles === 'function') {
    console.log('\nUploading via picframe Helix uploader...');
    
    const uploadResult = await picFrame.evaluate(() => {
      return new Promise(resolve => {
        const cbId = '__df_pic_upload_' + Date.now();
        const handler = (event) => {
          if (event.data && event.data.type === cbId) {
            window.removeEventListener('message', handler);
            resolve(event.data);
          }
        };
        window.addEventListener('message', handler);
        setTimeout(() => { window.removeEventListener('message', handler); resolve({ timeout: true }); }, 30000);
        
        const script = document.createElement('script');
        script.textContent = `
        (async function() {
          var CALLBACK = "${cbId}";
          try {
            var u = window.sellingUIUploader;
            var key = Object.keys(u)[0];
            var inst = u[key];
            
            // Create image via canvas
            var canvas = document.createElement('canvas');
            canvas.width = 800; canvas.height = 800;
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#cc4444';
            ctx.fillRect(0, 0, 800, 800);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 48px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Dog Harness', 400, 350);
            ctx.fillText('Product Photo 1', 400, 420);
            
            var blob = await new Promise(function(r) { canvas.toBlob(r, 'image/jpeg', 0.9); });
            var file = new File([blob], 'product-photo-1.jpg', { type: 'image/jpeg' });
            
            var config = Object.assign({}, inst.config);
            config.acceptImage = true;
            config.accept = 'image/*,image/jpeg,image/png';
            config.maxImages = 24;
            inst.acceptImage = true;
            
            var succeeded = false, failed = false, errMsg = '';
            if (inst.emitter && inst.emitter.on) {
              inst.emitter.on('upload-success', function() { succeeded = true; });
              inst.emitter.on('upload-fail', function(e) { failed = true; errMsg = e ? String(e) : ''; });
              inst.emitter.on('upload-complete', function() { if (!failed) succeeded = true; });
            }
            
            inst.uploadFiles([file], 'select', config, { numImage: 0, numVideo: 0 });
            
            var start = Date.now();
            while (Date.now() - start < 20000) {
              if (succeeded || failed) break;
              await new Promise(function(r) { setTimeout(r, 500); });
            }
            
            window.postMessage({
              type: CALLBACK,
              succeeded: succeeded,
              failed: failed,
              errMsg: errMsg,
              totalImages: inst.totalImagesCount,
              timedOut: !succeeded && !failed
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
    console.log('Picframe upload result:', JSON.stringify(uploadResult, null, 2));
    
    if (uploadResult.succeeded) {
      await new Promise(r => setTimeout(r, 3000));
      
      // Check images
      const imgs = await picFrame.evaluate(() => {
        const thumbs = document.querySelectorAll('img[src]:not([src*="data:image/svg"])');
        return Array.from(thumbs).map(i => i.src.substring(0, 80));
      });
      console.log('Images in picframe:', imgs);
    }
  }
  
  browser.disconnect();
})().catch(e => console.error(e));
