import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const EXT = resolve(__dirname, '..', 'extension');
const manifest = JSON.parse(readFileSync(resolve(EXT, 'manifest.json'), 'utf8'));

describe('Manifest validation', () => {
  it('is MV3 — manifest_version is 3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('declares a service_worker (not background.page)', () => {
    expect(manifest.background).toBeDefined();
    expect(manifest.background.service_worker).toBeDefined();
    expect(manifest.background.page).toBeUndefined();
    expect(manifest.background.scripts).toBeUndefined();
  });

  it('service_worker file exists on disk', () => {
    const sw = resolve(EXT, manifest.background.service_worker);
    expect(existsSync(sw)).toBe(true);
  });

  it('all content script JS files exist on disk', () => {
    const missing = [];
    for (const entry of manifest.content_scripts) {
      for (const js of entry.js || []) {
        if (!existsSync(resolve(EXT, js))) missing.push(js);
      }
    }
    expect(missing).toEqual([]);
  });

  it('all content script CSS files exist on disk', () => {
    const missing = [];
    for (const entry of manifest.content_scripts) {
      for (const css of entry.css || []) {
        if (!existsSync(resolve(EXT, css))) missing.push(css);
      }
    }
    expect(missing).toEqual([]);
  });

  it('all page HTML files referenced exist on disk', () => {
    const htmlPaths = [];
    // popup
    if (manifest.action?.default_popup) htmlPaths.push(manifest.action.default_popup);
    // options
    if (manifest.options_page) htmlPaths.push(manifest.options_page);
    if (manifest.options_ui?.page) htmlPaths.push(manifest.options_ui.page);

    const missing = htmlPaths.filter(p => !existsSync(resolve(EXT, p)));
    expect(missing).toEqual([]);
  });

  it('no duplicate content script entries (same js set on same matches)', () => {
    const seen = new Set();
    const dupes = [];
    for (const entry of manifest.content_scripts) {
      const key = JSON.stringify({ js: (entry.js || []).sort(), matches: (entry.matches || []).sort() });
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    expect(dupes).toEqual([]);
  });

  it('declares all required permissions', () => {
    const required = ['storage', 'tabs', 'scripting', 'alarms'];
    const perms = manifest.permissions || [];
    for (const p of required) {
      expect(perms).toContain(p);
    }
  });

  it('has host_permissions (MV3 requirement for cross-origin)', () => {
    expect(manifest.host_permissions?.length).toBeGreaterThan(0);
  });
});
