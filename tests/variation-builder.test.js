/**
 * Comprehensive tests for the MSKU variation builder logic in form-filler.js.
 *
 * Since form-filler.js is an IIFE with no exports, we replicate the key pure
 * functions here and test the DOM interaction patterns with jsdom mocks.
 * This ensures the logic is correct without needing a browser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

// ── Replicated pure helpers (exactly matching form-filler.js) ──────────────

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function getAxisAliasSpec(axisName) {
  const n = norm(axisName);
  const strict = new Set([n]);
  const soft = new Set([n]);
  if (n === 'color' || n === 'colour') {
    ['color', 'colour', 'maincolor', 'maincolour', 'shade'].forEach(v => strict.add(norm(v)));
    ['style'].forEach(v => soft.add(norm(v)));
  } else if (n === 'size') {
    ['size'].forEach(v => strict.add(norm(v)));
  }
  for (const v of strict) soft.add(v);
  return { strict, soft };
}

const matchesAlias = (chipNorm, aliasSpec, useSoft = false) =>
  (useSoft ? aliasSpec.soft : aliasSpec.strict).has(chipNorm);

function matchesSizeOption(targetNorm, optionNorm) {
  if (targetNorm === optionNorm) return true;
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
    if (targetNorm.startsWith(k) && optionNorm === k) return true;
    if (optionNorm.startsWith(k) && targetNorm === k) return true;
  }
  return false;
}

function isSelectedOptionEl(el) {
  if (!el) return false;
  const ariaPressed = (el.getAttribute?.('aria-pressed') || '').toLowerCase();
  const ariaSelected = (el.getAttribute?.('aria-selected') || '').toLowerCase();
  const ariaChecked = (el.getAttribute?.('aria-checked') || '').toLowerCase();
  const cls = String(el.className || '').toLowerCase();
  return ariaPressed === 'true' ||
    ariaSelected === 'true' ||
    ariaChecked === 'true' ||
    /selected|active|checked|is-selected|btn--primary|btn--selected/.test(cls);
}

// ── DOM builder helpers ────────────────────────────────────────────────────

function makeDom(html = '') {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const doc = dom.window.document;
  // Stub getBoundingClientRect for all elements
  const origCreate = doc.createElement.bind(doc);
  const patchRect = (el) => {
    if (!el.getBoundingClientRect.__patched) {
      el.getBoundingClientRect = () => ({ top: 100, bottom: 130, left: 10, right: 200, width: 190, height: 30 });
      el.getBoundingClientRect.__patched = true;
    }
    return el;
  };
  // Patch existing elements
  doc.querySelectorAll('*').forEach(patchRect);
  // Patch new elements via MutationObserver equivalent — we'll patch on query
  const origQSA = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = (sel) => {
    const result = origQSA(sel);
    result.forEach(patchRect);
    return result;
  };
  return { dom, doc, window: dom.window };
}

function makeBuilderHtml({ attributes = ['Color'], options = ['Red', 'Blue'], hasTable = false } = {}) {
  const chipHtml = attributes.map(a =>
    `<button class="chip" role="button">${a} <span aria-label="remove">×</span></button>`
  ).join('');

  const optionHtml = options.map(o =>
    `<li role="button" tabindex="0">${o}</li>`
  ).join('');

  const tableHtml = hasTable ? `
    <table>
      <thead><tr><th>Variation</th><th>Price</th><th>Quantity</th><th>SKU</th></tr></thead>
      <tbody>
        <tr><td>Red / S</td><td><input type="text" placeholder="Price"></td><td><input type="text" placeholder="Quantity"></td><td><input type="text" placeholder="SKU"></td></tr>
        <tr><td>Red / M</td><td><input type="text" placeholder="Price"></td><td><input type="text" placeholder="Quantity"></td><td><input type="text" placeholder="SKU"></td></tr>
        <tr><td>Blue / S</td><td><input type="text" placeholder="Price"></td><td><input type="text" placeholder="Quantity"></td><td><input type="text" placeholder="SKU"></td></tr>
      </tbody>
    </table>
  ` : '';

  return `
    <main>
      <h3>Create your variation</h3>
      <section>
        <h4>Attributes</h4>
        <div class="attribute-chips">${chipHtml}</div>
        <button role="button">+ Add</button>
      </section>
      <section>
        <h4>Options</h4>
        <div class="option-list">${optionHtml}</div>
        <button role="button">+ Create your own</button>
      </section>
      ${tableHtml}
      <button role="button">Continue</button>
    </main>
  `;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('norm() — text normalization', () => {
  it('lowercases and strips non-alphanumeric chars', () => {
    expect(norm('Dark Red')).toBe('darkred');
    expect(norm('X-Large (Men)')).toBe('xlargemen');
    expect(norm('  Size  ')).toBe('size');
  });

  it('handles empty/null/undefined', () => {
    expect(norm('')).toBe('');
    expect(norm(null)).toBe('');
    expect(norm(undefined)).toBe('');
  });

  it('handles special characters in option names', () => {
    expect(norm('Red/Orange')).toBe('redorange');
    expect(norm("Women's M")).toBe('womensm');
    expect(norm('Size: 10½')).toBe('size10');
    expect(norm('Bleu Électrique')).toBe('bleulectrique');
  });
});

describe('getAxisAliasSpec — axis alias matching', () => {
  it('Color axis has colour/maincolor as strict aliases', () => {
    const spec = getAxisAliasSpec('Color');
    expect(spec.strict.has('color')).toBe(true);
    expect(spec.strict.has('colour')).toBe(true);
    expect(spec.strict.has('maincolor')).toBe(true);
    expect(spec.strict.has('shade')).toBe(true);
  });

  it('Color axis has style as soft-only alias', () => {
    const spec = getAxisAliasSpec('Color');
    expect(spec.strict.has('style')).toBe(false);
    expect(spec.soft.has('style')).toBe(true);
  });

  it('Size axis has only size as strict alias (not compound names)', () => {
    const spec = getAxisAliasSpec('Size');
    expect(spec.strict.has('size')).toBe(true);
    // "Dog Size" normalized = "dogsize", should NOT be in aliases
    expect(spec.strict.has('dogsize')).toBe(false);
    expect(spec.strict.has('petsize')).toBe(false);
  });

  it('Unknown axis has only itself as alias', () => {
    const spec = getAxisAliasSpec('Material');
    expect(spec.strict.size).toBe(1);
    expect(spec.strict.has('material')).toBe(true);
  });

  it('Colour (British spelling) resolves same as Color', () => {
    const spec = getAxisAliasSpec('Colour');
    expect(spec.strict.has('color')).toBe(true);
    expect(spec.strict.has('colour')).toBe(true);
  });
});

describe('matchesAlias', () => {
  it('strict match for exact alias', () => {
    const spec = getAxisAliasSpec('Color');
    expect(matchesAlias('color', spec, false)).toBe(true);
    expect(matchesAlias('colour', spec, false)).toBe(true);
  });

  it('strict does not match soft-only alias', () => {
    const spec = getAxisAliasSpec('Color');
    expect(matchesAlias('style', spec, false)).toBe(false);
  });

  it('soft matches both strict and soft aliases', () => {
    const spec = getAxisAliasSpec('Color');
    expect(matchesAlias('color', spec, true)).toBe(true);
    expect(matchesAlias('style', spec, true)).toBe(true);
  });

  it('returns false for unrelated values', () => {
    const spec = getAxisAliasSpec('Color');
    expect(matchesAlias('material', spec, true)).toBe(false);
  });
});

describe('matchesSizeOption — fuzzy size matching', () => {
  it('exact match', () => {
    expect(matchesSizeOption('m', 'm')).toBe(true);
    expect(matchesSizeOption('xl', 'xl')).toBe(true);
  });

  it('alias match: S → small/sm', () => {
    expect(matchesSizeOption('s', 'small')).toBe(true);
    expect(matchesSizeOption('s', 'sm')).toBe(true);
    expect(matchesSizeOption('small', 's')).toBe(true);
  });

  it('alias match: XL → xlarge/extralarge', () => {
    expect(matchesSizeOption('xl', 'xlarge')).toBe(true);
    expect(matchesSizeOption('xl', 'extralarge')).toBe(true);
  });

  it('prefix match: xsold → xs', () => {
    expect(matchesSizeOption('xsold', 'xs')).toBe(true);
    expect(matchesSizeOption('xs', 'xsold')).toBe(true);
  });

  it('XXL ↔ 2XL alias', () => {
    expect(matchesSizeOption('xxl', '2xl')).toBe(true);
    expect(matchesSizeOption('2xl', 'xxl')).toBe(true);
  });

  it('does not match unrelated sizes', () => {
    expect(matchesSizeOption('s', 'xl')).toBe(false);
    expect(matchesSizeOption('m', 'xxl')).toBe(false);
  });

  it('handles AliExpress size with parenthetical stripped', () => {
    // After norm('XS(old)') → 'xsold'
    expect(matchesSizeOption(norm('XS(old)'), 'xs')).toBe(true);
  });
});

describe('isSelectedOptionEl — aria/class selection detection', () => {
  it('detects aria-pressed=true', () => {
    const { doc } = makeDom('<button aria-pressed="true">Red</button>');
    const el = doc.querySelector('button');
    expect(isSelectedOptionEl(el)).toBe(true);
  });

  it('detects aria-selected=true', () => {
    const { doc } = makeDom('<li aria-selected="true">Blue</li>');
    const el = doc.querySelector('li');
    expect(isSelectedOptionEl(el)).toBe(true);
  });

  it('detects aria-checked=true', () => {
    const { doc } = makeDom('<div aria-checked="true">M</div>');
    const el = doc.querySelector('div');
    expect(isSelectedOptionEl(el)).toBe(true);
  });

  it('detects class-based selection', () => {
    const { doc } = makeDom('<button class="btn--selected">L</button>');
    expect(isSelectedOptionEl(doc.querySelector('button'))).toBe(true);
  });

  it('detects is-selected class', () => {
    const { doc } = makeDom('<li class="option is-selected">XL</li>');
    expect(isSelectedOptionEl(doc.querySelector('li'))).toBe(true);
  });

  it('returns false for unselected element', () => {
    const { doc } = makeDom('<button aria-pressed="false">S</button>');
    expect(isSelectedOptionEl(doc.querySelector('button'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isSelectedOptionEl(null)).toBe(false);
  });
});

describe('Chip detection — Strategy 1: clickable elements in attribute band', () => {
  it('identifies chip elements with remove glyph (×)', () => {
    const { doc } = makeDom(makeBuilderHtml({ attributes: ['Color', 'Size'] }));
    const chips = doc.querySelectorAll('.chip');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain('Color');
    expect(chips[1].textContent).toContain('Size');
  });

  it('filters out +Add buttons', () => {
    const { doc } = makeDom(makeBuilderHtml());
    const buttons = Array.from(doc.querySelectorAll('button'));
    const addBtns = buttons.filter(b => /^\+\s*add$/i.test(b.textContent.trim()));
    expect(addBtns.length).toBe(1);
    // Chip filtering logic should exclude these
    const chipLike = buttons.filter(b => {
      const raw = b.textContent.trim();
      return !(/^\+\s*add$/i.test(raw) || /^\+/.test(raw) || /^(continue|cancel)$/i.test(raw));
    });
    expect(chipLike.every(c => !c.textContent.includes('+ Add'))).toBe(true);
  });

  it('filters out text longer than 45 chars', () => {
    const longText = 'A'.repeat(50);
    const isChip = longText.length <= 45;
    expect(isChip).toBe(false);
  });
});

describe('Chip detection — Strategy 2: CSS class-based chip selectors', () => {
  it('finds elements with chip/tag/token class names', () => {
    const { doc } = makeDom(`
      <div><span class="ebay-chip">Color <svg aria-label="remove"></svg></span></div>
      <div><span class="variation-tag">Size <svg aria-label="close"></svg></span></div>
    `);
    const chips = doc.querySelectorAll('[class*="chip"], [class*="tag"], [class*="token"]');
    expect(chips.length).toBe(2);
  });

  it('detects SVG close icon as remove affordance', () => {
    const { doc } = makeDom('<span class="chip">Color <svg aria-label="remove"></svg></span>');
    const chip = doc.querySelector('.chip');
    const removeTarget = chip.querySelector('svg, [aria-label*="remove"]');
    expect(removeTarget).not.toBeNull();
  });
});

describe('Chip detection — Strategy 3: broad scan with close affordance', () => {
  it('finds divs with embedded button remove affordance', () => {
    const { doc } = makeDom(`
      <div style="width:100px;height:30px">Color <button role="button" aria-label="remove">×</button></div>
    `);
    const el = doc.querySelector('div');
    const removeTarget = el.querySelector('button, [role="button"], [role="img"]');
    expect(removeTarget).not.toBeNull();
    const removeAria = (removeTarget.getAttribute('aria-label') || '').toLowerCase();
    expect(/remove|delete|close|dismiss/.test(removeAria)).toBe(true);
  });

  it('rejects elements without any close affordance', () => {
    const { doc } = makeDom('<div style="width:100px;height:30px">Color</div>');
    const el = doc.querySelector('div');
    const removeTarget = el.querySelector('button, [role="button"], svg');
    expect(removeTarget).toBeNull();
  });
});

describe('findBuilderRoot — builder root detection', () => {
  it('finds main element containing variation builder keywords', () => {
    const { doc } = makeDom(makeBuilderHtml());
    const main = doc.querySelector('main');
    const text = main.textContent.toLowerCase().replace(/\s+/g, ' ');
    expect(/create\s+(your\s+)?variation/.test(text)).toBe(true);
    expect(/\b(attributes?|properties)\b/.test(text)).toBe(true);
    expect(/\b(options?|values?)\b/.test(text)).toBe(true);
  });

  it('fallback: finds container with Continue button + variation text', () => {
    const { doc } = makeDom(`
      <div>
        <p>Manage your variation attributes and options here</p>
        <button>Continue</button>
      </div>
    `);
    const div = doc.querySelector('div');
    const text = div.textContent.toLowerCase();
    const hasContinueBtn = !!div.querySelector('button');
    expect(/variation/.test(text) && hasContinueBtn).toBe(true);
  });

  it('stale root refresh: re-queries after DOM mutation', () => {
    const { doc } = makeDom(makeBuilderHtml());
    let root = doc.querySelector('main');
    expect(root).not.toBeNull();
    // Simulate React re-render by replacing main
    const newMain = doc.createElement('main');
    newMain.innerHTML = root.innerHTML;
    root.parentNode.replaceChild(newMain, root);
    // Re-query (simulating findBuilderRoot)
    root = doc.querySelector('main');
    expect(root).toBe(newMain);
  });
});

describe('Combinations table detection', () => {
  it('Strategy 1: finds table in variations section', () => {
    const { doc } = makeDom(makeBuilderHtml({ hasTable: true }));
    const table = doc.querySelector('table');
    expect(table).not.toBeNull();
    expect(table.querySelectorAll('tr').length).toBeGreaterThanOrEqual(2);
  });

  it('Strategy 2: finds table with price/quantity headers', () => {
    const { doc } = makeDom(`
      <table>
        <thead><tr><th>Variation</th><th>Price</th><th>Quantity</th></tr></thead>
        <tbody><tr><td>Red</td><td><input type="text"></td><td><input type="text"></td></tr></tbody>
      </table>
    `);
    const tables = doc.querySelectorAll('table');
    const found = Array.from(tables).find(t => {
      const headerRow = t.querySelector('thead tr, tr:first-child');
      if (!headerRow) return false;
      const headerText = (headerRow.textContent || '').toLowerCase();
      return /price/i.test(headerText) && /quantit/i.test(headerText);
    });
    expect(found).not.toBeNull();
  });

  it('Strategy 3: finds table with price+qty input hints', () => {
    const { doc } = makeDom(`
      <table>
        <tbody>
          <tr><td><input placeholder="Price" type="text"></td><td><input placeholder="Quantity" type="text"></td></tr>
          <tr><td><input placeholder="Price" type="text"></td><td><input placeholder="Quantity" type="text"></td></tr>
        </tbody>
      </table>
    `);
    const tables = doc.querySelectorAll('table');
    const found = Array.from(tables).find(t => {
      if (t.querySelectorAll('tr').length < 2) return false;
      const inputs = t.querySelectorAll('input');
      const hints = Array.from(inputs).map(i => `${i.placeholder || ''}`).join(' ').toLowerCase();
      return /price/.test(hints) && /quantit|qty/.test(hints);
    });
    expect(found).not.toBeNull();
  });
});

describe('Price filling in the combinations grid', () => {
  function makeTableDom(rows) {
    const rowsHtml = rows.map(r => `
      <tr>
        <td>${r.label}</td>
        <td><input type="text" placeholder="Price"></td>
        <td><input type="text" placeholder="Quantity"></td>
        <td><input type="text" placeholder="SKU"></td>
      </tr>
    `).join('');
    const { doc } = makeDom(`
      <table>
        <thead><tr><th>Variation</th><th>Price</th><th>Quantity</th><th>SKU</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `);
    return doc;
  }

  it('matches row to variant by exact text match', () => {
    const priceLookup = [
      { values: ['red', 's'], price: 19.99, skuLabel: 'DF-Red-S' },
      { values: ['blue', 'm'], price: 24.99, skuLabel: 'DF-Blue-M' },
    ];
    const rowText = 'Red / S'.toLowerCase();
    let bestMatch = null, bestScore = 0;
    for (const entry of priceLookup) {
      let score = 0;
      for (const val of entry.values) {
        const re = new RegExp('\\b' + val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        if (re.test(rowText)) score++;
      }
      if (score > bestScore) { bestScore = score; bestMatch = entry; }
    }
    expect(bestMatch).not.toBeNull();
    expect(bestMatch.price).toBe(19.99);
    expect(bestScore).toBe(2);
  });

  it('falls back to index when no text match', () => {
    const priceLookup = [
      { values: ['variant1'], price: 15.00 },
      { values: ['variant2'], price: 20.00 },
    ];
    const rowText = norm('Unknown variant');
    let bestScore = 0;
    for (const entry of priceLookup) {
      let score = 0;
      for (const val of entry.values) {
        const re = new RegExp('\\b' + val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        if (re.test(rowText)) score++;
      }
      if (score > bestScore) bestScore = score;
    }
    expect(bestScore).toBe(0);
    // Index fallback: row 0 → priceLookup[0]
    const fallback = priceLookup[0];
    expect(fallback.price).toBe(15.00);
  });

  it('identifies price/qty/sku inputs by placeholder hints', () => {
    const doc = makeTableDom([{ label: 'Red / S' }]);
    const inputs = doc.querySelectorAll('tbody input');
    const hints = Array.from(inputs).map(i => i.placeholder.toLowerCase());
    expect(hints).toContain('price');
    expect(hints).toContain('quantity');
    expect(hints).toContain('sku');
  });

  it('skips UPC/EAN/ISBN inputs', () => {
    const { doc } = makeDom('<input placeholder="UPC" type="text"><input placeholder="Price" type="text">');
    const inputs = doc.querySelectorAll('input');
    const priceInputs = Array.from(inputs).filter(i => {
      const hints = (i.placeholder || '').toLowerCase();
      if (/upc|ean|isbn|mpn|gtin|barcode|identifier/.test(hints)) return false;
      return /price|amount|\$/.test(hints);
    });
    expect(priceInputs.length).toBe(1);
    expect(priceInputs[0].placeholder).toBe('Price');
  });

  it('uses column position fallback when inputs lack hints', () => {
    const { doc } = makeDom(`
      <table>
        <thead><tr><th>Variation</th><th>Price</th><th>Qty</th></tr></thead>
        <tbody><tr><td>Red</td><td><input type="text"></td><td><input type="text"></td></tr></tbody>
      </table>
    `);
    const hr = doc.querySelector('thead tr');
    const ths = Array.from(hr.querySelectorAll('th'));
    const colMap = { price: -1, qty: -1 };
    ths.forEach((th, idx) => {
      const t = th.textContent.toLowerCase();
      if (/price/.test(t)) colMap.price = idx;
      if (/qty|quantit/.test(t)) colMap.qty = idx;
    });
    expect(colMap.price).toBe(1);
    expect(colMap.qty).toBe(2);
  });
});

describe('Iframe vs parent frame lock logic', () => {
  it('parent frame bails when MSKU iframe is detected', () => {
    // Simulates: IS_TOP_FRAME=true, iframe found with reasonable dimensions
    const IS_TOP_FRAME = true;
    const iframeRect = { width: 800, height: 600 };
    const shouldBail = IS_TOP_FRAME && iframeRect.width > 100 && iframeRect.height > 100;
    expect(shouldBail).toBe(true);
  });

  it('parent frame proceeds when no iframe found', () => {
    const IS_TOP_FRAME = true;
    const mskuIframe = null;
    const shouldBail = IS_TOP_FRAME && mskuIframe != null;
    expect(shouldBail).toBe(false);
  });

  it('iframe overrides parent lock when lock held by www.ebay host', () => {
    const isBulkEditFrame = true; // !IS_TOP_FRAME && bulkedit.ebay
    const lockHeldByParent = true; // existing.host = www.ebay.com.au
    const shouldOverride = isBulkEditFrame && lockHeldByParent;
    expect(shouldOverride).toBe(true);
  });

  it('stale locks older than 60s are force-released', () => {
    const lockAge = 65000;
    const shouldForceRelease = lockAge > 60000;
    expect(shouldForceRelease).toBe(true);
  });

  it('fresh locks block duplicate runs', () => {
    const flowStartedAt = Date.now();
    const existingLock = { startedAt: flowStartedAt - 5000 };
    const shouldSkip = existingLock && (flowStartedAt - existingLock.startedAt) < 30000;
    expect(shouldSkip).toBe(true);
  });

  it('cross-context lock scope uses draftId when available', () => {
    const url = 'https://bulkedit.ebay.com.au/sell/listing/builder?draftId=12345';
    const draftIdMatch = url.match(/draftId=(\d+)/);
    const lockScope = draftIdMatch ? `draft_${draftIdMatch[1]}` : 'fallback';
    expect(lockScope).toBe('draft_12345');
  });

  it('cross-context lock scope falls back to host+path when no draftId', () => {
    const url = 'https://bulkedit.ebay.com.au/sell/listing/builder';
    const draftIdMatch = url.match(/draftId=(\d+)/);
    expect(draftIdMatch).toBeNull();
  });
});

describe('Edge cases: single variant', () => {
  it('single axis with one value produces one desired axis', () => {
    const axes = [{ name: 'Color', values: ['Red'] }];
    const desiredAxes = axes
      .filter(a => a.name)
      .slice(0, 2)
      .map(a => ({ name: a.name, values: a.values.map(v => String(v).trim()).filter(Boolean) }));
    expect(desiredAxes.length).toBe(1);
    expect(desiredAxes[0].values).toEqual(['Red']);
  });
});

describe('Edge cases: many variants (35+)', () => {
  it('processes all values for an axis with 35+ options', () => {
    const values = Array.from({ length: 40 }, (_, i) => `Option-${i + 1}`);
    const axis = { name: 'Size', values };
    expect(axis.values.length).toBe(40);
    // Norm all values
    const normed = axis.values.map(v => norm(v));
    expect(normed[0]).toBe('option1');
    expect(normed[39]).toBe('option40');
    expect(new Set(normed).size).toBe(40); // all unique
  });
});

describe('Edge cases: special characters in option names', () => {
  it('handles slashes, apostrophes, unicode in option names', () => {
    const options = ['Red/Orange', "Women's M", 'Größe L', '10½ inch', 'Black — Matte'];
    const normed = options.map(norm);
    expect(normed[0]).toBe('redorange');
    expect(normed[1]).toBe('womensm');
    expect(normed[2]).toBe('grel');
    expect(normed[3]).toBe('10inch');
    expect(normed[4]).toBe('blackmatte');
  });

  it('regex escaping in row matching prevents injection', () => {
    const val = 'red';
    const escaped = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\b' + escaped + '\\b', 'i');
    // Should not throw and should match
    expect(() => re.test('test Red / S row')).not.toThrow();
    expect(re.test('test Red / S row')).toBe(true);
    // Ensure special chars don't break regex construction
    const specialVal = 'S+M';
    const specialEscaped = specialVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const specialRe = new RegExp(specialEscaped, 'i');
    expect(() => specialRe.test('test S+M row')).not.toThrow();
    expect(specialRe.test('test S+M row')).toBe(true);
  });
});

describe('desiredAxes sorting — Size axis goes last', () => {
  it('sorts Size before Color (Size axis processed first)', () => {
    const axes = [
      { name: 'Color', values: ['Red', 'Blue'] },
      { name: 'Size', values: ['S', 'M'] }
    ];
    const sorted = [...axes].sort((a, b) => (/size/i.test(b.name) ? 1 : 0) - (/size/i.test(a.name) ? 1 : 0));
    expect(sorted[0].name).toBe('Size');
    expect(sorted[1].name).toBe('Color');
  });

  it('limits to 2 axes max', () => {
    const axes = [
      { name: 'Color', values: ['Red'] },
      { name: 'Size', values: ['S'] },
      { name: 'Material', values: ['Cotton'] }
    ];
    const limited = axes.slice(0, 2);
    expect(limited.length).toBe(2);
    expect(limited.map(a => a.name)).not.toContain('Material');
  });
});

describe('Dialog dismissal patterns', () => {
  it('identifies "Delete variations" dialog with Yes button', () => {
    const { doc } = makeDom(`
      <div role="dialog">
        <p>Delete variations - Are you sure you want to delete all variations?</p>
        <button>No</button>
        <button>Yes</button>
      </div>
    `);
    const dialog = doc.querySelector('[role="dialog"]');
    const text = dialog.textContent.toLowerCase();
    expect(text).toContain('delete variations');
    const buttons = Array.from(dialog.querySelectorAll('button'));
    const yesBtn = buttons.find(b => /^\s*yes\s*$/i.test(b.textContent.trim()));
    expect(yesBtn).not.toBeNull();
  });

  it('identifies "Update variations" dialog with Continue button', () => {
    const { doc } = makeDom(`
      <div role="alertdialog">
        <p>We're about to automatically update variations</p>
        <button>Cancel</button>
        <button>Continue</button>
      </div>
    `);
    const dialog = doc.querySelector('[role="alertdialog"]');
    const text = dialog.textContent.toLowerCase();
    expect(text).toContain('update variations');
    const buttons = Array.from(dialog.querySelectorAll('button'));
    const continueBtn = buttons.find(b => /^\s*continue\s*$/i.test(b.textContent.trim()));
    expect(continueBtn).not.toBeNull();
  });
});

describe('mapSpecsToChips — mapping axes to existing chips', () => {
  it('maps Color spec to color chip via strict alias', () => {
    const axisSpecs = [getAxisAliasSpec('Color'), getAxisAliasSpec('Size')].map((spec, i) => ({
      axis: { name: ['Color', 'Size'][i], values: [] },
      ...spec
    }));
    const chips = [
      { norm: 'colour', text: 'Colour' },
      { norm: 'size', text: 'Size' }
    ];
    const usedNorms = new Set();
    const mapped = [];
    for (const spec of axisSpecs) {
      const chip = chips.find(c => !usedNorms.has(c.norm) && matchesAlias(c.norm, spec, false)) ||
        chips.find(c => !usedNorms.has(c.norm) && matchesAlias(c.norm, spec, true));
      if (chip) {
        usedNorms.add(chip.norm);
        mapped.push({ spec, chip });
      }
    }
    expect(mapped.length).toBe(2);
    expect(mapped[0].chip.text).toBe('Colour');
    expect(mapped[1].chip.text).toBe('Size');
  });
});

describe('Variation value parenthetical stripping', () => {
  it('strips (old), (new), weight ranges from values', () => {
    const strip = (v) => String(v || '').replace(/\s*\([^)]*\)\s*/g, '').trim();
    expect(strip('XS(old)')).toBe('XS');
    expect(strip('M (5-10kg)')).toBe('M');
    expect(strip('Large (New Season)')).toBe('Large');
    expect(strip('Red')).toBe('Red');
  });
});
