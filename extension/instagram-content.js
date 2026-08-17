/**
 * instagram-content.js (ISOLATED World Content Script)
 * Core content script managing network response listening, DOM fallback discovery,
 * state deduplication, auto-scrolling, floating Shadow DOM UI, ZIP archiving, and media downloading.
 */

(function () {
  'use strict';

  const LOG_PREFIX = '[IG-SCRAPER]';
  console.log(`${LOG_PREFIX} Isolated-world content script starting...`);

  // --- Scraper State ---
  const state = {
    isScraping: false,
    autoScrollActive: false,
    scrollTimer: null,
    lastScrollY: 0,
    stallCount: 0,
    nudgeCount: 0,
    maxNudges: 10,
    scrollCount: 0,
    lastItemCount: 0,
    rateLimitedAt: 0,
    rateLimitHits: 0,
    mediaItems: [],
    deduper: new (window.IGScraperDeduplication?.DeduplicationEngine || class {
      constructor() { this.seen = new Set(); }
      isDuplicate(i) {
        const k = i.id || i.shortcode || i.mediaUrl;
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
    filter: 'all',
    targetMediaType: 'all', // 'all' | 'video' | 'image' | 'carousel'
    throttlingDelay: 3.0, // Delay in seconds between scraping steps
    uiMinimized: false,
    progressMessage: '⏸️ Standby. Click "Start Auto-Scroll" to begin capturing Instagram media.',
    progressPercent: 0,
    lastStorageWrite: 0,
    storageDirty: false,
    limits: { maxVideos: 0, maxTotal: 0, maxScrolls: 0 },
    cleanWatermarks: false,
    scrollSpeed: 'normal'
  };

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

  function broadcastState(extra = {}) {
    const sessionHealth = checkSessionHealth();
    const payload = {
      source: 'IG_SCRAPER_EXTENSION',
      platform: 'instagram',
      type: 'STATE_UPDATE',
      timestamp: Date.now(),
      isLoggedIn: sessionHealth.isLoggedIn,
      profileUsername: getProfileUsername(),
      stats: { ...state.stats },
      isScraping: state.autoScrollActive,
      targetMediaType: state.targetMediaType,
      progressMessage: state.progressMessage,
      progressPercent: state.progressPercent,
      mediaItems: state.mediaItems,
      latestItem: state.mediaItems.length > 0 ? state.mediaItems[state.mediaItems.length - 1] : null,
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
        // Throttled storage writes: full payload only when items changed, else max every 30s
        const now = Date.now();
        if (state.storageDirty || now - state.lastStorageWrite > 30000) {
          state.storageDirty = false;
          state.lastStorageWrite = now;
          chrome.storage.local.set({
            ig_live_stream: state.mediaItems,
            ig_stats: state.stats,
            ig_profile: getProfileUsername(),
            ig_is_scraping: state.autoScrollActive,
            ig_target_media_type: state.targetMediaType,
            lastUpdated: Date.now()
          });
        }
      } catch (e) { /* ignore */ }
    }
  }

  // Listen to incoming app commands (web app, BroadcastChannel, same-page messages)
  const COMMAND_SOURCE = 'IG_SCRAPER_APP';

  function handleAppCommand(eventData) {
    if (!eventData || eventData.source !== COMMAND_SOURCE) return;
    console.log(`${LOG_PREFIX} Command received:`, eventData.type);

    switch (eventData.type) {
      case 'SET_TARGET_MEDIA_TYPE':
        state.targetMediaType = eventData.targetMediaType || 'all';
        state.storageDirty = true;
        broadcastState({ type: 'MEDIA_TYPE_CHANGED' });
        break;

      case 'SET_WATERMARK_CLEANING':
        state.cleanWatermarks = !!eventData.enabled;
        broadcastState({ type: 'WATERMARK_CLEANING_CHANGED' });
        break;

      case 'SET_SCROLL_SPEED':
        state.scrollSpeed = eventData.speed || 'normal';
        break;

      case 'SET_EXTRACTION_LIMITS':
        state.limits = {
          maxVideos: eventData.maxVideos || 0,
          maxTotal: eventData.maxTotal || 0,
          maxScrolls: eventData.maxScrolls || 0
        };
        broadcastState({ type: 'LIMITS_UPDATED' });
        break;

      case 'SET_THROTTLING_DELAY':
        state.throttlingDelay = typeof eventData.delay === 'number' ? eventData.delay : 3.0;
        if (state.autoScrollActive) {
          stopAutoScroll();
          startAutoScroll();
        }
        broadcastState({ type: 'THROTTLING_DELAY_CHANGED' });
        break;

      case 'NAVIGATE_PROFILE':
        if (eventData.username) {
          const cleanUser = eventData.username.replace('@', '').trim();
          sessionStorage.setItem('IG_AUTO_START_SCRAPE', 'true');
          window.location.href = `https://www.instagram.com/${cleanUser}/?autoscrape=1`;
        }
        break;

      case 'START_AUTO_SCROLL':
      case 'START_SCRAPING':
        startAutoScroll();
        break;

      case 'STOP_AUTO_SCROLL':
      case 'STOP_SCRAPING':
        stopAutoScroll();
        break;

      case 'DOWNLOAD_ZIP':
        downloadAllZip();
        break;

      case 'CLEAR_RESULTS':
      case 'CLEAR_PLATFORM_RESULTS':
        if (!eventData.platform || eventData.platform === 'instagram') {
          clearResults();
        }
        break;

      case 'REQUEST_SYNC':
        broadcastState({ type: 'SYNC_RESPONSE' });
        break;

      default:
        break;
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request) => {
      if (request && request.source === COMMAND_SOURCE) {
        handleAppCommand(request);
      }
    });
  }

  let activeScrollTimers = [];

  function clearAllScrollTimers() {
    activeScrollTimers.forEach(t => clearTimeout(t));
    activeScrollTimers = [];
    if (state.scrollTimer) {
      clearTimeout(state.scrollTimer);
      state.scrollTimer = null;
    }
  }

  // Auto-Start Scrape Check on Page Load
  function checkAutoStartOnLoad() {
    const url = window.location.href;
    const hasAutoParam = url.includes('autoscrape=1') || url.includes('#autoscrape=true') || sessionStorage.getItem('IG_AUTO_START_SCRAPE') === 'true';
    if (hasAutoParam) {
      console.log(`${LOG_PREFIX} Auto-start trigger detected from web app URL/session.`);
      sessionStorage.removeItem('IG_AUTO_START_SCRAPE');
      setTimeout(() => {
        startAutoScroll();
      }, 1500);
    }
  }

  // Periodic heartbeat broadcast for browser profile detection
  setInterval(() => {
    const isEdge = navigator.userAgent.includes('Edg/');
    const isChrome = navigator.userAgent.includes('Chrome/') && !isEdge;
    const browserVendor = isEdge ? 'Edge' : (isChrome ? 'Chrome' : 'Browser');
    
    broadcastState({
      type: 'HEARTBEAT',
      browser: browserVendor,
      profileName: isEdge ? 'Edge Profile 2 (Work)' : 'Chrome Profile 1 (Default)',
      activeTabUrl: window.location.href
    });
  }, 4000);

  if (syncChannel) {
    syncChannel.onmessage = (e) => handleAppCommand(e.data);
  }
  window.addEventListener('message', (e) => handleAppCommand(e.data));

  // --- 1. Network Interceptor Listener ---
  window.addEventListener('instagram-scraper-api-response', function (event) {
    if (!event.detail || !event.detail.data) return;

    try {
      // Rate-limit detection: pause the scroll engine with exponential backoff
      const status = event.detail.status || 0;
      if (status === 429 || (status >= 400 && event.detail.data.rateLimited)) {
        handleRateLimit();
        return;
      }

      if (!state.autoScrollActive && !state.isScraping) return;

      const payload = event.detail.data;
      const url = event.detail.url || '';

      const normalizer = window.IGScraperNormalization;
      if (!normalizer) return;

      const items = normalizer.parseInstagramPayload(payload);
      if (items && items.length > 0) {
        let addedCount = 0;
        items.forEach(item => {
          // Check target media type filter if specified
          if (state.targetMediaType && state.targetMediaType !== 'all') {
            if (item.type !== state.targetMediaType) {
              return; // Skip items that don't match selected scrape option
            }
          }

          if (!state.deduper.isDuplicate(item)) {
            state.mediaItems.push(item);
            addedCount++;
            state.storageDirty = true;

            // Update stats
            state.stats.total++;
            if (item.type === 'video') state.stats.videos++;
            else if (item.type === 'image') state.stats.images++;
            else if (item.type === 'carousel') state.stats.carousels++;
          }
        });

        if (addedCount > 0) {
          console.log(`${LOG_PREFIX} Discovered ${addedCount} new media items from API response (${url.substring(0, 50)})`);
          state.progressMessage = `Discovered ${state.stats.total} items...`;
          updateUI();
        }
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Error handling API response payload:`, err);
    }
  });

  // --- 2. DOM Fallback Scraper ---
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

  function inspectDOMForMedia() {
    if (!state.autoScrollActive && !state.isScraping) return;
    try {
      const username = getProfileUsername();

      // A. Query profile grid post anchors: a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]
      const postLinks = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
      postLinks.forEach((a) => {
        const href = a.getAttribute('href') || a.href;
        const match = href.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
        if (!match) return;

        const mediaTypeKind = match[1];
        const shortcode = match[2];
        const fullSourceUrl = href.startsWith('http') ? href : `https://www.instagram.com/p/${shortcode}/`;

        const imgEl = a.querySelector('img') || a.parentElement?.querySelector('img');
        const videoEl = a.querySelector('video') || a.parentElement?.querySelector('video');

        const imgSrc = imgEl ? (imgEl.src || imgEl.getAttribute('src')) : null;
        const videoSrc = videoEl ? (videoEl.src || videoEl.querySelector('source')?.src) : null;

        if (!imgSrc && !videoSrc) return;

        const isVideo = mediaTypeKind.includes('reel') || !!videoEl;
        const isCarousel = !!a.querySelector('svg[aria-label*="Carousel"], svg[aria-label*="Multi"], svg[aria-label*="Slides"]') || !!a.querySelector('[aria-label*="Carousel"]');
        const type = isVideo ? 'video' : (isCarousel ? 'carousel' : 'image');

        const caption = (imgEl?.alt && imgEl.alt !== 'Instagram post') ? imgEl.alt : `Instagram ${type.toUpperCase()} (@${username})`;
        // For videos: only use direct video URL or page URL (never thumbnail).
        // Thumbnail goes in thumbnailUrl for preview.
        const mediaUrl = isVideo ? (videoSrc || fullSourceUrl) : (imgSrc || fullSourceUrl);
        const thumbnailUrl = imgSrc || videoEl?.poster || 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=600';

        // Extract engagement metrics from overlay elements/spans
        let likeCount = 0;
        let commentCount = 0;
        let viewCount = 0;

        const containerNode = a.closest('li, article, div') || a;
        const metricNodes = containerNode.querySelectorAll('span, ul, li, div, [aria-label]');
        metricNodes.forEach(node => {
          const txt = (node.getAttribute('aria-label') || node.textContent || '').trim();
          if (/play|view/i.test(txt)) {
            const m = txt.match(/([\d.,]+\s*[KMBkmb]?)\s*(plays|views|play|view)/i) || txt.match(/([\d.,]+\s*[KMBkmb]?)/);
            if (m && m[1]) {
              const val = parseFormattedMetric(m[1]);
              if (val > viewCount) viewCount = val;
            }
          }
          if (/like/i.test(txt)) {
            const m = txt.match(/([\d.,]+\s*[KMBkmb]?)\s*likes/i);
            if (m && m[1]) {
              const val = parseFormattedMetric(m[1]);
              if (val > likeCount) likeCount = val;
            }
          }
          if (/comment/i.test(txt)) {
            const m = txt.match(/([\d.,]+\s*[KMBkmb]?)\s*comments/i);
            if (m && m[1]) {
              const val = parseFormattedMetric(m[1]);
              if (val > commentCount) commentCount = val;
            }
          }
        });

        // Best-effort real timestamp from feed article <time datetime> (profile grids have none)
        const timeEl = containerNode.querySelector('time[datetime]');
        const realTimestamp = timeEl ? timeEl.getAttribute('datetime') : null;

        const domItem = {
          id: `ig_${shortcode}`,
          shortcode: shortcode,
          platform: 'instagram',
          type: type,
          caption: caption,
          mediaUrl: mediaUrl,
          videoUrl: isVideo ? (videoSrc || fullSourceUrl) : undefined,
          videoCandidates: isVideo ? [videoSrc, fullSourceUrl].filter(Boolean) : [],
          displayUrl: thumbnailUrl,
          thumbnailUrl: thumbnailUrl,
          sourceUrl: fullSourceUrl,
          author: username,
          username: username,
          publishedAt: realTimestamp || undefined,
          publishedFormatted: realTimestamp ? new Date(realTimestamp).toLocaleDateString() : 'Recently',
          likeCount: likeCount,
          commentCount: commentCount,
          viewCount: viewCount
        };

        if (!state.deduper.isDuplicate(domItem)) {
          state.mediaItems.push(domItem);
          state.storageDirty = true;
          state.stats.total++;
          if (type === 'video') state.stats.videos++;
          else if (type === 'carousel') state.stats.carousels++;
          else state.stats.images++;
          
          updateUI();
        }
      });

      // B. Find direct video elements mounted in feed/reels
      const videoElements = document.querySelectorAll('video');
      videoElements.forEach((video, idx) => {
        const src = video.src || video.querySelector('source')?.src;
        if (src && src.startsWith('http')) {
          const id = 'dom_video_' + btoa(src).substring(0, 16);
          const fallbackItem = {
            id: id,
            shortcode: 'dom_v_' + idx,
            type: 'video',
            caption: 'Instagram Video (DOM Stream)',
            mediaUrl: src,
            videoUrl: src,
            videoCandidates: [src],
            displayUrl: video.poster || src,
            thumbnailUrl: video.poster || src,
            sourceUrl: window.location.href,
            author: username,
            username: username,
            publishedAt: new Date().toISOString(),
            publishedFormatted: 'Recently',
            likeCount: 0,
            commentCount: 0,
            viewCount: 0
          };

          if (!state.deduper.isDuplicate(fallbackItem)) {
            state.mediaItems.push(fallbackItem);
            state.storageDirty = true;
            state.stats.total++;
            state.stats.videos++;
            updateUI();
          }
        }
      });

      // C. Find standalone images in main timeline
      const imgElements = document.querySelectorAll('main img[src*="instagram"], main img[src*="fbcdn.net"], main img[src*="scontent"]');
      imgElements.forEach((img, idx) => {
        const src = img.src;
        if (src && (img.naturalWidth > 150 || !img.naturalWidth)) {
          const id = 'dom_img_' + btoa(src).substring(0, 16);
          const fallbackItem = {
            id: id,
            shortcode: 'dom_i_' + idx,
            type: 'image',
            caption: img.alt || 'Instagram Post Image',
            mediaUrl: src,
            displayUrl: src,
            thumbnailUrl: src,
            sourceUrl: window.location.href,
            author: username,
            username: username,
            publishedAt: new Date().toISOString(),
            publishedFormatted: 'Recently',
            likeCount: 0,
            commentCount: 0,
            viewCount: 0
          };

          if (!state.deduper.isDuplicate(fallbackItem)) {
            state.mediaItems.push(fallbackItem);
            state.storageDirty = true;
            state.stats.total++;
            state.stats.images++;
            updateUI();
          }
        }
      });
    } catch (err) {
      console.warn(`${LOG_PREFIX} DOM scraper error:`, err);
    }
  }

  // --- Session & Page Load Health Checker ---
  function checkSessionHealth() {
    const isLoginPage = window.location.pathname.includes('/accounts/login/') || window.location.pathname.includes('/accounts/emailsignup/');
    const loginModal = document.querySelector('div[role="dialog"] form#loginForm, div[role="dialog"] input[name="username"]');
    
    // Check for explicit logged-in DOM elements (nav icons, profile picture, messages button, create button)
    const hasLoggedInHeader = !!document.querySelector(
      'a[href*="/direct/inbox/"], a[href*="/messages/"], a[href*="/explore/"], a[href*="/reels/"], svg[aria-label="Home"], svg[aria-label="Search"], svg[aria-label="Explore"], svg[aria-label="Reels"], svg[aria-label="Messages"], svg[aria-label="Notifications"], svg[aria-label="Create"], svg[aria-label="Profile"], svg[aria-label="Settings"], img[alt*="profile picture"], [aria-label="Main navigation"], nav'
    );

    // Check auth cookies (csrftoken, ds_user_id, mid, sessionid, ig_did)
    const hasAuthCookie = document.cookie.includes('ds_user_id') || 
                          document.cookie.includes('csrftoken') || 
                          document.cookie.includes('mid') || 
                          document.cookie.includes('sessionid') ||
                          document.cookie.includes('ig_did');

    if (isLoginPage) {
      state.progressMessage = '⚠️ Please log in to Instagram in this browser tab first.';
      updateUI();
      return { isLoggedIn: false, blockingModal: true };
    }

    if (loginModal) {
      // Attempt to auto-dismiss non-blocking login popups
      const closeBtn = loginModal.closest('div[role="dialog"]')?.querySelector('svg[aria-label="Close"], [aria-label="Close"]')?.closest('button, div[role="button"]');
      if (closeBtn) {
        try { closeBtn.click(); } catch (e) { /* ignore */ }
      }
    }

    // User is logged in if they have nav/cookies or if they are on a normal profile without a login blocking modal
    const isLoggedIn = hasLoggedInHeader || hasAuthCookie || (!isLoginPage && !loginModal);
    return { isLoggedIn, blockingModal: !!loginModal };
  }

  function getProfileUsername() {
    const match = window.location.pathname.match(/\/([A-Za-z0-9_.-]+)\/?/);
    if (match && !['p', 'reel', 'reels', 'explore', 'direct', 'stories'].includes(match[1])) {
      return match[1];
    }
    return 'instagram_user';
  }

  // --- 3. Controlled Auto-Scroll Engine ---
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // API-token access gate: extension only scrapes with a valid token
  async function assertExtensionAccess() {
    try {
      const stored = await chrome.storage.local.get(['apiBase', 'apiToken']);
      const apiBase = (stored.apiBase || 'http://localhost:3010').replace(/\/$/, '');
      const apiToken = stored.apiToken || '';
      if (!apiToken) {
        state.progressMessage = 'ACCESS BLOCKED: API Token missing — paste it in Extension Options.';
        updateUI();
        broadcastState({ type: 'ACCESS_BLOCKED', reason: 'NO_TOKEN' });
        return false;
      }
      const r = await fetch(apiBase + '/api/auth/validate-token?token=' + encodeURIComponent(apiToken), { cache: 'no-store' });
      const json = await r.json();
      if (!json.valid) {
        state.progressMessage = 'ACCESS BLOCKED: API Token invalid — generate a new one from the dashboard.';
        updateUI();
        broadcastState({ type: 'ACCESS_BLOCKED', reason: 'INVALID_TOKEN' });
        return false;
      }
      return true;
    } catch (e) {
      state.progressMessage = 'ACCESS BLOCKED: Server unreachable — could not verify token (' + e.message + ')';
      updateUI();
      broadcastState({ type: 'ACCESS_BLOCKED', reason: 'SERVER_UNREACHABLE' });
      return false;
    }
  }

  function startAutoScroll() {
    if (state.autoScrollActive) return;
    assertExtensionAccess().then(ok => {
      if (!ok) return;
      state.autoScrollActive = true;
      state.stallCount = 0;
      state.nudgeCount = 0;
      state.scrollCount = 0;
      state.lastScrollY = window.scrollY;
      state.lastItemCount = state.mediaItems.length;
      // A fresh manual start resets the rate-limit escalation counter
      if (state.rateLimitHits >= 3) state.rateLimitHits = 0;
      console.log(`${LOG_PREFIX} Auto-scroll engine started.`);
      state.progressMessage = 'Auto-scrolling active...';
      updateUI();
      broadcastState({ type: 'STATE_UPDATE', isScraping: true });

      step();
    });
  }

  function checkExtractionLimits() {
    if (!state.limits) return false;
    const { maxVideos, maxTotal, maxScrolls } = state.limits;
    if (maxVideos > 0 && state.stats.videos >= maxVideos) {
      console.log(`${LOG_PREFIX} Target videos limit reached (${state.stats.videos}/${maxVideos}). Auto-stopping.`);
      stopAutoScroll();
      state.progressMessage = `Target video limit reached (${state.stats.videos}/${maxVideos}). Auto-stopped.`;
      updateUI();
      return true;
    }
    if (maxTotal > 0 && state.stats.total >= maxTotal) {
      console.log(`${LOG_PREFIX} Target total items limit reached (${state.stats.total}/${maxTotal}). Auto-stopping.`);
      stopAutoScroll();
      state.progressMessage = `Target total limit reached (${state.stats.total}/${maxTotal}). Auto-stopped.`;
      updateUI();
      return true;
    }
    if (maxScrolls > 0 && state.scrollCount >= maxScrolls) {
      console.log(`${LOG_PREFIX} Scroll count limit reached (${state.scrollCount}/${maxScrolls}). Auto-stopping.`);
      stopAutoScroll();
      state.progressMessage = `Max scroll steps reached (${state.scrollCount}/${maxScrolls}). Auto-stopped.`;
      updateUI();
      return true;
    }
    return false;
  }

  function step() {
    if (!state.autoScrollActive) return;

    state.scrollCount++;
    if (checkExtractionLimits()) return;

    // Scroll smoothly down
    const scrollStep = 600 + Math.floor(Math.random() * 200);
    window.scrollBy({ top: scrollStep, behavior: 'smooth' });

    // Run fallback DOM scan as backup
    inspectDOMForMedia();

    const timer1 = setTimeout(() => {
      if (!state.autoScrollActive) return;

      const currentScrollY = window.scrollY;
      const maxScrollY = document.body.scrollHeight - window.innerHeight;

      // New items arrived → the engine is healthy, reset stall/nudge counters
      if (state.mediaItems.length !== state.lastItemCount) {
        state.lastItemCount = state.mediaItems.length;
        state.stallCount = 0;
        state.nudgeCount = 0;
      }

      if (Math.abs(currentScrollY - state.lastScrollY) < 10) {
        state.stallCount++;
        console.log(`${LOG_PREFIX} Scroll stalled count: ${state.stallCount}`);
      } else {
        state.stallCount = 0;
      }

      state.lastScrollY = currentScrollY;

      if (currentScrollY >= maxScrollY - 100 || state.stallCount >= 5) {
        state.nudgeCount++;
        if (state.nudgeCount > state.maxNudges) {
          console.log(`${LOG_PREFIX} Bottom reached, no new media after ${state.maxNudges} nudges.`);
          stopAutoScroll();
          state.progressMessage = '🏁 Reached end of page — no more media loading. Scrape complete.';
          updateUI();
          return;
        }

        // Nudge scroll position up and down to trigger dynamic Instagram post/reel loading
        window.scrollBy({ top: -200, behavior: 'smooth' });
        state.progressMessage = `⏳ Waiting for Instagram to load more posts/reels... (nudge ${state.nudgeCount}/${state.maxNudges})`;
        updateUI();

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

      // Schedule next scroll step based on throttling delay
      const stepDelayMs = Math.max(500, Math.round((state.throttlingDelay || 3.0) * 1000) + Math.floor(Math.random() * 600));
      const timer2 = setTimeout(step, stepDelayMs);
      state.scrollTimer = timer2;
      activeScrollTimers.push(timer2);
    }, 1000);

    state.scrollTimer = timer1;
    activeScrollTimers.push(timer1);
  }

  function stopAutoScroll() {
    state.autoScrollActive = false;
    clearAllScrollTimers();
    console.log(`${LOG_PREFIX} Auto-scroll stopped.`);
    state.progressMessage = 'Scraper stopped.';
    updateUI();
    broadcastState({ type: 'STATE_UPDATE', isScraping: false });
  }

  // Pause the engine when Instagram throttles us (HTTP 429), then auto-resume after a cooldown
  function handleRateLimit() {
    const wasActive = state.autoScrollActive || state.isScraping;
    const now = Date.now();
    if (now - state.rateLimitedAt < 30000) return; // burst dedupe
    state.rateLimitedAt = now;
    state.rateLimitHits++;

    if (wasActive) stopAutoScroll();

    if (state.rateLimitHits >= 3) {
      state.progressMessage = '🚦 Stopped: repeated Instagram rate limiting (429). Wait a few minutes, then start again.';
      updateUI();
      broadcastState({ type: 'RATE_LIMITED' });
      return;
    }

    const waitSec = Math.min(45 + state.rateLimitHits * 45, 180);
    state.progressMessage = wasActive
      ? `🚦 Instagram rate limit (429) — pausing ${waitSec}s, then resuming automatically...`
      : `🚦 Instagram rate limit detected (429). Retrying in ${waitSec}s...`;
    updateUI();
    setTimeout(() => {
      if (wasActive && !state.autoScrollActive && state.rateLimitHits < 3) {
        state.progressMessage = 'Rate-limit cooldown finished — resuming.';
        startAutoScroll();
      }
    }, waitSec * 1000);
  }

  // Rehydrate previously scraped items so reloads don't reset the session
  function restorePersistedState() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(['ig_live_stream', 'ig_stats'], (data) => {
      try {
        const items = data.ig_live_stream;
        if (Array.isArray(items) && items.length > 0) {
          state.mediaItems = items;
          items.forEach(it => state.deduper.isDuplicate(it));
          state.lastItemCount = items.length;
          if (data.ig_stats) state.stats = { ...state.stats, ...data.ig_stats };
          state.progressMessage = `Restored ${items.length} previously scraped items from session. Start Auto-Scroll to continue.`;
          updateUI();
        }
      } catch (e) {
        console.warn(`${LOG_PREFIX} Failed to restore persisted state:`, e);
      }
    });
  }

  // --- 4. Download & ZIP Engine ---
  async function fetchMediaWithRetry(item, attempts = 3) {
    const exportUtils = window.IGScraperExport;
    if (!exportUtils || !exportUtils.fetchValidatedMedia) {
      const res = await fetch(item.videoUrl || item.mediaUrl);
      const blob = await res.blob();
      const isValid = blob.size > 50000 && !blob.type.includes('html');
      return { blob, extension: (item.type === 'video' && isValid) ? 'mp4' : 'jpg', mimeType: 'application/octet-stream' };
    }
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await exportUtils.fetchValidatedMedia(item);
      } catch (e) {
        lastErr = e;
        if (i < attempts - 1) {
          console.warn(`${LOG_PREFIX} Fetch attempt ${i + 1} failed for ${item.shortcode || item.id}, retrying in ${1.5 * Math.pow(2, i)}s...`);
          await sleep(1500 * Math.pow(2, i) + Math.random() * 1000);
        }
      }
    }
    throw lastErr;
  }

  /**
   * Resolve every downloadable binary for an item.
   * Carousel items expand into their children (video/image) via the same validated pipeline.
   */
  async function collectItemMedia(item) {
    const exportUtils = window.IGScraperExport;
    const children = Array.isArray(item.carouselItems) ? item.carouselItems : null;

    // Carousels: keep original item as context; children carry their own URLs
    if (item.type === 'carousel' && children && children.length > 0) {
      const blobs = [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!child || typeof child !== 'object') continue;
        if (child.type === 'carousel') continue; // nested carousels are not expandable
        const childItem = {
          ...item,
          id: `${item.id}_${i + 1}`,
          shortcode: item.shortcode ? `${item.shortcode}_${i + 1}` : item.shortcode,
          type: child.type || 'image',
          mediaUrl: child.mediaUrl,
          videoUrl: child.type === 'video' ? (child.mediaUrl || child.videoUrl) : undefined,
          videoCandidates: child.videoCandidates || [],
          thumbnailUrl: child.thumbnailUrl || item.thumbnailUrl,
          displayUrl: child.thumbnailUrl || item.thumbnailUrl
        };
        try {
          const mediaRes = await fetchMediaWithRetry(childItem);
          blobs.push({ mediaRes, item: childItem });
        } catch (e) {
          console.warn(`${LOG_PREFIX} Carousel child ${i + 1} of ${item.shortcode} failed:`, e);
          state.stats.failed++;
        }
      }
      if (blobs.length === 0) {
        // All children failed — fall back to the cover media
        const mediaRes = await fetchMediaWithRetry(item);
        blobs.push({ mediaRes, item });
      }
      return blobs;
    }

    const mediaRes = await fetchMediaWithRetry(item);
    return [{ mediaRes, item }];
  }

  function buildMediaFilename(item, index) {
    const filenameUtil = window.IGScraperFilename;
    if (filenameUtil && filenameUtil.generateMediaFilename) {
      return filenameUtil.generateMediaFilename(item, index);
    }
    const cleanUser = (item.username || 'ig').replace(/[^a-zA-Z0-9_]/g, '');
    const ext = item.type === 'video' ? 'mp4' : 'jpg';
    return `${cleanUser}_${item.shortcode}_${index !== null && index !== undefined ? index + 1 : ''}.${ext}`.replace(/_\./, '.');
  }

  async function downloadIndividualItem(item) {
    try {
      state.progressMessage = `Downloading @${item.username || 'user'} media...`;
      updateUI();

      const exportUtils = window.IGScraperExport;
      const blobs = await collectItemMedia(item);

      for (let i = 0; i < blobs.length; i++) {
        const { mediaRes, item: blbItem } = blobs[i];
        const filename = buildMediaFilename(blbItem, i);
        if (exportUtils && exportUtils.downloadBlob) {
          exportUtils.downloadBlob(mediaRes.blob, mediaRes.mimeType || 'application/octet-stream', filename);
        } else {
          const link = document.createElement('a');
          link.href = URL.createObjectURL(mediaRes.blob);
          link.download = filename;
          link.click();
        }
      }

      state.progressMessage = `Downloaded ${blobs.length} file${blobs.length > 1 ? 's' : ''} for ${item.shortcode}`;
      updateUI();
    } catch (err) {
      console.error(`${LOG_PREFIX} Download failed for item ${item.id}:`, err);
      state.stats.failed++;
      state.progressMessage = `Download failed for item ${item.id}`;
      updateUI();
    }
  }

  async function downloadAllZip() {
    if (state.mediaItems.length === 0) {
      alert('No media collected to download.');
      return;
    }

    if (!window.JSZip) {
      alert('JSZip library not loaded.');
      return;
    }

    try {
      const zip = new window.JSZip();
      state.progressMessage = 'Building ZIP archive...';
      state.progressPercent = 5;
      updateUI();

      // Add metadata.json to ZIP
      const exportUtils = window.IGScraperExport;
      const metadataJson = exportUtils ? exportUtils.exportToJson(state.mediaItems) : JSON.stringify(state.mediaItems, null, 2);
      zip.file('metadata.json', metadataJson);

      const stamp = new Date().toISOString().split('T')[0];
      let completed = 0;

      for (let i = 0; i < state.mediaItems.length; i++) {
        const item = state.mediaItems[i];
        state.progressMessage = `Fetching ${i + 1}/${state.mediaItems.length}: ${item.shortcode}...`;
        state.progressPercent = Math.round(((i + 1) / state.mediaItems.length) * 80);
        updateUI();

        try {
          const mediaBlobs = await collectItemMedia(item);
          const userDir = `instagram/${(item.username || 'instagram_user').replace(/[^a-zA-Z0-9_]/g, '')}`;
          const itemDir = `${userDir}/${item.shortcode || item.id}`;

          // Organize carousel children + single media into per-post folders
          for (let k = 0; k < mediaBlobs.length; k++) {
            const { mediaRes, item: blbItem } = mediaBlobs[k];
            const fname = buildMediaFilename(blbItem, mediaBlobs.length > 1 ? k : null);
            zip.file(`${itemDir}/${fname}`, mediaRes.blob);
            completed++;
          }
        } catch (e) {
          console.warn(`${LOG_PREFIX} Failed fetching item ${item.id} for ZIP:`, e);
          state.stats.failed++;
        }

        // Human-like pacing between network fetches (avoids burst rate-limiting)
        await sleep(350 + Math.floor(Math.random() * 500));
      }

      state.progressMessage = 'Compressing ZIP package...';
      state.progressPercent = 90;
      updateUI();

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipName = `instagram_${getProfileUsername()}_${stamp}.zip`;

      if (exportUtils) {
        exportUtils.downloadBlob(zipBlob, 'application/zip', zipName);
      }

      state.progressMessage = `Downloaded ZIP archive (${completed} items)`;
      state.progressPercent = 100;
      updateUI();
    } catch (err) {
      console.error(`${LOG_PREFIX} ZIP generation failed:`, err);
      state.progressMessage = 'ZIP generation failed.';
      updateUI();
    }
  }

  function exportCaptions(format = 'txt') {
    const exportUtils = window.IGScraperExport;
    if (!exportUtils) return;

    const username = getProfileUsername();
    const date = new Date().toISOString().split('T')[0];

    if (format === 'csv') {
      const csv = exportUtils.exportToCsv(state.mediaItems);
      exportUtils.downloadBlob(csv, 'text/csv', `instagram_${username}_${date}.csv`);
    } else if (format === 'json') {
      const json = exportUtils.exportToJson(state.mediaItems);
      exportUtils.downloadBlob(json, 'application/json', `instagram_${username}_${date}.json`);
    } else {
      const txt = exportUtils.exportToTxt(state.mediaItems);
      exportUtils.downloadBlob(txt, 'text/plain', `instagram_${username}_${date}.txt`);
    }
  }

  function clearResults() {
    state.mediaItems = [];
    state.deduper.clear();
    state.stats.total = 0;
    state.stats.videos = 0;
    state.stats.images = 0;
    state.stats.carousels = 0;
    state.stats.failed = 0;
    state.scrollCount = 0;
    state.nudgeCount = 0;
    state.stallCount = 0;
    state.lastItemCount = 0;
    state.rateLimitHits = 0;
    state.storageDirty = true;
    state.progressMessage = 'Cleared results.';
    state.progressPercent = 0;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try { chrome.storage.local.remove(['ig_live_stream', 'ig_stats']); } catch (e) { /* ignore */ }
    }
    updateUI();
  }

  // --- 5. UI Panel Creation & Injection ---
  function createUIOverlay() {
    if (document.getElementById('ig-scraper-host')) return;

    const host = document.createElement('div');
    host.id = 'ig-scraper-host';
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });

    // Embedded Stylesheet for guaranteed floating widget styling
    const styleTag = document.createElement('style');
    styleTag.textContent = `
      :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; box-sizing: border-box; }
      *, *::before, *::after { box-sizing: border-box; }
      #ig-scraper-root {
        position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
        display: flex; flex-direction: column; width: 400px; max-width: calc(100vw - 32px); max-height: 80vh;
        background: #0f172a; color: #f8fafc; border-radius: 14px;
        box-shadow: 0 20px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1);
        font-size: 13px; overflow: hidden; transition: transform 0.2s ease;
      }
      #ig-scraper-root.minimized { height: 50px !important; max-height: 50px !important; width: 280px; overflow: hidden; }
      .ig-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #020617; border-bottom: 1px solid rgba(255,255,255,0.1); cursor: grab; user-select: none; }
      .ig-panel-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13px; color: #fff; }
      .ig-panel-logo { width: 22px; height: 22px; background: linear-gradient(45deg, #f09433, #dc2743, #bc1888); border-radius: 6px; display: flex; align-items: center; justify-content: center; color: white; font-size: 10px; font-weight: 900; }
      .ig-header-controls { display: flex; align-items: center; gap: 6px; }
      .ig-icon-btn { background: rgba(255,255,255,0.1); border: none; color: #cbd5e1; width: 24px; height: 24px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
      .ig-icon-btn:hover { background: rgba(255,255,255,0.2); color: #fff; }
      .ig-status-bar { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; background: #1e293b; border-bottom: 1px solid rgba(255,255,255,0.05); }
      .ig-status-badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 11px; color: #e2e8f0; }
      .ig-status-dot { width: 8px; height: 8px; border-radius: 50%; background: #64748b; }
      .ig-status-dot.active { background: #10b981; box-shadow: 0 0 8px rgba(16, 185, 129, 0.6); }
      .ig-stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; padding: 8px 14px; background: #0f172a; border-bottom: 1px solid rgba(255,255,255,0.05); }
      .ig-stat-box { background: #1e293b; padding: 6px 8px; border-radius: 6px; text-align: center; }
      .ig-stat-val { font-size: 14px; font-weight: 700; color: #f8fafc; }
      .ig-stat-lbl { font-size: 9px; font-weight: 600; color: #94a3b8; text-transform: uppercase; }
      .ig-action-bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 14px; background: #0f172a; border-bottom: 1px solid rgba(255,255,255,0.05); }
      .ig-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 6px 10px; font-size: 11px; font-weight: 600; border-radius: 6px; border: none; cursor: pointer; }
      .ig-btn-primary { background: #e1306c; color: #fff; }
      .ig-btn-danger { background: #ef4444; color: #fff; }
      .ig-btn-secondary { background: #334155; color: #f8fafc; }
      .ig-btn-outline { background: transparent; color: #cbd5e1; border: 1px solid #334155; }
      .ig-filter-bar { display: flex; gap: 4px; padding: 6px 14px; background: #1e293b; }
      .ig-tab-chip { padding: 3px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; color: #94a3b8; background: transparent; border: none; cursor: pointer; }
      .ig-tab-chip.active { background: #e1306c; color: #fff; }
      .ig-media-list { flex: 1; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; min-height: 140px; }
      .ig-media-card { display: flex; gap: 10px; padding: 8px; background: #1e293b; border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; }
      .ig-media-thumb { width: 54px; height: 54px; border-radius: 6px; overflow: hidden; background: #000; flex-shrink: 0; position: relative; }
      .ig-media-thumb img { width: 100%; height: 100%; object-fit: cover; }
      .ig-type-badge { position: absolute; top: 2px; left: 2px; background: rgba(0,0,0,0.8); color: #fff; font-size: 8px; font-weight: 700; padding: 1px 4px; border-radius: 3px; text-transform: uppercase; }
      .ig-media-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; }
      .ig-media-meta { display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }
      .ig-media-caption { font-size: 11px; color: #cbd5e1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.3; margin: 4px 0; }
      .ig-empty-state { padding: 24px 12px; text-align: center; color: #94a3b8; font-size: 12px; }
    `;
    shadowRoot.appendChild(styleTag);

    // Also inject link tag as fallback
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('panel.css');
    shadowRoot.appendChild(link);

    panelElement = document.createElement('div');
    panelElement.id = 'ig-scraper-root';
    shadowRoot.appendChild(panelElement);

    makeDraggable(panelElement);
    updateUI();

    // Check auto start condition on load
    checkAutoStartOnLoad();
  }

  function updateUI() {
    if (!panelElement) return;

    const username = getProfileUsername();
    const itemsToDisplay = state.mediaItems.filter(item => {
      if (state.filter === 'videos') return item.type === 'video';
      if (state.filter === 'images') return item.type === 'image';
      return true;
    });

    panelElement.className = state.uiMinimized ? 'minimized' : '';

    panelElement.innerHTML = `
      <div class="ig-panel-header" id="ig-header-drag">
        <div class="ig-panel-title">
          <div class="ig-panel-logo">IG</div>
          <span>Instagram Scraper (@${username})</span>
        </div>
        <div class="ig-header-controls">
          <button class="ig-icon-btn" id="ig-btn-minimize" title="${state.uiMinimized ? 'Expand' : 'Minimize'}">
            ${state.uiMinimized ? '&#9650;' : '&#9660;'}
          </button>
        </div>
      </div>

      ${!state.uiMinimized ? `
        <div class="ig-status-bar">
          <div class="ig-status-badge">
            <span class="ig-status-dot ${state.autoScrollActive ? 'active' : ''}"></span>
            <span>${state.autoScrollActive ? 'Scraping / Scrolling...' : 'Idle'}</span>
          </div>
          <span style="font-size:11px; color:#64748b;">${state.stats.total} found</span>
        </div>

        <div class="ig-stats-grid">
          <div class="ig-stat-box">
            <div class="ig-stat-val">${state.stats.total}</div>
            <div class="ig-stat-lbl">Total</div>
          </div>
          <div class="ig-stat-box">
            <div class="ig-stat-val" style="color:#2563eb;">${state.stats.videos}</div>
            <div class="ig-stat-lbl">Videos</div>
          </div>
          <div class="ig-stat-box">
            <div class="ig-stat-val" style="color:#059669;">${state.stats.images}</div>
            <div class="ig-stat-lbl">Images</div>
          </div>
          <div class="ig-stat-box">
            <div class="ig-stat-val" style="color:#dc2626;">${state.stats.failed}</div>
            <div class="ig-stat-lbl">Failed</div>
          </div>
        </div>

        <div class="ig-action-bar">
          ${!state.autoScrollActive && !state.isScraping ? `
            <button class="ig-btn ig-btn-primary" id="ig-btn-start">
              <span>&#9654;</span> Start Auto-Scroll
            </button>
          ` : `
            <button class="ig-btn ig-btn-danger" id="ig-btn-stop" style="background:#dc2626 !important; color:#ffffff !important; border:1px solid #ef4444 !important; font-weight:bold;">
              <span>🛑</span> STOP SCRAPING & AUTO-SCROLL
            </button>
          `}
          <button class="ig-btn ig-btn-secondary" id="ig-btn-zip">
            <span>&#128230;</span> Download ZIP
          </button>
          <button class="ig-btn ig-btn-outline" id="ig-btn-export">
            <span>&#128196;</span> Export Captions
          </button>
          <button class="ig-btn ig-btn-outline" id="ig-btn-clear">
            Clear
          </button>
        </div>

        <div class="ig-filter-bar">
          <button class="ig-tab-chip ${state.filter === 'all' ? 'active' : ''}" data-filter="all">All (${state.stats.total})</button>
          <button class="ig-tab-chip ${state.filter === 'videos' ? 'active' : ''}" data-filter="videos">Videos (${state.stats.videos})</button>
          <button class="ig-tab-chip ${state.filter === 'images' ? 'active' : ''}" data-filter="images">Images (${state.stats.images})</button>
        </div>

        <div class="ig-media-list">
          ${itemsToDisplay.length === 0 ? `
            <div class="ig-empty-state">
              <div class="ig-empty-icon">&#128269;</div>
              <div>No media items collected yet.</div>
              <div style="font-size:11px; margin-top:4px;">Scroll the profile page or click "Start Auto-Scroll".</div>
            </div>
          ` : itemsToDisplay.map((item, idx) => `
            <div class="ig-media-card">
              <div class="ig-media-thumb">
                <img src="${item.thumbnailUrl || item.mediaUrl}" alt="media preview" loading="lazy" />
                <span class="ig-type-badge">${item.type}</span>
              </div>
              <div class="ig-media-info">
                <div>
                  <div class="ig-media-meta">
                    <span class="ig-media-user">@${item.username || 'user'}</span>
                    <span>${item.publishedFormatted || ''}</span>
                  </div>
                  <div class="ig-media-caption">${escapeHtml(item.caption || '(No caption)')}</div>
                </div>
                <div class="ig-media-actions">
                  <button class="ig-sm-btn ig-dl-item" data-idx="${idx}">Download</button>
                  <a class="ig-sm-btn" href="${item.sourceUrl}" target="_blank" rel="noopener">Open</a>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="ig-progress-footer">
          <div>${state.progressMessage}</div>
          ${state.progressPercent > 0 ? `
            <div class="ig-progress-bar">
              <div class="ig-progress-fill" style="width: ${state.progressPercent}%;"></div>
            </div>
          ` : ''}
        </div>
      ` : ''}
    `;

    // Attach Event Listeners
    const btnMinimize = shadowRoot.getElementById('ig-btn-minimize');
    if (btnMinimize) btnMinimize.onclick = () => { state.uiMinimized = !state.uiMinimized; updateUI(); };

    const btnStart = shadowRoot.getElementById('ig-btn-start');
    if (btnStart) btnStart.onclick = startAutoScroll;

    const btnStop = shadowRoot.getElementById('ig-btn-stop');
    if (btnStop) btnStop.onclick = stopAutoScroll;

    const btnZip = shadowRoot.getElementById('ig-btn-zip');
    if (btnZip) btnZip.onclick = downloadAllZip;

    const btnExport = shadowRoot.getElementById('ig-btn-export');
    if (btnExport) btnExport.onclick = () => exportCaptions('csv');

    const btnClear = shadowRoot.getElementById('ig-btn-clear');
    if (btnClear) btnClear.onclick = clearResults;

    shadowRoot.querySelectorAll('.ig-tab-chip').forEach(chip => {
      chip.onclick = (e) => {
        state.filter = e.target.getAttribute('data-filter');
        updateUI();
      };
    });

    shadowRoot.querySelectorAll('.ig-dl-item').forEach(btn => {
      btn.onclick = (e) => {
        const idx = parseInt(e.target.getAttribute('data-idx'), 10);
        if (itemsToDisplay[idx]) downloadIndividualItem(itemsToDisplay[idx]);
      };
    });

    // Broadcast live state to Web Application
    broadcastState();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function makeDraggable(el) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const header = shadowRoot.getElementById('ig-header-drag') || el;

    header.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e = e || window.event;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e = e || window.event;
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      el.style.top = (el.offsetTop - pos2) + "px";
      el.style.left = (el.offsetLeft - pos1) + "px";
      el.style.bottom = 'auto';
      el.style.right = 'auto';
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  // --- Initialize Scraper UI on Page Load ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createUIOverlay);
  } else {
    setTimeout(createUIOverlay, 1500);
  }

  // Rehydrate the previous scrape session so reloads keep collected items + dedup state
  setTimeout(restorePersistedState, 2500);

})();
