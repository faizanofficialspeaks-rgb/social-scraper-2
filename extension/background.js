/**
 * background.js (MV3 Service Worker)
 * Manages extension events, downloads proxy, badge counters, and global watermark removal settings.
 */

console.log('[IG-SCRAPER-BG] Service worker initialized.');

// Initial default settings
chrome.runtime.onInstalled.addListener(() => {
  console.log('[IG-SCRAPER-BG] Extension installed successfully.');
  chrome.storage.local.set({
    scrollDelay: 2000,
    preferredQuality: 'highest',
    autoZipMetadata: true,
    watermarkCleaningEnabled: true
  });
});

// BroadcastChannel for app bridge communication
let bgChannel = null;
if (typeof BroadcastChannel !== 'undefined') {
  try {
    bgChannel = new BroadcastChannel('ig_scraper_extension_stream');
  } catch (err) {
    console.warn('[IG-SCRAPER-BG] BroadcastChannel setup fallback:', err);
  }
}

// Handle messages from content script, popup, or web app bridge
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Cross-tab relay for web app <-> extension content scripts
  if (request && (request.source === 'IG_SCRAPER_EXTENSION' || request.source === 'IG_SCRAPER_APP')) {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id && tab.id !== sender.tab?.id) {
          chrome.tabs.sendMessage(tab.id, request, () => {
            if (chrome.runtime.lastError) {
              // Ignore tabs that don't have matching content script listeners
            }
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
      console.log(`[IG-SCRAPER-BG] Global Watermark Removal toggled to: ${enabled}`);
      sendResponse({ status: 'ok', watermarkCleaningEnabled: enabled });
    });
    return true;
  } else if (request.type === 'GET_WATERMARK_SETTINGS') {
    chrome.storage.local.get(['watermarkCleaningEnabled'], (res) => {
      sendResponse({ watermarkCleaningEnabled: res.watermarkCleaningEnabled ?? true });
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
    return true; // Keep async response channel open
  }
});

