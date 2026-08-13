/**
 * normalization.js
 * Resilient Instagram API response parser and adapter system.
 * Traverses dynamic GraphQL, REST API, and Relay response trees to extract clean, standardized media items.
 */

(function (exports) {
  'use strict';

  /**
   * Safely access nested properties without throwing
   */
  function safeGet(obj, path, defaultValue = null) {
    if (!obj || typeof obj !== 'object') return defaultValue;
    const keys = Array.isArray(path) ? path : path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return defaultValue;
      }
      current = current[key];
    }
    return current !== undefined && current !== null ? current : defaultValue;
  }

  /**
   * Primary adapter: Extract raw media candidate objects from any JSON payload structure
   */
  function extractMediaObjects(payload) {
    const results = [];
    if (!payload || typeof payload !== 'object') return results;

    function traverse(node, depth = 0) {
      if (!node || typeof node !== 'object' || depth > 12) return;

      // Check if current node resembles a media item or node wrapper
      const isMediaCandidate =
        (node.pk || node.id || node.code || node.shortcode) &&
        (node.media_type || node.is_video !== undefined || node.video_versions || node.image_versions2 || node.display_url || node.__typename === 'GraphVideo' || node.__typename === 'GraphImage' || node.__typename === 'GraphSidecar');

      if (isMediaCandidate) {
        results.push(node);
      }

      // Check known container arrays/fields specifically for speed
      if (Array.isArray(node.items)) {
        node.items.forEach(item => traverse(item, depth + 1));
      } else if (Array.isArray(node.edges)) {
        node.edges.forEach(edge => {
          if (edge && edge.node) traverse(edge.node, depth + 1);
        });
      } else if (Array.isArray(node.carousel_media)) {
        // Also keep top node, but keep traversing
        Object.keys(node).forEach(key => {
          if (key !== 'carousel_media') traverse(node[key], depth + 1);
        });
      } else {
        // General object property recursion
        for (const key in node) {
          if (Object.prototype.hasOwnProperty.call(node, key)) {
            const child = node[key];
            if (child && typeof child === 'object') {
              traverse(child, depth + 1);
            }
          }
        }
      }
    }

    traverse(payload);
    return results;
  }

  /**
   * Adapter: Extract caption text from candidate
   */
  function extractCaption(item) {
    if (!item) return '';

    // Direct caption text
    if (typeof item.caption === 'string') return item.caption;

    // caption object with text
    if (item.caption && typeof item.caption.text === 'string') {
      return item.caption.text;
    }

    // GraphQL edge_media_to_caption
    const captionEdges = safeGet(item, 'edge_media_to_caption.edges');
    if (Array.isArray(captionEdges) && captionEdges.length > 0) {
      const text = safeGet(captionEdges[0], 'node.text');
      if (text) return text;
    }

    // Alternative caption paths
    if (item.accessibility_caption) return item.accessibility_caption;

    return '';
  }

  /**
   * Adapter: Extract author info (username, full_name, profile_pic_url)
   */
  function extractAuthor(item) {
    const author = {
      username: '',
      fullName: '',
      profilePicUrl: ''
    };

    const userObj = item.user || item.owner || item.author;
    if (userObj) {
      author.username = userObj.username || userObj.id || '';
      author.fullName = userObj.full_name || userObj.fullName || '';
      author.profilePicUrl = userObj.profile_pic_url || userObj.profile_pic_url_hd || '';
    }

    return author;
  }

  /**
   * Adapter: Extract highest quality media URLs (video and image) & type
   */
  function extractMediaUrls(item) {
    let type = 'image'; // default
    let mediaUrl = null;
    let thumbnailUrl = null;
    let carouselItems = [];
    const videoCandidates = [];

    // Check media_type enum (1: Image, 2: Video, 8: Carousel)
    const mediaType = item.media_type;
    const isVideo = item.is_video || mediaType === 2 || Boolean(item.video_versions);
    const isCarousel = mediaType === 8 || Boolean(item.carousel_media) || item.__typename === 'GraphSidecar';

    if (isCarousel) {
      type = 'carousel';
      const rawCarousel = item.carousel_media || safeGet(item, 'edge_sidecar_to_children.edges', []);
      carouselItems = rawCarousel.map(c => {
        const subNode = c.node || c;
        return extractMediaUrls(subNode);
      });
    } else if (isVideo) {
      type = 'video';
    } else {
      type = 'image';
    }

    // 1. Video URLs — capture ALL quality candidates so a fallback stream exists
    if (isVideo) {
      // Priority 1: Instagram video_versions array (highest quality first)
      if (Array.isArray(item.video_versions) && item.video_versions.length > 0) {
        // Sort by resolution (width * height) descending to get highest quality first
        const sortedVideos = [...item.video_versions].sort((a, b) => {
          const aRes = (a.width || 0) * (a.height || 0);
          const bRes = (b.width || 0) * (b.height || 0);
          return bRes - aRes;
        });
        sortedVideos.forEach(v => {
          if (v.url && /^https?:/i.test(v.url)) videoCandidates.push(v.url);
        });
        mediaUrl = sortedVideos[0]?.url || null;
      }

      // Priority 2: item.video_url as secondary source
      if (item.video_url && /^https?:/i.test(item.video_url)) {
        videoCandidates.push(item.video_url);
        if (!mediaUrl) mediaUrl = item.video_url;
      }

      // Priority 3: Check for adaptive formats in carousel_media or other paths
      if (item.adaptive_assets && Array.isArray(item.adaptive_assets)) {
        item.adaptive_assets.forEach(asset => {
          if (asset.url && /^https?:/i.test(asset.url)) {
            videoCandidates.push(asset.url);
          }
        });
      }

      // Deduplicate candidates while preserving order (highest quality first)
      const uniqueVideos = [];
      videoCandidates.forEach(u => {
        if (!uniqueVideos.includes(u)) uniqueVideos.push(u);
      });
      videoCandidates.length = 0;
      uniqueVideos.forEach(u => videoCandidates.push(u));
    }

    // 2. Image / Display URLs — prefer highest resolution
    // Priority 1: image_versions2.candidates (Instagram's structured format)
    if (Array.isArray(safeGet(item, 'image_versions2.candidates'))) {
      const candidates = item.image_versions2.candidates;
      // Sort by resolution descending (width * height)
      const sortedCandidates = [...candidates].sort((a, b) => {
        const aRes = (a.width || 0) * (a.height || 0);
        const bRes = (b.width || 0) * (b.height || 0);
        return bRes - aRes;
      });
      const bestImage = sortedCandidates[0]?.url;
      if (!mediaUrl && type === 'image') {
        mediaUrl = bestImage;
      }
      // Use the lowest resolution candidate as thumbnail (smaller file, good for preview)
      thumbnailUrl = sortedCandidates[sortedCandidates.length - 1]?.url || bestImage;
    }
    // Priority 2: display_url (fallback for older or simplified responses)
    else if (item.display_url) {
      if (!mediaUrl && type === 'image') mediaUrl = item.display_url;
      thumbnailUrl = item.display_url;
    }
    // Priority 3: display_resources (alternative CDN format)
    else if (item.display_resources && Array.isArray(item.display_resources)) {
      const sortedRes = [...item.display_resources].sort((a, b) => {
        const aRes = (a.config_width || 0) * (a.config_height || 0);
        const bRes = (b.config_width || 0) * (b.config_height || 0);
        return bRes - aRes;
      });
      if (!mediaUrl && type === 'image') mediaUrl = sortedRes[0]?.src;
      thumbnailUrl = sortedRes[sortedRes.length - 1]?.src || sortedRes[0]?.src;
    }
    // Priority 4: thumbnail_src (basic fallback)
    else if (item.thumbnail_src) {
      if (!mediaUrl && type === 'image') mediaUrl = item.thumbnail_src;
      thumbnailUrl = item.thumbnail_src;
    }

    // Fallback: If mediaUrl is null, use thumbnailUrl
    if (!mediaUrl && thumbnailUrl) {
      mediaUrl = thumbnailUrl;
    }

    return {
      type,
      mediaUrl,
      thumbnailUrl,
      carouselItems,
      videoCandidates
    };
  }

  /**
   * Adapter: Extract engagement stats
   */
  function extractStats(item) {
    return {
      likeCount: item.like_count ?? safeGet(item, 'edge_media_preview_like.count', 0),
      commentCount: item.comment_count ?? safeGet(item, 'edge_media_to_comment.count', 0),
      viewCount: item.view_count ?? item.play_count ?? safeGet(item, 'video_view_count', 0),
      duration: item.video_duration ?? 0,
      width: item.original_width ?? item.dimensions?.width ?? 0,
      height: item.original_height ?? item.dimensions?.height ?? 0
    };
  }

  /**
   * Adapter: Extract publication timestamp (ISO string & UNIX timestamp)
   */
  function extractTimestamp(item) {
    const timestamp = item.taken_at || item.taken_at_timestamp || item.device_timestamp || safeGet(item, 'caption.created_at');
    if (timestamp) {
      // Check if seconds vs milliseconds
      const ms = timestamp > 10000000000 ? timestamp : timestamp * 1000;
      return {
        unix: ms,
        iso: new Date(ms).toISOString(),
        formatted: new Date(ms).toLocaleDateString()
      };
    }
    return { unix: Date.now(), iso: new Date().toISOString(), formatted: new Date().toLocaleDateString() };
  }

  /**
   * Adapter: Extract permalink / source URL
   */
  function extractSourceUrl(item, shortcode) {
    const code = shortcode || item.code || item.shortcode;
    if (code) {
      const isReel = item.media_type === 2 && item.product_type === 'clips';
      const pathSegment = isReel ? 'reel' : 'p';
      return `https://www.instagram.com/${pathSegment}/${code}/`;
    }
    return window.location.href;
  }

  /**
   * Main Normalizer Function: Converts raw candidate into consistent schema
   */
  function normalizeMediaItem(rawItem) {
    if (!rawItem || typeof rawItem !== 'object') return null;

    const id = String(rawItem.pk || rawItem.id || rawItem.code || rawItem.shortcode || '');
    const shortcode = rawItem.code || rawItem.shortcode || id;

    if (!id) return null;

    const author = extractAuthor(rawItem);
    const mediaInfo = extractMediaUrls(rawItem);
    const stats = extractStats(rawItem);
    const timestamp = extractTimestamp(rawItem);
    const caption = extractCaption(rawItem);
    const sourceUrl = extractSourceUrl(rawItem, shortcode);

    // If no media URL extracted, skip invalid item
    if (!mediaInfo.mediaUrl) return null;

    return {
      id: id,
      shortcode: shortcode,
      type: mediaInfo.type,
      caption: caption,
      mediaUrl: mediaInfo.mediaUrl,
      videoUrl: mediaInfo.type === 'video' ? mediaInfo.mediaUrl : undefined,
      videoCandidates: mediaInfo.type === 'video' ? (mediaInfo.videoCandidates || []) : [],
      thumbnailUrl: mediaInfo.thumbnailUrl || mediaInfo.mediaUrl,
      carouselItems: mediaInfo.carouselItems,
      sourceUrl: sourceUrl,
      author: author.fullName,
      username: author.username,
      profilePicUrl: author.profilePicUrl,
      publishedAt: timestamp.iso,
      publishedFormatted: timestamp.formatted,
      likeCount: stats.likeCount,
      commentCount: stats.commentCount,
      viewCount: stats.viewCount,
      duration: stats.duration,
      width: stats.width,
      height: stats.height
    };
  }

  /**
   * Parse full raw JSON payload into an array of normalized media objects
   */
  function parseInstagramPayload(payload) {
    const candidates = extractMediaObjects(payload);
    const normalizedList = [];

    candidates.forEach(candidate => {
      try {
        const item = normalizeMediaItem(candidate);
        if (item) {
          normalizedList.push(item);
        }
      } catch (e) {
        // Safe catch for individual item parse failure
      }
    });

    return normalizedList;
  }

  // Export functions for content script or module scope
  exports.normalizeMediaItem = normalizeMediaItem;
  exports.parseInstagramPayload = parseInstagramPayload;
  exports.extractMediaObjects = extractMediaObjects;
  exports.extractCaption = extractCaption;
  exports.extractAuthor = extractAuthor;
  exports.extractMediaUrls = extractMediaUrls;
  exports.extractStats = extractStats;
  exports.extractTimestamp = extractTimestamp;
  exports.extractSourceUrl = extractSourceUrl;

})(typeof exports !== 'undefined' ? exports : (window.IGScraperNormalization = {}));
