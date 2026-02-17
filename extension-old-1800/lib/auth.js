/**
 * Auth helpers for DropFlow extension.
 * Manages JWT access/refresh tokens in chrome.storage.local.
 */

const AUTH_KEYS = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
  USER_EMAIL: 'userEmail',
  USER_ID: 'userId'
};

/**
 * Get current auth state from storage.
 */
export async function getAuth() {
  const result = await chrome.storage.local.get([
    AUTH_KEYS.ACCESS_TOKEN,
    AUTH_KEYS.REFRESH_TOKEN,
    AUTH_KEYS.USER_EMAIL,
    AUTH_KEYS.USER_ID
  ]);
  return {
    accessToken: result[AUTH_KEYS.ACCESS_TOKEN] || null,
    refreshToken: result[AUTH_KEYS.REFRESH_TOKEN] || null,
    email: result[AUTH_KEYS.USER_EMAIL] || null,
    userId: result[AUTH_KEYS.USER_ID] || null
  };
}

/**
 * Check if user is logged in (has an access token).
 */
export async function isLoggedIn() {
  const { accessToken } = await getAuth();
  return !!accessToken;
}

/**
 * Store auth tokens and user info after login/register.
 */
export async function setAuth({ accessToken, refreshToken, user }) {
  await chrome.storage.local.set({
    [AUTH_KEYS.ACCESS_TOKEN]: accessToken,
    [AUTH_KEYS.REFRESH_TOKEN]: refreshToken,
    [AUTH_KEYS.USER_EMAIL]: user.email,
    [AUTH_KEYS.USER_ID]: user.id
  });
}

/**
 * Clear all auth data (logout).
 */
export async function clearAuth() {
  await chrome.storage.local.remove([
    AUTH_KEYS.ACCESS_TOKEN,
    AUTH_KEYS.REFRESH_TOKEN,
    AUTH_KEYS.USER_EMAIL,
    AUTH_KEYS.USER_ID
  ]);
}

/**
 * Refresh the access token using the stored refresh token.
 * Returns the new access token or null if refresh failed.
 */
export async function refreshAccessToken(backendUrl) {
  const { refreshToken } = await getAuth();
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${backendUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (!response.ok) {
      // Refresh token is invalid/expired — force logout
      await clearAuth();
      return null;
    }

    const data = await response.json();
    await setAuth({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user
    });
    return data.accessToken;
  } catch (e) {
    console.error('[DropFlow] Token refresh failed:', e.message);
    return null;
  }
}

export { AUTH_KEYS };
