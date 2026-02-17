const puppeteer = require('puppeteer-core');
const fs = require('fs');
(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:62547/devtools/browser/ef8b6f3e-39e0-49ce-a27a-9eba2d3107dd' });
  const pages = await browser.pages();
  const ebayPage = pages.find(p => p.url().includes('ebay'));
  if (!ebayPage) { console.log('No eBay page'); return; }
  
  // Test uploading a single test image via Helix uploader
  // First create a simple test image (1x1 red pixel JPEG)
  const testImageBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dA' +
    'RUZYSWNOU2FrY2ZZSC9GZVNnb2xkfJmXl5STXWZtZ5L/2wBDARUXFx4aHjshITuSVEJUkpKSkpKS' +
    'kpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpL/wAARCAAyADIDASIA' +
    'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
    'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
    'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm' +
    'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA' +
    'AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx' +
    'BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYI4Q/SFhSRxdJEw0UKBhmnNHBEVEz' +
    'OjZTZDHFdURKS05UZGd0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6' +
    'wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDpKKKKACii' +
    'igAooooAKKKKACiiigAooooAKKKKACiiigD/2Q==';
  
  console.log('Testing Helix uploader with test image...');
  
  const result = await ebayPage.evaluate(async (imageB64) => {
    return new Promise((resolve) => {
      const cbId = '__dropflow_photo_test_' + Date.now();
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
        var CALLBACK_ID = "${cbId}";
        try {
          var uploaders = window.sellingUIUploader;
          if (!uploaders) { window.postMessage({ type: CALLBACK_ID, error: 'no uploaders' }, '*'); return; }
          var key = Object.keys(uploaders)[0];
          var uploader = uploaders[key];
          if (!uploader) { window.postMessage({ type: CALLBACK_ID, error: 'no instance' }, '*'); return; }
          
          // Convert base64 to File
          var b64 = "${imageB64}";
          var byteStr = atob(b64);
          var ab = new ArrayBuffer(byteStr.length);
          var ia = new Uint8Array(ab);
          for (var i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
          var file = new File([ab], 'test-photo.jpg', { type: 'image/jpeg' });
          
          var config = Object.assign({}, uploader.config);
          config.acceptImage = true;
          config.accept = 'image/*,image/jpeg,image/png,image/webp,video/mp4,video/quicktime';
          config.maxImages = 24;
          config.maxPhotos = 24;
          uploader.acceptImage = true;
          
          var succeeded = false, failed = false, errorMsg = '';
          if (uploader.emitter && uploader.emitter.on) {
            uploader.emitter.on('upload-success', function() { succeeded = true; });
            uploader.emitter.on('upload-fail', function(e) { failed = true; errorMsg = e ? JSON.stringify(e).substring(0,200) : 'unknown'; });
          }
          
          uploader.uploadFiles([file], 'select', config, { numImage: 0, numVideo: 0 });
          
          var start = Date.now();
          while (Date.now() - start < 15000) {
            if (succeeded || failed) break;
            await new Promise(function(r) { setTimeout(r, 500); });
          }
          
          window.postMessage({ 
            type: CALLBACK_ID, 
            succeeded: succeeded, 
            failed: failed, 
            errorMsg: errorMsg,
            totalImages: uploader.totalImagesCount,
            timedOut: !succeeded && !failed
          }, '*');
        } catch (e) {
          window.postMessage({ type: CALLBACK_ID, error: e.message }, '*');
        }
      })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    });
  }, testImageBase64);
  
  console.log('Photo upload result:', JSON.stringify(result, null, 2));
  
  // Check photo count after upload
  await new Promise(r => setTimeout(r, 2000));
  const photoCount = await ebayPage.evaluate(() => {
    const imgs = document.querySelectorAll('.uploader-thumbnails img[src]');
    const photoCountEl = document.querySelector('.uploader-thumbnails__photo-count, .uploader-ui-img-g__header');
    return {
      imgCount: imgs.length,
      photoCountText: photoCountEl?.textContent,
      hasPhotoSection: !!document.querySelector('.summary__photos')
    };
  });
  console.log('Photo count:', photoCount);
  
  browser.disconnect();
})().catch(e => console.error(e));
