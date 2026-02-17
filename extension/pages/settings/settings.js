import { api } from '../../lib/api-client.js';
import { GET_SETTINGS, SAVE_SETTINGS } from '../../lib/message-types.js';
import {
  BACKEND_URL,
  DEFAULT_LISTING_TYPE, DEFAULT_THREAD_COUNT, PRICE_MARKUP
} from '../../lib/storage-keys.js';

const fields = [BACKEND_URL, DEFAULT_LISTING_TYPE, DEFAULT_THREAD_COUNT, PRICE_MARKUP];

// Load saved settings
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

// Save settings
document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const settings = {};
  for (const key of fields) {
    const el = document.getElementById(key);
    if (el) {
      settings[key] = el.type === 'number' ? Number(el.value) : el.value;
    }
  }

  await chrome.runtime.sendMessage({ type: SAVE_SETTINGS, settings });
  showStatus('Settings saved successfully!', 'success');
});

// Test backend connection
document.getElementById('test-backend').addEventListener('click', async () => {
  showStatus('Testing connection...', 'success');
  try {
    await api.health();
    showStatus('Backend is connected and responding!', 'success');
  } catch (e) {
    showStatus(`Connection failed: ${e.message}`, 'error');
  }
});

function showStatus(message, type) {
  const el = document.getElementById('status-message');
  el.textContent = message;
  el.className = `status-message ${type}`;
  el.style.display = 'block';
  if (type === 'success') {
    setTimeout(() => { el.style.display = 'none'; }, 3000);
  }
}

loadSettings();
