import { ExtensionFile } from '../types';

export const EXTENSION_FILES: ExtensionFile[] = [
  {
    path: 'manifest.json',
    name: 'manifest.json',
    language: 'json',
    category: 'manifest',
    content: `{
  "manifest_version": 3,
  "name": "Social Media Content Scraper & Media Downloader",
  "version": "1.0.0",
  "description": "Scrape and download Instagram & TikTok posts, reels, stories, carousel media, metadata, and export ZIP archives.",
  "permissions": [
    "storage",
    "downloads",
    "activeTab",
    "scripting"
  ],
  "host_permissions": [
    "https://*.instagram.com/*",
    "https://*.cdninstagram.com/*",
    "https://*.fbcdn.net/*",
    "https://*.tiktok.com/*",
    "https://*.tiktokcdn.com/*",
    "https://*.byteoversea.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": [
        "https://www.instagram.com/*",
        "https://instagram.com/*"
      ],
      "js": [
        "utils/jszip.min.js",
        "utils/normalization.js",
        "utils/media-ranking.js",
        "utils/deduplication.js",
        "utils/filename.js",
        "utils/export.js",
        "instagram-content.js"
      ],
      "run_at": "document_start"
    },
    {
      "matches": [
        "https://www.tiktok.com/*",
        "https://tiktok.com/*"
      ],
      "js": [
        "utils/jszip.min.js",
        "utils/normalization.js",
        "utils/media-ranking.js",
        "utils/deduplication.js",
        "utils/filename.js",
        "utils/export.js",
        "tiktok-content.js"
      ],
      "run_at": "document_start"
    },
    {
      "matches": [
        "https://www.instagram.com/*",
        "https://instagram.com/*"
      ],
      "js": [
        "main-instagram.js"
      ],
      "world": "MAIN",
      "run_at": "document_start"
    },
    {
      "matches": [
        "http://*/*",
        "https://*/*"
      ],
      "exclude_matches": [
        "https://www.instagram.com/*",
        "https://instagram.com/*",
        "https://www.tiktok.com/*",
        "https://tiktok.com/*"
      ],
      "js": [
        "app-bridge.js"
      ],
      "all_frames": true,
      "run_at": "document_start"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "Social Scraper"
  },
  "options_page": "options.html",
  "web_accessible_resources": [
    {
      "resources": [
        "panel.css",
        "utils/*.js"
      ],
      "matches": [
        "https://www.instagram.com/*",
        "https://instagram.com/*",
        "https://www.tiktok.com/*",
        "https://tiktok.com/*"
      ]
    }
  ]
}`
  },
  {
    path: 'main-instagram.js',
    name: 'main-instagram.js',
    language: 'javascript',
    category: 'scripts',
    content: `/**
 * main-instagram.js (MAIN World Interceptor)
 * Overrides fetch and XHR to capture Instagram API payloads.
 */
(function () {
  'use strict';
  const EVENT_NAME = 'instagram-scraper-api-response';
  const RELEVANT_URL_PATTERNS = [
    '/api/v1/feed/user/',
    '/api/v1/clips/user/',
    '/graphql/query',
    'web_profile_info'
  ];

  function isRelevantUrl(url) {
    return url && RELEVANT_URL_PATTERNS.some(p => url.includes(p));
  }

  function notifyContentScript(data, url) {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { data, url } }));
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    if (isRelevantUrl(url)) {
      res.clone().json().then(data => notifyContentScript(data, url)).catch(() => {});
    }
    return res;
  };
})();`
  },
  {
    path: 'tiktok-content.js',
    name: 'tiktok-content.js',
    language: 'javascript',
    category: 'scripts',
    content: `/**
 * tiktok-content.js (ISOLATED World Content Script for TikTok)
 * Handles TikTok DOM extraction, __UNIVERSAL_DATA_FOR_REHYDRATION__ parsing,
 * auto-scrolling, and floating Shadow DOM UI overlay.
 */
(function () {
  'use strict';
  console.log('[TIKTOK-SCRAPER] TikTok content script initialized.');

  function getTikTokUsername() {
    const match = window.location.pathname.match(/@([\\w.-]+)/);
    return match ? match[1] : 'tiktok_user';
  }

  function parseTikTokFeed() {
    const posts = document.querySelectorAll('[data-e2e="user-post-item"]');
    posts.forEach(post => {
      const link = post.querySelector('a[href*="/video/"]')?.getAttribute('href');
      const img = post.querySelector('img')?.getAttribute('src');
      const desc = post.querySelector('[data-e2e="user-post-item-desc"]')?.textContent;
      console.log('Found TikTok Video:', { link, img, desc });
    });
  }

  window.addEventListener('DOMContentLoaded', parseTikTokFeed);
})();`
  },
  {
    path: 'utils/normalization.js',
    name: 'utils/normalization.js',
    language: 'javascript',
    category: 'utils',
    content: `/**
 * normalization.js
 * Dynamic adapter parsing candidates into normalized media objects.
 */
(function (exports) {
  function extractMediaObjects(payload) {
    const results = [];
    function traverse(node) {
      if (!node || typeof node !== 'object') return;
      if (node.pk || node.id || node.shortcode) results.push(node);
      for (const k in node) if (typeof node[k] === 'object') traverse(node[k]);
    }
    traverse(payload);
    return results;
  }

  function normalizeMediaItem(item) {
    if (!item) return null;
    return {
      id: item.pk || item.id,
      shortcode: item.code || item.shortcode,
      type: item.is_video ? 'video' : 'image',
      caption: item.caption?.text || item.caption || '',
      mediaUrl: item.video_url || item.display_url || item.image_versions2?.candidates?.[0]?.url,
      username: item.user?.username || item.owner?.username || 'user'
    };
  }

  exports.extractMediaObjects = extractMediaObjects;
  exports.normalizeMediaItem = normalizeMediaItem;
})(typeof exports !== 'undefined' ? exports : (window.IGScraperNormalization = {}));`
  },
  {
    path: 'utils/deduplication.js',
    name: 'utils/deduplication.js',
    language: 'javascript',
    category: 'utils',
    content: `/**
 * deduplication.js
 * Multi-tier key hash filter preventing duplicate media entries.
 */
(function (exports) {
  class DeduplicationEngine {
    constructor() {
      this.seenIds = new Set();
      this.seenShortcodes = new Set();
    }
    isDuplicate(item) {
      if (item.id && this.seenIds.has(item.id)) return true;
      if (item.shortcode && this.seenShortcodes.has(item.shortcode)) return true;
      if (item.id) this.seenIds.add(item.id);
      if (item.shortcode) this.seenShortcodes.add(item.shortcode);
      return false;
    }
  }
  exports.DeduplicationEngine = DeduplicationEngine;
})(typeof exports !== 'undefined' ? exports : (window.IGScraperDeduplication = {}));`
  },
  {
    path: 'utils/watermark-remover.js',
    name: 'utils/watermark-remover.js',
    language: 'javascript',
    category: 'utils',
    content: `/**
 * watermark-remover.js
 * Canvas-based Instagram watermark & overlay cleaner utility.
 */
(function (exports) {
  async function cleanImageWatermark(imageUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(imageUrl);
        
        const w = img.width;
        const h = img.height;
        const cropH = Math.floor(h * 0.93); // Crop bottom overlay zone
        
        canvas.width = w;
        canvas.height = cropH;
        ctx.drawImage(img, 0, 0, w, cropH, 0, 0, w, cropH);
        
        // Edge blur on bottom left handle overlay
        ctx.save();
        ctx.filter = 'blur(10px)';
        ctx.drawImage(canvas, 10, cropH - 40, 160, 30, 10, cropH - 40, 160, 30);
        ctx.restore();

        resolve(canvas.toDataURL('image/jpeg', 0.95));
      };
      img.onerror = () => resolve(imageUrl);
      img.src = imageUrl;
    });
  }
  exports.cleanImageWatermark = cleanImageWatermark;
})(typeof exports !== 'undefined' ? exports : (window.IGScraperWatermarkRemover = {}));`
  },
  {
    path: 'app-bridge.js',
    name: 'app-bridge.js',
    language: 'javascript',
    category: 'scripts',
    content: `/**
 * app-bridge.js
 * Content script running on web application domains (localhost, Cloud Run, etc.)
 * Establishes a real-time bidirectional link between the Web App and Chrome Extension.
 */
(function () {
  'use strict';
  const LOG_PREFIX = '[IG-SCRAPER-BRIDGE]';
  console.log(\`\${LOG_PREFIX} Web App extension bridge initialized.\`);

  let syncChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      syncChannel = new BroadcastChannel('IG_SCRAPER_LIVE_SYNC');
    }
  } catch (err) {}

  function announceExtensionPresence() {
    window.postMessage({
      source: 'IG_SCRAPER_EXTENSION',
      type: 'EXTENSION_PONG',
      timestamp: Date.now(),
      version: '3.0.0',
      connected: true
    }, '*');
  }

  announceExtensionPresence();
  setTimeout(announceExtensionPresence, 500);
  setInterval(announceExtensionPresence, 1000);

  if (syncChannel) {
    syncChannel.onmessage = (event) => {
      if (!event.data || event.data.source !== 'IG_SCRAPER_EXTENSION') return;
      window.postMessage(event.data, '*');
    };
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.source === 'IG_SCRAPER_EXTENSION') {
        window.postMessage(message, '*');
      }
    });
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        window.postMessage({
          source: 'IG_SCRAPER_EXTENSION',
          type: 'STORAGE_CHANGED',
          timestamp: Date.now(),
          changes: changes
        }, '*');

        chrome.storage.local.get(['ig_live_stream', 'tiktok_live_stream', 'ig_stats', 'tiktok_stats', 'ig_profile', 'tiktok_profile', 'ig_is_scraping'], (result) => {
          if (result) {
            const mediaItems = [...(result.ig_live_stream || []), ...(result.tiktok_live_stream || [])];
            window.postMessage({
              source: 'IG_SCRAPER_EXTENSION',
              type: 'STATE_UPDATE',
              timestamp: Date.now(),
              mediaItems: mediaItems,
              stats: result.ig_stats || result.tiktok_stats || { total: mediaItems.length, videos: 0, images: 0, carousels: 0 },
              profileUsername: result.ig_profile || result.tiktok_profile || '',
              isScraping: result.ig_is_scraping || false
            }, '*');
          }
        });
      }
    });

    chrome.storage.local.get(['ig_live_stream', 'tiktok_live_stream', 'ig_stats', 'tiktok_stats', 'ig_profile', 'tiktok_profile', 'ig_is_scraping'], (result) => {
      if (result) {
        const mediaItems = [...(result.ig_live_stream || []), ...(result.tiktok_live_stream || [])];
        window.postMessage({
          source: 'IG_SCRAPER_EXTENSION',
          type: 'INITIAL_SNAPSHOT',
          timestamp: Date.now(),
          mediaItems: mediaItems,
          stats: result.ig_stats || result.tiktok_stats || { total: mediaItems.length, videos: 0, images: 0, carousels: 0 },
          profileUsername: result.ig_profile || result.tiktok_profile || '',
          isScraping: result.ig_is_scraping || false
        }, '*');
      }
    });
  }

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'IG_SCRAPER_APP') return;

    const command = event.data;

    if (command.type === 'EXTENSION_PING') {
      announceExtensionPresence();
      return;
    }

    if (syncChannel) {
      try {
        syncChannel.postMessage(command);
      } catch (err) {}
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(command, () => {
        if (chrome.runtime.lastError) {}
      });
    }
  });
})();`
  },
  {
    path: 'background.js',
    name: 'background.js',
    language: 'javascript',
    category: 'scripts',
    content: `/**
 * background.js (MV3 Service Worker)
 * Manages extension events, downloads proxy, badge counters, throttling delay, and global watermark removal settings.
 */
console.log('[SOCIAL-SCRAPER-BG] Service worker initialized.');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[SOCIAL-SCRAPER-BG] Extension installed successfully.');
  chrome.storage.local.set({
    throttlingDelay: 3.0,
    scrollDelay: 2000,
    preferredQuality: 'highest',
    autoZipMetadata: true,
    watermarkCleaningEnabled: true
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && (request.source === 'IG_SCRAPER_EXTENSION' || request.source === 'IG_SCRAPER_APP')) {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id && tab.id !== sender.tab?.id) {
          chrome.tabs.sendMessage(tab.id, request, () => {
            if (chrome.runtime.lastError) {}
          });
        }
      });
    });
  }

  if (request.type === 'UPDATE_BADGE') {
    const count = request.count || 0;
    chrome.action.setBadgeText({
      text: count > 0 ? String(count) : '',
      tabId: sender.tab?.id
    });
    chrome.action.setBadgeBackgroundColor({ color: '#E1306C' });
    sendResponse({ status: 'ok' });
  } else if (request.type === 'SET_WATERMARK_CLEANING') {
    const enabled = !!request.enabled;
    chrome.storage.local.set({ watermarkCleaningEnabled: enabled }, () => {
      sendResponse({ status: 'ok', watermarkCleaningEnabled: enabled });
    });
    return true;
  } else if (request.type === 'SET_THROTTLING_DELAY') {
    const delay = typeof request.delay === 'number' ? request.delay : 3.0;
    chrome.storage.local.set({ throttlingDelay: delay }, () => {
      sendResponse({ status: 'ok', throttlingDelay: delay });
    });
    return true;
  } else if (request.type === 'DOWNLOAD_FILE') {
    chrome.downloads.download({
      url: request.url,
      filename: request.filename,
      saveAs: false
    }, (downloadId) => {
      sendResponse({ downloadId, error: chrome.runtime.lastError?.message });
    });
    return true;
  }
});`
  },
  {
    path: 'options.html',
    name: 'options.html',
    language: 'html',
    category: 'ui',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Social Media Scraper Options</title>
</head>
<body style="padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc;">
  <h2 style="margin-top: 0; font-size: 20px; border-bottom: 1px solid #334155; padding-bottom: 12px; color: #ff6321;">Social Media Scraper Configuration</h2>
  
  <div style="margin-bottom: 18px;">
    <label style="display: block; font-weight: bold; margin-bottom: 6px; font-size: 13px;">Scraping Throttling & Anti-Detection Delay (seconds):</label>
    <input type="number" id="throttlingDelay" min="0.5" max="15.0" step="0.5" value="3.0" style="padding: 8px 12px; font-size: 14px; width: 100%; box-sizing: border-box; background: #1e293b; border: 1px solid #475569; color: #fff; border-radius: 4px;" />
    <small style="color: #94a3b8; font-size: 11px; display: block; margin-top: 4px;">Delays DOM scrolling and API extractions to mimic organic human browsing and prevent rate limiting.</small>
  </div>

  <div style="margin-bottom: 18px;">
    <label style="display: block; font-weight: bold; margin-bottom: 6px; font-size: 13px;">Auto-Scroll Step Delay (ms):</label>
    <input type="number" id="scrollDelay" value="2000" style="padding: 8px 12px; font-size: 14px; width: 100%; box-sizing: border-box; background: #1e293b; border: 1px solid #475569; color: #fff; border-radius: 4px;" />
  </div>

  <div style="margin-bottom: 24px;">
    <label style="display: flex; items-center: gap: 8px; font-size: 13px; cursor: pointer;">
      <input type="checkbox" id="watermarkCleaningEnabled" checked style="accent-color: #ff6321; width: 16px; height: 16px;" /> 
      <span>Automatic Watermark Removal (Crop Overlays & Remove Stamps)</span>
    </label>
  </div>

  <button id="saveBtn" style="padding: 10px 20px; font-weight: bold; font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; background: #ff6321; color: white; border: none; border-radius: 4px; cursor: pointer;">Save Configuration</button>
  <span id="saveStatus" style="margin-left: 12px; font-size: 12px; color: #38bdf8; font-weight: bold;"></span>

  <script src="options.js"></script>
</body>
</html>`
  },
  {
    path: 'options.js',
    name: 'options.js',
    language: 'javascript',
    category: 'ui',
    content: `document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['throttlingDelay', 'scrollDelay', 'watermarkCleaningEnabled'], (items) => {
    if (items.throttlingDelay) document.getElementById('throttlingDelay').value = items.throttlingDelay;
    if (items.scrollDelay) document.getElementById('scrollDelay').value = items.scrollDelay;
    document.getElementById('watermarkCleaningEnabled').checked = items.watermarkCleaningEnabled !== false;
  });
});

document.getElementById('saveBtn').addEventListener('click', () => {
  const throttlingDelay = parseFloat(document.getElementById('throttlingDelay').value) || 3.0;
  const scrollDelay = parseInt(document.getElementById('scrollDelay').value, 10) || 2000;
  const watermarkCleaningEnabled = document.getElementById('watermarkCleaningEnabled').checked;

  chrome.storage.local.set({ throttlingDelay, scrollDelay, watermarkCleaningEnabled }, () => {
    const status = document.getElementById('saveStatus');
    status.textContent = 'Configuration saved!';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});`
  },
  {
    path: 'panel.css',
    name: 'panel.css',
    language: 'css',
    category: 'ui',
    content: `/* Floating Shadow DOM Scraper Panel Styles */
#ig-scraper-root {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483647;
  width: 420px;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(0,0,0,0.22);
}`
  }
];
