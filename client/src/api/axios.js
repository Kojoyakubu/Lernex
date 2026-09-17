// /client/api/axios.js
import axios from 'axios';

// -----------------------------------------------------------------------------
// 🌐 BASE URL
// -----------------------------------------------------------------------------
const baseURL =
  import.meta.env.VITE_API_URL || 'https://scholars-path-backend.onrender.com';

// -----------------------------------------------------------------------------
// ⚙️ AXIOS INSTANCE
// -----------------------------------------------------------------------------
const API = axios.create({
  baseURL,
  withCredentials: false, // ✅ token-based auth, no cookies
  headers: {
    'Content-Type': 'application/json',
  },
});

let isRefreshingToken = false;
let refreshSubscribers = [];

const addRefreshSubscriber = (callback) => {
  refreshSubscribers.push(callback);
};

const runRefreshSubscribers = (newToken) => {
  refreshSubscribers.forEach((callback) => callback(newToken));
  refreshSubscribers = [];
};

// -----------------------------------------------------------------------------
// 🔑 TOKEN INTERCEPTOR
// -----------------------------------------------------------------------------
API.interceptors.request.use(
  (config) => {
    try {
      // Let the browser set the multipart boundary for file uploads.
      if (config.data instanceof FormData) {
        if (config.headers?.delete) {
          config.headers.delete('Content-Type');
        } else if (config.headers) {
          delete config.headers['Content-Type'];
        }
      }
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        const user = JSON.parse(storedUser);
        const token = user?.token || user?.accessToken;
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }
    } catch (err) {
      console.warn('⚠️ Token parse error:', err);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

const shouldHandleUnauthorized = (error) => {
  const status = error.response?.status;
  const requestUrl = error.config?.url || '';

  if (status !== 401) {
    return false;
  }

  // Do not redirect for authentication endpoints where a 401 can be expected.
  if (
    requestUrl.includes('/api/users/login') ||
    requestUrl.includes('/api/users/register') ||
    requestUrl.includes('/api/users/google-auth') ||
    requestUrl.includes('/api/users/social-auth')
  ) {
    return false;
  }

  // Payment popup flows can outlive the access token; do not hard-logout here.
  if (
    requestUrl.includes('/api/payments/downloads/initialize') ||
    requestUrl.includes('/api/payments/downloads/verify')
  ) {
    return false;
  }

  return true;
};

const emitUnauthorized = () => {
  localStorage.removeItem('user');
  localStorage.removeItem('token');
  localStorage.removeItem('studentClassSelection');

  window.dispatchEvent(
    new CustomEvent('auth:unauthorized', {
      detail: {
        message: 'Your session has expired. Please log in again.',
      },
    })
  );
};

const refreshAccessToken = async () => {
  const storedUser = localStorage.getItem('user');
  if (!storedUser) {
    throw new Error('No user in storage');
  }

  const user = JSON.parse(storedUser);
  const refreshToken = user?.refreshToken;
  if (!refreshToken) {
    throw new Error('No refresh token found');
  }

  const response = await axios.post(`${baseURL}/api/users/refresh-token`, { refreshToken });
  const newAccessToken = response.data?.accessToken;

  if (!newAccessToken) {
    throw new Error('No access token returned from refresh endpoint');
  }

  const updatedUser = {
    ...user,
    token: newAccessToken,
    accessToken: newAccessToken,
  };
  localStorage.setItem('user', JSON.stringify(updatedUser));

  return newAccessToken;
};

API.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config || {};

    if (!shouldHandleUnauthorized(error) || originalRequest._retry) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    if (isRefreshingToken) {
      return new Promise((resolve, reject) => {
        addRefreshSubscriber((newToken) => {
          if (!newToken) {
            reject(error);
            return;
          }

          originalRequest.headers = originalRequest.headers || {};
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          resolve(API(originalRequest));
        });
      });
    }

    isRefreshingToken = true;

    try {
      const newToken = await refreshAccessToken();
      runRefreshSubscribers(newToken);

      originalRequest.headers = originalRequest.headers || {};
      originalRequest.headers.Authorization = `Bearer ${newToken}`;

      return API(originalRequest);
    } catch (refreshError) {
      runRefreshSubscribers(null);
      emitUnauthorized();
      return Promise.reject(refreshError);
    } finally {
      isRefreshingToken = false;
    }
  }
);

// -----------------------------------------------------------------------------
// 🚀 EXPORT
// -----------------------------------------------------------------------------
export default API;
