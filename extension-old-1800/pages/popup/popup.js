import { api } from '../../lib/api-client.js';
import { getAuth, isLoggedIn, clearAuth } from '../../lib/auth.js';
import { OPEN_PAGE } from '../../lib/message-types.js';

const authPrompt = document.getElementById('auth-prompt');
const userInfo = document.getElementById('user-info');
const userEmail = document.getElementById('user-email');
const navGrid = document.getElementById('nav-grid');

// Check auth state and update UI
async function initAuth() {
  const loggedIn = await isLoggedIn();

  if (loggedIn) {
    const auth = await getAuth();
    authPrompt.style.display = 'none';
    userInfo.style.display = 'flex';
    userEmail.textContent = auth.email;
    navGrid.style.display = 'grid';
  } else {
    authPrompt.style.display = 'block';
    userInfo.style.display = 'none';
    navGrid.style.display = 'none';
  }
}

// Sign in button — open login page
document.getElementById('sign-in-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: OPEN_PAGE, page: 'login/login.html' });
  window.close();
});

// Logout button
document.getElementById('logout-btn').addEventListener('click', async () => {
  await clearAuth();
  initAuth();
});

// Navigation - open feature pages in new tabs
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

// Check backend status
async function checkBackend() {
  const dot = document.getElementById('backend-status');
  const text = document.getElementById('backend-status-text');

  try {
    await api.health();
    dot.className = 'status-dot status-online';
    text.textContent = 'Backend connected';
  } catch (e) {
    dot.className = 'status-dot status-offline';
    text.textContent = 'Backend offline';
  }
}

// Re-check auth when popup is opened (in case user just logged in)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.accessToken) {
    initAuth();
  }
});

initAuth();
checkBackend();
