/**
 * eBay Listing Form Filler
 * Programmatically fills eBay's listing creation form with product data.
 * This is the most complex content script - eBay's form is React-based
 * and requires special handling for input events.
 */

(function () {
  'use strict';

  // Deduplication guard: prevent double-execution when both manifest injection
  // and force-injection from service worker fire on the same page.
  // On full page navigations this flag resets (new JS context).
  if (window.__dropflow_form_filler_loaded) {
    // Allow re-injection if previous run was > 30s ago (likely page transitioned back from builder)
    if (window.__dropflow_form_filler_loadedAt && (Date.now() - window.__dropflow_form_filler_loadedAt) > 30000) {
      console.log('[DropFlow] Re-injecting form-filler (previous load was ' + ((Date.now() - window.__dropflow_form_filler_loadedAt) / 1000).toFixed(0) + 's ago)');
      // Reset locks
      window.__dropflowFillFormLock = null;
    } else {
      console.log('[DropFlow] form-filler already loaded, skipping duplicate');
      return;
    }
  }
  window.__dropflow_form_filler_loaded = true;
  window.__dropflow_form_filler_loadedAt = Date.now();

  const IS_TOP_FRAME = (() => {
    try { return window.top === window; } catch (_) { return false; }
  })();

  // Guard to prevent variation editor re-entry loops right after builder "Save and close".
  let __dropflowVariationSaveCloseTs = 0;

  /**
   * Wrapper for chrome.runtime.sendMessage that actually times out.
   * Promise.race with setTimeout does NOT work when sendMessage hangs the event loop.
   * This uses the Promise constructor pattern where the timer is set up BEFORE the call.
   * @param {object} msg - Message to send
   * @param {number} timeoutMs - Timeout in milliseconds (default 10000)
   * @returns {Promise<any>} Response or null on timeout/error
   */
  function sendMessageSafe(msg, timeoutMs = 10000) {
    return new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          console.warn(`[DropFlow] sendMessageSafe timeout (${timeoutMs}ms) for ${msg?.type || 'unknown'}`);
          resolve(null);
        }
      }, timeoutMs);
      try {
        chrome.runtime.sendMessage(msg).then(resp => {
          if (!settled) { settled = true; clearTimeout(timer); resolve(resp); }
        }).catch(err => {
          if (!settled) { settled = true; clearTimeout(timer); console.warn(`[DropFlow] sendMessageSafe error for ${msg?.type}:`, err?.message); resolve(null); }
        });
      } catch (e) {
        if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
      }
    });
  }

  /**
   * Find the real MSKU bulkedit iframe by checking the actual hostname of the src URL,
   * not just a substring match. This avoids false positives where a picupload iframe
   * has "bulkedit.ebay.com.au" as a query parameter in its URL.
   */
  function findMskuBulkeditIframe() {
    const iframes = document.querySelectorAll('iframe[src]');
    for (const iframe of iframes) {
      try {
        const url = new URL(iframe.src, window.location.href);
        if (/(^|\.)bulkedit\.ebay\./i.test(url.hostname) || /\/msku(?:\/|$|\?)/i.test(url.pathname)) {
          return iframe;
        }
      } catch (_) {}
    }
    return null;
  }

  /**
   * Full async input commit â€" simulates a real user clicking into a field,
   * typing a value, and clicking out. This triggers React's focus/blur handlers
   * which are required for eBay to register the value in its internal state.
   */
  async function commitInputValue(element, value) {
    if (!element) return false;
    const ownerDoc = element.ownerDocument || document;
    const ownerView = ownerDoc.defaultView || window;
    const FocusEvt = ownerView.FocusEvent || FocusEvent;

    // 1. Simulate clicking INTO the field
    simulateClick(element);
    element.focus();
    element.dispatchEvent(new FocusEvt('focusin', { bubbles: true }));
    element.dispatchEvent(new FocusEvt('focus', { bubbles: false }));
    await sleep(150);

    // 2. Select any existing text
    if (element.select) element.select();
    await sleep(100);

    // 3. Set value via native setter (bypass React controlled component)
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      ownerView.HTMLInputElement.prototype, 'value'
    )?.set;
    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
      ownerView.HTMLTextAreaElement.prototype, 'value'
    )?.set;
    const setter = element.tagName === 'TEXTAREA' ? nativeTextareaValueSetter : nativeInputValueSetter;
    if (setter) {
      setter.call(element, value);
    } else {
      element.value = value;
    }

    // 4. Dispatch React change events
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);

    // 5. Simulate clicking OUT of the field (blur/commit)
    element.dispatchEvent(new FocusEvt('focusout', { bubbles: true }));
    element.dispatchEvent(new FocusEvt('blur', { bubbles: false }));
    element.blur();
    await sleep(150);

    // 6. Click a neutral area to fully deselect
    const neutralEl = ownerDoc.querySelector?.('.smry.summary__title') || ownerDoc.body || document.body;
    simulateClick(neutralEl);
    await sleep(100);

    return true;
  }

  /**
   * Click an element, with fallback to dispatchEvent.
   */
  function clickElement(element) {
    if (!element) return false;
    element.click();
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }

  /**
   * Wait for an element to appear in the DOM.
   */
  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver((mutations, obs) => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * Wait for a specified amount of time.
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Scroll an element into view and wait for any lazy-loaded content.
   */
  async function scrollToAndWait(element, waitMs = 800) {
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(waitMs);
  }

  /**
   * Scroll down the entire page in steps to trigger lazy-loading of all sections.
   * eBay's lstng form lazy-loads sections like item specifics and policies.
   */
  async function scrollPageToLoadAll() {
    console.log('[DropFlow] Scrolling page to load all sections...');
    const totalHeight = document.body.scrollHeight;
    const step = window.innerHeight * 1.5; // Faster: larger steps
    let pos = 0;
    let iterations = 0;
    const maxIterations = 30; // Cap at 30 iterations (~6s)

    while (pos < totalHeight && iterations < maxIterations) {
      pos += step;
      window.scrollTo({ top: pos, behavior: 'instant' }); // instant, not smooth
      await sleep(200);
      iterations++;
    }

    // Scroll back to top
    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(300);
    console.log(`[DropFlow] Page scroll complete (${iterations} steps)`);
  }

  /**
   * Find the Custom Label / SKU input on eBay's listing form.
   * Uses multiple strategies because eBay's form varies by locale (US, AU, UK, DE, etc.)
   * and between the /lstng and /sl/ form versions.
   * @returns {HTMLInputElement|null}
   */
  function findCustomLabelInput() {
    // Strategy 1: Direct name/data-testid selectors
    const direct = document.querySelector('input[name="customLabel"]') ||
                   document.querySelector('input[name="sku"]') ||
                   document.querySelector('[data-testid="sku-input"]') ||
                   document.querySelector('[data-testid="sku-input"] input') ||
                   document.querySelector('[data-testid="custom-label-input"]') ||
                   document.querySelector('[data-testid="custom-label-input"] input') ||
                   document.querySelector('.smry.summary__title input[name="customLabel"]');
    if (direct) {
      console.log('[DropFlow] SKU input found via direct selector');
      return direct;
    }

    // Strategy 2: aria-label matching
    const ariaInput = document.querySelector('input[aria-label*="custom label" i]') ||
                      document.querySelector('input[aria-label*="Custom label" i]') ||
                      document.querySelector('input[aria-label*="SKU" i]') ||
                      document.querySelector('input[aria-label*="sku" i]');
    if (ariaInput) {
      console.log('[DropFlow] SKU input found via aria-label');
      return ariaInput;
    }

    // Strategy 3: placeholder matching
    const placeholderInput = document.querySelector('input[placeholder*="custom label" i]') ||
                             document.querySelector('input[placeholder*="SKU" i]') ||
                             document.querySelector('input[placeholder*="sku" i]');
    if (placeholderInput) {
      console.log('[DropFlow] SKU input found via placeholder');
      return placeholderInput;
    }

    // Strategy 4: Label-walking â€" find label text containing "Custom label" or "SKU",
    // then get its associated input via for/id or parent container
    const allLabels = document.querySelectorAll('label, .field-label, .smry__label, span.textual-display');
    for (const label of allLabels) {
      const text = (label.textContent || '').trim().toLowerCase();
      if (text.includes('custom label') || text === 'sku' || text === 'custom label (sku)') {
        // Method A: label[for] â†' getElementById
        if (label.htmlFor) {
          const byFor = document.getElementById(label.htmlFor);
          if (byFor && byFor.tagName === 'INPUT') {
            console.log('[DropFlow] SKU input found via label[for]');
            return byFor;
          }
        }
        // Method B: input inside the label
        const innerInput = label.querySelector('input');
        if (innerInput) {
          console.log('[DropFlow] SKU input found inside label element');
          return innerInput;
        }
        // Method C: input in the same parent container (sibling)
        const parent = label.closest('.field, .form-group, .se-field, .smry, [class*="field"]') || label.parentElement;
        if (parent) {
          const siblingInput = parent.querySelector('input[type="text"], input:not([type])');
          if (siblingInput) {
            console.log('[DropFlow] SKU input found via label sibling');
            return siblingInput;
          }
        }
      }
    }

    // Strategy 5: Walk all visible text nodes for "Custom label" and find nearest input
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let textNode;
    while ((textNode = walker.nextNode())) {
      const nodeText = (textNode.textContent || '').trim().toLowerCase();
      if (nodeText === 'custom label (sku)' || nodeText === 'custom label' || nodeText === 'sku') {
        const container = textNode.parentElement?.closest('.field, .form-group, .se-field, .smry, [class*="field"]') ||
                         textNode.parentElement?.parentElement;
        if (container) {
          const nearbyInput = container.querySelector('input[type="text"], input:not([type])');
          if (nearbyInput) {
            console.log('[DropFlow] SKU input found via text-node walking');
            return nearbyInput;
          }
        }
      }
    }

    // Strategy 6: ID-based fallback
    const byId = document.getElementById('customLabel') ||
                 document.getElementById('sku') ||
                 document.getElementById('custom-label') ||
                 document.getElementById('s0-1-0-49-2-11-custom-label-field-textbox');
    if (byId) {
      console.log('[DropFlow] SKU input found via element ID');
      return byId;
    }

    console.warn('[DropFlow] Custom Label input NOT found by any strategy');
    return null;
  }

  /**
   * Wait for the eBay listing form to be fully rendered before filling.
   * Polls for key elements (title input, price input, photo upload area).
   * Returns true if form is ready, false if timed out.
   */
  /**
   * Find a title input across shadow DOM, iframes, and regular DOM.
   * Returns the first visible/enabled input found, or null.
   */
  function findTitleInput() {
    // Strategy 1: standard DOM selectors (fastest, works for most eBay forms)
    const byAttr = document.querySelector('.smry.summary__title input[name="title"]') ||
                   document.querySelector('input[name="title"]') ||
                   document.querySelector('[data-testid="title-input"]') ||
                   document.querySelector('[aria-label*="title" i]:not([aria-label*="search" i])') ||
                   document.querySelector('input[placeholder*="title" i]') ||
                   document.querySelector('input[maxlength="80"]');  // eBay title is always max 80
    if (byAttr) return byAttr;

    // Strategy 2: shadow DOM traversal (eBay uses web components on some pages)
    const shadowResults = queryAllWithShadow('input[name="title"], [data-testid="title-input"], input[aria-label*="title" i]');
    if (shadowResults.length > 0) return shadowResults[0];

    // Strategy 3: label-based search — find the input associated with a "Title" label
    const allLabels = document.querySelectorAll('label');
    for (const label of allLabels) {
      if (/^title$/i.test(label.textContent.trim())) {
        const forId = label.getAttribute('for');
        if (forId) {
          const input = document.getElementById(forId);
          if (input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')) return input;
        }
        const input = label.querySelector('input') || label.nextElementSibling?.querySelector?.('input');
        if (input) return input;
      }
    }

    return null;
  }

  async function waitForFormReady(timeoutMs = 15000, hasVariations = false) {
    const startTime = Date.now();
    const pollInterval = 500;

    const selectors = {
      // Expanded title selector: name, testid, aria-label, placeholder, or maxlength=80 (eBay's title limit)
      title: 'input[name="title"], [data-testid="title-input"], input[aria-label*="title" i]:not([aria-label*="search" i]), input[placeholder*="title" i], input[maxlength="80"]',
      price: 'input[name="price"], [data-testid="price-input"] input, input[placeholder*="price" i]',
      photos: 'input[type="file"][accept*="image"], input[type="file"][multiple], input[type="file"], [class*="photo-upload"], [class*="image-upload"], [data-testid="image-upload"]'
    };

    while (Date.now() - startTime < timeoutMs) {
      const titleEl = document.querySelector(selectors.title) || findTitleInput();
      const priceEl = document.querySelector(selectors.price);
      const photoEl = document.querySelector(selectors.photos);

      const found = [titleEl && 'title', priceEl && 'price', photoEl && 'photos'].filter(Boolean);

      // Return true when title is found.
      // For variations products, price input may not appear in the main form (it's per-SKU),
      // so don't require it — waiting for price would always time out on variations listings.
      if (titleEl && (priceEl || hasVariations)) {
        console.log(`[DropFlow] Form ready (${found.join(', ')} found) after ${Date.now() - startTime}ms`);
        return true;
      }

      // Also return true if we have BOTH title AND price (non-variations)
      if (titleEl && priceEl) {
        console.log(`[DropFlow] Form ready (${found.join(', ')} found) after ${Date.now() - startTime}ms`);
        return true;
      }

      await sleep(pollInterval);
    }

    const lastTitle = document.querySelector(selectors.title);
    const lastPrice = document.querySelector(selectors.price);
    console.warn(`[DropFlow] Form ready timeout after ${timeoutMs}ms — proceeding anyway (title=${!!lastTitle}, price=${!!lastPrice})`);
    return false;
  }

  /**
   * Fill the eBay listing form with product data.
   */
  async function fillForm(productData) {
    console.log('[DropFlow] fillForm() ENTERED — url=' + window.location.href.substring(0, 80) + ' hasVariations=' + !!productData?.variations?.hasVariations);
    const _dfSteps = [];
    async function _dfLog(step, detail) {
      const msg = `[${new Date().toISOString().substr(11,12)}] ${step}: ${detail || ''}`;
      _dfSteps.push(msg);
      console.log('[DropFlow] ' + msg);
      try { await chrome.storage.local.set({ _dropflow_fillform_trace: _dfSteps }); } catch(_) {}
    }
    await _dfLog('ENTER', 'url=' + window.location.href.substring(0, 60));
    // Log what product data is available — essential for diagnosing fill failures
    await _dfLog('PRODUCT_DATA', [
      `title="${(productData.ebayTitle || productData.title || '').substring(0, 50)}"`,
      `ebayPrice=${productData.ebayPrice}`,
      `hasVars=${!!productData.variations?.hasVariations}`,
      `skus=${productData.variations?.skus?.length ?? 0}`,
      `descLen=${(productData.description || '').length}`,
      `aiDescLen=${(productData.aiDescription || '').length}`,
      `bulletPts=${(productData.bulletPoints || []).length}`,
      `images=${(productData.images || []).length}`
    ].join(', '));
    const results = {
      title: false,
      price: false,
      description: false,
      images: false,
      condition: false,
      itemSpecifics: false,
      variations: false,
      variationImages: false,
      variationPrices: false
    };

    const fillLockKey = '__dropflowFillFormLock';
    const lockHost = window;
    const now = Date.now();
    const existingFillLock = lockHost[fillLockKey];
    if (existingFillLock && (now - existingFillLock.startedAt) < 1200000) {
      console.warn(`[DropFlow] fillForm already running in this frame (age=${now - existingFillLock.startedAt}ms), skipping duplicate run`);
      return results;
    }
    lockHost[fillLockKey] = { startedAt: now };

    try {
      // 0. Dismiss any auto-opened condition modal first
      {
        const doneBtn = [...document.querySelectorAll('button, [role="button"]')].find(
          el => /^done$/i.test(el.textContent.trim()) && el.offsetParent !== null
        );
        if (doneBtn) {
          simulateClick(doneBtn);
          console.log('[DropFlow] fillForm: dismissed pre-existing condition modal');
          await sleep(800);
        }
        // Also dismiss any tooltip overlay
        const tooltipClose = document.querySelector('[class*="tooltip"] button[class*="close"], [class*="tip"] [class*="close"], [class*="coach"] button[class*="close"]');
        if (tooltipClose) {
          simulateClick(tooltipClose);
          console.log('[DropFlow] fillForm: dismissed tooltip overlay');
          await sleep(500);
        }
      }

      // 0b. Wait for form to render, then scroll to trigger lazy-loading
      // Pass hasVariations so waitForFormReady doesn't require a price input for variations products
      // (variations listings don't have a single price input — price is per-SKU in the builder)
      const _hasVarsEarly = !!productData.variations?.hasVariations;
      await _dfLog('STEP0', `waitForFormReady (hasVariations=${_hasVarsEarly})...`);
      await waitForFormReady(15000, _hasVarsEarly);
      await _dfLog('STEP0', 'scrollPageToLoadAll...');
      await scrollPageToLoadAll();
      await _dfLog('STEP0', 'scroll done');

      // 0b. Prefetch eBay draft API headers (captured by background webRequest listener).
      //     These are needed for direct API PUT to bypass React state.
      //     We fetch early so they're ready by the time we need them for description/specifics.
      let ebayContext = await getEbayHeaders();

      // 1. Fill title — retry up to 3 times (2s gap) to handle slow SPA rendering
      await sleep(500);
      let titleInput = null;
      for (let titleAttempt = 1; titleAttempt <= 3; titleAttempt++) {
        titleInput = findTitleInput();
        if (titleInput) break;
        await _dfLog('TITLE_SEARCH', `attempt ${titleAttempt}/3 — input not found yet`);
        console.warn(`[DropFlow] Title input not found (attempt ${titleAttempt}/3), waiting 2s...`);
        await sleep(2000);
      }
      if (titleInput) {
        await scrollToAndWait(titleInput, 300);
        const title = productData.ebayTitle || productData.title || '';
        if (!title) {
          console.warn('[DropFlow] ⚠ productData has no title (ebayTitle and title are both empty)!');
        }
        results.title = await commitInputValue(titleInput, title.substring(0, 80));
        await _dfLog('TITLE', `committed "${title.substring(0, 50)}"`);
        console.log(`[DropFlow] Title committed: "${title.substring(0, 40)}..."`);

        // API PUT fallback for title — bypasses React state entirely
        // Also try extracting draftId from URL if intercepted headers didn't supply it
        if (ebayContext && !ebayContext.draftId) {
          ebayContext.draftId = extractDraftIdFromUrl();
        }
        if (ebayContext?.draftId) {
          try {
            await putDraftField({ title: title.substring(0, 80) }, ebayContext);
            results.title = true;
            console.log('[DropFlow] Title PUT successful');
          } catch (e) {
            console.warn('[DropFlow] Title PUT fallback failed:', e.message);
          }
        }
      } else {
        await _dfLog('TITLE', 'ERROR — input not found after 3 attempts (selectors may not match eBay AU form)');
        console.error('[DropFlow] ❌ Title input NOT FOUND after 3 attempts — title will not be filled!');
      }

      // 2. Fill price if ebayPrice was calculated (from markup settings)
      // Skip if variations exist — each SKU has its own price set in fillVariations()
      // Skip if 0 — means the scraper couldn't extract a real price
      const hasVariations = productData.variations?.hasVariations;
      await _dfLog('STEP2', `price fill (hasVariations=${hasVariations}, ebayPrice=${productData.ebayPrice})`);
      if (!hasVariations && productData.ebayPrice != null && productData.ebayPrice > 0) {
        let priceInput = null;
        for (let priceAttempt = 1; priceAttempt <= 3; priceAttempt++) {
          priceInput = document.querySelector('input[name="price"]') ||
                       document.querySelector('[data-testid="price-input"] input') ||
                       document.querySelector('input[placeholder*="price" i]') ||
                       document.querySelector('.smry input[type="text"][name="price"]') ||
                       document.querySelector('input[aria-label*="price" i]');
          if (priceInput) break;
          console.warn(`[DropFlow] Price input not found, attempt ${priceAttempt}/3...`);
          await sleep(2000);
        }
        if (priceInput) {
          await scrollToAndWait(priceInput, 300);
          results.price = await commitInputValue(priceInput, String(productData.ebayPrice));
          await _dfLog('PRICE', `committed $${productData.ebayPrice}`);
          console.log(`[DropFlow] Price committed (DOM): $${productData.ebayPrice}`);
        } else {
          await _dfLog('PRICE', 'ERROR — input not found after 3 attempts');
          console.warn('[DropFlow] ❌ Price input not found after 3 attempts');
        }

        // API PUT fallback — commit price server-side to bypass React state
        if (ebayContext && !ebayContext.draftId) {
          ebayContext.draftId = extractDraftIdFromUrl();
        }
        if (ebayContext?.draftId) {
          try {
            const putSuccess = await putDraftField({
              price: { value: String(productData.ebayPrice) }
            }, ebayContext);
            if (putSuccess) {
              results.price = true;
              console.log(`[DropFlow] Price PUT successful: $${productData.ebayPrice}`);
            }
          } catch (e) {
            console.warn('[DropFlow] Price PUT fallback failed:', e.message);
          }
        }
      } else if (hasVariations) {
        await _dfLog('PRICE', 'skipped (variations product — price set per SKU)');
      } else {
        await _dfLog('PRICE', `skipped (ebayPrice=${productData.ebayPrice})`);
      }

      await _dfLog("STEP3", "condition..."); // 3. Set condition — may not have been set during prelist/identify flow
      // Check if condition is already set by looking for the recommendation buttons
      const condRecoBtns = document.querySelectorAll('button.condition-recommendation-value');
      if (condRecoBtns.length > 0) {
        // Condition NOT set — recommendation buttons are visible
        // Click "Brand New" (first button) as default
        simulateClick(condRecoBtns[0]);
        console.log('[DropFlow] Condition: clicked recommendation button "' + condRecoBtns[0].textContent.trim() + '"');
        await sleep(500);
        results.condition = true;
      } else {
        // Try the full condition click strategy (handles other UI formats)
        results.condition = tryClickCondition();
        if (!results.condition) {
          // Condition may already be set — check if the condition section shows a value
          const condValue = document.querySelector('#summary-condition-field-value');
          if (condValue && condValue.textContent.trim() !== '—') {
            results.condition = true;
            console.log('[DropFlow] Condition already set: ' + condValue.textContent.trim());
          } else {
            // Try setting via draft API PUT
            if (ebayContext && ebayContext.draftId) {
              try {
                const putOk = await putDraftField({ condition: { conditionId: 1000 } }, ebayContext);
                if (putOk) {
                  results.condition = true;
                  console.log('[DropFlow] Condition set via draft API PUT (conditionId=1000 Brand New)');
                }
              } catch (e) {
                console.warn('[DropFlow] Condition API PUT failed:', e.message);
              }
            }
          }
        }
      }

      // 3b. Close any open condition dialog/panel (clicks "Done" or clicks outside)
      {
        await sleep(500);
        // Check for condition dialog panel with a "Done" button
        const doneBtn = [...document.querySelectorAll('button, a, [role="button"]')].find(
          el => /^done$/i.test(el.textContent.trim()) && el.offsetParent !== null
        );
        if (doneBtn) {
          simulateClick(doneBtn);
          console.log('[DropFlow] Condition: clicked "Done" to close condition panel');
          await sleep(500);
        } else {
          // Try clicking outside any open panel/dialog to dismiss it
          const panel = document.querySelector('[class*="panel"][class*="open"], [class*="drawer"][class*="open"], [role="dialog"]');
          if (panel) {
            // Click the backdrop/overlay or the page body to dismiss
            const overlay = document.querySelector('[class*="overlay"], [class*="backdrop"], [class*="mask"]');
            if (overlay) {
              simulateClick(overlay);
              console.log('[DropFlow] Condition: clicked overlay to dismiss panel');
            } else {
              document.body.click();
              console.log('[DropFlow] Condition: clicked body to dismiss panel');
            }
            await sleep(500);
          }
        }
      }

      await _dfLog('STEP4', 'description...'); // 4. Fill description (hybrid DOM + API PUT) â€" with retry
      for (let descAttempt = 1; descAttempt <= 1; descAttempt++) { // Reduced to 1 attempt for speed
        await sleep(1000);
        // Retry header fetch if we didn't get them earlier (eBay may not have made
        // a draft API request yet when the page first loaded)
        if (!ebayContext) {
          ebayContext = await getEbayHeaders();
        }
        try {
          results.description = await fillDescription(productData, ebayContext);
        } catch (e) {
          console.warn(`[DropFlow] Description attempt ${descAttempt}/3 threw: ${e.message}`);
          results.description = false;
        }
        if (results.description) break;
        console.warn(`[DropFlow] Description attempt ${descAttempt}/3 failed, retrying...`);
        // Scroll to description area to trigger lazy load before retry
        const descArea = document.querySelector('.summary__description') ||
          document.querySelector('[class*="description"]');
        if (descArea) await scrollToAndWait(descArea, 1000);
      }

      const _tPhotoStart = Date.now();
      await _dfLog('STEP5_START', `photo upload starting, count=${productData.images?.length || 0}`);
      // 5. Upload images (re-enabled: sendMessageSafe handles SW timeouts/retries)
      // Capped at 2 retries (was 3) to reduce total time before variations
      if (productData.images && productData.images.length > 0) {
        for (let imgAttempt = 1; imgAttempt <= 2; imgAttempt++) {
          await sleep(500);
          // Refresh headers on retry (eBay may have made new API calls by now)
          if (imgAttempt > 1) {
            console.log(`[DropFlow] Image upload retry ${imgAttempt}/3 — refreshing headers...`);
            ebayContext = await getEbayHeaders();
          }
          try {
            results.images = await Promise.race([
              uploadImages(productData.images, ebayContext, productData.preDownloadedImages),
              new Promise((_, rej) => setTimeout(() => rej(new Error('Image upload timeout (30s)')), 30000))
            ]);
          } catch (e) {
            console.warn(`[DropFlow] Image upload attempt ${imgAttempt}/3 threw: ${e.message}`);
            results.images = false;
          }
          if (results.images) break;
          console.warn(`[DropFlow] Image upload attempt ${imgAttempt}/3 failed, retrying...`);
          // Scroll to photo section to trigger lazy load before retry
          const photoArea = findPhotosSection();
          if (photoArea) {
            await scrollToAndWait(photoArea, 1000);
          } else {
            // Scroll to top where photos section usually lives
            window.scrollTo({ top: 0, behavior: 'smooth' });
            await sleep(1000);
          }
          await sleep(2000);
        }
      }

      await _dfLog('STEP5_END', `photo upload result=${results.images}, elapsed=${Date.now()-_tPhotoStart}ms`);
      // 5a. Verify photos persisted — poll draft API to confirm
      // IMPORTANT: Cap total verification time to prevent stalling the entire form fill.
      // The ensurePhotosInDraft fallback can hang for minutes if the SW is dead (MV3 lifecycle).
      if (productData.images?.length > 0 && results.images) {
        await _dfLog('STEP5a', 'verifying photos in draft...');
        const verifyStart = Date.now();
        const VERIFY_TIMEOUT = 20000; // 20s max for verification (was unbounded)
        try {
          const photosConfirmed = await Promise.race([
            waitForDraftPhotos(ebayContext, 15000), // reduced from 30s
            new Promise(resolve => setTimeout(() => resolve(false), VERIFY_TIMEOUT))
          ]);
          if (!photosConfirmed) {
            const elapsed = Date.now() - verifyStart;
            console.warn(`[DropFlow] Photos not confirmed in draft after ${elapsed}ms — attempting quick EPS fallback...`);
            // Only attempt fallback if we have pre-downloaded images (avoids SW dependency)
            const hasPreDownloaded = Array.isArray(productData.preDownloadedImages) && productData.preDownloadedImages.some(d => d !== null);
            if (hasPreDownloaded && ebayContext?.draftId) {
              const fallbackOk = await Promise.race([
                ensurePhotosInDraft(productData.images, ebayContext, productData.preDownloadedImages),
                new Promise(resolve => setTimeout(() => resolve(false), 15000)) // 15s cap on fallback
              ]);
              if (fallbackOk) {
                console.log('[DropFlow] Photo fallback (EPS + draft PUT) succeeded');
                results.images = true;
              } else {
                console.warn('[DropFlow] Photo fallback timed out or failed — continuing anyway (photos may already be uploaded via DOM)');
              }
            } else {
              console.warn('[DropFlow] Skipping photo fallback (no pre-downloaded images or no draftId) — continuing to next step');
            }
          }
        } catch (e) {
          console.warn('[DropFlow] Photo verification error:', e.message, '— continuing to next step');
        }
        await _dfLog('STEP5a', `photo verification complete (${Date.now() - verifyStart}ms)`);
      }

      await _dfLog('STEP5b', `proceeding to variations (hasVariations=${!!hasVariations})`);

      // 5b. Fill variations (multi-SKU listing) via DOM automation
      // The eBay /lstng API does NOT support variations â€" DOM automation is required.
      let filledVariationAxes = []; // Labels filled as variation axes (to skip in fillItemSpecifics)

      // Persist variation diagnostic data (console logs are lost on eBay SPA navigation)
      chrome.storage.local.set({
        dropflow_variation_check: {
          timestamp: new Date().toISOString(),
          hasVariations: !!hasVariations,
          variationsObj: productData.variations ? {
            hasVariations: productData.variations.hasVariations,
            axesCount: productData.variations.axes?.length || 0,
            axisNames: productData.variations.axes?.map(a => a.name) || [],
            skuCount: productData.variations.skus?.length || 0
          } : null,
          url: location.href
        }
      }).catch(() => {});

      if (!hasVariations) {
        console.warn('[DropFlow] hasVariations is FALSE â€" skipping variation DOM automation');
        // Pull MAIN-world diagnostic from storage for display
        let mainWorldDiag = null;
        try {
          const stored = await chrome.storage.local.get(['dropflow_variation_mainworld_diag', 'dropflow_variation_scripttag_diag']);
          mainWorldDiag = stored.dropflow_variation_mainworld_diag || null;
          const scriptDiag = stored.dropflow_variation_scripttag_diag || null;
          if (mainWorldDiag) console.warn('[DropFlow] MAIN-world diag:', JSON.stringify(mainWorldDiag));
          if (scriptDiag) console.warn('[DropFlow] Script-tag diag:', JSON.stringify(scriptDiag));
        } catch (_) {}
        showVariationDiagnostic({
          status: 'skipped',
          reason: 'hasVariations is false',
          variationsField: productData.variations ? 'exists' : 'missing',
          hasVariationsFlag: productData.variations?.hasVariations,
          mainWorld: mainWorldDiag ? {
            foundIn: mainWorldDiag.foundIn,
            runParamsKeys: mainWorldDiag.runParamsKeys,
            dataKeys: mainWorldDiag.runParamsDataKeys,
            skuModuleKeys: mainWorldDiag.skuModuleKeys,
            error: mainWorldDiag.error
          } : 'no diag'
        });
      }

      if (hasVariations) {
        await _dfLog('VARIATIONS_START', 'starting DOM variation flow...'); console.log('[DropFlow] Multi-variation product detected, starting DOM variation flow...');
      await _dfLog('STEP6', 'variations starting...');
        showVariationDiagnostic({
          status: 'starting',
          axes: productData.variations.axes?.map(a => a.name) || [],
          skuCount: productData.variations.skus?.length || 0
        });
        let varResult = null;
        const _tVarStart = Date.now();
        try {
          varResult = await Promise.race([
            fillVariations(productData),
            new Promise((resolve) => setTimeout(() => {
              console.warn('[DropFlow] fillVariations timed out after 120s — proceeding without variations');
              resolve(null);
            }, 120000))
          ]);
        } catch (e) {
          console.error('[DropFlow] fillVariations threw:', e);
          varResult = null;
        }
        await _dfLog('VARIATIONS_END', `fillVariations done, elapsed=${Date.now()-_tVarStart}ms, success=${!!varResult}`);
        if (varResult && varResult.filledAxes) {
          results.variations = true;
          filledVariationAxes = varResult.filledAxes;
          console.log(`[DropFlow] Variation axes set: [${filledVariationAxes.join(', ')}]`);
          try {
            results.variationImages = await uploadVariationImages(productData, ebayContext, varResult.axisNameMap);
          } catch (e) {
            console.warn('[DropFlow] uploadVariationImages threw:', e.message);
            results.variationImages = false;
          }
          console.log(`[DropFlow] Variation images: ${results.variationImages}`);
        } else {
          // DOM variation flow failed â€" fall back to single-SKU with cheapest price
          console.warn('[DropFlow] Variation filling failed, falling back to single-SKU listing');
          if (productData.ebayPrice > 0) {
            const priceInput = document.querySelector('input[name="price"]') ||
                               document.querySelector('[data-testid="price-input"] input') ||
                               document.querySelector('input[placeholder*="price" i]');
            if (priceInput) {
              results.price = await commitInputValue(priceInput, String(productData.ebayPrice));
              console.log(`[DropFlow] Fallback price committed (DOM): $${productData.ebayPrice}`);
            }
            if (ebayContext?.draftId) {
              try {
                await putDraftField({ price: { value: String(productData.ebayPrice) } }, ebayContext);
                results.price = true;
              } catch (_) {}
            }
          }
        }
      }

      // 5c. Fill the variation combinations table with per-SKU prices and quantities.
      // Bug fix: wait for the builder to be fully closed before polling for the table.
      // The combinations table only appears AFTER the builder iframe finishes and closes.
      // Previously this ran while the builder was still open, so the 15s poll always timed out.
      if (hasVariations && productData.variations?.skus?.length > 0) {
        // Wait for the MSKU builder / variation builder to be gone before polling for the table.
        {
          const _tBuilderGoneStart = Date.now();
          const BUILDER_GONE_MAX = 60; // up to 30s
          for (let bg = 0; bg < BUILDER_GONE_MAX; bg++) {
            const ctx = detectVariationBuilderContext();
            const mskuFrame = findMskuBulkeditIframe();
            if (!ctx.isBuilder && !mskuFrame) break;
            if (bg === 0) console.log('[DropFlow] 5c: waiting for builder/MSKU iframe to close before combinations table...');
            await sleep(500);
          }
          await _dfLog('BUILDER_GONE', `builder-gone wait complete, elapsed=${Date.now()-_tBuilderGoneStart}ms`);
          // Extra settle time for eBay to render the combinations table after builder closes
          await sleep(1500);
        }
        const _tComboStart = Date.now();
        await _dfLog('COMBO_TABLE_START', 'fillVariationCombinationsTable entering...');
        try {
          const comboResult = await fillVariationCombinationsTable(productData);
          await _dfLog('COMBO_TABLE_END', `elapsed=${Date.now()-_tComboStart}ms, prices=${comboResult.filledPrices}/${comboResult.totalRows}, qty=${comboResult.filledQuantities}`);
          if (comboResult.success) {
            results.variationPrices = true;
            console.log(`[DropFlow] Combinations table filled: ${comboResult.filledPrices} prices, ` +
              `${comboResult.filledQuantities} quantities across ${comboResult.totalRows} rows`);
          } else {
            console.warn(`[DropFlow] Combinations table fill: ${comboResult.filledPrices}/${comboResult.totalRows} prices`);
          }
        } catch (err) {
          await _dfLog('COMBO_TABLE_END', `ERROR after ${Date.now()-_tComboStart}ms: ${err?.message}`);
          console.error('[DropFlow] fillVariationCombinationsTable error:', err);
        }
      }

      // 5c½. Draft API per-variant pricing — FALLBACK only if DOM combinations table failed.
      // The Draft API has been failing with "Failed to fetch" network errors.
      // DOM-based pricing (fillCombinationsTable above) is now the primary path.
      // Only attempt the Draft API if the DOM method did not succeed.
      if (hasVariations && productData.variations?.skus?.length > 0 && !results.variationPrices && ebayContext?.draftId) {
        console.log('[DropFlow] DOM combinations table did not succeed — falling back to Draft API pricing');
        try {
          const draftPriceResult = await putVariationPricesViaDraftAPI(productData, ebayContext);
          if (draftPriceResult.success) {
            results.variationPrices = true;
            console.log(`[DropFlow] ✅ Draft API variation pricing (fallback): ${draftPriceResult.pricedCount} variants priced`);
          } else {
            console.warn('[DropFlow] Draft API variation pricing fallback also failed — prices may be unset');
          }
        } catch (err) {
          console.error('[DropFlow] putVariationPricesViaDraftAPI error:', err);
        }
      }

      // 5d. Clear invalid UPC values from variations
      // The builder may have accidentally set UPC to "1" or another invalid value.
      // Attempt to clear it via the draft API by setting UPC to empty/Does not apply.
      if (hasVariations && ebayContext && ebayContext.draftId) {
        try {
          // Try multiple approaches to clear UPC from variations
          const clearPayloads = [
            { variations: { productDetails: { UPC: '' } } },
            { variations: { productDetails: { UPC: 'Does not apply' } } },
            { productDetails: { UPC: 'Does not apply' } },
            { productDetails: { UPC: '' } }
          ];
          let upcCleared = false;
          for (const payload of clearPayloads) {
            try {
              const ok = await putDraftField(payload, ebayContext);
              if (ok) {
                console.log('[DropFlow] UPC cleared via draft API PUT:', JSON.stringify(payload));
                upcCleared = true;
                break;
              }
            } catch (_) {}
          }
          if (!upcCleared) {
            console.warn('[DropFlow] Could not clear UPC via API — may need manual fix');
          }
        } catch (e) {
          console.warn('[DropFlow] UPC clearing error:', e.message);
        }
      }

      // 6. Store SKU (ASIN) in custom label field â€" with retry + scroll + API PUT
      // Skip single SKU if variations were successfully filled (each SKU has its own label)
      if (productData.asin && !results.variations) {
        console.log(`[DropFlow] Attempting to set Custom Label / SKU: ${productData.asin}`);
        await scrollPageToLoadAll();
        await sleep(1500);

        let skuCommitted = false;
        for (let skuAttempt = 0; skuAttempt < 5 && !skuCommitted; skuAttempt++) {
          if (skuAttempt > 0) {
            console.log(`[DropFlow] SKU retry ${skuAttempt + 1}/5 â€" re-scrolling to load lazy sections...`);
            await scrollPageToLoadAll();
            await sleep(2000);
            // On later attempts, also scroll specifically to the bottom where SKU usually lives
            if (skuAttempt >= 2) {
              window.scrollTo({ top: document.body.scrollHeight * 0.7, behavior: 'smooth' });
              await sleep(1500);
            }
          }
          const skuInput = findCustomLabelInput();
          if (skuInput) {
            await scrollToAndWait(skuInput, 500);
            await commitInputValue(skuInput, productData.asin);
            skuCommitted = true;
            console.log(`[DropFlow] SKU committed via DOM: ${productData.asin}`);
          }
        }

        // Re-fetch headers if missing (they may have arrived after initial load)
        if (!ebayContext || !ebayContext.draftId) {
          console.log('[DropFlow] ebayContext missing before SKU PUT, re-fetching headers...');
          ebayContext = await getEbayHeaders();
        }

        // API PUT fallback â€" try multiple field names (eBay's API varies by locale)
        if (ebayContext && ebayContext.draftId) {
          const skuPayloads = [
            { sku: productData.asin },
            { SKU: productData.asin },
            { customLabel: productData.asin },
            { custom_label: productData.asin }
          ];
          let skuPutOk = false;
          for (const payload of skuPayloads) {
            try {
              const ok = await putDraftField(payload, ebayContext);
              if (ok) {
                console.log(`[DropFlow] SKU PUT successful with field "${Object.keys(payload)[0]}": ${productData.asin}`);
                skuPutOk = true;
                break;
              }
            } catch (e) {
              // Try next field name
            }
          }
          if (!skuPutOk) {
            console.warn('[DropFlow] SKU PUT failed with all field name variants');
          }
        } else {
          console.warn(`[DropFlow] SKU PUT skipped â€" no ebayContext/draftId available. DOM committed: ${skuCommitted}`);
        }

        if (!skuCommitted) {
          console.warn(`[DropFlow] SKU input not found after 5 attempts â€" relied on API PUT for: ${productData.asin}`);
        }
      }

      // 7. Fill ALL required item specifics (Brand + everything else) via AI + DOM + API PUT
      //    Skip labels already filled as variation axes (multi-value specifics)
      await _dfLog('STEP7', 'item specifics starting...');
      await sleep(1000);
      // One more header fetch attempt if still missing
      if (!ebayContext) {
        ebayContext = await getEbayHeaders();
      }
      const variationsActuallyReady = !!(results.variations || results.variationPrices || checkVariationsPopulated());
      if (hasVariations && !variationsActuallyReady) {
        console.warn('[DropFlow] Skipping item specifics because variation flow did not complete');
        await logVariationStep('fillVariations:skipItemSpecificsAfterFailure', {});
      } else {
        try {
          results.itemSpecifics = await fillItemSpecifics(productData, ebayContext, filledVariationAxes);
        } catch (e) {
          console.warn('[DropFlow] fillItemSpecifics threw:', e.message);
          results.itemSpecifics = false;
        }
      }

      await _dfLog('STEP8', 'all field filling complete, preparing to submit...');

      // Brief pause to let eBay process changes
      await sleep(2000);

      // Safety checks — log warnings but ALWAYS attempt submit (let eBay validate)
      if (productData.images?.length > 0 && !results.images) {
        console.warn('[DropFlow] Image upload not confirmed — will attempt submit anyway');
      }

      const canSubmitVariations = !hasVariations || results.variations || results.variationPrices || checkVariationsPopulated();
      if (hasVariations && !canSubmitVariations) {
        console.warn('[DropFlow] Variation flow may be incomplete — will attempt submit anyway');
        await logVariationStep('fillVariations:submitAnywayAfterIncomplete', {});
      }
      if (hasVariations && !results.variations && canSubmitVariations) {
        results.variations = true;
      }

      // 8. Send EBAY_FORM_FILLED BEFORE clicking "List it"
      //    eBay may reload the page after submit, destroying the content script.
      console.log('[DropFlow] All fields filled, signaling completion...', JSON.stringify(results));
      // Persist results to storage (console is cleared on page navigation)
      chrome.storage.local.set({
        dropflow_last_fill_results: { ...results, url: window.location.href, timestamp: new Date().toISOString() }
      }).catch(() => {});
      sendMessageSafe({
        type: 'EBAY_FORM_FILLED',
        results,
        url: window.location.href
      }, 5000).catch(() => {});

      // 9. Pre-submit photo check — SKIP reupload, just log status
      //    Previous logic caused false positives on MSKU builder pages where
      //    photos exist in draft but DOM selectors don't match the variation page layout.
      if (productData.images?.length > 0) {
        const domPhotos = countUploadedImages();
        console.log(`[DropFlow] Pre-submit photo check: DOM=${domPhotos} (informational only, proceeding to submit)`);
      }

      // 9b. Click "List it"
      const _tSubmitStart = Date.now();
      await _dfLog('SUBMIT_START', 'clicking List it button...');
      console.log('[DropFlow] Submitting listing...');
      results.listed = await clickListIt();
      await _dfLog('SUBMIT_END', `listed=${results.listed}, elapsed=${Date.now()-_tSubmitStart}ms`);

    } catch (error) {
      console.error('[DropFlow] Form fill error:', error);
    } finally {
      const current = lockHost[fillLockKey];
      if (current && current.startedAt === now) {
        delete lockHost[fillLockKey];
      }
    }

    return results;
  }

  /**
   * Check if there are visible error banners on the page.
   * Returns the error text or null if no errors.
   */
  function getFormErrors() {
    // Look for eBay error banners
    const errorSelectors = [
      '[role="alert"]',
      '[class*="error-banner"]', '[class*="error-message"]',
      '[class*="inline-notice--attention"]', '[class*="notice--error"]',
      '[class*="field-error"]', '[class*="validation-error"]'
    ];
    for (const sel of errorSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null && el.textContent.includes('missing')) {
        return el.textContent.trim();
      }
    }

    // Check for red-bordered required fields (eBay marks invalid fields)
    const redFields = document.querySelectorAll('[aria-invalid="true"], .field--error, [class*="field--error"]');
    if (redFields.length > 0) {
      const names = Array.from(redFields).map(f => {
        const label = f.closest('[class*="field"]')?.querySelector('label, legend, span');
        return label ? label.textContent.trim() : 'unknown';
      });
      return `Required fields: ${names.join(', ')}`;
    }

    return null;
  }

  /**
   * Find and click the "List it" / "List item" submit button.
   * Uses eBay's #actionbar container. Clicks twice for reliability.
   */
  async function clickListIt() {
    // Wait for React state to settle after all field changes
    await sleep(2000);

    // Scroll to bottom where submit lives
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    await sleep(1000);

    // Check for error banners â€" if errors exist, log but still attempt submit
    const errors = getFormErrors();
    if (errors) {
      console.warn(`[DropFlow] Form may have errors: ${errors}`);
    }

    // Method 1: eBay's actionbar (exact approach from competitor)
    const actionbar = document.getElementById('actionbar');
    if (actionbar) {
      const listBtn = actionbar.querySelector('[value="List item"]') ||
                      actionbar.querySelector('button[aria-label*="List"]') ||
                      actionbar.querySelector('button');
      if (listBtn && !listBtn.disabled) {
        listBtn.click();
        listBtn.click(); // Double-click for reliability
        console.log(`[DropFlow] Clicked "List item" via actionbar`);
        return true;
      }
    }

    // Method 2: button[aria-label*="List"]
    const ariaBtn = document.querySelector('button[aria-label*="List"]');
    if (ariaBtn && !ariaBtn.disabled) {
      ariaBtn.click();
      ariaBtn.click();
      console.log(`[DropFlow] Clicked "List" via aria-label`);
      return true;
    }

    // Method 3: Text-based search
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text === 'list it' || text === 'list item' || text === 'list it for free' ||
          text.startsWith('list it')) {
        if (!btn.disabled) {
          btn.click();
          btn.click();
          console.log(`[DropFlow] Clicked "${btn.textContent.trim()}" button`);
          return true;
        }
      }
    }

    // Method 4: submit button fallback
    const submitBtn = document.querySelector('button[type="submit"]');
    if (submitBtn && !submitBtn.disabled) {
      submitBtn.click();
      submitBtn.click();
      console.log(`[DropFlow] Clicked submit button: ${submitBtn.textContent.trim()}`);
      return true;
    }

    console.warn('[DropFlow] Could not find "List it" button');
    return false;
  }

  /**
   * Generate an AI-powered HTML description via the backend.
   * Falls back to the static template if the API call fails.
   */
  async function generateAIDescription(productData) {
    // If the service worker already pre-generated an AI description, use it
    if (productData.aiDescription) {
      console.log('[DropFlow] Using pre-generated AI description from service worker');
      return productData.aiDescription;
    }

    // Request AI description from service worker with timeout handling
    try {
      const result = await sendMessageSafe({
        type: 'GENERATE_DESCRIPTION',
        title: productData.title || '',
        bulletPoints: (productData.bulletPoints || []).join('\n'),
        description: productData.description || ''
      }, 30000);
      if (result && result.html) {
        console.log('[DropFlow] AI description generated via service worker');
        return result.html;
      }
    } catch (e) {
      console.warn('[DropFlow] AI description generation failed:', e.message);
    }
    // Fallback to static template
    console.log('[DropFlow] Using static description template (AI fallback)');
    return buildDescription(productData);
  }

  // ================================================================
  // eBay Draft API â€" Direct PUT (bypasses React state)
  // ================================================================

  /**
   * PUT data directly to eBay's listing draft API.
   * This bypasses React state entirely â€" the server-side draft is updated directly.
   * @param {object} data - The fields to update (e.g. { description: "<html>..." })
   * @param {object} ebayContext - { headers, draftId } from GET_EBAY_HEADERS
   * @returns {boolean} Whether the PUT succeeded
   */
  /**
   * GET the current listing draft from eBay's API.
   * Returns the draft JSON object or null on failure.
   */
  async function getDraftData(ebayContext) {
    if (!ebayContext || !ebayContext.headers || !ebayContext.draftId) return null;
    const url = `https://${location.host}/lstng/api/listing_draft/${ebayContext.draftId}?mode=AddItem`;
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: { ...ebayContext.headers },
        credentials: 'include'
      });
      if (resp.ok) return await resp.json();
      console.warn(`[DropFlow] getDraftData failed (${resp.status})`);
    } catch (e) {
      console.warn('[DropFlow] getDraftData error:', e.message);
    }
    return null;
  }

  /**
   * Check how many photos are in the draft via the API.
   * Returns the count of picture URLs, or -1 if unable to check.
   */
  async function getDraftPhotoCount(ebayContext) {
    const draft = await getDraftData(ebayContext);
    if (!draft) return -1;
    // eBay stores photos in various locations in the draft
    const pics = draft.pictures?.pictureUrl || draft.pictures?.pictureUrls ||
                 draft.pictureURL || draft.images || [];
    const arr = Array.isArray(pics) ? pics : [];
    console.log(`[DropFlow] Draft photo count: ${arr.length}`);
    return arr.length;
  }

  /**
   * Wait for photos to appear in the draft API.
   * Polls every 3s for up to timeoutMs.
   * Returns true if photos found, false on timeout.
   */
  async function waitForDraftPhotos(ebayContext, timeoutMs = 30000) {
    if (!ebayContext?.draftId) return false;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const count = await getDraftPhotoCount(ebayContext);
      if (count > 0) {
        console.log(`[DropFlow] Draft photos confirmed: ${count} photos after ${Date.now() - start}ms`);
        return true;
      }
      // Also check DOM
      const domCount = countUploadedImages();
      if (domCount > 0) {
        console.log(`[DropFlow] DOM photos confirmed: ${domCount} photos after ${Date.now() - start}ms`);
        return true;
      }
      await sleep(3000);
    }
    console.warn(`[DropFlow] Draft photos NOT confirmed after ${timeoutMs}ms`);
    return false;
  }

  /**
   * Upload images to EPS and PUT URLs to draft. Used as a reliable fallback
   * when other upload methods don't persist photos to the draft.
   * Returns true if photos were successfully PUT to the draft.
   */
  async function ensurePhotosInDraft(imageUrls, ebayContext, preDownloadedImages) {
    if (!ebayContext?.draftId) return false;

    console.log('[DropFlow] ensurePhotosInDraft: uploading via EPS + draft PUT...');

    // Build File objects from images
    const files = [];
    const maxImages = Math.min(imageUrls.length, 12);
    const hasPreDownloaded = Array.isArray(preDownloadedImages) && preDownloadedImages.some(d => d !== null);

    for (let i = 0; i < maxImages; i++) {
      try {
        let dataUrl = null;
        if (hasPreDownloaded && i < preDownloadedImages.length && preDownloadedImages[i]) {
          dataUrl = preDownloadedImages[i];
        } else if (imageUrls[i]) {
          const url = imageUrls[i].startsWith('//') ? 'https:' + imageUrls[i] : imageUrls[i];
          const response = await sendMessageSafe({ type: 'FETCH_IMAGE', url }, 15000);
          if (response?.success && response.dataUrl) dataUrl = response.dataUrl;
        }
        if (dataUrl) files.push(dataUrlToFile(dataUrl, `product-image-${i + 1}.jpg`));
      } catch (e) {
        console.warn(`[DropFlow] ensurePhotosInDraft: image ${i + 1} fetch failed:`, e.message);
      }
    }

    if (files.length === 0) return false;

    // Upload to EPS to get eBay-hosted URLs
    const epsUrls = await uploadFilesToEpsForUrls(files);
    if (epsUrls.length === 0) {
      console.warn('[DropFlow] ensurePhotosInDraft: EPS upload returned 0 URLs');
      return false;
    }

    // PUT to draft
    const putOk = await putDraftField({ pictures: { pictureUrl: epsUrls } }, ebayContext);
    if (putOk) {
      console.log(`[DropFlow] ensurePhotosInDraft: ${epsUrls.length} photos PUT to draft successfully`);
      return true;
    }

    console.warn('[DropFlow] ensurePhotosInDraft: draft PUT failed');
    return false;
  }

  async function putDraftField(data, ebayContext) {
    if (!ebayContext || !ebayContext.headers || !ebayContext.draftId) {
      console.warn('[DropFlow] Cannot PUT draft â€" no headers or draftId available');
      return false;
    }

    const url = `https://${location.host}/lstng/api/listing_draft/${ebayContext.draftId}?mode=AddItem`;

    try {
      const resp = await fetch(url, {
        method: 'PUT',
        headers: {
          ...ebayContext.headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      if (resp.ok) {
        console.log(`[DropFlow] Draft PUT successful:`, Object.keys(data));
        return true;
      } else {
        const text = await resp.text().catch(() => '');
        console.warn(`[DropFlow] Draft PUT failed (${resp.status}):`, text.substring(0, 200));
        return false;
      }
    } catch (e) {
      console.warn('[DropFlow] Draft PUT error:', e.message);
      return false;
    }
  }

  /**
   * Set per-variant prices via eBay's draft API (bypasses DOM/iframe entirely).
   * 1. GET the current draft to discover the variation structure eBay stored.
   * 2. Patch each SKU's price in the draft data.
   * 3. PUT the updated draft back.
   *
   * @param {object} productData - product data with .variations.skus[]
   * @param {object} ebayContext - { headers, draftId }
   * @returns {{ success: boolean, pricedCount: number }}
   */
  async function putVariationPricesViaDraftAPI(productData, ebayContext) {
    const result = { success: false, pricedCount: 0 };
    if (!ebayContext?.draftId || !ebayContext?.headers) return result;

    const variations = productData?.variations;
    const skus = variations?.skus || [];
    if (skus.length === 0) return result;

    // 1. GET current draft to discover the variation/SKU structure
    const draft = await getDraftData(ebayContext);
    if (!draft) {
      console.warn('[DropFlow] putVariationPricesViaDraftAPI: could not GET draft');
      return result;
    }

    console.log('[DropFlow] Draft API variation pricing: draft keys =', Object.keys(draft).join(', '));

    // Discover where eBay stores variation data — try multiple known shapes
    // Shape A: draft.variations[] (array of variation objects)
    // Shape B: draft.sku[] (array of SKU objects)
    // Shape C: draft.variationDetails.variations[]
    // Shape D: draft.variation[] with variationSpecifics + price
    const variationPaths = [
      draft.variations,
      draft.sku,
      draft.variationDetails?.variations,
      draft.variation,
      draft.SKU,
      draft.skus,
    ].filter(v => Array.isArray(v) && v.length > 0);

    // Log full draft structure keys for debugging (top 2 levels)
    const draftStructure = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        draftStructure[k] = Object.keys(v);
      } else if (Array.isArray(v)) {
        draftStructure[k] = `Array(${v.length})` + (v.length > 0 ? ': ' + JSON.stringify(Object.keys(v[0] || {})) : '');
      } else {
        draftStructure[k] = typeof v;
      }
    }
    console.log('[DropFlow] Draft structure:', JSON.stringify(draftStructure));

    // Build price lookup: normalized specifics values → price
    const norm = s => String(s || '').trim().toLowerCase();
    const priceLookup = [];
    for (const sku of skus) {
      const values = Object.values(sku.specifics || {}).map(norm).filter(Boolean);
      const price = computeVariantEbayPrice(sku, productData);
      if (values.length > 0 && price > 0) {
        const stock = sku.stock != null ? sku.stock : 1;
        if (stock <= 0 && skus.some(s => s.stock > 0)) continue; // Skip OOS
        priceLookup.push({ values, price, qty: 1 });
      }
    }

    if (priceLookup.length === 0) {
      console.warn('[DropFlow] putVariationPricesViaDraftAPI: no priced SKUs');
      return result;
    }

    // Helper: match a draft variation entry to our price lookup
    function matchDraftVariant(draftVariant) {
      // Extract specifics from draft variant — multiple possible shapes
      const specificsEntries = [];
      for (const key of ['variationSpecifics', 'specifics', 'nameValueList', 'variationSpecific']) {
        const val = draftVariant[key];
        if (Array.isArray(val)) {
          for (const item of val) {
            const name = item.name || item.Name || '';
            const value = item.value?.[0] || item.Value?.[0] || item.value || item.Value || '';
            if (value) specificsEntries.push(norm(String(value)));
          }
        } else if (val && typeof val === 'object') {
          for (const v of Object.values(val)) {
            if (typeof v === 'string') specificsEntries.push(norm(v));
            else if (Array.isArray(v) && v.length > 0) specificsEntries.push(norm(String(v[0])));
          }
        }
      }

      // Also check top-level string fields that look like specifics
      for (const [k, v] of Object.entries(draftVariant)) {
        if (typeof v === 'string' && /size|color|colour|style/i.test(k)) {
          specificsEntries.push(norm(v));
        }
      }

      if (specificsEntries.length === 0) return null;

      // Match against priceLookup
      let bestMatch = null, bestScore = 0;
      for (const entry of priceLookup) {
        let score = 0;
        for (const val of entry.values) {
          const re = new RegExp('\\b' + val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
          if (specificsEntries.some(s => s === val || re.test(s))) score++;
        }
        if (score > bestScore) { bestScore = score; bestMatch = entry; }
      }
      return bestMatch && bestScore >= bestMatch.values.length ? bestMatch : (bestMatch && bestScore > 0 ? bestMatch : null);
    }

    // Try to update variation prices in the draft
    if (variationPaths.length > 0) {
      const draftVariations = variationPaths[0];
      console.log(`[DropFlow] Draft has ${draftVariations.length} variation entries. Sample:`, JSON.stringify(draftVariations[0]).substring(0, 300));

      let pricedCount = 0;
      for (const dv of draftVariations) {
        const match = matchDraftVariant(dv);
        if (match) {
          // Set price in multiple possible locations
          if (dv.price !== undefined || dv.startPrice !== undefined) {
            if (typeof dv.price === 'object') {
              dv.price.value = String(match.price);
            } else if (typeof dv.startPrice === 'object') {
              dv.startPrice.value = String(match.price);
            } else {
              dv.price = { value: String(match.price), currency: 'AUD' };
            }
          } else {
            dv.price = { value: String(match.price), currency: 'AUD' };
          }
          // Set quantity
          if (dv.quantity !== undefined) {
            dv.quantity = match.qty;
          } else {
            dv.quantity = match.qty;
          }
          pricedCount++;
        }
      }

      console.log(`[DropFlow] Matched ${pricedCount}/${draftVariations.length} draft variants to prices`);

      if (pricedCount > 0) {
        // Determine which key the variations are stored under
        const draftKey = draft.variations === draftVariations ? 'variations'
          : draft.sku === draftVariations ? 'sku'
          : draft.variationDetails?.variations === draftVariations ? 'variationDetails'
          : draft.variation === draftVariations ? 'variation'
          : draft.SKU === draftVariations ? 'SKU'
          : draft.skus === draftVariations ? 'skus'
          : 'variations';

        let payload;
        if (draftKey === 'variationDetails') {
          payload = { variationDetails: { variations: draftVariations } };
        } else {
          payload = { [draftKey]: draftVariations };
        }

        console.log('[DropFlow] Putting variation prices via draft API...');
        const ok = await putDraftField(payload, ebayContext);
        if (ok) {
          result.success = true;
          result.pricedCount = pricedCount;
          console.log(`[DropFlow] ✅ Draft API variation pricing SUCCESS: ${pricedCount} variants priced`);
        } else {
          console.warn('[DropFlow] Draft API variation pricing PUT failed — trying alternate payload shapes');
          // Try alternate shapes
          const altPayloads = [
            { variations: draftVariations },
            { sku: draftVariations },
            { variation: draftVariations },
          ].filter(p => Object.keys(p)[0] !== draftKey);

          for (const altPayload of altPayloads) {
            const altOk = await putDraftField(altPayload, ebayContext);
            if (altOk) {
              result.success = true;
              result.pricedCount = pricedCount;
              console.log(`[DropFlow] ✅ Draft API variation pricing SUCCESS (alt key "${Object.keys(altPayload)[0]}"): ${pricedCount} variants`);
              break;
            }
          }
        }
      }
    } else {
      console.warn('[DropFlow] Draft has no variation array. Trying to construct variation payload from scratch...');
      // Construct variations from our SKU data and PUT them
      const constructedVariations = priceLookup.map(entry => {
        const specifics = [];
        // Reconstruct specifics from the original SKU
        const matchingSku = skus.find(sku => {
          const vals = Object.values(sku.specifics || {}).map(norm).filter(Boolean);
          return vals.length === entry.values.length && vals.every((v, i) => v === entry.values[i]);
        });
        if (matchingSku) {
          for (const [name, value] of Object.entries(matchingSku.specifics || {})) {
            specifics.push({ name, value: [String(value)] });
          }
        }
        return {
          variationSpecifics: specifics,
          price: { value: String(entry.price), currency: 'AUD' },
          quantity: entry.qty,
        };
      });

      // Try multiple payload shapes
      const payloadsToTry = [
        { variations: constructedVariations },
        { sku: constructedVariations },
        { variation: constructedVariations },
      ];

      for (const payload of payloadsToTry) {
        console.log(`[DropFlow] Trying constructed variation payload (key="${Object.keys(payload)[0]}")...`);
        const ok = await putDraftField(payload, ebayContext);
        if (ok) {
          result.success = true;
          result.pricedCount = constructedVariations.length;
          console.log(`[DropFlow] ✅ Constructed variation pricing PUT succeeded (key="${Object.keys(payload)[0]}")`);
          break;
        }
      }
    }

    if (!result.success) {
      console.warn('[DropFlow] ❌ Draft API variation pricing failed — all approaches exhausted');
    }

    return result;
  }

  /**
   * Match an AliExpress variation axis name to an eBay item specific label.
   * Handles spelling differences (Color/Colour), locale-specific names, etc.
   * Returns the matching eBay label or null.
   */
  function matchAxisToEbaySpecific(axisName, specificLabels) {
    const lower = axisName.toLowerCase().trim();

    // Exact match (case-insensitive)
    const exact = specificLabels.find(l => l.toLowerCase().trim() === lower);
    if (exact) return exact;

    // Common aliases: AliExpress name â†' possible eBay names
    const aliasMap = {
      'color': ['colour', 'main colour', 'main color'],
      'colour': ['color', 'main color', 'main colour'],
      'size': ['garment size', 'us size', 'uk size', 'eu size', 'au size', 'shoe size'],
      'material': ['upper material', 'outer shell material', 'fabric type', 'compatible model'],
      'compatible model': ['model', 'device model', 'phone model'],
      'style': ['style code', 'type'],
      'pattern': ['design'],
      'length': ['sleeve length', 'dress length']
    };

    const aliases = aliasMap[lower] || [];
    for (const alias of aliases) {
      const match = specificLabels.find(l => l.toLowerCase().trim() === alias);
      if (match) return match;
    }

    // Blacklist: eBay labels that should never be matched as variation axes.
    // "Features" is a predefined attribute on some categories (e.g., dog collars)
    // that only accepts a small set of values — not suitable for color/size axes.
    // "Character" / "Character Family" are for licensed merchandise, not device models or colors.
    const blacklistedLabels = new Set([
      'features', 'department', 'occasion', 'season', 'theme',
      'character', 'character family', 'franchise'
    ]);

    // Partial match — axis name contained in label or vice versa
    const partial = specificLabels.find(l => {
      const ll = l.toLowerCase().trim();
      if (blacklistedLabels.has(ll)) return false;
      return (ll.includes(lower) || lower.includes(ll)) && Math.abs(ll.length - lower.length) < 10;
    });
    if (partial) return partial;

    return null;
  }

  function normalizeVariationAxisName(name) {
    let n = String(name || '').replace(/\s+/g, ' ').trim();
    if (n.includes(':')) n = n.split(':')[0].trim(); // "Color: Black" -> "Color"
    n = n.replace(/\s*\(\d+\)\s*$/, '').trim();
    return n;
  }

  function sanitizeVariationAxes(rawAxes) {
    let axes = (Array.isArray(rawAxes) ? rawAxes : []).map(axis => ({
      ...axis,
      name: normalizeVariationAxisName(axis?.name || '')
    })).filter(axis => axis.name && Array.isArray(axis.values) && axis.values.length >= 2);

    // Drop axes whose names are clearly value blobs (e.g. "XSSMXLXL")
    axes = axes.filter(axis => {
      const n = axis.name;
      if (!/\s/.test(n) && /^[A-Za-z0-9]+$/.test(n) && n.length >= 7) {
        const upper = n.toUpperCase();
        const compactVals = axis.values
          .map(v => String(v?.name || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
          .filter(Boolean);
        if (compactVals.length >= 2 && compactVals.every(v => upper.includes(v))) return false;
      }
      return !axis.values.some(v => String(v?.name || '').toLowerCase() === n.toLowerCase());
    });

    // Deduplicate by axis name
    const byName = new Map();
    for (const axis of axes) {
      const key = axis.name.toLowerCase();
      const prev = byName.get(key);
      if (!prev || (axis.values?.length || 0) > (prev.values?.length || 0)) byName.set(key, axis);
    }
    axes = Array.from(byName.values());

    // Keep strongest two axes for eBay variation editor
    if (axes.length > 2) {
      const score = (a) =>
        (/(color|colour|size|style|material|pattern|type|model)/i.test(a.name) ? 100 : 0) + (a.values?.length || 0);
      axes = axes.sort((a, b) => score(b) - score(a)).slice(0, 2);
    }

    if (axes.length === 0) {
      axes = (Array.isArray(rawAxes) ? rawAxes : [])
        .map(axis => ({ ...axis, name: normalizeVariationAxisName(axis?.name || '') }))
        .filter(axis => axis.name && Array.isArray(axis.values) && axis.values.length >= 2)
        .slice(0, 2);
    }
    return axes;
  }


  /**
   * Resolve per-variant eBay target price.
   * Prefer precomputed sku.ebayPrice; fallback to supplier sku.price × 1.3.
   */
  function computeVariantEbayPrice(sku, productData = null) {
    const explicit = Number(sku?.ebayPrice);
    if (Number.isFinite(explicit) && explicit > 0) return Number(explicit.toFixed(2));

    const supplier = Number(sku?.price);
    if (Number.isFinite(supplier) && supplier > 0) {
      return Number((supplier * 1.3).toFixed(2));
    }

    const fallback = Number(productData?.ebayPrice || 0);
    return Number.isFinite(fallback) && fallback > 0 ? Number(fallback.toFixed(2)) : 0;
  }


  // ============================
  // Multi-Variation Listing Support
  // ============================

  /**
   * Fill variations on the eBay listing.
   * Strategy 1: Try multiple draft API payload formats (eBay silently ignores wrong formats).
   * Strategy 2: DOM interaction â€" click Edit, interact with the variation editor UI.
   * Returns true if successful, false otherwise (caller falls back to single-SKU).
   */
  /**
   * Dismiss variation-related confirmation dialogs (standalone version for use outside builder flow).
   * Used by fillVariations and other callers that don't have the builder's activeDoc.
   */
  async function dismissVariationDialogs(maxAttempts = 3, root = document) {
    let dismissed = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const dialogs = queryAllWithShadow('[role="dialog"], [role="alertdialog"], .lightbox-dialog, .overlay-dialog, [class*="modal"], [class*="dialog"]', root)
        .filter(el => isElementVisible(el));

      for (const dialog of dialogs) {
        const text = (dialog.textContent || '').toLowerCase();
        const buttons = queryAllWithShadow('button, [role="button"]', dialog).filter(b => isElementVisible(b));

        if (text.includes('delete variations') || text.includes('delete all variations')) {
          const yesBtn = buttons.find(b => /^\s*yes\s*$/i.test((b.textContent || '').trim()));
          if (yesBtn) {
            console.log('[DropFlow] Dismissing "Delete variations" dialog → clicking Yes');
            simulateClick(yesBtn);
            await sleep(500);
            dismissed = true;
            continue;
          }
        }

        if (text.includes('update variations') || text.includes('we\'re about to automatically')) {
          const continueBtn = buttons.find(b => /^\s*continue\s*$/i.test((b.textContent || '').trim()));
          if (continueBtn) {
            console.log('[DropFlow] Dismissing "Update variations" dialog → clicking Continue');
            simulateClick(continueBtn);
            await sleep(500);
            dismissed = true;
            continue;
          }
        }

        if (text.includes('are you sure') || text.includes('confirm')) {
          const confirmBtn = buttons.find(b => /^\s*(yes|ok|continue|confirm)\s*$/i.test((b.textContent || '').trim()));
          if (confirmBtn) {
            console.log('[DropFlow] Dismissing generic confirmation dialog');
            simulateClick(confirmBtn);
            await sleep(500);
            dismissed = true;
            continue;
          }
        }
      }

      if (!dismissed) break;
      await sleep(300);
      dismissed = false;
    }
    return dismissed;
  }

  async function fillVariations(productData) {
    console.log('[DropFlow] ▶ fillVariations() ENTERED');
    const variations = productData.variations;
    if (!variations?.hasVariations) {
      console.log('[DropFlow] No variations to fill (hasVariations is false)');
      return false;
    }

    // --- Early exit: if the parent page already has a variations/combinations table,
    // fill prices DIRECTLY here and skip the entire builder flow.
    // This avoids the broken MSKU builder iframe approach entirely.
    if (IS_TOP_FRAME) {
      const varSection = findVariationsSection();
      if (varSection) {
        // Check multiple structures: real <table>, div-based grids, or any inputs
        const existingTable = varSection.querySelector('table');
        const tableRows = existingTable ? existingTable.querySelectorAll('tr').length : 0;
        const allInputs = varSection.querySelectorAll('input[type="text"], input[type="number"], input:not([type])');
        const priceInputs = Array.from(allInputs).filter(i => {
          const hints = `${i.placeholder || ''} ${i.getAttribute('aria-label') || ''} ${i.name || ''} ${i.id || ''}`.toLowerCase();
          return /price|amount|\$/.test(hints);
        });
        // Also check for div-based rows with role="row" or grid patterns
        const divRows = varSection.querySelectorAll('[role="row"], [class*="row"], [class*="combination"], [class*="variant"]');

        const hasExistingVariations = tableRows >= 3 || priceInputs.length >= 1 || divRows.length >= 2;

        console.log(`[DropFlow] fillVariations: early exit check — varSection found, ` +
          `tableRows=${tableRows}, priceInputs=${priceInputs.length}, divRows=${divRows.length}, ` +
          `hasExisting=${hasExistingVariations}`);
        console.log(`[DropFlow] fillVariations: varSection tag=${varSection.tagName}, ` +
          `class="${(varSection.className || '').toString().slice(0, 100)}", ` +
          `textSnippet="${(varSection.textContent || '').slice(0, 200).replace(/\s+/g, ' ')}"`);

        if (hasExistingVariations) {
          console.log('[DropFlow] fillVariations: variations already exist on parent page — ' +
            'filling prices directly, skipping builder entirely.');
          await logVariationStep('fillVariations:existingTableDetected', {
            tableRows, priceInputs: priceInputs.length, divRows: divRows.length,
          });
          // Fill prices directly using the combinations table filler
          try {
            const comboResult = await fillVariationCombinationsTable(productData);
            console.log(`[DropFlow] fillVariations: direct price fill result: ` +
              `${comboResult.filledPrices} prices, ${comboResult.filledQuantities} qty, ` +
              `${comboResult.totalRows} rows, success=${comboResult.success}`);
            await logVariationStep('fillVariations:directPriceFillComplete', comboResult);
          } catch (err) {
            console.error('[DropFlow] fillVariations: direct price fill error:', err);
          }
          return true; // Signal success — prices already filled
        }
      } else {
        console.log('[DropFlow] fillVariations: findVariationsSection() returned null on parent page');
      }
    }

    // If we're already on the dedicated variation builder screen, use that flow directly.
    const builderCtxAtStart = detectVariationBuilderContextWithLog('fillVariations:start');
    if (builderCtxAtStart.isBuilder) {
      // FIX: If this is an MSKU dialog detection (cross-origin iframe), we can't
      // run the builder flow from the parent page. Instead, inject form-filler
      // into the iframe and wait for the subframe instance to handle it.
      if (builderCtxAtStart.isMskuDialog && IS_TOP_FRAME) {
        // Double-check: is there ACTUALLY a visible MSKU iframe/dialog element?
        // The builder context detector can false-positive on listing pages that show
        // "Variations" text. Only delegate if we find the actual dialog/iframe.
        const actualMskuIframe = findMskuBulkeditIframe();
        const actualMskuDialog = document.querySelector('.msku-dialog, [class*="msku-dialog"]');
        if (!actualMskuIframe && !actualMskuDialog) {
          console.warn('[DropFlow] MSKU dialog detection was false positive (no iframe/dialog element found). ' +
            'Skipping iframe delegation — will attempt direct price fill instead.');
          await logVariationStep('fillVariations:mskuDialogFalsePositive', {
            url: window.location.href,
            signals: builderCtxAtStart.signals,
          });
          // Try to fill prices directly on the parent page
          try {
            const comboResult = await fillVariationCombinationsTable(productData);
            console.log(`[DropFlow] fillVariations: fallback direct price fill: ` +
              `${comboResult.filledPrices} prices, ${comboResult.totalRows} rows`);
            if (comboResult.success || comboResult.filledPrices > 0) return true;
          } catch (err) {
            console.error('[DropFlow] fillVariations: fallback direct price fill error:', err);
          }
          // If direct fill also failed, continue to the normal builder flow below
        }
        await logVariationStep('fillVariations:mskuDialogDelegateToIframe', { url: window.location.href });
        console.warn('[DropFlow] MSKU dialog detected in parent frame — delegating to iframe instance');
        
        // Inject form-filler into all frames (the MSKU iframe will pick it up)
        try {
          await sendMessageSafe({ type: 'INJECT_FORM_FILLER_IN_FRAMES', url: window.location.href }, 5000);
        } catch (e) {
          console.warn('[DropFlow] Iframe injection failed:', e.message);
        }
        
        // Wait for the iframe's form-filler to complete the builder flow.
        // It will store results or close the dialog when done.
        // Poll for up to 120s checking if variations got populated or dialog closed.
        const MSKU_DIALOG_WAIT_MAX = 30; // Cap at 30 iterations (~15s) to prevent infinite loops
        for (let wait = 0; wait < MSKU_DIALOG_WAIT_MAX; wait++) {
          await sleep(500);
          
          // Check if the MSKU dialog closed (builder flow completed)
          const dialogStillOpen = document.querySelector('.msku-dialog, [class*="msku-dialog"]');
          if (!dialogStillOpen) {
            console.warn(`[DropFlow] MSKU dialog closed after ${wait * 500}ms — checking variations`);
            await sleep(1000); // Let eBay sync
            if (checkVariationsPopulated()) {
              await logVariationStep('fillVariations:mskuDialogCompleted', { waitMs: wait * 500 });
              const cleaned = sanitizeVariationAxes(variations.axes || []);
              const axisNameMap = Object.fromEntries(cleaned.map(a => [a.name, a.name]));
              return { filledAxes: cleaned.map(a => a.name), axisNameMap };
            }
            break;
          }
          
          // Re-inject every 15 seconds in case the iframe navigated
          if (wait > 0 && wait % 30 === 0) {
            try {
              await sendMessageSafe({ type: 'INJECT_FORM_FILLER_IN_FRAMES', url: window.location.href }, 5000);
            } catch (_) {}
          }
          
          // Check builder completion flag from iframe
          if (wait > 10 && wait % 5 === 0) {
            try {
              const stored = await chrome.storage.local.get('dropflow_builder_complete');
              const completionData = stored?.dropflow_builder_complete;
              if (completionData && (Date.now() - completionData.ts) < 120000) {
                console.warn(`[DropFlow] Builder completion flag detected in early loop (age=${Date.now() - completionData.ts}ms)`);
                await sleep(2000);
                try { await chrome.storage.local.remove('dropflow_builder_complete'); } catch (_) {}
                if (checkVariationsPopulated()) {
                  await logVariationStep('fillVariations:mskuDialogCompletedViaFlag', { waitMs: wait * 500 });
                  const cleaned = sanitizeVariationAxes(variations.axes || []);
                  const axisNameMap = Object.fromEntries(cleaned.map(a => [a.name, a.name]));
                  return { filledAxes: cleaned.map(a => a.name), axisNameMap };
                }
              }
            } catch (_) {}
          }

          if (wait % 20 === 0) {
            console.log(`[DropFlow] Waiting for MSKU iframe builder flow... ${wait * 500}ms`);
          }
        }
        if (MSKU_DIALOG_WAIT_MAX <= 30) console.warn(`[DropFlow] MSKU dialog wait loop capped at ${MSKU_DIALOG_WAIT_MAX} iterations — falling through`);
        
        // Check one final time
        if (checkVariationsPopulated()) {
          await logVariationStep('fillVariations:mskuDialogCompletedLate', {});
          const cleaned = sanitizeVariationAxes(variations.axes || []);
          const axisNameMap = Object.fromEntries(cleaned.map(a => [a.name, a.name]));
          return { filledAxes: cleaned.map(a => a.name), axisNameMap };
        }
        
        await logVariationStep('fillVariations:mskuDialogTimeout', {});
        console.warn('[DropFlow] MSKU iframe builder flow timed out');
        return false;
      }
      
      await logVariationStep('fillVariations:directVariationBuilder', { url: window.location.href });
      const ok = await runVariationBuilderPageFlow(productData, [], builderCtxAtStart.doc);
      if (!ok) return false;
      const cleaned = sanitizeVariationAxes(variations.axes || []);
      const axisNameMap = Object.fromEntries(cleaned.map(a => [a.name, a.name]));
      return { filledAxes: cleaned.map(a => a.name), axisNameMap };
    }

    const cleanedAxes = sanitizeVariationAxes(variations.axes || []);
    if (cleanedAxes.length > 0) {
      if ((variations.axes || []).length !== cleanedAxes.length ||
          (variations.axes || []).some((a, i) => (a?.name || '') !== (cleanedAxes[i]?.name || ''))) {
        console.log(`[DropFlow] Sanitized variation axes: [${cleanedAxes.map(a => a.name).join(', ')}]`);
      }
      variations.axes = cleanedAxes;
    }

    // Filter to in-stock SKUs. If stock data is unavailable (all zeroes AND no
    // stock field was ever set by the scraper), assume all are in stock.
    // But if some SKUs have stock>0 and others have stock=0, trust the data —
    // those with stock=0 are genuinely out of stock and should get quantity 0.
    let inStockSkus;
    const hasAnyStockData = variations.skus.some(s => s.stock > 0);
    if (hasAnyStockData) {
      // Real stock data exists — EXCLUDE out-of-stock SKUs entirely (don't list them)
      inStockSkus = variations.skus.filter(s => s.stock > 0);
      const outOfStock = variations.skus.length - inStockSkus.length;
      if (outOfStock > 0) {
        console.log(`[DropFlow] Excluding ${outOfStock}/${variations.skus.length} out-of-stock SKUs from listing`);
      }
    } else {
      // No stock data at all — product is listed on AliExpress so assume available
      console.log('[DropFlow] All SKUs have stock=0, assuming all in stock (stock data unavailable from API)');
      inStockSkus = variations.skus.map(s => ({ ...s, stock: 1 }));
    }
    if (inStockSkus.length === 0) {
      console.warn('[DropFlow] No variation SKUs at all');
      return false;
    }

    // Prune axes to only include option values that appear in in-stock SKUs
    for (const axis of variations.axes) {
      const inStockValues = new Set();
      for (const sku of inStockSkus) {
        const val = Object.entries(sku.specifics || {}).find(([k]) => k.toLowerCase() === axis.name.toLowerCase());
        if (val) inStockValues.add(val[1]);
      }
      const beforeCount = axis.values.length;
      axis.values = axis.values.filter(v => inStockValues.has(v.name));
      if (axis.values.length < beforeCount) {
        console.log(`[DropFlow] Pruned axis "${axis.name}": ${beforeCount} → ${axis.values.length} values (removed OOS-only options)`);
      }
    }

    const axesSummary = variations.axes.map(a => `${a.name}(${a.values.length})`).join(' × ');
    console.log(`[DropFlow] Filling variations via DOM automation: ${axesSummary} = ${inStockSkus.length} in-stock SKUs`);
    await logVariationStep('fillVariations:start', { axes: axesSummary, skuCount: inStockSkus.length });

    // =====================================================
    // Phase 1: Map AliExpress axes to eBay specific names
    // =====================================================
    console.log('[DropFlow] fillVariations: scrolling page...');
    await scrollPageToLoadAll();
    await sleep(1000);
    console.log('[DropFlow] fillVariations: scroll complete, enumerating specifics...');

    const requiredFields = enumerateRequiredSpecifics();
    const fieldLabels = requiredFields.map(f => f.label);
    console.log(`[DropFlow] eBay required specifics: [${fieldLabels.join(', ')}]`);
    await logVariationStep('fillVariations:specificsFound', { fieldLabels, count: fieldLabels.length });

    const axisMapping = []; // { axis, ebayLabel }
    for (const axis of variations.axes) {
      if (/ships?\s*from/i.test(axis.name)) {
        console.log(`[DropFlow] Skipping non-product axis: "${axis.name}"`);
        continue;
      }
      // Fix 1: skip axes with no values after in-stock pruning (e.g. empty MPN axis)
      if (!axis.values || axis.values.length === 0) {
        console.log(`[DropFlow] Skipping empty-value axis: "${axis.name}"`);
        continue;
      }
      const ebayLabel = matchAxisToEbaySpecific(axis.name, fieldLabels);
      if (ebayLabel) {
        axisMapping.push({ axis, ebayLabel });
        console.log(`[DropFlow] Axis "${axis.name}" â†' eBay specific "${ebayLabel}"`);
      } else {
        console.warn(`[DropFlow] Axis "${axis.name}" has no matching eBay specific in [${fieldLabels.join(', ')}]`);
      }
    }

    if (axisMapping.length === 0) {
      // Fallback: required specifics may only contain Brand/UPC at this stage.
      // Fix 1: filter out axes with no values before taking the first 2
      const validAxes = (variations.axes || [])
        .filter(axis => axis.values && axis.values.length > 0)
        .slice(0, 2);
      for (const axis of validAxes) {
        if (!axis?.name) continue;
        axisMapping.push({ axis, ebayLabel: axis.name });
      }
      if (axisMapping.length > 0) {
        console.warn('[DropFlow] No axis matched required specifics; using AliExpress axis names directly');
        await logVariationStep('fillVariations:axisMappingFallback', {
          fieldLabels,
          fallbackAxes: axisMapping.map(m => m.axis.name)
        });
      } else {
        console.warn('[DropFlow] No variation axes available after sanitization');
        await logVariationStep('fillVariations:noAxisMatch', { fieldLabels });
        return false;
      }
    }

    const axisNameMap = Object.fromEntries(axisMapping.map(m => [m.axis.name, m.ebayLabel]));
    await logVariationStep('fillVariations:axisMapping', { axisNameMap });

    // Builder UI can appear asynchronously after navigation; re-check before
    // attempting any settings / 3-dot flow.
    const preEnableBuilderCtx = detectVariationBuilderContextWithLog('fillVariations:preEnable');
    if (preEnableBuilderCtx.isBuilder) {
      if (preEnableBuilderCtx.isMskuDialog && IS_TOP_FRAME) {
        // MSKU dialog already open — delegate to iframe
        await logVariationStep('fillVariations:builderDetectedBeforeEnable:mskuDialog', { url: window.location.href });
        try { await sendMessageSafe({ type: 'INJECT_FORM_FILLER_IN_FRAMES', url: window.location.href }, 5000); } catch (_) {}
        const PRE_ENABLE_MSKU_MAX = 30; // Cap at 30 iterations (~15s)
        for (let mw = 0; mw < PRE_ENABLE_MSKU_MAX; mw++) {
          await sleep(500);
          if (!document.querySelector('.msku-dialog') && checkVariationsPopulated()) {
            const filledAxes = axisMapping.map(m => m.ebayLabel);
            return { filledAxes, axisNameMap };
          }
          if (mw > 0 && mw % 30 === 0) {
            try { await sendMessageSafe({ type: 'INJECT_FORM_FILLER_IN_FRAMES', url: window.location.href }, 5000); } catch (_) {}
          }
        }
        console.warn(`[DropFlow] Pre-enable MSKU dialog wait capped at ${PRE_ENABLE_MSKU_MAX} iterations — falling through`);
        return false;
      }
      await logVariationStep('fillVariations:builderDetectedBeforeEnable', { url: window.location.href });
      const ok = await runVariationBuilderPageFlow(productData, axisMapping, preEnableBuilderCtx.doc);
      if (!ok) return false;
      const filledAxes = axisMapping.map(m => m.ebayLabel);
      return { filledAxes, axisNameMap };
    }

    // =====================================================
    // Phase A: Ensure VARIATIONS controls are reachable
    // =====================================================
    console.log('[DropFlow] ▶ fillVariations Phase A: ensuring variations controls are reachable');
    // Important: variations may already be enabled from a previous run or by user action.
    // If Edit is already visible, skip settings toggle entirely.
    let preFoundEditBtn = findVariationEditButton();
    if (preFoundEditBtn) {
      console.log('[DropFlow] Variations Edit already visible; skipping settings toggle');
      await logVariationStep('fillVariations:alreadyEnabled', {});
    } else {
      const urlBeforeEnable = window.location.href;
      const enabled = await ensureVariationsEnabled();

      if (enabled === 'builder') {
        // Toggle triggered navigation to builder page / opened MSKU dialog
        await logVariationStep('fillVariations:builderFromToggle', { url: window.location.href });
        const ctx = detectVariationBuilderContextWithLog('fillVariations:builderFromToggle');
        if (ctx.isMskuDialog && IS_TOP_FRAME) {
          // MSKU dialog — iframe handles the builder flow; continue to postEditClick loop
          // which will detect the MSKU dialog and wait for completion
        } else {
          const ok = await runVariationBuilderPageFlow(productData, axisMapping, ctx.doc);
          if (!ok) return false;
          const filledAxes = axisMapping.map(m => m.ebayLabel);
          return { filledAxes, axisNameMap };
        }
      }

      // Check for URL change that ensureVariationsEnabled() might have missed
      if (window.location.href !== urlBeforeEnable) {
        console.log(`[DropFlow] URL changed during ensureVariationsEnabled: ${urlBeforeEnable} -> ${window.location.href}`);
        await sleep(2000);
        const navCtx = detectVariationBuilderContextWithLog('fillVariations:urlChangePostEnable');
        if (navCtx.isBuilder) {
          if (navCtx.isMskuDialog && IS_TOP_FRAME) {
            // MSKU dialog — handled by iframe, continue
          } else {
            await logVariationStep('fillVariations:builderFromUrlChange', { url: window.location.href });
            const ok = await runVariationBuilderPageFlow(productData, axisMapping, navCtx.doc);
            if (!ok) return false;
            const filledAxes = axisMapping.map(m => m.ebayLabel);
            return { filledAxes, axisNameMap };
          }
        }
      }

      if (!enabled) {
        // Do NOT abort here. eBay often reports delayed section visibility even when toggle is ON.
        console.warn('[DropFlow] Could not verify VARIATIONS via settings; proceeding to Edit discovery');
        await logVariationStep('fillVariations:enableUnverifiedProceed', {});
      }
    }

    // =====================================================
    // Phase B: Click Edit/Create on the VARIATIONS section
    // =====================================================
    console.log('[DropFlow] ▶ fillVariations Phase B: clicking Edit/Create button');
    await sleep(1000);
    const variationsSection = findVariationsSection();
    if (variationsSection) await scrollToAndWait(variationsSection, 500);

    // Enhanced edit button search: also match "Create variation" text
    let editBtn = preFoundEditBtn || findVariationEditButton();
    if (!editBtn) {
      // Broader search: any clickable in the section area
      const section = findVariationsSection();
      if (section) {
        const allClickable = section.querySelectorAll('button, a, [role="button"], [role="link"]');
        for (const el of allClickable) {
          if (isElementVisible(el) && !el.disabled) {
            editBtn = el;
            break;
          }
        }
      }
      if (!editBtn) {
        // Last-resort: global scan for variation/options entry buttons.
        const globalCandidates = document.querySelectorAll('button, a, [role="button"], [role="link"]');
        for (const el of globalCandidates) {
          if (!isElementVisible(el) || el.disabled) continue;
          const text = (el.textContent || '').trim();
          const aria = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.trim();
          const haystack = `${text} ${aria}`;
          if (/title options|see title options/i.test(haystack)) continue;
          if (/(variation|variant)/i.test(haystack) && /(edit|add|create|manage|set|enable)/i.test(haystack)) {
            editBtn = el;
            break;
          }
        }
      }
    }

    // Retry loop: eBay often lazy-renders variation controls a few seconds later.
    if (!editBtn) {
      for (let attempt = 1; attempt <= 6 && !editBtn; attempt++) {
        // Check for builder navigation first (saves wasted polling)
        const retryBuilderCtx = detectVariationBuilderContextWithLog(`fillVariations:editRetry:${attempt}`);
        if (retryBuilderCtx.isBuilder) {
          if (retryBuilderCtx.isMskuDialog && IS_TOP_FRAME) {
            try { await sendMessageSafe({ type: 'INJECT_FORM_FILLER_IN_FRAMES', url: window.location.href }, 5000); } catch (_) {}
            continue; // Let iframe handle it; keep looking for edit button or dialog close
          }
          await logVariationStep('fillVariations:builderDetectedInEditRetry', { attempt });
          const ok = await runVariationBuilderPageFlow(productData, axisMapping, retryBuilderCtx.doc);
          if (!ok) return false;
          const filledAxes = axisMapping.map(m => m.ebayLabel);
          return { filledAxes, axisNameMap };
        }

        await logVariationStep('fillVariations:waitingForEditButton', { attempt });
        await sleep(1200);
        await scrollPageToLoadAll();
        if (attempt === 2 || attempt === 4) {
          const hasSection = !!findVariationsSection();
          const hasEdit = !!findVariationEditButton();
          if (!hasSection || !hasEdit) {
            try {
              const enableResult = await ensureVariationsEnabled();
              if (enableResult === 'builder') {
                const ctx = detectVariationBuilderContextWithLog('fillVariations:builderFromRetryToggle');
                if (ctx.isMskuDialog && IS_TOP_FRAME) {
                  // iframe handles it; continue retry loop
                } else {
                  const ok = await runVariationBuilderPageFlow(productData, axisMapping, ctx.doc);
                  if (!ok) return false;
                  const filledAxes = axisMapping.map(m => m.ebayLabel);
                  return { filledAxes, axisNameMap };
                }
              }
            } catch (_) {}
          }
        }
        editBtn = findVariationEditButton();
      }
    }

    if (!editBtn) {
      console.warn('[DropFlow] No Edit/Create button found in VARIATIONS section');
      const candidates = queryAllWithShadow('button, a, [role="button"], [role="link"], [role="menuitem"]')
        .filter(el => isElementVisible(el))
        .map(el => ({
          text: (el.textContent || '').trim().substring(0, 60),
          aria: (el.getAttribute('aria-label') || '').substring(0, 60),
          testid: (el.getAttribute('data-testid') || '').substring(0, 60),
          cls: (String(el.className || '')).substring(0, 60)
        }))
        .filter(c => /(variation|option|variant)/i.test(`${c.text} ${c.aria} ${c.testid} ${c.cls}`))
        .slice(0, 20);
      await logVariationStep('fillVariations:noEditButton', { candidates });
      return false;
    }

    console.log(`[DropFlow] Clicking VARIATIONS Edit: "${editBtn.textContent?.trim().substring(0, 40)}"`);
    await scrollToAndWait(editBtn, 500);
    const preEditUrl = window.location.href;
    simulateClick(editBtn);
    await logVariationStep('fillVariations:clickedEdit', { text: editBtn.textContent?.trim()?.substring(0, 40) });

    // Dedicated flow: some eBay forms open a full-page "Create your variations" screen.
    // Capped at 30 iterations (~9s) to prevent infinite loops. If the builder hasn't
    // completed by then, we break out and fall through to putVariationPricesViaDraftAPI().
    const BUILDER_LOOP_MAX = 30;
    let builderLoopExhausted = false;
    for (let navWait = 0; navWait < BUILDER_LOOP_MAX; navWait++) {
      await sleep(300);
      const navCtx = (navWait % 10 === 0)
        ? detectVariationBuilderContextWithLog(`fillVariations:postEditClick:${navWait}`)
        : detectVariationBuilderContext();
      if (navCtx.isBuilder) {
        // FIX: If this is an MSKU dialog (cross-origin iframe), don't try to run
        // the builder flow from the parent — the iframe's content script handles it.
        // Just wait for the iframe to complete and close the dialog.
        if (navCtx.isMskuDialog && IS_TOP_FRAME) {
          await logVariationStep('fillVariations:variationBuilderDetected:mskuDialog', {
            from: preEditUrl,
            to: window.location.href,
            iter: navWait
          });
          // Request injection into the iframe
          try {
            await sendMessageSafe({ type: 'INJECT_FORM_FILLER_IN_FRAMES', url: window.location.href }, 5000);
          } catch (_) {}
          // Continue the loop — the iframe will handle the builder flow.
          // We'll detect completion via checkVariationsPopulated() or dialog close below.
          continue;
        }
        
        await logVariationStep('fillVariations:variationBuilderDetected', {
          from: preEditUrl,
          to: window.location.href
        });
        const ok = await runVariationBuilderPageFlow(productData, axisMapping, navCtx.doc);
        if (!ok) return false;
        const filledAxes = axisMapping.map(m => m.ebayLabel);
        return { filledAxes, axisNameMap };
      }

      // Quick-check: MSKU bulkedit iframe appears after edit click.
      // The bulkedit iframe is CROSS-ORIGIN (bulkedit.ebay.com.au vs www.ebay.com.au)
      // so we CAN'T access its contentDocument from the main frame.
      // Instead, we ask the SW to inject form-filler into the iframe.
      // The iframe's own form-filler instance will detect it's a builder and run the flow.
      {
        const mskuFrame = findMskuBulkeditIframe();
        if (mskuFrame) {
          // Try direct access first (same-origin case)
          try {
            const fdoc = mskuFrame.contentDocument;
            if (fdoc?.body) {
              const textLen = (fdoc.body.textContent || '').length;
              if (textLen > 200) {
                console.warn(`[DropFlow] MSKU iframe loaded in postEditClick loop (iter=${navWait}): textLen=${textLen}`);
                await logVariationStep('fillVariations:mskuIframeReady', { textLen, iter: navWait });
                const ok = await runVariationBuilderPageFlow(productData, axisMapping, fdoc);
                if (ok) {
                  const filledAxes = axisMapping.map(m => m.ebayLabel);
                  return { filledAxes, axisNameMap };
                }
              } else if (navWait % 10 === 0) {
                console.warn(`[DropFlow] MSKU iframe found but still loading: textLen=${textLen}, iter=${navWait}`);
              }
            }
          } catch (e) {
            // Cross-origin iframe — request SW to inject form-filler into the iframe
            if (navWait % 10 === 0) {
              console.warn(`[DropFlow] MSKU iframe cross-origin (iter=${navWait}): ${e.message}. Requesting SW injection...`);
              try {
                await sendMessageSafe({
                  type: 'INJECT_FORM_FILLER_IN_FRAMES',
                  url: window.location.href
                }, 5000);
              } catch (swErr) {
                console.warn(`[DropFlow] SW injection request failed: ${swErr.message}`);
              }
            }

            // After iframe has had time to load and run builder (>60 iterations = 18s),
            // also send FILL_MSKU_PRICES as backup for cross-origin price filling
            if (navWait === 80 || navWait === 150 || navWait === 220) {
              const variations = productData.variations;
              if (variations?.skus?.length > 0) {
                try {
                  const result = await sendMessageSafe({
                    type: 'FILL_MSKU_PRICES',
                    skus: variations.skus,
                    defaultPrice: productData.ebayPrice || 0
                  }, 15000);
                  if (result?.filled > 0) {
                    console.log(`[DropFlow] FILL_MSKU_PRICES filled ${result.filled} prices in MSKU iframe`);
                  }
                } catch (priceErr) {
                  console.warn(`[DropFlow] FILL_MSKU_PRICES failed: ${priceErr.message}`);
                }
              }
            }
          }
        }
      }
      
      // FIX: Check if the builder signalled completion via storage flag
      if (navWait > 10 && navWait % 5 === 0) {
        try {
          const stored = await chrome.storage.local.get('dropflow_builder_complete');
          const completionData = stored?.dropflow_builder_complete;
          if (completionData && (Date.now() - completionData.ts) < 120000) {
            console.warn(`[DropFlow] Builder completion flag detected (age=${Date.now() - completionData.ts}ms, iter=${navWait})`);
            await sleep(2000); // Let eBay sync
            try { await chrome.storage.local.remove('dropflow_builder_complete'); } catch (_) {}
            if (checkVariationsPopulated()) {
              await logVariationStep('fillVariations:builderCompleteFlag', { iter: navWait });
              const filledAxes = axisMapping.map(m => m.ebayLabel);
              return { filledAxes, axisNameMap };
            }
          }
        } catch (_) {}
      }

      // FIX: Check if the MSKU dialog closed (iframe builder completed "Save and close")
      if (navWait > 20) {
        const mskuDialogGone = !document.querySelector('.msku-dialog, [class*="msku-dialog"]');
        const mskuIframeGone = !document.querySelector('iframe[src*="msku"]');
        if (mskuDialogGone && mskuIframeGone && checkVariationsPopulated()) {
          console.warn(`[DropFlow] MSKU dialog closed and variations populated (iter=${navWait})`);
          await logVariationStep('fillVariations:mskuDialogCompletedInLoop', { iter: navWait });
          const filledAxes = axisMapping.map(m => m.ebayLabel);
          return { filledAxes, axisNameMap };
        }
      }

      if (window.location.href !== preEditUrl && window.location.pathname.includes('/sl/prelist')) {
        await logVariationStep('fillVariations:prelistNavigationAfterEdit', {
          from: preEditUrl,
          to: window.location.href
        });
      }
      // Check if the builder iframe already saved and populated variations
      // Check every iteration after 20 (6s) since builder takes ~50s
      if (navWait >= 20 && checkVariationsPopulated()) {
        console.warn(`[DropFlow] Variations populated during postEditClick wait (iter=${navWait})`);
        await logVariationStep('fillVariations:populatedDuringWait', { iter: navWait });
        const filledAxes = axisMapping.map(m => m.ebayLabel);
        return { filledAxes, axisNameMap };
      }
      // Re-entry guard: if we just clicked "Save and close", allow eBay to sync
      // the combinations table before attempting any re-open/retry clicks.
      if (__dropflowVariationSaveCloseTs && (Date.now() - __dropflowVariationSaveCloseTs) < 90000) {
        if (checkVariationsPopulated()) {
          console.warn('[DropFlow] Save-and-close recently completed; variations already populated, skipping re-entry');
          const filledAxes = axisMapping.map(m => m.ebayLabel);
          return { filledAxes, axisNameMap };
        }
      }

    }
    // If loop exhausted without returning, log warning and fall through
    if (!builderLoopExhausted) {
      builderLoopExhausted = true;
    }
    console.warn(`[DropFlow] Builder loop exhausted after ${BUILDER_LOOP_MAX} iterations — falling through to draft API`);
    await logVariationStep('fillVariations:builderLoopExhausted', { maxIter: BUILDER_LOOP_MAX });

    // =====================================================
    // MSKU iframe wait: the bulkedit iframe may exist now but still loading.
    // Give it up to 30s to finish loading, then run builder flow.
    // =====================================================
    // First check if variations were already populated by the iframe builder
    if (checkVariationsPopulated()) {
      console.warn('[DropFlow] Variations already populated before MSKU iframe wait');
      await logVariationStep('fillVariations:alreadyPopulated', {});
      const filledAxes = axisMapping.map(m => m.ebayLabel);
      return { filledAxes, axisNameMap };
    }
    {
      const mskuIframe = findMskuBulkeditIframe();
      if (mskuIframe) {
        console.warn(`[DropFlow] MSKU iframe found after postEditClick loop: ${mskuIframe.src?.substring(0, 120)}`);
        await logVariationStep('fillVariations:mskuIframeWait', { src: mskuIframe.src?.substring(0, 200) });
        let iframeDoc = null;
        const IFRAME_POLL_MAX = 30; // Cap at 30 iterations (~15s)
        for (let poll = 0; poll < IFRAME_POLL_MAX; poll++) {
          try {
            const fdoc = mskuIframe.contentDocument;
            if (fdoc?.body) {
              const textLen = (fdoc.body.textContent || '').length;
              if (textLen > 200) {
                console.warn(`[DropFlow] MSKU iframe loaded after wait: textLen=${textLen}, polls=${poll}`);
                iframeDoc = fdoc;
                break;
              }
              if (poll % 10 === 0) {
                console.warn(`[DropFlow] MSKU iframe still loading: textLen=${textLen}, poll=${poll}`);
              }
            }
          } catch (e) {
            if (poll % 10 === 0) console.warn(`[DropFlow] MSKU iframe access error: ${e.message}`);
          }
          await sleep(500);
        }
        if (iframeDoc) {
          console.warn('[DropFlow] Running variation builder flow in MSKU iframe');
          await logVariationStep('fillVariations:mskuBuilderFlow', {});
          const ok = await runVariationBuilderPageFlow(productData, axisMapping, iframeDoc);
          if (ok) {
            const filledAxes = axisMapping.map(m => m.ebayLabel);
            return { filledAxes, axisNameMap };
          }
          console.warn('[DropFlow] MSKU iframe builder flow returned false - falling through to editor detect');
        } else {
          console.warn('[DropFlow] MSKU iframe content did not load in 30s');
          await logVariationStep('fillVariations:mskuIframeTimeout', {});

          // Parent frame cannot reliably read bulkedit iframe DOM. Try a direct
          // top-document builder attempt in case eBay rendered the builder inline.
          const forcedTopBuilder = await runVariationBuilderPageFlow(productData, axisMapping, document);
          if (forcedTopBuilder) {
            const filledAxes = axisMapping.map(m => m.ebayLabel);
            return { filledAxes, axisNameMap };
          }

          // Handoff fallback: wait for subframe automation to finish and return
          // control to the form with populated variations.
          const HANDOFF_WAIT_MAX = 30; // Cap at 30 iterations (~15s)
          for (let wait = 0; wait < HANDOFF_WAIT_MAX; wait++) {
            await sleep(500);
            if (checkVariationsPopulated()) {
              await logVariationStep('fillVariations:mskuHandoffPopulated', { wait });
              const filledAxes = axisMapping.map(m => m.ebayLabel);
              return { filledAxes, axisNameMap };
            }
          }
          console.warn(`[DropFlow] MSKU handoff wait capped at ${HANDOFF_WAIT_MAX} iterations — falling through`);
          await logVariationStep('fillVariations:mskuHandoffTimeout', {});
        }
      }
    }

    // Wait for the variation editor to open (modal, drawer, or inline),
    // including controls rendered inside open shadow roots.
    let editorContext = null;
    const detectEditorContext = () => {
      const modalCandidates = queryAllWithShadow(
        '[role="dialog"], [class*="modal" i], [class*="lightbox" i], ' +
        '[class*="drawer" i], [class*="overlay" i]:not([style*="display: none"])'
      );
      for (const modal of modalCandidates) {
        if (!isElementVisible(modal)) continue;
        const text = (modal.textContent || '').toLowerCase();
        const interactive = queryAllWithShadow(
          'input[type="text"], input:not([type]), select, [role="combobox"], ' +
          '[contenteditable="true"], [role="checkbox"], [role="radio"]',
          modal
        ).filter(isElementVisible).length;
        if (interactive >= 1 && /(variation|option|size|color|colour|create your own|add value)/i.test(text)) {
          return modal;
        }
      }

      const section = findVariationsSection();
      if (section) {
        const interactive = queryAllWithShadow(
          'input[type="text"], input:not([type]), select, [role="combobox"], ' +
          '[contenteditable="true"], [role="checkbox"], [role="radio"]',
          section
        ).filter(isElementVisible).length;
        if (interactive >= 1) return section;
      }

      const containers = queryAllWithShadow('section, fieldset, article, div[class], div[data-testid]');
      for (const c of containers) {
        if (!isElementVisible(c)) continue;
        const text = (c.textContent || '').toLowerCase().replace(/\s+/g, ' ');
        if (!/(variation|option|item option)/.test(text)) continue;
        const interactive = queryAllWithShadow(
          'input[type="text"], input:not([type]), select, [role="combobox"], [contenteditable="true"]',
          c
        ).filter(isElementVisible).length;
        if (interactive >= 1) return c;
      }
      return null;
    };

    const EDITOR_DETECT_MAX = 30; // Cap at 30 iterations (~13.5s)
    for (let attempt = 0; attempt < EDITOR_DETECT_MAX; attempt++) {
      await sleep(450);
      const lateCtx = (attempt % 10 === 0)
        ? detectVariationBuilderContextWithLog(`fillVariations:editorDetectLoop:${attempt}`)
        : detectVariationBuilderContext();
      if (lateCtx.isBuilder) {
        // FIX: Skip if MSKU dialog — let iframe handle it
        if (lateCtx.isMskuDialog && IS_TOP_FRAME) {
          if (attempt % 10 === 0) {
            try { await sendMessageSafe({ type: 'INJECT_FORM_FILLER_IN_FRAMES', url: window.location.href }, 5000); } catch (_) {}
          }
          if (checkVariationsPopulated()) {
            const filledAxes = axisMapping.map(m => m.ebayLabel);
            return { filledAxes, axisNameMap };
          }
          continue;
        }
        await logVariationStep('fillVariations:variationBuilderDetectedLate', {
          attempt,
          url: window.location.href
        });
        const ok = await runVariationBuilderPageFlow(productData, axisMapping, lateCtx.doc);
        if (!ok) return false;
        const filledAxes = axisMapping.map(m => m.ebayLabel);
        return { filledAxes, axisNameMap };
      }
      // Also check MSKU iframe in this loop
      {
        const mskuF = findMskuBulkeditIframe();
        if (mskuF) {
          try {
            const fdoc = mskuF.contentDocument;
            if (fdoc?.body && (fdoc.body.textContent || '').length > 200) {
              console.warn(`[DropFlow] MSKU iframe ready in editorDetectLoop (attempt=${attempt})`);
              await logVariationStep('fillVariations:mskuIframeReadyLate', { attempt });
              const ok = await runVariationBuilderPageFlow(productData, axisMapping, fdoc);
              if (ok) {
                const filledAxes = axisMapping.map(m => m.ebayLabel);
                return { filledAxes, axisNameMap };
              }
            }
          } catch (_) {}
        }
      }
      editorContext = detectEditorContext();
      if (editorContext) break;
      if (attempt === 4 || attempt === 9 || attempt === 14 || attempt === 24) {
        // Re-click in case first click opened/closed quickly due lazy hydration.
        simulateClick(editBtn);
      }
    }

    if (!editorContext) {
      const noEditorCtx = detectVariationBuilderContextWithLog('fillVariations:noEditorFallback');
      if (noEditorCtx.isBuilder) {
        // FIX: Skip if MSKU dialog — let iframe handle it
        if (noEditorCtx.isMskuDialog && IS_TOP_FRAME) {
          try { await sendMessageSafe({ type: 'INJECT_FORM_FILLER_IN_FRAMES', url: window.location.href }, 5000); } catch (_) {}
          // Wait a bit for iframe builder to complete
          const NO_EDITOR_MSKU_MAX = 30; // Cap at 30 iterations (~30s)
          for (let mw = 0; mw < NO_EDITOR_MSKU_MAX; mw++) {
            await sleep(1000);
            if (!document.querySelector('.msku-dialog') && checkVariationsPopulated()) {
              const filledAxes = axisMapping.map(m => m.ebayLabel);
              return { filledAxes, axisNameMap };
            }
          }
          console.warn(`[DropFlow] No-editor MSKU wait capped at ${NO_EDITOR_MSKU_MAX} iterations — falling through`);
        } else {
          await logVariationStep('fillVariations:variationBuilderDetectedNoEditor', { url: window.location.href });
          const ok = await runVariationBuilderPageFlow(productData, axisMapping, noEditorCtx.doc);
          if (!ok) return false;
          const filledAxes = axisMapping.map(m => m.ebayLabel);
          return { filledAxes, axisNameMap };
        }
      }
      editorContext = findVariationsSection() || document;
      console.warn('[DropFlow] Could not detect variation editor â€" using section/document as context');
    }
    console.log(`[DropFlow] Variation editor context: ${editorContext.tagName || 'DOCUMENT'}.${(editorContext.className || '').substring(0, 80)}`);
    await logVariationStep('fillVariations:editorOpened', {
      tag: editorContext.tagName || 'DOCUMENT',
      className: (editorContext.className || '').substring(0, 80)
    });

    // Log editor contents for debugging
    const editorInteractive = queryAllWithShadow(
      'input, select, button, [role="checkbox"], [role="radio"], [role="combobox"], [contenteditable="true"]',
      editorContext
    );
    console.log(`[DropFlow] Editor has ${editorInteractive.length} interactive elements`);
    for (let i = 0; i < Math.min(editorInteractive.length, 15); i++) {
      const el = editorInteractive[i];
      const label = el.closest('label')?.textContent?.trim() || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
      console.log(`[DropFlow]   ${el.tagName}[${el.type || el.role || ''}] "${label.substring(0, 50)}" val="${(el.value || '').substring(0, 20)}"`);
    }

    // =====================================================
    // Phase C: Select variation axes (Color, Size)
    // =====================================================
    let selectedAxes = 0;
    let axisInputsFound = 0;
    let axisValuesEntered = 0;

    // Try checkboxes matching axis names
    const checkboxes = queryAllWithShadow(
      'input[type="checkbox"], [role="checkbox"], input[type="radio"], [role="radio"]',
      editorContext
    );
    for (const cb of checkboxes) {
      const label = cb.closest('label') || cb.parentElement;
      const labelText = (label?.textContent || '').trim().toLowerCase();
      const ariaLabel = (cb.getAttribute('aria-label') || '').toLowerCase();
      const combinedText = labelText + ' ' + ariaLabel;
      const isChecked = cb.checked || cb.getAttribute('aria-checked') === 'true';

      for (const { axis, ebayLabel } of axisMapping) {
        const axisLower = axis.name.toLowerCase();
        const ebayLower = ebayLabel.toLowerCase();
        if ((combinedText.includes(axisLower) || combinedText.includes(ebayLower)) && !isChecked) {
          simulateClick(cb);
          console.log(`[DropFlow] Checked variation axis: "${label?.textContent?.trim()}" for ${axis.name}`);
          selectedAxes++;
          await sleep(800);
          break;
        }
      }
    }

    // Try dropdown/select elements
    if (selectedAxes === 0) {
      const selects = queryAllWithShadow('select', editorContext);
      for (const sel of selects) {
        for (const opt of sel.options) {
          const optText = opt.text.toLowerCase();
          for (const { axis, ebayLabel } of axisMapping) {
            if ((optText.includes(axis.name.toLowerCase()) || optText.includes(ebayLabel.toLowerCase())) && !opt.selected) {
              sel.value = opt.value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              console.log(`[DropFlow] Selected axis from dropdown: "${opt.text}"`);
              selectedAxes++;
              await sleep(800);
            }
          }
        }
      }
    }

    // Try clickable list items / buttons with axis names
    if (selectedAxes === 0) {
      const clickables = queryAllWithShadow(
        'button, a, [role="option"], [role="button"], [role="menuitem"], li, span[class*="option" i]',
        editorContext
      );
      for (const el of clickables) {
        if (!isElementVisible(el)) continue;
        const text = (el.textContent || '').trim().toLowerCase();
        if (text.length > 40) continue;
        for (const { axis, ebayLabel } of axisMapping) {
          if (text.includes(axis.name.toLowerCase()) || text.includes(ebayLabel.toLowerCase())) {
            simulateClick(el);
            console.log(`[DropFlow] Clicked axis option: "${el.textContent?.trim()}" for ${axis.name}`);
            selectedAxes++;
            await sleep(800);
            break;
          }
        }
      }
    }

    console.log(`[DropFlow] Selected ${selectedAxes} variation axes`);
    await logVariationStep('fillVariations:axesSelected', { count: selectedAxes });

    // Click Apply/Continue/Next if available
    const applyBtn1 = findButtonByText(editorContext, /^(apply|continue|next|add|confirm)\s*$/i);
    if (applyBtn1) {
      simulateClick(applyBtn1);
      console.log(`[DropFlow] Clicked "${applyBtn1.textContent?.trim()}" after axis selection`);
      await sleep(2000);
      await dismissVariationDialogs();
    }

    // =====================================================
    // Phase D: Enter values for each axis
    // =====================================================
    for (const { axis, ebayLabel } of axisMapping) {
      const values = axis.values.map(v => v.name);
      console.log(`[DropFlow] Entering values for ${axis.name} (eBay: ${ebayLabel}): ${values.join(', ')}`);

      // First try findAxisValueInput helper
      let input = findAxisValueInput(editorContext, ebayLabel) || findAxisValueInput(editorContext, axis.name);

      // Fallback: search by container text context
      if (!input) {
        const allInputs = queryAllWithShadow(
          'input[type="text"], input:not([type]), [contenteditable="true"], [role="combobox"]',
          editorContext
        );
        for (const inp of allInputs) {
          if (!isElementVisible(inp)) continue;
          const container = inp.closest('[class*="variation" i], [class*="group" i], section, div') || inp.parentElement?.parentElement;
          const containerText = (container?.textContent || '').toLowerCase();
          if (containerText.includes(axis.name.toLowerCase()) || containerText.includes(ebayLabel.toLowerCase())) {
            input = inp;
            break;
          }
        }
      }

      if (!input) {
        console.warn(`[DropFlow] No input found for axis ${axis.name}/${ebayLabel}`);
        await logVariationStep('fillVariations:noInputForAxis', { axis: axis.name, ebayLabel });
        continue;
      }
      axisInputsFound++;

      for (const value of values) {
        // Check if this value already exists as a chip/tag
        const existingChips = queryAllWithShadow(
          '[class*="chip" i], [class*="tag" i], [class*="pill" i], [class*="token" i]',
          editorContext
        );
        const alreadyExists = Array.from(existingChips).some(chip =>
          (chip.textContent || '').trim().toLowerCase() === value.toLowerCase()
        );
        if (alreadyExists) {
          console.log(`[DropFlow] Value "${value}" already exists as chip â€" skipping`);
          continue;
        }

        // Type the value using commitInputValue for React compat
        await commitInputValue(input, value);
        await sleep(300);

        // Check for suggestion dropdown and click matching suggestion
        const suggestions = queryAllWithShadow(
          '[role="listbox"] [role="option"], [class*="suggestion" i] li, ' +
          '[class*="dropdown" i] li, [class*="autocomplete" i] li, [class*="typeahead" i] li'
        );
        let foundSuggestion = false;
        for (const sug of suggestions) {
          if (!isElementVisible(sug)) continue;
          const sugText = (sug.textContent || '').trim().toLowerCase();
          if (sugText === value.toLowerCase() || sugText.includes(value.toLowerCase())) {
            simulateClick(sug);
            foundSuggestion = true;
            console.log(`[DropFlow] Clicked suggestion: "${sug.textContent?.trim()}"`);
            await sleep(300);
            break;
          }
        }

        if (!foundSuggestion) {
          // Press Enter to confirm the value
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          await sleep(200);

          // Try clicking Add button if present nearby
          const container = input.closest('[class*="group" i], [class*="field" i], div') || input.parentElement;
          const addBtn = container?.querySelector('button');
          if (addBtn && /add|plus|\+|create/i.test(addBtn.textContent || addBtn.getAttribute('aria-label') || '')) {
            simulateClick(addBtn);
            await sleep(200);
          }
        }

        console.log(`[DropFlow] Entered ${ebayLabel} value: "${value}"`);
        axisValuesEntered++;
        await sleep(400);
      }
    }

    await logVariationStep('fillVariations:valuesEntered', {
      axisCount: axisMapping.length,
      axisInputsFound,
      axisValuesEntered
    });

    if (axisInputsFound === 0 || axisValuesEntered === 0) {
      const fallbackCtx = detectVariationBuilderContextWithLog('fillVariations:noInputsFallback');
      if (fallbackCtx.isBuilder) {
        if (fallbackCtx.isMskuDialog && IS_TOP_FRAME) {
          try { await sendMessageSafe({ type: 'INJECT_FORM_FILLER_IN_FRAMES', url: window.location.href }, 5000); } catch (_) {}
        } else {
          await logVariationStep('fillVariations:variationBuilderFallbackFromNoInputs', {
            axisInputsFound,
            axisValuesEntered,
            url: window.location.href
          });
          const ok = await runVariationBuilderPageFlow(productData, axisMapping, fallbackCtx.doc);
          if (!ok) return false;
          const filledAxes = axisMapping.map(m => m.ebayLabel);
          return { filledAxes, axisNameMap };
        }
      }

      console.warn('[DropFlow] Variation editor opened but no axis inputs/values were filled');
      const sampleInteractive = queryAllWithShadow(
        'input, select, button, [role="combobox"], [role="option"], [role="listbox"], [contenteditable="true"]',
        editorContext
      )
        .filter(el => isElementVisible(el))
        .slice(0, 20)
        .map(el => ({
          tag: el.tagName,
          role: el.getAttribute?.('role') || '',
          type: el.type || '',
          text: (el.textContent || '').trim().substring(0, 50),
          aria: (el.getAttribute?.('aria-label') || '').substring(0, 60),
          placeholder: (el.getAttribute?.('placeholder') || '').substring(0, 60),
          cls: (String(el.className || '')).substring(0, 60)
        }));
      await logVariationStep('fillVariations:noAxisInputsFilled', {
        selectedAxes,
        axisInputsFound,
        axisValuesEntered,
        sampleInteractive
      });
      return false;
    }

    // =====================================================
    // Phase E: Fill price/quantity grid
    // =====================================================
    // Click Apply/Continue to advance to the grid view
    await sleep(1000);
    const applyBtn2 = findButtonByText(editorContext, /^(apply|continue|next|save|done|update)\s*$/i) ||
                      findButtonByText(editorContext, /update\s+variations/i);
    if (applyBtn2) {
      simulateClick(applyBtn2);
      console.log(`[DropFlow] Clicked "${applyBtn2.textContent?.trim()}" after entering values`);
      await sleep(2000);
      // Handle any confirmation dialogs (Update variations → Continue, Delete variations → Yes)
      await dismissVariationDialogs();
      await sleep(500);
    }

    // Re-detect editor context (may have changed after Apply)
    const newModals = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="drawer" i]');
    const newVisibleModal = Array.from(newModals).find(m => isElementVisible(m));
    const gridContext = newVisibleModal || editorContext;

    // Build price lookup from inStockSkus (mapped to eBay axis names)
    const priceLookup = {};
    for (const sku of inStockSkus) {
      const mappedSpecifics = {};
      for (const [axisName, value] of Object.entries(sku.specifics)) {
        const mapped = axisNameMap[axisName] || axisName;
        mappedSpecifics[mapped] = value;
      }
      const key = Object.values(mappedSpecifics).join('|').toLowerCase();
      priceLookup[key] = {
        price: computeVariantEbayPrice(sku, productData),
        qty: Math.min(sku.stock || 5, 5),
        sku: `${productData.asin || 'DF'}-${Object.values(sku.specifics).join('-')}`
      };
    }

    // Find grid rows — also search the activeDoc (iframe document) if different from gridContext
    await sleep(1000);
    const gridSearchContexts = [gridContext];
    if (activeDoc && activeDoc !== gridContext && activeDoc.body) gridSearchContexts.push(activeDoc.body);
    if (document !== gridContext && document.body !== gridContext) gridSearchContexts.push(document.body);

    let gridRows = [];
    for (const ctx of gridSearchContexts) {
      gridRows = ctx.querySelectorAll(
        'tr, [class*="row" i][class*="variation" i], [class*="variation" i][class*="row" i], ' +
        '[class*="grid" i] [class*="row" i], [class*="sku" i][class*="row" i]'
      );
      if (gridRows.length > 1) break;
    }
    console.log(`[DropFlow] Found ${gridRows.length} potential variation grid rows`);

    // Build column map from table header (for position-based fallback)
    let gridColMap = { price: -1, qty: -1, upc: -1, sku: -1 };
    if (gridRows.length > 0) {
      const parentTable = gridRows[0].closest('table');
      if (parentTable) {
        const headerRow = parentTable.querySelector('thead tr, tr:first-child');
        if (headerRow) {
          const ths = Array.from(headerRow.querySelectorAll('th, td'));
          ths.forEach((th, idx) => {
            const t = (th.textContent || '').trim().toLowerCase();
            if (/price|amount|\$/.test(t) && gridColMap.price < 0) gridColMap.price = idx;
            else if (/qty|quantit|stock|available/.test(t) && gridColMap.qty < 0) gridColMap.qty = idx;
            else if (/upc|ean|isbn|gtin/.test(t) && gridColMap.upc < 0) gridColMap.upc = idx;
            else if (/sku|custom\s*label/.test(t) && gridColMap.sku < 0) gridColMap.sku = idx;
          });
          console.log(`[DropFlow] Grid column map: price=${gridColMap.price}, qty=${gridColMap.qty}, sku=${gridColMap.sku}`);
        }
      }
    }

    let filledPrices = 0;
    let filledQty = 0;
    for (const row of gridRows) {
      const rowText = (row.textContent || '').toLowerCase();
      const allInputs = row.querySelectorAll('input[type="text"], input[type="number"], input:not([type])');
      if (allInputs.length === 0) continue;

      // Try to match this row to a SKU
      for (const [key, data] of Object.entries(priceLookup)) {
        const keyParts = key.split('|');
        if (keyParts.every(part => rowText.includes(part))) {
          let priceDone = false, qtyDone = false;

          for (const input of allInputs) {
            const placeholder = (input.placeholder || input.getAttribute('aria-label') || '').toLowerCase();
            const name = (input.name || '').toLowerCase();
            const id = (input.id || '').toLowerCase();
            const allHints = placeholder + ' ' + name + ' ' + id;

            // Skip UPC/EAN fields
            if (/upc|ean|isbn|gtin|barcode|identifier/.test(allHints)) continue;

            if (allHints.includes('price') || allHints.includes('$') || allHints.includes('amount') || allHints.includes('cost')) {
              await commitInputValue(input, String(data.price));
              console.log(`[DropFlow] Set price ${data.price} for ${key}`);
              filledPrices++;
              priceDone = true;
            } else if (allHints.includes('qty') || allHints.includes('quantity') || allHints.includes('stock') || allHints.includes('available')) {
              await commitInputValue(input, String(data.qty));
              filledQty++;
              qtyDone = true;
            } else if (allHints.includes('sku') || allHints.includes('custom label')) {
              await commitInputValue(input, data.sku);
            }
          }

          // Column-position fallback: if hint-matching missed price/qty, use header column index
          if (!priceDone && gridColMap.price >= 0 && data.price > 0) {
            const cells = Array.from(row.querySelectorAll('td, th'));
            const priceCell = cells[gridColMap.price];
            const pi = priceCell?.querySelector('input[type="text"], input[type="number"], input:not([type])');
            if (pi) {
              await commitInputValue(pi, String(data.price));
              console.log(`[DropFlow] Set price ${data.price} for ${key} (column fallback)`);
              filledPrices++;
              priceDone = true;
            }
          }
          if (!qtyDone && gridColMap.qty >= 0) {
            const cells = Array.from(row.querySelectorAll('td, th'));
            const qtyCell = cells[gridColMap.qty];
            const qi = qtyCell?.querySelector('input[type="text"], input[type="number"], input:not([type])');
            if (qi) {
              await commitInputValue(qi, String(data.qty));
              filledQty++;
              qtyDone = true;
            }
          }

          // Last resort: if row has exactly 1 unfilled input and we need price, assume it's price
          if (!priceDone && data.price > 0) {
            const unfilledInputs = Array.from(allInputs).filter(i => !i.value || i.value === '0' || i.value === '');
            if (unfilledInputs.length >= 1) {
              // Pick the first unfilled input that's not in a UPC column
              for (const input of unfilledInputs) {
                const hints = `${input.placeholder || ''} ${input.getAttribute('aria-label') || ''} ${input.name || ''} ${input.id || ''}`.toLowerCase();
                if (/upc|ean|isbn|gtin|barcode/.test(hints)) continue;
                await commitInputValue(input, String(data.price));
                console.log(`[DropFlow] Set price ${data.price} for ${key} (unfilled-input fallback)`);
                filledPrices++;
                priceDone = true;
                break;
              }
            }
          }

          break;
        }
      }

      // If no SKU matched but row has inputs, try using productData.ebayPrice as default
      if (filledPrices === 0 && productData.ebayPrice > 0) {
        // Will be handled by bulk price fallback below
      }
    }

    // Handle "Set all prices" shortcut if no individual prices were filled
    if (filledPrices === 0 && inStockSkus.length > 0) {
      const allPrices = inStockSkus.map(s => computeVariantEbayPrice(s, productData)).filter(p => p > 0);
      const uniquePrices = [...new Set(allPrices)];
      const defaultPrice = uniquePrices.length === 1 ? uniquePrices[0] : Math.max(...allPrices, 0);

      if (defaultPrice > 0) {
        // Strategy 1: Look for a bulk price input
        const bulkInputs = gridContext.querySelectorAll('input');
        for (const input of bulkInputs) {
          const hint = (input.placeholder || input.getAttribute('aria-label') || '').toLowerCase();
          if ((hint.includes('all') && hint.includes('price')) || hint.includes('bulk price') || hint.includes('set price')) {
            await commitInputValue(input, String(defaultPrice));
            console.log(`[DropFlow] Set bulk price: ${defaultPrice}`);
            filledPrices = inStockSkus.length;
            break;
          }
        }

        // Strategy 2: If price column is known, fill ALL rows using column position
        if (filledPrices === 0 && gridColMap.price >= 0) {
          console.log(`[DropFlow] Filling all price inputs via column position ${gridColMap.price}`);
          for (const row of gridRows) {
            const cells = Array.from(row.querySelectorAll('td, th'));
            const priceCell = cells[gridColMap.price];
            const pi = priceCell?.querySelector('input[type="text"], input[type="number"], input:not([type])');
            if (pi) {
              // Try to match row to specific SKU for per-variant pricing
              const rowText = (row.textContent || '').toLowerCase();
              let rowPrice = defaultPrice;
              for (const [key, data] of Object.entries(priceLookup)) {
                const keyParts = key.split('|');
                if (keyParts.every(part => rowText.includes(part)) && data.price > 0) {
                  rowPrice = data.price;
                  break;
                }
              }
              await commitInputValue(pi, String(rowPrice));
              filledPrices++;
            }
          }
          if (filledPrices > 0) {
            console.log(`[DropFlow] Filled ${filledPrices} prices via column position fallback`);
          }
        }

        // Strategy 3: "Enter price" button (eBay sometimes shows this)
        if (filledPrices === 0) {
          const enterPriceBtn = queryAllWithShadow('button, [role="button"]', gridContext)
            .find(b => isElementVisible(b) && /enter\s*price|set\s*price|add\s*price/i.test((b.textContent || '').trim()));
          if (enterPriceBtn) {
            simulateClick(enterPriceBtn);
            await sleep(500);
            const focusedInput = gridContext.querySelector('input:focus') ||
              queryAllWithShadow('input', gridContext).find(i => {
                const h = `${i.placeholder || ''} ${i.getAttribute('aria-label') || ''}`.toLowerCase();
                return isElementVisible(i) && /price/.test(h);
              });
            if (focusedInput) {
              await commitInputValue(focusedInput, String(defaultPrice));
              const applyPriceBtn = queryAllWithShadow('button, [role="button"]', gridContext)
                .find(b => isElementVisible(b) && /apply|set|save|ok/i.test((b.textContent || '').trim()));
              if (applyPriceBtn) {
                simulateClick(applyPriceBtn);
                await sleep(300);
              }
              filledPrices = gridRows.length;
              console.log(`[DropFlow] Set price via "Enter price" button: ${defaultPrice}`);
            }
          }
        }
      }
    }

    console.log(`[DropFlow] Filled ${filledPrices} prices, ${filledQty} quantities in variation grid`);
    await logVariationStep('fillVariations:gridFilled', { prices: filledPrices, quantities: filledQty });

    // =====================================================
    // Phase F: Save and close
    // =====================================================
    await sleep(1000);
    const saveBtn = findButtonByText(gridContext, /^(save|done|apply|update|confirm)\s*$/i) ||
                    findButtonByText(document, /^(save|done|apply|update|confirm)\s*$/i);
    if (saveBtn) {
      simulateClick(saveBtn);
      console.log(`[DropFlow] Clicked final save: "${saveBtn.textContent?.trim()}"`);
      await sleep(3000);
    }

    // Verify the variations section is now populated
    const populated = checkVariationsPopulated();
    console.log(`[DropFlow] DOM variation fill result: ${populated ? 'SUCCESS' : 'section may not be populated yet'}`);

    // Save diagnostic data
    chrome.storage.local.set({
      dropflow_variation_result: {
        timestamp: new Date().toISOString(),
        method: 'dom_automation',
        axisMapping: axisMapping.map(m => ({ axis: m.axis.name, ebayLabel: m.ebayLabel, valueCount: m.axis.values.length })),
        selectedAxes,
        filledPrices,
        filledQty,
        populated,
        skuCount: inStockSkus.length
      }
    }).catch(() => {});

    await logVariationStep('fillVariations:complete', { populated, filledPrices, selectedAxes });

    const filledAxes = axisMapping.map(m => m.ebayLabel);
    console.log(`[DropFlow] fillVariations returning filledAxes: [${filledAxes.join(', ')}], axisNameMap: ${JSON.stringify(axisNameMap)}`);
    return { filledAxes, axisNameMap };
  }

  /**
   * Fill the variation combinations table with per-SKU prices, quantities, and SKU labels.
   * This table appears on the parent page AFTER the builder iframe clicks Continue.
   * Each row represents a variant combo (e.g., XS + Red) and needs its own price based
   * on the AliExpress supplier cost + markup.
   */
  async function fillVariationCombinationsTable(productData) {
    const _tFnStart = Date.now();
    const variations = productData.variations;
    const skus = variations?.skus || [];
    if (skus.length === 0) {
      console.warn('[DropFlow] fillCombinationsTable: no SKUs available');
      return { success: false, filledPrices: 0, filledQuantities: 0, filledSKUs: 0, totalRows: 0 };
    }

    console.warn(`[DropFlow] ⏱ fillCombinationsTable: starting with ${skus.length} SKUs at T+0ms`);

    // --- 1. Poll for the combinations table (up to 15s) ---
    const findCombinationsTable = () => {
      // Strategy 1: table inside variations section
      const varSection = findVariationsSection();
      if (varSection) {
        const table = varSection.querySelector('table');
        if (table && table.querySelectorAll('tr').length >= 2) return table;
      }
      // Strategy 2: any visible table with price/qty column headers
      const allTables = queryAllWithShadow('table');
      for (const table of allTables) {
        if (!isElementVisible(table)) continue;
        const headerRow = table.querySelector('thead tr, tr:first-child');
        if (!headerRow) continue;
        const headerText = (headerRow.textContent || '').toLowerCase();
        if (/price/i.test(headerText) && /quantit/i.test(headerText)) return table;
      }
      // Strategy 3: table with price+qty inputs
      for (const table of allTables) {
        if (!isElementVisible(table)) continue;
        if (table.querySelectorAll('tr').length < 2) continue;
        const inputs = table.querySelectorAll('input');
        const hints = Array.from(inputs).map(i =>
          `${i.placeholder || ''} ${i.getAttribute('aria-label') || ''} ${i.name || ''} ${i.id || ''}`.toLowerCase()
        ).join(' ');
        if (/price/.test(hints) && /quantit|qty/.test(hints)) return table;
      }
      return null;
    };

    // Scroll directly to the variations section (not the whole page) to trigger
    // lazy-loading of the combinations table without interacting with other sections.
    const varSectionForScroll = findVariationsSection();
    if (varSectionForScroll) {
      varSectionForScroll.scrollIntoView({ behavior: 'smooth', block: 'start' });
      await sleep(800);
      // Scroll a bit further past the section to ensure the table below it renders
      window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
      await sleep(600);
    } else {
      // Fallback: scroll to ~60% of page height (variations section is typically in lower half)
      const targetY = Math.floor(document.body.scrollHeight * 0.6);
      window.scrollTo({ top: targetY, behavior: 'smooth' });
      await sleep(800);
    }

    let table = null;
    const _tTablePoll = Date.now();
    for (let poll = 0; poll < 30; poll++) {
      table = findCombinationsTable();
      if (table) break;
      // Progressive scroll: nudge down slightly each iteration to trigger render
      if (poll % 5 === 0) {
        window.scrollBy({ top: Math.floor(window.innerHeight * 0.5), behavior: 'smooth' });
      }
      await sleep(500);
    }
    if (!table) {
      console.warn(`[DropFlow] ⏱ fillCombinationsTable: table not found after ${Date.now()-_tTablePoll}ms (total ${Date.now()-_tFnStart}ms)`);
      return { success: false, filledPrices: 0, filledQuantities: 0, filledSKUs: 0, totalRows: 0 };
    }
    console.warn(`[DropFlow] ⏱ fillCombinationsTable: table found after ${Date.now()-_tTablePoll}ms poll`);

    // Scroll table into view so inputs are interactable
    table.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await sleep(500);

    // --- 2. Build price lookup from SKUs ---
    // Key by sorted lowercase specifics values. Use cell-level matching (not substring)
    // to avoid "S" matching inside "XS".
    const norm = (s) => String(s || '').trim().toLowerCase();
    const priceLookup = [];
    for (const sku of skus) {
      const values = Object.values(sku.specifics || {}).map(v => norm(v)).filter(Boolean);
      if (values.length === 0) continue;
      const price = computeVariantEbayPrice(sku, productData);
      const stock = sku.stock != null ? sku.stock : 5;
      if (stock <= 0) continue; // Skip OOS variants entirely — don't include in listing
      const qty = 1;
      const skuLabel = `${productData.asin || 'DF'}-${Object.values(sku.specifics).join('-')}`;
      priceLookup.push({ values, price, qty, skuLabel });
    }

    console.warn(`[DropFlow] fillCombinationsTable: ${priceLookup.length} SKU entries in lookup`);

    // --- 3. Match rows and fill inputs ---
    const allRows = Array.from(table.querySelectorAll('tr'));
    const dataRows = allRows.filter(row => {
      if (row.querySelector('th') && !row.querySelector('input')) return false;
      return row.querySelectorAll('input').length > 0;
    });

    console.warn(`[DropFlow] fillCombinationsTable: ${dataRows.length} data rows found`);

    // PER-VARIANT PRICING: match each row to its variant via cell text
    const allPricesForFlat = priceLookup.map(e => e.price).filter(p => p > 0);
    const fallbackPrice = allPricesForFlat.length > 0 ? Math.max(...allPricesForFlat) : (Number(productData.ebayPrice || 0) || 9.99);
    console.warn(`[DropFlow] fillCombinationsTable: PER-VARIANT pricing (${priceLookup.length} variants, fallback=$${fallbackPrice})`);

    let filledPrices = 0, filledQuantities = 0, filledSKUs = 0;
    const unmatchedRows = [];

    // Build column map from header once
    const parentTable = dataRows[0]?.closest('table');
    const colMap = { price: -1, qty: -1, upc: -1, sku: -1 };
    if (parentTable) {
      const hr = parentTable.querySelector('thead tr, tr:first-child');
      if (hr) {
        const ths = Array.from(hr.querySelectorAll('th, td'));
        ths.forEach((th, idx) => {
          const t = (th.textContent || '').trim().toLowerCase();
          if (/price|amount/.test(t) && colMap.price < 0) colMap.price = idx;
          else if (/qty|quantit|stock|available/.test(t) && colMap.qty < 0) colMap.qty = idx;
          else if (/upc|ean|isbn|gtin/.test(t) && colMap.upc < 0) colMap.upc = idx;
          else if (/sku|custom\s*label/.test(t) && colMap.sku < 0) colMap.sku = idx;
        });
      }
    }

    for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
      const row = dataRows[rowIdx];
      const cells = Array.from(row.querySelectorAll('td'));
      const inputs = row.querySelectorAll('input[type="text"], input[type="number"], input:not([type])');
      let priceDoneRow = false, qtyDoneRow = false, skuDoneRow = false;

      // --- Match this row to a variant by reading cell text ---
      const rowText = norm(row.textContent || '');
      let matchedPrice = fallbackPrice;
      let matchedSku = `DF-${rowIdx}`;
      let bestMatch = null;
      let bestScore = 0;

      for (const entry of priceLookup) {
        // Count how many variant values appear in the row text
        let score = 0;
        for (const val of entry.values) {
          // Exact word boundary match to avoid "S" matching "XS"
          const re = new RegExp('\\b' + val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
          if (re.test(rowText)) score++;
        }
        if (score > bestScore || (score === bestScore && score > 0)) {
          bestScore = score;
          bestMatch = entry;
        }
      }

      if (bestMatch && bestScore >= bestMatch.values.length) {
        // Full match — all variant values found in row
        matchedPrice = bestMatch.price;
        matchedSku = bestMatch.skuLabel;
      } else if (bestMatch && bestScore > 0) {
        // Partial match — use it but log
        matchedPrice = bestMatch.price;
        matchedSku = bestMatch.skuLabel;
        console.warn(`[DropFlow] Row ${rowIdx}: partial match (${bestScore}/${bestMatch.values.length}), using $${matchedPrice}`);
      } else if (rowIdx < priceLookup.length) {
        // Index fallback — same row order as variants
        matchedPrice = priceLookup[rowIdx].price;
        matchedSku = priceLookup[rowIdx].skuLabel;
        console.warn(`[DropFlow] Row ${rowIdx}: no text match, using index fallback $${matchedPrice}`);
      } else {
        unmatchedRows.push(rowIdx);
        console.warn(`[DropFlow] Row ${rowIdx}: NO MATCH, using fallback $${fallbackPrice}`);
      }

      for (const input of inputs) {
        const placeholder = (input.placeholder || '').toLowerCase();
        const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        const cn = (input.getAttribute('cn') || '').toLowerCase();
        const hints = `${placeholder} ${ariaLabel} ${name} ${id} ${cn}`;

        if (/upc|ean|isbn|mpn|gtin|barcode|identifier/.test(hints)) continue;

        if (/price|amount|\$/.test(hints)) {
          await commitInputValue(input, String(matchedPrice));
          filledPrices++;
          priceDoneRow = true;
        } else if (/qty|quantit|stock|available/.test(hints)) {
          await commitInputValue(input, '1');
          filledQuantities++;
          qtyDoneRow = true;
        } else if (/sku|custom\s*label/.test(hints)) {
          await commitInputValue(input, matchedSku);
          filledSKUs++;
          skuDoneRow = true;
        }
      }

      // Column-position fallback
      if (!priceDoneRow && colMap.price >= 0) {
        const priceCell = cells[colMap.price];
        const pi = priceCell?.querySelector('input[type="text"], input[type="number"], input:not([type])');
        if (pi) {
          await commitInputValue(pi, String(matchedPrice));
          filledPrices++;
        }
      }
      if (!qtyDoneRow && colMap.qty >= 0) {
        const qtyCell = cells[colMap.qty];
        const qi = qtyCell?.querySelector('input[type="text"], input[type="number"], input:not([type])');
        if (qi) {
          await commitInputValue(qi, '1');
          filledQuantities++;
        }
      }
    }

    // --- 4. Bulk price fallback if no individual prices were filled ---
    if (filledPrices === 0 && skus.length > 0) {
      const prices = skus
        .filter(s => (s.stock > 0 || !skus.some(x => x.stock > 0)))
        .map(s => computeVariantEbayPrice(s, productData))
        .filter(p => p > 0);
      const uniquePrices = [...new Set(prices)];
      // Try the "Enter price" button above the table
      const varSection = findVariationsSection() || document;
      const enterPriceBtn = queryAllWithShadow('button, [role="button"]', varSection)
        .find(b => isElementVisible(b) && /enter price/i.test((b.textContent || '').trim()));
      if (enterPriceBtn && uniquePrices.length > 0) {
        simulateClick(enterPriceBtn);
        await sleep(500);
        // Look for the price input that appeared
        const priceInput = varSection.querySelector('input[type="text"]:focus, input[type="number"]:focus') ||
          queryAllWithShadow('input', varSection).find(i => {
            const h = `${i.placeholder || ''} ${i.getAttribute('aria-label') || ''}`.toLowerCase();
            return isElementVisible(i) && /price/.test(h);
          });
        if (priceInput) {
          // Use max price as safe default (covers all variant costs)
          const maxPrice = Math.max(...uniquePrices);
          await commitInputValue(priceInput, String(maxPrice));
          // Look for Apply/Set button
          const applyBtn = queryAllWithShadow('button, [role="button"]', varSection)
            .find(b => isElementVisible(b) && /apply|set|save|ok/i.test((b.textContent || '').trim()));
          if (applyBtn) {
            simulateClick(applyBtn);
            await sleep(300);
          }
          filledPrices = dataRows.length;
          console.warn(`[DropFlow] fillCombinationsTable: bulk price set to $${maxPrice}`);
        }
      }
    }

    if (unmatchedRows.length > 0) {
      console.warn(`[DropFlow] fillCombinationsTable: ${unmatchedRows.length} unmatched rows:`, unmatchedRows.slice(0, 5));
    }

    const result = { success: filledPrices > 0, filledPrices, filledQuantities, filledSKUs, totalRows: dataRows.length };
    console.warn(`[DropFlow] ⏱ fillCombinationsTable: ${filledPrices}/${dataRows.length} prices, ${filledQuantities} qty, ${filledSKUs} SKUs — total ${Date.now()-_tFnStart}ms (tablePoll=${Date.now()-_tTablePoll < 1 ? 'n/a' : Date.now()-_tTablePoll}ms)`);
    return result;
  }

  /**
   * Check if the VARIATIONS section in the DOM is populated (not just the default prompt).
   */
  function checkVariationsPopulated() {
    // The default empty state says "Save time and money by listing multiple variations..."
    // If populated, it shows a table/grid with Color, Size, prices, etc.
    const variationSection = findVariationsSection();
    if (!variationSection) return false;

    const text = variationSection.textContent || '';
    // Default empty state â€" not populated
    if (/save time and money/i.test(text) && !/[$\d]/.test(text)) return false;
    // Has price data, variation grid, or specific variation values â€" populated
    if (/[$â'¬Â£]\d/.test(text) || variationSection.querySelector('table, [class*="grid"]')) return true;
    // Check for variation value chips/tags
    if (variationSection.querySelectorAll('[class*="chip"], [class*="tag"], [class*="pill"]').length > 2) return true;
    return false;
  }

  /**
   * Fill eBay's dedicated full-page variation builder (opened from VARIATIONS -> Edit).
   * This flow is different from the inline/modal variation editor.
   */
  async function runVariationBuilderPageFlow(productData, axisMapping = [], builderDoc = null) {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const sleepShort = () => sleep(250);

    // Attributes that should NEVER be used as variation axes in the builder.
    // "Character" and "Character Family" are eBay attributes for licensed merchandise
    // (e.g., Disney, Marvel) — not suitable for color/size/model axes.
    const BUILDER_AXIS_BLACKLIST = new Set([
      'character', 'characterfamily', 'theme', 'franchise',
      'features', 'department', 'occasion', 'season'
    ]);

    // Detect if axis values look like device/phone model names and remap axis name.
    // AliExpress often labels phone model axes as "Material" or "Ships From".
    const inferAxisNameFromValues = (axisName, values) => {
      const lower = (axisName || '').toLowerCase().trim();
      // Only remap generic names that are clearly wrong for the values
      if (!['material', 'type', 'model', 'specification', 'specs'].includes(lower)) return axisName;
      if (!values || values.length < 2) return axisName;
      const valStrings = values.map(v => String(v?.name || v || '').toLowerCase());
      // Check if values look like phone/device models
      const deviceModelPattern = /\b(iphone|samsung|galaxy|pixel|huawei|xiaomi|redmi|oppo|oneplus|ipad|macbook|airpods)\b/i;
      const modelHits = valStrings.filter(v => deviceModelPattern.test(v)).length;
      if (modelHits >= Math.ceil(values.length * 0.4)) {
        console.warn(`[DropFlow] Axis "${axisName}" values look like device models (${modelHits}/${values.length} match) → remapping to "Compatible Model"`);
        return 'Compatible Model';
      }
      return axisName;
    };

    const desiredAxes = (axisMapping.length > 0
      ? axisMapping.map(m => ({ name: m.ebayLabel || m.axis?.name || '', values: m.axis?.values || [] }))
      : sanitizeVariationAxes(productData?.variations?.axes || []).map(a => ({ name: a.name, values: a.values || [] }))
    )
      // Fix 1: filter out axes with no actual values (e.g. MPN axis with no data)
      .filter(a => a.name && Array.isArray(a.values) && a.values.length > 0)
      .slice(0, 2)
      .map(a => {
        const rawName = normalizeVariationAxisName(a.name);
        const values = (a.values || []).map(v => String(v?.name || v || '').trim()).filter(Boolean);
        return {
          name: inferAxisNameFromValues(rawName, values),
          values
        };
      })
      .sort((a, b) => (/size/i.test(b.name) ? 1 : 0) - (/size/i.test(a.name) ? 1 : 0));

    if (desiredAxes.length === 0) {
      await logVariationStep('variationBuilder:noAxes', {});
      return false;
    }

    let detected = builderDoc ? { isBuilder: true, doc: builderDoc } : detectVariationBuilderContext();
    for (let i = 0; i < 24; i++) {
      if (detected?.isBuilder) break;
      await sleep(250);
      detected = detectVariationBuilderContext();
    }
    if (!detected?.isBuilder) {
      await logVariationStep('variationBuilder:notDetected', { url: window.location.href });
      console.warn('[DropFlow] Variation builder UI not detected when attempting builder flow');
      return false;
    }
    const activeDoc = detected?.doc || builderDoc || document;

    /**
     * Dismiss variation-related confirmation dialogs that may block the builder flow.
     * Handles "Delete variations", "Update variations", "Are you sure", etc.
     * Must be defined before first use (TDZ-safe placement).
     */
    const dismissVariationDialogs = async (maxAttempts = 3) => {
      let dismissed = false;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const root = activeDoc || document;
        const dialogs = queryAllWithShadow('[role="dialog"], [role="alertdialog"], .lightbox-dialog, .overlay-dialog, [class*="modal"], [class*="dialog"]', root)
          .filter(el => isElementVisible(el));
        if (root !== document) {
          const docDialogs = queryAllWithShadow('[role="dialog"], [role="alertdialog"], .lightbox-dialog, .overlay-dialog, [class*="modal"], [class*="dialog"]', document)
            .filter(el => isElementVisible(el));
          dialogs.push(...docDialogs);
        }

        for (const dialog of dialogs) {
          const text = (dialog.textContent || '').toLowerCase();
          const buttons = queryAllWithShadow('button, [role="button"]', dialog).filter(b => isElementVisible(b));

          if (text.includes('delete variations') || text.includes('delete all variations')) {
            const yesBtn = buttons.find(b => /^\s*yes\s*$/i.test((b.textContent || '').trim()));
            if (yesBtn) {
              console.log('[DropFlow] Dismissing "Delete variations" dialog → clicking Yes');
              simulateClick(yesBtn);
              await sleep(500);
              dismissed = true;
              continue;
            }
          }

          if (text.includes('update variations') || text.includes('we\'re about to automatically')) {
            const continueBtn = buttons.find(b => /^\s*continue\s*$/i.test((b.textContent || '').trim()));
            if (continueBtn) {
              console.log('[DropFlow] Dismissing "Update variations" dialog → clicking Continue');
              simulateClick(continueBtn);
              await sleep(500);
              dismissed = true;
              continue;
            }
          }

          if (text.includes('are you sure') || text.includes('confirm')) {
            const confirmBtn = buttons.find(b => /^\s*(yes|ok|continue|confirm)\s*$/i.test((b.textContent || '').trim()));
            if (confirmBtn) {
              console.log('[DropFlow] Dismissing generic confirmation dialog');
              simulateClick(confirmBtn);
              await sleep(500);
              dismissed = true;
              continue;
            }
          }
        }

        if (!dismissed) break;
        await sleep(300);
        dismissed = false;
      }
      return dismissed;
    };

    // Dismiss any stale dialogs from previous attempts (e.g., "Delete variations", "Update variations")
    await dismissVariationDialogs();

    // Guard against duplicate concurrent runs in the same frame/doc.
    // The content script can be triggered by multiple watchers/reinjections, and
    // overlapping runs can race on the same modal (attempt order 3/1/2, etc.).
    const flowLockHost = activeDoc.defaultView || window;
    const flowLockKey = '__dropflowVariationBuilderFlowLock';
    const flowStartedAt = Date.now();
    const existingFlowLock = flowLockHost[flowLockKey];
    if (existingFlowLock && (flowStartedAt - existingFlowLock.startedAt) < 30000) {
      await logVariationStep('variationBuilder:duplicateGuard', {
        url: window.location.href,
        ageMs: flowStartedAt - existingFlowLock.startedAt
      });
      console.warn('[DropFlow] Variation builder flow already active in this frame; skipping duplicate run');
      return false;
    }
    flowLockHost[flowLockKey] = { startedAt: flowStartedAt };
    setTimeout(() => {
      const current = flowLockHost[flowLockKey];
      if (current && current.startedAt === flowStartedAt) delete flowLockHost[flowLockKey];
    }, 45000);

    // FIX: If running in parent frame but MSKU iframe exists, bail immediately.
    // The iframe's content script should handle the builder flow. Running from
    // parent would acquire the cross-context lock, blocking the iframe.
    if (IS_TOP_FRAME) {
      try {
        const mskuIframe = findMskuBulkeditIframe();
        if (mskuIframe) {
          const iframeRect = mskuIframe.getBoundingClientRect();
          if (iframeRect.width > 100 && iframeRect.height > 100) {
            console.warn('[DropFlow] runVariationBuilderPageFlow: MSKU iframe detected in parent frame — bailing to let iframe handle it');
            // BUG FIX: Clear the duplicate-guard lock before bailing so that
            // subsequent calls from watchForPageTransitions are NOT blocked by
            // the 30-second TTL.  Without this, every retry within 30 s returns
            // false immediately from the guard, and the MSKU iframe path never
            // gets a chance to complete.
            delete flowLockHost[flowLockKey];
            await logVariationStep('variationBuilder:parentBailForIframe', { url: window.location.href });
            return false;
          }
        }
      } catch (_) {}
    }

    // Cross-context lock: prevent parent frame AND iframe from both running the
    // builder flow simultaneously. Prefer draftId scope; if missing (common in
    // bulkedit subframes), fall back to a host+path scope with shorter TTL.
    const draftIdMatch = window.location.href.match(/draftId=(\d+)/) ||
      String(document.referrer || '').match(/draftId=(\d+)/);
    const draftId = draftIdMatch ? draftIdMatch[1] : '';
    const lockScope = draftId
      ? `draft_${draftId}`
      : `surface_${window.location.hostname}${window.location.pathname}`;
    const storageKey = `__dfBuilderLock_${lockScope}`;
    const lockTtlMs = draftId ? 120000 : 30000;
    try {
      const lockData = await chrome.storage.local.get(storageKey);
      const existing = lockData[storageKey];
      const lockAge = existing ? (Date.now() - existing.ts) : null;
      if (existing && lockAge < lockTtlMs) {
        // FIX: If we're in the bulkedit iframe and the lock is held by the parent
        // (www.ebay.* host), force-release it immediately. The iframe is the correct
        // context for running the builder — the parent can't access iframe DOM.
        const isBulkEditFrame = !IS_TOP_FRAME && /(^|\.)bulkedit\.ebay\./i.test(window.location.hostname);
        const lockHeldByParent = existing.host && /^www\.ebay\./i.test(existing.host);
        if (isBulkEditFrame && lockHeldByParent) {
          console.warn(`[DropFlow] Builder cross-context lock held by parent (${existing.host}, age=${lockAge}ms) — force-releasing for iframe`);
          await logVariationStep('variationBuilder:crossContextLockIframeOverride', { scope: lockScope, host: existing.host, ageMs: lockAge });
          try { await chrome.storage.local.remove(storageKey); } catch (_) {}
        } else if (lockAge > 60000) {
          // Force-release stale locks older than 60 seconds
          console.warn(`[DropFlow] Builder cross-context lock stale (age=${lockAge}ms > 60s) — force-releasing`);
          await logVariationStep('variationBuilder:crossContextLockForceRelease', { scope: lockScope, host: existing.host, ageMs: lockAge });
          try { await chrome.storage.local.remove(storageKey); } catch (_) {}
        } else {
          console.warn(`[DropFlow] Builder cross-context lock held (scope=${lockScope}, host=${existing.host}, age=${lockAge}ms); skipping`);
          await logVariationStep('variationBuilder:crossContextLock', { scope: lockScope, host: existing.host, ageMs: lockAge });
          return false;
        }
      }
      await chrome.storage.local.set({ [storageKey]: { ts: Date.now(), host: window.location.hostname } });
    } catch (_) {}
    // Auto-clear lock shortly after TTL expires.
    const autoLockTimer = setTimeout(async () => {
      try { await chrome.storage.local.remove(storageKey); } catch (_) {}
    }, lockTtlMs + 10000);

    // Helper to release the cross-context lock
    const releaseCrossContextLock = async () => {
      try { clearTimeout(autoLockTimer); } catch (_) {}
      try { await chrome.storage.local.remove(storageKey); } catch (_) {}
    };

    try { // <<< try/finally to guarantee lock release

    console.warn('[DropFlow] Variation builder flow starting');

    const findBuilderRoot = () => {
      const candidates = queryAllWithShadow('main, section, article, div', activeDoc);
      for (const el of candidates) {
        if (!isElementVisible(el)) continue;
        const t = (el.textContent || '').toLowerCase().replace(/\s+/g, ' ');
        if (t.length < 80 || t.length > 12000) continue;
        if (/create\s+(your\s+)?variation|manage\s+(your\s+)?variation|variation\s+builder/.test(t) &&
            /\b(attributes?|properties)\b/.test(t) && /\b(options?|values?)\b/.test(t)) return el;
      }
      // Fallback: container with variation text + visible Continue button
      for (const el of candidates) {
        if (!isElementVisible(el)) continue;
        const t = (el.textContent || '').toLowerCase().replace(/\s+/g, ' ');
        if (t.length < 80 || t.length > 12000) continue;
        if (!/variation/i.test(t)) continue;
        const hasContinueBtn = queryAllWithShadow('button, [role="button"]', el)
          .some(b => /^\s*(continue|update\s+variations?)\s*$/i.test((b.textContent || '').trim()));
        if (hasContinueBtn) return el;
      }
      return activeDoc.body || document.body;
    };
    let builderRoot = findBuilderRoot();

    await logVariationStep('variationBuilder:start', {
      url: window.location.href,
      axes: desiredAxes.map(a => ({ name: a.name, count: a.values.length }))
    });

    const getAxisAliasSpec = (axisName) => {
      const n = norm(axisName);
      const strict = new Set([n]);
      const soft = new Set([n]);
      if (n === 'color' || n === 'colour') {
        ['color', 'colour', 'maincolor', 'maincolour', 'shade'].forEach(v => strict.add(norm(v)));
        // NOTE: "features" deliberately excluded — eBay's "Features" attribute is a
        // generic grab-bag that swallows color values (only a few match predefined
        // options). Using a custom "Color" attribute is far more reliable.
        ['style'].forEach(v => soft.add(norm(v)));
      } else if (n === 'size') {
        // Only include the exact attribute name "size" as a strict alias.
        // Compound eBay attributes like "Dog Size", "Pet Size", "Garment Size" are
        // entirely different attributes and must NOT match our "Size" axis.
        // With the space-stripping norm, "Dog Size" → "dogsize" which would have
        // wrongly matched "dogsize" in the old alias list.
        ['size'].forEach(v => strict.add(norm(v)));
      } else if (n === 'compatiblemodel') {
        // "Compatible Model" is the eBay attribute for phone/device model variations.
        // This axis is created when AliExpress "Material" values are detected as
        // device model names (e.g., "For iPhone 15 Pro") by inferAxisNameFromValues.
        ['compatiblemodel', 'model'].forEach(v => strict.add(norm(v)));
        ['devicemodel', 'phonemodel'].forEach(v => soft.add(norm(v)));
      }
      for (const v of strict) soft.add(v);
      return { strict, soft };
    };

    const axisSpecs = desiredAxes.map(axis => ({ axis, ...getAxisAliasSpec(axis.name) }));
    const matchesAlias = (chipNorm, aliasSpec, useSoft = false) =>
      (useSoft ? aliasSpec.soft : aliasSpec.strict).has(chipNorm);
    const anyAxisMatch = (chipNorm, useSoft = false) =>
      axisSpecs.some(spec => matchesAlias(chipNorm, spec, useSoft));

    const getVisibleClickables = (ctx = builderRoot) =>
      queryAllWithShadow(
        'button, a, [role="button"], [role="link"], [role="option"], [role="menuitem"], [tabindex], li',
        ctx
      ).filter(el => isElementVisible(el));

    const asClickableTarget = (el) =>
      el?.closest?.(
        'button, a, [role="button"], [role="link"], [role="option"], [role="menuitem"], [tabindex]'
      ) || el;

    const findByText = (regex, ctx = builderRoot) =>
      getVisibleClickables(ctx).find(el => regex.test((el.textContent || '').trim()));

    const findLabel = (re) =>
      queryAllWithShadow('h1, h2, h3, h4, h5, legend, label, span, div, strong', builderRoot)
        .find(el => isElementVisible(el) && re.test((el.textContent || '').trim()));

    const isSelectedOptionEl = (el) => {
      if (!el) return false;
      const ariaPressed = (el.getAttribute?.('aria-pressed') || '').toLowerCase();
      const ariaSelected = (el.getAttribute?.('aria-selected') || '').toLowerCase();
      const ariaChecked = (el.getAttribute?.('aria-checked') || '').toLowerCase();
      const cls = String(el.className || '').toLowerCase();
      return ariaPressed === 'true' ||
             ariaSelected === 'true' ||
             ariaChecked === 'true' ||
             /selected|active|checked|is-selected|btn--primary|btn--selected/.test(cls);
    };

    const readAttributeChips = () => {
      const label = findLabel(/^attributes$/i) || findLabel(/^\s*attributes\s*$/i) ||
                    findLabel(/^properties$/i) || findLabel(/^\s*properties\s*$/i);
      const optionsLabel = findLabel(/^options$/i) || findLabel(/^\s*options\s*$/i) ||
                           findLabel(/^values$/i) || findLabel(/^\s*values\s*$/i);
      let bandTop = 0;
      let bandBottom = 320;
      if (label) {
        const r = label.getBoundingClientRect();
        bandTop = r.bottom - 8;
        bandBottom = r.bottom + 130;
      }
      if (optionsLabel) {
        const o = optionsLabel.getBoundingClientRect();
        // Keep the scan above the options strip. This prevents size/color values
        // (XXS, XS, etc.) from being mistaken for attribute chips.
        bandBottom = Math.min(bandBottom, o.top - 6);
      }

      const chips = [];

      // Strategy 0: eBay MSKU builder chips use <span id="msku-variation-tag-N">.
      // Only visible chips are active axes. Remove buttons are OUTSIDE the chip spans.
      {
        const mskuTags = queryAllWithShadow('[id^="msku-variation-tag"]', activeDoc || document)
          .filter(el => isElementVisible(el));
        for (const el of mskuTags) {
          const rawText = (el.textContent || '').trim();
          if (!rawText || rawText.length < 2 || rawText.length > 45) continue;
          if (/^\+/.test(rawText)) continue;
          const n = norm(rawText);
          if (!n) continue;
          if (chips.some(c => c.norm === n)) continue; // dedup
          // Remove button is elsewhere in the DOM, not inside the chip span
          const removeTarget = queryAllWithShadow('button[aria-label]', activeDoc || document)
            .find(btn => {
              const a = norm(btn.getAttribute('aria-label') || '');
              return a.includes('remove') && a.includes(n);
            }) || null;
          chips.push({
            el,
            text: rawText,
            norm: n,
            hasRemoveGlyph: !!removeTarget,
            removeTarget,
            rect: el.getBoundingClientRect()
          });
        }
      }

      // Strategy 1: scan visible clickables in the attribute band (original approach)
      for (const el of getVisibleClickables()) {
        const rect = el.getBoundingClientRect();
        const cy = rect.top + rect.height / 2;
        if (cy < bandTop || cy > bandBottom) continue;
        const raw = (el.textContent || '').trim();
        if (!raw || raw.length > 45) continue;
        if (/^\+\s*add$/i.test(raw) || /^\+/.test(raw)) continue;
        if (/^(continue|cancel|options|attributes)$/i.test(raw)) continue;
        if (/create your own|send us your comments/i.test(raw)) continue;
        const hasRemoveGlyph = /\s+[x×]\s*$/i.test(raw);
        const cleaned = raw.replace(/\s+[x×]\s*$/i, '').trim();
        if (!cleaned || cleaned.length > 30) continue;

        const removeTarget = queryAllWithShadow(
          'button, [role="button"], [aria-label], [title], span, i, svg',
          el
        ).find(n => {
          const t = ((n.textContent || '').trim()).toLowerCase();
          const aria = (n.getAttribute?.('aria-label') || '').toLowerCase();
          const title = (n.getAttribute?.('title') || '').toLowerCase();
          const role = (n.getAttribute?.('role') || '').toLowerCase();
          return /^x$|^×$/.test(t) || /remove|delete|close/.test(`${aria} ${title}`) ||
                 (n.tagName === 'svg' && /close|remove|delete|dismiss/.test(`${aria} ${title}`)) ||
                 (role === 'img' && /close|remove/.test(aria));
        }) || null;

        chips.push({
          el,
          text: cleaned,
          norm: norm(cleaned),
          hasRemoveGlyph,
          removeTarget,
          rect
        });
      }

      // Strategy 2 (fallback): search for eBay chip/tag elements directly using
      // common eBay MSKU builder selectors. These use close-button SVGs rather than
      // text "x" glyphs, so Strategy 1 may miss them.
      if (chips.length === 0) {
        const chipSelectors = [
          '[class*="chip"]', '[class*="tag"]', '[class*="token"]',
          '[class*="Chip"]', '[class*="Tag"]', '[class*="Token"]',
          '[data-testid*="chip"]', '[data-testid*="tag"]',
          '.ebay-chip', '.attribute-chip'
        ];
        const candidateEls = queryAllWithShadow(chipSelectors.join(', '), builderRoot)
          .filter(el => isElementVisible(el));
        for (const el of candidateEls) {
          const rect = el.getBoundingClientRect();
          const cy = rect.top + rect.height / 2;
          // Use broader band when label was not found
          const effectiveTop = label ? bandTop : 0;
          const effectiveBottom = label ? bandBottom : (optionsLabel ? optionsLabel.getBoundingClientRect().top - 6 : 500);
          if (cy < effectiveTop || cy > effectiveBottom) continue;
          const raw = (el.textContent || '').trim();
          if (!raw || raw.length > 45) continue;
          if (/^\+\s*add$/i.test(raw) || /^\+/.test(raw)) continue;
          if (/^(continue|cancel|options|attributes)$/i.test(raw)) continue;
          const hasRemoveGlyph = /\s+[x×]\s*$/i.test(raw);
          const cleaned = raw.replace(/\s+[x×]\s*$/i, '').trim();
          if (!cleaned || cleaned.length > 30) continue;
          // Check for SVG or button close affordance inside
          const removeTarget = el.querySelector('button, [role="button"], svg, [aria-label*="remove"], [aria-label*="close"], [aria-label*="delete"]') || null;
          chips.push({
            el,
            text: cleaned,
            norm: norm(cleaned),
            hasRemoveGlyph: hasRemoveGlyph || !!removeTarget,
            removeTarget,
            rect
          });
        }
      }

      // Strategy 3 (broader fallback): scan ALL visible elements in the attribute band
      // that contain a close/remove affordance (SVG icon, aria-label, etc.)
      if (chips.length === 0) {
        const allEls = queryAllWithShadow('div, span, li, a', builderRoot)
          .filter(el => isElementVisible(el));
        const effectiveBottom = optionsLabel ? optionsLabel.getBoundingClientRect().top - 6 : 500;
        for (const el of allEls) {
          const rect = el.getBoundingClientRect();
          if (rect.width < 30 || rect.width > 300 || rect.height < 16 || rect.height > 60) continue;
          const cy = rect.top + rect.height / 2;
          if (cy < bandTop || cy > effectiveBottom) continue;
          const raw = (el.textContent || '').trim();
          if (!raw || raw.length > 45 || raw.length < 2) continue;
          if (/^\+\s*add$/i.test(raw) || /^\+/.test(raw)) continue;
          if (/^(continue|cancel|options|attributes|save|update)$/i.test(raw)) continue;
          if (/create your own|send us your comments/i.test(raw)) continue;
          // Must have a close/remove affordance to qualify as a chip
          const removeTarget = el.querySelector('button, [role="button"], [role="img"]') ||
            el.querySelector('svg') || null;
          if (!removeTarget) continue;
          const removeAria = (removeTarget.getAttribute?.('aria-label') || '').toLowerCase();
          const removeTxt = (removeTarget.textContent || '').trim().toLowerCase();
          const isSvg = removeTarget.tagName === 'svg' || removeTarget.tagName === 'SVG';
          if (!isSvg && !/^x$|^×$/.test(removeTxt) && !/remove|delete|close|dismiss/.test(removeAria)) continue;
          const hasRemoveGlyph = /\s+[x×]\s*$/i.test(raw);
          const cleaned = raw.replace(/\s+[x×]\s*$/i, '').trim();
          if (!cleaned || cleaned.length > 30) continue;
          chips.push({ el, text: cleaned, norm: norm(cleaned), hasRemoveGlyph: true, removeTarget, rect });
        }
      }

      // In this eBay UI, real attribute chips have a remove affordance (x/close).
      // Prefer those so option values are not misclassified as attributes.
      const preferred = chips.filter(c => c.hasRemoveGlyph || c.removeTarget);
      const source = preferred.length > 0 ? preferred : chips;

      const out = [];
      const seen = new Set();
      for (const c of source) {
        if (seen.has(c.norm)) continue;
        seen.add(c.norm);
        out.push(c);
      }
      return out;
    };

    const readVisibleOptions = () => {
      const label = findLabel(/^options$/i) || findLabel(/^\s*options\s*$/i) ||
                    findLabel(/^values$/i) || findLabel(/^\s*values\s*$/i);
      let bandTop = 100;
      let bandBottom = 700;
      if (label) {
        const r = label.getBoundingClientRect();
        bandTop = r.bottom - 8;
        bandBottom = r.bottom + 360;
      }

      const out = [];
      const seen = new Set();
      for (const el of getVisibleClickables()) {
        const rect = el.getBoundingClientRect();
        const cy = rect.top + rect.height / 2;
        if (cy < bandTop || cy > bandBottom) continue;
        const raw = (el.textContent || '').trim();
        if (!raw || raw.length > 40) continue;
        if (/^\+\s*create/i.test(raw) || /^\+\s*add/i.test(raw) || /^\+/.test(raw)) continue;
        if (/^(continue|cancel)$/i.test(raw)) continue;
        const n = norm(raw);
        if (!n || seen.has(n)) continue;
        seen.add(n);
        out.push({ el, text: raw, norm: n, selected: isSelectedOptionEl(el) });
      }
      if (out.length > 0) return out;

      for (const el of getVisibleClickables()) {
        const raw = (el.textContent || '').trim();
        if (!raw || raw.length > 20) continue;
        if (/^\+\s*create/i.test(raw) || /^\+\s*add/i.test(raw) || /^\+/.test(raw)) continue;
        if (/^(continue|cancel|attributes|options)$/i.test(raw)) continue;
        if (/send us your comments|create\s+(your\s+)?variation/i.test(raw)) continue;
        const n = norm(raw);
        if (!n || seen.has(n)) continue;
        seen.add(n);
        out.push({ el, text: raw, norm: n, selected: isSelectedOptionEl(el) });
      }

      return out;
    };

    const quickTypeAndEnter = async (input, value) => {
      if (!input) return false;
      const view = input.ownerDocument?.defaultView || window;
      if (input.isContentEditable) {
        input.textContent = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const nativeSetter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new view.KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new view.KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      await sleep(500);
      return true;
    };

    const findAddAttributeTrigger = () => {
      // Try exact "+Add" first, then broader patterns.
      // On eBay AU, the button may be "+ Add", "+Add", "Add", or an icon-only button
      // near the "Attributes" label.
      let btn = findByText(/^\+\s*add$/i) || findByText(/^\s*add\s*$/i);
      if (btn) return btn;

      // Search for buttons/links with "add" near the attributes label area
      const attrLabel = findLabel(/^attributes$/i) || findLabel(/^\s*attributes\s*$/i) ||
                        findLabel(/^properties$/i) || findLabel(/^\s*properties\s*$/i);
      if (attrLabel) {
        const labelRect = attrLabel.getBoundingClientRect();
        const nearby = getVisibleClickables().filter(el => {
          const r = el.getBoundingClientRect();
          // Within 200px horizontally and 60px vertically of the label
          return Math.abs(r.top - labelRect.top) < 60 &&
                 r.left > labelRect.right - 20 && r.left < labelRect.right + 200;
        });
        btn = nearby.find(el => /\badd\b/i.test((el.textContent || '').trim()) ||
                                 /\badd\b/i.test(el.getAttribute?.('aria-label') || ''));
        if (btn) return btn;
        // Icon-only button (e.g., "+" icon) near the label
        btn = nearby.find(el => {
          const txt = (el.textContent || '').trim();
          return txt === '+' || /^\+$/.test(txt);
        });
        if (btn) return btn;
      }

      // Broader fallback: any <a> or <button> with aria-label containing "add"
      const byAria = queryAllWithShadow('button[aria-label], a[aria-label]', activeDoc)
        .find(el => isElementVisible(el) && /\badd\b/i.test(el.getAttribute('aria-label') || ''));
      if (byAria) return byAria;

      // Broader text search: a/button/role=button whose textContent contains add-like phrases
      // Use normalized text to handle SVG/icon fragments mixed into textContent
      const byText = queryAllWithShadow('a, button, [role="button"], span[tabindex]', activeDoc)
        .filter(el => isElementVisible(el))
        .find(el => {
          const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
          return /\+\s*add/i.test(txt) ||
                 /add\s+attribute/i.test(txt) ||
                 /add\s+variation/i.test(txt) ||
                 /add\s+option/i.test(txt) ||
                 /create\s+your\s+own/i.test(txt);
        });
      if (byText) return byText;

      // Positional fallback: find clickable elements just below the last attribute chip
      // (eBay typically places the "+ Add" link immediately after the chip list)
      const allChips = readAttributeChips();
      if (allChips.length > 0) {
        const lastChip = allChips[allChips.length - 1];
        if (lastChip?.el) {
          const lastRect = lastChip.el.getBoundingClientRect();
          const nearby = getVisibleClickables(activeDoc).filter(el => {
            const r = el.getBoundingClientRect();
            return r.top > lastRect.bottom - 10 &&
                   r.top < lastRect.bottom + 100 &&
                   Math.abs(r.left - lastRect.left) < 200;
          });
          const addBtn = nearby.find(el => /\badd\b|\+/i.test((el.textContent || '').trim()));
          if (addBtn) return addBtn;
        }
      }

      // Last resort: any visible clickable element starting with "+"
      const plusBtn = getVisibleClickables(activeDoc).find(el => {
        const txt = (el.textContent || '').trim();
        return txt === '+' || txt.startsWith('+');
      });
      if (plusBtn) return plusBtn;

      // Final broad fallback
      return findByText(/\badd\b/i);
    };

    const clickAtPoint = (el, x, y) => {
      if (!el) return;
      const clickView = el.ownerDocument?.defaultView || window;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: clickView };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      try { el.click(); } catch (_) {}
    };

    const removeChip = async (chip) => {
      if (!chip) return false;
      // PRIMARY: eBay MSKU chips use <button class="faux-link" aria-label="Remove X attribute">
      const ariaRemoveBtn = chip.el.querySelector('button[aria-label^="Remove"]') ||
                            queryAllWithShadow('button[aria-label^="Remove"]', chip.el)[0];
      if (ariaRemoveBtn) {
        simulateClick(ariaRemoveBtn);
        await sleep(350);
      } else {
        const target = chip.removeTarget || null;
        if (target) {
          simulateClick(target);
          await sleep(350);
        } else if (chip.hasRemoveGlyph) {
          const r = chip.el.getBoundingClientRect();
          clickAtPoint(chip.el, Math.max(r.left + 4, r.right - 8), r.top + r.height / 2);
          await sleep(350);
        } else {
          simulateClick(asClickableTarget(chip.el));
          await sleep(350);
        }
      }
      // Handle any confirmation dialogs (e.g., "Delete variations - Are you sure?")
      await dismissVariationDialogs();
      builderRoot = findBuilderRoot();
      let stillExists = readAttributeChips().some(c => c.norm === chip.norm);
      // Fallback: if chip wasn't removed, try alternative close button selectors
      if (stillExists) {
        const altClose = queryAllWithShadow(
          'svg, [aria-label*="remove" i], [aria-label*="close" i], [aria-label*="delete" i], button:last-child, [role="button"]:last-child',
          chip.el
        ).find(n => isElementVisible(n));
        if (altClose) {
          simulateClick(altClose);
          await sleep(500);
          await dismissVariationDialogs();
          builderRoot = findBuilderRoot();
          stillExists = readAttributeChips().some(c => c.norm === chip.norm);
        }
      }
      return !stillExists;
    };

    const addAttributeFromMenu = async (spec) => {
      const axisLabel = String(spec?.axis?.name || '').trim();
      if (!axisLabel) return false;

      const findAddAttributeDialog = () => {
        const candidates = queryAllWithShadow('[role="dialog"], div, section, article', activeDoc);
        for (const el of candidates) {
          if (!isElementVisible(el)) continue;
          const t = (el.textContent || '').toLowerCase().replace(/\s+/g, ' ');
          if (t.length < 40 || t.length > 8000) continue;
          if (/add\s+variation\s+attribute/.test(t) && /add\s+your\s+own\s+attribute/.test(t)) return el;
        }
        return null;
      };

      const getCheckboxEntries = (dialogEl) =>
        queryAllWithShadow('input[type="checkbox"]', dialogEl).map(cb => {
          const id = cb.getAttribute('id');
          const labelFor = id ? dialogEl.querySelector(`label[for="${id}"]`) : null;
          const labelWrap = cb.closest('label');
          const row = labelWrap || labelFor || cb.closest('li, tr, [role="menuitemcheckbox"]') || cb.parentElement || cb;
          const txtSource = labelWrap?.textContent || labelFor?.textContent || row?.textContent || cb.getAttribute('aria-label') || '';
          const txt = String(txtSource).toLowerCase().replace(/\s+/g, ' ').trim();
          return { cb, row, txt };
        }).filter(e => {
          const visible = isElementVisible(e.cb) || isElementVisible(e.row);
          return visible && e.txt && e.txt.length < 500;
        });

      const isInteractableAtCenter = (el) => {
        if (!el || !isElementVisible(el)) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return false;
        const x = Math.max(1, Math.min(rect.left + rect.width / 2, (activeDoc.defaultView?.innerWidth || window.innerWidth) - 1));
        const y = Math.max(1, Math.min(rect.top + rect.height / 2, (activeDoc.defaultView?.innerHeight || window.innerHeight) - 1));
        const hit = activeDoc.elementFromPoint?.(x, y);
        if (!hit) return false;
        return hit === el || el.contains(hit) || hit.contains(el);
      };

      const pickCheckboxEntry = (entries, matcher) => {
        const matches = entries.filter(e => matcher.test(e.txt || ''));
        if (matches.length === 0) return null;
        const scored = matches.map((e, idx) => {
          let score = 0;
          if (isInteractableAtCenter(e.cb)) score += 6;
          if (isInteractableAtCenter(e.row)) score += 4;
          if (isEntryChecked(e)) score += 1;
          const rect = (e.row || e.cb)?.getBoundingClientRect?.();
          if (rect) score += Math.max(0, 1200 - Math.abs(rect.top - 320)) / 1200;
          // Stable tie-breaker: keep deterministic ordering.
          score += (100 - idx) / 10000;
          return { e, score };
        }).sort((a, b) => b.score - a.score);
        return scored[0]?.e || matches[0];
      };

      const findOwnCheckboxEntry = (dialogEl, entries) => {
        const exact = pickCheckboxEntry(entries, /^add\s+your\s+own\s+attribute$/i);
        if (exact) return exact;
        const fuzzy = pickCheckboxEntry(entries, /add\s+your\s+own\s+attribute/i);
        if (fuzzy) return fuzzy;

        const labels = queryAllWithShadow('label', dialogEl)
          .filter(el => isElementVisible(el))
          .filter(el => /^add\s+your\s+own\s+attribute$/i.test((el.textContent || '').trim()));

        for (const lbl of labels) {
          const embedded = lbl.querySelector('input[type="checkbox"]');
          if (embedded) {
            const found = entries.find(e => e.cb === embedded);
            return found || { cb: embedded, row: lbl, txt: 'add your own attribute' };
          }

          const forId = lbl.getAttribute('for');
          if (forId) {
            let target = null;
            try { target = dialogEl.querySelector(`#${CSS.escape(forId)}`); } catch (_) { /* noop */ }
            if (!target) target = dialogEl.querySelector(`#${forId}`);
            if (target && target.matches?.('input[type="checkbox"]')) {
              const found = entries.find(e => e.cb === target);
              return found || { cb: target, row: lbl, txt: 'add your own attribute' };
            }
          }
        }
        return null;
      };

      const isEntryChecked = (entry) => {
        if (!entry?.cb) return false;
        const aria = (entry.cb.getAttribute('aria-checked') || '').toLowerCase();
        const rowAria = (entry.row?.getAttribute?.('aria-checked') || '').toLowerCase();
        return !!entry.cb.checked || aria === 'true' || rowAria === 'true';
      };

      const setCheckboxState = async (entry, shouldCheck) => {
        if (!entry?.cb) return false;
        if (isEntryChecked(entry) === !!shouldCheck) return true;

        const targets = [];
        const seen = new Set();
        const pushTarget = (el) => {
          if (!el || seen.has(el)) return;
          seen.add(el);
          targets.push(el);
        };
        pushTarget(entry.row);
        pushTarget(entry.cb);
        const id = entry.cb.getAttribute('id');
        if (id) pushTarget(activeDoc.querySelector(`label[for="${id}"]`));
        pushTarget(entry.row?.querySelector?.('label'));

        for (const t of targets) {
          if (!t) continue;
          // Use native .click() for checkboxes to avoid double-toggling.
          // simulateClick fires both synthetic MouseEvent('click') AND el.click(),
          // causing React to toggle the checkbox twice (check→uncheck).
          t.click();
          await sleep(150);
          if (isEntryChecked(entry) === !!shouldCheck) return true;
        }
        // Last-resort: force property + synthetic input/change.
        // Avoid emitting click after force-set, because it can invert the state.
        try {
          const view = entry.cb.ownerDocument?.defaultView || window;
          const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'checked')?.set;
          if (setter) setter.call(entry.cb, !!shouldCheck);
          else entry.cb.checked = !!shouldCheck;
          entry.cb.dispatchEvent(new Event('input', { bubbles: true }));
          entry.cb.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(120);
          if (isEntryChecked(entry) !== !!shouldCheck) {
            entry.cb.focus();
            entry.cb.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true }));
            entry.cb.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, bubbles: true }));
            await sleep(120);
          }
        } catch (_) {}
        return isEntryChecked(entry) === !!shouldCheck;
      };

      const getAddOwnInputs = (dialogEl, ownEntry = null) => {
        if (!dialogEl) return [];
        const ownRect = ownEntry?.cb?.getBoundingClientRect?.() || null;
        const inputs = queryAllWithShadow(
          'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea, [role="textbox"], [contenteditable="true"]',
          dialogEl
        ).filter(el => isElementVisible(el));
        if (!ownRect) return inputs;
        return inputs
          .filter(el => {
            const r = el.getBoundingClientRect();
            // Custom attribute input appears in the lower part of the dialog.
            return r.top >= ownRect.top - 20;
          })
          .sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            const ady = Math.max(0, ar.top - ownRect.bottom);
            const bdy = Math.max(0, br.top - ownRect.bottom);
            const adx = Math.abs(ar.left - ownRect.left);
            const bdx = Math.abs(br.left - ownRect.left);
            return (ady * 2 + adx) - (bdy * 2 + bdx);
          });
      };

      const isAddOwnInputVisible = (dialogEl, ownEntry = null) =>
        getAddOwnInputs(dialogEl, ownEntry).length > 0;

      const didCreateAxisChip = () => {
        // Refresh builderRoot before reading chips — React re-renders after Save
        // can detach the old root from the DOM, causing queries to return empty.
        builderRoot = findBuilderRoot();
        const chips = readAttributeChips();
        if (chips.some(c => matchesAlias(c.norm, spec, true) || c.norm === norm(axisLabel))) return true;

        // MSKU iframe right-panel check: after clicking Save on a built-in attribute,
        // the chip appears in the right panel ("Attributes and options you've selected")
        // which is OUTSIDE the band that readAttributeChips() scans.
        // Scan the entire activeDoc for any element whose text matches our axis label
        // and which has a Remove button (indicating it's a selected chip, not just a list item).
        const normLabel = norm(axisLabel);
        const allRemoveBtns = queryAllWithShadow(
          'button[aria-label*="Remove"], button[aria-label*="remove"], button[aria-label*="Delete"], [role="button"][aria-label*="Remove"]',
          activeDoc || document
        );
        return allRemoveBtns.some(btn => {
          const ariaLabel = norm(btn.getAttribute('aria-label') || '');
          // Only match if the aria-label specifically references THIS axis label
          // (not a partial match that could hit other attributes)
          const container = btn.closest('[class*="chip"],[class*="tag"],[class*="token"],[class*="selected"],[class*="attribute"]') || btn.parentElement;
          const containerText = norm((container?.textContent || '').replace(/remove/gi, '').trim());
          return (ariaLabel.includes(normLabel) && ariaLabel.length < normLabel.length + 30) ||
                 (containerText === normLabel || containerText.startsWith(normLabel));
        });
      };

      // Pre-check: if the attribute chip already exists (e.g. from a previous session
      // or because the attribute was pre-checked in the dialog), skip the dialog entirely.
      if (didCreateAxisChip()) {
        console.warn(`[DropFlow] Chip for "${axisLabel}" already exists, skipping dialog`);
        await logVariationStep('variationBuilder:chipAlreadyExists', { axis: axisLabel });
        return true;
      }

      for (let attempt = 1; attempt <= 3; attempt++) {
        const addBtn = findAddAttributeTrigger();
        if (!addBtn) {
          await logVariationStep('variationBuilder:addOwnNoAddBtn', { axis: axisLabel, attempt });
          // BUG FIX: The Add button may not be rendered yet if the page is still
          // transitioning (e.g. right after removing blacklisted chips).  Wait and
          // retry rather than bailing immediately.  Only give up after all 3 attempts.
          if (attempt < 3) {
            await sleep(1500);
            continue;
          }
          return false;
        }
        simulateClick(addBtn);
        await sleep(250);

        let dialog = null;
        for (let wait = 0; wait < 15; wait++) {
          dialog = findAddAttributeDialog();
          if (dialog) break;
          await sleep(120);
        }
        if (!dialog) {
          // Fallback: eBay may show a plain text menu (not a dialog with checkboxes).
          // Menu items are clickable elements with text matching attribute names.
          const menuItems = queryAllWithShadow('li, [role="menuitem"], [role="option"], a, button, span', activeDoc)
            .filter(el => isElementVisible(el) && (el.textContent || '').trim().length < 60);
          const targetNorm = norm(axisLabel);
          const menuMatch = menuItems.find(el => {
            const elNorm = norm((el.textContent || '').trim());
            return elNorm === targetNorm || (spec.strict && spec.strict.has(elNorm)) || (spec.soft && spec.soft.has(elNorm));
          });
          if (menuMatch) {
            console.warn(`[DropFlow] Found plain text menu item for "${axisLabel}": "${(menuMatch.textContent || '').trim()}"`);
            simulateClick(menuMatch);
            await sleep(400);
            // Look for Save button after selecting
            const saveBtn = findButtonByText(activeDoc, /^\s*save\s*$/i);
            if (saveBtn) { simulateClick(saveBtn); await sleep(500); }
            if (didCreateAxisChip()) {
              console.warn(`[DropFlow] Text menu selection succeeded for "${axisLabel}"`);
              return true;
            }
          }
          await logVariationStep('variationBuilder:addOwnNoDialog', { axis: axisLabel, attempt });
          continue;
        }

        const resolveDialogState = () => {
          const liveDialog = findAddAttributeDialog() || dialog;
          if (liveDialog) dialog = liveDialog;
          const entriesNow = getCheckboxEntries(dialog);
          const ownEntryNow = findOwnCheckboxEntry(dialog, entriesNow);
          return { liveDialog: dialog, entriesNow, ownEntryNow };
        };

        let state = resolveDialogState();

        // === PATH A: Prefer built-in attribute checkbox over add-own ===
        // Built-in attributes (Colour, Dog Size, etc.) are pre-registered in eBay's
        // category taxonomy and don't require the fragile custom input path.
        //
        // CRITICAL: eBay's React checkboxes are double-toggled by simulateClick()
        // which dispatches BOTH new MouseEvent('click') AND el.click().
        // React processes both, toggling check→uncheck. Use native .click() ONLY
        // for a single toggle, matching real user behaviour.
        const builtInEntry = state.entriesNow.find(e => {
          if (!e.txt) return false;
          if (e === state.ownEntryNow || e.cb === state.ownEntryNow?.cb) return false;
          if (/add\s+your\s+own/i.test(e.txt)) return false;
          const entryNorm = norm(e.txt);
          // Never select blacklisted attributes (Character, Character Family, etc.)
          if (BUILDER_AXIS_BLACKLIST.has(entryNorm)) return false;
          return spec.strict.has(entryNorm) || spec.soft.has(entryNorm);
        });
        if (builtInEntry) {
          console.warn(`[DropFlow] Built-in match: "${builtInEntry.txt}" for "${axisLabel}" (attempt ${attempt})`);
          console.warn(`[DropFlow] Dialog entries: [${state.entriesNow.map(e => `"${e.txt}" checked=${isEntryChecked(e)}`).join(', ')}]`);
          await logVariationStep('variationBuilder:builtInMatch', {
            axis: axisLabel, builtIn: builtInEntry.txt, attempt,
            entries: state.entriesNow.map(e => ({ txt: e.txt, checked: isEntryChecked(e) }))
          });

          // Deselect other checked entries, BUT preserve entries that match
          // a desired axis (e.g., keep "dog size" checked when adding "colour").
          // The dialog controls which attributes exist - unchecking one removes it.
          for (const e of state.entriesNow) {
            if (e.cb === builtInEntry.cb) continue;
            if (!isEntryChecked(e)) continue;
            const entryNorm = norm(e.txt);
            if (anyAxisMatch(entryNorm, false) || anyAxisMatch(entryNorm, true)) {
              console.warn(`[DropFlow] Preserving checked entry "${e.txt}" (matches desired axis)`);
              continue;
            }
            (e.row || e.cb).click();
            await sleep(150);
          }

          // Select the built-in with escalating single-click strategies
          if (!isEntryChecked(builtInEntry)) {
            // Strategy 1: click the label/row wrapper (most reliable for React)
            (builtInEntry.row || builtInEntry.cb).click();
            await sleep(250);
          }
          if (!isEntryChecked(builtInEntry)) {
            // Strategy 2: click the checkbox input directly
            builtInEntry.cb.click();
            await sleep(250);
          }
          if (!isEntryChecked(builtInEntry)) {
            // Strategy 3: find and click the associated <label for="...">
            const cbId = builtInEntry.cb.getAttribute('id');
            if (cbId) {
              const lbl = dialog.querySelector(`label[for="${cbId}"]`) ||
                          (state.liveDialog || dialog).querySelector(`label[for="${cbId}"]`);
              if (lbl) { lbl.click(); await sleep(250); }
            }
          }
          if (!isEntryChecked(builtInEntry)) {
            // Strategy 4: coordinate click at row center (bypasses event delegation issues)
            const rowRect = (builtInEntry.row || builtInEntry.cb).getBoundingClientRect();
            if (rowRect.width > 0 && rowRect.height > 0) {
              const target = builtInEntry.row || builtInEntry.cb;
              const view = target.ownerDocument?.defaultView || window;
              const cx = rowRect.left + rowRect.width / 2;
              const cy = rowRect.top + rowRect.height / 2;
              const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view };
              target.dispatchEvent(new PointerEvent('pointerdown', opts));
              target.dispatchEvent(new MouseEvent('mousedown', opts));
              target.dispatchEvent(new PointerEvent('pointerup', opts));
              target.dispatchEvent(new MouseEvent('mouseup', opts));
              target.dispatchEvent(new MouseEvent('click', opts));
              // NO el.click() here - single click only
              await sleep(250);
            }
          }

          // Verify selection after all strategies
          await sleep(100);
          state = resolveDialogState();
          const freshBI = state.entriesNow.find(e => e.cb === builtInEntry.cb);
          const biChecked = freshBI ? isEntryChecked(freshBI) : false;
          console.warn(`[DropFlow] After built-in select: checked=${biChecked}, entries=[${state.entriesNow.map(e => `"${e.txt}"=${isEntryChecked(e)}`).join(', ')}]`);

          // If checkbox was already checked when dialog opened, Save may be disabled
          // because React sees no change. Force a change by unchecking then rechecking.
          if (biChecked) {
            const freshDlg2 = findAddAttributeDialog() || state.liveDialog || dialog;
            let testSave = findButtonByText(freshDlg2, /^\s*save\s*$/i);
            const saveAlreadyEnabled = testSave && !testSave.disabled &&
              testSave.getAttribute?.('aria-disabled') !== 'true' &&
              testSave.getAttribute?.('disabled') == null;
            if (!saveAlreadyEnabled) {
              console.warn(`[DropFlow] Save disabled despite biChecked=true — forcing uncheck+recheck`);
              // Uncheck
              const freshEntry = state.entriesNow.find(e => e.cb === builtInEntry.cb);
              if (freshEntry) {
                (freshEntry.row || freshEntry.cb).click();
                await sleep(300);
                // Re-check
                state = resolveDialogState();
                const freshEntry2 = state.entriesNow.find(e => e.cb === builtInEntry.cb);
                if (freshEntry2 && !isEntryChecked(freshEntry2)) {
                  (freshEntry2.row || freshEntry2.cb).click();
                  await sleep(300);
                }
              }
            }
          }

          if (biChecked) {
            // Find Save button - search ONLY within the dialog, not the whole page
            const dlg = findAddAttributeDialog() || state.liveDialog || dialog;
            let saveBtn = findButtonByText(dlg, /^\s*save\s*$/i);
            if (!saveBtn) {
              // Broader search within dialog
              const allBtns = queryAllWithShadow('button, [role="button"]', dlg);
              saveBtn = allBtns.find(b => isElementVisible(b) && /^\s*save\s*$/i.test((b.textContent || '').trim()));
            }

            // Wait for Save to become enabled
            for (let w = 0; w < 15 && saveBtn; w++) {
              if (!saveBtn.disabled && saveBtn.getAttribute?.('aria-disabled') !== 'true' &&
                  saveBtn.getAttribute?.('disabled') == null) break;
              await sleep(200);
              const freshDlg = findAddAttributeDialog() || dlg;
              saveBtn = findButtonByText(freshDlg, /^\s*save\s*$/i) ||
                        queryAllWithShadow('button, [role="button"]', freshDlg)
                          .find(b => isElementVisible(b) && /^\s*save\s*$/i.test((b.textContent || '').trim()));
            }

            const saveEnabled = saveBtn && !saveBtn.disabled &&
              saveBtn.getAttribute?.('aria-disabled') !== 'true';
            const valText = ((dlg.textContent || '').match(/please select[^.]*/i) || [''])[0];
            console.warn(`[DropFlow] Save state: found=${!!saveBtn}, enabled=${saveEnabled}, validation="${valText.slice(0, 60)}"`);

            if (saveEnabled) {
              // Click Save with native .click() first, then coordinate click as backup
              saveBtn.click();
              await sleep(400);
              for (let w = 0; w < 12; w++) {
                if (didCreateAxisChip()) {
                  console.warn(`[DropFlow] Built-in "${builtInEntry.txt}" saved successfully for "${axisLabel}"`);
                  return true;
                }
                await sleep(150);
              }
              // Retry with coordinate click on Save
              const freshSave = findButtonByText(findAddAttributeDialog() || dlg, /^\s*save\s*$/i);
              if (freshSave) {
                const sr = freshSave.getBoundingClientRect();
                clickAtPoint(freshSave, sr.left + sr.width / 2, sr.top + sr.height / 2);
                await sleep(400);
                for (let w = 0; w < 10; w++) {
                  if (didCreateAxisChip()) {
                    console.warn(`[DropFlow] Built-in "${builtInEntry.txt}" saved (coord click) for "${axisLabel}"`);
                    return true;
                  }
                  await sleep(150);
                }
              }
            }
            console.warn(`[DropFlow] Built-in path: save failed for "${builtInEntry.txt}" (saveFound=${!!saveBtn}, saveEnabled=${saveEnabled})`);
          } else {
            console.warn(`[DropFlow] Built-in checkbox "${builtInEntry.txt}" did not stay checked after 4 strategies`);
          }

          // Close dialog before retry - search ONLY in dialog to avoid hitting
          // the main builder's Cancel button
          const dlgNow = findAddAttributeDialog() || state.liveDialog || dialog;
          const cancelBtn = findButtonByText(dlgNow, /^\s*cancel\s*$/i);
          if (cancelBtn) {
            cancelBtn.click();
            await sleep(200);
          } else {
            const view = activeDoc.defaultView || window;
            activeDoc.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            await sleep(200);
          }
          continue;
        }
        // === End PATH A: No built-in match - fall through to add-own ===

        if (!state.ownEntryNow) {
          console.warn(`[DropFlow] No built-in or add-own checkbox found (attempt ${attempt})`);
          await logVariationStep('variationBuilder:addOwnNoToggle', { axis: axisLabel, attempt });
          continue;
        }

        // Keep only "Add your own attribute" selected.
        // Never intentionally uncheck it again in this attempt, because some
        // eBay builds can get stuck oscillating on/off.
        const ensureOwnChecked = async () => {
          for (let ownAttempt = 0; ownAttempt < 8; ownAttempt++) {
            state = resolveDialogState();
            if (!state.ownEntryNow) return false;

            // Clear any preset attribute checks first.
            for (const e of state.entriesNow) {
              if (e === state.ownEntryNow || e.cb === state.ownEntryNow?.cb) continue;
              if (isEntryChecked(e)) await setCheckboxState(e, false);
            }

            if (isEntryChecked(state.ownEntryNow)) {
              await sleep(100);
              state = resolveDialogState();
              if (state.ownEntryNow && isEntryChecked(state.ownEntryNow)) return true;
            }

            let checked = await setCheckboxState(state.ownEntryNow, true);
            if (!checked && state.ownEntryNow?.cb) {
              const id = state.ownEntryNow.cb.getAttribute('id');
              let lbl = null;
              if (id) {
                try { lbl = state.liveDialog.querySelector(`label[for="${CSS.escape(id)}"]`); } catch (_) { /* noop */ }
                if (!lbl) lbl = state.liveDialog.querySelector(`label[for="${id}"]`);
              }
              if (lbl) {
                simulateClick(lbl);
                await sleep(120);
                checked = isEntryChecked(state.ownEntryNow);
              }
            }
            if (!checked && state.ownEntryNow?.cb) {
              state.ownEntryNow.cb.focus();
              const v = state.ownEntryNow.cb.ownerDocument?.defaultView || window;
              state.ownEntryNow.cb.dispatchEvent(new v.KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true }));
              state.ownEntryNow.cb.dispatchEvent(new v.KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, bubbles: true }));
              await sleep(120);
            }
            // Last-resort: coordinate-based click at the center of the row wrapper.
            // Manual mouse clicks work because they hit the React event boundary;
            // replicate that by clicking at the exact center of the interactive area.
            if (!isEntryChecked(state.ownEntryNow) && state.ownEntryNow?.row) {
              const rowRect = state.ownEntryNow.row.getBoundingClientRect();
              if (rowRect.width > 0 && rowRect.height > 0) {
                clickAtPoint(
                  state.ownEntryNow.row,
                  rowRect.left + rowRect.width / 2,
                  rowRect.top + rowRect.height / 2
                );
                await sleep(200);
              }
            }
          }
          state = resolveDialogState();
          return !!state?.ownEntryNow && isEntryChecked(state.ownEntryNow);
        };

        const ownChecked = await ensureOwnChecked();
        let ownMode = ownChecked && isAddOwnInputVisible(state.liveDialog, state.ownEntryNow);

        if (!ownMode) {
          console.warn(`[DropFlow] Add-own mode did not expand input area (attempt ${attempt})`);
          await logVariationStep('variationBuilder:addOwnToggleFailed', {
            axis: axisLabel,
            attempt,
            ownChecked: !!state?.ownEntryNow && isEntryChecked(state.ownEntryNow),
            ownEntryText: state?.ownEntryNow?.txt || null,
            checkboxCount: state?.entriesNow?.length || 0
          });
          // Continue into input wait if checkbox is checked; some builds render
          // the input area with a delay after the checkbox state commits.
          if (!ownChecked) continue;
        }

        // Wait for custom-name input to appear after toggling.
        let input = null;
        for (let wait = 0; wait < 60; wait++) {
          state = resolveDialogState();
          const inputs = getAddOwnInputs(state.liveDialog, state.ownEntryNow);
          if (inputs.length > 0) input = inputs[0];
          if (input) break;

          if ((wait === 20 || wait === 40) && state.ownEntryNow) {
            await setCheckboxState(state.ownEntryNow, true);
          }
          await sleep(120);
        }
        if (!input) {
          state = resolveDialogState();
          const dialogText = ((state.liveDialog?.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 220);
          console.warn(`[DropFlow] Add-own input did not appear (attempt ${attempt})`);
          await logVariationStep('variationBuilder:addOwnNoInput', {
            axis: axisLabel,
            attempt,
            ownChecked: !!state.ownEntryNow && isEntryChecked(state.ownEntryNow),
            hasHelperText: /enter a unique attribute/i.test(state.liveDialog?.textContent || ''),
            dialogText
          });
          continue;
        }

        await commitInputValue(input, axisLabel);
        await sleep(120);

        const ensureInputValue = async () => {
          let val = String(input.value || input.textContent || '').trim();
          if (val) return true;
          try {
            const view = input.ownerDocument?.defaultView || window;
            const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set;
            if (setter && input.tagName === 'INPUT') setter.call(input, axisLabel);
            else input.value = axisLabel;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'e', bubbles: true }));
            input.blur();
            await sleep(120);
            val = String(input.value || input.textContent || '').trim();
            return !!val;
          } catch (_) {
            return false;
          }
        };
        const hasValue = await ensureInputValue();
        if (!hasValue) {
          await logVariationStep('variationBuilder:addOwnValueEmpty', { axis: axisLabel, attempt });
          continue;
        }

        const ensureOwnSelectionAndValue = async () => {
          for (let fix = 0; fix < 6; fix++) {
            state = resolveDialogState();
            if (!state?.ownEntryNow) return false;
            let checked = isEntryChecked(state.ownEntryNow);
            if (!checked) {
              checked = await setCheckboxState(state.ownEntryNow, true);
              if (!checked && state.ownEntryNow?.cb) {
                simulateClick(state.ownEntryNow.cb);
                await sleep(120);
                checked = isEntryChecked(state.ownEntryNow);
              }
            }

            const val = String(input?.value || input?.textContent || '').trim();
            if (!val) {
              await commitInputValue(input, axisLabel);
              await sleep(100);
            }

            if (checked) {
              // Ensure the checked state sticks after any reactive rerender.
              await sleep(120);
              state = resolveDialogState();
              checked = !!state?.ownEntryNow && isEntryChecked(state.ownEntryNow);
              if (checked) return true;
            }
            await sleep(120);
          }
          return false;
        };

        await ensureOwnSelectionAndValue();

        const resolveSaveBtn = () => {
          const liveDialog = findAddAttributeDialog() || dialog;
          return findButtonByText(liveDialog, /^\s*save\s*$/i) || findByText(/^\s*save\s*$/i, liveDialog);
        };

        let saveBtn = resolveSaveBtn();
        const isSaveEnabled = (btn) => {
          if (!btn) return false;
          if (btn.disabled) return false;
          const ariaDisabled = String(btn.getAttribute?.('aria-disabled') || '').toLowerCase() === 'true';
          if (ariaDisabled) return false;
          if (btn.getAttribute?.('disabled') != null) return false;
          const cls = String(btn.className || '').toLowerCase();
          if (/disabled/.test(cls) && !isInteractableAtCenter(btn)) return false;
          return true;
        };

        if (!isSaveEnabled(saveBtn)) {
          // Give eBay validation a moment after input events/blur, and actively
          // repair common invalid states (unchecked add-own checkbox).
          for (let w = 0; w < 14; w++) {
            await sleep(120);
            state = resolveDialogState();
            const dlgText = (state?.liveDialog?.textContent || '').toLowerCase();
            if (/please select at least one attribute/.test(dlgText) || w % 4 === 3) {
              await ensureOwnSelectionAndValue();
            }
            saveBtn = resolveSaveBtn();
            if (isSaveEnabled(saveBtn)) break;
          }
        }
        if (!isSaveEnabled(saveBtn)) {
          state = resolveDialogState();
          const dlgText = (state?.liveDialog?.textContent || '').toLowerCase();
          await logVariationStep('variationBuilder:addOwnNoSave', {
            axis: axisLabel,
            attempt,
            inputValue: String(input.value || input.textContent || '').trim(),
            ownChecked: !!state?.ownEntryNow && isEntryChecked(state.ownEntryNow),
            hasSelectOneError: /please select at least one attribute/.test(dlgText)
          });
          continue;
        }

        // Log exact state before Save for diagnostics
        {
          const dlg = state?.liveDialog || dialog;
          const validationText = (dlg?.textContent || '').match(/please\s+select[^.]*|error[^.]*/i)?.[0] || '';
          const checkedEntries = state.entriesNow.filter(e => isEntryChecked(e)).map(e => e.txt);
          const inputVal = String(input?.value || input?.textContent || '').trim();
          console.warn(`[DropFlow] Add-own pre-save state: checked=[${checkedEntries.join(', ')}], input="${inputVal}", validation="${validationText.slice(0, 80)}"`);
        }

        simulateClick(asClickableTarget(saveBtn));
        await sleep(300);

        // Verify chip creation; if not, try coordinate click on Save.
        let chipCreated = false;
        for (let wait = 0; wait < 10; wait++) {
          if (didCreateAxisChip()) { chipCreated = true; break; }
          await sleep(120);
        }
        if (!chipCreated) {
          // Retry: coordinate-based click directly on Save button center
          const freshSave = resolveSaveBtn();
          if (freshSave && isSaveEnabled(freshSave)) {
            const sr = freshSave.getBoundingClientRect();
            clickAtPoint(freshSave, sr.left + sr.width / 2, sr.top + sr.height / 2);
            await sleep(300);
          }
          for (let wait = 0; wait < 10; wait++) {
            if (didCreateAxisChip()) { chipCreated = true; break; }
            await sleep(120);
          }
        }
        if (chipCreated) return true;

        const dlgText = (findAddAttributeDialog()?.textContent || '').toLowerCase();
        await logVariationStep('variationBuilder:addOwnNotApplied', {
          axis: axisLabel,
          attempt,
          hasValidationError: /please select at least one attribute|enter/i.test(dlgText)
        });

        // Close dialog before retrying to avoid stacked state.
        const cancelBtn = findButtonByText(dialog, /^\s*cancel\s*$/i) ||
                          findByText(/^\s*cancel\s*$/i, dialog);
        if (cancelBtn) {
          simulateClick(asClickableTarget(cancelBtn));
          await sleep(180);
        } else {
          const view = activeDoc.defaultView || window;
          activeDoc.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
          await sleep(180);
        }
      }

      return false;
    };

    const clearSelectedOptionsForActiveAttribute = async () => {
      let cleared = 0;
      // Re-read options each iteration because React re-renders after each click
      // can detach previously-read element references from the live DOM.
      let maxPasses = 50; // safety limit
      while (maxPasses-- > 0) {
        builderRoot = findBuilderRoot();
        const opts = readVisibleOptions();
        const selected = opts.find(o => o.selected);
        if (!selected) break;
        (asClickableTarget(selected.el)).click();
        await sleep(150);
        cleared++;
      }
      return cleared;
    };

    const matchesSizeOption = (targetNorm, optionNorm) => {
      if (targetNorm === optionNorm) return true;
      // Also try prefix match: "xsold" starts with "xs", "xlnew" starts with "xl"
      const sizeKeys = ['xxxs', 'xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', '2xl', '3xl', '4xl', '5xl'];
      for (const sk of sizeKeys) {
        if ((targetNorm === sk || targetNorm.startsWith(sk)) && (optionNorm === sk || optionNorm.startsWith(sk))) return true;
      }
      const map = {
        xs: ['xsmall', 'xss', 'extrasmall', 'extrsmall'],
        s: ['small', 'sm'],
        m: ['medium', 'med'],
        l: ['large', 'lg'],
        xl: ['xlarge', 'extralarge'],
        xxl: ['2xl', 'xxlarge', '2xlarge'],
        xxxl: ['3xl', 'xxxl', '3xlarge'],
        xxs: ['2xs', 'xxsmall']
      };
      for (const [k, vals] of Object.entries(map)) {
        if (targetNorm === k && vals.includes(optionNorm)) return true;
        if (optionNorm === k && vals.includes(targetNorm)) return true;
        // Also check if target starts with k (handles "xsold" → "xs")
        if (targetNorm.startsWith(k) && optionNorm === k) return true;
        if (optionNorm.startsWith(k) && targetNorm === k) return true;
      }
      return false;
    };

    const ensureOptionSelected = async (axisName, value) => {
      // Strip parenthetical notes like "(old)", "(new)", "(5-10kg)" from AliExpress size names
      const cleanedValue = String(value || '').replace(/\s*\([^)]*\)\s*/g, '').trim();
      const targetNorm = norm(cleanedValue || value);
      if (!targetNorm) return false;

      // Refresh builderRoot before each option — React re-renders after previous
      // option clicks can detach the old root from the live DOM tree.
      builderRoot = findBuilderRoot();

      const findMatch = () => {
        const options = readVisibleOptions();
        return options.find(o => o.norm === targetNorm || matchesSizeOption(targetNorm, o.norm)) || null;
      };

      let opt = findMatch();
      if (opt) {
        if (!opt.selected) {
          // eBay's variation builder uses <li role="button"> elements that require
          // full PointerEvent+MouseEvent sequence. Plain .click() doesn't trigger
          // React's event handlers on these elements.
          const target = asClickableTarget(opt.el);
          const rect = target.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const ownerView = (target.ownerDocument || document).defaultView || window;
          target.dispatchEvent(new ownerView.PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
          target.dispatchEvent(new ownerView.MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
          target.dispatchEvent(new ownerView.PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
          target.dispatchEvent(new ownerView.MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
          target.dispatchEvent(new ownerView.MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
          await sleepShort();
          // Verify the option actually got selected
          const freshOpts = readVisibleOptions();
          const freshOpt = freshOpts.find(o => o.norm === opt.norm);
          if (freshOpt && !freshOpt.selected) {
            // Retry with native .click() as fallback
            target.click();
            await sleepShort();
          }
        }
        return true;
      }

      const createBtn =
        findByText(/^\+\s*create your own$/i) ||
        findByText(/create your own/i) ||
        findByText(/^\+\s*create/i);
      if (createBtn) {
        (asClickableTarget(createBtn)).click();
        await sleep(300);

        // The "Create your own" input can appear asynchronously or in a popover.
        // Poll broadly for textbox-like controls and prefer elements near the
        // create button before falling back to activeElement.
        let input = null;
        const findCreateInput = () => {
          const near = createBtn.closest('section, article, div, li, form') || builderRoot || activeDoc;
          const selectors = [
            'input[type="text"]',
            'input:not([type])',
            'textarea',
            '[contenteditable="true"]',
            '[role="textbox"]',
            '[role="combobox"]',
            'input[aria-label*="option" i]',
            'input[aria-label*="value" i]',
            'input[placeholder*="option" i]',
            'input[placeholder*="value" i]',
            'input[placeholder*="create" i]'
          ];
          for (const sel of selectors) {
            const local = queryAllWithShadow(sel, near).find(el => isElementVisible(el));
            if (local) return local;
          }
          for (const sel of selectors) {
            const global = queryAllWithShadow(sel, activeDoc).find(el => isElementVisible(el));
            if (global) return global;
          }
          return null;
        };

        for (let tries = 0; tries < 10; tries++) {
          input = findCreateInput();
          if (input) break;
          await sleep(150);
        }

        if (!input && activeDoc.activeElement) {
          const ae = activeDoc.activeElement;
          if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable || ae.getAttribute?.('role') === 'textbox')) {
            input = ae;
          }
        }

        if (input) {
          await quickTypeAndEnter(input, value);
          // Some variants require an explicit Add click near the inline create input.
          const inputScope = input.closest('div, li, section, form') || builderRoot || activeDoc;
          const pickAdd = (ctx) => queryAllWithShadow('button, a, [role="button"], span', ctx)
            .find(el => {
              if (!isElementVisible(el)) return false;
              const t = (el.textContent || '').trim().toLowerCase();
              return t === 'add' || t === 'done';
            });
          const addBtn = pickAdd(inputScope) || pickAdd(builderRoot) || pickAdd(activeDoc);
          if (addBtn) {
            (asClickableTarget(addBtn)).click();
            await sleep(250);
          }
        } else {
          await logVariationStep('variationBuilder:createOwnNoInput', {
            axis: axisName,
            value,
            createBtnText: (createBtn.textContent || '').trim()
          });
        }
      }

      opt = findMatch();
      if (opt) {
        if (!opt.selected) {
          (asClickableTarget(opt.el)).click();
          await sleepShort();
        }
        return true;
      }

      console.warn(`[DropFlow] Option not found: axis="${axisName}", value="${value}" (norm="${targetNorm}")`);
      await logVariationStep('variationBuilder:optionNotFound', { axis: axisName, value });
      return false;
    };

    // Align existing builder attribute chips with AliExpress variation axes.
    const mapSpecsToChips = (sourceChips) => {
      // Filter out blacklisted chips — these should never be mapped to any axis
      const validChips = sourceChips.filter(c => !BUILDER_AXIS_BLACKLIST.has(c.norm));
      const mapped = [];
      const usedNorms = new Set();
      for (const spec of axisSpecs) {
        let chip = validChips.find(c => !usedNorms.has(c.norm) && matchesAlias(c.norm, spec, false)) ||
                   validChips.find(c => !usedNorms.has(c.norm) && matchesAlias(c.norm, spec, true)) ||
                   null;
        if (!chip && /color|colour/i.test(spec.axis.name)) {
          // "features" excluded — it's a generic eBay attribute that doesn't carry colour semantics
          chip = validChips.find(c => !usedNorms.has(c.norm) && /(style|colour|color)/.test(c.norm)) || null;
        }
        if (!chip) continue;
        usedNorms.add(chip.norm);
        mapped.push({ spec, chip, fallback: false });
      }
      return mapped;
    };

    builderRoot = findBuilderRoot();

    // === PRE-EXISTING VARIATIONS DETECTION ===
    // When eBay auto-populates variation rows based on product category, the builder
    // opens directly on the pricing/combinations table (no attribute selection step).
    // Detect this state and skip straight to filling prices + Save and close.
    {
      const pricingInputs = queryAllWithShadow('input[type="text"], input[type="number"], input:not([type])', activeDoc)
        .filter(el => {
          if (!isElementVisible(el)) return false;
          const ph = (el.getAttribute('placeholder') || '').toLowerCase();
          const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
          const name = (el.getAttribute('name') || '').toLowerCase();
          return /price|quantity|qty/i.test(`${ph} ${ariaLabel} ${name}`);
        });
      const saveCloseBtn = queryAllWithShadow('button, [role="button"]', activeDoc)
        .find(b => isElementVisible(b) && /save\s+and\s+close/i.test((b.textContent || '').trim()));
      const addTrigger = findAddAttributeTrigger ? findAddAttributeTrigger() : null;

      if (pricingInputs.length >= 3 && saveCloseBtn && !addTrigger) {
        console.warn(`[DropFlow] Pre-existing variations detected: ${pricingInputs.length} pricing inputs, Save and close found, no Add button`);
        await logVariationStep('variationBuilder:preExistingVariations', {
          pricingInputCount: pricingInputs.length,
          hasSaveClose: true
        });

        // Fill per-SKU pricing in the existing table
        if (productData?.variations?.skus?.length > 0) {
          try {
            await fillBuilderPricingTable(activeDoc, productData);
          } catch (e) {
            console.error('[DropFlow] Pre-existing variations pricing fill error:', e.message, e.stack);
          }
        }

        // Clear UPC fields
        try {
          const upcInputs = queryAllWithShadow('input[cn="upc"], input[cn="UPC"]', activeDoc);
          for (const upcInput of upcInputs) {
            const dropdownLink = upcInput.parentElement?.querySelector('a.pull-down, a[role="button"]');
            if (dropdownLink) {
              simulateClick(dropdownLink);
              await sleep(300);
              const menu = upcInput.closest('span')?.querySelector('ul[role="menu"]');
              if (menu) {
                const dnaOption = Array.from(menu.querySelectorAll('a[role="menuitem"]'))
                  .find(a => /does not apply/i.test(a.textContent));
                if (dnaOption) { simulateClick(dnaOption); await sleep(200); }
              }
            } else {
              const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (nativeSetter) nativeSetter.call(upcInput, 'Does not apply');
              else upcInput.value = 'Does not apply';
              upcInput.dispatchEvent(new Event('input', { bubbles: true }));
              upcInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          if (upcInputs.length > 0) console.log(`[DropFlow] Set ${upcInputs.length} UPC fields to "Does not apply"`);
        } catch (e) { console.warn('[DropFlow] UPC clearing error:', e.message); }

        // Upload photos if available
        if (productData.images && productData.images.length > 0) {
          try { await uploadPhotosViaMskuBuilder(productData); } catch (e) { console.warn('[DropFlow] Builder photo upload error:', e.message); }
        }

        // Click Save and close
        simulateClick(saveCloseBtn);
        __dropflowVariationSaveCloseTs = Date.now();
        await logVariationStep('variationBuilder:preExistingSaveAndCloseClicked', {});
        console.warn('[DropFlow] Pre-existing variations: clicked Save and close');

        // Wait for builder to close
        for (let i = 0; i < 40; i++) {
          await sleep(500);
          const ctx = detectVariationBuilderContext();
          if (!ctx.isBuilder) break;
          if (!document.contains(activeDoc.documentElement || activeDoc.body)) break;
        }

        await releaseCrossContextLock();
        try { await chrome.storage.local.set({ dropflow_builder_complete: { ts: Date.now(), draftId: window.location.href } }); } catch (_) {}
        return true;
      }
    }

    let chips = readAttributeChips();

    console.warn(`[DropFlow] Builder state: chips=[${chips.map(c => c.text).join(', ')}], desired=[${desiredAxes.map(a => a.name).join(', ')}]`);
    await logVariationStep('variationBuilder:stateBefore', {
      chips: chips.map(c => c.text),
      desiredAxes: desiredAxes.map(a => a.name)
    });

    // Pre-clean: remove any blacklisted attribute chips before the selective reset.
    // When eBay reuses a draft, stale attributes like "Character" or "Character Family"
    // may already be selected. These must be removed first to avoid interfering with
    // axis matching and to prevent them surviving through accidental alias matches.
    // Use aria-label remove buttons directly — eBay MSKU chips have
    // <button class="faux-link" aria-label="Remove {Name} attribute">
    {
      const removeBtns = queryAllWithShadow('button[aria-label^="Remove"]', activeDoc)
        .filter(btn => {
          const label = btn.getAttribute('aria-label') || '';
          const match = label.match(/^Remove\s+(.+?)\s+attribute$/i);
          if (!match) return false;
          const attrName = norm(match[1]);
          return BUILDER_AXIS_BLACKLIST.has(attrName);
        });
      if (removeBtns.length > 0) {
        console.warn(`[DropFlow] Removing ${removeBtns.length} blacklisted stale chip(s) via aria-label buttons`);
        for (const btn of removeBtns) {
          const label = btn.getAttribute('aria-label') || '';
          simulateClick(btn);
          await sleep(500);
          await dismissVariationDialogs();
          await logVariationStep('variationBuilder:blacklistChipRemoved', { chip: label, removed: true });
        }
        builderRoot = findBuilderRoot();
        chips = readAttributeChips();
        console.warn(`[DropFlow] After blacklist cleanup: chips=[${chips.map(c => c.text).join(', ')}]`);
      }
    }

    // Selective reset: only keep chips that EXACTLY match a desired axis (or are close synonyms).
    // "Dog Size" must NOT be treated as a match for "Size" — they are different eBay attributes.
    // Compound attribute names are stripped of non-alphanumeric chars by norm(), so "Dog Size"
    // becomes "dogsize" which used to match "dogsize" in the alias list. That bug is now fixed:
    // strict aliases for "size" only include "size", so "Dog Size" will be removed here and the
    // correct "Size" attribute will be added from the +Add menu instead.
    {
      const initialMapped = mapSpecsToChips(chips);
      const keepNorms = new Set(initialMapped.map(m => m.chip.norm));
      const removedNames = [];
      const keptNames = initialMapped.map(m => m.chip.text);
      for (const chip of chips) {
        if (keepNorms.has(chip.norm)) continue;
        const removed = await removeChip(chip);
        if (removed) removedNames.push(chip.text);
        await sleep(120);
      }
      chips = readAttributeChips();
      console.warn(`[DropFlow] Selective reset: kept=[${keptNames.join(', ')}], removed=[${removedNames.join(', ')}], remaining=[${chips.map(c => c.text).join(', ')}]`);
      await logVariationStep('variationBuilder:afterSelectiveReset', {
        kept: keptNames,
        removed: removedNames,
        remaining: chips.map(c => c.text)
      });
    }

    let mappedAxes = mapSpecsToChips(chips);
    let missingSpecs = axisSpecs.filter(spec => !mappedAxes.some(m => m.spec === spec));

    // Try adding missing attributes from +Add menu.
    // Track which specs were successfully added so we can handle them via
    // text input if readAttributeChips() can't detect them as chips
    // (custom/non-standard attribute case).
    const addedViaMenu = new Set();
    for (const spec of missingSpecs) {
      builderRoot = findBuilderRoot();
      chips = readAttributeChips();
      const exists = chips.some(c => matchesAlias(c.norm, spec, false) || matchesAlias(c.norm, spec, true));
      if (exists) continue;
      const added = await addAttributeFromMenu(spec);
      if (added) addedViaMenu.add(spec);
      await logVariationStep('variationBuilder:attributeAddAttempt', {
        axis: spec.axis.name,
        added
      });
      if (!added) continue;
      await sleep(350);
    }

    builderRoot = findBuilderRoot();
    chips = readAttributeChips();
    console.warn(`[DropFlow] Post-add chips: [${chips.map(c => c.text).join(', ')}]`);
    mappedAxes = mapSpecsToChips(chips);
    missingSpecs = axisSpecs.filter(spec => !mappedAxes.some(m => m.spec === spec));

    // Initialise counters here so the custom-attribute text-input path below
    // can increment them before the normal chip-click loop runs.
    let selectedAxes = 0;
    let selectedValues = 0;

    // Custom attribute fallback: when eBay's MSKU builder represents a custom
    // attribute (e.g. "Emitting Color", "Length") as a text-input panel instead
    // of a pre-defined chip, readAttributeChips() returns [] and mapSpecsToChips()
    // cannot match the spec.  addAttributeFromMenu() already returned true (the
    // Remove button for that attribute exists in the DOM), so the attribute IS
    // present – just not rendered as a clickable chip.
    // In that case find the visible text input for the attribute and type each value.
    const customAxesHandled = new Set();
    if (missingSpecs.length > 0) {
      for (const spec of missingSpecs) {
        // Only attempt specs that were successfully added via addAttributeFromMenu.
        // Specs that were never added at all are truly missing and will fail below.
        if (!addedViaMenu.has(spec)) continue;

        const axisLabel = spec.axis.name;
        const normLabel = norm(axisLabel);

        builderRoot = findBuilderRoot();

        // Find the text input for adding values to this custom attribute.
        // eBay shows "Add option" / "Enter a value" style inputs for non-standard attrs.
        const findCustomAttrInput = () => {
          const candidates = queryAllWithShadow(
            'input[type="text"], input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="search"]):not([type="email"]):not([type="number"]), textarea',
            builderRoot || activeDoc
          ).filter(el => {
            if (!isElementVisible(el)) return false;
            if (el.closest('[role="dialog"]')) return false; // ignore dialog inputs
            const ph = (el.getAttribute('placeholder') || '').toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const name = (el.getAttribute('name') || '').toLowerCase();
            return /add|option|value|enter/i.test(`${ph} ${ariaLabel} ${name}`);
          });
          if (candidates.length === 0) return null;
          if (candidates.length === 1) return candidates[0];

          // Multiple inputs: prefer the one nearest to this attribute's Remove button.
          const removeBtns = queryAllWithShadow('button[aria-label]', activeDoc || document)
            .filter(el => {
              const aNorm = norm(el.getAttribute('aria-label') || '');
              return aNorm.includes('remove') && aNorm.includes(normLabel);
            });
          if (removeBtns.length > 0) {
            const refRect = removeBtns[0].getBoundingClientRect();
            const sorted = candidates.slice().sort((a, b) => {
              const ar = a.getBoundingClientRect();
              const br = b.getBoundingClientRect();
              const aDist = Math.abs(ar.top - refRect.top) + Math.abs(ar.left - refRect.left);
              const bDist = Math.abs(br.top - refRect.top) + Math.abs(br.left - refRect.left);
              return aDist - bDist;
            });
            return sorted[0];
          }
          return candidates[0];
        };

        const customInput = findCustomAttrInput();
        if (!customInput) {
          await logVariationStep('variationBuilder:customAttrNoInput', { axis: axisLabel });
          continue;
        }

        const rawVals = Array.from(new Set(spec.axis.values)).slice(0, 40);
        const uniqueVals = rawVals.filter(v => { const n = norm(v); return !!(n && n.length > 0); });
        let addedCount = 0;

        for (const v of uniqueVals) {
          builderRoot = findBuilderRoot();
          await commitInputValue(customInput, v);
          await sleep(300);

          const view = customInput.ownerDocument?.defaultView || window;
          customInput.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          customInput.dispatchEvent(new view.KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          customInput.dispatchEvent(new view.KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          await sleep(400);

          // Also click an adjacent "Add" button when present.
          const inputScope = customInput.closest('div, li, section, form') || builderRoot || activeDoc;
          const addBtn = queryAllWithShadow('button, a, [role="button"], span', inputScope || activeDoc)
            .find(el => {
              if (!isElementVisible(el)) return false;
              const t = (el.textContent || '').trim().toLowerCase();
              return t === 'add' || t === 'done' || t === '+';
            });
          if (addBtn) {
            (asClickableTarget(addBtn)).click();
            await sleep(300);
          }

          addedCount++;
        }

        await logVariationStep('variationBuilder:customAttrValuesFilled', {
          axis: axisLabel,
          valueCount: uniqueVals.length,
          addedCount
        });
        console.warn(`[DropFlow] Custom attr "${axisLabel}": typed ${addedCount}/${uniqueVals.length} values via text input`);

        if (addedCount > 0) {
          customAxesHandled.add(spec);
          selectedAxes++;
          selectedValues += addedCount;
        }
      }

      // After custom-attr handling, check for truly unresolvable specs.
      const trulyMissing = missingSpecs.filter(spec => !customAxesHandled.has(spec));
      if (trulyMissing.length > 0) {
        for (const spec of trulyMissing) {
          await logVariationStep('variationBuilder:noAttributeMatch', { axis: spec.axis.name, chips: chips.map(c => c.text) });
        }
        console.warn('[DropFlow] Variation builder could not create required custom attributes');
        return false;
      }
    }

    // Remove extra chips that aren't mapped to desired axes.
    const keepNorms = new Set(mappedAxes.map(m => m.chip.norm));
    for (const chip of chips) {
      if (keepNorms.has(chip.norm)) continue;
      const removed = await removeChip(chip);
      if (removed) {
        await logVariationStep('variationBuilder:attributeRemoved', { chip: chip.text });
      } else {
        await logVariationStep('variationBuilder:attributeRemoveFailed', { chip: chip.text });
      }
    }

    // Refresh chip references after removals.
    builderRoot = findBuilderRoot();
    chips = readAttributeChips();
    console.warn(`[DropFlow] Pre-option-selection chips: [${chips.map(c => c.text).join(', ')}]`);
    mappedAxes = mappedAxes.map(m => {
      const refreshed = chips.find(c => c.norm === m.chip.norm);
      if (!refreshed) console.warn(`[DropFlow] WARNING: chip "${m.chip.text}" not found in fresh read - DOM may be stale`);
      return { ...m, chip: refreshed || m.chip };
    });

    // selectedAxes / selectedValues were declared and potentially incremented above
    // by the custom-attribute text-input path. Do NOT redeclare them here.

    for (const mapped of mappedAxes) {
      builderRoot = findBuilderRoot();
      // Fix 3: eBay's React components require full PointerEvent+MouseEvent sequence.
      // simulateClick dispatches pointerenter/over/down, mousedown, pointerup, mouseup, click.
      // For MSKU builder chips: the inner <button class="faux-link"> (no aria-label) is
      // the click target that activates the axis and shows its options panel.
      // The outer span itself doesn't trigger React's option panel on click.
      const chipInnerBtn = mapped.chip.el.querySelector('button.faux-link:not([aria-label])') ||
                           mapped.chip.el.querySelector('button:not([aria-label])') ||
                           null;
      const chipClickTarget = chipInnerBtn || asClickableTarget(mapped.chip.el);
      simulateClick(chipClickTarget);
      await sleepShort();

      // FIX: Wait for options panel to render after chip click. eBay's React UI
      // can take >250ms to re-render the options section, especially in the
      // bulkedit iframe. Poll until we see options or "Create your own".
      for (let optWait = 0; optWait < 12; optWait++) {
        const earlyOpts = readVisibleOptions();
        const hasCreateOwn = findByText(/create your own/i);
        if (earlyOpts.length > 0 || hasCreateOwn) break;
        await sleep(250);
        builderRoot = findBuilderRoot();
      }

      // Fix 4: Verify the chip selection registered by checking the right panel
      // ("Attributes and options you've selected") before proceeding to fill values.
      // eBay's builder updates a selected-state indicator on the chip after clicking.
      const chipNorm = norm(mapped.chip.text);
      let chipRegistered = false;
      for (let regWait = 0; regWait < 8; regWait++) {
        builderRoot = findBuilderRoot();
        // Check 1: options or "create your own" are visible (options panel opened)
        const opts = readVisibleOptions();
        const hasCreateOwn = findByText(/create your own/i);
        if (opts.length > 0 || hasCreateOwn) { chipRegistered = true; break; }
        // Check 2: the chip element itself has an aria-selected/aria-pressed/active indicator
        const freshChip = readAttributeChips().find(c => c.norm === chipNorm);
        if (freshChip) {
          const el = freshChip.el;
          const isActive = el.getAttribute('aria-selected') === 'true' ||
                           el.getAttribute('aria-pressed') === 'true' ||
                           el.getAttribute('aria-expanded') === 'true' ||
                           el.classList.contains('active') ||
                           el.classList.contains('selected');
          if (isActive) { chipRegistered = true; break; }
        }
        // Check 3: look for Remove button containing this chip's label in the right panel
        const removeInPanel = queryAllWithShadow('button[aria-label]', activeDoc || document)
          .some(el => {
            const aria = norm(el.getAttribute('aria-label') || '');
            return aria.includes('remove') && aria.includes(chipNorm);
          });
        if (removeInPanel) { chipRegistered = true; break; }
        await sleep(200);
      }
      if (!chipRegistered) {
        console.warn(`[DropFlow] Chip "${mapped.chip.text}" may not have registered — retrying click`);
        // Retry: same inner-button preference as initial click.
        const chipInnerBtnRetry = mapped.chip.el.querySelector('button.faux-link:not([aria-label])') ||
                                  mapped.chip.el.querySelector('button:not([aria-label])') ||
                                  null;
        simulateClick(chipInnerBtnRetry || asClickableTarget(mapped.chip.el));
        await sleep(400);
        builderRoot = findBuilderRoot();
      }
      selectedAxes++;

      const visibleOpts = readVisibleOptions();
      console.warn(`[DropFlow] Axis "${mapped.spec.axis.name}" chip "${mapped.chip.text}": ${visibleOpts.length} options visible [${visibleOpts.slice(0, 8).map(o => o.text).join(', ')}${visibleOpts.length > 8 ? '...' : ''}]`);

      const cleared = await clearSelectedOptionsForActiveAttribute();
      if (cleared > 0) {
        // React re-renders after deselecting options can detach builderRoot from the DOM.
        // Refresh it so subsequent queries don't search a stale/detached tree.
        builderRoot = findBuilderRoot();
        await logVariationStep('variationBuilder:clearedPresetOptions', {
          axis: mapped.spec.axis.name,
          cleared
        });
      }

      const _tAxisOptionsStart = Date.now();
      const rawVals = Array.from(new Set(mapped.spec.axis.values)).slice(0, 40);

      // --- Token-based cross-contamination filter ---
      // AliExpress data often has polluted axes (size values in Color axis,
      // color values in Size axis). Use token sets to keep only values that
      // belong to the current axis type.
      const sizeTokens = new Set([
        'xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl',
        '2xl', '3xl', '4xl', '5xl', 'xsmall', 'small', 'medium',
        'large', 'xlarge', 'xxlarge', 'xxxlarge'
      ]);
      const colorTokens = new Set([
        'red', 'black', 'blue', 'green', 'yellow', 'white', 'brown',
        'grey', 'gray', 'pink', 'purple', 'orange', 'gold', 'silver',
        'beige', 'clear', 'multicoloured', 'multicolored', 'coffee',
        'khaki', 'navy', 'wine', 'cream', 'ivory', 'tan', 'maroon',
        'teal', 'coral', 'magenta', 'cyan', 'olive', 'burgundy',
        'lavender', 'turquoise', 'charcoal', 'aqua', 'rose', 'camel'
      ]);
      const isCurrentAxisSize = /size/i.test(mapped.spec.axis.name) || /size/i.test(mapped.chip.text);
      const isCurrentAxisColor = /colou?r/i.test(mapped.spec.axis.name) || /colou?r/i.test(mapped.chip.text);

      const uniqueVals = rawVals.filter(v => {
        const n = norm(v);
        if (!n) return false;
        // Skip garbage: concatenated size codes (e.g., "XSSMLXL"), "Size: ..." prefix
        if (/^size\s*:/i.test(v.trim())) return false;
        if (v.length >= 6 && /^[xsmlXSML0-9]+$/i.test(v.trim()) && !sizeTokens.has(n)) return false;
        // Skip size tokens in non-size axes (e.g., "XS" in Color axis)
        if (!isCurrentAxisSize && sizeTokens.has(n)) return false;
        // Skip color tokens in non-color axes (e.g., "Red" in Size axis)
        if (!isCurrentAxisColor && colorTokens.has(n)) return false;
        return true;
      });

      console.warn(`[DropFlow] Axis "${mapped.spec.axis.name}" values: raw=${rawVals.length}, filtered=${uniqueVals.length} [${uniqueVals.slice(0, 10).join(', ')}${uniqueVals.length > 10 ? '...' : ''}]`);
      let axisHits = 0;
      for (const v of uniqueVals) {
        const _tOpt = Date.now();
        const ok = await ensureOptionSelected(mapped.spec.axis.name, v);
        const _tOptElapsed = Date.now() - _tOpt;
        if (_tOptElapsed > 800) console.warn(`[DropFlow] ⏱ Slow option "${v}" on axis "${mapped.spec.axis.name}": ${_tOptElapsed}ms`);
        if (ok) {
          axisHits++;
          selectedValues++;
        }
      }

      const _tAxisOptionsDone = Date.now();
      console.warn(`[DropFlow] ⏱ Builder axis "${mapped.spec.axis.name}" options: ${uniqueVals.length} values in ${_tAxisOptionsDone - _tAxisOptionsStart}ms (${axisHits} selected, ~${uniqueVals.length > 0 ? Math.round((_tAxisOptionsDone - _tAxisOptionsStart) / uniqueVals.length) : 0}ms/value)`);
      console.warn(`[DropFlow] Builder axis "${mapped.spec.axis.name}" → chip "${mapped.chip.text}": ${axisHits}/${uniqueVals.length} options selected`);
      await logVariationStep('variationBuilder:axisFilled', {
        axis: mapped.spec.axis.name,
        attrLabel: mapped.chip.text,
        valueCount: uniqueVals.length,
        selectedCount: axisHits
      });
    }

    const requiredAxes = Math.min(2, desiredAxes.length);
    const builderSuccess = selectedAxes >= requiredAxes && selectedValues > 0;
    if (!builderSuccess) {
      await logVariationStep('variationBuilder:insufficientSelections', {
        selectedAxes,
        selectedValues,
        requiredAxes
      });
      console.warn('[DropFlow] Variation builder selections incomplete');
      return false;
    }

    const continueBtn = findButtonByText(builderRoot || document, /^\s*(continue|update\s+variations?)\s*$/i) || findByText(/\b(continue|update\s+variations?)\b/i);
    if (continueBtn && !continueBtn.disabled) {
      simulateClick(continueBtn);
      await logVariationStep('variationBuilder:continueClicked', { buttonText: (continueBtn.textContent || '').trim() });
      console.warn(`[DropFlow] Variation builder clicked: "${(continueBtn.textContent || '').trim()}"`);

      // After clicking Continue/Update variations, wait for the pricing/photo page
      // to appear. Poll for up to 30s looking for "Save and close" button,
      // pricing table inputs, or the builder closing entirely.
      const findSaveAndClose = (ctx) => {
        const btns = queryAllWithShadow('button, [role="button"]', ctx || activeDoc);
        return btns.find(b => isElementVisible(b) && /save\s+and\s+close/i.test((b.textContent || '').trim()));
      };
      const findPricingTable = (ctx) => {
        const root = ctx || activeDoc;
        // Look for price/quantity input fields that indicate the combinations table
        const priceInputs = queryAllWithShadow('input[type="text"], input[type="number"], input:not([type])', root)
          .filter(el => {
            const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const name = (el.getAttribute('name') || '').toLowerCase();
            return /price|quantity|qty/i.test(`${placeholder} ${ariaLabel} ${name}`);
          });
        if (priceInputs.length > 0) return true;
        // Also detect lazy-rendered tables: look for table rows with variation text
        // next to the Save and close button (combinations table without active inputs)
        const tables = queryAllWithShadow('table', root).filter(isElementVisible);
        for (const t of tables) {
          const trs = t.querySelectorAll('tbody tr, tr');
          if (trs.length >= 3) {
            const headerText = (t.querySelector('thead, tr:first-child')?.textContent || '').toLowerCase();
            if (/price|quantity|qty|sku|variation/i.test(headerText)) return true;
          }
        }
        return false;
      };

      let saveCloseBtn = null;
      let pricingReady = false;
      const _tContinueWaitStart = Date.now();
      for (let pollI = 0; pollI < 120; pollI++) { // 30s max (250ms * 120)
        await sleep(250);
        saveCloseBtn = findSaveAndClose(activeDoc) || findSaveAndClose(document);
        if (saveCloseBtn) {
          console.warn(`[DropFlow] Save and close button found after ${pollI * 250}ms`);
          break;
        }
        pricingReady = findPricingTable(activeDoc) || findPricingTable(document);
        if (pricingReady) {
          console.warn(`[DropFlow] Pricing table detected after ${pollI * 250}ms`);
          // Give it a moment to fully render
          await sleep(1000);
          saveCloseBtn = findSaveAndClose(activeDoc) || findSaveAndClose(document);
          break;
        }
        // Check if builder closed entirely (returned to parent)
        const ctx = detectVariationBuilderContext();
        if (!ctx.isBuilder) {
          console.warn(`[DropFlow] Builder closed after Continue click (${pollI * 250}ms)`);
          await releaseCrossContextLock();
          try { await chrome.storage.local.set({ dropflow_builder_complete: { ts: Date.now(), draftId: window.location.href } }); } catch (_) {}
          return true;
        }
      }
      
      if (saveCloseBtn) {
        console.warn(`[DropFlow] ⏱ Builder photo/pricing page detected after ${Date.now() - _tContinueWaitStart}ms (Save and close found)`);
        await logVariationStep('variationBuilder:pricingPageDetected', { waitMs: Date.now() - _tContinueWaitStart });
        
        // Clear UPC fields by selecting "Does not apply" from dropdown
        try {
          const upcInputs = queryAllWithShadow('input[cn="upc"], input[cn="UPC"]', activeDoc);
          for (const upcInput of upcInputs) {
            // Click the dropdown arrow next to UPC field
            const dropdownLink = upcInput.parentElement?.querySelector('a.pull-down, a[role="button"]');
            if (dropdownLink) {
              simulateClick(dropdownLink);
              await sleep(300);
              // Find and click "Does not apply" option
              const menu = upcInput.closest('span')?.querySelector('ul[role="menu"]');
              if (menu) {
                const dnaOption = Array.from(menu.querySelectorAll('a[role="menuitem"]'))
                  .find(a => /does not apply/i.test(a.textContent));
                if (dnaOption) {
                  simulateClick(dnaOption);
                  await sleep(200);
                }
              }
            } else {
              // Fallback: directly set value to "Does not apply"
              const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (nativeSetter) nativeSetter.call(upcInput, 'Does not apply');
              else upcInput.value = 'Does not apply';
              upcInput.dispatchEvent(new Event('input', { bubbles: true }));
              upcInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          if (upcInputs.length > 0) {
            console.log(`[DropFlow] Set ${upcInputs.length} UPC fields to "Does not apply"`);
          }
        } catch (e) {
          console.warn('[DropFlow] UPC clearing error:', e.message);
        }

        // Try to fill per-SKU pricing here if we have variation data
        if (productData?.variations?.skus?.length > 0) {
          try {
            await fillBuilderPricingTable(activeDoc, productData);
          } catch (e) {
            console.error('[DropFlow] Builder pricing fill error:', e.message, e.stack);
          }
        }

        // Upload default photos via the builder's picupload iframe
        // For MSKU listings, photos are uploaded through the variation builder, not the main form.
        if (productData.images && productData.images.length > 0) {
          try {
            await uploadPhotosViaMskuBuilder(productData);
          } catch (e) {
            console.warn('[DropFlow] Builder photo upload error:', e.message);
          }
        }
        
        // Click "Save and close" to return to the main form
        simulateClick(saveCloseBtn);
        __dropflowVariationSaveCloseTs = Date.now();
        await logVariationStep('variationBuilder:saveAndCloseClicked', {});
        console.warn('[DropFlow] Clicked Save and close');
        
        // Wait for navigation back to main form
        for (let i = 0; i < 40; i++) {
          await sleep(500);
          const ctx = detectVariationBuilderContext();
          if (!ctx.isBuilder) break;
          // Also check if the iframe was removed
          if (!document.contains(activeDoc.documentElement || activeDoc.body)) break;
        }
      } else {
        console.warn('[DropFlow] No Save and close found after Continue; builder may have already closed');
      }
      
      // Signal completion and release lock before returning
      await releaseCrossContextLock();
      try { await chrome.storage.local.set({ dropflow_builder_complete: { ts: Date.now(), draftId: window.location.href } }); } catch (_) {}
      return true;
    }

    await logVariationStep('variationBuilder:noContinue', { selectedAxes, selectedValues });
    console.warn('[DropFlow] Variation builder could not find an enabled Continue button');
    return false;

    } finally { // <<< guarantee lock release on ALL exit paths
      await releaseCrossContextLock();
      // BUG FIX: Clear the in-frame duplicate-guard lock so that subsequent
      // retry attempts from checkPendingData (or watchForPageTransitions) are
      // NOT blocked by the 30-second TTL after a failed run.  The lock should
      // only be held *during* an active run, not after it exits.
      const current = flowLockHost[flowLockKey];
      if (current && current.startedAt === flowStartedAt) {
        delete flowLockHost[flowLockKey];
      }
    }
  }

  /**
   * Fill pricing/quantity in the builder's photo/pricing page.
   * The builder shows a table with all variations (Delete button per row).
   * We look for "Enter price" and "Enter quantity" bulk action buttons,
   * or fill individual rows.
   */
  async function fillBuilderPricingTable(builderDoc, productData) {
    const doc = builderDoc || document;
    const variations = productData?.variations;
    if (!variations?.skus?.length) return;

    await logVariationStep('variationBuilder:fillPricing:start', { skuCount: variations.skus.length });

    // In-stock only. If no stock signals at all, treat all as in stock.
    const hasAnyStock = variations.skus.some(s => Number(s?.stock || 0) > 0);
    const inStockSkus = hasAnyStock
      ? variations.skus.filter(s => Number(s?.stock || 0) > 0)
      : variations.skus.map(s => ({ ...s, stock: 1 }));

    // Build per-variant lookup from specifics -> ebayPrice.
    const norm = (s) => String(s || '').trim().toLowerCase();
    const skuEntries = inStockSkus.map(sku => ({
      values: Object.values(sku.specifics || {}).map(norm).filter(Boolean),
      price: Number(computeVariantEbayPrice(sku, productData) || 0),
      qty: 1
    })).filter(e => e.values.length > 0 && e.price > 0);

    const allBtns = queryAllWithShadow('button, [role="button"]', doc);

    // Robust bulk-action filler: eBay frequently uses unlabeled inline editors/popovers.
    async function useBulkAction(btnRegex, value, kind) {
      const btn = allBtns.find(b => isElementVisible(b) && btnRegex.test((b.textContent || '').trim()));
      if (!btn) return false;
      simulateClick(btn);
      await sleep(900);

      const popup = queryAllWithShadow('[role="dialog"], [class*="popover" i], [class*="menu" i], [class*="flyout" i]', doc)
        .filter(isElementVisible)
        .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0] || doc;

      const inputs = queryAllWithShadow('input, [contenteditable="true"]', popup)
        .filter(el => isElementVisible(el) && (el.offsetWidth > 24 || el.getBoundingClientRect().width > 24));

      let target = inputs.find(i => {
        const h = `${i.placeholder || ''} ${i.getAttribute?.('aria-label') || ''} ${i.name || ''} ${i.id || ''}`.toLowerCase();
        // Exclude UPC/EAN/ISBN/MPN fields
        if (/upc|ean|isbn|mpn|gtin|barcode|identifier/.test(h)) return false;
        return kind === 'price' ? /price|amount|\$|aud/.test(h) : /qty|quantit|stock|available/.test(h);
      });
      // Fallback for qty: find an unlabeled input, but NEVER UPC/identifier fields.
      if (!target && kind !== 'price') {
        target = inputs.find(i => {
          const h = `${i.placeholder || ''} ${i.getAttribute?.('aria-label') || ''} ${i.name || ''} ${i.id || ''}`.toLowerCase();
          if (/upc|ean|isbn|mpn|gtin|barcode|identifier|price|amount|\$/.test(h)) return false;
          return !i.value || String(i.value).trim() === '' || String(i.value).trim() === '0';
        });
      }
      if (!target) return false;

      if (target.isContentEditable) {
        target.textContent = String(value);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        await commitInputValue(target, String(value));
      }

      const applyBtn = queryAllWithShadow('button, [role="button"]', popup)
        .find(b => isElementVisible(b) && /^(apply|ok|set|confirm|save|done)$/i.test((b.textContent || '').trim()));
      if (applyBtn) {
        simulateClick(applyBtn);
      } else {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      }
      await sleep(700);
      return true;
    }

    // PER-VARIANT PRICING: use each variant's own ebayPrice.
    // Only use bulk action if all variants have the same price.
    const uniquePrices = [...new Set(skuEntries.map(e => e.price))];
    const bulkPriceAllowed = uniquePrices.length === 1; // Only bulk if all prices identical
    const defaultPrice = Math.max(...uniquePrices, Number(productData.ebayPrice || 0), 0) || 9.99;
    console.warn(`[DropFlow] PER-VARIANT PRICING: ${uniquePrices.length} unique prices (${uniquePrices.join(', ')}), bulk=${bulkPriceAllowed}`);

    let priceDone = false;
    if (bulkPriceAllowed) {
      priceDone = await useBulkAction(/enter\s+price|set\s+price|price\s+for\s+all/i, defaultPrice, 'price');
    }
    const qtyDone = await useBulkAction(/enter\s+quantity|set\s+quantity|quantity\s+for\s+all/i, 1, 'qty');

    // Per-row fill for price/qty (works whether bulk action exists or not).
    let rows = queryAllWithShadow('tr, [role="row"], [class*="variation" i][class*="row" i]', doc)
      .filter(r => isElementVisible(r) && queryAllWithShadow('input, [contenteditable="true"]', r).length > 0);

    // LAZY-RENDER FIX: If few/no rows have inputs, the builder likely lazy-renders
    // inputs only for the active row. Find ALL data rows and click each one to activate.
    const allDataRows = queryAllWithShadow('tr, [role="row"], [class*="variation" i][class*="row" i]', doc)
      .filter(r => {
        if (!isElementVisible(r)) return false;
        // Skip header rows
        if (r.closest('thead')) return false;
        const tag = r.querySelector('th');
        if (tag && !r.querySelector('td')) return false;
        // Must have text content (variation names)
        const text = (r.textContent || '').trim();
        return text.length > 2 && text.length < 500;
      });

    if (rows.length < allDataRows.length * 0.5 && allDataRows.length >= 2) {
      console.warn(`[DropFlow] LAZY-RENDER detected: ${rows.length} rows with inputs vs ${allDataRows.length} total data rows. Activating rows by clicking...`);
      await logVariationStep('variationBuilder:fillPricing:lazyRenderDetected', {
        rowsWithInputs: rows.length,
        totalDataRows: allDataRows.length
      });

      // Click each row to activate it, fill its inputs, then move on
      let lazyPricesFilled = 0;
      let lazyQtiesFilled = 0;
      for (let ri = 0; ri < allDataRows.length; ri++) {
        const row = allDataRows[ri];

        // Read row text BEFORE clicking (cell text may change when inputs appear)
        let cells = Array.from(row.querySelectorAll('td, th'));
        if (cells.length === 0) cells = Array.from(row.children);
        const cellTexts = cells.map(c => {
          const clone = c.cloneNode(true);
          (clone.querySelectorAll ? clone.querySelectorAll('input, select, button') : []).forEach(el => el.remove());
          return norm(clone.textContent);
        }).filter(t => t && t.length > 0 && t.length < 30);
        const rowText = norm(row.textContent);

        // Match variant price
        let matchedPrice = 0;
        for (const se of skuEntries) {
          if (se.values.every(v => cellTexts.some(ct => ct === v || ct === v.replace(/\s+/g, '')))) {
            matchedPrice = se.price; break;
          }
          if (se.values.every(v => cellTexts.some(ct => ct.includes(v) || v.includes(ct)))) {
            matchedPrice = se.price; break;
          }
          if (se.values.every(v => {
            const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(rowText);
          })) {
            matchedPrice = se.price; break;
          }
        }
        if (matchedPrice <= 0 && ri < skuEntries.length) matchedPrice = skuEntries[ri].price;
        if (matchedPrice <= 0) matchedPrice = defaultPrice;

        // Click the row to activate lazy-rendered inputs
        simulateClick(row);
        // Also try clicking specific cells (some tables need cell-level click)
        if (cells.length > 0) {
          const priceColIdx = cells.findIndex(c => {
            const t = norm(c.textContent);
            return /^\$?\d+\.?\d*$/.test(t.replace(/\s/g, '')) || /price/i.test(c.className || '');
          });
          if (priceColIdx >= 0) simulateClick(cells[priceColIdx]);
        }

        // Wait for inputs to appear (up to 2s)
        let rowInputs = [];
        for (let wi = 0; wi < 20; wi++) {
          await sleep(100);
          rowInputs = queryAllWithShadow('input, [contenteditable="true"]', row).filter(isElementVisible);
          if (rowInputs.length > 0) break;
        }

        if (rowInputs.length === 0) {
          if (ri < 3) console.warn(`[DropFlow] Lazy row[${ri}]: no inputs appeared after click. cellTexts=[${cellTexts.join(',')}]`);
          continue;
        }

        // Fill price input
        for (const input of rowInputs) {
          const h = `${input.placeholder || ''} ${input.getAttribute?.('aria-label') || ''} ${input.name || ''} ${input.id || ''} ${input.className || ''} ${input.getAttribute?.('cn') || ''}`.toLowerCase();
          if (/upc|ean|isbn|mpn|gtin|barcode|identifier/.test(h)) continue;
          if (/price|amount|\$|aud/.test(h)) {
            const existing = Number(String(input.value || input.textContent || '').replace(/[^0-9.]/g, ''));
            if (!existing || Math.abs(existing - matchedPrice) > 0.01) {
              if (input.isContentEditable) {
                input.textContent = String(matchedPrice);
                input.dispatchEvent(new Event('input', { bubbles: true }));
              } else {
                await commitInputValue(input, String(matchedPrice));
              }
              lazyPricesFilled++;
            } else {
              lazyPricesFilled++;
            }
          } else if (/qty|quantit|stock|available/.test(h)) {
            const existingQ = Number(String(input.value || input.textContent || '').replace(/[^0-9]/g, ''));
            if (existingQ !== 1) {
              if (input.isContentEditable) {
                input.textContent = '1';
                input.dispatchEvent(new Event('input', { bubbles: true }));
              } else {
                await commitInputValue(input, '1');
              }
              lazyQtiesFilled++;
            }
          }
        }

        if (ri < 5) console.warn(`[DropFlow] Lazy row[${ri}]: price=$${matchedPrice}, inputs=${rowInputs.length}, cellTexts=[${cellTexts.join(',')}]`);
      }

      console.warn(`[DropFlow] Lazy-render fill complete: ${lazyPricesFilled} prices, ${lazyQtiesFilled} quantities out of ${allDataRows.length} rows`);
      await logVariationStep('variationBuilder:fillPricing:lazyRenderDone', {
        pricesFilled: lazyPricesFilled,
        qtiesFilled: lazyQtiesFilled,
        totalRows: allDataRows.length
      });

      // If we filled prices via lazy-render, skip the normal per-row fill
      if (lazyPricesFilled > 0) {
        pricesFilled = lazyPricesFilled;
        qtiesFilled = lazyQtiesFilled;
        // Jump to the end
        await logVariationStep('variationBuilder:fillPricing:done', {
          priceDone,
          qtyDone,
          pricesFilled,
          qtiesFilled,
          uniquePriceCount: uniquePrices.length,
          method: 'lazy-render-click'
        });
        return;
      }

      // Re-query rows with inputs (clicking may have activated some)
      rows = queryAllWithShadow('tr, [role="row"], [class*="variation" i][class*="row" i]', doc)
        .filter(r => isElementVisible(r) && queryAllWithShadow('input, [contenteditable="true"]', r).length > 0);
    }

    // Build column-index map from table header (fallback for unlabeled inputs)
    const columnMap = { price: -1, qty: -1, upc: -1, sku: -1 };
    const headerRow = (() => {
      const tables = queryAllWithShadow('table', doc).filter(isElementVisible);
      for (const t of tables) {
        const hr = t.querySelector('thead tr, tr:first-child');
        if (hr && hr.querySelectorAll('th, td').length >= 3) return hr;
      }
      return null;
    })();
    if (headerRow) {
      const headers = Array.from(headerRow.querySelectorAll('th, td'));
      headers.forEach((th, idx) => {
        const t = (th.textContent || '').trim().toLowerCase();
        if (/price|amount/.test(t) && columnMap.price < 0) columnMap.price = idx;
        else if (/qty|quantit|stock|available/.test(t) && columnMap.qty < 0) columnMap.qty = idx;
        else if (/upc|ean|isbn|gtin|barcode/.test(t) && columnMap.upc < 0) columnMap.upc = idx;
        else if (/sku|custom\s*label/.test(t) && columnMap.sku < 0) columnMap.sku = idx;
      });
      console.warn(`[DropFlow] Builder pricing column map: price=${columnMap.price}, qty=${columnMap.qty}, upc=${columnMap.upc}, sku=${columnMap.sku}`);
      await logVariationStep('variationBuilder:fillPricing:columnMap', columnMap);
    }

    let pricesFilled = 0;
    let qtiesFilled = 0;
    let rowIdx = 0;
    console.warn(`[DropFlow] PER-VARIANT PRICING: filling ${rows.length} rows`);
    for (const row of rows) {
      rowIdx++;
      // Match this row to a variant by reading its text content
      const rowText = norm(row.textContent);
      let cells = Array.from(row.querySelectorAll('td, th'));
      if (cells.length === 0) cells = Array.from(row.children);
      const cellTexts = cells.map(c => {
        const clone = c.cloneNode(true);
        (clone.querySelectorAll ? clone.querySelectorAll('input, select, button') : []).forEach(el => el.remove());
        return norm(clone.textContent);
      }).filter(t => t && t.length > 0 && t.length < 30);

      let matchedPrice = 0;
      for (const se of skuEntries) {
        // Cell-level exact match
        if (se.values.every(v => cellTexts.some(ct => ct === v || ct === v.replace(/\s+/g, '')))) {
          matchedPrice = se.price; break;
        }
        // Cell-level partial match
        if (se.values.every(v => cellTexts.some(ct => ct.includes(v) || v.includes(ct)))) {
          matchedPrice = se.price; break;
        }
        // Row text regex match
        if (se.values.every(v => {
          const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(rowText);
        })) {
          matchedPrice = se.price; break;
        }
      }
      // Index-based fallback
      if (matchedPrice <= 0 && (rowIdx - 1) < skuEntries.length) {
        matchedPrice = skuEntries[rowIdx - 1].price;
      }
      // Last resort
      if (matchedPrice <= 0) matchedPrice = defaultPrice;

      const entry = { price: matchedPrice, qty: 1 };
      if (rowIdx <= 5) console.warn(`[DropFlow] Row ${rowIdx}: matched price=$${matchedPrice}, cellTexts=[${cellTexts.join(',')}]`);

      const inputs = queryAllWithShadow('input, [contenteditable="true"]', row).filter(isElementVisible);

      // Try attribute-based classification first
      let priceFilled = false, qtyFilled = false;
      for (const input of inputs) {
        const h = `${input.placeholder || ''} ${input.getAttribute?.('aria-label') || ''} ${input.name || ''} ${input.id || ''} ${input.className || ''} ${input.getAttribute?.('cn') || ''}`.toLowerCase();
        // Always skip UPC/EAN/ISBN fields (including eBay's cn="upc" attribute)
        if (/upc|ean|isbn|mpn|gtin|barcode|identifier/.test(h)) continue;

        if (/price|amount|\$|aud/.test(h)) {
          const existing = Number(String(input.value || input.textContent || '').replace(/[^0-9.]/g, ''));
          if (!existing || Math.abs(existing - entry.price) > 0.01) {
            if (input.isContentEditable) {
              input.textContent = String(entry.price);
              input.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              await commitInputValue(input, String(entry.price));
            }
            pricesFilled++;
            priceFilled = true;
          } else {
            priceFilled = true; // already correct
          }
        } else if (/qty|quantit|stock|available/.test(h)) {
          const existingQ = Number(String(input.value || input.textContent || '').replace(/[^0-9]/g, ''));
          if (existingQ !== 1) {
            if (input.isContentEditable) {
              input.textContent = '1';
              input.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              await commitInputValue(input, '1');
            }
            qtiesFilled++;
            qtyFilled = true;
          } else {
            qtyFilled = true;
          }
        }
      }

      // Column-position fallback: if attribute matching didn't find price/qty,
      // use the column index from table headers
      if (!priceFilled && columnMap.price >= 0) {
        // Try td/th cells first, fall back to child divs or direct input index
        let cells = Array.from(row.querySelectorAll('td, th'));
        if (cells.length === 0) cells = Array.from(row.children);
        const priceCell = cells[columnMap.price];
        if (priceCell) {
          const priceInput = priceCell.querySelector('input, [contenteditable="true"]') ||
            (priceCell.tagName === 'INPUT' ? priceCell : null);
          if (priceInput && isElementVisible(priceInput)) {
            const existing = Number(String(priceInput.value || priceInput.textContent || '').replace(/[^0-9.]/g, ''));
            if (!existing || Math.abs(existing - entry.price) > 0.01) {
              if (priceInput.isContentEditable) {
                priceInput.textContent = String(entry.price);
                priceInput.dispatchEvent(new Event('input', { bubbles: true }));
              } else {
                await commitInputValue(priceInput, String(entry.price));
              }
              pricesFilled++;
            }
          }
        }
      }
      if (!qtyFilled && columnMap.qty >= 0) {
        let cells = Array.from(row.querySelectorAll('td, th'));
        if (cells.length === 0) cells = Array.from(row.children);
        const qtyCell = cells[columnMap.qty];
        if (qtyCell) {
          const qtyInput = qtyCell.querySelector('input, [contenteditable="true"]') ||
            (qtyCell.tagName === 'INPUT' ? qtyCell : null);
          if (qtyInput && isElementVisible(qtyInput)) {
            const existingQ = Number(String(qtyInput.value || qtyInput.textContent || '').replace(/[^0-9]/g, ''));
            if (existingQ !== 1) {
              if (qtyInput.isContentEditable) {
                qtyInput.textContent = '1';
                qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
              } else {
                await commitInputValue(qtyInput, '1');
              }
              qtiesFilled++;
            }
          }
        }
      }
    }

    // Fallback: if per-row matching found zero prices but we have a column map,
    // fill all rows' price cells using column position. This handles cases where
    // the builder's row text doesn't contain the SKU specifics values.
    if (pricesFilled === 0 && columnMap.price >= 0 && skuEntries.length > 0) {
      console.warn('[DropFlow] Builder pricing: no rows matched SKUs by specifics. Trying column-position fill for ALL rows...');
      // Log first few rows and SKU entries for debugging
      for (let di = 0; di < Math.min(rows.length, 3); di++) {
        const sampleRow = rows[di];
        const sampleCells = Array.from(sampleRow.querySelectorAll('td, th'));
        const sampleText = norm(sampleRow.textContent).substring(0, 120);
        const sampleCellTexts = sampleCells.map((c, i) => `[${i}]${norm(c.textContent).substring(0, 20)}`).join(' ');
        console.warn(`[DropFlow] Builder row[${di}]: text="${sampleText}" cells(${sampleCells.length}): ${sampleCellTexts}`);
      }
      console.warn(`[DropFlow] Builder SKU entries (first 3): ${JSON.stringify(skuEntries.slice(0, 3).map(e => ({ values: e.values, price: e.price })))}`);

      for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri];
        let cells = Array.from(row.querySelectorAll('td, th'));
        if (cells.length === 0) cells = Array.from(row.children);
        const priceCell = cells[columnMap.price];
        if (!priceCell) continue;
        const priceInput = priceCell.querySelector('input, [contenteditable="true"]') ||
          (priceCell.tagName === 'INPUT' ? priceCell : null);
        if (!priceInput || !isElementVisible(priceInput)) continue;
        
        // Try to match row by cell text (more precise than full row text)
        const cellTexts = cells.map(c => {
          const clone = c.cloneNode(true);
          (clone.querySelectorAll ? clone.querySelectorAll('input, select, button') : []).forEach(el => el.remove());
          return norm(clone.textContent);
        }).filter(t => t && t.length > 0 && t.length < 30);
        const rowText = norm(row.textContent);
        let price = 0;
        let matchMethod = 'none';
        for (const entry of skuEntries) {
          // Try cell-level exact matching first (more precise)
          const cellMatch = entry.values.every(v =>
            cellTexts.some(ct => ct === v || ct === v.replace(/\s+/g, ''))
          );
          if (cellMatch) { price = entry.price; matchMethod = 'cell-exact'; break; }
          // Try cell-level partial match (cell contains value)
          const cellPartial = entry.values.every(v =>
            cellTexts.some(ct => ct.includes(v) || v.includes(ct))
          );
          if (cellPartial) { price = entry.price; matchMethod = 'cell-partial'; break; }
          // Fallback: regex on full row text
          const allMatch = entry.values.every(v => {
            const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(rowText);
          });
          if (allMatch) { price = entry.price; matchMethod = 'row-regex'; break; }
        }

        // Index-based fallback: if text matching failed, use positional mapping
        // (assumes builder rows are in same order as skuEntries)
        if (price <= 0 && ri < skuEntries.length) {
          price = skuEntries[ri].price;
          matchMethod = 'index-positional';
        }
        // Last resort: use default price
        if (price <= 0) {
          price = defaultPrice;
          matchMethod = 'default-fallback';
        }
        
        if (ri < 5 || matchMethod !== 'cell-exact') {
          console.warn(`[DropFlow] Builder row[${ri}] price=$${price} via ${matchMethod}, cellTexts=[${cellTexts.join(',')}]`);
        }

        const existing = Number(String(priceInput.value || priceInput.textContent || '').replace(/[^0-9.]/g, ''));
        if (!existing || Math.abs(existing - price) > 0.01) {
          try {
            if (priceInput.isContentEditable) {
              priceInput.textContent = String(price);
              priceInput.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              await commitInputValue(priceInput, String(price));
            }
            pricesFilled++;
          } catch (e) {
            console.error(`[DropFlow] Builder row[${ri}] price fill error:`, e.message, e.stack);
          }
        } else {
          pricesFilled++; // already has correct value
        }
      }
      console.warn(`[DropFlow] Column-position price fill: ${pricesFilled}/${rows.length} rows`);
    }

    // Last-resort fallback: no column map, no attribute matches — try filling all visible
    // inputs in each row by position (skip first input if it looks like a label/checkbox)
    if (pricesFilled === 0 && rows.length > 0 && skuEntries.length > 0) {
      console.warn(`[DropFlow] Builder pricing: all strategies failed. Trying brute-force input-position fill...`);
      for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri];
        const inputs = queryAllWithShadow('input[type="text"], input[type="number"], input:not([type])', row)
          .filter(el => isElementVisible(el));
        // Find the first numeric-looking input that isn't a UPC/identifier
        for (const input of inputs) {
          const h = `${input.placeholder || ''} ${input.getAttribute?.('aria-label') || ''} ${input.name || ''} ${input.id || ''}`.toLowerCase();
          if (/upc|ean|isbn|mpn|gtin|barcode|identifier/.test(h)) continue;
          // Skip if already has a non-zero value that looks like a price
          const existing = Number(String(input.value || '').replace(/[^0-9.]/g, ''));
          if (existing > 1) continue; // already filled
          const price = ri < skuEntries.length ? skuEntries[ri].price : defaultPrice;
          if (price > 0) {
            try {
              await commitInputValue(input, String(price));
              pricesFilled++;
              if (ri < 3) console.warn(`[DropFlow] Brute-force row[${ri}] filled price=$${price}`);
            } catch (e) {
              console.error(`[DropFlow] Brute-force row[${ri}] error:`, e.message);
            }
            break; // only fill one input per row
          }
        }
      }
      console.warn(`[DropFlow] Brute-force price fill: ${pricesFilled}/${rows.length} rows`);
    }

    await logVariationStep('variationBuilder:fillPricing:done', {
      priceDone,
      qtyDone,
      pricesFilled,
      qtiesFilled,
      uniquePriceCount: uniquePrices.length
    });
  }


  // ============================
  // Variation DOM Automation Helpers
  // ============================

  /**
   * Check if an element is visible on the page.
   * Handles the offsetParent === null gotcha for elements inside fixed/sticky containers.
   * Per MDN spec, offsetParent returns null for position:fixed ancestors.
   */
  function isElementVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    if (el.offsetHeight > 0 || el.offsetWidth > 0) return true;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Show a small diagnostic overlay on the eBay page for variation debugging.
   * Auto-dismisses after 10 seconds.
   */
  function showVariationDiagnostic(info) {
    try {
      const existing = document.getElementById('dropflow-variation-diag');
      if (existing) existing.remove();
      const div = document.createElement('div');
      div.id = 'dropflow-variation-diag';
      div.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:999999;' +
        'background:#1a1a2e;color:#e0e0e0;padding:10px 14px;border-radius:8px;' +
        'font:12px/1.4 monospace;max-width:350px;box-shadow:0 2px 12px rgba(0,0,0,0.3);' +
        'pointer-events:none;opacity:0.92;';
      const statusColor = info.status === 'skipped' ? '#ff6b6b' :
                           info.status === 'starting' ? '#4ecdc4' :
                           info.status === 'found' ? '#95e89d' : '#ffd93d';
      div.innerHTML = `<div style="color:${statusColor};font-weight:bold;margin-bottom:4px;">` +
        `DropFlow Variations: ${info.status}</div>` +
        `<div>${JSON.stringify(info, null, 0).substring(0, 200)}</div>`;
      document.body.appendChild(div);
      setTimeout(() => div.remove(), 10000);
    } catch (_) {}
  }

  /**
   * Find a visible, enabled button whose text matches a regex pattern.
   * @param {Element|Document} context - Container to search in
   * @param {RegExp} pattern - Regex to match against button text
   * @returns {Element|null}
   */
  function findButtonByText(context, pattern) {
    const btns = queryAllWithShadow('button, [role="button"], a[role="button"], [role="menuitem"]', context || document);
    for (const b of btns) {
      if (!isElementVisible(b) || b.disabled) continue;
      if (pattern.test((b.textContent || '').trim())) return b;
    }
    return null;
  }

  /**
   * Find the 3-dot (kebab/ellipsis) settings menu button on the eBay /lstng form.
   * The button is the â‹® icon in the top-right header area, next to the ? help icon.
   * Uses multiple strategies to find it across different eBay page versions.
   */
  function findThreeDotButton() {
    console.log('[DropFlow] Searching for 3-dot settings button...');
    const allButtons = queryAllWithShadow('button, [role="button"], a, [role="menuitem"]');
    const vpWidth = window.innerWidth;

    const firstVisible = (sel) => {
      const cands = queryAllWithShadow(sel);
      return cands.find(el => isElementVisible(el)) || cands[0] || null;
    };

    // Helper to persist which strategy succeeded
    function foundVia(strategy, el) {
      console.log(`[DropFlow] 3-dot found via ${strategy}: tag=${el.tagName} aria="${el.getAttribute('aria-label') || '-'}" class="${(el.className || '').substring(0, 50)}"`);
      chrome.storage.local.set({
        dropflow_3dot_strategy: {
          timestamp: new Date().toISOString(), strategy,
          element: { tag: el.tagName, aria: el.getAttribute('aria-label'), class: (el.className || '').substring(0, 60) }
        }
      }).catch(() => {});
      showVariationDiagnostic({ status: 'found', step: '3-dot button', strategy });
      return el;
    }

    // Strategy -1: explicitly target the button next to the help (?) icon in header.
    const headerButtons = Array.from(allButtons).filter(el => {
      if (!isElementVisible(el) || el.disabled) return false;
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.top < 140 && rect.left > vpWidth * 0.55 && rect.width <= 80 && rect.height <= 80;
    });

    const helpBtn = headerButtons.find(el => {
      const txt = (el.textContent || '').trim();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const cls = String(el.className || '').toLowerCase();
      const testid = (el.getAttribute('data-testid') || '').toLowerCase();
      return aria.includes('help') || txt === '?' || cls.includes('help') || testid.includes('help');
    });
    if (helpBtn) {
      const hRect = helpBtn.getBoundingClientRect();
      let best = null;
      let bestScore = -1;
      for (const el of headerButtons) {
        if (el === helpBtn) continue;
        const r = el.getBoundingClientRect();
        if (r.left < hRect.right - 8) continue;
        if (Math.abs(r.top - hRect.top) > 30) continue;
        const txt = (el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const cls = String(el.className || '').toLowerCase();
        const hasPopup = (el.getAttribute('aria-haspopup') || '').toLowerCase();
        let score = 0;
        if (/^[\u22EE\u22EF\u2026\u22F1⋮⋯…⁝︙]$/.test(txt) || /^\.{3}$/.test(txt)) score += 6;
        if (hasPopup === 'true' || hasPopup === 'menu') score += 4;
        if (/overflow|kebab|menu|ellipsis|more/.test(`${aria} ${cls}`)) score += 3;
        score += r.left / 1000; // prefer right-most
        if (score > bestScore) {
          best = el;
          bestScore = score;
        }
      }
      if (best) return foundVia('help-adjacent', best);
    }

    // Strategy 0: eBay web component selectors (highest confidence)
    // eBay uses <ebay-menu-button variant="overflow"> which renders a <button> with
    // aria-haspopup="true", class="icon-btn icon-btn--transparent menu-button__button"
    const ebaySelectors = [
      'ebay-menu-button[variant="overflow"] button',
      'ebay-menu-button button[aria-haspopup="true"]',
      'button.menu-button__button[aria-haspopup="true"]',
      'button.icon-btn--transparent[aria-haspopup="true"]',
      'button[aria-haspopup="true"][aria-label*="settings" i]',
      'button[aria-haspopup="true"][aria-label*="Setting"]',
    ];
    for (const sel of ebaySelectors) {
      const el = firstVisible(sel);
      if (el && isElementVisible(el)) {
        return foundVia(`ebay-component(${sel})`, el);
      }
    }

    // Strategy 1: aria-label matching
    const ariaSelectors = [
      'button[aria-label*="settings" i]',
      'button[aria-label*="more option" i]',
      'button[aria-label*="more action" i]',
      '[role="button"][aria-label*="settings" i]',
      '[role="button"][aria-label*="more" i]',
      'button[aria-label*="menu" i]',
      'button[aria-label*="listing option" i]',
      'button[aria-label*="preferences" i]'
    ];
    for (const sel of ariaSelectors) {
      const el = firstVisible(sel);
      if (el && isElementVisible(el)) {
        const rect = el.getBoundingClientRect();
        if (rect.top < 400) {
          return foundVia(`aria-label(${el.getAttribute('aria-label')})`, el);
        }
      }
    }

    // Strategy 2: data-testid
    const testIdSelectors = [
      '[data-testid*="settings" i]',
      '[data-testid*="overflow" i]',
      '[data-testid*="kebab" i]',
      '[data-testid*="more-options" i]',
      '[data-testid*="listing-menu" i]',
      '[data-testid*="three-dot" i]',
      '[data-testid*="ellipsis" i]'
    ];
    for (const sel of testIdSelectors) {
      const el = firstVisible(sel);
      if (el && isElementVisible(el)) {
        return foundVia(`data-testid(${el.getAttribute('data-testid')})`, el);
      }
    }

    // Strategy 3: class name
    const classSelectors = [
      'button[class*="overflow" i]',
      'button[class*="kebab" i]',
      'button[class*="more-actions" i]',
      'button[class*="settings-btn" i]',
      'button[class*="listing-menu" i]',
      'button[class*="three-dot" i]',
      'button[class*="ellipsis" i]',
      '[class*="overflow" i] button',
      '[class*="kebab" i] button'
    ];
    for (const sel of classSelectors) {
      const el = firstVisible(sel);
      if (el && isElementVisible(el)) {
        const rect = el.getBoundingClientRect();
        if (rect.top < 400) {
          return foundVia(`class(${(el.className || '').substring(0, 40)})`, el);
        }
      }
    }

    // Strategy 4: SVG icon scan â€" 3 circles/ellipses = kebab menu icon
    for (const btn of allButtons) {
      if (!isElementVisible(btn)) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.top > 300 || rect.width > 80 || rect.height > 80) continue;

      const svg = btn.querySelector('svg');
      if (!svg) continue;

      const circles = svg.querySelectorAll('circle, ellipse');
      if (circles.length === 3) {
        return foundVia('svg-3-circles', btn);
      }
    }

    // Strategy 5: Look for buttons/elements containing â‹® (vertical ellipsis) character
    for (const btn of allButtons) {
      if (!isElementVisible(btn)) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.top > 300) continue;
      const text = (btn.textContent || '').trim();
      if (/^[\u22EE\u22EF\u2026\u22F1â‹®â‹¯â€¦âï¸™]$/.test(text) || /^\.{3}$/.test(text)) {
        return foundVia(`ellipsis-char("${text}")`, btn);
      }
    }

    // Strategy 6: Positional scan â€" rightmost small icon-only button in top-right header area
    let bestCandidate = null;
    let bestX = 0;
    for (const btn of allButtons) {
      if (!isElementVisible(btn)) continue;
      if (btn.disabled) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.top > 200 || rect.left < vpWidth * 0.5) continue;
      if (rect.width > 80 || rect.height > 80) continue;
      const text = (btn.textContent || '').trim();
      if (text.length > 5) continue;
      if (rect.left > bestX) {
        bestCandidate = btn;
        bestX = rect.left;
      }
    }
    if (bestCandidate) {
      return foundVia(`positional(x=${bestX.toFixed(0)})`, bestCandidate);
    }

    // Strategy 7: Broad SVG-in-small-button scan
    for (const btn of allButtons) {
      if (!isElementVisible(btn)) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.top > 200 || rect.left < vpWidth * 0.6) continue;
      if (rect.width > 60 || rect.height > 60) continue;
      if (btn.querySelector('svg')) {
        return foundVia('svg-in-header-btn', btn);
      }
    }

    // Strategy 8: Look in sticky/fixed header elements â€" walk up ancestor tree
    const headerElements = queryAllWithShadow('header, [class*="header" i], nav, [role="banner"]');
    for (const header of headerElements) {
      let isSticky = false;
      let ancestor = header;
      for (let depth = 0; depth < 5 && ancestor && ancestor !== document.body; depth++) {
        const style = getComputedStyle(ancestor);
        if (style.position === 'sticky' || style.position === 'fixed') {
          isSticky = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (!isSticky) continue;
      const headerClickables = queryAllWithShadow('button, a, [role="button"], span[class*="icon" i], div[class*="icon" i]', header);
      let rightmostBtn = null;
      let rightmostX = 0;
      for (const el of headerClickables) {
        if (!isElementVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width > 80 || rect.height > 80) continue;
        const text = (el.textContent || '').trim();
        if (text.length > 10) continue;
        if (rect.left > rightmostX) {
          rightmostBtn = el;
          rightmostX = rect.left;
        }
      }
      if (rightmostBtn) {
        return foundVia(`sticky-header(x=${rightmostX.toFixed(0)})`, rightmostBtn);
      }
    }

    // Strategy 9: Find by parent proximity to the ? help icon
    const helpIcons = queryAllWithShadow(
      'button[aria-label*="help" i], a[aria-label*="help" i], [class*="help" i], ' +
      'button[aria-label*="?" i], [data-testid*="help" i]'
    );
    for (const helpIcon of helpIcons) {
      if (!isElementVisible(helpIcon)) continue;
      const parent = helpIcon.parentElement;
      if (!parent) continue;
      const siblings = parent.children;
      for (let i = 0; i < siblings.length; i++) {
        if (siblings[i] === helpIcon || siblings[i].contains(helpIcon)) {
          for (let j = i + 1; j < siblings.length; j++) {
            const sib = siblings[j];
            const clickable = sib.querySelector('button, a, [role="button"]') || sib;
            if (isElementVisible(clickable)) {
              const rect = clickable.getBoundingClientRect();
              if (rect.width < 80 && rect.height < 80) {
                return foundVia('help-icon-sibling', clickable);
              }
            }
          }
        }
      }
    }

    console.warn('[DropFlow] Could not find 3-dot button with any strategy');
    showVariationDiagnostic({ status: 'error', step: '3-dot button', reason: 'not found by any strategy' });
    // Log all top-area elements for debugging and persist to storage
    const headerDebug = [];
    const allElements = queryAllWithShadow('button, a, [role="button"], span, div, i');
    for (const el of allElements) {
      if (!isElementVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top > 150) continue;
      if (rect.left < window.innerWidth * 0.4) continue;
      const text = (el.textContent || '').trim();
      if (text.length > 20) continue;
      const info = `${el.tagName}[${el.className?.substring(0, 30) || ''}] "${text}" at (${rect.left.toFixed(0)},${rect.top.toFixed(0)}) ${rect.width.toFixed(0)}x${rect.height.toFixed(0)} role=${el.getAttribute('role') || '-'} aria=${el.getAttribute('aria-label') || '-'} haspopup=${el.getAttribute('aria-haspopup') || '-'}`;
      headerDebug.push(info);
      console.log(`[DropFlow]   Header element: ${info}`);
    }
    chrome.storage.local.set({
      dropflow_3dot_debug: { timestamp: new Date().toISOString(), elements: headerDebug.slice(0, 30) }
    }).catch(() => {});
    return null;
  }

  /**
   * Query selector across light DOM + open shadow roots.
   * eBay uses many web components; controls can live inside shadow DOM.
   */
  function queryAllWithShadow(selector, root = document) {
    const out = [];
    const seen = new Set();
    const visitedContexts = new Set();

    const pushNode = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      out.push(node);
    };

    const visit = (ctx) => {
      if (!ctx || !ctx.querySelectorAll || visitedContexts.has(ctx)) return;
      visitedContexts.add(ctx);
      try {
        ctx.querySelectorAll(selector).forEach(pushNode);
      } catch (_) {}
      try {
        const all = ctx.querySelectorAll('*');
        for (const el of all) {
          if (el.shadowRoot) visit(el.shadowRoot);
          if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
            try {
              const frameDoc = el.contentDocument;
              if (frameDoc && frameDoc.documentElement) visit(frameDoc);
            } catch (_) {
              // Cross-origin iframe; ignore.
            }
          }
        }
      } catch (_) {}
    };

    visit(root);
    return out;
  }

  /**
   * Find the text input for entering variation values for a specific axis.
   * Searches by: container header matching axis label â†' aria-label â†' placeholder â†' first visible input.
   */
  function findAxisValueInput(editorContext, axisLabel) {
    const axisLower = axisLabel.toLowerCase();

    // Strategy 1: Container with axis label header, then input inside it
    const containers = queryAllWithShadow('div, section, fieldset, [class*="group" i], [class*="field" i]', editorContext);
    for (const container of containers) {
      const headers = queryAllWithShadow('h3, h4, h5, label, span, legend, strong, [class*="title" i], [class*="label" i]', container);
      for (const h of headers) {
        const hText = (h.textContent || '').trim().toLowerCase();
        if (hText.includes(axisLower) && hText.length < 60) {
          const input = queryAllWithShadow('input[type="text"], input:not([type]), [contenteditable="true"], [role="combobox"]', container)
            .find(el => isElementVisible(el));
          if (input && isElementVisible(input)) return input;
        }
      }
    }

    // Strategy 2: aria-label or placeholder matching
    const inputs = queryAllWithShadow('input[type="text"], input:not([type]), [role="combobox"], [contenteditable="true"]', editorContext);
    for (const input of inputs) {
      if (!isElementVisible(input)) continue;
      const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = (input.placeholder || '').toLowerCase();
      if (ariaLabel.includes(axisLower) || placeholder.includes(axisLower)) return input;
    }

    // Strategy 3: Inputs with generic "enter"/"add"/"type"/"create" placeholders
    for (const input of inputs) {
      if (!isElementVisible(input)) continue;
      const placeholder = (input.placeholder || '').toLowerCase();
      if (/enter|add|type|create your own|search/i.test(placeholder)) return input;
    }

    return null;
  }

  function looksLikeVariationSection(section) {
    if (!section) return false;
    const text = (section.textContent || '').toLowerCase().replace(/\s+/g, ' ');
    if (!/\bvariation(s)?\b/.test(text)) return false;
    if (/title options|see title options/.test(text)) return false;
    if (/save time and money by listing multiple variations/.test(text)) return true;
    if (/list different variations of the item/.test(text)) return true;
    if (/(add|create|edit|manage)\s+variation/.test(text)) return true;
    if (queryAllWithShadow('[data-testid*="variation" i], [id*="variation" i], [class*="variation" i]', section).length > 0) {
      return true;
    }
    return false;
  }

  /**
   * Log a variation step to chrome.storage for debugging (console logs lost on navigation).
   */
  async function logVariationStep(step, data) {
    try {
      const existing = await chrome.storage.local.get('dropflow_variation_log');
      const log = existing.dropflow_variation_log || [];
      log.push({ timestamp: new Date().toISOString(), step, ...data });
      await chrome.storage.local.set({ dropflow_variation_log: log.slice(-50) });
    } catch (_) {}
  }

  /**
   * Wrapper around detectVariationBuilderContext() that logs score, signals, and URL
   * for post-mortem debugging. Persists to chrome.storage.local (capped at 30 entries).
   */
  function detectVariationBuilderContextWithLog(label) {
    const ctx = detectVariationBuilderContext();
    console.warn(`[DropFlow] Builder detection [${label}]: isBuilder=${ctx.isBuilder}, score=${ctx.score}, signals=${JSON.stringify(ctx.signals)}`);
    try {
      chrome.storage.local.get('dropflow_variation_flow_log').then(result => {
        const log = result.dropflow_variation_flow_log || [];
        log.push({
          timestamp: new Date().toISOString(),
          label,
          isBuilder: ctx.isBuilder,
          score: ctx.score,
          url: window.location.href,
          signals: ctx.signals
        });
        chrome.storage.local.set({ dropflow_variation_flow_log: log.slice(-30) });
      }).catch(() => {});
    } catch (_) {}
    return ctx;
  }

  /**
   * Ensure the VARIATIONS section is visible on the eBay listing form.
   * eBay hides the variations section by default â€" it must be enabled via:
   * 3-dot settings menu â†' Settings â†' Variations toggle â†' ON
   * Returns true if the VARIATIONS section is visible after this function runs.
   * Returns 'builder' if toggling triggered navigation to the variation builder page.
   */
  async function ensureVariationsEnabled() {
    await logVariationStep('ensureVariationsEnabled:start', {});

    // FIX: Check for MSKU fullscreen dialog first — if it's open, the three-dot
    // button and form are hidden behind it. Request iframe injection and return.
    const mskuIframe = findMskuBulkeditIframe();
    const mskuDialog = document.querySelector('.msku-dialog, [class*="msku-dialog"]');
    if (mskuIframe && mskuDialog) {
      const iframeRect = mskuIframe.getBoundingClientRect();
      if (iframeRect.width > 200 && iframeRect.height > 200) {
        console.warn('[DropFlow] MSKU variation builder dialog already open — requesting iframe injection');
        await logVariationStep('ensureVariationsEnabled:mskuDialogAlreadyOpen', {
          iframeW: Math.round(iframeRect.width),
          iframeH: Math.round(iframeRect.height),
          src: mskuIframe.src?.substring(0, 100)
        });
        // Request service worker to inject form-filler into the MSKU iframe
        try {
          await sendMessageSafe({ type: 'INJECT_FORM_FILLER_IN_FRAMES', url: window.location.href }, 5000);
        } catch (e) {
          console.warn('[DropFlow] MSKU iframe injection request failed:', e.message);
        }
        return 'builder';
      }
    }

    const builderCtx = detectVariationBuilderContextWithLog('ensureVariationsEnabled:start');
    if (builderCtx.isBuilder) {
      await logVariationStep('ensureVariationsEnabled:alreadyOnBuilder', { url: window.location.href });
      console.log('[DropFlow] Variation builder already open; skipping settings toggle');
      // FIX: If this is an MSKU dialog detection, ensure iframe is injected
      if (builderCtx.isMskuDialog) {
        try {
          await sendMessageSafe({ type: 'INJECT_FORM_FILLER_IN_FRAMES', url: window.location.href }, 5000);
        } catch (_) {}
      }
      // Important: return the builder sentinel so callers route into builder flow
      // instead of re-entering parent-form variation enable logic.
      return 'builder';
    }

    // 1. Check if already visible
    const existingSection = findVariationsSection();
    if (existingSection && looksLikeVariationSection(existingSection)) {
      console.log('[DropFlow] VARIATIONS section already visible');
      await logVariationStep('ensureVariationsEnabled:alreadyVisible', {});
      return true;
    }

    console.log('[DropFlow] VARIATIONS section not found â€" enabling via Settings toggle');

    // 2. Find the 3-dot settings menu button
    // First scroll to top so the header area is visible
    // NOTE: eBay header is sticky so the â‹® is always visible, but scrolling ensures
    // other elements don't overlap it
    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(800);

    const threeDotBtn = findThreeDotButton();
    if (!threeDotBtn) {
      console.warn('[DropFlow] Could not find 3-dot settings button');
      await logVariationStep('ensureVariationsEnabled:noThreeDotButton', {});
      // Store debug data that persists across page navigation
      chrome.storage.local.set({
        dropflow_variation_status: { step: 'noThreeDotButton', timestamp: new Date().toISOString() }
      }).catch(() => {});
      return false;
    }

    const clickOnce = (el) => {
      if (!el) return false;
      try { el.click(); return true; } catch (_) {}
      try {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
        return true;
      } catch (_) {}
      return false;
    };

    // 3. Click the 3-dot button to open dropdown
    const btnRect = threeDotBtn.getBoundingClientRect();
    console.log(`[DropFlow] Clicking 3-dot settings button: tag=${threeDotBtn.tagName} at (${btnRect.left.toFixed(0)},${btnRect.top.toFixed(0)}) text="${(threeDotBtn.textContent || '').trim().substring(0, 20)}"`);
    await scrollToAndWait(threeDotBtn, 150);
    clickOnce(threeDotBtn);
    await sleep(500); // Give dropdown time to appear
    await logVariationStep('ensureVariationsEnabled:clickedThreeDot', { x: Math.round(btnRect.left), y: Math.round(btnRect.top) });

    // 4. Find "Settings" in the dropdown menu
    // eBay dropdown items may have icon prefixes like "âš™ Settings"
    const settingsPatterns = /settings|preferences|listing preferences|einstellungen|paramÃ¨tres|configuraciÃ³n|impostazioni|instellingen/i;
    let settingsItem = null;

    // Log what's visible for debugging
    console.log('[DropFlow] Searching for Settings in dropdown...');

    const findSettingsItemNearMenu = () => {
      const anchor = threeDotBtn.getBoundingClientRect();
      const items = queryAllWithShadow(
        '[role="menuitem"], [role="option"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="listitem"], ' +
        '[class*="dropdown" i] button, [class*="dropdown" i] a, [class*="dropdown" i] li, [class*="dropdown" i] div[role], ' +
        '[class*="popover" i] button, [class*="popover" i] a, [class*="popover" i] li, ' +
        '[class*="flyout" i] button, [class*="flyout" i] a, [class*="flyout" i] li, ' +
        '[class*="menu" i] button, [class*="menu" i] a, [class*="menu" i] li, ' +
        'button, a, [role="button"], li, span, div'
      );

      let best = null;
      let bestScore = -Infinity;
      for (const item of items) {
        if (!isElementVisible(item)) continue;
        const text = (item.textContent || '').trim();
        if (!settingsPatterns.test(text) || text.length > 100) continue;

        const rect = item.getBoundingClientRect();
        const dy = rect.top - anchor.bottom;
        if (dy < -24 || dy > 420) continue;
        if (rect.top > 520) continue;
        if (rect.left < window.innerWidth * 0.45) continue;
        if (Math.abs(rect.left - anchor.left) > 520 && Math.abs(rect.right - anchor.right) > 520) continue;

        let score = 0;
        score -= Math.abs(dy) * 2;
        score -= Math.abs(rect.left - anchor.left) * 0.6;
        if ((item.getAttribute('role') || '').toLowerCase().includes('menuitem')) score += 120;
        if (/[⚙]/.test(text)) score += 30;
        if (/^.{0,3}settings$/i.test(text)) score += 60;

        if (score > bestScore) {
          best = item;
          bestScore = score;
        }
      }
      return best;
    };

    // Try several passes because dropdown can animate in or close unexpectedly.
    for (let pass = 0; pass < 5 && !settingsItem; pass++) {
      if (pass > 0) {
        clickOnce(threeDotBtn);
      }
      for (let poll = 0; poll < 8 && !settingsItem; poll++) {
        settingsItem = findSettingsItemNearMenu();
        if (settingsItem) break;
        await sleep(120);
      }
      if (!settingsItem) await sleep(280);
    }

    if (!settingsItem) {
      console.warn('[DropFlow] Could not find Settings option in dropdown');
      // Log all visible menu-like elements for debugging
      const allVisible = queryAllWithShadow('button, a, li, [role="menuitem"], [role="option"]');
      const anchor = threeDotBtn.getBoundingClientRect();
      const nearby = [];
      for (const el of allVisible) {
        if (!isElementVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top > 520) continue;
        const text = (el.textContent || '').trim();
        if (text.length > 0 && text.length < 70) {
          console.log(`[DropFlow]   Visible element: "${text}" tag=${el.tagName} role=${el.getAttribute('role') || '-'} at (${rect.left.toFixed(0)},${rect.top.toFixed(0)})`);
          if (
            rect.left > window.innerWidth * 0.45 &&
            Math.abs(rect.left - anchor.left) < 560 &&
            Math.abs(rect.top - anchor.bottom) < 460
          ) {
            nearby.push({
              text: text.substring(0, 60),
              tag: el.tagName,
              role: el.getAttribute('role') || '',
              x: Math.round(rect.left),
              y: Math.round(rect.top)
            });
          }
        }
      }
      await logVariationStep('ensureVariationsEnabled:noSettingsOption', {
        anchor: { x: Math.round(anchor.left), y: Math.round(anchor.top) },
        nearby
      });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }

    // 5. Click Settings
    console.log(`[DropFlow] Clicking Settings: "${settingsItem.textContent?.trim()?.substring(0, 40)}"`);
    clickOnce(settingsItem);
    await sleep(2000);
    await logVariationStep('ensureVariationsEnabled:clickedSettings', {});

    // 6. Find the Variations toggle in the settings panel/modal
    let settingsContext = null;
    for (let attempt = 0; attempt < 12 && !settingsContext; attempt++) {
      const settingsContextCandidates = queryAllWithShadow(
        '[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="panel" i], [class*="drawer" i], ' +
        '[class*="settings" i], [class*="preferences" i], [class*="overlay" i]:not([style*="display: none"])'
      );
      for (const ctx of settingsContextCandidates) {
        if (!isElementVisible(ctx)) continue;
        const rect = ctx.getBoundingClientRect();
        const text = (ctx.textContent || '').toLowerCase();
        // Prefer the full settings dialog, not the tiny top-right dropdown.
        const dialogLike = rect.width > 260 && rect.height > 140;
        const textMatch = /settings|control which feature|variation/.test(text);
        if (dialogLike && textMatch) {
          settingsContext = ctx;
          break;
        }
      }
      if (!settingsContext) await sleep(250);
    }

    if (!settingsContext) {
      const fallbackCandidates = queryAllWithShadow(
        '[role="dialog"], [class*="modal" i], [class*="panel" i], [class*="drawer" i], [class*="overlay" i]'
      );
      for (const ctx of fallbackCandidates) {
        if (!isElementVisible(ctx)) continue;
        const rect = ctx.getBoundingClientRect();
        if (rect.width > 260 && rect.height > 140) {
          settingsContext = ctx;
          break;
        }
      }
    }
    if (!settingsContext) settingsContext = document.body;
    console.log(`[DropFlow] Settings context: ${settingsContext.tagName}.${(settingsContext.className || '').substring(0, 60)}`);

    // Find the Variations toggle
    let variationToggle = null;
    let variationToggleContainer = null;

    // Strategy A: Find label text matching "variation" then locate adjacent toggle
    const labels = queryAllWithShadow('label, span, div, p, h2, h3, h4, h5, dt, legend, strong, b', settingsContext);
    for (const label of labels) {
      const text = (label.textContent || '').trim();
      if (!/variation/i.test(text) || text.length > 80) continue;

      // Look for toggle elements near this label
      const container = label.closest('div, li, section, fieldset, [class*="row" i], [class*="setting" i], [class*="option" i], [class*="toggle" i]') || label.parentElement;
      if (!container) continue;

      // Check for: input[type="checkbox"], [role="switch"], toggle button, [role="checkbox"]
      const toggle = queryAllWithShadow(
        'input[type="checkbox"], [role="switch"], [role="checkbox"], ' +
        'button[class*="toggle" i], button[class*="switch" i], ' +
        '[class*="toggle" i] input, [class*="switch" i] input'
      , container).find(el => isElementVisible(el));
      if (toggle) {
        variationToggle = toggle;
        variationToggleContainer = container;
        break;
      }

      // Also check siblings
      const sibling = label.nextElementSibling || queryAllWithShadow(
        'input[type="checkbox"], [role="switch"], [role="checkbox"], button[class*="toggle" i]',
        label.parentElement || settingsContext
      ).find(el => isElementVisible(el));
      if (sibling && (sibling.type === 'checkbox' || sibling.getAttribute('role') === 'switch' || sibling.getAttribute('role') === 'checkbox')) {
        variationToggle = sibling;
        variationToggleContainer = container;
        break;
      }
    }

    // Strategy B: Scan all toggles/checkboxes and check their accessible labels
    if (!variationToggle) {
      const toggles = queryAllWithShadow(
        'input[type="checkbox"], [role="switch"], [role="checkbox"], button[class*="toggle" i]'
      , settingsContext);
      for (const t of toggles) {
        const ariaLabel = (t.getAttribute('aria-label') || '').toLowerCase();
        const ariaLabelledBy = t.getAttribute('aria-labelledby');
        let labelText = ariaLabel;
        if (ariaLabelledBy) {
          const labelEl = document.getElementById(ariaLabelledBy);
          if (labelEl) labelText = (labelEl.textContent || '').toLowerCase();
        }
        // Also check the for= label
        if (t.id) {
          const forLabel = queryAllWithShadow(`label[for="${t.id}"]`, settingsContext)[0];
          if (forLabel) labelText += ' ' + (forLabel.textContent || '').toLowerCase();
        }
        // Also check parent text
        const parentText = (t.closest('label, [class*="setting" i], [class*="option" i]')?.textContent || '').toLowerCase();
        labelText += ' ' + parentText;

        if (/variation/i.test(labelText)) {
          variationToggle = t;
          variationToggleContainer = t.closest('div, li, section') || t.parentElement;
          break;
        }
      }
    }

    // Strategy C: If the settings dialog contains "Variations" text, just find ANY toggle/switch
    // eBay's Settings dialog typically only has the Variations toggle
    if (!variationToggle && /variation/i.test(settingsContext.textContent || '')) {
      const anyToggles = queryAllWithShadow(
        'input[type="checkbox"], [role="switch"], [role="checkbox"], ' +
        'button[class*="toggle" i], button[class*="switch" i]'
      , settingsContext);
      for (const t of anyToggles) {
        if (isElementVisible(t)) {
          variationToggle = t;
          variationToggleContainer = t.closest('div, li, section') || t.parentElement;
          console.log(`[DropFlow] Variations toggle found via Strategy C (only toggle in settings): ${t.tagName} role=${t.getAttribute('role')}`);
          break;
        }
      }
    }

    if (!variationToggle) {
      console.warn('[DropFlow] Variations toggle not found in settings dialog');
      // Log all interactive elements in settings for debugging
      const allInteractive = queryAllWithShadow('input, button, [role="switch"], [role="checkbox"]', settingsContext);
      for (const el of allInteractive) {
        console.log(`[DropFlow]   Settings element: ${el.tagName}[${el.type || el.getAttribute('role') || ''}] class="${(el.className || '').substring(0, 50)}" text="${(el.textContent || '').trim().substring(0, 30)}"`);
      }
      await logVariationStep('ensureVariationsEnabled:noVariationToggle', {
        settingsContextTag: settingsContext.tagName,
        labelsCount: labels.length,
        labelsWithVariation: Array.from(labels).filter(l => /variation/i.test(l.textContent || '')).map(l => l.textContent?.trim()?.substring(0, 60))
      });
      // Close settings
      const closeBtn2 = queryAllWithShadow('button[aria-label*="close" i], button[aria-label*="dismiss" i]', settingsContext)[0];
      if (closeBtn2) simulateClick(closeBtn2);
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }

    // 7. Check if the toggle is already ON
    const toggleIsOn = () =>
      variationToggle?.checked === true ||
      variationToggle?.getAttribute('aria-checked') === 'true' ||
      variationToggle?.getAttribute('aria-pressed') === 'true' ||
      /\bon\b|active|enabled|checked|is-checked|--on/i.test(variationToggle?.className || '') ||
      (variationToggleContainer && /\bon\b|active|enabled|checked|is-checked|--on/i.test(variationToggleContainer.className || ''));

    const isOn = toggleIsOn();

    const urlBeforeToggle = window.location.href;

    if (isOn) {
      console.log('[DropFlow] Variations toggle is already ON');
      await logVariationStep('ensureVariationsEnabled:alreadyOn', {});
    } else {
      // 8. Click the toggle to enable variations
      console.log('[DropFlow] Clicking Variations toggle to enable');
      simulateClick(variationToggle);
      await sleep(500);

      await sleep(500);

      // Verify click worked
      let nowOn = toggleIsOn();
      console.log(`[DropFlow] After first click: checked=${variationToggle.checked}, aria-checked=${variationToggle.getAttribute('aria-checked')}, class="${(variationToggle.className || '').substring(0, 40)}"`);

      // Some toggles need the click on the container, label, or the visual track
      if (!nowOn) {
        // Try clicking the label
        const labelTarget = variationToggleContainer?.querySelector('label') || variationToggleContainer;
        if (labelTarget) {
          simulateClick(labelTarget);
          await sleep(500);
        }

        // Try clicking the visual track/slider element
        const track = variationToggleContainer?.querySelector('[class*="track" i], [class*="slider" i], [class*="switch" i]:not(input)');
        if (track) {
          simulateClick(track);
          await sleep(500);
        }
        nowOn = toggleIsOn();
      }

      await logVariationStep('ensureVariationsEnabled:toggleClicked', {
        checked: variationToggle.checked,
        ariaChecked: variationToggle.getAttribute('aria-checked'),
        className: (variationToggle.className || '').substring(0, 60),
        nowOn
      });
    }

    // 9. Close the settings panel
    await sleep(500);

    // Find the close button â€" eBay's Settings modal has an Ã- in the top-right corner
    let closeBtn = null;

    // Look for close/dismiss buttons by aria-label first (most reliable)
    closeBtn = queryAllWithShadow(
      'button[aria-label*="close" i], button[aria-label*="dismiss" i], ' +
      '[role="button"][aria-label*="close" i], [role="button"][aria-label*="dismiss" i]'
    , settingsContext)[0];

    // Try text-based search
    if (!closeBtn) {
      closeBtn = findButtonByText(settingsContext, /^(close|done|save|apply|ok)$/i);
    }

    // Look for the Ã- character button (various unicode forms)
    if (!closeBtn) {
      const allBtns = queryAllWithShadow('button, [role="button"]', settingsContext);
      for (const btn of allBtns) {
        if (!isElementVisible(btn)) continue;
        const text = (btn.textContent || '').trim();
        // Match ×, ✕, ✖, X, or single-char close icons
        if (/^[xX\u00D7\u2715\u2716\u2717\u2718\u2719]$/.test(text)) {
          closeBtn = btn;
          break;
        }
        // Also match buttons with close-related classes
        if (/close|dismiss/i.test(btn.className || '')) {
          closeBtn = btn;
          break;
        }
      }
    }

    // Also search at document level (modal close buttons are sometimes outside the dialog)
    if (!closeBtn) {
      closeBtn = queryAllWithShadow(
        '[role="dialog"] button[aria-label*="close" i], ' +
        '[class*="modal" i] button[aria-label*="close" i], ' +
        '[class*="dialog" i] button[aria-label*="close" i]'
      )[0];
    }

    if (closeBtn) {
      console.log(`[DropFlow] Closing settings: "${closeBtn.textContent?.trim()?.substring(0, 20)}" aria="${closeBtn.getAttribute('aria-label') || ''}"`);
      simulateClick(closeBtn);
    } else {
      console.log('[DropFlow] No close button found, pressing Escape');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(300);
      document.body.click();
    }
    await sleep(1500);

    // 9b. Check if toggling variations triggered SPA navigation to builder page.
    // eBay's SPA navigation is asynchronous - the builder may take several seconds to render.
    // Retry up to 12 times (6 seconds total) to catch delayed navigation.
    for (let builderPoll = 0; builderPoll < 12; builderPoll++) {
      if (window.location.href !== urlBeforeToggle && builderPoll === 0) {
        console.log(`[DropFlow] URL changed during toggle: ${urlBeforeToggle} -> ${window.location.href}`);
      }
      const postToggleCtx = (builderPoll % 4 === 0)
        ? detectVariationBuilderContextWithLog(`ensureVariationsEnabled:postToggle:${builderPoll}`)
        : detectVariationBuilderContext();
      if (postToggleCtx.isBuilder) {
        console.warn('[DropFlow] Toggle triggered navigation to variation builder page');
        await logVariationStep('ensureVariationsEnabled:builderNavigationDetected', {
          url: window.location.href,
          score: postToggleCtx.score,
          pollIteration: builderPoll
        });
        return 'builder';
      }
      await sleep(500);
    }

    // 10. Scroll and verify the VARIATIONS section appeared
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await sleep(1000);
    // Scroll down slowly to trigger lazy-loaded sections
    for (let y = 0; y < document.body.scrollHeight; y += 300) {
      window.scrollTo({ top: y, behavior: 'smooth' });
      await sleep(200);

      // Check for builder during scroll (SPA navigation can complete at any time)
      const scrollBuilderCtx = detectVariationBuilderContext();
      if (scrollBuilderCtx.isBuilder) {
        console.warn('[DropFlow] Builder detected during scroll-verify loop');
        await logVariationStep('ensureVariationsEnabled:builderDuringScroll', {
          url: window.location.href,
          score: scrollBuilderCtx.score
        });
        return 'builder';
      }

      const section = findVariationsSection();
      if (section && looksLikeVariationSection(section)) {
        console.log('[DropFlow] VARIATIONS section now visible after enabling toggle!');
        await logVariationStep('ensureVariationsEnabled:success', { sectionTag: section.tagName });
        return true;
      }
    }

    // Final check after full scroll - also check builder one last time
    const finalBuilderCtx = detectVariationBuilderContextWithLog('ensureVariationsEnabled:finalBuilderCheck');
    if (finalBuilderCtx.isBuilder) {
      console.log('[DropFlow] Builder detected after full scroll');
      return 'builder';
    }

    const finalCheck = findVariationsSection();
    if (finalCheck && looksLikeVariationSection(finalCheck)) {
      console.log('[DropFlow] VARIATIONS section found after full page scroll');
      await logVariationStep('ensureVariationsEnabled:success', {});
      return true;
    }

    const confirmedOn = toggleIsOn();
    if (confirmedOn) {
      // eBay sometimes renders the section late; proceed and let fillVariations() retry Edit detection.
      console.warn('[DropFlow] VARIATIONS section not visible yet, but toggle is ON; proceeding');
      await logVariationStep('ensureVariationsEnabled:toggleOnProceed', {
        toggleChecked: variationToggle.checked,
        toggleAriaChecked: variationToggle.getAttribute('aria-checked')
      });
      return true;
    }

    console.warn('[DropFlow] VARIATIONS section still not visible after enabling toggle');
    await logVariationStep('ensureVariationsEnabled:failed', {
      toggleChecked: variationToggle.checked,
      toggleAriaChecked: variationToggle.getAttribute('aria-checked')
    });
    return false;
  }

  /**
   * Find the VARIATIONS section element in the eBay listing form.
   * Tries multiple patterns since eBay's form varies by marketplace and version.
   */
  function findVariationsSection() {
    // 1. Look for headings with "VARIATION" text (case insensitive)
    const headings = queryAllWithShadow('h2, h3, h4, h5, legend, [class*="section-title"], [class*="section-header"], span[class*="title"]');
    for (const h of headings) {
      const text = (h.textContent || '').trim();
      if (/variation/i.test(text) && text.length < 50) {
        const candidate = h.closest('section, [class*="section"], fieldset, [class*="card"], [class*="panel"], [class*="module"], [class*="variation"]') || h.parentElement;
        // Guard: avoid returning the heading itself (or tiny title wrappers).
        const candidateText = (candidate?.textContent || '').trim();
        const headingLike = candidate && (/^H[1-6]$/.test(candidate.tagName) || candidateText.length < 40);
        if (candidate && candidate !== h && !headingLike) return candidate;
      }
    }

    // 2. Look for elements with variation-related class/data attributes
    const selectors = [
      '[class*="variation" i][class*="section" i]',
      '[class*="variation" i][class*="card" i]',
      '[class*="variation" i][class*="panel" i]',
      '[class*="variation" i][class*="module" i]',
      '[data-testid*="variation" i]',
      '[data-section*="variation" i]',
      '#variation-section',
      '#variations'
    ];
    for (const sel of selectors) {
      const candidates = queryAllWithShadow(sel);
      const el = candidates.find(c => isElementVisible(c)) || candidates[0];
      if (el) return el;
    }

    // 2b. Look for the default empty-state card text (common in /lstng):
    // "Save time and money by listing multiple variations..."
    const cards = queryAllWithShadow('section, fieldset, article, div[class], div[data-testid]');
    for (const card of cards) {
      if (!isElementVisible(card)) continue;
      if (card.offsetHeight < 80 || card.offsetHeight > 1800) continue;
      const text = (card.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (text.length < 40 || text.length > 1400) continue;
      if (/save time and money/.test(text) && /multiple variations|variation|options?/.test(text)) {
        return card;
      }
      if (/variations?/.test(text) && /(add|create|edit|manage)\s+(variation|variations)/.test(text)) {
        return card;
      }
    }

    // 3. Scan all visible text on the page for "Variations" section
    const allElements = queryAllWithShadow('div, section, fieldset');
    for (const el of allElements) {
      // Only check direct text (not deep children) to find section containers
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3 || (n.nodeType === 1 && ['H2','H3','H4','H5','SPAN','LEGEND'].includes(n.tagName)))
        .map(n => (n.textContent || '').trim())
        .join(' ');
      if (/variation/i.test(directText) && directText.length < 80 && el.offsetHeight > 50) {
        return el;
      }
    }

    // 4. If we can't locate a section, infer one from strong variation entry buttons.
    const triggerCandidates = queryAllWithShadow(
      'button, a, [role="button"], [role="link"], [role="menuitem"], ' +
      'ebay-button, ebay-icon-button, ebay-menu-button, ' +
      '[data-testid*="variation" i], [data-testid*="option" i], ' +
      '[id*="variation" i], [id*="option" i], [class*="variation" i], [class*="option" i]'
    );
    for (const el of triggerCandidates) {
      if (!isElementVisible(el)) continue;
      const hints = [
        el.textContent || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || '',
        el.getAttribute('data-testid') || '',
        el.getAttribute('id') || '',
        el.className || '',
        el.getAttribute('label') || ''
      ].join(' ').toLowerCase();
      if (!/(variation|variant)/.test(hints)) continue;
      if (!/(add|create|edit|manage|set|enable|configure|customize)/.test(hints)) continue;
      if (/title options|see title options/.test(hints)) continue;
      if (/(shipping|return|policy|payment|promoted|marketing|ad\b|ads\b)/.test(hints) && !/variation/.test(hints)) continue;
      const section = el.closest('section, [class*="section"], fieldset, [class*="card"], [class*="panel"], [class*="module"]');
      if (section) return section;
      if (el.parentElement) return el.parentElement;
    }

    console.log('[DropFlow] Could not find VARIATIONS section in DOM');
    return null;
  }

  /**
   * Find the Edit/Add button on the VARIATIONS section.
   * Tries multiple patterns: Edit, Add, Create, pencil icon, etc.
   */
  function findVariationEditButton() {
    // Strategy 0: Find "VARIATIONS" heading row and choose nearby right-side Edit trigger.
    // On some eBay layouts the Edit control is not a descendant of the section container.
    const headingCandidates = queryAllWithShadow('h1, h2, h3, h4, h5, legend, span, div, strong');
    const variationHeading = headingCandidates.find(h => {
      if (!isElementVisible(h)) return false;
      const text = (h.textContent || '').trim();
      if (!/^variations?$/i.test(text)) return false;
      const rect = h.getBoundingClientRect();
      return rect.width > 40 && rect.height > 12 && rect.top < window.innerHeight * 0.9;
    });
    if (variationHeading) {
      const hRect = variationHeading.getBoundingClientRect();
      const clickables = queryAllWithShadow('button, a, [role="button"], [role="link"], [role="menuitem"]');
      let best = null;
      let bestScore = -Infinity;
      for (const el of clickables) {
        if (!isElementVisible(el) || el.disabled) continue;
        const rect = el.getBoundingClientRect();
        if (Math.abs((rect.top + rect.height / 2) - (hRect.top + hRect.height / 2)) > 120) continue;
        if (rect.left < hRect.left + 80) continue;
        const text = (el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').trim();
        const title = (el.getAttribute('title') || '').trim();
        const cls = String(el.className || '');
        const hints = `${text} ${aria} ${title} ${cls}`.toLowerCase();
        if (/title options|see title options/.test(hints)) continue;
        if (!/(edit|manage|create|variation|pencil)/.test(hints)) continue;
        let score = 0;
        if (/^\s*edit\s*$/i.test(text)) score += 200;
        if (/\bedit\b/.test(hints)) score += 120;
        if (/\bvariation\b/.test(hints)) score += 60;
        score -= Math.abs(rect.left - hRect.right) * 0.35;
        score -= Math.abs(rect.top - hRect.top) * 0.8;
        if (score > bestScore) {
          best = el;
          bestScore = score;
        }
      }
      if (best) {
        console.log(`[DropFlow] Found variation edit via heading-row strategy: "${(best.textContent || best.getAttribute('aria-label') || '').trim().substring(0, 40)}"`);
        return best;
      }
    }

    const section = findVariationsSection();
    if (!section) {
      console.log('[DropFlow] No VARIATIONS section found for edit button search; trying global variation button search');
      const globalClickable = queryAllWithShadow(
        'button, a, [role="button"], [role="link"], [role="menuitem"], ' +
        'ebay-button, ebay-icon-button, ebay-menu-button, ' +
        '[data-testid], [id], [class]'
      );
      for (const rawEl of globalClickable) {
        const el = rawEl.matches('button, a, [role="button"], [role="link"], [role="menuitem"]')
          ? rawEl
          : (rawEl.querySelector?.('button, a, [role="button"], [role="link"], [role="menuitem"]') || rawEl);
        if (!isElementVisible(el) || el.disabled) continue;
        const hints = [
          el.textContent || '',
          el.getAttribute('aria-label') || '',
          el.getAttribute('title') || '',
          el.getAttribute('data-testid') || '',
          el.getAttribute('id') || '',
          el.className || '',
          el.getAttribute('label') || ''
        ].join(' ').toLowerCase().replace(/\s+/g, ' ').trim();

        if (!/(variation|variant)/.test(hints)) continue;
        if (!/(edit|add|create|manage|set|enable|configure|customize)/.test(hints)) continue;
        if (/title options|see title options/.test(hints)) continue;
        if (/(shipping|return|policy|payment|promoted|marketing|ad\b|ads\b)/.test(hints) && !/variation/.test(hints)) continue;
        return el;
      }
      return null;
    }

    console.log(`[DropFlow] VARIATIONS section found: ${section.tagName}.${(section.className || '').substring(0, 60)}, text="${section.textContent?.substring(0, 100).trim()}"`);

    // 1. Look for Edit/Add/Create button or link within the section
    const allClickable = queryAllWithShadow('button, a, [role="button"], [role="link"], [role="menuitem"]', section);
    console.log(`[DropFlow] Found ${allClickable.length} clickable elements in VARIATIONS section`);

    // Try exact match first
    for (const el of allClickable) {
      const text = (el.textContent || '').trim();
      if (/^\s*(edit|add|create|manage)\s*(variation|detail)?s?\s*$/i.test(text) && isElementVisible(el)) {
        console.log(`[DropFlow] Found variation button: "${text}"`);
        return el;
      }
    }

    // Try partial match
    for (const el of allClickable) {
      const text = (el.textContent || '').trim();
      if (text.length < 40 && /edit|add|create|manage/i.test(text) && isElementVisible(el)) {
        console.log(`[DropFlow] Found variation button (partial): "${text}"`);
        return el;
      }
    }

    // 2. Look for pencil/edit icon
    const iconSelectors = [
      '[class*="edit" i]', '[class*="pencil" i]', '[class*="icon" i]',
      'svg', 'i[class*="icon"]'
    ];
    for (const sel of iconSelectors) {
      const icons = queryAllWithShadow(sel, section);
      for (const icon of icons) {
        const clickable = icon.closest('button, a, [role="button"]');
        if (clickable && isElementVisible(clickable)) {
          console.log(`[DropFlow] Found variation icon button: ${clickable.tagName}`);
          return clickable;
        }
        if (isElementVisible(icon) && (icon.tagName === 'A' || icon.tagName === 'BUTTON')) {
          return icon;
        }
      }
    }

    // 3. Last resort: any visible button in the section
    for (const el of allClickable) {
      if (isElementVisible(el) && !el.disabled) {
        console.log(`[DropFlow] Using fallback button in VARIATIONS: "${(el.textContent || '').trim().substring(0, 40)}"`);
        return el;
      }
    }

    console.log('[DropFlow] No edit button found in VARIATIONS section');
    return null;
  }

  /**
   * Upload per-variation images (e.g., different photos for each Color value).
   * Finds the visual axis (the one with images, usually "Color"), uploads images,
   * then PUTs variationPictures to the draft.
   * Returns true if successful.
   */
  /**
   * Upload default photos via the MSKU builder's picupload iframe.
   * For variation listings, the main Photos section only handles video — image uploads
   * must go through the builder's photo iframe (lstng/picupload).
   * The picupload iframe has its own Helix sellingUIUploader instance that accepts images.
   */
  async function uploadPhotosViaMskuBuilder(productData) {
    const images = productData.images || [];
    if (images.length === 0) return false;

    // Find the picupload iframe (it should exist when the builder is open)
    const picIframe = document.querySelector('iframe[src*="picupload"], iframe[name*="photo"]');
    let picDoc = null;
    if (picIframe) {
      try { picDoc = picIframe.contentDocument || picIframe.contentWindow?.document; } catch (_) {}
    }

    // If we can't access the picupload iframe directly (cross-origin),
    // post a message to it via the main-world bridge
    console.log(`[DropFlow] MSKU builder: uploading ${Math.min(images.length, 12)} default photos via picupload iframe...`);

    // Download images via service worker
    const fileDataArr = [];
    const maxImages = Math.min(images.length, 12);
    const preDownloaded = productData.preDownloadedImages || [];

    for (let i = 0; i < maxImages; i++) {
      try {
        let dataUrl = null;
        if (Array.isArray(preDownloaded) && preDownloaded[i]) {
          dataUrl = preDownloaded[i];
        } else {
          const url = images[i];
          if (!url || (!url.startsWith('http') && !url.startsWith('//'))) continue;
          const normalUrl = url.startsWith('//') ? 'https:' + url : url;
          const response = await sendMessageSafe({ type: 'FETCH_IMAGE', url: normalUrl }, 15000);
          if (response?.success && response.dataUrl) {
            dataUrl = response.dataUrl;
          }
        }
        if (dataUrl) {
          fileDataArr.push({ dataUrl, name: `product-photo-${i + 1}.jpg`, type: 'image/jpeg' });
        }
      } catch (e) {
        console.warn(`[DropFlow] MSKU builder photo ${i + 1}: download error:`, e.message);
      }
    }

    if (fileDataArr.length === 0) {
      console.warn('[DropFlow] MSKU builder: no images downloaded');
      return false;
    }

    // Find the picupload iframe and inject upload script into its main world
    const callbackId = '__dropflow_msku_photo_' + Date.now();
    const resultPromise = new Promise((resolve) => {
      const handler = (event) => {
        if (event.data && event.data.type === callbackId) {
          window.removeEventListener('message', handler);
          resolve(event.data);
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => { window.removeEventListener('message', handler); resolve({ timeout: true }); }, 90000);
    });

    // The picupload iframe is same-origin (ebay.com.au/lstng/picupload) but we need
    // to inject into its document, not the parent. Use the service worker to inject
    // into the MAIN world via chrome.scripting.executeScript (CSP-safe, no inline script).
    await chrome.runtime.sendMessage({ type: 'EXECUTE_MAIN_WORLD_PICUPLOAD', callbackId, fileDataArr });

    const result = await resultPromise;
    if (result.success) {
      console.log(`[DropFlow] MSKU builder: ${result.uploaded} default photos uploaded`);
      return true;
    } else {
      console.warn(`[DropFlow] MSKU builder photo upload failed: ${result.error || 'timeout'}`);
      return false;
    }
  }

  async function uploadVariationImages(productData, ebayContext, axisNameMap = {}) {
    const variations = productData.variations;
    if (!variations?.hasVariations || !ebayContext?.draftId) return false;

    // Find the visual axis â€" the one that has per-value images
    let visualAxisName = null;
    for (const axis of variations.axes) {
      if (axis.values.some(v => v.image)) {
        visualAxisName = axis.name;
        break;
      }
    }
    if (!visualAxisName) {
      console.log('[DropFlow] No visual axis found (no per-value images)');
      return false;
    }

    // Map to eBay's label (e.g., "Color" â†' "Colour" on ebay.com.au)
    const ebayAxisName = axisNameMap[visualAxisName] || visualAxisName;
    console.log(`[DropFlow] Uploading variation images for axis: ${visualAxisName} (eBay: ${ebayAxisName})`);

    // Collect unique images per value, using pre-downloaded data if available
    const preDownloaded = productData.preDownloadedVariationImages || {};
    const pictures = {};
    const uploadEndpoints = [];
    if (ebayContext.mediaUploadUrl) uploadEndpoints.push(ebayContext.mediaUploadUrl);
    uploadEndpoints.push(
      `https://${location.host}/sell/media/api/image`,
      `https://${location.host}/sell/media/imageUpload`
    );

    // Filter headers (FormData needs its own Content-Type)
    const headers = {};
    for (const [key, value] of Object.entries(ebayContext.headers)) {
      if (key.toLowerCase() !== 'content-type') headers[key] = value;
    }

    for (const axis of variations.axes) {
      if (axis.name !== visualAxisName) continue;
      for (const val of axis.values) {
        if (!val.image) continue;

        let uploadedUrl = null;

        // Try to get the image data
        let dataUrl = preDownloaded[val.image] || null;
        if (!dataUrl) {
          // Try FETCH_IMAGE as fallback
          try {
            const resp = await sendMessageSafe({ type: 'FETCH_IMAGE', url: val.image }, 15000);
            if (resp?.success && resp.dataUrl) dataUrl = resp.dataUrl;
          } catch (_) {}
        }

        if (dataUrl) {
          // Upload via service worker proxy (avoids CORS — SW has host_permissions)
          try {
            const resp = await sendMessageSafe({
              type: 'UPLOAD_EBAY_IMAGE', imageDataUrl: dataUrl,
              filename: `variation-${val.name.replace(/\s+/g, '-')}.jpg`
            }, 20000);
            if (resp?.success && resp.imageUrl) uploadedUrl = resp.imageUrl;
          } catch (_) {}

          // Fallback: try EPS upload (same-origin XHR) to get eBay-hosted URL
          if (!uploadedUrl) {
            try {
              const file = dataUrlToFile(dataUrl, `variation-${val.name.replace(/\s+/g, '-')}.jpg`);
              const epsUrls = await uploadFilesToEpsForUrls([file]);
              if (epsUrls.length > 0) uploadedUrl = epsUrls[0];
            } catch (_) {}
          }
        }

        if (uploadedUrl) {
          pictures[val.name] = [uploadedUrl];
          console.log(`[DropFlow] Variation image uploaded for ${visualAxisName}:${val.name} â†' ${uploadedUrl.substring(0, 60)}`);
        } else {
          console.warn(`[DropFlow] Failed to upload variation image for ${visualAxisName}:${val.name}`);
        }
      }
    }

    if (Object.keys(pictures).length === 0) {
      console.warn('[DropFlow] No variation images uploaded');
      return false;
    }

    // PUT the variation pictures payload using eBay's localized axis name
    const payload = {
      variations: {
        variationPictures: {
          variationAxis: ebayAxisName,
          pictures
        }
      }
    };

    try {
      const success = await putDraftField(payload, ebayContext);
      if (success) {
        console.log(`[DropFlow] Variation pictures PUT successful: ${Object.keys(pictures).length} values with images`);
        return true;
      }
    } catch (e) {
      console.warn('[DropFlow] Variation pictures PUT failed:', e.message);
    }
    return false;
  }

  /**
   * Request captured eBay draft API headers from the background script.
   * Returns { headers, draftId } or null.
   */
  async function getEbayHeaders() {
    try {
      const resp = await sendMessageSafe({ type: 'GET_EBAY_HEADERS' }, 10000);
      if (resp && resp.success && resp.headers) {
        console.log(`[DropFlow] Got eBay headers, draftId: ${resp.draftId}, mediaUrl: ${resp.mediaUploadUrl || 'none'}`);
        return {
          headers: resp.headers,
          draftId: resp.draftId,
          mediaUploadUrl: resp.mediaUploadUrl || null
        };
      }
      console.log('[DropFlow] No eBay headers available yet:', resp?.error);
      return null;
    } catch (e) {
      console.warn('[DropFlow] Failed to get eBay headers:', e.message);
      return null;
    }
  }

  /**
   * Try to extract the draft ID from the current page URL.
   * eBay listing URLs contain the draft ID: /lstng/{draftId} or /lstng/api/listing_draft/{draftId}
   */
  function extractDraftIdFromUrl() {
    // Try URL path: /lstng/{draftId} or /lstng/api/listing_draft/{draftId}
    const pathMatch = window.location.href.match(/lstng[^/]*\/(\d+)/);
    if (pathMatch) return pathMatch[1];
    // Try URL query params: ?draftId=12345 (EcomSniper approach)
    const params = new URLSearchParams(window.location.search);
    return params.get('draftId') || null;
  }

  /**
   * Fill the description field.
   * Strategy: DOM fill for visual feedback + direct API PUT to commit to eBay's server.
   */
  async function fillDescription(productData, ebayContext) {
    const descHtml = await generateAIDescription(productData);
    console.log('[DropFlow] Description ready, looking for editor...');

    // Scroll to the description section
    const descContainer = document.querySelector('.summary__description') ||
      document.querySelector('[class*="summary__description"]');
    if (descContainer) {
      await scrollToAndWait(descContainer, 800);
    }

    // Click "Add description" button if the editor is collapsed/hidden
    const addDescBtn = Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .find(b => {
        const text = b.textContent.toLowerCase().trim();
        return text.includes('add description') || text.includes('add a description') ||
               text.includes('create description');
      });
    if (addDescBtn) {
      addDescBtn.click();
      console.log('[DropFlow] Clicked "Add description" button');
      await sleep(2500);
    }

    // === STEP 1: Fill DOM with full focus/blur simulation (execCommand + innerHTML fallback) ===
    const domFilled = await fillDescriptionDOM(descHtml);

    // === STEP 2: Direct API PUT to commit description to eBay's server ===
    if (ebayContext) {
      // If we don't have a draftId from intercepted headers, try extracting from URL
      if (!ebayContext.draftId) {
        ebayContext.draftId = extractDraftIdFromUrl();
      }

      const putSuccess = await putDraftField({ description: descHtml }, ebayContext);
      if (putSuccess) {
        console.log('[DropFlow] Description committed via API PUT');
        return true;
      }
    }

    if (domFilled) {
      console.log('[DropFlow] Description filled via DOM (API PUT unavailable)');
    } else {
      console.warn('[DropFlow] Could not fill description via any method');
    }

    return domFilled;
  }

  /**
   * Commit content to an editable element (iframe body or contenteditable div).
   * Full focus â†' set â†' blur simulation, same pattern as commitInputValue but for rich text.
   * Tries execCommand first (triggers internal change detection), falls back to innerHTML.
   */
  async function commitEditorContent(editor, iframeDoc, descHtml, parentFrame) {
    // 1. Simulate clicking INTO the editor
    simulateClick(editor);
    editor.focus();
    editor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    editor.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    await sleep(300);

    // 2. Try execCommand first (creates undo history + triggers internal change detection)
    let usedExecCommand = false;
    const doc = iframeDoc || document;
    try {
      doc.execCommand('selectAll', false, null);
      doc.execCommand('insertHTML', false, descHtml);
      usedExecCommand = true;
    } catch (e) {
      // execCommand not supported in this context, fall back to innerHTML
    }

    if (!usedExecCommand) {
      editor.innerHTML = descHtml;
    }
    await sleep(500);

    // 3. Dispatch change events on the editor
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);

    // 4. Dispatch change events on the parent iframe (eBay listens here too)
    if (parentFrame) {
      parentFrame.dispatchEvent(new Event('input', { bubbles: true }));
      parentFrame.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await sleep(200);

    // 5. Blur the editor (simulate clicking out)
    editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    editor.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    if (parentFrame) {
      parentFrame.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      parentFrame.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    }
    await sleep(200);

    // 6. Click a neutral element to fully deselect
    const neutralEl = document.querySelector('.smry.summary__title') ||
                      document.querySelector('[class*="summary__title"]') || document.body;
    simulateClick(neutralEl);
    await sleep(300);

    return true;
  }

  /**
   * Fill description via DOM manipulation with full focus/blur simulation.
   */
  async function fillDescriptionDOM(descHtml) {
    // Try eBay's specific RTE iframe
    const rteFrame = document.getElementById('se-rte-frame__summary') ||
      document.querySelector('iframe[id*="rte-frame"]') ||
      document.querySelector('.summary__description iframe') ||
      document.querySelector('[class*="se-rte"] iframe');
    if (rteFrame) {
      try {
        const iframeDoc = rteFrame.contentDocument || rteFrame.contentWindow?.document;
        if (iframeDoc) {
          const editor = iframeDoc.body.querySelector('.se-rte-editor__rich') || iframeDoc.body;
          await commitEditorContent(editor, iframeDoc, descHtml, rteFrame);
          console.log('[DropFlow] Filled description DOM via RTE iframe');
          return true;
        }
      } catch (e) {
        console.warn('[DropFlow] RTE iframe access failed:', e.message);
      }
    }

    // Try any editable iframe
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) continue;
        const body = iframeDoc.querySelector('body');
        if (body && (body.contentEditable === 'true' || iframeDoc.designMode === 'on' ||
            iframe.id?.toLowerCase().includes('description') ||
            iframe.closest('[class*="description"]') ||
            iframe.closest('[class*="rte"]') ||
            iframe.offsetHeight > 80)) {
          await commitEditorContent(body, iframeDoc, descHtml, iframe);
          console.log('[DropFlow] Filled description DOM via iframe');
          return true;
        }
      } catch (e) { /* cross-origin */ }
    }

    // Try contenteditable div
    const editableDivs = document.querySelectorAll(
      '.se-rte-editor__rich, [contenteditable="true"]'
    );
    for (const div of editableDivs) {
      const parent = div.closest('[class*="description"]') || div.closest('[class*="editor"]') ||
                     div.closest('[class*="rte"]');
      if (parent || div.classList.contains('se-rte-editor__rich') ||
          (div.offsetHeight > 80 && div.offsetWidth > 200)) {
        await commitEditorContent(div, null, descHtml, null);
        console.log('[DropFlow] Filled description DOM via contenteditable');
        return true;
      }
    }

    return false;
  }

  /**
   * Extract brand from Amazon product data.
   * Tries multiple strategies: title pattern, bullet points.
   */
  function extractBrand(productData) {
    const isAliExpress = productData.url && productData.url.includes('aliexpress');

    // Strategy 0: Use brand field if the scraper extracted it directly
    if (productData.brand && productData.brand.trim()) {
      return productData.brand.trim();
    }

    // Strategy 1: Check bulletPoints for explicit "Brand Name: XYZ" or "Brand: XYZ" entries
    if (productData.bulletPoints) {
      for (const bullet of productData.bulletPoints) {
        const brandMatch = bullet.match(/^brand\s*(?:name)?\s*[:]\s*(.+)/i);
        if (brandMatch) {
          const brand = brandMatch[1].trim();
          // Skip generic/placeholder values
          if (brand && !/^(no brand|n\/a|none|oem|generic|unbranded|no\s*name)$/i.test(brand)) {
            return brand;
          }
        }
      }
    }

    // For AliExpress: if no real brand found above, use "Unbranded" (valid eBay option)
    if (isAliExpress) {
      return 'Unbranded';
    }

    // Strategy 2: First capitalized word(s) in title (common Amazon pattern: "BrandName Product...")
    if (productData.title) {
      const titleMatch = productData.title.match(/^([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+){0,2})\s/);
      if (titleMatch) return titleMatch[1];
    }

    // Strategy 3: Look for "by BrandName" or "from BrandName" in bullet points
    if (productData.bulletPoints) {
      for (const bullet of productData.bulletPoints) {
        const byMatch = bullet.match(/(?:by|from)\s+([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)/i);
        if (byMatch) return byMatch[1];
      }
    }

    return null;
  }

  /**
   * Find the row container for a given label element.
   * eBay's lstng form uses a two-column layout: label on left, input on right.
   * We walk up the DOM to find the row that contains both.
   * Handles standard inputs AND eBay's custom dropdown divs (Brand, policies).
   */
  function findRowContainer(labelEl) {
    let el = labelEl.parentElement;

    for (let i = 0; i < 8 && el && el !== document.body; i++) {
      // Standard form elements
      const hasStandard = el.querySelector(
        'input, select, textarea, ' +
        '[role="combobox"], [role="listbox"], [role="button"], ' +
        '[aria-haspopup], [aria-expanded]'
      );
      if (hasStandard) return el;

      // eBay custom dropdowns: clickable divs with SVG chevrons,
      // or rows with "Frequently selected" <a> links
      const links = el.querySelectorAll('a');
      if (links.length >= 2 && el.offsetWidth > 200) return el;

      el = el.parentElement;
    }

    // Fallback: return nearest parent that looks like a row
    // (has multiple children and is reasonably wide)
    el = labelEl.parentElement;
    for (let i = 0; i < 8 && el && el !== document.body; i++) {
      if (el.children.length >= 2 && el.offsetWidth > 300) return el;
      el = el.parentElement;
    }

    return null;
  }

  /**
   * Find a label element on the page by exact text match.
   * Scans all potential label-like elements.
   */
  function findLabelByText(labelText) {
    // Check all common label elements
    const candidates = document.querySelectorAll(
      'label, legend, span, div, a, h3, h4, [class*="label"], [class*="header"]'
    );
    for (const el of candidates) {
      // Use direct text content (not nested children's text) for precision
      const directText = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
        ? el.childNodes[0].textContent.trim()
        : null;
      const fullText = el.textContent.trim();

      if (directText === labelText || fullText === labelText) {
        // Verify this isn't a deeply nested element with lots of other text
        if (fullText.length < labelText.length + 30) {
          return el;
        }
      }
    }
    return null;
  }

  /**
   * Normalize a string for fuzzy matching (lowercase, strip punctuation/spaces).
   */
  function normalize(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Re-locate a label's row container from the LIVE DOM.
   * After React re-renders (e.g. after filling Brand), cached row references
   * become stale (detached). This finds the label fresh and returns its row.
   *
   * Unlike findRowContainer (which early-returns on >=2 links), this requires
   * the container to actually hold a form control (input, combobox, dropdown
   * with chevron SVG, etc.). This prevents returning a too-narrow label wrapper
   * that happens to contain "Frequently selected" links.
   */
  function relocateRowForLabel(labelText) {
    const JUNK = /selectedlist|selected values|select|choose|enter your|search or/i;
    const candidates = document.querySelectorAll('a, button, label, legend, span');
    for (const el of candidates) {
      const text = el.textContent.trim();
      if (text !== labelText) continue;
      if (el.offsetParent === null) continue;
      if (JUNK.test(text)) continue;
      if (el.closest('[role="listbox"], [role="combobox"], [role="option"]')) continue;

      // Walk up from this label element until we find a container with a REAL form control
      let parent = el.parentElement;
      for (let depth = 0; depth < 12 && parent && parent !== document.body; depth++) {
        // Check for standard form controls
        const hasFormControl = parent.querySelector(
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), ' +
          'select, textarea, ' +
          '[role="combobox"], [role="listbox"], [aria-haspopup], [aria-expanded]'
        );
        if (hasFormControl) {
          console.log(`[DropFlow] Re-located row for "${labelText}": <${parent.tagName}> (form control found at depth ${depth})`);
          return parent;
        }

        // Check for eBay custom dropdown: div with tabindex + SVG chevron inside
        const customDropdown = parent.querySelector('div[tabindex] svg, span[tabindex] svg, [class*="chevron"]');
        if (customDropdown) {
          console.log(`[DropFlow] Re-located row for "${labelText}": <${parent.tagName}> (custom dropdown at depth ${depth})`);
          return parent;
        }

        parent = parent.parentElement;
      }

      // Fallback: use findRowContainer (better than nothing)
      const fallbackRow = findRowContainer(el);
      if (fallbackRow) {
        console.log(`[DropFlow] Re-located row for "${labelText}" via fallback: <${fallbackRow.tagName}>`);
        return fallbackRow;
      }
    }
    return null;
  }

  /**
   * Try to fill an item specific field within a container row.
   * Handles: "Frequently selected" links, combobox typing, dropdowns, text inputs.
   */
  async function fillSpecificInRow(row, labelText, value) {
    await scrollToAndWait(row, 500);
    const normValue = normalize(value);

    console.log(`[DropFlow] fillSpecificInRow("${labelText}", "${value}") â€" row: <${row.tagName}>, children: ${row.children.length}, innerHTML length: ${row.innerHTML.length}`);

    // Priority 1: Click a "Frequently selected" link that matches the value (fuzzy)
    const allLinks = row.querySelectorAll('a');
    for (const link of allLinks) {
      const linkText = link.textContent.trim();
      if (normalize(linkText) === normValue) {
        link.click();
        console.log(`[DropFlow] Clicked "Frequently selected" link for "${labelText}": ${linkText}`);
        await sleep(300);
        return true;
      }
    }

    // Priority 2: Try typing into a text input first (eBay combobox)
    const textInput = row.querySelector(
      'input[type="text"], input[role="combobox"], input[aria-autocomplete], ' +
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])'
    );
    if (textInput) {
      await commitInputValue(textInput, value);
      await sleep(800);

      // Check for autocomplete suggestions (may be in a portal outside the row)
      const suggestions = document.querySelectorAll(
        '[role="option"], [role="listbox"] [role="option"], [class*="suggestion"], [class*="listbox"] li'
      );
      for (const sug of suggestions) {
        const sugText = sug.textContent.trim();
        if (normalize(sugText) === normValue || sugText.toLowerCase().includes(value.toLowerCase())) {
          sug.click();
          console.log(`[DropFlow] Selected autocomplete for "${labelText}": ${sugText}`);
          await sleep(300);
          return true;
        }
      }

      // Accept the typed value
      textInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      await sleep(200);
      textInput.dispatchEvent(new Event('blur', { bubbles: true }));
      console.log(`[DropFlow] Typed value for "${labelText}": ${value}`);
      return true;
    }

    // Priority 3: Click a dropdown trigger (select, combobox, custom div with chevron)
    const dropdownTrigger = row.querySelector(
      'select, [role="combobox"], [role="listbox"], [aria-haspopup], ' +
      '[aria-expanded], button[aria-haspopup], [class*="select"], [class*="dropdown"]'
    );

    if (dropdownTrigger) {
      if (dropdownTrigger.tagName === 'SELECT') {
        const options = dropdownTrigger.querySelectorAll('option');
        for (const opt of options) {
          if (opt.textContent.trim().toLowerCase().includes(value.toLowerCase())) {
            await commitInputValue(dropdownTrigger, opt.value);
            console.log(`[DropFlow] Selected option for "${labelText}": ${opt.textContent.trim()}`);
            return true;
          }
        }
      }

      dropdownTrigger.click();
      await sleep(800);

      // Look for options in the opened dropdown (may appear as a portal/overlay)
      const allOptions = document.querySelectorAll(
        '[role="option"], [role="listbox"] li, [class*="listbox"] li, ' +
        '[class*="menu-item"], [class*="option"]'
      );
      for (const opt of allOptions) {
        const optText = opt.textContent.trim();
        if (normalize(optText) === normValue || optText.toLowerCase().includes(value.toLowerCase())) {
          opt.click();
          console.log(`[DropFlow] Selected dropdown option for "${labelText}": ${optText}`);
          await sleep(300);
          return true;
        }
      }

      // If dropdown opened but no match, try typing in any input that appeared
      const newInput = document.querySelector('[role="listbox"] input, [class*="listbox"] input, [class*="menu"] input');
      if (newInput) {
        await commitInputValue(newInput, value);
        await sleep(400);
        const newSugs = document.querySelectorAll('[role="option"]');
        for (const sug of newSugs) {
          if (sug.textContent.trim().toLowerCase().includes(value.toLowerCase())) {
            sug.click();
            console.log(`[DropFlow] Selected from dropdown search for "${labelText}": ${sug.textContent.trim()}`);
            return true;
          }
        }
      }

      // Close the dropdown by clicking body
      document.body.click();
      await sleep(300);
    }

    // Priority 3b: Look for any clickable div with SVG chevron (eBay custom dropdown)
    if (!dropdownTrigger) {
      const clickableDivs = row.querySelectorAll('div[tabindex], div[role], span[tabindex]');
      for (const div of clickableDivs) {
        if (div.querySelector('svg') || div.querySelector('[class*="chevron"]') ||
            div.querySelector('[class*="arrow"]')) {
          div.click();
          console.log(`[DropFlow] Clicked custom dropdown div for "${labelText}"`);
          await sleep(800);

          const allOptions = document.querySelectorAll(
            '[role="option"], [role="listbox"] li, [class*="listbox"] li'
          );
          for (const opt of allOptions) {
            const optText = opt.textContent.trim();
            if (normalize(optText) === normValue || optText.toLowerCase().includes(value.toLowerCase())) {
              opt.click();
              console.log(`[DropFlow] Selected custom dropdown option for "${labelText}": ${optText}`);
              await sleep(300);
              return true;
            }
          }
          document.body.click();
          await sleep(300);
          break;
        }
      }
    }

    // Priority 4: Click any button/chip that matches
    const chips = row.querySelectorAll('button, [role="option"], [class*="chip"]');
    for (const chip of chips) {
      const chipText = chip.textContent.trim();
      if (normalize(chipText) === normValue) {
        chip.click();
        console.log(`[DropFlow] Clicked chip for "${labelText}": ${chipText}`);
        return true;
      }
    }

    // All priorities exhausted â€" log what we found in the row for debugging
    const dropdownTriggerCheck = row.querySelector('[role="combobox"], [role="listbox"], [aria-haspopup], [aria-expanded], select');
    const inputCheck = row.querySelector('input:not([type="hidden"])');
    const svgCheck = row.querySelector('svg');
    const tabindexCheck = row.querySelector('[tabindex]');
    console.warn(`[DropFlow] fillSpecificInRow FAILED for "${labelText}". Row diagnostics: ` +
      `hasDropdown=${!!dropdownTriggerCheck}, hasInput=${!!inputCheck}, hasSVG=${!!svgCheck}, ` +
      `hasTabindex=${!!tabindexCheck}, links=${allLinks.length}, rowTag=<${row.tagName}>, ` +
      `rowClasses="${(row.className || '').substring(0, 80)}"`);

    return false;
  }

  // ================================================================
  // BRAND â€" Direct, targeted approach
  // ================================================================

  /**
   * Fill Brand by finding the "Brand" label, clicking the dropdown,
   * then typing in the "Search or enter your own" input.
   */
  async function fillBrand(brand) {
    console.log(`[DropFlow] === FILLING BRAND: "${brand}" ===`);

    // Step 1: Find the "Brand" label element on the page
    // It's typically an <a> or <button> with underlined text in item specifics
    let brandLabel = null;
    const candidates = document.querySelectorAll('a, button, span, label');
    for (const el of candidates) {
      if (el.textContent.trim() === 'Brand' && el.offsetParent !== null) {
        brandLabel = el;
        break;
      }
    }

    if (!brandLabel) {
      console.log('[DropFlow] Brand label not found on page');
      return false;
    }

    await scrollToAndWait(brandLabel, 500);

    // Step 2: Find and click the dropdown trigger (the white box with â-¼ chevron)
    // Walk up from the Brand label to find the row, then find the dropdown in it
    let dropdownClicked = false;
    let parent = brandLabel.parentElement;
    for (let i = 0; i < 8 && parent && parent !== document.body; i++) {
      // Look for aria-expanded or role="combobox" (the dropdown trigger)
      const trigger = parent.querySelector(
        '[aria-expanded], [role="combobox"], [aria-haspopup="listbox"]'
      );
      if (trigger && trigger !== brandLabel) {
        trigger.click();
        console.log(`[DropFlow] Clicked Brand dropdown trigger: <${trigger.tagName}>`);
        dropdownClicked = true;
        break;
      }

      // Look for any element containing an SVG chevron (the â-¼ icon)
      const svgs = parent.querySelectorAll('svg');
      for (const svg of svgs) {
        const svgParent = svg.closest('button') || svg.closest('[role="combobox"]') ||
                          svg.closest('[tabindex]') || svg.parentElement;
        if (svgParent && svgParent !== parent && svgParent.offsetParent !== null) {
          svgParent.click();
          console.log(`[DropFlow] Clicked Brand chevron element: <${svgParent.tagName}>`);
          dropdownClicked = true;
          break;
        }
      }
      if (dropdownClicked) break;
      parent = parent.parentElement;
    }

    // If we didn't find a dropdown trigger, try clicking the label itself
    if (!dropdownClicked) {
      brandLabel.click();
      console.log('[DropFlow] Clicked Brand label as fallback');
    }

    await sleep(1500);

    // Step 3: Find the search input â€" placeholder is "Search or enter your own"
    const searchInput =
      document.querySelector('input[placeholder*="enter your own" i]') ||
      document.querySelector('input[placeholder*="Search or enter" i]') ||
      document.querySelector('input[aria-label*="enter your own" i]') ||
      document.querySelector('input[aria-label*="Search" i]:not([name="title"]):not([name="keywords"])') ||
      document.querySelector('[class*="filter-menu"] input');

    if (!searchInput) {
      console.log('[DropFlow] Brand search input not found after opening dropdown');
      return false;
    }

    // Step 4: Type the brand name
    searchInput.focus();
    await sleep(200);
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);

    // Use native setter for React
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeSetter) nativeSetter.call(searchInput, brand);
    else searchInput.value = brand;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
    }));
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));

    console.log(`[DropFlow] Typed Brand: "${brand}"`);
    await sleep(1500);

    // Step 5: Click matching option from the dropdown list
    const options = document.querySelectorAll(
      '[role="option"], [class*="filter-menu__item"], [class*="filter-menu"] li, ' +
      '[class*="listbox"] li'
    );
    let brandSelected = false;
    for (const opt of options) {
      const optText = opt.textContent.trim();
      if (normalize(optText) === normalize(brand) ||
          optText.toLowerCase() === brand.toLowerCase()) {
        simulateClick(opt);
        console.log(`[DropFlow] Selected Brand: "${optText}"`);
        brandSelected = true;
        await sleep(800);
        break;
      }
    }

    if (!brandSelected) {
      // No exact match â€" press Enter to accept typed value, then Tab to commit
      searchInput.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
      }));
      searchInput.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
      }));
      await sleep(500);
      console.log(`[DropFlow] Brand typed (no exact match in list): "${brand}"`);
    }

    // Step 6: Commit the brand selection â€" blur input and click outside
    searchInput.dispatchEvent(new FocusEvent('blur', { bubbles: true, relatedTarget: null }));
    await sleep(300);

    // Click a "Done" or "Apply" button if one appeared
    const doneBtn = Array.from(document.querySelectorAll('button'))
      .find(b => {
        const text = b.textContent.trim().toLowerCase();
        return (text === 'done' || text === 'apply') && b.offsetParent !== null;
      });
    if (doneBtn) {
      simulateClick(doneBtn);
      console.log(`[DropFlow] Clicked "${doneBtn.textContent.trim()}" to confirm brand`);
      await sleep(500);
    }

    // Dismiss the dropdown by clicking outside the brand section entirely
    document.body.click();
    await sleep(300);
    // Click a neutral area (the title section) to ensure React commits
    const neutralArea = document.querySelector('.smry.summary__title') ||
                        document.querySelector('[class*="summary__title"]') ||
                        document.querySelector('header');
    if (neutralArea) {
      simulateClick(neutralArea);
    }
    await sleep(500);

    console.log(`[DropFlow] Brand commit complete: "${brand}"`);
    return true;
  }

  /**
   * Fill any item specific dropdown by its label text.
   * Uses the same direct label-finding + walk-up approach as fillBrand.
   * Works for Type, Material, Style, etc. â€" any eBay item specific dropdown.
   */
  async function fillSpecificByLabel(labelText, value) {
    console.log(`[DropFlow] === FILLING SPECIFIC BY LABEL: "${labelText}" = "${value}" ===`);

    // Step 1: Find the label element on the page
    let labelEl = null;
    const candidates = document.querySelectorAll('a, button, span, label');
    for (const el of candidates) {
      if (el.textContent.trim() === labelText && el.offsetParent !== null) {
        // Skip elements inside dropdowns/listboxes
        if (el.closest('[role="listbox"], [role="option"], [class*="listbox"]')) continue;
        labelEl = el;
        break;
      }
    }

    if (!labelEl) {
      console.log(`[DropFlow] Label "${labelText}" not found on page`);
      return false;
    }

    await scrollToAndWait(labelEl, 500);

    // Step 2: Walk up from label to find the dropdown trigger (same logic as fillBrand)
    let dropdownClicked = false;
    let parent = labelEl.parentElement;
    for (let i = 0; i < 8 && parent && parent !== document.body; i++) {
      const trigger = parent.querySelector(
        '[aria-expanded], [role="combobox"], [aria-haspopup="listbox"]'
      );
      if (trigger && trigger !== labelEl) {
        trigger.click();
        console.log(`[DropFlow] Clicked "${labelText}" dropdown trigger: <${trigger.tagName}>`);
        dropdownClicked = true;
        break;
      }

      const svgs = parent.querySelectorAll('svg');
      for (const svg of svgs) {
        const svgParent = svg.closest('button') || svg.closest('[role="combobox"]') ||
                          svg.closest('[tabindex]') || svg.parentElement;
        if (svgParent && svgParent !== parent && svgParent.offsetParent !== null) {
          svgParent.click();
          console.log(`[DropFlow] Clicked "${labelText}" chevron: <${svgParent.tagName}>`);
          dropdownClicked = true;
          break;
        }
      }
      if (dropdownClicked) break;
      parent = parent.parentElement;
    }

    if (!dropdownClicked) {
      labelEl.click();
      console.log(`[DropFlow] Clicked "${labelText}" label as fallback`);
    }

    await sleep(1500);

    // Step 3: Try to find a VISIBLE search input for the currently-open dropdown.
    // IMPORTANT: must filter to visible only â€" Brand's search input may still exist
    // in the DOM from earlier, and querySelector would find it first (earlier in DOM order).
    function findVisibleInput(selector) {
      const all = document.querySelectorAll(selector);
      for (const el of all) {
        if (el.offsetParent !== null && el.getBoundingClientRect().height > 0) return el;
      }
      return null;
    }
    const searchInput =
      findVisibleInput('input[placeholder*="enter your own" i]') ||
      findVisibleInput('input[placeholder*="Search or enter" i]') ||
      findVisibleInput('input[aria-label*="enter your own" i]') ||
      findVisibleInput('[class*="filter-menu"] input');

    if (searchInput) {
      // Searchable dropdown â€" type and select (same as fillBrand)
      console.log(`[DropFlow] "${labelText}" found visible search input: placeholder="${searchInput.placeholder}", rect=${JSON.stringify(searchInput.getBoundingClientRect().toJSON())}`);
      searchInput.focus();
      await sleep(200);
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(200);

      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      if (nativeSetter) nativeSetter.call(searchInput, value);
      else searchInput.value = value;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
      }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));

      console.log(`[DropFlow] Typed "${labelText}": "${value}"`);
      await sleep(1500);

      // Click matching option
      const options = document.querySelectorAll(
        '[role="option"], [class*="filter-menu__item"], [class*="filter-menu"] li, ' +
        '[class*="listbox"] li'
      );
      let selected = false;
      for (const opt of options) {
        const optText = opt.textContent.trim();
        if (normalize(optText) === normalize(value) ||
            optText.toLowerCase() === value.toLowerCase()) {
          simulateClick(opt);
          console.log(`[DropFlow] Selected "${labelText}": "${optText}"`);
          selected = true;
          await sleep(800);
          break;
        }
      }

      if (!selected) {
        searchInput.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
        }));
        await sleep(500);
        console.log(`[DropFlow] "${labelText}" typed (no exact match): "${value}"`);
      }

      searchInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      await sleep(300);
    } else {
      // Non-searchable dropdown â€" scan the open options list directly
      console.log(`[DropFlow] "${labelText}" has no search input, scanning options...`);
      const options = document.querySelectorAll(
        '[role="option"], [role="listbox"] li, [class*="listbox"] li, ' +
        '[class*="menu-item"], [class*="filter-menu__item"], [class*="option"]'
      );
      console.log(`[DropFlow] Found ${options.length} options for "${labelText}"`);

      let selected = false;
      // First pass: exact match
      for (const opt of options) {
        const optText = opt.textContent.trim();
        if (normalize(optText) === normalize(value)) {
          simulateClick(opt);
          console.log(`[DropFlow] Selected "${labelText}": "${optText}" (exact match)`);
          selected = true;
          await sleep(800);
          break;
        }
      }
      // Second pass: partial/includes match
      if (!selected) {
        for (const opt of options) {
          const optText = opt.textContent.trim();
          if (optText.toLowerCase().includes(value.toLowerCase()) ||
              value.toLowerCase().includes(optText.toLowerCase())) {
            simulateClick(opt);
            console.log(`[DropFlow] Selected "${labelText}": "${optText}" (partial match for "${value}")`);
            selected = true;
            await sleep(800);
            break;
          }
        }
      }

      if (!selected) {
        console.warn(`[DropFlow] No option matched "${value}" for "${labelText}" (${options.length} options scanned)`);
      }
    }

    // Step 4: Commit â€" click Done/Apply if present, then click outside
    const doneBtn = Array.from(document.querySelectorAll('button'))
      .find(b => {
        const text = b.textContent.trim().toLowerCase();
        return (text === 'done' || text === 'apply') && b.offsetParent !== null;
      });
    if (doneBtn) {
      simulateClick(doneBtn);
      console.log(`[DropFlow] Clicked "${doneBtn.textContent.trim()}" to confirm "${labelText}"`);
      await sleep(500);
    }

    document.body.click();
    await sleep(300);
    const neutralArea = document.querySelector('.smry.summary__title') ||
                        document.querySelector('[class*="summary__title"]') ||
                        document.querySelector('header');
    if (neutralArea) simulateClick(neutralArea);
    await sleep(500);

    console.log(`[DropFlow] "${labelText}" commit complete: "${value}"`);
    return true;
  }

  /**
   * Enumerate all required item specifics from the eBay listing form DOM.
   * eBay has two sections: "Required" and "Additional (optional)".
   * We ONLY want the required section â€" skip anything marked optional/additional.
   * Returns an array of { label, row } objects.
   */
  function enumerateRequiredSpecifics() {
    const sections = document.querySelectorAll(
      '.summary__attributes--section-container, [class*="attributes--section-container"]'
    );

    if (sections.length === 0) {
      console.log('[DropFlow] No item specifics sections found on page');
      return [];
    }

    // Find the REQUIRED section by checking each section's header text.
    // Skip sections whose header contains "optional", "additional", or "buyers also search".
    let requiredSection = null;
    for (const section of sections) {
      const header = section.querySelector('h2, h3, h4, [class*="header"], [class*="title"], legend, strong');
      const headerText = header ? header.textContent.trim().toLowerCase() : '';
      const sectionText = section.textContent.substring(0, 200).toLowerCase();

      if (sectionText.includes('optional') || sectionText.includes('additional') ||
          sectionText.includes('buyers also search')) {
        console.log(`[DropFlow] Skipping optional specifics section: "${headerText}"`);
        continue;
      }

      // This section doesn't say optional â€" treat it as required
      requiredSection = section;
      console.log(`[DropFlow] Found required specifics section: "${headerText}"`);
      break;
    }

    if (!requiredSection) {
      console.log('[DropFlow] No required item specifics section found (all sections are optional)');
      return [];
    }

    // --- Label-first approach ---
    // eBay's item specifics labels are short, clickable text elements (e.g. "Brand", "Type").
    // The dropdowns ALSO contain text like "SelectedList of selected values" which we must skip.
    // Strategy: scan ALL candidate label elements in the required section, filter to real labels,
    // then map each to its containing row.
    const JUNK_PATTERNS = /selectedlist|selected values|select|choose|enter your|search or|show more|add your/i;
    const fields = [];
    const seenLabels = new Map();

    // Scan for real field name labels â€" these are typically <a> or <button> elements
    // with short text that acts as the field identifier
    const labelCandidates = requiredSection.querySelectorAll('a, button, label, legend, span');
    for (const el of labelCandidates) {
      const text = el.textContent.trim();

      // Must be visible, short (real labels are 1-30 chars), and not junk/duplicate
      if (!text || text.length < 2 || text.length > 40) continue;
      if (el.offsetParent === null) continue;                    // Hidden
      if (JUNK_PATTERNS.test(text)) continue;                    // Dropdown inner text
      if (/^(required|add|optional|show|hide|\d+|~)/i.test(text)) continue;  // Section headers, counters
      if (text.includes('searches') || text.includes('Trending') || text.includes('Frequently')) continue;

      // The element should not be INSIDE a dropdown/combobox/listbox
      if (el.closest('[role="listbox"], [role="combobox"], [role="option"], [class*="listbox"], [class*="filter-menu"]')) continue;

      // Check it's not a child of another label we already found (avoid double-counting
      // e.g. <a><span>Brand</span></a> where both <a> and <span> match)
      let isChild = false;
      for (const [, existing] of seenLabels) {
        if (existing.contains(el) || el.contains(existing)) { isChild = true; break; }
      }
      if (isChild) continue;

      // Find the row container for this label
      const row = findRowContainer(el);
      if (!row) continue;

      // Deduplicate by label text
      if (seenLabels.has(text)) continue;
      seenLabels.set(text, el);
      fields.push({ label: text, row });
    }

    // Fallback: if the label-first approach found nothing, try the row-first approach
    // with stricter label filtering
    if (fields.length === 0) {
      const rows = requiredSection.querySelectorAll(
        'fieldset, [class*="field"], [class*="attribute"], [class*="aspect"]'
      );
      for (const row of rows) {
        // Try ALL candidate labels in the row, pick the first that isn't junk
        const candidates = row.querySelectorAll('label, legend, a, button, span');
        for (const labelEl of candidates) {
          const label = labelEl.textContent.trim();
          if (!label || label.length < 2 || label.length > 40) continue;
          if (JUNK_PATTERNS.test(label)) continue;
          if (/^(required|add|optional|show|hide|\d+|~)/i.test(label)) continue;
          if (labelEl.closest('[role="listbox"], [role="combobox"], [role="option"]')) continue;
          if (labelEl.offsetParent === null) continue;

          const exists = fields.some(f => f.label === label);
          if (!exists) fields.push({ label, row });
          break; // Take the first valid label per row
        }
      }
    }

    console.log(`[DropFlow] Found ${fields.length} required item specifics:`,
      fields.map(f => f.label));
    return fields;
  }

  /**
   * Fill ALL required item specifics using AI-generated values + DOM interaction.
   * Falls back to direct API PUT for fields that DOM filling can't handle.
   */
  async function fillItemSpecifics(productData, ebayContext, skipLabels = []) {
    console.log('[DropFlow] === FILLING ITEM SPECIFICS ===');
    if (skipLabels.length > 0) {
      console.log(`[DropFlow] Skipping variation axis labels: [${skipLabels.join(', ')}]`);
    }

    // Step 1: Scroll to item specifics section to ensure it's loaded.
    // Retry up to 5 times â€" eBay lazy-loads this section and it may not be in the DOM yet
    // (especially when images upload fast with pre-downloaded data).
    let requiredFields = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      const specificsSection = document.querySelector(
        '.summary__attributes--section-container, [class*="attributes--section"]'
      );
      if (specificsSection) {
        await scrollToAndWait(specificsSection, 1000);
      } else {
        // Section not in DOM yet â€" scroll page to trigger lazy loading
        console.log(`[DropFlow] Item specifics section not in DOM, scrolling to trigger load (attempt ${attempt}/5)...`);
        await scrollPageToLoadAll();
        await sleep(1000);
      }

      // Step 2: Enumerate all required fields from the DOM
      requiredFields = enumerateRequiredSpecifics();
      if (requiredFields.length > 0) break;

      console.log(`[DropFlow] No required item specifics found (attempt ${attempt}/5), waiting...`);
      await sleep(2000);
    }

    if (requiredFields.length === 0) {
      console.log('[DropFlow] No required item specifics found after 5 attempts');
      return false;
    }

    const fieldLabels = requiredFields.map(f => f.label);

    // Step 3: Get AI-suggested values for all required fields
    let aiValues = {};
    try {
      const resp = await sendMessageSafe({
          type: 'GENERATE_ITEM_SPECIFICS',
          requiredFields: fieldLabels,
          productData: {
            title: productData.ebayTitle || productData.title || '',
            description: productData.description || productData.aiDescription || '',
            bulletPoints: productData.bulletPoints || []
          }
        }, 30000);
      if (resp && resp.success && resp.specifics) {
        aiValues = resp.specifics;
        console.log('[DropFlow] AI item specifics received:', aiValues);
      }
    } catch (e) {
      console.warn('[DropFlow] AI item specifics generation failed:', e.message);
    }

    // Step 4: Override Brand with extracted value if available.
    // extractBrand uses scraper data (most reliable) > bulletPoints > title patterns.
    // For AliExpress, it returns the actual brand or "Unbranded" as fallback.
    // Only override AI if extractBrand returned something concrete â€" if it's "Unbranded"
    // and the AI found an actual brand name, prefer the AI's answer.
    const extractedBrand = extractBrand(productData);
    if (extractedBrand) {
      const aiBrand = aiValues['Brand'] || '';
      const isGenericFallback = /^(unbranded|generic|details in description)$/i.test(extractedBrand);
      const aiHasRealBrand = aiBrand && !/^(unbranded|generic|details in description|n\/a|none|not specified|does not apply)$/i.test(aiBrand);

      if (isGenericFallback && aiHasRealBrand) {
        // AI found a real brand from the text â€" keep it
        console.log(`[DropFlow] Keeping AI brand "${aiBrand}" over fallback "${extractedBrand}"`);
      } else {
        aiValues['Brand'] = extractedBrand;
      }
    }

    // Step 5: Build the full attributes map for ALL required fields
    // Skip labels that were already filled as multi-value variation axes
    const allAttributes = {};
    for (const { label } of requiredFields) {
      if (skipLabels.includes(label)) {
        console.log(`[DropFlow] Skipping "${label}" â€" already set as multi-value variation axis`);
        continue;
      }
      const value = aiValues[label] || 'Details in Description';
      allAttributes[label] = value;
    }

    // Ensure Brand is never empty â€" use "Unbranded" as absolute last resort
    if (allAttributes['Brand'] && /^(details in description|generic|n\/a|none|not specified|does not apply)$/i.test(allAttributes['Brand'])) {
      allAttributes['Brand'] = 'Unbranded';
      console.log('[DropFlow] Brand fallback to "Unbranded"');
    }

    // Country of Origin: default to "China" for AliExpress-sourced listings.
    // eBay AU often requires this field. Set it if present in required fields,
    // or add it proactively â€" the API PUT will apply it regardless.
    const countryKey = Object.keys(allAttributes).find(k => /country.*origin/i.test(k));
    if (countryKey) {
      if (/^(details in description|n\/a|none|not specified|does not apply)$/i.test(allAttributes[countryKey])) {
        allAttributes[countryKey] = 'China';
        console.log(`[DropFlow] Country of Origin defaulted to "China" (field: "${countryKey}")`);
      }
    } else {
      // Field wasn't in required list â€" add it so the API PUT sets it anyway
      allAttributes['Country/Region of Manufacture'] = 'China';
      console.log('[DropFlow] Country/Region of Manufacture added as "China" (AliExpress source)');
    }

    console.log('[DropFlow] All required item specifics to fill:', allAttributes);

    // Step 6: API PUT first (most reliable â€" bypasses eBay's React DOM entirely)
    // Send ONE attribute per PUT call (eBay's API works best this way)
    let apiPutSuccess = false;
    // Ensure we have a draftId (fall back to URL extraction)
    if (ebayContext && !ebayContext.draftId) {
      ebayContext.draftId = extractDraftIdFromUrl();
    }
    if (ebayContext && ebayContext.draftId) {
      let putCount = 0;
      for (const [label, value] of Object.entries(allAttributes)) {
        const attributes = { [label]: [value] };
        console.log(`[DropFlow] API PUT item specific: "${label}" = "${value}"`);
        const ok = await putDraftField({ attributes }, ebayContext);
        if (ok) {
          putCount++;
        } else {
          console.warn(`[DropFlow] API PUT failed for "${label}"`);
        }
        await sleep(300); // Brief pause between API calls
      }
      apiPutSuccess = putCount > 0;
      console.log(`[DropFlow] Item specifics API PUT: ${putCount}/${Object.keys(allAttributes).length} succeeded`);
    }

    // Step 7: Also try DOM filling (for visual feedback and fields API PUT missed).
    // IMPORTANT: eBay's React re-renders item specifics after each field is filled,
    // which detaches previously-cached row elements from the live DOM.
    // We must re-locate each row FRESH right before filling it.
    const filled = {};
    const failed = {};

    for (const { label } of requiredFields) {
      if (skipLabels.includes(label)) continue; // Already set as variation axis
      const value = allAttributes[label];
      try {
        let success;
        if (label === 'Brand') {
          // Brand has its own specialized handler
          success = await fillBrand(value);
        } else {
          // All other item specifics: use the generic label-based dropdown filler.
          // This finds the label fresh in the live DOM (immune to React re-renders)
          // and uses the same walk-up + click pattern as fillBrand.
          success = await fillSpecificByLabel(label, value);
        }
        if (success) {
          filled[label] = value;
        } else {
          failed[label] = value;
        }
      } catch (e) {
        failed[label] = value;
        console.warn(`[DropFlow] DOM fill error for "${label}":`, e.message);
      }
      await sleep(500);
    }

    const totalFilled = Object.keys(filled).length + (apiPutSuccess ? Object.keys(failed).length : 0);
    console.log(`[DropFlow] Item specifics: ${totalFilled} filled (API PUT: ${apiPutSuccess}, DOM: ${Object.keys(filled).length}/${requiredFields.length})`);

    return apiPutSuccess || totalFilled > 0;
  }

  /**
   * Build an HTML description for eBay listing.
   */
  function buildDescription(productData) {
    const { title, description, bulletPoints, images } = productData;

    let html = `<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">`;
    html += `<h2 style="color: #333;">${escapeHtml(title || '')}</h2>`;

    if (bulletPoints && bulletPoints.length > 0) {
      html += `<h3 style="color: #555;">Key Features</h3><ul>`;
      for (const point of bulletPoints) {
        html += `<li style="margin-bottom: 6px;">${escapeHtml(point)}</li>`;
      }
      html += `</ul>`;
    }

    if (description) {
      html += `<h3 style="color: #555;">Description</h3>`;
      html += `<p>${escapeHtml(description)}</p>`;
    }

    html += `</div>`;
    return html;
  }

  /**
   * Build a plain text description.
   */
  function buildDescriptionText(productData) {
    const parts = [productData.title || ''];
    if (productData.bulletPoints?.length) {
      parts.push('\nKey Features:');
      productData.bulletPoints.forEach(p => parts.push(`- ${p}`));
    }
    if (productData.description) {
      parts.push('\nDescription:');
      parts.push(productData.description);
    }
    return parts.join('\n');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Convert a base64 data URL to a File object.
   */
  function dataUrlToFile(dataUrl, filename) {
    const [header, base64] = dataUrl.split(',');
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], filename, { type: mime });
  }

  /**
   * Find the eBay photos section container.
   */
  function findPhotosSection() {
    // eBay uses various class names for the photos section
    const selectors = [
      '.uploader-thumbnails',
      '[class*="uploader-thumbnails"]',
      '[class*="uploader-ui"]',
      '.summary__photos',
      '[class*="summary__photos"]',
      '[class*="photo-upload"]',
      '[class*="photos-container"]',
      '[class*="image-upload"]',
      '[data-testid="photos"]',
      '[data-testid="image-upload"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    // Broad fallback: look for a section containing "Photos" or "Photo" text
    const headers = document.querySelectorAll('h2, h3, h4, legend, strong, [class*="header"]');
    for (const h of headers) {
      const text = h.textContent.trim().toLowerCase();
      if (text === 'photos' || text === 'photo' || text.includes('add photos') || text.includes('upload')) {
        // Return the parent section
        const section = h.closest('section, [class*="section"], [class*="container"], div[class]');
        if (section) return section;
      }
    }
    return null;
  }

  /**
   * Find the file input for image upload on eBay's form.
   * Clicks the upload area first to ensure the input is active/visible.
   */
  async function activateAndFindFileInput() {
    // Step 1: Find and scroll to the photos section
    const photoSection = findPhotosSection();
    if (photoSection) {
      await scrollToAndWait(photoSection, 800);
      console.log('[DropFlow] Scrolled to photos section');
    } else {
      console.warn('[DropFlow] Photos section not found, scrolling to top...');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await sleep(500);
    }

    // Step 2: Try to find file input directly first
    let fileInput = findFileInput();
    if (fileInput) {
      console.log('[DropFlow] File input found immediately');
      return fileInput;
    }

    // Step 3: Click the upload area to activate/reveal the file input
    // eBay shows "Add photos" placeholder buttons that create file inputs on click
    const clickTargets = [
      // Specific eBay upload triggers
      'button[class*="photo"]', 'button[class*="upload"]',
      '[class*="add-photo"]', '[class*="addPhoto"]',
      '[class*="photo-slot"]', '[class*="photoSlot"]',
      '[class*="upload-btn"]', '[class*="uploadBtn"]',
      // Generic upload area containers
      '[class*="photo"] [role="button"]',
      '[class*="photo"] button',
      // The upload area itself (often clickable)
      '[class*="photo-upload"]', '[class*="image-upload"]',
      '[class*="dropzone"]', '[class*="upload-area"]'
    ];

    for (const sel of clickTargets) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        console.log(`[DropFlow] Clicking upload trigger: ${sel}`);
        simulateClick(el);
        await sleep(1000);
        fileInput = findFileInput();
        if (fileInput) return fileInput;
      }
    }

    // Step 4: If still no file input, try clicking any element in the photos section
    // that looks clickable
    if (photoSection) {
      const clickables = photoSection.querySelectorAll(
        'button, [role="button"], [tabindex], a, [class*="slot"], [class*="add"], [class*="upload"]'
      );
      for (const el of clickables) {
        if (el.offsetParent !== null && !el.querySelector('img[src]')) {
          // Click empty slots (don't click ones that already have images)
          console.log(`[DropFlow] Clicking photo slot: <${el.tagName} class="${(el.className || '').substring(0, 40)}">`);
          simulateClick(el);
          await sleep(800);
          fileInput = findFileInput();
          if (fileInput) return fileInput;
        }
      }
    }

    console.warn('[DropFlow] Could not find or activate file input');
    return null;
  }

  /**
   * Find a file input element on the page.
   */
  function findFileInput() {
    const photoSection = findPhotosSection();
    const candidates = Array.from(document.querySelectorAll('input[type="file"]'));
    if (!candidates.length) return null;

    const looksLikeImageInput = (input) => {
      const accept = String(input.getAttribute('accept') || '').toLowerCase();
      const attrs = `${accept} ${input.id || ''} ${input.name || ''} ${input.className || ''}`.toLowerCase();
      return /image|jpg|jpeg|png|webp|photo|uploader|fehelix/.test(attrs);
    };

    const inPhotoSection = (input) => {
      if (!photoSection) return false;
      return photoSection.contains(input) || !!input.closest('[class*="photo"], [class*="image"], [class*="upload"], [data-testid*="image"], [data-testid*="photo"]');
    };

    const scoreInput = (input) => {
      let score = 0;
      const accept = String(input.getAttribute('accept') || '').toLowerCase();
      if ((input.id || '').toLowerCase().includes('fehelix-uploader')) score += 100;
      if (/image/.test(accept)) score += 30;
      if (/jpg|jpeg|png|webp/.test(accept)) score += 15;
      if (input.multiple) score += 10;
      if (inPhotoSection(input)) score += 25;
      if (looksLikeImageInput(input)) score += 10;
      if (isElementVisible(input)) score += 5;
      return score;
    };

    const best = candidates
      .map(input => ({ input, score: scoreInput(input) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)[0];

    return best ? best.input : null;
  }

  /**
   * Download images and upload to eBay's form.
   * Uses pre-downloaded base64 data if available (AliExpress flow),
   * falls back to FETCH_IMAGE via service worker (Amazon flow).
   * Then tries 4 upload methods: file input, drag-and-drop, eBay media API, draft API PUT.
   * Returns true if at least one image was uploaded.
   */
  async function uploadImages(imageUrls, ebayContext, preDownloadedImages) {
    const files = [];
    const maxImages = Math.min(imageUrls.length, 12); // eBay allows up to 12

    // Normalize and collect valid URLs
    const normalizedUrls = [];
    for (let i = 0; i < maxImages; i++) {
      const url = imageUrls[i];
      if (!url || (!url.startsWith('http') && !url.startsWith('//'))) continue;
      normalizedUrls.push(url.startsWith('//') ? 'https:' + url : url);
    }

    // Check if we have pre-downloaded base64 images (AliExpress content script pre-downloads these)
    const hasPreDownloaded = Array.isArray(preDownloadedImages) && preDownloadedImages.some(d => d !== null);
    if (hasPreDownloaded) {
      console.log(`[DropFlow] Using pre-downloaded images (bypassing FETCH_IMAGE)`);
    } else {
      console.log(`[DropFlow] No pre-downloaded images, using FETCH_IMAGE for ${normalizedUrls.length} URLs`);
    }

    const sourceCount = Math.min(
      maxImages,
      Math.max(normalizedUrls.length, hasPreDownloaded ? preDownloadedImages.length : 0)
    );

    for (let i = 0; i < sourceCount; i++) {
      try {
        let dataUrl = null;

        // Priority 1: Use pre-downloaded base64 data (AliExpress flow)
        if (hasPreDownloaded && i < preDownloadedImages.length && preDownloadedImages[i]) {
          dataUrl = preDownloadedImages[i];
          console.log(`[DropFlow] Image ${i + 1}: using pre-downloaded data (${Math.round(dataUrl.length / 1024)}KB)`);
        } else if (normalizedUrls[i]) {
          // Priority 2: Fetch via service worker (Amazon flow, or AliExpress fallback)
          const response = await sendMessageSafe({
            type: 'FETCH_IMAGE',
            url: normalizedUrls[i]
          }, 15000);
          if (response && response.success && response.dataUrl) {
            dataUrl = response.dataUrl;
            console.log(`[DropFlow] Image ${i + 1}: fetched via service worker (${Math.round(dataUrl.length / 1024)}KB)`);
          } else {
            console.warn(`[DropFlow] Image ${i + 1}: FETCH_IMAGE failed:`, response?.error);
          }
        }

        if (dataUrl) {
          const file = dataUrlToFile(dataUrl, `product-image-${i + 1}.jpg`);
          files.push(file);
        }
      } catch (e) {
        console.warn(`[DropFlow] Error processing image ${i + 1}:`, e.message);
      }
    }

    if (files.length === 0) {
      console.warn('[DropFlow] No images available â€" trying draft API PUT with URLs...');
      if (ebayContext && normalizedUrls.length > 0) {
        return await uploadViaDraftApiPut(normalizedUrls, ebayContext);
      }
      return false;
    }

    console.log(`[DropFlow] ${files.length} images ready, attempting upload...`);

    // ===== Method 0 (PREFERRED): Direct Helix uploader =====
    // eBay's Helix photo framework uses window.sellingUIUploader to handle uploads.
    // On listings with variations, the file input only accepts video, so we bypass
    // the input entirely and call uploadFiles() directly with a corrected config.
    const helixSuccess = await uploadViaHelixUploader(files);
    if (helixSuccess) {
      console.log('[DropFlow] Method 0 SUCCESS: Helix uploader direct upload');
      return true;
    }
    console.warn('[DropFlow] Method 0 FAILED: Helix uploader, trying fallbacks...');

    // Scroll to photos section first to ensure it's loaded/visible
    const photoSection = findPhotosSection();
    if (photoSection) {
      await scrollToAndWait(photoSection, 1000);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await sleep(1000);
    }

    // ===== Method 1: File input upload (standard approach) =====
    const fileInputSuccess = await uploadViaFileInput(files);
    if (fileInputSuccess) {
      console.log('[DropFlow] Method 1 SUCCESS: file input upload');
      return true;
    }
    console.warn('[DropFlow] Method 1 FAILED: file input');

    // ===== Method 2: Drag-and-drop =====
    const dragSuccess = await uploadViaDragDrop(files);
    if (dragSuccess) {
      console.log('[DropFlow] Method 2 SUCCESS: drag-and-drop');
      return true;
    }
    console.warn('[DropFlow] Method 2 FAILED: drag-and-drop');

    // ===== Method 3: Upload to eBay's media service (same-origin POST) =====
    if (ebayContext && ebayContext.headers) {
      const mediaSuccess = await uploadViaEbayMediaApi(files, ebayContext);
      if (mediaSuccess) {
        console.log('[DropFlow] Method 3 SUCCESS: eBay media API upload');
        return true;
      }
      console.warn('[DropFlow] Method 3 FAILED: eBay media API');
    }

    // ===== Method 4: PUT external image URLs directly to draft API =====
    if (ebayContext && normalizedUrls.length > 0) {
      const putSuccess = await uploadViaDraftApiPut(normalizedUrls, ebayContext);
      if (putSuccess) {
        console.log('[DropFlow] Method 4 SUCCESS: draft API PUT with URLs');
        return true;
      }
      console.warn('[DropFlow] Method 4 FAILED: draft API PUT');
    }

    // ===== Method 5: Direct EPS upload via XHR =====
    const epsSuccess = await uploadViaEpsDirect(files);
    if (epsSuccess) {
      console.log('[DropFlow] Method 5 SUCCESS: direct EPS upload');
      return true;
    }
    console.warn('[DropFlow] Method 5 FAILED: direct EPS');

    // ===== Method 6: EPS upload + Draft API PUT with eBay-hosted URLs =====
    // For MSKU listings where Helix uploader rejects images (video-only config),
    // upload images to EPS to get eBay-hosted URLs, then PUT those to the draft.
    if (ebayContext && ebayContext.draftId) {
      try {
        const epsUrls = await uploadFilesToEpsForUrls(files);
        if (epsUrls.length > 0) {
          const putOk = await putDraftField({ pictures: { pictureUrl: epsUrls } }, ebayContext);
          if (putOk) {
            console.log(`[DropFlow] Method 6 SUCCESS: EPS upload + draft PUT (${epsUrls.length} images)`);
            return true;
          }
        }
      } catch (e) {
        console.warn('[DropFlow] Method 6 FAILED:', e.message);
      }
    }

    console.warn('[DropFlow] ALL image upload methods failed');
    return false;
  }

  /**
   * Method 0 (PREFERRED): Upload images via eBay's Helix sellingUIUploader.
   * This bypasses the file input's accept restrictions (which on variation listings
   * only allows video) and calls the uploader's uploadFiles() directly with a
   * config that accepts images. This is the most reliable method.
   */
  async function uploadViaHelixUploader(files) {
    // The Helix uploader (window.sellingUIUploader) lives in the MAIN world.
    // Content scripts run in an isolated world and cannot access it directly.
    // We inject a <script> tag into the page to bridge the gap.

    // First, convert files to base64 data URLs for passing through the bridge
    const fileDataArr = [];
    for (const file of files) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(file);
      });
      fileDataArr.push({ dataUrl, name: file.name, type: file.type || 'image/jpeg' });
    }

    // Generate a unique callback ID for this upload batch
    const callbackId = '__dropflow_helix_' + Date.now();

    // Create a promise that resolves when the main-world script posts results
    const resultPromise = new Promise((resolve) => {
      const handler = (event) => {
        if (event.data && event.data.type === callbackId) {
          window.removeEventListener('message', handler);
          resolve(event.data);
        }
      };
      window.addEventListener('message', handler);
      // Timeout after 60s
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({ success: false, error: 'timeout' });
      }, 60000);
    });

    // Inject the upload function into the MAIN world via chrome.scripting (CSP-safe, no inline script).
    await chrome.runtime.sendMessage({ type: 'EXECUTE_MAIN_WORLD_HELIX', callbackId, fileDataArr });

    console.log(`[DropFlow] Helix: dispatched main-world upload for ${files.length} images...`);

    const result = await resultPromise;
    if (result.success) {
      console.log(`[DropFlow] Helix: main-world upload succeeded, ${result.uploadedCount} images uploaded`);
      return true;
    } else {
      console.warn(`[DropFlow] Helix: main-world upload failed: ${result.error}`);
      return false;
    }
  }

  /**
   * Count uploaded photos by checking the eBay draft API.
   * More reliable than DOM-based counting since the Helix framework
   * may not render photo thumbnails in the main form.
   */
  function countUploadedPhotosFromDraft() {
    // Synchronous check — look for photo thumbnails in the DOM first
    const draftCount = countUploadedImages();
    if (draftCount > 0) return draftCount;

    // Fallback: check the Helix uploader's internal state via main-world access
    // Note: window.sellingUIUploader is not accessible from content script isolated world
    return 0;
  }

  /**
   * Method 5: Upload images directly to eBay EPS (Picture Services) via XHR.
   * Extracts EPS authentication tokens from the page's inline scripts and
   * uploads each image to get an eBay-hosted URL. The Helix component
   * picks up the uploaded images automatically.
   */
  /**
   * Upload files to EPS and return the eBay-hosted image URLs (without Helix association).
   * Used by Method 6 to get URLs that can be PUT to the draft API.
   */
  async function uploadFilesToEpsForUrls(files) {
    let uaek, uaes;
    const scripts = document.querySelectorAll('script:not([src])');
    for (const s of scripts) {
      const match = s.textContent.match(/"uaek":"(\d+)","uaes":"([^"]+)"/);
      if (match) { uaek = match[1]; uaes = match[2]; break; }
    }
    if (!uaek || !uaes) return [];

    const urls = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const url = await new Promise((resolve, reject) => {
          const fd = new FormData();
          fd.append('file', files[i]);
          fd.append('s', 'SuperSize');
          fd.append('n', 'i');
          fd.append('v', '2');
          fd.append('aXRequest', '2');
          fd.append('uaek', uaek);
          fd.append('uaes', uaes);
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/image/upload/eBayISAPI.dll?EpsBasic', true);
          xhr.withCredentials = true;
          xhr.timeout = 30000;
          xhr.onload = () => {
            const text = xhr.responseText;
            if (text.startsWith('VERSION:')) resolve(text.split(';')[1]);
            else reject(new Error('EPS: ' + text.substring(0, 80)));
          };
          xhr.onerror = () => reject(new Error('XHR error'));
          xhr.ontimeout = () => reject(new Error('timeout'));
          xhr.send(fd);
        });
        urls.push(url);
        console.log(`[DropFlow] EPS URL ${i + 1}/${files.length}: ${url.substring(0, 60)}`);
      } catch (e) {
        console.warn(`[DropFlow] EPS URL ${i + 1} failed:`, e.message);
      }
    }
    return urls;
  }

  async function uploadViaEpsDirect(files) {
    // Extract EPS config from page scripts
    let uaek, uaes;
    const scripts = document.querySelectorAll('script:not([src])');
    for (const s of scripts) {
      const text = s.textContent;
      const match = text.match(/"uaek":"(\d+)","uaes":"([^"]+)"/);
      if (match) {
        uaek = match[1];
        uaes = match[2];
        break;
      }
    }

    if (!uaek || !uaes) {
      console.warn('[DropFlow] EPS direct: no EPS tokens found in page scripts');
      return false;
    }

    console.log(`[DropFlow] EPS direct: found tokens, uploading ${files.length} images...`);
    const uploadedUrls = [];

    for (let i = 0; i < files.length; i++) {
      try {
        const epsUrl = await new Promise((resolve, reject) => {
          const fd = new FormData();
          fd.append('file', files[i]);
          fd.append('s', 'SuperSize');
          fd.append('n', 'i');
          fd.append('v', '2');
          fd.append('aXRequest', '2');
          fd.append('uaek', uaek);
          fd.append('uaes', uaes);

          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/image/upload/eBayISAPI.dll?EpsBasic', true);
          xhr.withCredentials = true;
          xhr.timeout = 30000;
          xhr.onload = () => {
            const text = xhr.responseText;
            if (text.startsWith('VERSION:')) {
              resolve(text.split(';')[1]);
            } else {
              reject(new Error('EPS response: ' + text.substring(0, 100)));
            }
          };
          xhr.onerror = () => reject(new Error('XHR error'));
          xhr.ontimeout = () => reject(new Error('timeout'));
          xhr.send(fd);
        });

        uploadedUrls.push(epsUrl);
        console.log(`[DropFlow] EPS direct: image ${i + 1}/${files.length} uploaded: ${epsUrl.substring(0, 60)}`);
      } catch (e) {
        console.warn(`[DropFlow] EPS direct: image ${i + 1} failed:`, e.message);
      }
    }

    if (uploadedUrls.length === 0) return false;

    // Try to feed the EPS URLs back through the Helix uploader via main-world injection
    const epsCallbackId = '__dropflow_eps_helix_' + Date.now();
    const epsResultPromise = new Promise((resolve) => {
      const handler = (event) => {
        if (event.data && event.data.type === epsCallbackId) {
          window.removeEventListener('message', handler);
          resolve(event.data);
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => { window.removeEventListener('message', handler); resolve({ success: false }); }, 15000);
    });

    // Inject the EPS URL association via chrome.scripting MAIN world (CSP-safe, no inline script).
    await chrome.runtime.sendMessage({ type: 'EXECUTE_MAIN_WORLD_EPS', callbackId: epsCallbackId, uploadedUrls });

    const epsResult = await epsResultPromise;
    if (epsResult.success) {
      await sleep(5000);
      console.log(`[DropFlow] EPS direct: ${uploadedUrls.length} images associated via Helix uploader`);
      return true;
    }

    // Helix association failed — return false so caller can try Method 6 (EPS + draft PUT)
    console.warn(`[DropFlow] EPS direct: Helix association failed, deferring to next method`);
    return false;
  }

  /**
   * Method 1: Upload images via hidden file input.
   * Finds (or activates) eBay's file input and sets files via DataTransfer.
   */
  async function uploadViaFileInput(files) {
    // Upload images ONE AT A TIME, polling for eBay's photo count to increase
    // after each upload before proceeding to the next (matches EcomSniper approach)
    let anyUploaded = false;
    let currentCount = countUploadedImages();

    for (let i = 0; i < files.length; i++) {
      try {
        // Re-find the file input each time (eBay may recreate it after each upload)
        const input = findFileInput();
        if (!input) {
          // Try activating the upload area
          const activatedInput = await activateAndFindFileInput();
          if (!activatedInput) {
            console.warn(`[DropFlow] Image ${i + 1}: could not find file input`);
            continue;
          }
        }
        const fileInput = findFileInput();
        if (!fileInput) continue;

        const dt = new DataTransfer();
        dt.items.add(files[i]);
        try { fileInput.focus(); } catch (_) {}
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));

        console.log(`[DropFlow] Image ${i + 1}/${files.length}: set on #${fileInput.id || 'file-input'}, polling for confirmation...`);

        // Poll until photo count increases (max 15 seconds per image)
        const uploaded = await pollForPhotoCountIncrease(currentCount, 15000);
        if (uploaded) {
          currentCount = countUploadedImages();
          anyUploaded = true;
          console.log(`[DropFlow] Image ${i + 1}/${files.length}: upload confirmed (total: ${currentCount})`);
        } else {
          console.warn(`[DropFlow] Image ${i + 1}/${files.length}: upload not confirmed after polling`);
        }

        // Brief pause between uploads
        await sleep(500);
      } catch (e) {
        console.warn(`[DropFlow] Image ${i + 1} upload error:`, e.message);
      }
    }

    return anyUploaded;
  }

  /**
   * Poll until eBay's photo count increases above expectedCount.
   * Returns true if count increased, false if timeout.
   */
  async function pollForPhotoCountIncrease(expectedCount, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(1000);
      const current = countUploadedImages();
      if (current > expectedCount) return true;
    }
    return false;
  }

  /**
   * Method 2: Upload images via drag-and-drop.
   */
  async function uploadViaDragDrop(files) {
    const dropTarget = findPhotosSection() ||
                       document.querySelector('[class*="photo"]') ||
                       document.querySelector('[class*="upload"]');

    if (!dropTarget) return false;

    try {
      await scrollToAndWait(dropTarget, 500);

      const beforeCount = countUploadedImages();

      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));

      // Full drag sequence with correct event options
      const rect = dropTarget.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const dragOpts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y };

      dropTarget.dispatchEvent(new DragEvent('dragenter', dragOpts));
      await sleep(200);
      dropTarget.dispatchEvent(new DragEvent('dragover', dragOpts));
      await sleep(200);
      dropTarget.dispatchEvent(new DragEvent('drop', dragOpts));
      await sleep(3000);

      const afterCount = countUploadedImages();
      if (afterCount > beforeCount) {
        console.log(`[DropFlow] Drag-and-drop confirmed: ${afterCount - beforeCount} images added`);
        return true;
      }

      console.warn(`[DropFlow] Drag-and-drop didn't add images (before: ${beforeCount}, after: ${afterCount})`);
      return false;
    } catch (e) {
      console.warn('[DropFlow] Drag-and-drop error:', e.message);
      return false;
    }
  }

  /**
   * Method 3: Upload images directly to eBay's media/image upload service.
   * This is a same-origin POST from the content script using captured auth headers.
   * After uploading, PUTs the resulting image IDs to the listing draft.
   */
  async function uploadViaEbayMediaApi(files, ebayContext) {
    if (!ebayContext || !ebayContext.headers) return false;

    const uploadedPictures = [];

    // Upload via service worker proxy (avoids CORS — SW has host_permissions + cookies)
    console.log(`[DropFlow] Uploading ${files.length} images via service worker proxy...`);
    for (let i = 0; i < files.length; i++) {
      try {
        const dataUrl = await fileToDataUrl(files[i]);
        const resp = await sendMessageSafe({
          type: 'UPLOAD_EBAY_IMAGE',
          imageDataUrl: dataUrl,
          filename: files[i].name
        }, 20000);
        if (resp && resp.success && resp.imageUrl) {
          uploadedPictures.push(resp.imageUrl);
          console.log(`[DropFlow] Image ${i + 1} uploaded via SW proxy: ${resp.imageUrl.substring(0, 60)}`);
        } else {
          console.warn(`[DropFlow] SW proxy upload ${i + 1} failed:`, resp?.error);
        }
      } catch (e) {
        console.warn(`[DropFlow] SW proxy upload ${i + 1} failed:`, e.message);
      }
    }

    // If we uploaded images via media API, PUT them to the draft
    if (uploadedPictures.length > 0 && ebayContext.draftId) {
      console.log(`[DropFlow] ${uploadedPictures.length} images uploaded via media API, updating draft...`);
      const putSuccess = await putDraftField({
        pictures: { pictureUrl: uploadedPictures }
      }, ebayContext);
      return putSuccess;
    }

    return uploadedPictures.length > 0;
  }

  /**
   * Convert a File object to a data URL string (for message passing to service worker).
   */
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Method 4: PUT external image URLs directly to eBay's listing draft API.
   * eBay may or may not accept external CDN URLs â€" we try multiple field formats.
   */
  async function uploadViaDraftApiPut(imageUrls, ebayContext) {
    if (!ebayContext || !ebayContext.draftId) return false;

    console.log(`[DropFlow] Attempting draft API PUT with ${imageUrls.length} image URLs...`);

    // Try multiple payload formats that eBay's draft API might accept
    const payloads = [
      { pictures: { pictureUrl: imageUrls } },
      { pictures: imageUrls.map(url => ({ URL: url })) },
      { pictureURL: imageUrls },
      { images: imageUrls.map(url => ({ imageUrl: url })) },
      { pictureDetails: { pictureURL: imageUrls } }
    ];

    for (let i = 0; i < payloads.length; i++) {
      try {
        const success = await putDraftField(payloads[i], ebayContext);
        if (success) {
          console.log(`[DropFlow] Draft API image PUT succeeded with format ${i + 1}`);
          return true;
        }
      } catch (e) {
        // Try next format
      }
    }

    console.warn('[DropFlow] All draft API image PUT formats failed');
    return false;
  }

  /**
   * Count how many images are currently visible in eBay's photos section.
   * Used to verify uploads actually worked.
   */
  function countUploadedImages() {
    // Primary: read eBay's photo count text element (e.g. "3 of 12 photos")
    const countSelectors = [
      '.uploader-thumbnails__photo-count',
      '.uploader-ui-img-g__header',
      '.uploader-thumbnails-ux__header__photo-count'
    ];
    for (const sel of countSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent || '';
        // Extract first number from text like "3 of 12 photos"
        const match = text.match(/(\d+)/);
        if (match) {
          const count = parseInt(match[1], 10);
          if (!isNaN(count)) return count;
        }
      }
    }

    // Fallback: count thumbnail images in the photos section
    const photoSection = findPhotosSection();
    if (!photoSection) return 0;
    const imgs = photoSection.querySelectorAll('img[src]');
    let count = 0;
    for (const img of imgs) {
      const src = img.src || '';
      if (img.width > 40 && img.height > 40 && !src.startsWith('data:image/svg') &&
          !src.includes('icon') && !src.includes('placeholder')) {
        count++;
      }
    }
    return count;
  }

  // ============================
  // Message Listener
  // ============================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FILL_EBAY_FORM') {
      if (!IS_TOP_FRAME) {
        sendResponse({ success: false, ignored: true, reason: 'subframe' });
        return true;
      }

      // If we're on a prelist page (suggest/identify), we can't fill the form directly.
      // Instead, store the product data and kick off the prelist → identify → form flow,
      // which is the same path the bulk poster uses.
      if (isPrelistPage()) {
        (async () => {
          try {
            // Get our tab ID for the per-tab storage key
            let tabId = null;
            try {
              const resp = await sendMessageSafe({ type: 'GET_TAB_ID' }, 5000);
              tabId = resp?.tabId;
            } catch (_) {}

            const storageKey = tabId ? `pendingListing_${tabId}` : 'pendingListingData';
            await chrome.storage.local.set({ [storageKey]: message.productData });
            console.log(`[DropFlow] FILL_EBAY_FORM on prelist page — stored data as ${storageKey}, starting prelist flow`);

            // Run the prelist search flow (type title, click search)
            await handlePrelistPage(message.productData);

            // Watch for SPA transitions through identify → form page → auto-fill
            watchForPageTransitions(storageKey);

            sendResponse({ success: true, message: 'Prelist flow started', storageKey });
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
        })();
        return true;
      }

      fillForm(message.productData).then(results => {
        sendResponse({ success: true, results });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true; // Async response
    }
  });

  /**
   * Check if we're on any eBay prelist page.
   */
  function isPrelistPage() {
    return window.location.pathname.includes('/sl/prelist');
  }

  /**
   * Check if we're on the "Find a match" / identify page.
   */
  function isIdentifyPage() {
    return window.location.pathname.includes('/sl/prelist/identify');
  }

  function getAccessibleDocuments() {
    const docs = [];
    const seen = new Set();
    const queue = [document];

    while (queue.length > 0) {
      const doc = queue.shift();
      if (!doc || seen.has(doc)) continue;
      seen.add(doc);
      docs.push(doc);

      let frames = [];
      try {
        frames = Array.from(doc.querySelectorAll('iframe, frame'));
      } catch (_) {
        frames = [];
      }
      for (const frame of frames) {
        try {
          const frameDoc = frame.contentDocument;
          if (frameDoc && frameDoc.documentElement && !seen.has(frameDoc)) {
            queue.push(frameDoc);
          }
        } catch (_) {
          // Cross-origin frame; ignore.
        }
      }
    }

    return docs;
  }

  function detectVariationBuilderContext() {
    const docs = getAccessibleDocuments();
    let best = null;

    for (const doc of docs) {
      // Gather page text for signal detection
      let rawBodyText = String(doc.body?.innerText || '');
      let usedTextContentFallback = false;

      // eBay's builder page CSS hides content from innerText (returns ~10 chars)
      // while the DOM clearly has content. Fall back to textContent from the
      // ENTIRE body (not just div.root - builder may be in a React portal).
      if (rawBodyText.length < 200 && doc.body) {
        try {
          const clone = doc.body.cloneNode(true);
          clone.querySelectorAll('script, style, noscript, link').forEach(el => el.remove());
          const strippedText = clone.textContent || '';
          if (strippedText.length > rawBodyText.length * 5) {
            rawBodyText = strippedText;
            usedTextContentFallback = true;
          }
        } catch (_) {}
      }

      // If text fallback still doesn't have builder signals, search ALL
      // same-origin iframes' body textContent too
      if (usedTextContentFallback && !/create\s+(your\s+)?variation/i.test(rawBodyText.toLowerCase())) {
        try {
          const iframes = doc.querySelectorAll('iframe, frame');
          for (const iframe of iframes) {
            try {
              const iframeDoc = iframe.contentDocument;
              if (iframeDoc?.body) {
                const iClone = iframeDoc.body.cloneNode(true);
                iClone.querySelectorAll('script, style, noscript, link').forEach(el => el.remove());
                const iText = iClone.textContent || '';
                if (iText.length > 100) {
                  rawBodyText += ' ' + iText;
                }
              }
            } catch (_) {}
          }
        } catch (_) {}
      }

      // Also walk shadow roots for additional text
      try {
        const walkShadows = (root) => {
          const els = root.querySelectorAll('*');
          for (const el of els) {
            if (el.shadowRoot) {
              rawBodyText += ' ' + (el.shadowRoot.textContent || '');
              walkShadows(el.shadowRoot);
            }
          }
        };
        walkShadows(doc);
      } catch (_) {}
      const bodyText = rawBodyText.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!bodyText) continue;

      // Diagnostic: report page structure (fires once per unique URL)
      const currentHref = window.location.href;
      if (detectVariationBuilderContext._diagUrl !== currentHref) {
        detectVariationBuilderContext._diagUrl = currentHref;
        let iframeCount = 0, crossOriginCount = 0, shadowRootCount = 0;
        const iframeSrcs = [];
        const bodyChildren = [];
        try {
          const allEls = doc.querySelectorAll('*');
          for (const el of allEls) {
            if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
              iframeCount++;
              iframeSrcs.push(el.src || el.getAttribute('srcdoc')?.slice(0, 50) || '(no src)');
              try { el.contentDocument; } catch (_) { crossOriginCount++; }
            }
            if (el.shadowRoot) shadowRootCount++;
          }
        } catch (_) {}
        try {
          for (const child of doc.body?.children || []) {
            bodyChildren.push(`<${child.tagName.toLowerCase()}${child.id ? '#' + child.id : ''}${child.className ? '.' + String(child.className).split(' ')[0] : ''} textLen=${(child.textContent || '').length}>`);
          }
        } catch (_) {}
        console.warn(`[DropFlow] Page structure: iframes=${iframeCount} (cross-origin=${crossOriginCount}), openShadowRoots=${shadowRootCount}, bodyTextLen=${bodyText.length}, bodySnippet="${bodyText.slice(0, 300)}"`);
        console.warn(`[DropFlow] Page iframes: [${iframeSrcs.join(', ')}]`);
        console.warn(`[DropFlow] Body children: ${bodyChildren.join(' | ')}`);
        if (bodyText.length < 500) {
          console.warn(`[DropFlow] Full bodyText: "${bodyText}"`);
        }
      }

      let pathname = '';
      let hostname = '';
      let href = '';
      try { pathname = String(doc.location?.pathname || ''); } catch (_) { pathname = ''; }
      try { hostname = String(doc.location?.hostname || ''); } catch (_) { hostname = ''; }
      try { href = String(doc.location?.href || ''); } catch (_) { href = ''; }
      const isMskuUrl = /\/msku(?:\/|$|\?)/i.test(pathname);
      const isBulkEditHost = /(^|\.)bulkedit\.ebay\./i.test(hostname) || /bulkedit\.ebay\./i.test(href);
      const urlHint = /\/lstng|\/sl\/prelist/i.test(pathname) || isMskuUrl || isBulkEditHost;

      // Targeted search: when fallback is active but builder text NOT found, search everywhere
      if (usedTextContentFallback && /\/lstng/i.test(pathname) &&
          !/create\s+(your\s+)?variation/i.test(bodyText) &&
          !detectVariationBuilderContext._searchDone) {
        detectVariationBuilderContext._searchDone = true;
        try {
          const needle = 'create your variation';
          let foundIn = '(not found in main doc)';
          const allEls = doc.querySelectorAll('*');
          for (const el of allEls) {
            const tc = (el.textContent || '').toLowerCase();
            if (tc.includes(needle) && tc.length < 2000) {
              foundIn = `${el.tagName}${el.id ? '#' + el.id : ''}.${(el.className || '').toString().split(' ')[0]} parent=${el.parentElement?.tagName}${el.parentElement?.id ? '#' + el.parentElement?.id : ''}.${(el.parentElement?.className || '').toString().split(' ')[0]}`;
              break;
            }
          }
          console.warn(`[DropFlow] BUILDER TEXT SEARCH in main doc: ${foundIn}`);

          // Search all accessible iframes
          const iframes = doc.querySelectorAll('iframe, frame');
          for (let i = 0; i < iframes.length; i++) {
            try {
              const iDoc = iframes[i].contentDocument;
              if (!iDoc?.body) continue;
              const iText = (iDoc.body.textContent || '').toLowerCase();
              const hasBuilder = iText.includes(needle);
              const iInnerText = (iDoc.body.innerText || '').length;
              console.warn(`[DropFlow] iframe[${i}] src=${(iframes[i].src || '').substring(0, 80)}, innerTextLen=${iInnerText}, textContentLen=${iText.length}, hasBuilderText=${hasBuilder}`);
              if (hasBuilder) {
                for (const el of iDoc.querySelectorAll('*')) {
                  const tc = (el.textContent || '').toLowerCase();
                  if (tc.includes(needle) && tc.length < 2000) {
                    console.warn(`[DropFlow] iframe[${i}] builder text in: ${el.tagName}.${(el.className || '').toString().split(' ')[0]} textLen=${tc.length}`);
                    break;
                  }
                }
              }
            } catch (_) {
              console.warn(`[DropFlow] iframe[${i}] cross-origin, cannot access`);
            }
          }
        } catch (e) {
          console.warn(`[DropFlow] BUILDER TEXT SEARCH error: ${e.message}`);
        }
      }

      const hasCreateHeader = /create\s+(your\s+)?variation|manage\s+(your\s+)?variation|variation\s+builder/.test(bodyText);
      const hasVariationsTitle = /\bvariations?\b/.test(bodyText);
      const hasAttributes = /\b(attributes?|properties|specifications?|specs)\b/.test(bodyText);
      const hasOptions = /\b(options?|values?|choices)\b/.test(bodyText);
      const hasRightPanel = /(attributes?|properties).{0,20}(options?|values?).{0,20}(selected|chosen|added)/.test(bodyText);

      let hasAdd = false;
      let hasCreateOwn = false;
      let hasContinue = false;
      let hasCancel = false;
      let scanned = 0;
      let clickables = [];
      try {
        clickables = queryAllWithShadow('button, a, [role="button"], [role="link"], [role="menuitem"], span, div', doc);
      } catch (_) {
        clickables = [];
      }
      for (const el of clickables) {
        // When textContent fallback is active, eBay's CSS hides elements from
        // visibility checks while they're still visually rendered. Skip the check.
        if (!usedTextContentFallback && !isElementVisible(el)) continue;
        const t = (el.textContent || '').trim();
        if (!t || t.length > 80) continue;
        if (/^\s*\+\s*add\s*$/i.test(t)) hasAdd = true;
        if (/create your own/i.test(t)) hasCreateOwn = true;
        if (/^\s*(continue|update\s+variations?)\s*$/i.test(t)) hasContinue = true;
        if (/^\s*cancel\s*$/i.test(t)) hasCancel = true;
        scanned++;
        if ((hasAdd && hasCreateOwn && hasContinue) || scanned > 1200) break;
      }

      const primarySignals = [hasCreateHeader, hasAttributes, hasOptions].filter(Boolean).length;
      let score = 0;
      if (hasCreateHeader) score += 3;
      if (hasVariationsTitle) score += 1;
      if (hasAttributes) score += 2;
      if (hasOptions) score += 2;
      if (hasRightPanel) score += 2;
      if (hasAdd) score += 1;
      if (hasCreateOwn) score += 1;
      if (hasContinue) score += 1;
      if (hasCancel) score += 1;
      if (urlHint) score += 1;
      const urlHasVariation = /\bvari/i.test(pathname) || isMskuUrl || isBulkEditHost;
      if (urlHasVariation) score += 2;

      const isBuilder =
        (primarySignals >= 3 && (hasAdd || hasCreateOwn || hasContinue)) ||
        (hasCreateHeader && hasAttributes && hasOptions) ||
        (score >= 7 && (hasAdd || hasCreateOwn || hasContinue)) ||
        (hasContinue && hasVariationsTitle && (hasAdd || hasCreateOwn) && score >= 4) ||
        // Lenient: bulkedit.ebay.*/msku with key DOM signals = builder (iframe may not render all buttons)
        (isBulkEditHost && isMskuUrl && hasAttributes && hasOptions && hasVariationsTitle);

      if (!best || score > best.score) {
        best = {
          doc,
          score,
          isBuilder,
          signals: {
            hasCreateHeader,
            hasVariationsTitle,
            hasAttributes,
            hasOptions,
            hasRightPanel,
            hasAdd,
            hasCreateOwn,
            hasContinue,
            hasCancel,
            urlHint,
            urlHasVariation,
            isMskuUrl,
            isBulkEditHost,
            bodyTextLen: bodyText.length,
            textContentFallback: usedTextContentFallback
          }
        };
      }
    }

    // FIX: Detect visible MSKU fullscreen dialog with cross-origin iframe.
    // When eBay opens the variation builder, it creates a fullscreen dialog with
    // an iframe to bulkedit.ebay.com.au/msku — this is cross-origin so we can't
    // read its content, but the dialog's presence IS the builder.
    if (!best || !best.isBuilder) {
      try {
        const mskuIframe = findMskuBulkeditIframe();
        const mskuDialog = document.querySelector('.msku-dialog, [class*="msku-dialog"]');
        if (mskuIframe) {
          const iframeRect = mskuIframe.getBoundingClientRect();
          const isVisible = iframeRect.width > 200 && iframeRect.height > 200;
          if (isVisible || mskuDialog) {
            console.warn(`[DropFlow] MSKU fullscreen dialog/iframe detected as builder (iframe ${iframeRect.width}x${iframeRect.height}, dialog=${!!mskuDialog})`);
            const mskuResult = {
              isBuilder: true,
              isMskuDialog: true,
              doc: document,
              score: 20,
              signals: {
                isMskuUrl: true,
                isBulkEditHost: true,
                mskuDialogDetected: true,
                urlHint: true,
                bodyTextLen: (best?.signals?.bodyTextLen || 0),
                hasCreateHeader: true,
                hasVariationsTitle: true,
                hasAttributes: true,
                hasOptions: true,
                hasContinue: true,
                hasCancel: true,
                hasAdd: true,
                hasCreateOwn: true
              }
            };
            return mskuResult;
          }
        }
      } catch (_) {}
    }

    if (!best) {
      return {
        isBuilder: false,
        doc: document,
        score: 0,
        signals: {}
      };
    }

    return best;
  }

  /**
   * Detect eBay's dedicated "Create your variations" page.
   * Depending on locale/experiment, this can appear under /sl/prelist/* or /lstng,
   * and in some variants the UI is rendered inside an iframe.
   */
  function isVariationBuilderPage() {
    return !!detectVariationBuilderContext().isBuilder;
  }

  /**
   * Lightweight fallback detector for the dedicated full-page variation builder.
   */
  function hasVariationBuilderTextHints() {
    const ctx = detectVariationBuilderContext();
    const s = ctx.signals || {};
    return !!(s.hasCreateHeader && s.hasAttributes && s.hasOptions);
  }

  /**
   * Strong detector for dedicated variation-builder surface.
   * Includes strict and fallback heuristics to avoid running form-page logic
   * (settings / 3-dot / edit discovery) when already on the builder page.
   */
  function isVariationBuilderSurface() {
    return !!detectVariationBuilderContext().isBuilder;
  }

  /**
   * On the prelist page, type the product title into the search box and submit.
   * Keeps pendingListingData in storage so the actual form page can pick it up.
   */
  // Track whether we've already submitted the prelist search in this tab session.
  // Uses sessionStorage (survives full page reloads within the same tab, clears on tab close).
  // Prevents infinite loop: suggest â†' identify (category fail) â†' suggest â†' re-submit â†' loop
  const PRELIST_FLAG_KEY = 'dropflow_prelist_submitted';

  async function handlePrelistPage(productData) {
    if (sessionStorage.getItem(PRELIST_FLAG_KEY)) {
      console.log('[DropFlow] Prelist search already submitted in this tab session, skipping to avoid loop');
      return;
    }
    sessionStorage.setItem(PRELIST_FLAG_KEY, 'true');
    console.log('[DropFlow] On prelist page, searching for product...');
    await sleep(2000);

    const startUrl = window.location.href;

    // Find the search input - eBay uses various selectors
    const searchInput = document.querySelector('input[type="search"]') ||
                        document.querySelector('input[placeholder*="Tell us" i]') ||
                        document.querySelector('input[placeholder*="what you\'re selling" i]') ||
                        document.querySelector('input[placeholder*="product" i]') ||
                        document.querySelector('input[aria-label*="selling" i]') ||
                        document.querySelector('.prelist input[type="text"]') ||
                        document.querySelector('[data-testid="searchbox"] input') ||
                        document.querySelector('input.listingflow-top__input') ||
                        document.querySelector('input[name="keywords"]');

    if (!searchInput) {
      // Fallback: try any prominent text input on the page
      const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
      for (const input of allInputs) {
        if (input.offsetParent !== null && input.offsetWidth > 200) {
          console.log('[DropFlow] Using fallback input:', input);
          return submitPrelistSearch(input, productData);
        }
      }
      console.warn('[DropFlow] Could not find prelist search input');
      return;
    }

    await submitPrelistSearch(searchInput, productData);

    // Verify navigation; retry once if still on the same URL after 3s
    await sleep(3000);
    if (window.location.href === startUrl) {
      console.warn('[DropFlow] Prelist search did not navigate, retrying click once...');
      await submitPrelistSearch(searchInput, productData);
    }
  }

  async function submitPrelistSearch(searchInput, productData) {
    const title = (productData.ebayTitle || productData.title || '').substring(0, 80);
    if (!title) {
      console.warn('[DropFlow] No title to search with');
      return;
    }

    // Focus and type
    await commitInputValue(searchInput, title);
    await sleep(500);

    // Try to find and click the search/continue button
    const submitBtn = document.querySelector('button.keyword-suggestion__button') ||
                      document.querySelector('button[type="submit"]') ||
                      document.querySelector('button[aria-label*="search" i]') ||
                      document.querySelector('button[aria-label*="continue" i]') ||
                      document.querySelector('[data-testid="searchbox"] button');

    if (submitBtn) {
      simulateClick(submitBtn);
      console.log('[DropFlow] Submitted prelist search');
    } else {
      // Fallback: submit via Enter key
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertLineBreak' }));
      // Also try submitting the parent form
      const form = searchInput.closest('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
      console.log('[DropFlow] Submitted prelist search via Enter key');
    }
  }

  /**
   * Find any continue/next button on the identify page.
   * Uses the competitor's proven selector chain plus text-based fallbacks.
   */
  function findContinueButton() {
    return document.querySelector('.prelist-radix__next-action') ||
           document.querySelector('.prelist-radix__condition-grading-cta') ||
           document.querySelector('[class*="radix__continue-btn"]') ||
           document.querySelector('.condition-dialog-radix__continue-btn') ||
           Array.from(document.querySelectorAll('button')).find(b => {
             const text = b.textContent.toLowerCase().trim();
             return (text === 'continue' || text === 'done' ||
                     text === 'continue without match') &&
                    b.offsetParent !== null;
           });
  }

  /**
   * Dispatch a full mouse event sequence on an element.
   * More robust than .click() â€" triggers React synthetic events,
   * pointer event handlers, and mousedown/mouseup listeners.
   */
  function simulateClick(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const clickView = el.ownerDocument?.defaultView || window;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: clickView };

    // Mouse enter/over events first â€" some React components need these to register
    el.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false }));
    el.dispatchEvent(new PointerEvent('pointerover', opts));

    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.focus();
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));

    // Native .click() as fallback â€" some frameworks only respond to this
    try { el.click(); } catch (_) {}
  }

  /**
   * Try to click a condition option. Returns true if successful.
   * Uses 6 escalating strategies â€" from specific selectors to
   * visual border detection and elementFromPoint scanning.
   */
  function tryClickCondition() {
    // === Strategy A0: Condition recommendation buttons ("Brand New", "Used") ===
    // eBay shows these as quick-select buttons in the condition section
    const condRecoBtn = document.querySelector('button.condition-recommendation-value');
    if (condRecoBtn) {
      simulateClick(condRecoBtn);
      console.log('[DropFlow] Condition Strategy A0: clicked condition-recommendation-value "' + condRecoBtn.textContent.trim() + '"');
      return true;
    }

    // === Strategy A: eBay condition-button cards (watches, clothing, etc.) ===
    const condBtn = document.querySelector('button.condition-button');
    if (condBtn) {
      simulateClick(condBtn);
      console.log('[DropFlow] Condition Strategy A: clicked button.condition-button');
      return true;
    }

    // === Strategy B: Standard radio/checkbox with name="condition" ===
    const radio = document.querySelector('[name="condition"]');
    if (radio) {
      simulateClick(radio);
      console.log('[DropFlow] Condition Strategy B: clicked [name="condition"]');
      return true;
    }

    // Skip remaining strategies if lightbox is open (lightbox = category selection)
    if (document.querySelector('.lightbox-dialog__main')) return false;

    // === Strategy C: ARIA role-based (Radix UI radio groups) ===
    const roleEl = document.querySelector('[role="radiogroup"] [role="radio"]') ||
                   document.querySelector('[role="listbox"] [role="option"]') ||
                   document.querySelector('[role="radio"]');
    if (roleEl) {
      simulateClick(roleEl);
      console.log('[DropFlow] Condition Strategy C: clicked ARIA role element');
      return true;
    }

    // === Strategy D: Known eBay class selectors ===
    const knownCard = document.querySelector('.se-field-card__container') ||
                      document.querySelector('[class*="condition-grading"] [class*="card"]') ||
                      document.querySelector('[class*="condition-grading"] [class*="option"]') ||
                      document.querySelector('[class*="field-card"]');
    if (knownCard) {
      simulateClick(knownCard);
      console.log('[DropFlow] Condition Strategy D: clicked known card selector');
      return true;
    }

    // === Strategy E: Visual border detection ===
    // Scan ALL elements for bordered, card-sized elements with condition text.
    // Doesn't depend on any CSS class names or heading tags â€" uses
    // getComputedStyle to find elements that LOOK like clickable cards.
    const conditionText = /new\b|brand new|pre-owned|used|open box|like new|seller refurb|certified/i;
    const skipText = /^(select condition|disclose|continue|done|skip|copyright|example)/i;

    const candidates = document.querySelectorAll('div, button, a, label, li, section, article');
    let bestEl = null;
    let bestTop = Infinity;

    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      // Must be in viewport, card-sized, below page header area
      if (rect.top < 100 || rect.top >= bestTop) continue;
      if (rect.width < 300 || rect.height < 35 || rect.height > 200) continue;
      if (!el.offsetParent) continue;

      const text = el.textContent.trim();
      if (!conditionText.test(text) || skipText.test(text)) continue;
      if (text.length > 500) continue; // Skip containers with too much text

      // Check for visual "card" appearance (border, shadow, or rounded corners)
      const style = window.getComputedStyle(el);
      const hasBorder = style.borderStyle !== 'none' && parseFloat(style.borderWidth) > 0;
      const hasShadow = style.boxShadow !== 'none' && style.boxShadow !== '';
      const hasRadius = parseFloat(style.borderRadius) > 0;

      if (hasBorder || hasShadow || hasRadius) {
        bestEl = el;
        bestTop = rect.top;
      }
    }

    if (bestEl) {
      simulateClick(bestEl);
      console.log(`[DropFlow] Condition Strategy E: clicked bordered card "${bestEl.textContent.trim().substring(0, 50)}" at y=${Math.round(bestTop)}`);
      return true;
    }

    // === Strategy F: elementFromPoint scanning (ultimate fallback) ===
    // Click at the center of the page, scanning downward from y=150
    // until we hit an element containing condition text.
    const centerX = window.innerWidth / 2;
    for (let y = 150; y < window.innerHeight - 100; y += 15) {
      const el = document.elementFromPoint(centerX, y);
      if (!el || el === document.body || el === document.documentElement) continue;

      const text = el.textContent.trim();
      if (conditionText.test(text) && !skipText.test(text) && text.length < 500) {
        // Walk up to find the outermost card-like ancestor (but not a page container)
        let target = el;
        while (target.parentElement && target.parentElement !== document.body) {
          const pRect = target.parentElement.getBoundingClientRect();
          if (pRect.height > 200 || pRect.width > window.innerWidth * 0.9) break;
          target = target.parentElement;
        }
        simulateClick(target);
        console.log(`[DropFlow] Condition Strategy F: clicked via elementFromPoint at y=${y}, tag=${target.tagName}`);
        return true;
      }
    }

    return false;
  }

  /**
   * Run the identify page automation as 3 concurrent polling loops.
   * Each task polls every 1s and clicks its target when found.
   * All tasks stop when the URL changes away from /identify or after 60s.
   *
   * Handles ALL identify page variations:
   * - Category selection (lightbox modal with category cards)
   * - Simple condition radio ([name="condition"])
   * - Condition grading cards (watches, shoes, clothing â€" full-page card selection)
   * - Product match selection (Continue/Continue without match)
   */
  async function runIdentifyPageLoop(hasVariations = false) {
    let done = false;
    let categoryClicked = false;
    let conditionClicked = false;
    let skipProductMatch = hasVariations; // For variation products, skip catalog match

    function isDone() {
      return done ||
        !window.location.pathname.includes('/sl/prelist/identify') ||
        isVariationBuilderSurface();
    }

    if (isVariationBuilderSurface()) {
      console.log('[DropFlow] Identify loop skipped: dedicated variation builder detected');
      return;
    }

    // Helper: find "Continue without match" / "I can't find my product" buttons
    function findSkipMatchButton() {
      return Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"], span[role="link"]'))
        .find(el => {
          const text = (el.textContent || '').toLowerCase().trim();
          return (text.includes('continue without match') ||
                  text.includes('list without match') ||
                  text.includes('list as new') ||
                  text.includes('create new listing') ||
                  text.includes('not finding your product') ||
                  text.includes("can't find") ||
                  text.includes('i don\'t see my product') ||
                  text.includes('list it yourself') ||
                  text.includes('create your own')) &&
                 el.offsetParent !== null;
        });
    }

    // Task 0 (variation products only): Immediately skip catalog product matching.
    // Clicking a product match creates a catalog-linked listing that doesn't allow
    // custom variations. We MUST "Continue without match" to get the full form
    // including the VARIATIONS section.
    async function skipCatalogMatch() {
      if (!skipProductMatch) return; // Only runs for variation products
      let attempts = 0;
      while (!isDone() && attempts < 30) {
        attempts++;
        const skipBtn = findSkipMatchButton();
        if (skipBtn) {
          simulateClick(skipBtn);
          console.log(`[DropFlow] VARIATION MODE: Clicked "${skipBtn.textContent.trim().substring(0, 50)}" to skip catalog match`);
          skipProductMatch = false; // Done, don't click again
          await sleep(2000);
          return;
        }
        // Also look for a "skip" link that may be smaller/less prominent
        const smallLinks = Array.from(document.querySelectorAll('a, button, span'))
          .filter(el => el.offsetParent !== null && (el.textContent || '').trim().length < 60);
        for (const el of smallLinks) {
          const text = (el.textContent || '').trim().toLowerCase();
          if (text.includes('skip') || text.includes('without') || text.includes('don\'t see')) {
            simulateClick(el);
            console.log(`[DropFlow] VARIATION MODE: Clicked skip link: "${el.textContent.trim().substring(0, 50)}"`);
            skipProductMatch = false;
            await sleep(2000);
            return;
          }
        }
        await sleep(1000);
      }
      console.warn('[DropFlow] VARIATION MODE: Could not find skip-match button after 30 attempts');
    }

    // Task 1: Click category card inside lightbox modal
    // For variation products: only click CATEGORY cards (not product match cards)
    async function clickCategoryCard() {
      // For variation products, wait for skipCatalogMatch to run first
      if (hasVariations) {
        await sleep(5000); // Give skipCatalogMatch time to find and click
      }
      while (!isDone()) {
        if (!categoryClicked) {
          const lightbox = document.querySelector('.lightbox-dialog__main');
          if (lightbox) {
            const card = lightbox.querySelector('.se-field-card__container');
            if (card) {
              simulateClick(card);
              categoryClicked = true;
              console.log('[DropFlow] Clicked category card in lightbox');
            }
          }
        }
        if (categoryClicked) {
          const doneBtn = Array.from(document.querySelectorAll('button'))
            .find(b => b.textContent.trim() === 'Done' && b.offsetParent !== null);
          if (doneBtn) {
            simulateClick(doneBtn);
            console.log('[DropFlow] Clicked "Done" after category selection');
          }
        }
        await sleep(1000);
      }
    }

    // Task 2: Select condition using escalating strategies
    let conditionRetries = 0;
    const MAX_CONDITION_RETRIES = 8;
    async function selectCondition() {
      while (!isDone()) {
        if (!conditionClicked) {
          conditionClicked = tryClickCondition();
          if (conditionClicked) {
            await sleep(1000);
            // Verify click registered â€" check multiple possible attributes
            const selected = document.querySelector('button.condition-button[aria-pressed="true"]') ||
                             document.querySelector('button.condition-button.condition-button__selected') ||
                             document.querySelector('button.condition-button[aria-checked="true"]') ||
                             document.querySelector('button.condition-button[data-selected="true"]') ||
                             document.querySelector('button.condition-button.selected') ||
                             document.querySelector('[class*="condition"][aria-pressed="true"]') ||
                             document.querySelector('[class*="condition"][class*="selected"]');
            if (!selected) {
              conditionRetries++;
              if (conditionRetries >= MAX_CONDITION_RETRIES) {
                // After max retries, assume click worked and proceed
                console.warn(`[DropFlow] Condition click verification failed after ${MAX_CONDITION_RETRIES} attempts â€" proceeding anyway`);
              } else {
                console.warn(`[DropFlow] Condition click did not register (attempt ${conditionRetries}/${MAX_CONDITION_RETRIES}), retrying...`);
                conditionClicked = false;
              }
            }
            continue;
          }
        }
        await sleep(1000);
      }
    }

    // Task 3: Keep clicking any continue/next button (not disabled)
    async function clickContinue() {
      while (!isDone()) {
        const btn = findContinueButton();
        if (btn && !btn.disabled) {
          simulateClick(btn);
          console.log(`[DropFlow] Clicked continue: "${btn.textContent.trim().substring(0, 40)}"`);
        }
        await sleep(1000);
      }
    }

    // Task 4: Handle variant picker â€" bypass eBay's catalog variant selection
    // When eBay matches a product to a catalog entry with variations, it shows
    // color/size pickers that block the Continue button. After a few seconds,
    // we look for "Continue without match" / "List as new" to skip past it.
    async function handleVariantPicker() {
      let stuckSeconds = 0;
      while (!isDone()) {
        // Detect a stuck state: continue button exists but is disabled
        const continueBtn = findContinueButton();
        const isContinueDisabled = continueBtn && continueBtn.disabled;

        // Also detect variant-specific UI elements
        const hasVariantUI = document.querySelector('[class*="variant-picker"]') ||
          document.querySelector('[class*="variation-select"]') ||
          document.querySelector('[class*="product-variation"]') ||
          document.querySelector('[class*="catalog-selection"]') ||
          document.querySelector('select[class*="variant"]') ||
          document.querySelector('[class*="product-match"]');

        if (isContinueDisabled || hasVariantUI) {
          stuckSeconds++;
        } else {
          stuckSeconds = 0;
        }

        // For variation products: immediately look for bypass (don't wait 5s)
        // For non-variation products: wait 5s before trying bypass
        const triggerThreshold = hasVariations ? 1 : 5;
        if (stuckSeconds >= triggerThreshold) {
          const bypassBtn = findSkipMatchButton();
          if (bypassBtn) {
            simulateClick(bypassBtn);
            console.log(`[DropFlow] Clicked variant bypass: "${bypassBtn.textContent.trim().substring(0, 50)}"`);
            stuckSeconds = 0;
            await sleep(2000);
            continue;
          }

          // If stuck for 15+ seconds and no bypass found, try clicking any
          // non-disabled button that might dismiss a variant selection panel
          if (stuckSeconds >= 15) {
            // Try selecting the first option in any dropdown that appeared
            const selects = document.querySelectorAll('select');
            for (const sel of selects) {
              if (sel.options.length > 1 && sel.selectedIndex === 0) {
                sel.selectedIndex = 1;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                console.log(`[DropFlow] Auto-selected first option in variant dropdown: "${sel.options[1]?.text}"`);
                stuckSeconds = 5; // Reset to re-check after selection
              }
            }
          }
        }

        await sleep(1000);
      }
    }

    console.log(`[DropFlow] Starting identify page automation (hasVariations=${hasVariations})...`);

    const tasks = [selectCondition(), clickContinue(), handleVariantPicker()];
    if (hasVariations) {
      // For variation products: run skipCatalogMatch FIRST, then category card as fallback
      tasks.unshift(skipCatalogMatch());
      tasks.push(clickCategoryCard()); // Still needed as fallback after skip
    } else {
      // For non-variation products: click category card normally
      tasks.unshift(clickCategoryCard());
    }

    await Promise.race([
      Promise.all(tasks),
      sleep(60000).then(() => {
        console.warn('[DropFlow] Identify page automation timed out after 60s');
        done = true;
      })
    ]);

    console.log('[DropFlow] Identify page automation finished');
  }

  /**
   * Watch for SPA page transitions within eBay's listing flow.
   * eBay navigates via pushState/replaceState without full reloads,
   * so the content script only runs once. This watcher handles subsequent steps.
   */
  function watchForPageTransitions(storageKey) {
    let lastUrl = window.location.href;
    let identifyDone = false;
    let variationBuilderDone = false;
    let variationBuilderLastAttempt = 0;
    let formFilled = false;
    let fillingFormNow = false;
    let debounceTimer = null;
    let urlPollInterval = null;

    const observer = new MutationObserver(() => {
      // Debounce: eBay makes many rapid DOM changes, wait for them to settle
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => handleMutation(), 500);
    });

    async function handleMutation() {
      const currentUrl = window.location.href;
      let builderCtx = detectVariationBuilderContextWithLog('watchTransitions:mutation');
      let onVariationBuilder = builderCtx.isBuilder;

      // Detect URL change (SPA navigation)
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        identifyDone = false;
        variationBuilderDone = false;
        console.log('[DropFlow] SPA navigation detected:', currentUrl);
      }

      if (formFilled || fillingFormNow) return;

      const stored = await chrome.storage.local.get(storageKey);
      if (!stored[storageKey]) {
        observer.disconnect();
        return;
      }

      // Builder pages can paint progressively; if uncertain on /lstng, re-check once
      // after a short delay before falling back to generic form fill logic.
      if (!onVariationBuilder && /\/lstng/i.test(window.location.pathname || '')) {
        await sleep(600);
        builderCtx = detectVariationBuilderContext();
        onVariationBuilder = builderCtx.isBuilder;
      }

      // Dedicated variation builder page (opened from VARIATIONS -> Edit).
      if (onVariationBuilder) {
        const now = Date.now();
        if (variationBuilderDone) return;
        if (now - variationBuilderLastAttempt < 4000) return;
        variationBuilderLastAttempt = now;
        const storedData = stored[storageKey];
        const hasVars = !!storedData?.variations?.hasVariations;
        if (hasVars) {
          console.warn('[DropFlow] BUILDER DETECTED by watcher - running variation builder flow...');
          const ok = await runVariationBuilderPageFlow(storedData, [], builderCtx.doc);
          await logVariationStep('variationBuilder:watchFlowResult', { ok, url: window.location.href });
          if (ok) {
            console.warn('[DropFlow] Variation builder flow SUCCEEDED via watcher');
          } else {
            console.warn('[DropFlow] Variation builder flow FAILED via watcher; will retry');
          }
          variationBuilderDone = !!ok;
        } else {
          console.warn('[DropFlow] Variation builder page detected but product has no variations; skipping');
          variationBuilderDone = true;
        }
        return;
      }

      // On suggest page (looped back): clear loop flag and retry after delay
      // This catches the case where category selection failed and eBay sent us back
      if (window.location.pathname.includes('/sl/prelist/suggest') ||
          (window.location.pathname.includes('/sl/prelist') &&
           !window.location.pathname.includes('/sl/prelist/identify'))) {
        // Clear anti-loop flag after 5 seconds to allow retry (but not immediate re-submit)
        if (!sessionStorage.getItem('dropflow_suggest_retry')) {
          sessionStorage.setItem('dropflow_suggest_retry', 'true');
          console.log('[DropFlow] On suggest page, will retry search in 5s...');
          setTimeout(async () => {
            sessionStorage.removeItem(PRELIST_FLAG_KEY);
            const pending = await getPendingData();
            if (pending) {
              await handlePrelistPage(pending.data);
            }
          }, 5000);
        } else {
          console.log('[DropFlow] On suggest page (already retried), waiting for manual action...');
        }
        return;
      }

      // On identify/match page: launch concurrent polling loop
      if (window.location.pathname.includes('/sl/prelist/identify') && !onVariationBuilder) {
        if (identifyDone) return;
        identifyDone = true; // Prevent re-launching
        // Check if product has variations â€" skip catalog match if so
        const storedData = stored[storageKey];
        const hasVars = !!storedData?.variations?.hasVariations;
        console.log(`[DropFlow] On identify page, launching automation loop (hasVariations=${hasVars})...`);
        runIdentifyPageLoop(hasVars).then(() => {
          console.log('[DropFlow] Identify automation complete');
        });
        return;
      }

      // On actual form page (no longer on prelist): fill the form
      if (!window.location.pathname.includes('/sl/prelist') && !onVariationBuilder) {
        fillingFormNow = true;
        try {
          console.log('[DropFlow] Reached form page, auto-filling...');
          sessionStorage.removeItem(PRELIST_FLAG_KEY); // Allow future listings in same tab
          // NOTE: Do NOT remove storage before fillForm â€" the data must survive
          // content script re-injection or page reloads during SPA transitions.
          await sleep(2000);
          const pendingData = stored[storageKey];
          const results = await fillForm(pendingData);
          console.log('[DropFlow] Auto-fill results:', results);
          const requiresVariations = !!pendingData?.variations?.hasVariations;
          if (requiresVariations && !results?.variations) {
            console.warn('[DropFlow] Variation flow incomplete on form page; keeping pending data and continuing transition watch');
            await logVariationStep('watchTransitions:keepPendingAfterVariationIncomplete', {
              url: window.location.href
            });
            formFilled = false;
            return;
          }

          // Clean up storage AFTER form fill is complete
          await chrome.storage.local.remove(storageKey);
          formFilled = true;
          observer.disconnect();
          if (urlPollInterval) clearInterval(urlPollInterval);
          return;
        } finally {
          if (!formFilled) fillingFormNow = false;
        }
      }
    }

    observer.observe(document.body, { childList: true, subtree: true });

    // Kick once immediately. If watcher starts while already on the dedicated
    // variation builder page and DOM is stable, MutationObserver may not fire.
    handleMutation().catch(err => {
      console.warn('[DropFlow] watchForPageTransitions initial handle failed:', err?.message || err);
    });

    // Fallback: URL polling every 2s â€" catches SPA navigations that don't trigger
    // MutationObserver (e.g. pushState without DOM changes on document.body).
    urlPollInterval = setInterval(() => {
      if (formFilled) { clearInterval(urlPollInterval); return; }
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('[DropFlow] URL poll detected navigation:', currentUrl);
      }
      // Always re-run handler periodically so dedicated variation builder pages
      // still progress even when URL and DOM are mostly static.
      handleMutation().catch(err => {
        console.warn('[DropFlow] URL poll handleMutation failed:', err?.message || err);
      });
    }, 2000);

    // Stop watching after 2 minutes
    setTimeout(() => {
      observer.disconnect();
      clearInterval(urlPollInterval);
    }, 120000);
  }

  /**
   * Get pending listing data for this tab.
   * Checks per-tab key (pendingListing_<tabId>) first (bulk poster),
   * then falls back to legacy key (pendingListingData) for manual flow.
   * Returns { data, storageKey } or null.
   */
  async function getPendingData() {
    // Ask background for our tab ID
    let tabId = null;
    try {
      const resp = await sendMessageSafe({ type: 'GET_TAB_ID' }, 5000);
      tabId = resp?.tabId;
    } catch (e) {
      console.warn('[DropFlow] GET_TAB_ID failed (SW may be dead):', e?.message);
    }

    // Check per-tab key first (used by bulk poster for concurrency)
    if (tabId) {
      const tabKey = `pendingListing_${tabId}`;
      const tabStored = await chrome.storage.local.get(tabKey);
      if (tabStored[tabKey]) {
        console.log(`[DropFlow] Found per-tab data: ${tabKey}`);
        return { data: tabStored[tabKey], storageKey: tabKey };
      }
    }

    // Fallback: legacy shared key (used by manual "List on eBay" button)
    const stored = await chrome.storage.local.get('pendingListingData');
    if (stored.pendingListingData) {
      return { data: stored.pendingListingData, storageKey: 'pendingListingData' };
    }

    // Fallback: scan ALL pendingListing_* keys (handles SW death where GET_TAB_ID fails).
    // The per-tab key won't match because we don't know our tabId, but we can find
    // any pending listing data and use it. This is safe because there's typically only
    // one active listing flow, and the data is cleaned up after fill completes.
    try {
      const allData = await chrome.storage.local.get(null);
      const pendingKeys = Object.keys(allData).filter(k => k.startsWith('pendingListing_'));
      if (pendingKeys.length > 0) {
        // Use the most recently stored one (or the only one)
        const key = pendingKeys[pendingKeys.length - 1];
        console.log(`[DropFlow] Found pending data via scan: ${key} (tabId was ${tabId}, ${pendingKeys.length} keys found)`);
        return { data: allData[key], storageKey: key };
      }
    } catch (e) {
      console.warn('[DropFlow] Storage scan failed:', e?.message);
    }

    return null;
  }

  // Auto-fill if there's pending product data from "List on eBay" button or bulk poster
  async function checkPendingData() {
    console.log(`[DropFlow] checkPendingData() â€" URL: ${window.location.pathname}, host: ${window.location.hostname}, topFrame=${IS_TOP_FRAME}`);
    try {
      const pending = await getPendingData();
      if (!pending) {
        console.log('[DropFlow] No pending listing data found for this tab');
        return;
      }
      const { data: productData, storageKey } = pending;
      console.log(`[DropFlow] Found pending data (key=${storageKey}), hasVariations=${!!productData.variations?.hasVariations}, title="${(productData.title || '').substring(0, 40)}"`);

      const initialBuilderCtx = detectVariationBuilderContextWithLog('checkPendingData:initial');
      if (!IS_TOP_FRAME) {
        // Subframes only participate when they are likely to host the dedicated
        // variation builder. The bulkedit /msku iframe loads builder content
        // asynchronously after document_idle, so we must poll before giving up.
        const hasVariations = !!productData.variations?.hasVariations;
        if (!hasVariations) return;

        const subframePath = String(window.location.pathname || '');
        const subframeHost = String(window.location.hostname || '');
        const subframeHref = String(window.location.href || '');

        // Exclude eBay tracker/fingerprint iframes — they are never builder frames
        if (/devicebind\.ebay\./i.test(subframeHost)) {
          console.log(`[DropFlow] Subframe skipped (devicebind tracker): host=${subframeHost}`);
          return;
        }

        // Only trust URL-based signals - DOM heuristics (initialBuilderCtx.isBuilder)
        // produce false positives in non-builder iframes like /lstng/picupload (photo editor).
        // The variation builder ALWAYS lives on bulkedit.ebay.* subdomains.
        const isBulkEditHost =
          /(^|\.)bulkedit\.ebay\./i.test(subframeHost);
        const isLikelyBuilderFrame =
          isBulkEditHost ||
          /\/msku(?:\/|$|\?)/i.test(subframePath);

        if (!isLikelyBuilderFrame) {
          console.log(`[DropFlow] Subframe skipped (not builder candidate): host=${subframeHost}, path=${subframePath}`);
          return;
        }

        let builderCtx = initialBuilderCtx;
        const maxPolls = 60; // 60 * 500ms = 30s
        for (let poll = 0; poll <= maxPolls; poll++) {
          if (builderCtx.isBuilder) {
            console.warn('[DropFlow] Subframe builder detected; running variation builder flow in-frame');
            await logVariationStep('checkPendingData:subframeBuilderDetected', {
              url: window.location.href,
              score: builderCtx.score,
              poll
            });
            try {
              const builderOk = await runVariationBuilderPageFlow(productData, [], builderCtx.doc || document);
              await logVariationStep('checkPendingData:subframeBuilderResult', {
                url: window.location.href,
                ok: builderOk
              });
              if (builderOk) {
                // Signal parent that builder completed
                try { await chrome.storage.local.set({ dropflow_builder_complete: { ts: Date.now(), draftId: window.location.href } }); } catch (_) {}
                return; // Only exit on success
              }
              // BUG FIX: Builder returned false (e.g. Add button not yet rendered,
              // page still transitioning).  Don't return — wait and re-poll so we
              // retry once the UI has fully loaded.
              console.warn(`[DropFlow] Subframe builder attempt failed (poll=${poll}); will retry after delay`);
              await logVariationStep('checkPendingData:subframeBuilderRetry', { poll, url: window.location.href });
              await sleep(3000);
              builderCtx = detectVariationBuilderContextWithLog(`checkPendingData:subframeRetry:${poll}`);
              continue;
            } catch (err) {
              console.error('[DropFlow] Subframe builder flow error:', err);
              await logVariationStep('checkPendingData:subframeBuilderError', {
                url: window.location.href,
                error: String(err?.message || err).substring(0, 300),
                stack: String(err?.stack || '').substring(0, 500)
              });
              // On exception also retry rather than giving up permanently
              await sleep(3000);
              builderCtx = detectVariationBuilderContextWithLog(`checkPendingData:subframeError:${poll}`);
              continue;
            }
          }

          if (poll % 10 === 0) {
            console.warn(
              `[DropFlow] Subframe builder pending (poll=${poll}/${maxPolls}, score=${builderCtx.score || 0}, ` +
              `host=${subframeHost}, path=${subframePath})`
            );
          }

          await sleep(500);
          builderCtx = detectVariationBuilderContextWithLog(`checkPendingData:subframePoll:${poll + 1}`);
        }

        // Only force a builder attempt if we're on a bulkedit host - never in random iframes
        if (isBulkEditHost) {
          console.warn('[DropFlow] Subframe builder not detected within 30s; forcing one builder-flow attempt');
          const forcedOk = await runVariationBuilderPageFlow(productData, [], document);
          await logVariationStep('checkPendingData:subframeForcedAttempt', { forcedOk, url: window.location.href });
          if (forcedOk) return;
          console.warn('[DropFlow] Subframe forced builder-flow attempt failed');
        } else {
          console.warn(`[DropFlow] Subframe builder not detected within 30s and not on bulkedit host - giving up (host=${subframeHost})`);
        }
        return;
      }

      if (initialBuilderCtx.isBuilder) {
        const hasVariations = !!productData.variations?.hasVariations;
        console.log(`[DropFlow] Found pending data on variation builder page (hasVariations=${hasVariations}, isMskuDialog=${!!initialBuilderCtx.isMskuDialog})`);
        if (hasVariations) {
          // FIX: If MSKU dialog detected in parent frame, don't try to run builder
          // flow with parent's document — delegate to iframe and go to form fill instead.
          if (initialBuilderCtx.isMskuDialog && IS_TOP_FRAME) {
            console.warn('[DropFlow] MSKU dialog detected in checkPendingData — injecting into iframe and waiting');
            await logVariationStep('checkPendingData:mskuDialogDelegateToIframe', { url: window.location.href });
            // Inject form-filler into MSKU iframe
            try { await sendMessageSafe({ type: 'INJECT_FORM_FILLER_IN_FRAMES', url: window.location.href }, 5000); } catch (_) {}
            // Wait for iframe to complete (dialog closes or variations populate)
            const CHECK_PENDING_MSKU_MAX = 30; // Cap at 30 iterations (~15s)
            for (let mw = 0; mw < CHECK_PENDING_MSKU_MAX; mw++) {
              await sleep(500);
              const dialogOpen = !!document.querySelector('.msku-dialog, [class*="msku-dialog"]');
              if (!dialogOpen) {
                console.warn(`[DropFlow] MSKU dialog closed after ${mw * 500}ms`);
                await sleep(2000);
                if (checkVariationsPopulated()) {
                  console.warn('[DropFlow] Variations populated after MSKU dialog — running fillForm for remaining fields');
                  const results = await fillForm(productData);
                  if (results?.variations || checkVariationsPopulated()) {
                    await chrome.storage.local.remove(storageKey);
                    return;
                  }
                }
                break;
              }
              // Re-inject every 15s
              if (mw > 0 && mw % 30 === 0) {
                try { await sendMessageSafe({ type: 'INJECT_FORM_FILLER_IN_FRAMES', url: window.location.href }, 5000); } catch (_) {}
              }
              if (mw % 20 === 0) console.log(`[DropFlow] Waiting for MSKU iframe... ${mw * 500}ms`);
            }
            await logVariationStep('checkPendingData:mskuDialogWaitComplete', { url: window.location.href });
            watchForPageTransitions(storageKey);
            return;
          }
          // FIX: Before running builder in parent, double-check for MSKU iframe.
          // The iframe may not have been detected during initial context detection
          // (it loads asynchronously). Running the builder from parent would acquire
          // the cross-context lock and block the iframe's builder flow.
          if (IS_TOP_FRAME) {
            const lateIframe = findMskuBulkeditIframe();
            if (lateIframe) {
              console.warn('[DropFlow] MSKU iframe found (late detection) — delegating to iframe instead of running builder in parent');
              await logVariationStep('checkPendingData:lateMskuIframeDetected', { url: window.location.href });
              try { await sendMessageSafe({ type: 'INJECT_FORM_FILLER_IN_FRAMES', url: window.location.href }, 5000); } catch (_) {}
              // Wait briefly for iframe builder to complete
              for (let mw = 0; mw < 60; mw++) {
                await sleep(500);
                const dialogOpen = !!document.querySelector('.msku-dialog, [class*="msku-dialog"]');
                const iframeStillThere = !!findMskuBulkeditIframe();
                if (!dialogOpen && !iframeStillThere) {
                  await sleep(2000);
                  break;
                }
                // Check builder completion flag
                if (mw > 5 && mw % 5 === 0) {
                  try {
                    const stored = await chrome.storage.local.get('dropflow_builder_complete');
                    const cd = stored?.dropflow_builder_complete;
                    if (cd && (Date.now() - cd.ts) < 120000) {
                      await sleep(2000);
                      try { await chrome.storage.local.remove('dropflow_builder_complete'); } catch (_) {}
                      break;
                    }
                  } catch (_) {}
                }
              }
              watchForPageTransitions(storageKey);
              return;
            }
          }
          await runVariationBuilderPageFlow(productData, [], initialBuilderCtx.doc);
        }
        // Keep watching for transition back to listing form.
        watchForPageTransitions(storageKey);
      } else if (isIdentifyPage()) {
        // On "Find a match" page: run concurrent polling automation
        const hasVariations = !!productData.variations?.hasVariations;
        console.log(`[DropFlow] Found pending listing data on identify page (hasVariations=${hasVariations})`);
        await sleep(2000);
        runIdentifyPageLoop(hasVariations);
        // Start watching for SPA transitions to form page
        watchForPageTransitions(storageKey);
      } else if (isPrelistPage()) {
        // On prelist search page: type title and search
        console.log('[DropFlow] Found pending listing data on prelist page');
        await handlePrelistPage(productData);
        // Start watching for SPA transitions to identify/form pages
        watchForPageTransitions(storageKey);
      } else {
        // On actual form page: fill the form.
        // Keep pending data if variation flow is incomplete so we can continue on
        // dedicated variation builder transitions/retries.
        console.log('[DropFlow] On form page â€" auto-filling form...');
        sessionStorage.removeItem(PRELIST_FLAG_KEY);
        // NOTE: Do NOT remove storage before fillForm â€" data must survive re-injection
        await sleep(2000);
        const results = await fillForm(productData);
        console.log('[DropFlow] Auto-fill results:', results);
        const requiresVariations = !!productData?.variations?.hasVariations;
        if (requiresVariations && !results?.variations) {
          console.warn('[DropFlow] Variation flow incomplete on form page; keeping pending data for builder retry');
          await logVariationStep('checkPendingData:keepPendingAfterVariationIncomplete', {
            url: window.location.href
          });
          watchForPageTransitions(storageKey);
          return;
        }
        // Clean up storage AFTER form fill is complete
        await chrome.storage.local.remove(storageKey);
      }
    } catch (e) {
      console.error('[DropFlow] Auto-fill error:', e);
    }
  }

  // === SKU Backfill: targeted Custom Label setter + reader ===
  // === eBay Listing Revision: quantity / price / end listing ===
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SET_CUSTOM_LABEL') {
      handleSetCustomLabel(message).then(sendResponse).catch(err => {
        sendResponse({ error: err.message });
      });
      return true;
    }
    if (message.type === 'READ_CUSTOM_LABEL') {
      handleReadCustomLabel().then(sendResponse).catch(err => {
        sendResponse({ error: err.message });
      });
      return true;
    }
    if (message.type === 'REVISE_EBAY_LISTING') {
      handleReviseEbayListing(message).then(sendResponse).catch(err => {
        sendResponse({ error: err.message });
      });
      return true;
    }
  });

  /**
   * Read the Custom Label / SKU value from the listing revision form.
   * Waits for form to load, scrolls to reveal lazy sections, then reads the input.
   */
  async function handleReadCustomLabel() {
    console.log('[DropFlow] READ_CUSTOM_LABEL: Reading Custom Label from form...');

    await waitForFormReady(20000);
    await scrollPageToLoadAll();
    await sleep(1500);

    const skuInput = findCustomLabelInput();

    if (!skuInput) {
      console.warn('[DropFlow] Custom Label input not found on revision page');
      return { customLabel: '', found: false };
    }

    const value = (skuInput.value || '').trim();
    console.log(`[DropFlow] Custom Label value: "${value}"`);
    return { customLabel: value, found: true };
  }

  async function handleSetCustomLabel(message) {
    const { customLabel } = message;
    if (!customLabel) return { error: 'No customLabel provided' };

    console.log(`[DropFlow] SET_CUSTOM_LABEL: Setting "${customLabel}"`);

    // Wait for form to be ready (revision pages can take time)
    await waitForFormReady(20000);

    // Scroll page to load all lazy-loaded sections
    await scrollPageToLoadAll();
    await sleep(1500);

    // Find SKU / Custom Label input using robust multi-strategy search
    let skuInput = findCustomLabelInput();

    // If not found, try one more scroll + wait cycle
    if (!skuInput) {
      console.log('[DropFlow] SKU input not found on first pass, re-scrolling...');
      await scrollPageToLoadAll();
      await sleep(2000);
      skuInput = findCustomLabelInput();
    }

    if (!skuInput) {
      return { error: 'Custom Label input not found on page after 2 passes' };
    }

    await scrollToAndWait(skuInput, 500);
    await commitInputValue(skuInput, customLabel);
    console.log(`[DropFlow] Custom Label set to: ${customLabel}`);
    await sleep(1000);

    // Click save/update button
    const saved = await clickSaveRevision();

    return { success: true, saved, customLabel };
  }

  /**
   * Click the "Update listing" / "Revise listing" button on a revision page.
   * Similar to clickListIt() but handles revision-specific button text.
   */
  async function clickSaveRevision() {
    await sleep(2000);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    await sleep(1000);

    // Method 1: actionbar (handles both "List item" and "Update listing" / "Revise listing")
    const actionbar = document.getElementById('actionbar');
    if (actionbar) {
      const reviseBtn = actionbar.querySelector('[value="Update listing"]') ||
                        actionbar.querySelector('[value="Revise listing"]') ||
                        actionbar.querySelector('[value="Save and close"]') ||
                        actionbar.querySelector('[value="List item"]') ||
                        actionbar.querySelector('button[aria-label*="Update"]') ||
                        actionbar.querySelector('button[aria-label*="Revise"]') ||
                        actionbar.querySelector('button[aria-label*="Save"]') ||
                        actionbar.querySelector('button');
      if (reviseBtn && !reviseBtn.disabled) {
        reviseBtn.click();
        reviseBtn.click();
        console.log(`[DropFlow] Clicked revision save: "${reviseBtn.textContent.trim()}"`);
        return true;
      }
    }

    // Method 2: Text-based search â€" prefer "update"/"revise", only fall back to "save" if neither found
    const allBtns = Array.from(document.querySelectorAll('button'))
      .filter(b => !b.disabled && b.offsetParent !== null);
    const saveBtn = allBtns.find(b => {
      const text = b.textContent.trim().toLowerCase();
      return text.includes('update') || text.includes('revise');
    }) || allBtns.find(b => {
      const text = b.textContent.trim().toLowerCase();
      return text === 'save' || text === 'save and close';
    });
    if (saveBtn) {
      saveBtn.click();
      saveBtn.click();
      console.log(`[DropFlow] Clicked: "${saveBtn.textContent.trim()}"`);
      return true;
    }

    // Method 3: submit button fallback
    const submitBtn = document.querySelector('button[type="submit"]');
    if (submitBtn && !submitBtn.disabled) {
      submitBtn.click();
      submitBtn.click();
      return true;
    }

    console.warn('[DropFlow] Could not find revision save button');
    return false;
  }

  /**
   * Handle REVISE_EBAY_LISTING messages from the service worker.
   * Supports actions: 'set_quantity', 'set_price', 'end_listing'
   * Used by the Stock Monitor to auto-revise eBay listings when stock/price changes.
   */
  async function handleReviseEbayListing(message) {
    const { action, quantity, price } = message;
    if (!action) return { error: 'No action specified' };

    console.log(`[DropFlow] REVISE_EBAY_LISTING: action="${action}", qty=${quantity}, price=${price}`);

    // Wait for revision form to load
    await waitForFormReady(20000);
    await scrollPageToLoadAll();
    await sleep(1500);

    if (action === 'set_quantity') {
      return await reviseQuantity(quantity);
    } else if (action === 'set_price') {
      return await revisePrice(price);
    } else if (action === 'end_listing') {
      return await endListing();
    } else if (action === 'list_similar') {
      return await listSimilar();
    } else if (action === 'toggle_best_offer') {
      return await toggleBestOffer(message.enable);
    }

    return { error: `Unknown action: ${action}` };
  }

  /**
   * Set the quantity on an eBay revision page.
   */
  async function reviseQuantity(qty) {
    if (qty === undefined || qty === null) return { error: 'No quantity specified' };

    const qtyStr = String(qty);
    console.log(`[DropFlow] Setting quantity to: ${qtyStr}`);

    // Try multiple selectors for the quantity/available input
    let qtyInput = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await scrollPageToLoadAll();
        await sleep(1500);
      }
      qtyInput = document.querySelector('input[name="quantity"]') ||
                 document.querySelector('input[name="available"]') ||
                 document.querySelector('[data-testid="quantity-input"] input') ||
                 document.querySelector('[data-testid="qty-input"] input');

      // Fallback: find by label text
      if (!qtyInput) {
        const labels = Array.from(document.querySelectorAll('label'));
        for (const label of labels) {
          const text = label.textContent.trim().toLowerCase();
          if (text.includes('quantity') || text.includes('available')) {
            const forId = label.getAttribute('for');
            if (forId) {
              qtyInput = document.getElementById(forId);
            }
            if (!qtyInput) {
              qtyInput = label.closest('.form-group, .field, [class*="field"]')?.querySelector('input[type="text"], input[type="number"]');
            }
            if (qtyInput) break;
          }
        }
      }

      if (qtyInput) break;
    }

    if (!qtyInput) {
      console.warn('[DropFlow] Quantity input not found after 3 attempts');
      return { error: 'Quantity input not found' };
    }

    await scrollToAndWait(qtyInput, 500);
    await commitInputValue(qtyInput, qtyStr);
    console.log(`[DropFlow] Quantity set to: ${qtyStr}`);
    await sleep(1000);

    const saved = await clickSaveRevision();
    return { success: true, saved, quantity: qty };
  }

  /**
   * Set the price on an eBay revision page.
   */
  async function revisePrice(newPrice) {
    if (newPrice === undefined || newPrice === null) return { error: 'No price specified' };

    const priceStr = String(newPrice);
    console.log(`[DropFlow] Setting price to: ${priceStr}`);

    let priceInput = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await scrollPageToLoadAll();
        await sleep(1500);
      }
      priceInput = document.querySelector('input[name="price"]') ||
                   document.querySelector('[data-testid="price-input"] input') ||
                   document.querySelector('input[placeholder*="price" i]') ||
                   document.querySelector('.smry input[type="text"][name="price"]');
      if (priceInput) break;
    }

    if (!priceInput) {
      console.warn('[DropFlow] Price input not found after 3 attempts');
      return { error: 'Price input not found' };
    }

    await scrollToAndWait(priceInput, 500);
    await commitInputValue(priceInput, priceStr);
    console.log(`[DropFlow] Price set to: ${priceStr}`);
    await sleep(1000);

    const saved = await clickSaveRevision();
    return { success: true, saved, price: newPrice };
  }

  /**
   * End an eBay listing from the revision page.
   * Looks for "End listing" button or link.
   */
  async function endListing() {
    console.log('[DropFlow] Attempting to end listing...');

    // Strategy 1: Look for "End listing" button/link on revision page
    const allBtns = Array.from(document.querySelectorAll('button, a'));
    const endBtn = allBtns.find(el => {
      const text = el.textContent.trim().toLowerCase();
      return text.includes('end listing') || text.includes('end this listing') ||
             text.includes('delete listing') || text.includes('remove listing');
    });

    if (endBtn) {
      endBtn.click();
      console.log(`[DropFlow] Clicked: "${endBtn.textContent.trim()}"`);
      await sleep(2000);

      // Handle confirmation dialog if one appears
      const confirmBtns = Array.from(document.querySelectorAll('button'));
      const confirmBtn = confirmBtns.find(b => {
        const text = b.textContent.trim().toLowerCase();
        return text === 'end listing' || text === 'confirm' || text === 'yes' || text === 'end';
      });
      if (confirmBtn) {
        confirmBtn.click();
        console.log(`[DropFlow] Confirmed end listing: "${confirmBtn.textContent.trim()}"`);
      }

      return { success: true, action: 'end_listing' };
    }

    // Strategy 2: Set quantity to 0 as fallback (effectively ends/hides listing with OOS preference)
    console.warn('[DropFlow] End listing button not found, falling back to quantity=0');
    return await reviseQuantity(0);
  }

  /**
   * List Similar: click the "List item" / "List it" button on a Sell Similar form.
   * The form opens pre-filled with the original listing data â€" we just submit it.
   */
  async function listSimilar() {
    console.log('[DropFlow] Listing similar item...');

    // The Sell Similar page is a pre-filled listing form â€" just click submit
    const saved = await clickSaveRevision();

    if (saved) {
      console.log('[DropFlow] List Similar submitted successfully');
      return { success: true, action: 'list_similar' };
    }

    // Fallback: Look specifically for "List item" or "List it" buttons
    const allBtns = Array.from(document.querySelectorAll('button'))
      .filter(b => !b.disabled && b.offsetParent !== null);
    const listBtn = allBtns.find(b => {
      const text = b.textContent.trim().toLowerCase();
      return text === 'list item' || text === 'list it' || text.includes('list item') ||
             text.includes('list it') || text === 'submit';
    });

    if (listBtn) {
      listBtn.click();
      console.log(`[DropFlow] Clicked: "${listBtn.textContent.trim()}"`);
      return { success: true, action: 'list_similar' };
    }

    console.warn('[DropFlow] Could not find List Item button');
    return { error: 'List Item button not found' };
  }

  /**
   * Toggle Best Offer on/off on an eBay revision page.
   */
  async function toggleBestOffer(enable) {
    console.log(`[DropFlow] Toggling Best Offer: ${enable ? 'ON' : 'OFF'}`);

    let bestOfferToggle = null;

    for (let attempt = 0; attempt < 3 && !bestOfferToggle; attempt++) {
      if (attempt > 0) {
        await scrollPageToLoadAll();
        await sleep(1500);
      }

      // Strategy 1: Named input
      bestOfferToggle = document.querySelector('input[name="bestOffer"]') ||
                        document.querySelector('input[name="best_offer"]') ||
                        document.querySelector('[data-testid="best-offer-toggle"] input') ||
                        document.querySelector('[data-testid="bestOffer"] input');

      // Strategy 2: Label text search
      if (!bestOfferToggle) {
        const labels = Array.from(document.querySelectorAll('label'));
        for (const label of labels) {
          const text = label.textContent.trim().toLowerCase();
          if (text.includes('best offer') || text.includes('allow offer') || text.includes('accept offer')) {
            const forId = label.getAttribute('for');
            if (forId) {
              bestOfferToggle = document.getElementById(forId);
            }
            if (!bestOfferToggle) {
              bestOfferToggle = label.querySelector('input[type="checkbox"], input[type="radio"]');
            }
            if (!bestOfferToggle) {
              // May be a toggle switch
              bestOfferToggle = label.closest('.form-group, .field, [class*="field"]')?.querySelector('input[type="checkbox"], [role="switch"], [role="checkbox"]');
            }
            if (bestOfferToggle) break;
          }
        }
      }

      // Strategy 3: Role-based search
      if (!bestOfferToggle) {
        const switches = document.querySelectorAll('[role="switch"], [role="checkbox"]');
        for (const sw of switches) {
          const nearby = sw.closest('[class*="best-offer"], [class*="bestOffer"]');
          if (nearby) { bestOfferToggle = sw; break; }
          const label = sw.getAttribute('aria-label') || '';
          if (/best.?offer/i.test(label)) { bestOfferToggle = sw; break; }
        }
      }
    }

    if (!bestOfferToggle) {
      console.warn('[DropFlow] Best Offer toggle not found after 3 attempts');
      return { error: 'Best Offer toggle not found' };
    }

    await scrollToAndWait(bestOfferToggle, 500);

    // Determine current state and toggle if needed
    const isCheckbox = bestOfferToggle.type === 'checkbox';
    const isSwitch = bestOfferToggle.getAttribute('role') === 'switch' || bestOfferToggle.getAttribute('role') === 'checkbox';

    if (isCheckbox) {
      const currentlyChecked = bestOfferToggle.checked;
      if ((enable && !currentlyChecked) || (!enable && currentlyChecked)) {
        bestOfferToggle.click();
        console.log(`[DropFlow] Toggled Best Offer checkbox: ${enable ? 'ON' : 'OFF'}`);
      } else {
        console.log(`[DropFlow] Best Offer already ${enable ? 'ON' : 'OFF'}, no change needed`);
      }
    } else if (isSwitch) {
      const isOn = bestOfferToggle.getAttribute('aria-checked') === 'true';
      if ((enable && !isOn) || (!enable && isOn)) {
        bestOfferToggle.click();
        console.log(`[DropFlow] Toggled Best Offer switch: ${enable ? 'ON' : 'OFF'}`);
      }
    } else {
      // Generic element â€" just click it
      bestOfferToggle.click();
    }

    await sleep(1000);

    const saved = await clickSaveRevision();
    return { success: true, saved, action: 'toggle_best_offer', enabled: enable };
  }

  checkPendingData();

  console.log('[DropFlow] eBay form filler loaded');
})();
