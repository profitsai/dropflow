/**
 * AliExpress Product Page Scraper
 * Extracts product data using AliExpress internal APIs (primary)
 * with DOM-based fallback. Returns normalized productData compatible
 * with the eBay form filler.
 */

(function () {
  'use strict';

  // Guard against double-injection (manifest auto-inject + executeScript)
  if (window.__dropflow_ali_scraper_loaded) return;
  window.__dropflow_ali_scraper_loaded = true;

  // ============================
  // Product ID Extraction
  // ============================
  function extractProductId() {
    // /item/1234567890.html or /item/Some-Title/1234567890.html
    const match = window.location.pathname.match(/\/item\/(?:[^\/]+\/)?(\d+)\.html/);
    if (match) return match[1];

    // Fallback: check for productId in URL params
    const params = new URLSearchParams(window.location.search);
    const paramId = params.get('productId') || params.get('itemId');
    if (paramId) return paramId;

    return null;
  }

  // ============================
  // Title Extraction Helpers
  // ============================

  /**
   * Get the product title from the DOM (reliable — works regardless of API).
   * Tries specific selectors first, then falls back to document.title.
   */
  function getTitleFromDom() {
    // 1. AliExpress data-pl attribute (most reliable)
    const plTitle = document.querySelector('h1[data-pl="product-title"]');
    if (plTitle && plTitle.textContent.trim()) {
      return plTitle.textContent.trim();
    }

    // 2. Known class names
    const classSelectors = [
      '.product-title-text',
      '[class*="ProductTitle"]',
      '[class*="product-title"]',
      '[class*="pdp-info"] h1',
      '.pdp-body h1'
    ];
    for (const sel of classSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }

    // 3. Find an h1 that actually contains a product name (skip short/branding h1s)
    const allH1 = document.querySelectorAll('h1');
    for (const h1 of allH1) {
      const text = h1.textContent.trim();
      // Skip if it looks like branding ("AliExpress", "Welcome", etc.)
      if (text.length > 10 && !text.toLowerCase().startsWith('aliexpress') &&
          !text.toLowerCase().startsWith('welcome')) {
        return text;
      }
    }

    // 4. Last resort: document.title (always contains the product name)
    // Format is typically "Product Name | Aliexpress" or "Product Name - AliExpress"
    const pageTitle = document.title || '';
    const cleaned = pageTitle
      .replace(/\s*[\|–—-]\s*ali\s*express.*$/i, '')
      .replace(/\s*[\|–—-]\s*www\.aliexpress\.\w+.*$/i, '')
      .trim();
    if (cleaned.length > 5) {
      return cleaned;
    }

    return '';
  }

  // ============================
  // API-Based Scraping (Primary)
  // ============================
  /**
   * Fetch with a timeout (AbortController). Default 10 seconds.
   */
  function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  async function scrapeViaApi(productId) {
    console.log(`[DropFlow Ali] Fetching product details via API for ${productId}...`);

    // 1. Fetch product details from AliExpress internal API
    const detailUrl = new URL(`${window.location.origin}/aer-api/ae_item_detail_v2`);
    detailUrl.searchParams.set('itemId', productId);
    detailUrl.searchParams.set('locale', 'en_US');
    detailUrl.searchParams.set('currency', 'USD');
    detailUrl.searchParams.set('country', 'US');

    const detailResp = await fetchWithTimeout(detailUrl.toString(), {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Referer': window.location.href,
        'bx-v': '2.5.14'
      }
    }, 10000);

    if (!detailResp.ok) {
      throw new Error(`Detail API returned ${detailResp.status}`);
    }

    // This endpoint frequently returns HTML on modern pages (not JSON).
    // Parse via text first so we can classify expected fallback cases cleanly.
    const detailText = await detailResp.text();
    let detailData;
    try {
      detailData = JSON.parse(detailText);
    } catch (_) {
      const preview = (detailText || '').slice(0, 40).replace(/\s+/g, ' ');
      throw new Error(`API_NON_JSON:${preview}`);
    }
    console.log('[DropFlow Ali] Got product detail API response');

    // 2. Fetch description (separate API call)
    let descriptionText = '';
    try {
      const descUrl = new URL(`${window.location.origin}/aer-api/recommend/getDescComponent`);
      descUrl.searchParams.set('componentId', 'product-description');
      descUrl.searchParams.set('productId', productId);

      const descResp = await fetchWithTimeout(descUrl.toString(), {
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Referer': window.location.href
        }
      }, 10000);

      if (descResp.ok) {
        const descData = await descResp.json();
        // Extract text from HTML description, strip images
        const html = descData?.data?.description || descData?.description || '';
        if (html) {
          const temp = document.createElement('div');
          temp.innerHTML = html.replace(/<img[^>]*>/gi, '');
          descriptionText = temp.textContent.trim().substring(0, 2000);
        }
      }
    } catch (e) {
      console.warn('[DropFlow Ali] Description API failed:', e.message);
    }

    // 3. Parse into normalized productData
    return parseApiResponse(detailData, descriptionText, productId);
  }

  // ============================
  // Variation Parsing Helpers
  // ============================

  /**
   * Parse sku_attr string like "14:173#Red;5:361386#S" into a specifics object
   * using the axes array to map propertyId → axis name and valueId → value name.
   */
  function parseSkuAttr(skuAttr, axes) {
    const specifics = {};
    if (!skuAttr) return specifics;

    const parts = skuAttr.split(';');
    for (const part of parts) {
      // Format: propertyId:valueId#valueName or propertyId:valueId
      const match = part.match(/^(\d+):(\d+)(?:#(.+))?$/);
      if (!match) continue;

      const propertyId = parseInt(match[1]);
      const valueId = parseInt(match[2]);
      const valueName = match[3] || '';

      // Find the axis name from our axes array
      const axis = axes.find(a => a.propertyId === propertyId);
      if (axis) {
        // Prefer the name from the axes array (more reliable), fall back to sku_attr name
        const value = axis.values.find(v => v.valueId === valueId);
        specifics[axis.name] = value ? value.name : valueName;
      } else if (valueName) {
        specifics[`Property_${propertyId}`] = valueName;
      }
    }
    return specifics;
  }

  /**
   * Parse full variation data from ae_item_sku_info_dto.
   * Returns { hasVariations, axes, skus, imagesByValue }
   */
  function parseVariations(skuInfo) {
    const propertyList = skuInfo.sku_property_list || [];
    const priceList = skuInfo.sku_price_list || [];

    // Build axes from sku_property_list
    const axes = propertyList.map(prop => ({
      name: prop.sku_property_name || `Property_${prop.sku_property_id}`,
      propertyId: prop.sku_property_id,
      values: (prop.sku_property_value || []).map(val => ({
        valueId: val.property_value_id,
        name: val.property_value_definition_name || val.property_value_name || `${val.property_value_id}`,
        image: val.sku_image
          ? (val.sku_image.startsWith('//') ? 'https:' + val.sku_image : val.sku_image)
          : null
      }))
    }));

    // No axes or only 1 SKU = no real variations
    if (axes.length === 0 || priceList.length <= 1) {
      return { hasVariations: false, axes: [], skus: [], imagesByValue: {} };
    }

    // Build skus array from sku_price_list
    const skus = priceList.map(sku => {
      const specifics = parseSkuAttr(sku.sku_attr, axes);
      const price = parseFloat(sku.sku_price || sku.sku_bulk_order_price || 0);
      const stock = parseInt(sku.sku_stock || 0);

      // Find the image for this SKU's first visual axis value (usually Color)
      let image = null;
      for (const axis of axes) {
        const valueName = specifics[axis.name];
        if (valueName) {
          const axisValue = axis.values.find(v => v.name === valueName);
          if (axisValue?.image) {
            image = axisValue.image;
            break;
          }
        }
      }

      return {
        skuId: String(sku.sku_id || ''),
        price,
        ebayPrice: 0, // Set by service worker after markup
        stock,
        specifics,
        image
      };
    });

    // Build imagesByValue map — group images by "AxisName:ValueName"
    const imagesByValue = {};
    for (const axis of axes) {
      for (const val of axis.values) {
        if (val.image) {
          const key = `${axis.name}:${val.name}`;
          if (!imagesByValue[key]) imagesByValue[key] = [];
          imagesByValue[key].push(val.image);
        }
      }
    }

    console.log(`[DropFlow Ali] Variations: ${axes.map(a => `${a.name}(${a.values.length})`).join(' × ')} = ${skus.length} SKUs`);

    return {
      hasVariations: skus.length > 1,
      axes,
      skus,
      imagesByValue
    };
  }

  function parseApiResponse(data, descriptionText, productId) {
    // Navigate the nested API response structure defensively
    // Try multiple nesting levels — AliExpress API response can vary
    const root = data?.data || data?.result || data || {};
    const baseInfo = root.ae_item_base_info_dto || data?.ae_item_base_info_dto || {};
    const skuInfo = root.ae_item_sku_info_dto || data?.ae_item_sku_info_dto || {};
    const media = root.ae_multimedia_info_dto || data?.ae_multimedia_info_dto || {};
    const properties = root.ae_item_properties || data?.ae_item_properties || {};

    // Title: try multiple API field names, then fall back to DOM
    let title = (
      baseInfo.subject ||
      baseInfo.title ||
      baseInfo.product_title ||
      root.title ||
      root.subject ||
      root.product_title ||
      data?.title ||
      ''
    ).trim();

    // If API didn't give us a title, get it from the DOM
    if (!title) {
      console.warn('[DropFlow Ali] No title in API response, using DOM');
      title = getTitleFromDom();
    }

    // Images: semicolon-separated URLs, may need https: prefix
    const rawImageStr = media.image_urls || root.image_urls || '';
    const images = rawImageStr
      .split(';')
      .map(url => url.trim())
      .filter(url => url.length > 0)
      .map(url => url.startsWith('//') ? 'https:' + url : url)
      .slice(0, 12); // eBay max 12 images

    // If API didn't give images, try DOM
    if (images.length === 0) {
      getImagesFromDom().forEach(img => images.push(img));
    }

    // Variations: extract full SKU data (axes, per-SKU prices, stock, images)
    const variations = parseVariations(skuInfo);

    // Price: use minimum across all SKUs if variations exist, else first SKU
    const priceList = skuInfo.sku_price_list || root.sku_price_list || [];
    let price = 0;
    if (variations.hasVariations && variations.skus.length > 0) {
      // Show lowest price as the base/display price
      price = Math.min(...variations.skus.map(s => s.price).filter(p => p > 0));
    } else if (priceList.length > 0) {
      price = parseFloat(priceList[0].sku_price || priceList[0].sku_bulk_order_price || 0);
    }
    // If API didn't give price, try DOM
    if (!price) {
      price = getPriceFromDom();
    }

    // Specifications → bulletPoints (for eBay description generation)
    const propList = (properties.ae_item_property_list || root.ae_item_property_list || []);
    const bulletPoints = propList
      .filter(p => p.attr_name && p.attr_value)
      .map(p => `${p.attr_name}: ${p.attr_value}`);

    // Extract brand from product properties (attr_name is "Brand Name" or "Brand")
    let brand = '';
    for (const prop of propList) {
      if (prop.attr_name && /^brand\s*(name)?$/i.test(prop.attr_name.trim()) && prop.attr_value) {
        const val = prop.attr_value.trim();
        // Skip generic/placeholder values — eBay needs "Unbranded" for these
        if (val && !/^(no brand|n\/a|none|oem|generic|unbranded|no\s*name)$/i.test(val)) {
          brand = val;
        }
        break;
      }
    }

    // Store info
    const storeName = baseInfo.store_name || root.store_name || '';

    // Currency (from price info or default USD)
    const currency = (priceList.length > 0 && priceList[0].currency_code) || 'USD';

    return {
      asin: productId,            // Reused for eBay SKU/customLabel field
      title: title,
      price: price,
      currency: currency,
      images: images,
      description: descriptionText,
      bulletPoints: bulletPoints,
      brand: brand,               // Extracted from ae_item_property_list
      availability: { inStock: true, quantity: null, text: 'AliExpress' },
      seller: storeName,
      isFBA: false,               // Not applicable for AliExpress
      category: '',
      rating: null,
      reviewCount: 0,
      url: window.location.href,
      variations: variations       // Full variation data (axes, skus, imagesByValue)
    };
  }

  // ============================
  // Main World Bridge — DISABLED (CSP blocks inline scripts on AliExpress)
  // ============================
  // Main world data extraction (window.runParams, __NEXT_DATA__) is now handled
  // by the service worker via chrome.scripting.executeScript({ world: 'MAIN' }),
  // which bypasses CSP. This stub returns empty data so callers still work.
  function scrapeFromMainWorld() {
    return Promise.resolve({ price: 0, images: [], title: '' });
  }

  // ============================
  // Script Tag Extraction (inline scripts only)
  // ============================

  function scrapeFromScriptTags() {
    console.log('[DropFlow Ali] Trying inline script tag extraction...');
    let price = 0;
    let images = [];
    let title = '';
    let variations = null;

    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (text.length < 100) continue; // Skip tiny scripts

      // Look for price patterns in any inline script
      if (!price) {
        const pricePatterns = [
          /"actMinPrice"\s*:\s*"?([\d.]+)"?/,
          /"minPrice"\s*:\s*"?([\d.]+)"?/,
          /"maxPrice"\s*:\s*"?([\d.]+)"?/,
          /"formatedPrice"\s*:\s*"[^"]*?([\d.]+)/,
          /"price"\s*:\s*"?([\d.]+)"?/,
          /"salePrice"\s*:\s*"?([\d.]+)"?/,
          /"value"\s*:\s*"?([\d.]+)"?\s*,\s*"currency"/
        ];
        for (const pattern of pricePatterns) {
          const m = text.match(pattern);
          if (m) {
            const p = parseFloat(m[1]);
            if (p > 0 && p < 100000) { price = p; break; }
          }
        }
      }

      // Look for image lists
      if (images.length === 0) {
        const imgMatch = text.match(/"imagePathList"\s*:\s*\[([^\]]+)\]/);
        if (imgMatch) {
          const urls = imgMatch[1].match(/"((?:https?:)?\/\/[^"]+)"/g);
          if (urls) {
            images = urls.map(u => {
              u = u.replace(/"/g, '');
              return u.startsWith('//') ? 'https:' + u : u;
            }).slice(0, 12);
          }
        }
      }

      // Look for title
      if (!title) {
        const titleMatch = text.match(/"subject"\s*:\s*"([^"]{10,200})"/);
        if (titleMatch) title = titleMatch[1];
      }

      // Try to extract runParams JSON for variation data
      if (!variations) {
        const runParamsMatch = text.match(/window\.runParams\s*=\s*\{/);
        if (runParamsMatch) {
          try {
            // Find the JSON object — start from the { after window.runParams =
            const startIdx = text.indexOf('{', runParamsMatch.index);
            if (startIdx >= 0) {
              // Try to find matching closing brace (simple bracket counting)
              let depth = 0, endIdx = startIdx;
              for (let i = startIdx; i < text.length && i < startIdx + 500000; i++) {
                if (text[i] === '{') depth++;
                else if (text[i] === '}') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
              }
              if (endIdx > startIdx) {
                const parsed = JSON.parse(text.substring(startIdx, endIdx));
                // Check all known paths for SKU module
                const skuModule = parsed?.data?.skuModule || parsed?.data?.skuComponent
                  || parsed?.data?.skuBase || parsed?.data?.skuInfo
                  || parsed?.skuModule || parsed?.skuComponent;
                if (skuModule) {
                  variations = extractVariationsFromModule(skuModule);
                }
                // Deep search if no direct match
                if (!variations && parsed) {
                  const deepFind = (obj, d) => {
                    if (!obj || d > 6 || typeof obj !== 'object') return null;
                    if (obj.productSKUPropertyList && obj.skuPriceList) return obj;
                    if (obj.sku_property_list && obj.sku_price_list) return obj;
                    if (obj.skuPropertyList && obj.skuPriceList) return obj;
                    for (const v of Object.values(obj)) {
                      if (typeof v === 'object' && v !== null) {
                        const r = deepFind(v, d + 1);
                        if (r) return r;
                      }
                    }
                    return null;
                  };
                  const found = deepFind(parsed, 0);
                  if (found) variations = extractVariationsFromModule(found);
                }
              }
            }
          } catch (_) { /* JSON parse error — runParams may not be pure JSON */ }
        }
      }

      // Fallback: extract skuModule sub-object directly from script text
      // (handles case where full runParams isn't valid JSON but sub-objects are)
      if (!variations) {
        const subPatterns = [
          /"skuModule"\s*:\s*\{/,
          /"skuComponent"\s*:\s*\{/,
          /"skuBase"\s*:\s*\{/,
          /"skuInfo"\s*:\s*\{/
        ];
        for (const pattern of subPatterns) {
          const m = text.match(pattern);
          if (!m) continue;
          try {
            const braceStart = text.indexOf('{', m.index + m[0].length - 1);
            if (braceStart < 0) continue;
            let d = 0, braceEnd = braceStart;
            for (let i = braceStart; i < text.length && i < braceStart + 300000; i++) {
              if (text[i] === '{') d++;
              else if (text[i] === '}') { d--; if (d === 0) { braceEnd = i + 1; break; } }
            }
            if (braceEnd <= braceStart) continue;
            const subObj = JSON.parse(text.substring(braceStart, braceEnd));
            if (subObj) {
              variations = extractVariationsFromModule(subObj);
              if (variations) {
                console.log(`[DropFlow Ali] Found variations via script text sub-object extraction`);
                break;
              }
            }
          } catch (_) { /* Sub-object also not valid JSON */ }
        }
      }
    }

    // Also check __NEXT_DATA__ script tag by ID
    const nextScript = document.getElementById('__NEXT_DATA__');
    if (nextScript) {
      try {
        const nextData = JSON.parse(nextScript.textContent);
        const drill = (obj, depth = 0) => {
          if (!obj || depth > 8 || typeof obj !== 'object') return;
          if (obj.minPrice && !price) { const p = parseFloat(obj.minPrice); if (p > 0) price = p; }
          if (obj.actMinPrice && !price) { const p = parseFloat(obj.actMinPrice); if (p > 0) price = p; }
          if (Array.isArray(obj.imagePathList) && images.length === 0) {
            images = obj.imagePathList
              .map(u => u.startsWith('//') ? 'https:' + u : u)
              .slice(0, 12);
          }
          if (obj.subject && !title) title = obj.subject;
          // Extract variation data from __NEXT_DATA__
          if (!variations && (obj.skuModule || obj.skuComponent)) {
            const skuMod = obj.skuModule || obj.skuComponent;
            variations = extractVariationsFromModule(skuMod);
          }
          // Also check for API naming convention (sku_property_list + sku_price_list)
          if (!variations && obj.sku_property_list && obj.sku_price_list) {
            variations = extractVariationsFromModule(obj);
          }
          // Check for productSKUPropertyList directly (sometimes not wrapped in skuModule)
          if (!variations && obj.productSKUPropertyList && obj.skuPriceList) {
            variations = extractVariationsFromModule(obj);
          }
          for (const val of Object.values(obj)) {
            if (typeof val === 'object' && val !== null) drill(val, depth + 1);
          }
        };
        drill(nextData);
      } catch (e) { /* parse error */ }
    }

    console.log(`[DropFlow Ali] Script tag extraction: price=$${price}, images=${images.length}, title="${title.substring(0, 30)}", variations=${variations?.hasVariations || false}`);
    if (!variations) {
      const nextScriptExists = !!document.getElementById('__NEXT_DATA__');
      const inlineScriptCount = document.querySelectorAll('script:not([src])').length;
      const hasRunParams = Array.from(document.querySelectorAll('script:not([src])')).some(s => /window\.runParams/.test(s.textContent || ''));
      console.info(`[DropFlow Ali] Script-tag variations not found (will try MAIN-world + DOM fallbacks). __NEXT_DATA__=${nextScriptExists}, inlineScripts=${inlineScriptCount}, hasRunParams=${hasRunParams}`);
      // Persist diagnostic for debugging
      try {
        chrome.storage.local.set({
          dropflow_variation_scripttag_diag: {
            timestamp: new Date().toISOString(),
            nextDataExists: nextScriptExists,
            inlineScriptCount,
            hasRunParams,
            url: window.location.href
          }
        });
      } catch (_) {}
    }
    return { price, images, title, variations };
  }

  /**
   * Extract variation data from a skuModule/skuComponent object.
   * Handles both classic (productSKUPropertyList/skuPriceList) and API
   * (sku_property_list/sku_price_list) naming conventions.
   */
  function extractVariationsFromModule(skuModule) {
    if (!skuModule) return null;

    const normalizeAxisName = (name, fallbackId) => {
      let n = String(name || '').replace(/\s+/g, ' ').trim();
      if (n.includes(':')) n = n.split(':')[0].trim();
      n = n.replace(/\s*\(\d+\)\s*$/, '').trim();
      return n || `Property_${fallbackId || 0}`;
    };

    const propertyList = skuModule.productSKUPropertyList
      || skuModule.skuPropertyList
      || skuModule.sku_property_list
      || skuModule.propertyList
      || [];

    const priceList = skuModule.skuPriceList
      || skuModule.sku_price_list
      || skuModule.priceList
      || [];

    if (propertyList.length === 0 || priceList.length <= 1) return null;

    // Build axes
    let axes = propertyList.map(prop => {
      const values = (prop.skuPropertyValues || prop.sku_property_value || []).map(val => {
        let img = val.skuPropertyImagePath || val.skuPropertyTips || val.sku_image || null;
        if (img && img.startsWith('//')) img = 'https:' + img;
        return {
          valueId: val.propertyValueId || val.property_value_id || 0,
          name: val.propertyValueDefinitionName || val.propertyValueDisplayName
            || val.property_value_definition_name || val.property_value_name || '',
          image: img
        };
      });
      return {
        name: normalizeAxisName(
          prop.skuPropertyName || prop.sku_property_name,
          prop.skuPropertyId || prop.sku_property_id
        ),
        propertyId: prop.skuPropertyId || prop.sku_property_id || 0,
        values
      };
    });

    // Remove duplicate axis names and keep the richer one
    const byName = new Map();
    for (const axis of axes) {
      const key = (axis.name || '').toLowerCase();
      const prev = byName.get(key);
      if (!prev || (axis.values?.length || 0) > (prev.values?.length || 0)) byName.set(key, axis);
    }
    axes = Array.from(byName.values());

    if (axes.length > 2) {
      const score = (a) =>
        (/(color|colour|size|style|material|pattern|type|model)/i.test(a.name) ? 100 : 0) + (a.values?.length || 0);
      axes = axes.sort((a, b) => score(b) - score(a)).slice(0, 2);
    }

    // Build SKUs
    const skus = priceList.map(sku => {
      const specifics = parseSkuAttr(sku.skuAttr || sku.sku_attr || '', axes);

      let price = 0;
      if (sku.skuVal) {
        price = parseFloat(
          sku.skuVal.skuAmount?.value || sku.skuVal.skuActivityAmount?.value ||
          sku.skuVal.skuCalPrice || sku.skuVal.actSkuCalPrice || 0
        );
      }
      if (!price) price = parseFloat(sku.sku_price || sku.sku_bulk_order_price || 0);

      // Default to 5 if stock data unavailable (product is listed, so it's in stock)
      const rawStock = sku.skuVal?.availQuantity ?? sku.sku_stock ?? null;
      const stock = (rawStock !== null && parseInt(rawStock) > 0) ? parseInt(rawStock) : 5;

      // Find image from first visual axis
      let image = null;
      for (const axis of axes) {
        const vName = specifics[axis.name];
        if (vName) {
          const axisVal = axis.values.find(v => v.name === vName);
          if (axisVal?.image) { image = axisVal.image; break; }
        }
      }

      return {
        skuId: String(sku.skuId || sku.sku_id || ''),
        price,
        ebayPrice: 0,
        stock,
        specifics,
        image
      };
    });

    // Build imagesByValue
    const imagesByValue = {};
    for (const axis of axes) {
      for (const val of axis.values) {
        if (val.image) {
          const key = `${axis.name}:${val.name}`;
          if (!imagesByValue[key]) imagesByValue[key] = [];
          imagesByValue[key].push(val.image);
        }
      }
    }

    return {
      hasVariations: skus.length > 1,
      axes,
      skus,
      imagesByValue
    };
  }

  // ============================
  // DOM-Based Variation Scraping
  // ============================

  /**
   * Extract variation data directly from the visible DOM elements.
   * Last-resort fallback when all data extraction (API, script tags, MAIN world) fails.
   * Finds variation selector groups (Color, Size, etc.) and builds axes + synthetic SKUs.
   */
  function scrapeVariationsFromDom() {
    console.log('[DropFlow Ali] scrapeVariationsFromDom() called');
    let axes = [];

    const normalizeAxisName = (name) => {
      let n = String(name || '').replace(/\s+/g, ' ').trim();
      // Some labels include currently selected value, e.g. "Color: Black"
      if (n.includes(':')) n = n.split(':')[0].trim();
      n = n.replace(/\s*\(\d+\)\s*$/, '').trim();
      return n;
    };

    const looksLikeAxisName = (name, values = []) => {
      if (!name) return false;
      if (name.length < 2 || name.length > 28) return false;
      if (/^\d+$/.test(name)) return false;

      // Reject labels that look like concatenated size values (e.g. "XSSMXLXL")
      if (!/\s/.test(name) && /^[A-Za-z0-9]+$/.test(name) && name.length >= 7) {
        const upper = name.toUpperCase();
        const compactVals = values
          .map(v => (v.name || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
          .filter(Boolean);
        const allContained = compactVals.length >= 2 && compactVals.every(v => upper.includes(v));
        if (allContained) return false;
      }

      // Reject if axis name is exactly one of its values
      if (values.some(v => (v.name || '').toLowerCase() === name.toLowerCase())) return false;
      return true;
    };

    // AliExpress SKU selectors — try multiple known structures.
    // Prefer specific "property" containers that hold a single axis (Color or Size).
    // Avoid over-broad matches like [class*="sku-item"] which match nested value elements.
    let skuContainers = document.querySelectorAll(
      '[class*="sku-item--property"], [class*="sku-property"], [data-pl="product-sku"] > div, ' +
      '[class*="SkuProperty"], [class*="skuProperty"], [class*="sku--property"]'
    );
    console.log(`[DropFlow Ali] scrapeVariationsFromDom: ${skuContainers.length} sku containers found`);

    // Broader fallback if no specific containers found
    if (skuContainers.length === 0) {
      // Look for containers that have multiple button/option children with images or short text
      const candidates = document.querySelectorAll('div[class], section[class]');
      const found = [];
      for (const el of candidates) {
        const buttons = el.querySelectorAll('button, [role="option"], [class*="item"]');
        if (buttons.length >= 2 && buttons.length <= 50) {
          // Check if sibling or parent has a label-like element
          const parent = el.parentElement;
          if (parent) {
            const label = parent.querySelector('span, div, label');
            if (label) {
              const labelText = label.textContent.trim();
              if (/^(colou?r|size|style|type|model|pattern|material|ships?\s*from)/i.test(labelText)) {
                found.push(parent);
              }
            }
          }
        }
      }
      skuContainers = found.length > 0 ? found : skuContainers;
    }

    for (const container of skuContainers) {
      // Find axis name
      const titleEl = container.querySelector(
        '[class*="title"], [class*="name"], [class*="label"], ' +
        '[class*="Title"], [class*="Name"], [class*="head"]'
      );
      let axisName = '';
      if (titleEl) {
        axisName = normalizeAxisName(titleEl.textContent);
        if (axisName.length > 30 || axisName.length < 2) continue;
      }
      if (!axisName) {
        // Try first child text node
        for (const child of container.children) {
          const t = child.textContent.trim();
          if (t.length >= 2 && t.length <= 25 && !/^[\d.]+$/.test(t)) {
            axisName = normalizeAxisName(t);
            break;
          }
        }
      }
      if (!axisName) continue;
      // Skip "Ships From" or "Quantity" — not real variations
      if (/^(ships?\s*from|quantity|qty)/i.test(axisName)) continue;

      // Find values — prefer data-sku-col elements (modern AliExpress) for clean data
      let valueEls = container.querySelectorAll('[data-sku-col]');
      if (valueEls.length === 0) {
        valueEls = container.querySelectorAll(
          'button, [class*="value"], [class*="item"]:not([class*="title"]):not([class*="property"]):not([class*="wrap"]), li, [role="option"], ' +
          '[class*="Value"], [class*="Item"]:not([class*="Title"]):not([class*="Property"]), a[class]'
        );
      }
      const values = [];
      const seen = new Set();

      for (const valEl of valueEls) {
        let valName = '';
        // Try image alt text (for color swatches)
        const img = valEl.querySelector('img');
        if (img) {
          valName = img.getAttribute('alt') || img.getAttribute('title') || '';
        }
        // Try title attribute (most reliable for data-sku-col elements)
        if (!valName) {
          valName = valEl.getAttribute('title') || valEl.getAttribute('aria-label') || '';
        }
        // Try text content (skip if too long — probably a container)
        if (!valName) {
          const directText = valEl.textContent.trim();
          if (directText.length <= 30) valName = directText;
        }

        valName = valName.replace(/[:\s]+$/, '').trim();
        if (!valName || valName.length > 40 || seen.has(valName)) continue;
        if (/^\d+$/.test(valName) && valName.length > 5) continue; // Skip numeric IDs
        seen.add(valName);

        let valImage = img ? (img.getAttribute('src') || '') : '';
        if (valImage && valImage.startsWith('//')) valImage = 'https:' + valImage;

        values.push({
          valueId: values.length,
          name: valName,
          image: valImage || null
        });
      }

      console.log(`[DropFlow Ali] scrapeVariationsFromDom: axis="${axisName}", values=${values.length}, looksLike=${looksLikeAxisName(axisName, values)}`);
      if (values.length >= 2 && looksLikeAxisName(axisName, values)) {
        axes.push({ name: axisName, propertyId: axes.length, values });
      }
    }

    console.log(`[DropFlow Ali] scrapeVariationsFromDom: ${axes.length} axes after parsing`);
    if (axes.length === 0) return null;

    // Deduplicate axis names and keep best candidate for each name
    const byName = new Map();
    for (const axis of axes) {
      const key = axis.name.toLowerCase();
      const prev = byName.get(key);
      if (!prev || axis.values.length > prev.values.length) byName.set(key, axis);
    }
    axes = Array.from(byName.values());

    // eBay supports up to 2 variation dimensions for most categories.
    if (axes.length > 2) {
      const score = (a) =>
        (/(color|colour|size|style|material|pattern|type|model)/i.test(a.name) ? 100 : 0) + a.values.length;
      axes = axes.sort((a, b) => score(b) - score(a)).slice(0, 2);
    }

    // Get displayed price as default for all SKUs
    const displayPrice = getPriceFromDom();

    // Build cartesian product of all axis values
    let combos = [{}];
    for (const axis of axes) {
      const newCombos = [];
      for (const combo of combos) {
        for (const val of axis.values) {
          newCombos.push({ ...combo, [axis.name]: val.name });
        }
      }
      combos = newCombos;
    }

    const skus = combos.map((specifics, idx) => {
      let image = null;
      for (const axis of axes) {
        const vName = specifics[axis.name];
        const axVal = axis.values.find(v => v.name === vName);
        if (axVal?.image) { image = axVal.image; break; }
      }
      return {
        skuId: `dom_${idx}`,
        price: displayPrice,
        ebayPrice: 0,
        stock: 5,
        specifics,
        image
      };
    });

    if (skus.length <= 1) return null;

    // Build imagesByValue
    const imagesByValue = {};
    for (const axis of axes) {
      for (const val of axis.values) {
        if (val.image) {
          const key = `${axis.name}:${val.name}`;
          imagesByValue[key] = [val.image];
        }
      }
    }

    console.log(`[DropFlow Ali] DOM variations: ${axes.map(a => `${a.name}(${a.values.length})`).join(' × ')} = ${skus.length} SKUs`);

    return {
      hasVariations: true,
      axes,
      skus,
      imagesByValue,
      _source: 'dom'
    };
  }

  // ============================
  // DOM-Based Extraction Helpers
  // ============================

  function getImagesFromDom() {
    const images = [];
    // Try specific selectors first — keep original src URLs (don't strip size suffixes,
    // they're needed for the CDN to return the right resolution)
    document.querySelectorAll('.slider--img--item img, [class*="image-view"] img, .product-image img').forEach(img => {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (src && !images.includes(src)) {
        images.push(src.startsWith('//') ? 'https:' + src : src);
      }
    });
    // Fallback: main product image
    if (images.length === 0) {
      const mainImg = document.querySelector('.magnifier--image--item img, .product-img img');
      if (mainImg) {
        const src = mainImg.getAttribute('src') || '';
        if (src) images.push(src.startsWith('//') ? 'https:' + src : src);
      }
    }
    // Broad fallback: find ALL alicdn/aliexpress-media images on the page that are product-sized
    if (images.length === 0) {
      document.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if ((src.includes('alicdn.com') || src.includes('aliexpress-media.com')) &&
            (img.naturalWidth > 200 || img.width > 200 || src.includes('_640x640') || src.includes('_800x800'))) {
          const normalized = src.startsWith('//') ? 'https:' + src : src;
          if (!images.includes(normalized)) images.push(normalized);
        }
      });
    }
    return images.slice(0, 12);
  }

  function getPriceFromDom() {
    // Try many selectors — AliExpress changes their layout frequently
    const selectors = [
      '.product-price-current',
      '[class*="price-current"]',
      '.uniform-banner-box-price',
      '[data-pl="product-price"] span',
      '[class*="ProductPrice"] span',
      '[class*="product-price"] span',
      '.es--wrap--erdmPRe .es--char--ygDsRFW',
      '[class*="snow-price"]',
      '[class*="Price-module"]',
      '.pdp-price',
      '.pdp-comp-price-current'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        const match = text.match(/[\d]+[.,]?\d*/);
        if (match) {
          const price = parseFloat(match[0].replace(/,/g, ''));
          if (price > 0) return price;
        }
      }
    }

    // Broad fallback: scan all visible elements for price-like text (US $X.XX, €X.XX, etc.)
    // Only check elements in the upper half of the page (product info area)
    const allElements = document.querySelectorAll('span, div, p, strong, b');
    for (const el of allElements) {
      if (el.children.length > 3) continue; // Skip containers with many children
      if (el.offsetTop > 1200) continue;    // Only look in upper page area
      const text = el.textContent.trim();
      // Match patterns like "US $4.99", "$12.50", "€4,99", "£19.99"
      const priceMatch = text.match(/(?:US\s*)?[$€£¥]\s*([\d]+[.,]?\d*)/);
      if (priceMatch) {
        const price = parseFloat(priceMatch[1].replace(/,/g, ''));
        if (price > 0.01 && price < 100000 && text.length < 30) return price;
      }
    }
    return 0;
  }

  function getBulletPointsFromDom() {
    const bulletPoints = [];
    document.querySelectorAll('.specification--list li, [class*="specification"] li, .product-specs li, [data-pl="product-specs"] li').forEach(li => {
      const name = li.querySelector('.specification--title, [class*="spec-name"], dt, span:first-child');
      const value = li.querySelector('.specification--desc, [class*="spec-value"], dd, span:last-child');
      if (name && value && name !== value) {
        bulletPoints.push(`${name.textContent.trim()}: ${value.textContent.trim()}`);
      }
    });
    return bulletPoints;
  }

  // ============================
  // DOM-Based Scraping (Full Fallback)
  // ============================
  function scrapeViaDom() {
    console.log('[DropFlow Ali] Using DOM fallback scraping...');

    const productId = extractProductId() || '';
    const title = getTitleFromDom();
    const price = getPriceFromDom();
    const images = getImagesFromDom();
    const bulletPoints = getBulletPointsFromDom();

    // Extract brand from DOM-scraped bullet points
    let brand = '';
    for (const bp of bulletPoints) {
      const m = bp.match(/^brand\s*(name)?\s*:\s*(.+)/i);
      if (m) {
        const val = m[2].trim();
        if (val && !/^(no brand|n\/a|none|oem|generic|unbranded|no\s*name)$/i.test(val)) {
          brand = val;
        }
        break;
      }
    }

    // Description (usually loaded dynamically, may be empty)
    let description = '';
    const descSelectors = [
      '.product-description',
      '[data-pl="product-description"]',
      '[class*="product-description"]',
      '[class*="ProductDescription"]',
      '.detail-desc-decorate-richtext',
      '[class*="desc-content"]'
    ];
    for (const sel of descSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        // Skip short UI strings like "DescriptionReport Item"
        if (text.length > 50) {
          description = text.substring(0, 2000);
          break;
        }
      }
    }

    return {
      asin: productId,
      title: title,
      price: price,
      currency: 'USD',
      images: images,
      description: description,
      bulletPoints: bulletPoints,
      brand: brand,
      availability: { inStock: true, quantity: null, text: 'AliExpress' },
      seller: '',
      isFBA: false,
      category: '',
      rating: null,
      reviewCount: 0,
      url: window.location.href,
      variations: null              // No variation data from DOM fallback
    };
  }

  // ============================
  // Image Pre-Download (bypass CDN anti-hotlinking)
  // ============================

  /**
   * Pre-download images as base64 data URLs from the content script context.
   * The content script runs on the AliExpress page, so it has the correct
   * cookies and origin to access alicdn.com images without being blocked.
   * The service worker's fetch() fails for these URLs due to CDN anti-hotlinking.
   */
  async function preDownloadImages(imageUrls, maxImages = 8) {
    const urls = imageUrls.slice(0, maxImages);
    const results = [];

    console.log(`[DropFlow Ali] Pre-downloading ${urls.length} images from content script context...`);

    for (let i = 0; i < urls.length; i++) {
      try {
        const url = urls[i].startsWith('//') ? 'https:' + urls[i] : urls[i];

        const response = await fetch(url, {
          credentials: 'include',
          referrer: window.location.href,
          referrerPolicy: 'no-referrer-when-downgrade'
        });

        if (!response.ok) {
          console.warn(`[DropFlow Ali] Image ${i + 1} HTTP ${response.status}: ${url.substring(0, 60)}`);
          results.push(null);
          continue;
        }

        const blob = await response.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });

        results.push(dataUrl);
        console.log(`[DropFlow Ali] Image ${i + 1}/${urls.length} pre-downloaded (${Math.round(dataUrl.length / 1024)}KB)`);
      } catch (e) {
        console.warn(`[DropFlow Ali] Image ${i + 1} download failed: ${e.message}`);
        results.push(null);
      }
    }

    const successCount = results.filter(r => r !== null).length;
    console.log(`[DropFlow Ali] Pre-download complete: ${successCount}/${urls.length} images`);
    return results;
  }

  // ============================
  // Main Scrape Function
  // ============================
  async function scrapeProduct() {
    const productId = extractProductId();
    if (!productId) {
      return { error: 'Could not extract AliExpress product ID from URL' };
    }

    // --- Phase 1: Collect data from all sources in parallel ---
    // Main world bridge (reads window.runParams, __NEXT_DATA__ from page's JS context)
    const mainWorldData = await scrapeFromMainWorld();
    // Inline script tags (reads <script> tag contents from DOM)
    const scriptTagData = scrapeFromScriptTags();

    // Merge the two script-based sources (main world is more reliable)
    const scriptData = {
      price: mainWorldData.price || scriptTagData.price,
      images: mainWorldData.images.length > 0 ? mainWorldData.images : scriptTagData.images,
      title: mainWorldData.title || scriptTagData.title,
      variations: scriptTagData.variations || null
    };

    let data = null;

    // --- Phase 2: Try API ---
    try {
      data = await scrapeViaApi(productId);
      console.log(`[DropFlow Ali] API scrape: "${data.title}" @ $${data.price}, ${data.images.length} images`);
    } catch (apiError) {
      const msg = apiError?.message || '';
      if (msg.startsWith('API_NON_JSON:')) {
        console.info('[DropFlow Ali] API returned non-JSON (expected on some AliExpress pages), using fallbacks');
      } else {
        console.warn('[DropFlow Ali] API scraping failed:', msg);
      }
    }

    // --- Phase 3: Try DOM if API failed ---
    if (!data) {
      try {
        data = scrapeViaDom();
        console.log(`[DropFlow Ali] DOM scrape: "${data.title}" @ $${data.price}, ${data.images.length} images`);
      } catch (domError) {
        console.warn('[DropFlow Ali] DOM scraping failed:', domError.message);
      }
    }

    // --- Phase 4: Build from script data alone if both API and DOM failed ---
    if (!data) {
      if (scriptData.price > 0 || scriptData.images.length > 0) {
        data = {
          asin: productId,
          title: scriptData.title || getTitleFromDom(),
          price: scriptData.price,
          currency: 'USD',
          images: scriptData.images,
          description: '',
          bulletPoints: [],
          brand: '',
          availability: { inStock: true, quantity: null, text: 'AliExpress' },
          seller: '',
          isFBA: false,
          category: '',
          rating: null,
          reviewCount: 0,
          url: window.location.href,
          variations: scriptData.variations || null
        };
        console.log(`[DropFlow Ali] Script-only scrape: "$${data.price}", ${data.images.length} images, variations=${!!scriptData.variations?.hasVariations}`);
      } else {
        return { error: 'All scraping methods failed (API, DOM, scripts)' };
      }
    }

    // --- Phase 5: Fill gaps — if API/DOM missed price or images, use script data ---
    if (!data.price && scriptData.price > 0) {
      data.price = scriptData.price;
      console.log(`[DropFlow Ali] Price supplemented from scripts: $${data.price}`);
    }
    if ((!data.images || data.images.length === 0) && scriptData.images.length > 0) {
      data.images = scriptData.images;
      console.log(`[DropFlow Ali] Images supplemented from scripts: ${data.images.length}`);
    }
    if (!data.title && scriptData.title) {
      data.title = scriptData.title;
    }
    // Supplement variation data from script tags if API didn't provide it
    if (!data.variations?.hasVariations && scriptData.variations?.hasVariations) {
      data.variations = scriptData.variations;
      console.log(`[DropFlow Ali] Variations supplemented from scripts: ${scriptData.variations.skus.length} SKUs`);
      // Update base price to min across all SKUs
      const minSkuPrice = Math.min(...scriptData.variations.skus.map(s => s.price).filter(p => p > 0));
      if (minSkuPrice > 0) {
        data.price = minSkuPrice;
      }
    }

    // Last resort: scrape variation data from visible DOM elements
    console.log(`[DropFlow Ali] Pre-DOM-variation check: data.variations=${JSON.stringify(data.variations?.hasVariations)}`);
    if (!data.variations?.hasVariations) {
      try {
        console.log('[DropFlow Ali] Calling scrapeVariationsFromDom (last resort)...');
        const domVariations = scrapeVariationsFromDom();
        if (domVariations?.hasVariations) {
          data.variations = domVariations;
          console.log(`[DropFlow Ali] Variations from DOM: ${domVariations.axes.map(a => `${a.name}(${a.values.length})`).join(' × ')} = ${domVariations.skus.length} SKUs`);
        }
      } catch (e) {
        console.warn(`[DropFlow Ali] DOM variation scraping failed: ${e.message}`);
      }
    }

    // Ensure image URLs request at least 640x640 from CDN.
    // AliExpress CDN returns 100x100 thumbnails for base URLs (no suffix).
    // eBay requires >= 500px wide. Use _640x640 (a known supported CDN size).
    if (data.images && data.images.length > 0) {
      data.images = data.images.map(url => {
        let u = url.startsWith('//') ? 'https:' + url : url;
        u = u.replace(/_+$/, ''); // Remove trailing underscores

        // Already has a 640+ size suffix? Keep it.
        if (/_([6-9]\d{2}|1\d{3})x/.test(u)) return u;

        // Has a small size suffix (e.g. _100x100, _220x220)? Replace with 640x640
        if (/\.\w{3,4}_\d+x\d+[^/]*$/.test(u)) {
          u = u.replace(/(\.\w{3,4})_\d+x\d+[^/]*$/, '$1_640x640.jpg');
          return u;
        }

        // No size suffix at all — append _640x640.jpg
        if (/\.\w{3,4}$/.test(u)) {
          return u + '_640x640.jpg';
        }

        return u;
      });
      console.log(`[DropFlow Ali] Image URLs set to 640x640 (sample: ${data.images[0]?.substring(0, 100)})`);
    }

    console.log(`[DropFlow Ali] Final: "${data.title?.substring(0, 40)}" @ $${data.price}, ${data.images?.length || 0} images`);

    // Phase 6 (image pre-download) is handled by the service worker via
    // chrome.scripting.executeScript({ world: 'MAIN' }). Content script fetch()
    // fails due to CSP/CORS restrictions on AliExpress pages.

    return data;
  }

  // ============================
  // Message Listener (for bulk lister)
  // ============================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SCRAPE_ALIEXPRESS_PRODUCT') {
      console.log('[DropFlow Ali] Received SCRAPE_ALIEXPRESS_PRODUCT message');
      scrapeProduct().then(data => {
        console.log('[DropFlow Ali] Scrape complete:', data?.title || data?.error || 'unknown');
        sendResponse(data);
      }).catch(error => {
        console.error('[DropFlow Ali] scrapeProduct() threw:', error);
        sendResponse({ error: error.message || 'Unknown scrape error' });
      });
      return true; // Async response
    }
  });

  console.log('[DropFlow Ali] AliExpress product scraper loaded on', window.location.href);
})();
