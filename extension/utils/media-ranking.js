/**
 * media-ranking.js
 * Ranks available media candidate URLs to pick the highest quality progressive download link.
 */

(function (exports) {
  'use strict';

  /**
   * Score a video candidate based on dimensions, resolution, format, and CDN structure
   */
  function scoreVideoUrl(candidate) {
    let score = 0;

    const width = candidate.width || 0;
    const height = candidate.height || 0;
    score += (width * height); // Resolution weight

    const url = candidate.url || '';

    // Prefer MP4 over M3U8/HLS streams for direct browser download
    if (url.includes('.mp4')) score += 500000;
    if (url.includes('.m3u8')) score -= 300000;

    // Prefer non-expired CDN links
    if (url.includes('cdninstagram.com') || url.includes('fbcdn.net')) {
      score += 10000;
    }

    return score;
  }

  /**
   * Select best video URL from list of candidates
   */
  function selectBestVideoUrl(videoCandidates) {
    if (!Array.isArray(videoCandidates) || videoCandidates.length === 0) return null;

    const sorted = [...videoCandidates].sort((a, b) => scoreVideoUrl(b) - scoreVideoUrl(a));
    return sorted[0]?.url || null;
  }

  /**
   * Select best image URL from candidates
   */
  function selectBestImageUrl(imageCandidates) {
    if (!Array.isArray(imageCandidates) || imageCandidates.length === 0) return null;

    const sorted = [...imageCandidates].sort((a, b) => {
      const resA = (a.width || a.config_width || 0) * (a.height || a.config_height || 0);
      const resB = (b.width || b.config_width || 0) * (b.height || b.config_height || 0);
      return resB - resA;
    });

    return sorted[0]?.url || sorted[0]?.src || null;
  }

  exports.scoreVideoUrl = scoreVideoUrl;
  exports.selectBestVideoUrl = selectBestVideoUrl;
  exports.selectBestImageUrl = selectBestImageUrl;

})(typeof exports !== 'undefined' ? exports : (window.IGScraperMediaRanking = {}));
