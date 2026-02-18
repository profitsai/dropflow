/**
 * DropFlow Variant Selection Utility
 *
 * Shared logic for matching and selecting product variants on supplier pages.
 * Used by both AliExpress and Amazon auto-order content scripts.
 */

/**
 * Fuzzy-match two strings: lowercase, trim, and check containment both ways.
 * Returns true if either string contains the other.
 */
export function fuzzyMatch(a, b) {
  if (!a || !b) return false;
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

/**
 * Parse a variant text like "Red / XL" into an array of individual option strings.
 */
export function parseVariantText(text) {
  if (!text) return [];
  return text.split(/\s*[\/|,;]\s*/).map(s => s.trim()).filter(Boolean);
}

/**
 * From sourceVariant data, extract the list of option values to select on the supplier page.
 *
 * sourceVariant shape (from sale-poller resolveVariant):
 *   { sourceVariantText: "Red / XL", sourceVariantId, specifics: { Color: "Red", Size: "XL" }, ... }
 *   OR { ebayVariant: "Color: Red, Size: XL", ... }
 */
export function getVariantOptions(sourceVariant) {
  if (!sourceVariant) return [];

  // Prefer sourceVariantText (already mapped to supplier naming)
  if (sourceVariant.sourceVariantText) {
    return parseVariantText(sourceVariant.sourceVariantText);
  }

  // Fall back to specifics values
  if (sourceVariant.specifics && typeof sourceVariant.specifics === 'object') {
    const vals = Object.values(sourceVariant.specifics).filter(Boolean);
    if (vals.length) return vals;
  }

  // Last resort: parse ebayVariant text
  if (sourceVariant.ebayVariant) {
    // "Color: Red, Size: XL" → extract values
    const parts = sourceVariant.ebayVariant.split(/[,;]/).map(s => s.trim());
    const vals = parts.map(p => {
      const colonIdx = p.indexOf(':');
      return colonIdx >= 0 ? p.slice(colonIdx + 1).trim() : p;
    }).filter(Boolean);
    if (vals.length) return vals;
  }

  return [];
}

/**
 * Find the best matching element from a list of candidate elements.
 * Tries exact match first, then fuzzy match.
 *
 * @param {string} optionValue - The variant option to match (e.g. "Red")
 * @param {Array<{element: Element, text: string}>} candidates - Clickable elements with their text
 * @returns {{ element: Element, matchType: 'exact'|'fuzzy' } | null}
 */
export function findBestMatch(optionValue, candidates) {
  if (!optionValue || !candidates.length) return null;

  const target = optionValue.toLowerCase().trim();

  // Exact match (case-insensitive, trimmed)
  for (const c of candidates) {
    if (c.text.toLowerCase().trim() === target) {
      return { element: c.element, matchType: 'exact' };
    }
  }

  // Fuzzy match (containment)
  for (const c of candidates) {
    if (fuzzyMatch(c.text, optionValue)) {
      return { element: c.element, matchType: 'fuzzy' };
    }
  }

  return null;
}

/**
 * Select variants on an AliExpress product page.
 *
 * AliExpress uses `.sku-item` buttons in `.sku-property-list` containers.
 * Each property group (Color, Size, etc.) is a `.sku-property-item`.
 *
 * @param {object} sourceVariant - The variant info from pending checkout
 * @returns {{ success: boolean, selected: string[], warnings: string[] }}
 */
export async function selectAliExpressVariants(sourceVariant, doc = document) {
  const options = getVariantOptions(sourceVariant);
  if (!options.length) return { success: true, selected: [], warnings: [] };

  const selected = [];
  const warnings = [];

  // Get all SKU property groups
  const propertyGroups = doc.querySelectorAll(
    '.sku-property-item, [class*="sku-property-item"], [class*="skuPropertyItem"]'
  );

  // Collect all clickable SKU items across all groups
  const allSkuItems = doc.querySelectorAll(
    '.sku-item, [class*="sku-item"], [class*="skuItem"], ' +
    '.sku-property-item button, [class*="sku-property"] button'
  );

  // Build candidates list with text from each sku item
  const candidates = [];
  for (const el of allSkuItems) {
    // Text can be in the element itself, a child span, or an img alt/title
    let text = el.textContent?.trim() || '';
    if (!text) {
      const img = el.querySelector('img');
      text = img?.alt?.trim() || img?.title?.trim() || '';
    }
    if (!text) {
      text = el.getAttribute('title')?.trim() || '';
    }
    if (text) {
      candidates.push({ element: el, text });
    }
  }

  for (const option of options) {
    const match = findBestMatch(option, candidates);
    if (match) {
      match.element.click();
      selected.push(`${option} (${match.matchType})`);
      // Small delay between selections
      await sleep(500);
    } else {
      warnings.push(`No match found for variant option "${option}"`);
    }
  }

  if (warnings.length && !selected.length) {
    return { success: false, selected, warnings };
  }

  return { success: true, selected, warnings };
}

/**
 * Select variants on an Amazon product page.
 *
 * Amazon uses variation selectors like:
 *   #variation_color_name (buttons/swatches)
 *   #variation_size_name (dropdown or buttons)
 *   #variation_style_name, etc.
 *
 * @param {object} sourceVariant - The variant info from pending checkout
 * @returns {{ success: boolean, selected: string[], warnings: string[] }}
 */
export async function selectAmazonVariants(sourceVariant, doc = document) {
  const options = getVariantOptions(sourceVariant);
  if (!options.length) return { success: true, selected: [], warnings: [] };

  const selected = [];
  const warnings = [];

  // Find all variation containers
  const variationContainers = doc.querySelectorAll(
    '[id^="variation_"], .a-button-toggle-group, #twister .a-row'
  );

  // Strategy 1: Try button/swatch selectors within variation containers
  for (const option of options) {
    let matched = false;

    // Check button-style selectors (color swatches, size buttons)
    const buttons = doc.querySelectorAll(
      '[id^="variation_"] li, [id^="variation_"] .a-button-text, ' +
      '.swatchAvailable, .swatchSelect, ' +
      '#twister .a-button:not(.a-button-unavailable)'
    );

    const candidates = [];
    for (const el of buttons) {
      let text = el.textContent?.trim() || '';
      if (!text) {
        const img = el.querySelector('img');
        text = img?.alt?.trim() || img?.title?.trim() || '';
      }
      if (!text) {
        text = el.getAttribute('title')?.trim() || '';
      }
      if (text) {
        candidates.push({ element: el, text });
      }
    }

    const match = findBestMatch(option, candidates);
    if (match) {
      match.element.click();
      selected.push(`${option} (${match.matchType})`);
      matched = true;
      await sleep(500);
      continue;
    }

    // Strategy 2: Try dropdown selectors
    const dropdowns = doc.querySelectorAll(
      '[id^="variation_"] select, #native_dropdown_selected_size_name, ' +
      'select[name*="variation"], select[id*="variation"]'
    );

    for (const dropdown of dropdowns) {
      const selectOptions = dropdown.querySelectorAll('option');
      for (const opt of selectOptions) {
        const optText = opt.textContent?.trim() || '';
        if (fuzzyMatch(optText, option)) {
          dropdown.value = opt.value;
          dropdown.dispatchEvent(new Event('change', { bubbles: true }));
          selected.push(`${option} (dropdown)`);
          matched = true;
          await sleep(500);
          break;
        }
      }
      if (matched) break;
    }

    if (!matched) {
      warnings.push(`No match found for variant option "${option}"`);
    }
  }

  if (warnings.length && !selected.length) {
    return { success: false, selected, warnings };
  }

  return { success: true, selected, warnings };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
