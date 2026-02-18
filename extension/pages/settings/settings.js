import { api } from '../../lib/api-client.js';
import { GET_SETTINGS, SAVE_SETTINGS } from '../../lib/message-types.js';
import {
  BACKEND_URL,
  DEFAULT_LISTING_TYPE, DEFAULT_THREAD_COUNT, PRICE_MARKUP,
  DEFAULTS
} from '../../lib/storage-keys.js';

const fields = [BACKEND_URL, DEFAULT_LISTING_TYPE, DEFAULT_THREAD_COUNT, PRICE_MARKUP];

// ── Validation rules ──
const validators = {
  [PRICE_MARKUP]: (v) => {
    const n = Number(v);
    if (isNaN(n) || n < 1) return 'Markup must be a positive number (at least 1%).';
    if (n > 500) return 'Markup cannot exceed 500%.';
    if (!Number.isInteger(n)) return 'Markup must be a whole number.';
    return null;
  },
  [DEFAULT_THREAD_COUNT]: (v) => {
    const n = Number(v);
    if (isNaN(n) || n < 1 || n > 10) return 'Must be between 1 and 10.';
    if (!Number.isInteger(n)) return 'Must be a whole number.';
    return null;
  },
  [BACKEND_URL]: (v) => {
    if (!v || !v.trim()) return 'Backend URL is required.';
    try {
      const url = new URL(v);
      if (!['http:', 'https:'].includes(url.protocol)) return 'URL must start with http:// or https://';
    } catch {
      return 'Please enter a valid URL (e.g. https://dropflow-api.onrender.com).';
    }
    return null;
  }
};

function validateField(key) {
  const el = document.getElementById(key);
  const errorEl = document.getElementById(`${key}-error`);
  if (!el || !errorEl) return true;

  const validator = validators[key];
  if (!validator) return true;

  const error = validator(el.value);
  if (error) {
    errorEl.textContent = error;
    errorEl.style.display = 'block';
    el.classList.add('input-error');
    return false;
  }
  errorEl.style.display = 'none';
  el.classList.remove('input-error');
  return true;
}

function validateAll() {
  let valid = true;
  for (const key of fields) {
    if (!validateField(key)) valid = false;
  }
  return valid;
}

// Real-time validation on blur
fields.forEach(key => {
  const el = document.getElementById(key);
  if (el) {
    el.addEventListener('blur', () => validateField(key));
    el.addEventListener('input', () => {
      const errorEl = document.getElementById(`${key}-error`);
      if (errorEl && errorEl.style.display === 'block') {
        validateField(key);
      }
    });
  }
});

// ── Load settings ──
async function loadSettings() {
  const result = await chrome.runtime.sendMessage({ type: GET_SETTINGS });
  if (result?.settings) {
    for (const key of fields) {
      const el = document.getElementById(key);
      if (el && result.settings[key] !== undefined) {
        el.value = result.settings[key];
      }
    }
  }
}

// ── Save settings ──
document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!validateAll()) {
    showStatus('Please fix the errors above before saving.', 'error');
    return;
  }

  const settings = {};
  for (const key of fields) {
    const el = document.getElementById(key);
    if (el) {
      settings[key] = el.type === 'number' ? Number(el.value) : el.value;
    }
  }

  await chrome.runtime.sendMessage({ type: SAVE_SETTINGS, settings });
  showStatus('✅ Settings saved!', 'success');
});

// ── Reset to defaults ──
document.getElementById('reset-defaults').addEventListener('click', () => {
  for (const key of fields) {
    const el = document.getElementById(key);
    if (el && DEFAULTS[key] !== undefined) {
      el.value = DEFAULTS[key];
    }
  }
  // Clear all errors
  document.querySelectorAll('.field-error').forEach(e => e.style.display = 'none');
  document.querySelectorAll('.input-error').forEach(e => e.classList.remove('input-error'));
  showStatus('Settings reset to defaults. Click Save to apply.', 'success');
});

// ── Test backend ──
document.getElementById('test-backend').addEventListener('click', async () => {
  if (!validateField(BACKEND_URL)) return;
  showStatus('Testing connection…', 'success');
  try {
    await api.health();
    showStatus('✅ Backend is connected and responding!', 'success');
  } catch (e) {
    showStatus(`❌ Connection failed: ${e.message}`, 'error');
  }
});

function showStatus(message, type) {
  const el = document.getElementById('status-message');
  el.textContent = message;
  el.className = `status-message ${type}`;
  el.style.display = 'block';
  if (type === 'success') {
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }
}

loadSettings();
