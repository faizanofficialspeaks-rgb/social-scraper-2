/**
 * deduplication.js
 * Reliable multi-tier deduplication engine for collected Instagram media items.
 */

(function (exports) {
  'use strict';

  class DeduplicationEngine {
    constructor() {
      this.seenIds = new Set();
      this.seenShortcodes = new Set();
      this.seenSourceUrls = new Set();
      this.seenMediaUrls = new Set();
    }

    /**
     * Check if item is a duplicate. If not, record key hashes and return false.
     */
    isDuplicate(item) {
      if (!item || typeof item !== 'object') return true;

      const idKey = item.id ? String(item.id).trim() : null;
      const shortcodeKey = item.shortcode ? String(item.shortcode).trim() : null;
      const sourceUrlKey = item.sourceUrl ? this.cleanUrl(item.sourceUrl) : null;
      const mediaUrlKey = item.mediaUrl ? this.cleanUrl(item.mediaUrl) : null;

      // 1. Check media ID / pk
      if (idKey && this.seenIds.has(idKey)) return true;

      // 2. Check shortcode
      if (shortcodeKey && this.seenShortcodes.has(shortcodeKey)) return true;

      // 3. Check canonical source URL
      if (sourceUrlKey && this.seenSourceUrls.has(sourceUrlKey)) return true;

      // 4. Check media URL
      if (mediaUrlKey && this.seenMediaUrls.has(mediaUrlKey)) return true;

      // Record new item signatures
      if (idKey) this.seenIds.add(idKey);
      if (shortcodeKey) this.seenShortcodes.add(shortcodeKey);
      if (sourceUrlKey) this.seenSourceUrls.add(sourceUrlKey);
      if (mediaUrlKey) this.seenMediaUrls.add(mediaUrlKey);

      return false;
    }

    /**
     * Remove query parameters from CDN/Source URLs for deduplication comparison
     */
    cleanUrl(url) {
      try {
        const parsed = new URL(url);
        return parsed.origin + parsed.pathname;
      } catch (e) {
        return url;
      }
    }

    /**
     * Deduplicate an array of items returning only unique ones
     */
    filterUnique(items) {
      if (!Array.isArray(items)) return [];
      return items.filter(item => !this.isDuplicate(item));
    }

    /**
     * Clear all state
     */
    clear() {
      this.seenIds.clear();
      this.seenShortcodes.clear();
      this.seenSourceUrls.clear();
      this.seenMediaUrls.clear();
    }
  }

  exports.DeduplicationEngine = DeduplicationEngine;

})(typeof exports !== 'undefined' ? exports : (window.IGScraperDeduplication = {}));
