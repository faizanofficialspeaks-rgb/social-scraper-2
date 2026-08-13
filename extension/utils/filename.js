/**
 * filename.js
 * Sanitizes filenames and generates consistent, conflict-free media file names.
 */

(function (exports) {
  'use strict';

  /**
   * Remove invalid OS filename characters
   */
  function sanitizeFilenameString(str) {
    if (!str) return 'instagram_media';
    return String(str)
      .replace(/[\\/:*?"<>|]/g, '_') // Replace forbidden characters
      .replace(/[\r\n\t]/g, ' ')     // Replace line breaks
      .replace(/\s+/g, '_')          // Collapse whitespace
      .replace(/^_+|_+$/g, '')       // Trim leading/trailing underscores
      .substring(0, 100);            // Cap length
  }

  /**
   * Determine file extension based on media type and URL
   */
  function getFileExtension(item) {
    const mediaUrl = item.mediaUrl || '';
    const type = item.type || 'image';

    if (type === 'video') {
      if (mediaUrl.includes('.webm')) return 'webm';
      return 'mp4';
    }

    if (mediaUrl.includes('.png')) return 'png';
    if (mediaUrl.includes('.webp')) return 'webp';
    return 'jpg';
  }

  /**
   * Generate clean descriptive filename for a media item
   */
  function generateMediaFilename(item, index = null) {
    const username = sanitizeFilenameString(item.username || 'instagram_user');
    const type = sanitizeFilenameString(item.type || 'media');
    const shortcode = sanitizeFilenameString(item.shortcode || item.id || 'item');

    let dateStr = 'date';
    if (item.publishedAt) {
      dateStr = item.publishedAt.split('T')[0];
    }

    const ext = getFileExtension(item);
    const indexSuffix = index !== null ? `_${index}` : '';

    return `${username}_${dateStr}_${type}_${shortcode}${indexSuffix}.${ext}`;
  }

  exports.sanitizeFilenameString = sanitizeFilenameString;
  exports.getFileExtension = getFileExtension;
  exports.generateMediaFilename = generateMediaFilename;

})(typeof exports !== 'undefined' ? exports : (window.IGScraperFilename = {}));
