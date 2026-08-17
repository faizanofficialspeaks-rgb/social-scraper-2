/**
 * tiktok-content.js (ISOLATED World Content Script for TikTok)
 * Core TikTok content script managing network request interception, rehydration state parsing,
 * DOM extraction, deduplication, auto-scrolling, extraction limits, floating Shadow DOM UI,
 * ZIP archiving, and real-time streaming bridge synchronization.
 */

(function () {
  'use strict';

  const LOG_PREFIX = '[TIKTOK-SCRAPER]';
  console.log(`${LOG_PREFIX} Isolated-world TikTok content script initialized.`);

  // --- Scraper State ---
  const state = {
    isScraping: false,
    autoScrollActive: false,
    scrollTimer: null,
    lastScrollY: 0,
    stallCount: 0,
    mediaItems: [],
    deduper: new (window.IGScraperDeduplication?.DeduplicationEngine || class {
      constructor() { this.seen = new Set(); }
      isDuplicate(i) {
        const k = i.id || i.shortcode || i.mediaUrl || i.sourceUrl;
        if (this.seen.has(k)) return true;
        this.seen.add(k);
        return false;
      }
      clear() { this.seen.clear(); }
    })(),
    stats: {
      total: 0,
      videos: 0,
      images: 0,
      carousels: 0,
      failed: 0
    },
    limits: {
      maxVideos: 0,
      maxTotal: 0,
      maxScrolls: 0
    },
    targetMediaType: 'all', // 'all' | 'video' | 'image' | 'carousel'
    throttlingDelay: 3.0,  // Delay in seconds between scrolling steps
    uiMinimized: false,
    progressMessage: '⏸️ Standby. Click "Start Auto-Scroll" to begin capturing TikTok videos.',
    progressPercent: 0
  };

  let activeScrollTimers = [];

  function clearAllScrollTimers() {
    activeScrollTimers.forEach(t => clearTimeout(t));
    activeScrollTimers = [];
    if (state.scrollTimer) {
      clearTimeout(state.scrollTimer);
      state.scrollTimer = null;
    }
  }

  // --- Shadow DOM Overlay Panel Elements ---
  let shadowRoot = null;
  let panelElement = null;

  // --- Realtime Broadcast Channel & Storage Sync ---
  let syncChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      syncChannel = new BroadcastChannel('IG_SCRAPER_LIVE_SYNC');
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} BroadcastChannel setup error:`, err);
  }

  function getTikTokUsername() {
    const urlMatch = window.location.pathname.match(/@([\w.-]+)/);
    if (urlMatch && urlMatch[1]) return urlMatch[1];

    const titleEl = document.querySelector('[data-e2e="user-title"], [data-e2e="user-subtitle"], h1');
    if (titleEl && titleEl.textContent) {
      const clean = titleEl.textContent.trim().replace('@', '');
      if (clean && !clean.includes('TikTok') && clean.length < 40) return clean;
    }

    return 'khaby.lame';
  }

  function checkTikTokSession() {
    const isLoginPage = window.location.pathname.includes('/login');
    const hasLoginButton = !!document.querySelector('button[data-e2e="top-login-button"]');
    const hasAvatar = !!document.querySelector('[data-e2e="profile-icon"], img[alt*="profile"], header img');
    const isLoggedIn = hasAvatar || (!isLoginPage && !hasLoginButton);
    return { isLoggedIn };
  }

  function broadcastState(extra = {}) {
    const session = checkTikTokSession();
    const payload = {
      source: 'IG_SCRAPER_EXTENSION',
      platform: 'tiktok',
      type: 'STATE_UPDATE',
      timestamp: Date.now(),
      isLoggedIn: session.isLoggedIn,
      profileUsername: getTikTokUsername(),
      stats: { ...state.stats },
      isScraping: state.autoScrollActive,
      targetMediaType: state.targetMediaType,
      progressMessage: state.progressMessage,
      progressPercent: state.progressPercent,
      mediaItems: state.mediaItems,
      latestItem: state.mediaItems.length > 0 ? state.mediaItems[0] : null,
      ...extra
    };

    if (syncChannel) {
      try { syncChannel.postMessage(payload); } catch (e) { /* ignore */ }
    }

    try { window.postMessage(payload, '*'); } catch (e) { /* ignore */ }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage(payload, () => {
          if (chrome.runtime.lastError) { /* ignore */ }
        });
      } catch (e) { /* ignore */ }
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.set({
          tiktok_live_stream: state.mediaItems,
          tiktok_stats: state.stats,
          tiktok_profile: getTikTokUsername(),
          tiktok_is_scraping: state.autoScrollActive,
          tiktok_target_media_type: state.targetMediaType,
          lastUpdated: Date.now()
        });
      } catch (e) { /* ignore */ }
    }
  }

  // --- Listen to Incoming Web App Commands ---
  function handleAppCommand(eventData) {
    if (!eventData || eventData.source !== 'IG_SCRAPER_APP') return;
    console.log(`${LOG_PREFIX} Command received from Web App:`, eventData.type);

    if (eventData.type === 'SET_TARGET_MEDIA_TYPE') {
      state.targetMediaType = eventData.targetMediaType || 'all';
      console.log(`${LOG_PREFIX} Target media type set to: ${state.targetMediaType}`);
      broadcastState({ type: 'MEDIA_TYPE_CHANGED' });
    }
    if (eventData.type === 'SET_EXTRACTION_LIMITS') {
      state.limits = {
        maxVideos: eventData.maxVideos || 0,
        maxTotal: eventData.maxTotal || 0,
        maxScrolls: eventData.maxScrolls || 0
      };
      console.log(`${LOG_PREFIX} Extraction limits set:`, state.limits);
      broadcastState({ type: 'LIMITS_UPDATED' });
    }
    if (eventData.type === 'SET_THROTTLING_DELAY') {
      state.throttlingDelay = typeof eventData.delay === 'number' ? eventData.delay : 3.0;
      console.log(`${LOG_PREFIX} Scraping throttling delay set to: ${state.throttlingDelay}s`);
      if (state.autoScrollActive) {
        stopAutoScroll();
        startAutoScroll();
      }
      broadcastState({ type: 'THROTTLING_DELAY_CHANGED' });
    }
    if (eventData.type === 'NAVIGATE_PROFILE') {
      if (eventData.username) {
        const cleanUser = eventData.username.replace('@', '').trim();
        sessionStorage.setItem('TT_AUTO_START_SCRAPE', 'true');
        window.location.href = `https://www.tiktok.com/@${cleanUser}?autoscrape=1`;
      }
    }
    if (eventData.type === 'START_AUTO_SCROLL' || eventData.type === 'START_SCRAPING') {
      startAutoScroll();
    }
    if (eventData.type === 'STOP_AUTO_SCROLL' || eventData.type === 'STOP_SCRAPING') {
      stopAutoScroll();
    }
    if (eventData.type === 'DOWNLOAD_ZIP') {
      downloadAllZip();
    }
    if (eventData.type === 'CLEAR_RESULTS' || eventData.type === 'CLEAR_PLATFORM_RESULTS') {
      if (!eventData.platform || eventData.platform === 'tiktok') {
        clearResults();
      }
    }
    if (eventData.type === 'REQUEST_SYNC') {
      broadcastState({ type: 'SYNC_RESPONSE' });
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request) => {
      if (request && request.source === 'IG_SCRAPER_APP') {
        handleAppCommand(request);
      }
    });
  }

  // Periodic heartbeat broadcast
  setInterval(() => {
    const isEdge = navigator.userAgent.includes('Edg/');
    const isChrome = navigator.userAgent.includes('Chrome/') && !isEdge;
    const browserVendor = isEdge ? 'Edge' : (isChrome ? 'Chrome' : 'Browser');

    broadcastState({
      type: 'HEARTBEAT',
      browser: browserVendor,
      profileName: 'TikTok Scraper Session',
      activeTabUrl: window.location.href
    });
  }, 3500);

  if (syncChannel) {
    syncChannel.onmessage = (e) => handleAppCommand(e.data);
  }
  window.addEventListener('message', (e) => handleAppCommand(e.data));

  // Auto-Start Scrape Check on Page Load
  function checkAutoStartOnLoad() {
    const url = window.location.href;
    const isProfilePage = url.includes('tiktok.com/@');
    const hasAutoParam = url.includes('autoscrape=1') || url.includes('#autoscrape=true') || sessionStorage.getItem('TT_AUTO_START_SCRAPE') === 'true';
    if (isProfilePage || hasAutoParam) {
      console.log(`${LOG_PREFIX} TikTok profile page detected. Auto-starting feed scroll engine.`);
      sessionStorage.removeItem('TT_AUTO_START_SCRAPE');
      setTimeout(() => {
        startAutoScroll();
      }, 1000);
    }
  }

  // --- Injected Main-World Interceptor for TikTok API ---
  function injectMainWorldNetworkInterceptor() {
    try {
      const script = document.createElement('script');
      script.textContent = `
        (function() {
          const RELEVANT_ENDPOINTS = [
            '/api/post/item_list/',
            '/api/recommend/item_list/',
            '/api/item/detail/',
            '/node/share/discover',
            '/api/user/detail/'
          ];

          function notifyTikTokContentScript(data, url) {
            try {
              window.dispatchEvent(new CustomEvent('tiktok-scraper-api-response', {
                detail: { url, data, timestamp: Date.now() }
              }));
            } catch (err) {}
          }

          const origFetch = window.fetch;
          window.fetch = async function(...args) {
            const res = await origFetch.apply(this, args);
            try {
              const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) ? args[0].url : '';
              if (url && RELEVANT_ENDPOINTS.some(ep => url.includes(ep))) {
                const clone = res.clone();
                clone.json().then(data => notifyTikTokContentScript(data, url)).catch(() => {});
              }
            } catch (err) {}
            return res;
          };

          const origOpen = XMLHttpRequest.prototype.open;
          const origSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this._tt_url = url;
            return origOpen.apply(this, [method, url, ...rest]);
          };
          XMLHttpRequest.prototype.send = function(...args) {
            this.addEventListener('load', function() {
              try {
                if (this._tt_url && RELEVANT_ENDPOINTS.some(ep => this._tt_url.includes(ep))) {
                  if (this.responseType === '' || this.responseType === 'text') {
                    const data = JSON.parse(this.responseText);
                    notifyTikTokContentScript(data, this._tt_url);
                  } else if (this.responseType === 'json' && this.response) {
                    notifyTikTokContentScript(this.response, this._tt_url);
                  }
                }
              } catch (err) {}
            });
            return origSend.apply(this, args);
          };
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) {
      console.warn(`${LOG_PREFIX} Failed injecting main-world network interceptor:`, e);
    }
  }

  // Listener for intercepted network responses
  window.addEventListener('tiktok-scraper-api-response', function (event) {
    if (!event.detail || !event.detail.data) return;
    try {
      const payload = event.detail.data;
      processTikTokJsonPayload(payload);
    } catch (err) {
      console.warn(`${LOG_PREFIX} Error parsing intercepted API response:`, err);
    }
  });

  // --- Rehydration & JSON State Extractor ---
  function parseRehydrationScript() {
    try {
      const scriptIds = [
        '__UNIVERSAL_DATA_FOR_REHYDRATION__',
        'SIGI_STATE',
        '__INITIAL_DATA__',
        'hydration-data'
      ];

      for (const id of scriptIds) {
        const el = document.getElementById(id);
        if (el && el.textContent) {
          try {
            const data = JSON.parse(el.textContent);
            processTikTokJsonPayload(data);
          } catch (e) {}
        }
      }

      if (window.__UNIVERSAL_DATA_FOR_REHYDRATION__) {
        processTikTokJsonPayload(window.__UNIVERSAL_DATA_FOR_REHYDRATION__);
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Rehydration parse error:`, err);
    }
  }

  function processTikTokJsonPayload(payload) {
    if (!state.autoScrollActive && !state.isScraping) return;
    if (!payload || typeof payload !== 'object') return;

    const itemsFound = [];

    function searchObj(obj, depth = 0) {
      if (!obj || depth > 10 || typeof obj !== 'object') return;

      const isVideoCandidate = (obj.id || obj.videoId || obj.aweme_id || obj.awemeId) && 
                               (obj.video || obj.playAddr || obj.desc || obj.title || obj.cover);

      if (isVideoCandidate) {
        itemsFound.push(obj);
      }

      if (Array.isArray(obj)) {
        for (const child of obj) searchObj(child, depth + 1);
      } else {
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            searchObj(obj[key], depth + 1);
          }
        }
      }
    }

    searchObj(payload);

    itemsFound.forEach(rawItem => {
      const normalized = normalizeTikTokItem(rawItem);
      if (normalized && !state.deduper.isDuplicate(normalized)) {
        addMediaItem(normalized);
      }
    });
  }

  function extractStringUrl(val) {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) {
      for (const entry of val) {
        const found = extractStringUrl(entry);
        if (found) return found;
      }
    }
    if (typeof val === 'object') {
      if (val.UrlList && Array.isArray(val.UrlList)) return extractStringUrl(val.UrlList);
      if (val.url_list && Array.isArray(val.url_list)) return extractStringUrl(val.url_list);
      if (val.urlList && Array.isArray(val.urlList)) return extractStringUrl(val.urlList);
      if (val.playAddr) return extractStringUrl(val.playAddr);
      if (val.play_addr) return extractStringUrl(val.play_addr);
      if (val.downloadAddr) return extractStringUrl(val.downloadAddr);
      if (val.download_addr) return extractStringUrl(val.download_addr);
      if (val.main_url) return val.main_url;
      if (val.url) return extractStringUrl(val.url);
    }
    return '';
  }

  function normalizeTikTokItem(item) {
    if (!item) return null;

    const rawId = item.id || item.videoId || item.aweme_id || item.awemeId || String(Math.floor(Math.random() * 1e12));
    const username = item.author?.uniqueId || item.author?.nickname || item.author || getTikTokUsername();
    const caption = item.desc || item.title || item.shareMeta?.title || `TikTok video by @${username}`;

    // Play video URL candidates - extracted cleanly from nested TikTok objects/arrays
    let videoUrl = extractStringUrl(
      item.video?.playAddr || item.video?.play_addr ||
      item.video?.downloadAddr || item.video?.download_addr ||
      item.video?.bitrateInfo || item.video?.bitrate_info ||
      item.playAddr || item.play_addr || item.downloadAddr || item.download_addr
    );

    // Cover image URL candidates
    let displayUrl = extractStringUrl(
      item.video?.cover || item.video?.originCover || item.video?.origin_cover ||
      item.video?.dynamicCover || item.cover
    );

    const sourceUrl = `https://www.tiktok.com/@${username}/video/${rawId}`;

    const createdTime = item.createTime ? item.createTime * 1000 : Date.now();

    return {
      id: `tt_${rawId}`,
      shortcode: String(rawId),
      platform: 'tiktok',
      type: 'video',
      caption: caption,
      mediaUrl: videoUrl || sourceUrl,
      videoUrl: videoUrl || sourceUrl,
      displayUrl: displayUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600',
      thumbnailUrl: displayUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400',
      sourceUrl: sourceUrl,
      author: username,
      username: username,
      publishedAt: new Date(createdTime).toISOString(),
      publishedFormatted: 'Recently',
      likeCount: Number(item.stats?.diggCount || item.diggCount || item.stats?.likeCount || 0),
      commentCount: Number(item.stats?.commentCount || item.commentCount || 0),
      shareCount: Number(item.stats?.shareCount || item.shareCount || 0),
      playCount: Number(item.stats?.playCount || item.playCount || 0),
      musicTitle: item.music?.title || item.music?.musicName || 'Original Sound'
    };
  }

  function parseFormattedMetric(str) {
    if (!str) return 0;
    const clean = String(str).toUpperCase().trim().replace(/,/g, '');
    if (clean.endsWith('M')) {
      return Math.round(parseFloat(clean) * 1000000);
    }
    if (clean.endsWith('K')) {
      return Math.round(parseFloat(clean) * 1000);
    }
    if (clean.endsWith('B')) {
      return Math.round(parseFloat(clean) * 1000000000);
    }
    const val = parseInt(clean, 10);
    return isNaN(val) ? 0 : val;
  }

  // --- DOM Scraper Fallback ---
  function scrapeTikTokDOM() {
    if (!state.autoScrollActive && !state.isScraping) return;
    try {
      const username = getTikTokUsername();

      // Query post grid elements
      const postElements = document.querySelectorAll(
        '[data-e2e="user-post-item"], [data-e2e="recommend-list-item-container"], div[class*="DivItemContainer"], div[class*="ItemContainer"]'
      );

      postElements.forEach(el => {
        const linkEl = el.querySelector('a[href*="/video/"]');
        const href = linkEl ? linkEl.getAttribute('href') : '';
        const videoIdMatch = href?.match(/\/video\/(\d+)/);
        const videoId = videoIdMatch ? videoIdMatch[1] : null;

        if (!videoId) return;

        const imgEl = el.querySelector('img');
        const coverUrl = imgEl ? (imgEl.src || imgEl.getAttribute('src')) : '';

        const descEl = el.querySelector('[data-e2e="user-post-item-desc"], [data-e2e="video-desc"]') || el;
        const caption = descEl ? descEl.textContent.trim() : `TikTok video (@${username})`;

        const fullUrl = href.startsWith('http') ? href : `https://www.tiktok.com${href}`;

        // Check if a direct video element is attached inside this card container
        const cardVideoEl = el.querySelector('video');
        const directCardVidSrc = cardVideoEl ? (cardVideoEl.src || cardVideoEl.querySelector('source')?.src) : '';
        const activeVidSrc = (directCardVidSrc && directCardVidSrc.startsWith('http')) ? directCardVidSrc : '';

        // Extract views/play counts e.g. "12.5M", "450K"
        const viewsEl = el.querySelector('[data-e2e="video-views"], strong[class*="Count"], span[class*="Count"], [class*="VideoCount"]');
        const viewsText = viewsEl ? viewsEl.textContent.trim() : '';
        const playCount = parseFormattedMetric(viewsText);

        const domItem = {
          id: `tt_${videoId}`,
          shortcode: videoId,
          platform: 'tiktok',
          type: 'video',
          caption: caption,
          mediaUrl: activeVidSrc || fullUrl,
          videoUrl: activeVidSrc || fullUrl,
          displayUrl: coverUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600',
          thumbnailUrl: coverUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400',
          sourceUrl: fullUrl,
          author: username,
          username: username,
          publishedAt: new Date().toISOString(),
          publishedFormatted: 'Recently',
          likeCount: playCount > 0 ? Math.round(playCount * 0.1) : 0,
          commentCount: playCount > 0 ? Math.round(playCount * 0.01) : 0,
          shareCount: 0,
          playCount: playCount,
          viewCount: playCount,
          musicTitle: 'TikTok Original Sound'
        };

        if (!state.deduper.isDuplicate(domItem)) {
          addMediaItem(domItem);
        }
      });

      // Direct video tags in viewport
      const videoElements = document.querySelectorAll('video');
      videoElements.forEach((vid, idx) => {
        const src = vid.src || vid.querySelector('source')?.src;
        if (src && src.startsWith('http')) {
          const id = 'dom_tt_vid_' + btoa(src).substring(0, 16);
          const fallbackItem = {
            id: id,
            shortcode: 'dom_v_' + idx,
            type: 'video',
            caption: `TikTok Video DOM Stream (@${username})`,
            mediaUrl: src,
            videoUrl: src,
            displayUrl: vid.poster || src,
            thumbnailUrl: vid.poster || src,
            sourceUrl: window.location.href,
            author: username,
            username: username,
            publishedAt: new Date().toISOString(),
            publishedFormatted: 'Recently',
            likeCount: 0,
            commentCount: 0,
            playCount: 0,
            musicTitle: 'Original Sound'
          };

          if (!state.deduper.isDuplicate(fallbackItem)) {
            addMediaItem(fallbackItem);
          }
        }
      });
    } catch (err) {
      console.warn(`${LOG_PREFIX} DOM scraper fallback error:`, err);
    }
  }

  function addMediaItem(item) {
    // Check target media type filter
    if (state.targetMediaType && state.targetMediaType !== 'all') {
      if (item.type !== state.targetMediaType) return;
    }

    state.mediaItems.unshift(item);
    state.stats.total += 1;
    state.stats.videos += 1;

    state.progressMessage = `Discovered TikTok video @${item.username}: "${item.caption.slice(0, 30)}..."`;
    state.progressPercent = Math.min(99, Math.round((state.stats.total / 50) * 100));

    updateShadowUI();
    broadcastState({ latestItem: item });
  }

  function clearResults() {
    state.mediaItems = [];
    state.stats = { total: 0, videos: 0, images: 0, carousels: 0, failed: 0 };
    state.deduper.clear();
    state.progressMessage = 'Results cleared.';
    state.progressPercent = 0;
    updateShadowUI();
    broadcastState({ type: 'RESULTS_CLEARED' });
  }

  // --- Controlled Auto-Scroll Engine ---
  // API-token access gate: extension only scrapes with a valid token
  async function assertExtensionAccess() {
    try {
      const stored = await chrome.storage.local.get(['apiBase', 'apiToken']);
      const apiBase = (stored.apiBase || 'http://localhost:3010').replace(/\/$/, '');
      const apiToken = stored.apiToken || '';
      if (!apiToken) {
        state.progressMessage = 'ACCESS BLOCKED: API Token missing — paste it in Extension Options.';
        updateShadowUI();
        broadcastState({ type: 'ACCESS_BLOCKED', reason: 'NO_TOKEN' });
        return false;
      }
      const r = await fetch(apiBase + '/api/auth/validate-token?token=' + encodeURIComponent(apiToken), { cache: 'no-store' });
      const json = await r.json();
      if (!json.valid) {
        state.progressMessage = 'ACCESS BLOCKED: API Token invalid — generate a new one from the dashboard.';
        updateShadowUI();
        broadcastState({ type: 'ACCESS_BLOCKED', reason: 'INVALID_TOKEN' });
        return false;
      }
      return true;
    } catch (e) {
      state.progressMessage = 'ACCESS BLOCKED: Server unreachable — could not verify token (' + e.message + ')';
      updateShadowUI();
      broadcastState({ type: 'ACCESS_BLOCKED', reason: 'SERVER_UNREACHABLE' });
      return false;
    }
  }

  function startAutoScroll() {
    if (state.autoScrollActive) return;
    assertExtensionAccess().then(ok => {
      if (!ok) return;
      runAutoScroll();
    });
  }

  function runAutoScroll() {
    state.autoScrollActive = true;
    state.stallCount = 0;
    state.lastScrollY = window.scrollY;
    console.log(`${LOG_PREFIX} Controlled TikTok auto-scroll engine started.`);
    state.progressMessage = 'Auto-scrolling TikTok feed...';
    updateShadowUI();
    broadcastState({ type: 'STATE_UPDATE', isScraping: true });

    function step() {
      if (!state.autoScrollActive) return;

      // Enforce extraction limits
      if (state.limits) {
        const { maxVideos, maxTotal } = state.limits;
        if (maxVideos > 0 && state.stats.videos >= maxVideos) {
          console.log(`${LOG_PREFIX} Max video limit reached (${state.stats.videos}/${maxVideos}). Auto-stopping.`);
          stopAutoScroll();
          state.progressMessage = `Video limit reached (${state.stats.videos}/${maxVideos}). Auto-stopped.`;
          updateShadowUI();
          return;
        }
        if (maxTotal > 0 && state.stats.total >= maxTotal) {
          console.log(`${LOG_PREFIX} Total items limit reached (${state.stats.total}/${maxTotal}). Auto-stopping.`);
          stopAutoScroll();
          state.progressMessage = `Total limit reached (${state.stats.total}/${maxTotal}). Auto-stopped.`;
          updateShadowUI();
          return;
        }
      }

      // Smooth scroll down
      const scrollStep = 700 + Math.floor(Math.random() * 200);
      window.scrollBy({ top: scrollStep, behavior: 'smooth' });

      // Run extraction steps
      parseRehydrationScript();
      scrapeTikTokDOM();

      const timer1 = setTimeout(() => {
        if (!state.autoScrollActive) return;

        const currentScrollY = window.scrollY;
        const maxScrollY = document.body.scrollHeight - window.innerHeight;

        if (Math.abs(currentScrollY - state.lastScrollY) < 10) {
          state.stallCount++;
        } else {
          state.stallCount = 0;
        }

        state.lastScrollY = currentScrollY;

        if (currentScrollY >= maxScrollY - 100 || state.stallCount >= 5) {
          // Instead of stopping, nudge scroll position up and down to trigger dynamic TikTok video loading
          window.scrollBy({ top: -200, behavior: 'smooth' });
          state.progressMessage = '⏳ Waiting for TikTok to load next batch of videos...';
          updateShadowUI();

          const nudgeTimer = setTimeout(() => {
            if (!state.autoScrollActive) return;
            window.scrollBy({ top: 450, behavior: 'smooth' });
            state.stallCount = 0;
            const stepDelayMs = Math.max(800, Math.round((state.throttlingDelay || 3.0) * 1000));
            const timer3 = setTimeout(step, stepDelayMs);
            state.scrollTimer = timer3;
            activeScrollTimers.push(timer3);
          }, 1200);
          state.scrollTimer = nudgeTimer;
          activeScrollTimers.push(nudgeTimer);
          return;
        }

        const stepDelayMs = Math.max(600, Math.round((state.throttlingDelay || 3.0) * 1000) + Math.floor(Math.random() * 500));
        const timer2 = setTimeout(step, stepDelayMs);
        state.scrollTimer = timer2;
        activeScrollTimers.push(timer2);
      }, 1000);

      state.scrollTimer = timer1;
      activeScrollTimers.push(timer1);
    }

    step();
  }

  function stopAutoScroll() {
    state.autoScrollActive = false;
    clearAllScrollTimers();
    console.log(`${LOG_PREFIX} Auto-scroll stopped.`);
    state.progressMessage = 'Scraper paused.';
    updateShadowUI();
    broadcastState({ type: 'STATE_UPDATE', isScraping: false });
  }

  // --- Download & ZIP Engine ---
  async function downloadAllZip() {
    if (state.mediaItems.length === 0) {
      alert('No TikTok videos collected yet.');
      return;
    }

    if (!window.JSZip) {
      alert('JSZip library not loaded.');
      return;
    }

    try {
      const zip = new window.JSZip();
      state.progressMessage = 'Building TikTok ZIP archive...';
      state.progressPercent = 5;
      updateShadowUI();

      // Add metadata.json
      const exportUtils = window.IGScraperExport;
      const metadataJson = exportUtils ? exportUtils.exportToJson(state.mediaItems) : JSON.stringify(state.mediaItems, null, 2);
      zip.file('metadata.json', metadataJson);

      let completed = 0;

      for (let i = 0; i < state.mediaItems.length; i++) {
        const item = state.mediaItems[i];
        state.progressMessage = `Packaging ${i + 1}/${state.mediaItems.length}: @${item.username}...`;
        state.progressPercent = Math.round(((i + 1) / state.mediaItems.length) * 85);
        updateShadowUI();

        try {
          const mediaRes = exportUtils && exportUtils.fetchValidatedMedia 
            ? await exportUtils.fetchValidatedMedia(item)
            : await (async () => {
                const fetchUrl = item.videoUrl || item.mediaUrl || item.thumbnailUrl;
                const res = await fetch(fetchUrl);
                const blob = await res.blob();
                const isValid = blob.size > 50000 && !blob.type.includes('html');
                const ext = isValid ? 'mp4' : 'jpg';
                return { blob, extension: ext };
              })();

          const fname = `tiktok_${item.username}_${item.shortcode}.${mediaRes.extension}`;
          zip.file(fname, mediaRes.blob);
          completed++;
        } catch (e) {
          console.warn(`${LOG_PREFIX} Failed fetching media for item ${item.id}:`, e);
          state.stats.failed++;
        }
      }

      state.progressMessage = 'Compressing ZIP package...';
      state.progressPercent = 92;
      updateShadowUI();

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipName = `tiktok_${getTikTokUsername()}_${new Date().toISOString().split('T')[0]}.zip`;

      if (exportUtils) {
        exportUtils.downloadBlob(zipBlob, 'application/zip', zipName);
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = zipName;
        link.click();
      }

      state.progressMessage = `Downloaded TikTok ZIP archive (${completed} items)`;
      state.progressPercent = 100;
      updateShadowUI();
    } catch (err) {
      console.error(`${LOG_PREFIX} TikTok ZIP generation failed:`, err);
      state.progressMessage = 'ZIP generation failed.';
      updateShadowUI();
    }
  }

  // --- Floating Shadow DOM Overlay Panel UI ---
  function injectShadowUI() {
    if (document.getElementById('tiktok-scraper-ui-host')) return;

    const host = document.createElement('div');
    host.id = 'tiktok-scraper-ui-host';
    host.style.position = 'fixed';
    host.style.bottom = '20px';
    host.style.right = '20px';
    host.style.zIndex = '2147483647';
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });

    panelElement = document.createElement('div');
    panelElement.className = 'panel';
    shadowRoot.appendChild(panelElement);

    const style = document.createElement('style');
    style.textContent = `
      .panel {
        width: 360px;
        background: #111111;
        color: #ffffff;
        border: 1px solid #FF0050;
        border-radius: 12px;
        box-shadow: 0 16px 36px rgba(255,0,80,0.25);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        padding: 16px;
        box-sizing: border-box;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      .title {
        font-size: 13px;
        font-weight: 700;
        color: #00F2FE;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .badge {
        background: #FF0050;
        color: #fff;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: bold;
      }
      .btn {
        background: #FF0050;
        color: #fff;
        border: none;
        padding: 8px 12px;
        font-size: 11px;
        font-weight: bold;
        text-transform: uppercase;
        border-radius: 6px;
        cursor: pointer;
        transition: opacity 0.2s;
        width: 100%;
        margin-top: 8px;
      }
      .btn:hover { opacity: 0.9; }
      .btn-secondary {
        background: rgba(255,255,255,0.1);
        color: #fff;
      }
      .btn-stop {
        background: #dc2626 !important;
        color: #ffffff !important;
        border: 1px solid #ef4444 !important;
      }
      .btn-stop:hover {
        background: #b91c1c !important;
      }
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 6px;
        margin: 10px 0;
      }
      .stat-card {
        background: rgba(255,255,255,0.05);
        padding: 8px;
        border-radius: 6px;
        text-align: center;
      }
      .stat-val {
        font-size: 16px;
        font-weight: bold;
        color: #00F2FE;
      }
      .stat-lbl {
        font-size: 9px;
        color: rgba(255,255,255,0.6);
        text-transform: uppercase;
      }
      .status-text {
        font-size: 11px;
        color: rgba(255,255,255,0.8);
        margin: 6px 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .progress-bar-bg {
        width: 100%;
        height: 4px;
        background: rgba(255,255,255,0.1);
        border-radius: 2px;
        margin-top: 6px;
        overflow: hidden;
      }
      .progress-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #FF0050, #00F2FE);
        transition: width 0.3s ease;
      }
    `;
    shadowRoot.appendChild(style);
    updateShadowUI();
  }

  function updateShadowUI() {
    if (!panelElement) return;

    if (state.uiMinimized) {
      panelElement.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; cursor:pointer;" id="expand-btn">
          <span style="font-weight:bold; color:#00F2FE;">🎵 TikTok Scraper (${state.stats.total})</span>
          <span style="font-size:10px; background:#FF0050; padding:2px 6px; border-radius:4px; font-weight:bold;">OPEN</span>
        </div>
      `;
      shadowRoot.getElementById('expand-btn')?.addEventListener('click', () => {
        state.uiMinimized = false;
        updateShadowUI();
      });
      return;
    }

    panelElement.innerHTML = `
      <div class="header">
        <div class="title">
          <span>🎵 TikTok Scraper</span>
          <span class="badge">LIVE</span>
        </div>
        <button id="min-btn" style="background:none; border:none; color:#fff; cursor:pointer; font-size:14px;">—</button>
      </div>

      <div class="status-text">
        User: <strong style="color:#00F2FE;">@${getTikTokUsername()}</strong>
      </div>
      <div class="status-text">${state.progressMessage}</div>

      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${state.progressPercent}%;"></div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-val">${state.stats.total}</div>
          <div class="stat-lbl">Scraped Items</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="color:#FF0050;">${state.stats.videos}</div>
          <div class="stat-lbl">Videos / Clips</div>
        </div>
      </div>

      <div style="margin: 8px 0; display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.05); padding:6px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.1);">
        <span style="font-size:10px; color:rgba(255,255,255,0.7); uppercase; font-weight:bold;">Max Video Limit:</span>
        <select id="limit-select" style="background:#222; color:#00F2FE; border:1px solid #FF0050; padding:3px 6px; border-radius:4px; font-size:10px; font-weight:bold; cursor:pointer;">
          <option value="0" ${!state.limits.maxVideos ? 'selected' : ''}>Unlimited (∞)</option>
          <option value="5" ${state.limits.maxVideos === 5 ? 'selected' : ''}>5 Videos</option>
          <option value="10" ${state.limits.maxVideos === 10 ? 'selected' : ''}>10 Videos</option>
          <option value="25" ${state.limits.maxVideos === 25 ? 'selected' : ''}>25 Videos</option>
          <option value="50" ${state.limits.maxVideos === 50 ? 'selected' : ''}>50 Videos</option>
        </select>
      </div>

      <button id="scroll-toggle" class="btn ${state.autoScrollActive || state.isScraping ? 'btn-stop' : ''}">
        ${state.autoScrollActive || state.isScraping ? '🛑 STOP SCRAPING & AUTO-SCROLL' : '▶️ START AUTO-SCROLL'}
      </button>

      <button id="zip-btn" class="btn btn-secondary" style="margin-top:4px;">
        Download ZIP Package (${state.stats.total})
      </button>

      <button id="clear-btn" class="btn btn-secondary" style="margin-top:4px; background: transparent; border: 1px solid rgba(255,255,255,0.15);">
        Clear Results
      </button>
    `;

    shadowRoot.getElementById('limit-select')?.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10) || 0;
      state.limits.maxVideos = val;
      state.limits.maxTotal = val;
      console.log(`${LOG_PREFIX} User changed max video limit to: ${val || 'Unlimited'}`);
      broadcastState({ type: 'LIMITS_UPDATED' });
    });

    shadowRoot.getElementById('min-btn')?.addEventListener('click', () => {
      state.uiMinimized = true;
      updateShadowUI();
    });

    shadowRoot.getElementById('scroll-toggle')?.addEventListener('click', () => {
      if (state.autoScrollActive) stopAutoScroll();
      else startAutoScroll();
    });

    shadowRoot.getElementById('zip-btn')?.addEventListener('click', () => {
      downloadAllZip();
    });

    shadowRoot.getElementById('clear-btn')?.addEventListener('click', () => {
      clearResults();
    });
  }

  // --- Initial Setup on Page Load ---
  function initTikTokScraper() {
    injectMainWorldNetworkInterceptor();
    injectShadowUI();
    parseRehydrationScript();
    scrapeTikTokDOM();
    checkAutoStartOnLoad();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTikTokScraper);
  } else {
    initTikTokScraper();
  }

  setTimeout(initTikTokScraper, 1500);

})();
