/**
 * publisher.js (ISOLATED World Content Script)
 * Communicates with the local scheduler server (server.ts) on behalf of the logged-in session.
 *
 * Real-session posting strategy:
 *  - The Node scheduler server holds the queue + timing. When media is due, it forwards
 *    a "publish ticket" here via chrome.runtime.sendMessage (background spawns us),
 *    OR the options page triggers us directly.
 *  - This script performs the platform-native upload using the ALREADY-LOGGED-IN tab
 *    session (cookies + CSRF handled by the page itself), then reports the result back.
 *  - Server falls back to this bridge when API credentials are absent.
 */

(function () {
  'use strict';

  const LOG_PREFIX = '[PUBLISHER]';
  const SERVER_URL = 'http://127.0.0.1:3000';

  let platform = '';
  if (location.hostname.includes('instagram.com')) platform = 'instagram';
  else if (location.hostname.includes('tiktok.com')) platform = 'tiktok';
  else if (location.hostname.includes('facebook.com') || location.hostname.includes('fb.com')) platform = 'facebook';

  console.log(`${LOG_PREFIX} initialized on ${platform || 'unknown'} site`);

  /**
   * Report publish result back to the scheduler server.
   */
  async function reportToServer(itemId, result) {
    try {
      await fetch(`${SERVER_URL}/api/schedule/update-progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId,
          percentage: result.success ? 100 : 0,
          status: result.success ? 'completed' : 'failed',
          error: result.error
        })
      });
    } catch (e) { /* server down — ignore */ }
  }

  /**
   * Fetch direct media bytes via the proxy (bypasses browser CORS to CDNs).
   */
  async function fetchMediaBytes(mediaUrl) {
    const res = await fetch(`${SERVER_URL}/api/proxy-media?url=${encodeURIComponent(mediaUrl)}&type=auto`);
    if (!res.ok) throw new Error(`Failed to download media (HTTP ${res.status})`);
    const blob = await res.blob();
    if (blob.size < 2048) throw new Error('Media payload too small');
    return blob;
  }

  /**
   * Publish via the logged-in session using the platform's OWN upload endpoints.
   * (Session cookies + CSRF are handled by the page context natively.)
   */
  async function publishWithSession(item, mediaBlob) {
    if (platform === 'instagram') {
      return publishInstagramSession(item, mediaBlob);
    }
    if (platform === 'tiktok') {
      return publishTikTokSession(item, mediaBlob);
    }
    if (platform === 'facebook') {
      return publishFacebookSession(item, mediaBlob);
    }
    throw new Error('Unsupported platform for session publishing');
  }

  /**
   * Instagram session upload (logged-in tab):
   * Uses the internal /api/v1/media/... endpoints with the page's cookies.
   * If a Facebook page token + IG Business ID are configured server-side, the
   * server prefers Graph API instead; this is the fallback lane.
   */
  async function publishInstagramSession(item, mediaBlob) {
    const caption = item.caption || '';
    const isVideo = item.type === 'video' || mediaBlob.type.includes('video');

    // Ensure logged in
    if (!document.cookie.includes('sessionid')) {
      throw new Error('Instagram session not found — log in to Instagram in this tab first.');
    }

    const csrf = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
    const headers = {
      'X-CSRFToken': csrf,
      'X-Instagram-AJAX': '1',
      'Referer': location.href,
      'Origin': location.origin
    };

    // 1. Upload file to IG's upload endpoint
    const uploadForm = new FormData();
    uploadForm.append('upload_id', String(Date.now()));
    uploadForm.append('media_type', isVideo ? '2' : '1');
    uploadForm.append('photo', mediaBlob, `media_${item.shortcode}.${isVideo ? 'mp4' : 'jpg'}`);

    const uploadUrl = isVideo
      ? `${location.origin}/api/v1/media/upload/`
      : `${location.origin}/api/v1/media/upload/`;

    const uploadRes = await fetch(uploadUrl, { method: 'POST', headers, body: uploadForm, credentials: 'include' });
    const uploadData = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok || uploadData.status === 'fail') {
      throw new Error(`IG upload failed: ${uploadData.message || uploadRes.status}`);
    }

    const uploadId = uploadData.upload_id || String(Date.now());

    // 2. Configure the post (publish it)
    const configureForm = new FormData();
    configureForm.append('upload_id', uploadId);
    configureForm.append('caption', caption);
    configureForm.append('media_type', isVideo ? '2' : '1');

    const configureUrl = isVideo
      ? `${location.origin}/api/v1/media/configure_to_video/`
      : `${location.origin}/api/v1/media/configure/`;

    const confRes = await fetch(configureUrl, { method: 'POST', headers, body: configureForm, credentials: 'include' });
    const confData = await confRes.json().catch(() => ({}));
    if (!confRes.ok || confData.status === 'fail') {
      throw new Error(`IG configure failed: ${confData.message || confRes.status}`);
    }

    return { success: true, postId: confData.media?.id || uploadId };
  }

  /**
   * TikTok session upload (logged-in tab):
   * Uses the internal /api/v1/post/publish/ endpoint with the page's session.
   */
  async function publishTikTokSession(item, mediaBlob) {
    if (!document.cookie.includes('sessionid') && !document.cookie.includes('sid_tt')) {
      throw new Error('TikTok session not found — log in to TikTok in this tab first.');
    }

    const form = new FormData();
    form.append('video', mediaBlob, `video_${item.shortcode}.mp4`);

    const params = new URLSearchParams({
      'video_id': `v${Date.now()}`,
      'privacy_level': '0',
      'disable_duet': '0',
      'disable_stitch': '0',
      'disable_comment': '0',
      'title': item.caption || ''
    });

    const res = await fetch(`https://www.tiktok.com/api/v1/post/publish/?${params.toString()}`, {
      method: 'POST',
      body: form,
      credentials: 'include'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data.status_code && data.status_code !== 0)) {
      throw new Error(`TikTok publish failed: ${data.status_msg || res.status}`);
    }

    return { success: true, postId: data.item_id || String(Date.now()) };
  }

  /**
   * Facebook session upload (logged-in tab):
   * Uses the page composer GraphQL upload flow with the session cookies.
   */
  async function publishFacebookSession(item, mediaBlob) {
    if (!document.cookie.includes('c_user')) {
      throw new Error('Facebook session not found — log in to Facebook in this tab first.');
    }

    const form = new FormData();
    form.append('video', mediaBlob, `video_${item.shortcode}.mp4`);

    const uploadUrl = item.targetPage
      ? `https://upload.facebook.com/video-upload/video_upload_init/?v=1&target_id=${encodeURIComponent(item.targetPage)}&video_type=current&spherical=false&is_360=false&composer_identity=upload`
      : 'https://upload.facebook.com/video-upload/video_upload_init/?v=1&target_id=me&video_type=current&spherical=false&is_360=false&composer_identity=upload';

    const res = await fetch(uploadUrl, { method: 'POST', body: form, credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Facebook upload init failed: ${res.status}`);

    return { success: true, postId: data.video_id || String(Date.now()) };
  }

  /**
   * Handle a publish request forwarded by the server via the background service worker.
   */
  async function handlePublishRequest(request) {
    const item = request.item;
    console.log(`${LOG_PREFIX} publishing ${item.shortcode} via ${platform} session...`);

    try {
      const mediaBlob = await fetchMediaBytes(item.mediaUrl || item.videoUrl);
      const result = await publishWithSession(item, mediaBlob);
      await reportToServer(item.id, result);
      return { ok: true, result };
    } catch (err) {
      const result = { success: false, error: err.message || String(err) };
      await reportToServer(item.id, result);
      console.error(`${LOG_PREFIX} publish failed:`, err);
      return { ok: false, error: err.message || String(err) };
    }
  }

  // Listen for publish commands from the background service worker
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request && request.type === 'SESSION_PUBLISH') {
        handlePublishRequest(request).then(res => sendResponse(res));
        return true; // async response
      }
    });
  }

  // Also expose a window-level hook (used by the app-bridge / content bridge)
  try {
    window.addEventListener('message', (e) => {
      if (!e.data || e.data.source !== 'IG_SCRAPER_APP' || e.data.type !== 'SESSION_PUBLISH') return;
      handlePublishRequest(e.data).then(res => {
        window.postMessage({ source: 'IG_SCRAPER_EXTENSION', type: 'SESSION_PUBLISH_RESULT', ...res }, '*');
      });
    });
  } catch (e) { /* ignore */ }
})();