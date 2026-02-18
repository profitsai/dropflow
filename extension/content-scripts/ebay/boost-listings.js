/**
 * DropFlow Boost My Listings — Content Script
 * Runs on eBay Seller Hub active/ended listings pages.
 * Handles DOM manipulation for ending, relisting, revising listings.
 * 
 * Defensive selectors used throughout — eBay's Marko.js SPA changes DOM frequently.
 */

// Double-injection guard
if (window.__dropflow_boost_listings_loaded) {
  // Already loaded
} else {
  window.__dropflow_boost_listings_loaded = true;

  // ============================================================
  // Helpers
  // ============================================================

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Wait for a selector to appear in DOM, with timeout */
  function waitForElement(selector, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`waitForElement: "${selector}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /** Click an element with native event dispatch */
  function safeClick(el) {
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.click();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }

  /** Set input value using native setter for React/Marko compatibility */
  function setInputValue(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, String(value));
    else input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Get all listing rows from the Seller Hub table */
  function getListingRows() {
    // Try multiple selectors — eBay changes DOM structure
    const selectors = [
      'table.grid-table tbody tr',
      '[class*="listing-table"] tbody tr',
      '.shui-dt-body tr',
      'table tbody tr',
      '[data-testid*="listing"] tr'
    ];
    for (const sel of selectors) {
      const rows = document.querySelectorAll(sel);
      if (rows.length > 0) return Array.from(rows);
    }
    return [];
  }

  /** Parse a time-left text like "3d 12h", "5h 30m", "2d" into total hours */
  function parseTimeLeftToHours(text) {
    if (!text) return Infinity;
    const dMatch = text.match(/(\d+)\s*d/i);
    const hMatch = text.match(/(\d+)\s*h/i);
    const mMatch = text.match(/(\d+)\s*m/i);
    return (dMatch ? parseInt(dMatch[1], 10) * 24 : 0) +
           (hMatch ? parseInt(hMatch[1], 10) : 0) +
           (mMatch ? parseInt(mMatch[1], 10) / 60 : 0);
  }

  /** Extract numeric value from text containing numbers */
  function extractNumber(text) {
    if (!text) return 0;
    const match = text.replace(/,/g, '').match(/([\d.]+)/);
    return match ? parseFloat(match[1]) : 0;
  }

  /** Find text content in a row's cells by column header or cell content patterns */
  function getCellText(row, patterns) {
    const cells = row.querySelectorAll('td, [role="cell"]');
    for (const cell of cells) {
      const text = (cell.textContent || '').trim();
      for (const pattern of patterns) {
        if (pattern instanceof RegExp ? pattern.test(text) : text.toLowerCase().includes(pattern.toLowerCase())) {
          return text;
        }
      }
    }
    return '';
  }

  /** Select/check the checkbox in a listing row */
  function selectRow(row) {
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb && !cb.checked) {
      safeClick(cb);
      return true;
    }
    return cb?.checked || false;
  }

  /** Click the "select all" checkbox */
  function selectAllRows() {
    const selectors = [
      'thead input[type="checkbox"]',
      '[aria-label*="select all" i]',
      'th input[type="checkbox"]',
      '.select-all input[type="checkbox"]'
    ];
    for (const sel of selectors) {
      const cb = document.querySelector(sel);
      if (cb) {
        if (!cb.checked) safeClick(cb);
        return true;
      }
    }
    return false;
  }

  /** Find and click a button by text content */
  function findAndClickButton(textPatterns, container = document) {
    const btns = Array.from(container.querySelectorAll('button, [role="button"], a.btn, [class*="button"]'));
    for (const btn of btns) {
      const btnText = (btn.textContent || '').trim().toLowerCase();
      for (const pattern of textPatterns) {
        const p = typeof pattern === 'string' ? pattern.toLowerCase() : pattern;
        if (typeof p === 'string' ? btnText.includes(p) : p.test(btnText)) {
          safeClick(btn);
          return true;
        }
      }
    }
    return false;
  }

  /** Find a dropdown/select and pick an option by text or value */
  async function selectDropdownOption(selectEl, value) {
    if (!selectEl) return false;
    if (selectEl.tagName === 'SELECT') {
      selectEl.value = value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    // Custom dropdown — click to open, then find option
    safeClick(selectEl);
    await sleep(500);
    const options = document.querySelectorAll('[role="option"], [class*="menu-item"], li[class*="option"]');
    for (const opt of options) {
      if ((opt.textContent || '').trim().toLowerCase().includes(String(value).toLowerCase())) {
        safeClick(opt);
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // Message Handler
  // ============================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type, ...payload } = message;

    switch (type) {

      // --------------------------------------------------------
      // END_LOW_PERFORMING_ITEMS
      // Filter listing rows by sold count/views/time remaining,
      // select matching ones, click End action
      // --------------------------------------------------------
      case 'END_LOW_PERFORMING_ITEMS': {
        (async () => {
          try {
            const { minSold = 0, minViews = 1000, filterByHours = 24 } = payload;
            await sleep(2000); // Wait for page to settle

            const rows = getListingRows();
            if (rows.length === 0) {
              sendResponse({ success: false, error: 'No listing rows found', ended: 0 });
              return;
            }

            let selectedCount = 0;

            for (const row of rows) {
              const cells = Array.from(row.querySelectorAll('td, [role="cell"]'));
              const rowText = row.textContent || '';

              // Extract sold count — look for columns with small numbers near "sold"
              let sold = 0;
              let views = 0;
              let hoursLeft = Infinity;

              for (const cell of cells) {
                const text = (cell.textContent || '').trim();
                const lowerText = text.toLowerCase();

                // Sold quantity: usually a standalone small number, or has "sold" nearby
                if (/^\d{1,4}$/.test(text) && (cell.previousElementSibling?.textContent || '').toLowerCase().includes('sold')) {
                  sold = parseInt(text, 10);
                }
                // Views: usually larger numbers
                if (/^\d{1,6}$/.test(text.replace(/,/g, '')) && (cell.previousElementSibling?.textContent || '').toLowerCase().includes('view')) {
                  views = extractNumber(text);
                }
                // Time left: patterns like "3d 12h", "5h", "29d"
                if (/\d+\s*[dhm]/i.test(text) && text.length < 20) {
                  const parsed = parseTimeLeftToHours(text);
                  if (parsed < hoursLeft) hoursLeft = parsed;
                }
              }

              // Also try extracting from aria-labels or data attributes
              const soldEl = row.querySelector('[data-field*="sold" i], [class*="sold" i]');
              if (soldEl) sold = extractNumber(soldEl.textContent);

              const viewsEl = row.querySelector('[data-field*="view" i], [class*="view" i], [data-field*="watch" i]');
              if (viewsEl) views = extractNumber(viewsEl.textContent);

              const timeEl = row.querySelector('[data-field*="time" i], [class*="time-left" i], [class*="timeLeft" i]');
              if (timeEl) hoursLeft = parseTimeLeftToHours(timeEl.textContent);

              // Apply filters
              const soldOk = sold <= minSold;
              const viewsOk = views <= minViews;
              const hoursOk = hoursLeft <= filterByHours;

              if (soldOk && viewsOk && hoursOk) {
                if (selectRow(row)) selectedCount++;
              }
            }

            if (selectedCount === 0) {
              sendResponse({ success: true, ended: 0, message: 'No items matched filters' });
              return;
            }

            await sleep(1000);

            // Click the bulk action dropdown and select "End"
            const actionClicked = await clickBulkAction(['end', 'end listing', 'end item']);

            if (!actionClicked) {
              sendResponse({ success: false, error: 'Could not find End action button', selected: selectedCount });
              return;
            }

            await sleep(2000);

            // Confirm the end action if a confirmation dialog appears
            findAndClickButton(['confirm', 'end listing', 'end item', 'yes', 'ok']);
            await sleep(3000);

            sendResponse({ success: true, ended: selectedCount, message: `Selected and ended ${selectedCount} items` });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
        })();
        return true;
      }

      // --------------------------------------------------------
      // SELL_SIMILAR_ENDED_ITEMS
      // On ended listings page, select items, click Sell Similar
      // --------------------------------------------------------
      case 'SELL_SIMILAR_ENDED_ITEMS': {
        (async () => {
          try {
            await sleep(2000);

            const rows = getListingRows();
            if (rows.length === 0) {
              sendResponse({ success: true, selected: 0, message: 'No ended listings found' });
              return;
            }

            // Select all ended items (or filter by specific item IDs if provided)
            const { itemIds } = payload;
            let selectedCount = 0;

            if (itemIds && itemIds.length > 0) {
              // Select specific items
              for (const row of rows) {
                const rowText = row.textContent || '';
                if (itemIds.some(id => rowText.includes(id))) {
                  if (selectRow(row)) selectedCount++;
                }
              }
            } else {
              // Select all
              selectAllRows();
              selectedCount = rows.length;
            }

            await sleep(1000);

            // Click "Sell Similar" bulk action
            const clicked = await clickBulkAction(['sell similar', 'relist', 'sell similar item']);

            if (!clicked) {
              sendResponse({ success: false, error: 'Could not find Sell Similar action', selected: selectedCount });
              return;
            }

            await sleep(2000);
            findAndClickButton(['confirm', 'yes', 'ok', 'continue']);
            await sleep(3000);

            sendResponse({ success: true, selected: selectedCount, message: `Sell Similar triggered for ${selectedCount} items` });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
        })();
        return true;
      }

      // --------------------------------------------------------
      // SUBMIT_BULK_EDIT_FORM
      // Submit the bulk edit/relist form
      // --------------------------------------------------------
      case 'SUBMIT_BULK_EDIT_FORM': {
        (async () => {
          try {
            await sleep(3000);

            // Look for submit/list button on bulk edit page
            const submitted = findAndClickButton([
              'submit', 'list', 'list item', 'save and close',
              'confirm', 'save', /^list\s/i, 'relist'
            ]);

            if (!submitted) {
              // Try form submit
              const form = document.querySelector('form');
              if (form) {
                form.submit();
                sendResponse({ success: true, message: 'Form submitted' });
                return;
              }
              sendResponse({ success: false, error: 'No submit button or form found' });
              return;
            }

            await sleep(5000);
            sendResponse({ success: true, message: 'Bulk edit form submitted' });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
        })();
        return true;
      }

      // --------------------------------------------------------
      // REVISE_ITEMS
      // Toggle offers on/off for visible listings
      // --------------------------------------------------------
      case 'REVISE_ITEMS': {
        (async () => {
          try {
            const { offersOption = 0 } = payload; // 0 = turn on, 1 = turn off
            await sleep(2000);

            // Select all listings
            selectAllRows();
            await sleep(1000);

            // Click "Edit" or "Revise" bulk action
            const editClicked = await clickBulkAction(['edit', 'revise', 'bulk edit']);
            if (!editClicked) {
              sendResponse({ success: false, error: 'Could not find Edit/Revise action' });
              return;
            }
            await sleep(3000);

            // Look for Best Offer toggle/dropdown
            const offerElements = document.querySelectorAll(
              'select, [class*="offer"], [class*="best-offer"], input[type="checkbox"]'
            );

            let toggled = false;
            for (const el of offerElements) {
              const labelText = (el.closest('label, .form-group, [class*="field"]')?.textContent || '').toLowerCase();
              if (labelText.includes('offer') || labelText.includes('best offer')) {
                if (el.tagName === 'SELECT') {
                  el.value = offersOption === 0 ? 'true' : 'false';
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  toggled = true;
                } else if (el.type === 'checkbox') {
                  const shouldBeChecked = offersOption === 0;
                  if (el.checked !== shouldBeChecked) safeClick(el);
                  toggled = true;
                }
                break;
              }
            }

            // Submit the revision
            findAndClickButton(['apply', 'save', 'submit', 'confirm', 'update']);
            await sleep(3000);

            sendResponse({
              success: true,
              toggled,
              message: `Offers ${offersOption === 0 ? 'enabled' : 'disabled'} for visible listings`
            });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
        })();
        return true;
      }

      // --------------------------------------------------------
      // COUNT_MENU_OPTIONS
      // Count pagination pages
      // --------------------------------------------------------
      case 'COUNT_MENU_OPTIONS': {
        (async () => {
          try {
            await sleep(2000);
            const paginationSelectors = [
              '.pagination a, .pagination button, .pagination li',
              '[class*="pagination"] a, [class*="pagination"] button',
              'nav[aria-label*="page" i] a',
              '[class*="pager"] a'
            ];

            let maxPage = 1;
            for (const sel of paginationSelectors) {
              const els = document.querySelectorAll(sel);
              for (const el of els) {
                const num = parseInt((el.textContent || '').trim(), 10);
                if (!isNaN(num) && num > maxPage) maxPage = num;
              }
              if (maxPage > 1) break;
            }

            // Also check for "X results" text to estimate
            const resultsText = document.body?.textContent?.match(/(\d[\d,]*)\s+results?/i);
            if (resultsText) {
              const total = parseInt(resultsText[1].replace(/,/g, ''), 10);
              const perPage = 200; // eBay Seller Hub limit=200
              const estimated = Math.ceil(total / perPage);
              if (estimated > maxPage) maxPage = estimated;
            }

            sendResponse({ success: true, totalPages: maxPage });
          } catch (e) {
            sendResponse({ success: false, error: e.message, totalPages: 1 });
          }
        })();
        return true;
      }

      // --------------------------------------------------------
      // CLICK_MENU_OPTION
      // Navigate to specific page number
      // --------------------------------------------------------
      case 'CLICK_MENU_OPTION': {
        (async () => {
          try {
            const { pageNumber = 1 } = payload;
            await sleep(1000);

            // Try clicking the page number in pagination
            const paginationLinks = document.querySelectorAll(
              '.pagination a, .pagination button, [class*="pagination"] a, nav[aria-label*="page" i] a'
            );

            let clicked = false;
            for (const link of paginationLinks) {
              if ((link.textContent || '').trim() === String(pageNumber)) {
                safeClick(link);
                clicked = true;
                break;
              }
            }

            if (!clicked) {
              // Try URL manipulation
              const url = new URL(window.location.href);
              url.searchParams.set('page', pageNumber);
              window.location.href = url.toString();
            }

            await sleep(3000);
            sendResponse({ success: true, page: pageNumber });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
        })();
        return true;
      }

      // --------------------------------------------------------
      // SEND_WATCHER_OFFERS
      // On eligible listings page, trigger offer sending
      // --------------------------------------------------------
      case 'SEND_WATCHER_OFFERS': {
        (async () => {
          try {
            const { percent = 5 } = payload;
            await sleep(2000);

            // Select all eligible listings
            selectAllRows();
            await sleep(1000);

            // Click "Send Offer" in bulk actions
            const clicked = await clickBulkAction(['send offer', 'send offers', 'offer']);
            if (!clicked) {
              // Try individual send offer buttons
              const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
              const sendBtn = btns.find(b => /send\s*offer/i.test(b.textContent || ''));
              if (sendBtn) safeClick(sendBtn);
              else {
                sendResponse({ success: false, error: 'Could not find Send Offer action' });
                return;
              }
            }

            await sleep(3000);

            // Fill in discount percentage in the modal
            const inputs = document.querySelectorAll('input[type="text"], input[type="number"]');
            for (const input of inputs) {
              const context = (input.closest('label, .form-group, [class*="field"], [class*="modal"]')?.textContent || '').toLowerCase();
              const placeholder = (input.placeholder || '').toLowerCase();
              if (/percent|discount|%|offer/i.test(context + placeholder)) {
                setInputValue(input, percent);
                break;
              }
            }

            await sleep(1000);

            // Confirm
            findAndClickButton(['send', 'send offer', 'confirm', 'apply', 'submit']);
            await sleep(5000);

            sendResponse({ success: true, message: `Sent offers at ${percent}%` });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
        })();
        return true;
      }

      // --------------------------------------------------------
      // REVIEW_PENDING_OFFERS
      // Review and action pending offers based on markup threshold
      // --------------------------------------------------------
      case 'REVIEW_PENDING_OFFERS': {
        (async () => {
          try {
            const { markupMultiplier = 1.5 } = payload;
            await sleep(2000);

            const rows = getListingRows();
            let accepted = 0;
            let declined = 0;

            for (const row of rows) {
              const cells = Array.from(row.querySelectorAll('td, [role="cell"]'));
              
              // Extract prices from row
              let offerPrice = 0;
              let listingPrice = 0;
              let costPrice = 0;

              for (const cell of cells) {
                const text = (cell.textContent || '').trim();
                const priceMatch = text.match(/[$£€AUD]*\s*([\d,]+\.?\d*)/);
                if (priceMatch) {
                  const val = parseFloat(priceMatch[1].replace(/,/g, ''));
                  if (val > 0) {
                    if (!offerPrice) offerPrice = val;
                    else if (!listingPrice) listingPrice = val;
                    else if (!costPrice) costPrice = val;
                  }
                }
              }

              if (offerPrice <= 0) continue;

              // Check if offer meets markup threshold
              // If we have cost, check markup; otherwise compare to listing price
              let meetsThreshold = false;
              if (costPrice > 0) {
                meetsThreshold = offerPrice >= costPrice * markupMultiplier;
              } else if (listingPrice > 0) {
                // Accept if offer is at least (markupMultiplier - 1) * 100% of listing price
                meetsThreshold = offerPrice >= listingPrice * (markupMultiplier / (markupMultiplier + 0.5));
              }

              const btns = Array.from(row.querySelectorAll('button, [role="button"]'));
              
              if (meetsThreshold) {
                const acceptBtn = btns.find(b => /accept/i.test(b.textContent || ''));
                if (acceptBtn) {
                  safeClick(acceptBtn);
                  accepted++;
                  await sleep(2000);
                  // Confirm if dialog appears
                  findAndClickButton(['confirm', 'yes', 'ok']);
                  await sleep(1000);
                }
              } else {
                const declineBtn = btns.find(b => /decline|reject/i.test(b.textContent || ''));
                if (declineBtn) {
                  safeClick(declineBtn);
                  declined++;
                  await sleep(2000);
                  findAndClickButton(['confirm', 'yes', 'ok']);
                  await sleep(1000);
                }
              }
            }

            sendResponse({
              success: true,
              accepted,
              declined,
              total: rows.length,
              message: `Reviewed ${rows.length} offers: ${accepted} accepted, ${declined} declined`
            });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
        })();
        return true;
      }

      default:
        break;
    }
  });

  // ============================================================
  // Bulk Action Helper
  // ============================================================

  /** Click a bulk action from the Seller Hub actions dropdown */
  async function clickBulkAction(actionTexts) {
    // Try direct buttons first
    if (findAndClickButton(actionTexts)) return true;

    // Try opening a dropdown menu first
    const dropdownTriggers = document.querySelectorAll(
      '[class*="bulk-action"] button, [class*="action"] select, ' +
      'button[aria-haspopup], [class*="dropdown"] button, ' +
      '[data-testid*="action"] button, select[class*="action"]'
    );

    for (const trigger of dropdownTriggers) {
      if (trigger.tagName === 'SELECT') {
        // It's a <select> — find matching option
        const options = Array.from(trigger.options);
        for (const opt of options) {
          const optText = (opt.text || opt.textContent || '').toLowerCase();
          if (actionTexts.some(t => optText.includes(typeof t === 'string' ? t.toLowerCase() : ''))) {
            trigger.value = opt.value;
            trigger.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
      } else {
        safeClick(trigger);
        await sleep(800);
        // Look for dropdown menu items
        if (findAndClickButton(actionTexts)) return true;
      }
    }

    return false;
  }

  console.log('[DropFlow] Boost listings content script loaded');
}
