/**
 * app-bridge.js
 * Content script running on web application domains (localhost, Cloud Run, etc.)
 * Establishes a real-time bidirectional link between the Web App and the Chrome Extension.
 */

(function () {
  'use strict';

  const LOG_PREFIX = '[SCRAPER-BRIDGE]';
  console.log(`${LOG_PREFIX} Web App extension bridge initialized for multi-platform scraping.`);

  // 1. BroadcastChannel listener for cross-tab realtime synchronization
  let syncChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      syncChannel = new BroadcastChannel('IG_SCRAPER_LIVE_SYNC');
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} BroadcastChannel unavailable:`, err);
  }

  // Notify web app that the Chrome Extension bridge is active
  function announceExtensionPresence() {
    window.postMessage({
      source: 'IG_SCRAPER_EXTENSION',
      type: 'EXTENSION_PONG',
      timestamp: Date.now(),
      version: '3.1.0',
      connected: true
    }, '*');
  }

  // Announce presence immediately, on delay, and periodically
  announceExtensionPresence();
  setTimeout(announceExtensionPresence, 500);
  setInterval(announceExtensionPresence, 5000);

  // Relay BroadcastChannel messages directly to window.postMessage for the React Web App
  if (syncChannel) {
    syncChannel.onmessage = (event) => {
      if (!event.data || event.data.source !== 'IG_SCRAPER_EXTENSION') return;
      window.postMessage(event.data, '*');
    };
  }

  // Listen to chrome.runtime messages relayed from background.js
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.source === 'IG_SCRAPER_EXTENSION') {
        window.postMessage(message, '*');
      }
    });
  }

  // Helper to extract and dispatch platform storage updates
  function dispatchStorageSnapshot(result, eventType = 'STATE_UPDATE') {
    if (!result) return;
    const igItems = (result.ig_live_stream || []).map(item => ({ ...item, platform: 'instagram' }));
    const ttItems = (result.tiktok_live_stream || []).map(item => ({ ...item, platform: 'tiktok' }));
    const fbItems = (result.facebook_live_stream || []).map(item => ({ ...item, platform: 'facebook' }));
    const combinedItems = [...igItems, ...ttItems, ...fbItems];

    window.postMessage({
      source: 'IG_SCRAPER_EXTENSION',
      type: eventType,
      timestamp: Date.now(),
      mediaItems: combinedItems,
      igMediaItems: igItems,
      tiktokMediaItems: ttItems,
      facebookMediaItems: fbItems,
      stats: result.facebook_stats || result.tiktok_stats || result.ig_stats || { total: combinedItems.length, videos: 0, images: 0, carousels: 0 },
      profileUsername: result.facebook_profile || result.tiktok_profile || result.ig_profile || '',
      isScraping: result.facebook_is_scraping || result.tiktok_is_scraping || result.ig_is_scraping || false
    }, '*');
  }

  // Listen to chrome.storage.local changes if extension APIs are available
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        window.postMessage({
          source: 'IG_SCRAPER_EXTENSION',
          type: 'STORAGE_CHANGED',
          timestamp: Date.now(),
          changes: changes
        }, '*');

        chrome.storage.local.get([
          'ig_live_stream', 'tiktok_live_stream', 'facebook_live_stream',
          'ig_stats', 'tiktok_stats', 'facebook_stats',
          'ig_profile', 'tiktok_profile', 'facebook_profile',
          'ig_is_scraping', 'tiktok_is_scraping', 'facebook_is_scraping'
        ], (result) => {
          dispatchStorageSnapshot(result, 'STATE_UPDATE');
        });
      }
    });

    // Initial storage snapshot push to Web App
    chrome.storage.local.get([
      'ig_live_stream', 'tiktok_live_stream', 'facebook_live_stream',
      'ig_stats', 'tiktok_stats', 'facebook_stats',
      'ig_profile', 'tiktok_profile', 'facebook_profile',
      'ig_is_scraping', 'tiktok_is_scraping', 'facebook_is_scraping'
    ], (result) => {
      dispatchStorageSnapshot(result, 'INITIAL_SNAPSHOT');
    });
  }

  // Listen for commands sent from the Web App -> relay to Extension content scripts
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'IG_SCRAPER_APP') return;

    const command = event.data;

    if (command.type === 'EXTENSION_PING') {
      announceExtensionPresence();
      return;
    }

    if (command.type === 'CLEAR_RESULTS' || command.type === 'CLEAR_PLATFORM_RESULTS') {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        if (!command.platform || command.platform === 'tiktok') {
          chrome.storage.local.set({
            tiktok_live_stream: [],
            tiktok_stats: { total: 0, videos: 0, images: 0, carousels: 0 }
          });
        }
        if (!command.platform || command.platform === 'instagram') {
          chrome.storage.local.set({
            ig_live_stream: [],
            ig_stats: { total: 0, videos: 0, images: 0, carousels: 0 }
          });
        }
        if (!command.platform || command.platform === 'facebook') {
          chrome.storage.local.set({
            facebook_live_stream: [],
            facebook_stats: { total: 0, videos: 0, images: 0, carousels: 0 }
          });
        }
      }
    }

    // Forward command over BroadcastChannel to content scripts
    if (syncChannel) {
      try {
        syncChannel.postMessage(command);
      } catch (err) {
        console.warn(`${LOG_PREFIX} Error forwarding command via BroadcastChannel:`, err);
      }
    }

    // Also forward via chrome.runtime if supported
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(command, () => {
        if (chrome.runtime.lastError) {
          // Silent catch for disconnected context
        }
      });
    }
  });

})();
