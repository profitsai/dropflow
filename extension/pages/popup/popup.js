import { api } from '../../lib/api-client.js';
import { getAuth, isLoggedIn, clearAuth } from '../../lib/auth.js';
import { OPEN_PAGE } from '../../lib/message-types.js';
import {
  TRACKER_RUNNING, TRACKED_PRODUCTS, MONITOR_LAST_RUN
} from '../../lib/storage-keys.js';

const authPrompt = document.getElementById('auth-prompt');
const userInfo = document.getElementById('user-info');
const userEmail = document.getElementById('user-email');
const navGrid = document.getElementById('nav-grid');
const statusBar = document.getElementById('status-bar');
const welcomeBanner = document.getElementById('welcome-banner');

// ── First-run welcome ──
async function checkFirstRun() {
  const { dropflowWelcomeDismissed } = await chrome.storage.local.get('dropflowWelcomeDismissed');
  if (!dropflowWelcomeDismissed) {
    welcomeBanner.style.display = 'flex';
  }
}

document.getElementById('dismiss-welcome').addEventListener('click', () => {
  welcomeBanner.style.display = 'none';
  chrome.storage.local.set({ dropflowWelcomeDismissed: true });
});

// ── Auth ──
async function initAuth() {
  const loggedIn = await isLoggedIn();

  if (loggedIn) {
    const auth = await getAuth();
    authPrompt.style.display = 'none';
    userInfo.style.display = 'flex';
    userEmail.textContent = auth.email;
    navGrid.style.display = 'grid';
    statusBar.style.display = 'flex';
    loadStatusIndicators();
  } else {
    authPrompt.style.display = 'block';
    userInfo.style.display = 'none';
    navGrid.style.display = 'none';
    statusBar.style.display = 'none';
    checkFirstRun();
  }
}

document.getElementById('sign-in-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: OPEN_PAGE, page: 'login/login.html' });
  window.close();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await clearAuth();
  initAuth();
});

// ── Navigation ──
document.querySelectorAll('.nav-card').forEach(card => {
  card.addEventListener('click', (e) => {
    e.preventDefault();
    const page = card.dataset.page;
    if (page) {
      chrome.runtime.sendMessage({ type: OPEN_PAGE, page });
      window.close();
    }
  });
});

// ── Status indicators ──
async function loadStatusIndicators() {
  try {
    const data = await chrome.storage.local.get([
      TRACKER_RUNNING, TRACKED_PRODUCTS, MONITOR_LAST_RUN
    ]);

    // Tracker running?
    const trackerDot = document.querySelector('#tracker-status .status-indicator');
    const trackerText = document.getElementById('tracker-status-text');
    if (data[TRACKER_RUNNING]) {
      trackerDot.className = 'status-indicator status-active';
      trackerText.textContent = 'Running';
    } else {
      trackerDot.className = 'status-indicator status-inactive';
      trackerText.textContent = 'Off';
    }

    // Monitored products count
    const monitorCount = document.getElementById('monitor-count');
    const products = data[TRACKED_PRODUCTS];
    if (Array.isArray(products)) {
      monitorCount.textContent = products.length.toLocaleString();
    } else if (products && typeof products === 'object') {
      monitorCount.textContent = Object.keys(products).length.toLocaleString();
    } else {
      monitorCount.textContent = '0';
    }

    // Last sync time
    const lastSync = document.getElementById('last-sync-time');
    if (data[MONITOR_LAST_RUN]) {
      const diff = Date.now() - data[MONITOR_LAST_RUN];
      if (diff < 60000) lastSync.textContent = 'Just now';
      else if (diff < 3600000) lastSync.textContent = `${Math.floor(diff / 60000)}m ago`;
      else if (diff < 86400000) lastSync.textContent = `${Math.floor(diff / 3600000)}h ago`;
      else lastSync.textContent = `${Math.floor(diff / 86400000)}d ago`;
    } else {
      lastSync.textContent = 'Never';
    }
  } catch {
    // Storage not available — leave defaults
  }
}

// ── Backend health ──
async function checkBackend() {
  const dot = document.getElementById('backend-status');
  const text = document.getElementById('backend-status-text');

  try {
    await api.health();
    dot.className = 'status-dot status-online';
    text.textContent = 'Backend connected';
  } catch {
    dot.className = 'status-dot status-offline';
    text.textContent = 'Backend offline';
  }
}

// ── Re-check on storage changes ──
chrome.storage.onChanged.addListener((changes) => {
  if (changes.accessToken) initAuth();
  if (changes[TRACKER_RUNNING] || changes[TRACKED_PRODUCTS] || changes[MONITOR_LAST_RUN]) {
    loadStatusIndicators();
  }
});

initAuth();
checkBackend();
