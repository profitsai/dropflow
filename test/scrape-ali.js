const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://127.0.0.1:55870/devtools/browser/21627e4c-7ee4-4746-b7cf-44fd73f7ca5d',
    defaultViewport: null
  });
  
  const pages = await browser.pages();
  // Find or navigate to the product page
  let aliPage = pages.find(p => p.url().includes('1005009953521226'));
  
  if (!aliPage) {
    aliPage = await browser.newPage();
    await aliPage.goto('https://www.aliexpress.com/item/1005009953521226.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  
  await aliPage.bringToFront();
  await new Promise(r => setTimeout(r, 5000)); // Let page settle
  
  // Scrape using MAIN world to access page JS variables
  const productData = await aliPage.evaluate(() => {
    const data = {
      title: '',
      price: 0,
      originalPrice: 0,
      images: [],
      description: '',
      variations: { hasVariations: false, axes: [], skuMap: {}, imagesByValue: {} },
      specs: {},
      url: location.href
    };
    
    // Title
    data.title = document.querySelector('h1')?.textContent?.trim() || 
                 document.title.replace(/ - AliExpress.*$/, '').trim();
    
    // Images
    const imgEls = document.querySelectorAll('.slider--img--D7MJNPZ img, .image-view-magnifier-wrap img, [class*="slider"] img');
    const imgSet = new Set();
    imgEls.forEach(img => {
      let src = img.src || img.getAttribute('src');
      if (src && !src.includes('placeholder')) {
        src = src.replace(/_\d+x\d+\w*\./, '.').replace(/\?\S+$/, '');
        if (!src.startsWith('http')) return;
        imgSet.add(src);
      }
    });
    
    // Also try to get from page data
    try {
      // Look for __INIT_STORE_DATA__ or similar
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const text = s.textContent;
        if (text.includes('imagePathList') || text.includes('imagePath')) {
          const match = text.match(/"imagePathList"\s*:\s*(\[.*?\])/);
          if (match) {
            const imgs = JSON.parse(match[1]);
            imgs.forEach(url => {
              if (url.startsWith('//')) url = 'https:' + url;
              imgSet.add(url.replace(/_\d+x\d+\w*\./, '.'));
            });
          }
        }
      }
    } catch (e) {}
    
    data.images = [...imgSet].slice(0, 12);
    
    // Price
    const priceEl = document.querySelector('[class*="price--current"] span, .product-price-current span, [class*="uniform-banner-box-price"]');
    if (priceEl) {
      const priceText = priceEl.textContent.replace(/[^0-9.]/g, '');
      data.price = parseFloat(priceText) || 0;
    }
    
    // Try getting all data from window objects
    let skuData = null;
    
    // Try window.runParams
    if (window.runParams?.data?.skuModule) {
      skuData = window.runParams.data.skuModule;
    }
    
    // Try __INIT_STORE_DATA__
    if (!skuData && window.__INIT_STORE_DATA__) {
      const storeData = window.__INIT_STORE_DATA__;
      if (storeData.data?.root?.fields) {
        const fields = storeData.data.root.fields;
        if (fields.skuModule) skuData = fields.skuModule;
        if (fields.productTitle) data.title = fields.productTitle;
        if (fields.imageModule?.imagePathList) {
          data.images = fields.imageModule.imagePathList.map(u => 
            u.startsWith('//') ? 'https:' + u : u
          );
        }
        if (fields.priceModule) {
          data.price = parseFloat(fields.priceModule.minPrice || fields.priceModule.formatedActivityPrice?.replace(/[^0-9.]/g, '')) || data.price;
          data.originalPrice = parseFloat(fields.priceModule.maxPrice || 0);
        }
      }
    }
    
    // Parse SKU/variation data
    if (skuData) {
      const propList = skuData.productSKUPropertyList || skuData.skuPropertyList || [];
      const priceList = skuData.skuPriceList || [];
      
      if (propList.length > 0) {
        data.variations.hasVariations = true;
        data.variations.axes = propList.map(prop => ({
          id: prop.skuPropertyId,
          name: prop.skuPropertyName,
          values: (prop.skuPropertyValues || []).map(v => ({
            id: v.propertyValueId || v.propertyValueIdLong,
            name: v.propertyValueDisplayName || v.propertyValueName,
            image: v.skuPropertyImagePath ? (v.skuPropertyImagePath.startsWith('//') ? 'https:' + v.skuPropertyImagePath : v.skuPropertyImagePath) : null
          }))
        }));
        
        // Build imagesByValue
        for (const axis of data.variations.axes) {
          for (const val of axis.values) {
            if (val.image) {
              data.variations.imagesByValue[val.name] = val.image;
            }
          }
        }
        
        // Build SKU map
        for (const sku of priceList) {
          const key = sku.skuAttr || sku.skuPropIds;
          data.variations.skuMap[key] = {
            price: parseFloat(sku.skuVal?.skuAmount?.value || sku.skuVal?.actSkuCalPrice || 0),
            originalPrice: parseFloat(sku.skuVal?.skuAmount?.value || 0),
            stock: sku.skuVal?.availQuantity || 0,
            skuId: sku.skuId
          };
        }
      }
    }
    
    // Specs/attributes
    const specRows = document.querySelectorAll('[class*="specification"] li, [class*="detail-extend"] li, .product-specs li');
    specRows.forEach(li => {
      const parts = li.textContent.split(':');
      if (parts.length === 2) {
        data.specs[parts[0].trim()] = parts[1].trim();
      }
    });
    
    return data;
  });
  
  console.log('=== SCRAPED PRODUCT DATA ===');
  console.log(`Title: ${productData.title}`);
  console.log(`Price: $${productData.price}`);
  console.log(`Images: ${productData.images.length}`);
  console.log(`Has Variations: ${productData.variations.hasVariations}`);
  if (productData.variations.hasVariations) {
    for (const axis of productData.variations.axes) {
      console.log(`  ${axis.name}: ${axis.values.map(v => v.name).join(', ')}`);
    }
    console.log(`  SKU entries: ${Object.keys(productData.variations.skuMap).length}`);
    console.log(`  Image mappings: ${Object.keys(productData.variations.imagesByValue).length}`);
  }
  console.log(`Specs: ${Object.keys(productData.specs).length}`);
  
  // Save the data
  fs.writeFileSync('product-data.json', JSON.stringify(productData, null, 2));
  console.log('\nSaved to product-data.json');
  
  browser.disconnect();
})().catch(e => console.error(e));
