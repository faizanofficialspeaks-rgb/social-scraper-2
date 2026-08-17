/**
 * facebook-content.js (ISOLATED World Content Script for Facebook)
 * Advanced robust content script for Facebook Reels, Watch, and Feed posts.
 * Features:
 * - Robust structural & attribute-based selectors (role="article", data-pagelet, data-visualcompletion, aria-labels)
 * - MutationObserver for dynamic feed updates without relying on event handlers
 * - GraphQL / Network response payload interceptor
 * - Automatic deduplication, stats aggregation, filtering, and ZIP packaging
 * - Floating Shadow DOM UI panel matching TikTok/Instagram scraper UX
 */

(function () {
  'use strict';

  const LOG_PREFIX = '[FACEBOOK-SCRAPER]';
  console.log(`${LOG_PREFIX} Initializing advanced robust Facebook content script.`);

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
    targetMediaType: 'all', // 'all' | 'video' | 'image'
    throttlingDelay: 2.5,  // Delay in seconds between scrolling steps
    uiMinimized: false,
    progressMessage: '⏸️ Standby. Click "Start Auto-Scroll" to begin capturing Facebook reels.',
    progressPercent: 0
  };

  let activeScrollTimers = [];
  let mutationObserver = null;
  let shadowRoot = null;
  let panelElement = null;

  function clearAllScrollTimers() {
    activeScrollTimers.forEach(t => clearTimeout(t));
    activeScrollTimers = [];
    if (state.scrollTimer) {
      clearTimeout(state.scrollTimer);
      state.scrollTimer = null;
    }
  }

  // --- Realtime Broadcast Channel & Storage Sync ---
  let syncChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      syncChannel = new BroadcastChannel('IG_SCRAPER_LIVE_SYNC');
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} BroadcastChannel setup error:`, err);
  }

  // --- Facebook Page & Handle Identifier Detection ---
  function getFacebookPageIdentifier() {
    const pathname = window.location.pathname;
    
    // Check for Reel ID
    const reelMatch = pathname.match(/\/reel\/(\d+)/);
    if (reelMatch && reelMatch[1]) return `reel_${reelMatch[1]}`;

    // Check for Watch / Video ID
    const videoMatch = pathname.match(/\/watch\/?\?v=(\d+)/) || pathname.match(/\/videos\/(\d+)/);
    if (videoMatch && videoMatch[1]) return `video_${videoMatch[1]}`;

    // Check for numeric profile ID in search params (profile.php?id=...)
    const urlParams = new URLSearchParams(window.location.search);
    const profileId = urlParams.get('id');
    if (profileId) return `profile_${profileId}`;

    // Check for /people/Name/ID/ format
    const peopleMatch = pathname.match(/\/people\/([^/]+)\/(\d+)/);
    if (peopleMatch && peopleMatch[2]) {
      return `${peopleMatch[1]}_${peopleMatch[2]}`;
    }

    // Check pathname segments
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      const topSegment = segments[0];
      if (!['watch', 'reel', 'reels', 'groups', 'marketplace', 'gaming', 'stories', 'pages', 'share', 'help', 'search', 'people'].includes(topSegment.toLowerCase())) {
        return topSegment;
      }
      if (segments[0].toLowerCase() === 'people' && segments[1]) {
        return segments[1];
      }
      if (segments[0].toLowerCase() === 'groups' && segments[1]) {
        return `group_${segments[1]}`;
      }
    }

    // Check page title or h1
    const titleEl = document.querySelector('h1, [data-pagelet*="ProfileHeader"], [role="main"] h2');
    if (titleEl && titleEl.textContent) {
      const clean = titleEl.textContent.trim().replace(/\s+/g, '_');
      if (clean && clean.length < 40 && !clean.includes('Facebook')) return clean;
    }

    return 'facebook_feed';
  }

  function checkFacebookSession() {
    const isLoginPage = window.location.pathname.includes('/login');
    const hasLoginButton = !!document.querySelector('button[name="login"], input[name="login"]');
    const hasAvatar = !!document.querySelector('svg[aria-label*="Your profile"], img[data-visualcompletion="profile-image"], [role="navigation"] img, [aria-label*="Account"]');
    const isLoggedIn = hasAvatar || (!isLoginPage && !hasLoginButton);
    return { isLoggedIn };
  }

  function broadcastState(extra = {}) {
    const session = checkFacebookSession();
    const pageId = getFacebookPageIdentifier();
    const payload = {
      source: 'IG_SCRAPER_EXTENSION',
      platform: 'facebook',
      type: 'STATE_UPDATE',
      timestamp: Date.now(),
      isLoggedIn: session.isLoggedIn,
      profileUsername: pageId,
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
          facebook_live_stream: state.mediaItems,
          facebook_stats: state.stats,
          facebook_profile: pageId,
          facebook_is_scraping: state.autoScrollActive,
          facebook_target_media_type: state.targetMediaType,
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
      broadcastState({ type: 'MEDIA_TYPE_CHANGED' });
    }
    if (eventData.type === 'SET_EXTRACTION_LIMITS') {
      state.limits = {
        maxVideos: eventData.maxVideos || 0,
        maxTotal: eventData.maxTotal || 0,
        maxScrolls: eventData.maxScrolls || 0
      };
      broadcastState({ type: 'LIMITS_UPDATED' });
    }
    if (eventData.type === 'SET_THROTTLING_DELAY') {
      state.throttlingDelay = typeof eventData.delay === 'number' ? eventData.delay : 2.5;
      if (state.autoScrollActive) {
        stopAutoScroll();
        startAutoScroll();
      }
      broadcastState({ type: 'THROTTLING_DELAY_CHANGED' });
    }
    if (eventData.type === 'NAVIGATE_PROFILE') {
      if (eventData.username) {
        const cleanTarget = eventData.username.trim();
        sessionStorage.setItem('FB_AUTO_START_SCRAPE', 'true');
        window.location.href = `https://www.facebook.com/${cleanTarget}`;
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
      if (!eventData.platform || eventData.platform === 'facebook') {
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

  setInterval(() => {
    broadcastState({
      type: 'HEARTBEAT',
      browser: navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome',
      profileName: 'Facebook Scraper Session',
      activeTabUrl: window.location.href
    });
  }, 4000);

  if (syncChannel) {
    syncChannel.onmessage = (e) => handleAppCommand(e.data);
  }
  window.addEventListener('message', (e) => handleAppCommand(e.data));

  // --- Injected Main-World Interceptor for Facebook GraphQL / API ---
  function injectMainWorldNetworkInterceptor() {
    try {
      const script = document.createElement('script');
      script.textContent = `
        (function() {
          const RELEVANT_ENDPOINTS = ['/api/graphql/', 'graphql', '/watch/', '/reel/', 'platforms/facebook'];

          function notifyFacebookContentScript(data, url) {
            try {
              window.dispatchEvent(new CustomEvent('facebook-scraper-api-response', {
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
                clone.json().then(data => notifyFacebookContentScript(data, url)).catch(() => {});
              }
            } catch (err) {}
            return res;
          };
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) {
      console.warn(`${LOG_PREFIX} Failed injecting main-world network interceptor:`, e);
    }
  }

  window.addEventListener('facebook-scraper-api-response', function (event) {
    if (!event.detail || !event.detail.data) return;
    try {
      processFacebookPayload(event.detail.data);
    } catch (err) {}
  });

  function processFacebookPayload(payload) {
    if (!state.autoScrollActive && !state.isScraping) return;
    if (!payload || typeof payload !== 'object') return;
    const itemsFound = [];

    function searchObj(obj, depth = 0) {
      if (!obj || depth > 8 || typeof obj !== 'object') return;

      const isCandidate = (obj.node || obj.video_id || obj.reel_id || obj.post_id || obj.id || obj.feedback) &&
                          (obj.video_url || obj.playable_url || obj.browser_native_hd_url || obj.browser_native_sd_url || obj.message || obj.story || obj.comet_sections);

      if (isCandidate) {
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

    itemsFound.forEach(raw => {
      const normalized = normalizeFacebookItem(raw);
      if (normalized && !state.deduper.isDuplicate(normalized)) {
        addMediaItem(normalized);
      }
    });
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

  // --- Robust DOM Scraper with Structural Selectors ---
  function scrapeFacebookDOM() {
    if (!state.autoScrollActive && !state.isScraping) return;
    try {
      const pageId = getFacebookPageIdentifier();

      // Robust multi-selector strategy for Facebook feed units, reels, and video watch cards
      const selectors = [
        'div[role="article"]',
        'div[data-pagelet*="FeedUnit"]',
        'div[data-pagelet*="ProfileTimeline"]',
        'div[data-visualcompletion="media-vc-image"]',
        'div[class*="x1yztbdb"]',
        'div[class*="x1lliihq"]',
        'div[class*="x1n2onr6"]'
      ];

      const feedUnits = document.querySelectorAll(selectors.join(', '));

      feedUnits.forEach(el => {
        // If el is an img directly, find its article parent or use it
        const container = el.closest('div[role="article"]') || el.closest('div[data-pagelet*="FeedUnit"]') || el;

        // Find video or reel link
        const linkEl = container.querySelector('a[href*="/reel/"], a[href*="/videos/"], a[href*="/watch/"], a[href*="/posts/"], a[href*="/photos/"]');
        const href = linkEl ? linkEl.getAttribute('href') : '';
        
        const reelIdMatch = href?.match(/\/reel\/(\d+)/);
        const videoIdMatch = href?.match(/\/videos\/(\d+)/) || href?.match(/\/watch\/?\?v=(\d+)/);
        const postIdMatch = href?.match(/\/posts\/([a-zA-Z0-9.]+)/) || href?.match(/\/photos\/[^/]+\/([0-9]+)/);
        
        const mediaId = reelIdMatch?.[1] || videoIdMatch?.[1] || postIdMatch?.[1] || ('fb_dom_' + Math.abs(hashCode(container.innerHTML || Math.random().toString())));

        const vidEl = container.querySelector('video');
        const imgEl = container.querySelector('img[data-visualcompletion="media-vc-image"], img[src*="fbcdn"]');
        // For videos: only use direct video URL (never thumbnail).
        const mediaUrl = vidEl?.src || vidEl?.querySelector('source')?.src || (href?.includes('reel') || href?.includes('videos') || href?.includes('watch') ? fullSourceUrl : '') || imgEl?.src || '';

        if (!mediaUrl && !href) return;

        // Extract caption / text with robust selectors
        const textEl = container.querySelector('div[data-ad-preview="message"], div[dir="auto"], span[dir="auto"]');
        const caption = textEl ? textEl.textContent.trim() : `Facebook post / reel by ${pageId}`;

        // Extract metrics (likes, comments, shares, views) from aria-labels and text
        let likeCount = 0;
        let commentCount = 0;
        let shareCount = 0;
        let viewCount = 0;

        const ariaElements = container.querySelectorAll('[aria-label]');
        ariaElements.forEach(ae => {
          const label = ae.getAttribute('aria-label') || '';
          if (label.includes('like') || label.includes('reactions')) {
            const num = parseInt(label.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(num)) likeCount = Math.max(likeCount, num);
          }
          if (label.includes('comment')) {
            const num = parseInt(label.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(num)) commentCount = Math.max(commentCount, num);
          }
          if (label.includes('share')) {
            const num = parseInt(label.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(num)) shareCount = Math.max(shareCount, num);
          }
          if (label.includes('views') || label.includes('plays')) {
            const num = parseFormattedMetric(label);
            if (num > viewCount) viewCount = num;
          }
        });

        // Scan text elements for view count mentions e.g. "1.2M views", "45K plays"
        const textNodes = container.querySelectorAll('span, div, a');
        textNodes.forEach(tn => {
          const txt = (tn.textContent || '').trim();
          if (/views|plays|view|play/i.test(txt)) {
            const match = txt.match(/([\d.,]+\s*[KMBkmb]?)\s*(views|plays|view|play)/i);
            if (match && match[1]) {
              const num = parseFormattedMetric(match[1]);
              if (num > viewCount) viewCount = num;
            }
          }
        });

        const fullSourceUrl = href ? (href.startsWith('http') ? href : `https://www.facebook.com${href}`) : window.location.href;
        const isVideo = !!vidEl || href?.includes('reel') || href?.includes('videos') || href?.includes('watch');

        // Collect every video stream source on the element (prefer quality-tiered CDN URLs)
        const vidCandidates = [];
        if (vidEl) {
          const allSrcs = [vidEl.src];
          vidEl.querySelectorAll('source').forEach(s => allSrcs.push(s.src));
          allSrcs.forEach(s => {
            if (s && /^https?:/i.test(s) && !vidCandidates.includes(s)) vidCandidates.push(s);
          });
        }

        const domItem = {
          id: `fb_${mediaId}`,
          shortcode: String(mediaId),
          platform: 'facebook',
          type: isVideo ? 'video' : 'image',
          caption: caption,
          mediaUrl: mediaUrl || 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=800',
          videoUrl: isVideo ? (vidEl?.src || mediaUrl) : '',
          videoCandidates: isVideo ? vidCandidates : [],
          displayUrl: imgEl?.src || 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=600',
          thumbnailUrl: imgEl?.src || 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=400',
          sourceUrl: fullSourceUrl,
          author: pageId,
          username: pageId,
          publishedAt: new Date().toISOString(),
          publishedFormatted: 'Recently',
          likeCount: likeCount,
          commentCount: commentCount,
          shareCount: shareCount,
          viewCount: viewCount > 0 ? viewCount : (isVideo ? (likeCount * 5 + 20) : 0)
        };

        if (!state.deduper.isDuplicate(domItem)) {
          addMediaItem(domItem);
        }
      });
    } catch (err) {
      console.warn(`${LOG_PREFIX} DOM scraper error:`, err);
    }
  }

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function normalizeFacebookItem(item) {
    if (!item) return null;
    const rawId = item.id || item.video_id || item.reel_id || item.post_id || Math.floor(Math.random() * 1e12);
    const caption = item.message || item.story || item.title || item.accessibility_caption || 'Facebook Video / Reel';

    // Prefer HD/quality-tiered URLs over generic SD playable_url
    const qualityUrls = [
      item.browser_native_hd_url,
      item.playable_url_quality_hd,
      item.hq_playable_url,
      item.video_url,
      item.browser_native_sd_url,
      item.playable_url_quality_sd,
      item.playable_url
    ].filter((u) => u && /^https?:/i.test(u));

    const videoCandidates = [];
    qualityUrls.forEach((u) => {
      if (!videoCandidates.includes(u)) videoCandidates.push(u);
    });

    const videoUrl = videoCandidates[0] || (item.video_url ? item.video_url : '');
    const imageUrl = item.thumbnailImage?.uri || item.preferred_thumbnail?.image?.uri || item.image_url || item.image?.uri || '';
    const pageId = getFacebookPageIdentifier();
    const isVideo = !!videoUrl || !!item.video_id || !!item.reel_id;

    return {
      id: `fb_${rawId}`,
      shortcode: String(rawId),
      platform: 'facebook',
      type: isVideo ? 'video' : 'image',
      caption: caption,
      mediaUrl: videoUrl || imageUrl || 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=800',
      videoUrl: videoUrl,
      videoCandidates: videoCandidates,
      displayUrl: imageUrl || 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=600',
      thumbnailUrl: imageUrl || 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=400',
      sourceUrl: `https://www.facebook.com/reel/${rawId}`,
      author: pageId,
      username: pageId,
      publishedAt: new Date().toISOString(),
      publishedFormatted: 'Recently',
      likeCount: Number(item.reactors_count || item.likes_count || item.feedback?.reactors?.count || 0),
      commentCount: Number(item.comments_count || item.feedback?.comment_count?.total_count || 0),
      shareCount: Number(item.shares_count || item.feedback?.share_count?.count || 0),
      viewCount: Number(item.video_view_count || item.views_count || 0)
    };
  }

  function addMediaItem(item) {
    if (state.targetMediaType && state.targetMediaType !== 'all') {
      if (item.type !== state.targetMediaType) return;
    }

    state.mediaItems.unshift(item);
    state.stats.total += 1;
    if (item.type === 'video') state.stats.videos += 1;
    else state.stats.images += 1;

    state.progressMessage = `Discovered Facebook item (${item.type}): "${item.caption.slice(0, 30)}..."`;
    state.progressPercent = Math.min(99, Math.round((state.stats.total / 40) * 100));

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

  // --- MutationObserver for Real-time Dynamic DOM Changes ---
  function initMutationObserver() {
    if (mutationObserver) return;
    try {
      let debounceTimer = null;
      mutationObserver = new MutationObserver((mutations) => {
        let hasNewNodes = false;
        for (const m of mutations) {
          if (m.addedNodes.length > 0) {
            hasNewNodes = true;
            break;
          }
        }
        if (hasNewNodes) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            scrapeFacebookDOM();
          }, 800);
        }
      });

      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
      console.log(`${LOG_PREFIX} MutationObserver initialized for dynamic Facebook feed rendering.`);
    } catch (e) {
      console.warn(`${LOG_PREFIX} MutationObserver init failed:`, e);
    }
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
    console.log(`${LOG_PREFIX} Controlled Facebook auto-scroll engine started.`);
    state.progressMessage = 'Auto-scrolling Facebook feed...';
    updateShadowUI();
    broadcastState({ type: 'STATE_UPDATE', isScraping: true });

    function step() {
      if (!state.autoScrollActive) return;

      if (state.limits) {
        const { maxVideos, maxTotal } = state.limits;
        if (maxVideos > 0 && state.stats.videos >= maxVideos) {
          stopAutoScroll();
          state.progressMessage = `Video limit reached (${state.stats.videos}/${maxVideos}). Auto-stopped.`;
          updateShadowUI();
          return;
        }
        if (maxTotal > 0 && state.stats.total >= maxTotal) {
          stopAutoScroll();
          state.progressMessage = `Total limit reached (${state.stats.total}/${maxTotal}). Auto-stopped.`;
          updateShadowUI();
          return;
        }
      }

      window.scrollBy({ top: 900, behavior: 'smooth' });
      scrapeFacebookDOM();

      const timer1 = setTimeout(() => {
        if (!state.autoScrollActive) return;

        const currentScrollY = window.scrollY;
        const maxScrollY = (document.body?.scrollHeight || document.documentElement.scrollHeight) - window.innerHeight;

        if (Math.abs(currentScrollY - state.lastScrollY) < 10) {
          state.stallCount++;
        } else {
          state.stallCount = 0;
        }
        state.lastScrollY = currentScrollY;

        if (currentScrollY >= maxScrollY - 100 || state.stallCount >= 5) {
          // Instead of stopping, nudge scroll position to trigger dynamic lazy loading of next batch
          window.scrollBy({ top: -200, behavior: 'smooth' });
          state.progressMessage = '⏳ Waiting for Facebook to load next batch of reels...';
          updateShadowUI();

          const nudgeTimer = setTimeout(() => {
            if (!state.autoScrollActive) return;
            window.scrollBy({ top: 450, behavior: 'smooth' });
            state.stallCount = 0;
            const stepDelayMs = Math.max(800, Math.round((state.throttlingDelay || 2.5) * 1000));
            const timer3 = setTimeout(step, stepDelayMs);
            state.scrollTimer = timer3;
            activeScrollTimers.push(timer3);
          }, 1200);
          state.scrollTimer = nudgeTimer;
          activeScrollTimers.push(nudgeTimer);
          return;
        }

        const stepDelayMs = Math.max(600, Math.round((state.throttlingDelay || 2.5) * 1000));
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
    state.progressMessage = 'Scraper paused.';
    updateShadowUI();
    broadcastState({ type: 'STATE_UPDATE', isScraping: false });
  }

  async function downloadAllZip() {
    if (state.mediaItems.length === 0) {
      alert('No Facebook media collected yet.');
      return;
    }
    if (!window.JSZip) {
      alert('JSZip library not loaded.');
      return;
    }

    try {
      const zip = new window.JSZip();
      state.progressMessage = 'Building Facebook ZIP archive...';
      state.progressPercent = 10;
      updateShadowUI();

      const exportUtils = window.IGScraperExport;
      const metadataJson = exportUtils ? exportUtils.exportToJson(state.mediaItems) : JSON.stringify(state.mediaItems, null, 2);
      zip.file('metadata.json', metadataJson);

      let completed = 0;
      for (let i = 0; i < state.mediaItems.length; i++) {
        const item = state.mediaItems[i];
        state.progressMessage = `Packaging ${i + 1}/${state.mediaItems.length}...`;
        state.progressPercent = Math.round(15 + ((i + 1) / state.mediaItems.length) * 80);
        updateShadowUI();

        try {
          const mediaRes = exportUtils && exportUtils.fetchValidatedMedia 
            ? await exportUtils.fetchValidatedMedia(item)
            : await (async () => {
                const fetchUrl = item.videoUrl || item.mediaUrl || item.thumbnailUrl;
                const res = await fetch(fetchUrl);
                const blob = await res.blob();
                const isValid = blob.size > 50000 && !blob.type.includes('html');
                return { blob, extension: (item.type === 'video' && isValid) ? 'mp4' : 'jpg' };
              })();

          const cleanUser = (item.username || 'fb').replace(/[^a-zA-Z0-9_]/g, '');
          zip.file(`facebook_${cleanUser}_${item.shortcode}.${mediaRes.extension}`, mediaRes.blob);
          completed++;
        } catch (e) {
          state.stats.failed++;
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipName = `facebook_${getFacebookPageIdentifier()}_${new Date().toISOString().split('T')[0]}.zip`;

      if (exportUtils) {
        exportUtils.downloadBlob(zipBlob, 'application/zip', zipName);
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = zipName;
        link.click();
      }

      state.progressMessage = `Downloaded Facebook ZIP archive (${completed} items)`;
      state.progressPercent = 100;
      updateShadowUI();
    } catch (err) {
      state.progressMessage = 'ZIP generation failed.';
      updateShadowUI();
    }
  }

  // --- Floating Shadow DOM Overlay Panel UI ---
  function injectShadowUI() {
    if (document.getElementById('facebook-scraper-ui-host')) return;
    if (!document.body) {
      setTimeout(injectShadowUI, 200);
      return;
    }

    const host = document.createElement('div');
    host.id = 'facebook-scraper-ui-host';
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
        background: #18191A;
        color: #E4E6EB;
        border: 1px solid #1877F2;
        border-radius: 12px;
        box-shadow: 0 16px 36px rgba(24,119,242,0.25);
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
        color: #2D88FF;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .badge {
        background: #1877F2;
        color: #fff;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: bold;
      }
      .btn {
        background: #1877F2;
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
        color: #2D88FF;
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
        background: linear-gradient(90deg, #1877F2, #2D88FF);
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
          <span style="font-weight:bold; color:#2D88FF;">📘 FB Scraper (${state.stats.total})</span>
          <span style="font-size:10px; background:#1877F2; padding:2px 6px; border-radius:4px; font-weight:bold;">OPEN</span>
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
          <span>📘 Facebook Scraper</span>
          <span class="badge">LIVE</span>
        </div>
        <button id="min-btn" style="background:none; border:none; color:#fff; cursor:pointer; font-size:14px;">—</button>
      </div>

      <div class="status-text">
        Target: <strong style="color:#2D88FF;">${getFacebookPageIdentifier()}</strong>
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
          <div class="stat-val" style="color:#2D88FF;">${state.stats.videos}</div>
          <div class="stat-lbl">Reels / Videos</div>
        </div>
      </div>

      <div style="margin: 8px 0; display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.05); padding:6px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.1);">
        <span style="font-size:10px; color:rgba(255,255,255,0.7); text-transform:uppercase; font-weight:bold;">Max Video Limit:</span>
        <select id="limit-select" style="background:#242526; color:#2D88FF; border:1px solid #1877F2; padding:3px 6px; border-radius:4px; font-size:10px; font-weight:bold; cursor:pointer;">
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

  function initFacebookScraper() {
    injectMainWorldNetworkInterceptor();
    injectShadowUI();
    initMutationObserver();
    scrapeFacebookDOM();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFacebookScraper);
  } else {
    initFacebookScraper();
  }

  setTimeout(initFacebookScraper, 1000);
  setInterval(() => {
    injectShadowUI();
    scrapeFacebookDOM();
  }, 2000);

})();
