/**
 * main-instagram.js (MAIN World Script)
 * Intercepts page-level XHR and fetch requests to observe Instagram API network responses.
 * Relays intercepted JSON payloads safely to the isolated content script via custom window events.
 */
(function () {
  'use strict';

  const LOG_PREFIX = '[IG-SCRAPER-MAIN]';
  const EVENT_NAME = 'instagram-scraper-api-response';

  console.log(`${LOG_PREFIX} Main-world interceptor initialized.`);

  // URL matching patterns relevant for Instagram media responses
  const RELEVANT_URL_PATTERNS = [
    '/api/v1/feed/user/',
    '/api/v1/feed/reels_media/',
    '/api/v1/clips/user/',
    '/api/v1/media/',
    '/graphql/query',
    'web_profile_info',
    'instagram.com/graphql',
    '/api/v1/tags/logged_out_desktop/',
    '/api/v1/discover/'
  ];

  function isRelevantUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return RELEVANT_URL_PATTERNS.some(pattern => url.includes(pattern));
  }

  function notifyContentScript(payload, url, status) {
    try {
      window.dispatchEvent(
        new CustomEvent(EVENT_NAME, {
          detail: {
            url: url,
            timestamp: Date.now(),
            status: status || 0,
            data: payload
          }
        })
      );
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to dispatch custom event:`, err);
    }
  }

  // --- Intercept Fetch API ---
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) ? args[0].url : '';
      if (isRelevantUrl(url)) {
        console.log(`${LOG_PREFIX} Relevant fetch response detected: ${url.substring(0, 80)} (${response.status})`);
        // Clone response to read JSON without disrupting Instagram's application code
        const clonedRes = response.clone();
        clonedRes.json().then(data => {
          if (data && typeof data === 'object') {
            notifyContentScript(data, url, response.status);
          }
        }).catch(() => {
          // Failed to parse JSON. Still relay rate-limit signals so the scraper can back off.
          if (response.status >= 429) {
            notifyContentScript({ rateLimited: true }, url, response.status);
          }
        });
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Error processing fetch interceptor:`, err);
    }

    return response;
  };

  // --- Intercept XMLHttpRequest ---
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._ig_url = url;
    return originalXhrOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        if (this._ig_url && isRelevantUrl(this._ig_url)) {
          console.log(`${LOG_PREFIX} Relevant XHR response detected: ${String(this._ig_url).substring(0, 80)} (${this.status})`);
          if (this.status >= 429) {
            notifyContentScript({ rateLimited: true }, this._ig_url, this.status);
          }
          if (this.responseType === '' || this.responseType === 'text') {
            const data = JSON.parse(this.responseText);
            notifyContentScript(data, this._ig_url, this.status);
          } else if (this.responseType === 'json' && this.response) {
            notifyContentScript(this.response, this._ig_url, this.status);
          }
        }
      } catch (err) {
        // Not valid JSON or failed parse, ignore safely
      }
    });

    return originalXhrSend.apply(this, args);
  };

  // Initial Window state extraction if present (__additionalDataLoaded or __INITIAL_DATA__)
  function extractWindowGlobalData() {
    try {
      if (window.__additionalDataLoaded) {
        Object.keys(window.__additionalDataLoaded).forEach(key => {
          const item = window.__additionalDataLoaded[key];
          if (item) {
            notifyContentScript(item, `window.__additionalDataLoaded[${key}]`);
          }
        });
      }
    } catch (e) {
      // Ignore
    }
  }

  // Attempt initial scan after DOM loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', extractWindowGlobalData);
  } else {
    setTimeout(extractWindowGlobalData, 1000);
  }

})();
