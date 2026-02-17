/**
 * Amazon stock availability detection.
 * Matches availability text against known "in stock" and "out of stock" patterns
 * in multiple languages (EN, EN-AU, DE, ES, FR, IT, NL).
 */

const IN_STOCK_PATTERNS = [
  // English (US)
  /^in stock/i,
  /^only \d+ left in stock/i,
  /^only \d+ left in stock - order soon/i,
  /^only \d+ left in stock \(more on the way\)/i,
  /^available to ship in 1-2 days/i,
  /^usually ships within \d+ to \d+ days/i,
  // English (AU/UK) — Australian Amazon uses "dispatched" instead of "shipped"
  /^usually dispatched within \d+ to \d+ days/i,
  /^usually dispatched within \d+ to \d+ business days/i,
  /^available to dispatch/i,
  /^in stock\./i,
  /^temporarily out of stock.*order now/i,
  /^left in stock/i,
  // German
  /^auf lager/i,
  /^nur noch \d+ auf lager/i,
  /^nur noch \d+ auf lager \(mehr ist unterwegs\)/i,
  /^gewöhnlich versandfertig in \d+ bis \d+ tagen/i,
  // Spanish
  /^en stock/i,
  /^solo queda[n]? \d+ en stock/i,
  /^disponible para enviarse en 1-2 días/i,
  // Italian
  /^disponibilit[àa] immediata/i,
  /^solo \d+ rimast[io] in stock/i,
  /^disponibile in 1-2 giorni/i,
  // French
  /^en stock/i,
  /^seulement \d+ exemplaire[s]? en stock/i,
  /^il ne reste plus que \d+ exemplaire[s]? en stock/i,
  /^disponible/i,
  /^habituellement expédié sous \d+ à \d+ jours/i,
  // Dutch
  /^op voorraad/i,
  /^nog maar \d+ op voorraad/i,
  /^beschikbaar om te verzenden in 1-2 dagen/i
];

const OUT_OF_STOCK_PATTERNS = [
  /currently unavailable/i,
  /out of stock/i,
  /temporarily out of stock/i,
  /nicht verfügbar/i,         // German
  /derzeit nicht verfügbar/i,  // German
  /no disponible/i,            // Spanish
  /non disponibile/i,          // Italian
  /actuellement indisponible/i, // French
  /en rupture de stock/i,       // French
  /temporairement en rupture de stock/i, // French
  /niet beschikbaar/i          // Dutch
];

/**
 * Check if a product is in stock based on availability text.
 * @param {string} text - The availability text from the Amazon page
 * @returns {{ inStock: boolean, quantity: number|null, text: string }}
 */
function checkAvailability(text) {
  if (!text) return { inStock: false, quantity: null, text: '' };

  const cleaned = text.trim().toLowerCase();

  // Check out of stock first
  for (const pattern of OUT_OF_STOCK_PATTERNS) {
    if (pattern.test(cleaned)) {
      return { inStock: false, quantity: 0, text: cleaned };
    }
  }

  // Check in stock
  for (const pattern of IN_STOCK_PATTERNS) {
    if (pattern.test(cleaned)) {
      // Try to extract quantity
      const qtyMatch = cleaned.match(/(\d+)\s*(?:left|rimast|queda|auf lager|op voorraad|exemplaire)/i);
      const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : null;
      return { inStock: true, quantity, text: cleaned };
    }
  }

  // Default: if text contains "stock" or "available" type words, assume in stock
  if (/in stock|available|dispatch|auf lager|disponib|op voorraad|en stock|expédié|versandfertig/i.test(cleaned)) {
    return { inStock: true, quantity: null, text: cleaned };
  }

  return { inStock: false, quantity: null, text: cleaned };
}

// Expose to window for use by product-scraper.js
window.__dropflow_checkAvailability = checkAvailability;
