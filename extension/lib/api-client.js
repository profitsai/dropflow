/**
 * API client for communicating with the DropFlow backend.
 * Uses JWT auth with automatic token refresh on 401.
 */

import { BACKEND_URL, DEFAULTS } from './storage-keys.js';
import { getAuth, refreshAccessToken } from './auth.js';

async function getBackendUrl() {
  const result = await chrome.storage.local.get(BACKEND_URL);
  return result[BACKEND_URL] || DEFAULTS[BACKEND_URL];
}

async function request(endpoint, options = {}, _isRetry = false) {
  const backendUrl = await getBackendUrl();
  const url = `${backendUrl}${endpoint}`;
  const { accessToken } = await getAuth();

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  // Attach JWT if available
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  // Handle 401 — try refreshing the token once
  if (response.status === 401 && !_isRetry) {
    const body = await response.json().catch(() => ({}));
    if (body.code === 'TOKEN_EXPIRED') {
      const newToken = await refreshAccessToken(backendUrl);
      if (newToken) {
        // Retry the original request with the new token
        return request(endpoint, options, true);
      }
    }
    // Token refresh failed or invalid token — signal auth required
    throw new AuthRequiredError('Authentication required. Please sign in.');
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(`API error ${response.status}: ${errorBody}`);
  }

  return response.json();
}

/**
 * Custom error for when auth is required (user needs to log in).
 */
export class AuthRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthRequiredError';
    this.code = 'AUTH_REQUIRED';
  }
}

export const api = {
  // Health check (no auth needed)
  async health() {
    const backendUrl = await getBackendUrl();
    const response = await fetch(`${backendUrl}/api/health`);
    if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
    return response.json();
  },

  // ChatGPT completion
  chat(messages, model = 'gpt-4o-mini') {
    return request('/api/openai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, model })
    });
  },

  // OpenAI function calling
  functionCall(messages, functions, model = 'gpt-4o-mini') {
    return request('/api/openai/function-call', {
      method: 'POST',
      body: JSON.stringify({ messages, functions, model })
    });
  },

  // Generate SEO titles
  generateTitles(productData) {
    return request('/api/titles/generate', {
      method: 'POST',
      body: JSON.stringify(productData)
    });
  },

  // TF-IDF analysis
  tfidf(documents, query) {
    return request('/api/titles/tfidf', {
      method: 'POST',
      body: JSON.stringify({ documents, query })
    });
  },

  // Keepa price history
  keepaProduct(asin, domain = 1) {
    return request(`/api/keepa/product/${asin}?domain=${domain}`);
  }
};
