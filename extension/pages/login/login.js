import { setAuth } from '../../lib/auth.js';
import { BACKEND_URL, DEFAULTS } from '../../lib/storage-keys.js';

// Get backend URL from storage
async function getBackendUrl() {
  const result = await chrome.storage.local.get(BACKEND_URL);
  return result[BACKEND_URL] || DEFAULTS[BACKEND_URL];
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const isLogin = tab.dataset.tab === 'login';
    document.getElementById('login-form').style.display = isLogin ? 'flex' : 'none';
    document.getElementById('register-form').style.display = isLogin ? 'none' : 'flex';
    hideMessages();
  });
});

// Login
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessages();

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = e.target.querySelector('button[type="submit"]');

  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    const backendUrl = await getBackendUrl();
    const response = await fetch(`${backendUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    await setAuth({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user
    });

    showSuccess('Signed in! Redirecting...');
    setTimeout(() => window.close(), 800);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

// Register
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessages();

  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const confirm = document.getElementById('register-confirm').value;
  const btn = e.target.querySelector('button[type="submit"]');

  if (password !== confirm) {
    showError('Passwords do not match.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating account...';

  try {
    const backendUrl = await getBackendUrl();
    const response = await fetch(`${backendUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Registration failed');
    }

    await setAuth({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user
    });

    showSuccess('Account created! Redirecting...');
    setTimeout(() => window.close(), 800);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
});

function showError(msg) {
  const el = document.getElementById('error-message');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('success-message').style.display = 'none';
}

function showSuccess(msg) {
  const el = document.getElementById('success-message');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('error-message').style.display = 'none';
}

function hideMessages() {
  document.getElementById('error-message').style.display = 'none';
  document.getElementById('success-message').style.display = 'none';
}
