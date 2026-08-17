/**
 * export.js
 * Generates CSV, JSON, and Formatted Text export files for collected media items.
 */

(function (exports) {
  'use strict';

  /**
   * Escape fields for CSV format
   */
  function escapeCsvField(field) {
    if (field === null || field === undefined) return '""';
    const stringified = String(field).replace(/"/g, '""');
    return `"${stringified}"`;
  }

  /**
   * Export items as CSV string
   */
  function exportToCsv(items) {
    if (!Array.isArray(items) || items.length === 0) return '';

    const headers = [
      'Media ID',
      'Shortcode',
      'Type',
      'Username',
      'Author',
      'Published Date',
      'Likes',
      'Comments',
      'Views',
      'Source URL',
      'Media URL',
      'Caption'
    ];

    const rows = items.map(item => [
      escapeCsvField(item.id),
      escapeCsvField(item.shortcode),
      escapeCsvField(item.type),
      escapeCsvField(item.username),
      escapeCsvField(item.author),
      escapeCsvField(item.publishedAt || item.publishedFormatted),
      escapeCsvField(item.likeCount),
      escapeCsvField(item.commentCount),
      escapeCsvField(item.viewCount),
      escapeCsvField(item.sourceUrl),
      escapeCsvField(item.mediaUrl),
      escapeCsvField(item.caption || '')
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  /**
   * Export items as pretty JSON string
   */
  function exportToJson(items) {
    return JSON.stringify(items || [], null, 2);
  }

  /**
   * Export items as human-readable captions TXT file
   */
  function exportToTxt(items) {
    if (!Array.isArray(items) || items.length === 0) return '';

    return items
      .map((item, index) => {
        return `========================================
POST #${index + 1} | @${item.username || 'unknown'}
ID: ${item.id} | Shortcode: ${item.shortcode}
Type: ${item.type} | Date: ${item.publishedFormatted || item.publishedAt || 'N/A'}
Likes: ${item.likeCount || 0} | Comments: ${item.commentCount || 0} | Views: ${item.viewCount || 0}
Source URL: ${item.sourceUrl || 'N/A'}
Media URL: ${item.mediaUrl || 'N/A'}
----------------------------------------
CAPTION:
${item.caption ? item.caption.trim() : '(No caption)'}
========================================\n\n`;
      })
      .join('');
  }

  /**
   * Trigger browser file download from string content
   */
  function downloadBlob(content, mimeType, defaultFilename) {
    const blob = (content instanceof Blob) ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Validates if a Blob is a genuine video binary payload (MP4 magic bytes, non-HTML)
   */
  async function validateVideoBlob(blob) {
    if (!blob || blob.size < 1024) return false;
    // Direct MP4/QuickTime container header detection first
    try {
      const headerBuf = await blob.slice(0, 12).arrayBuffer();
      const b = new Uint8Array(headerBuf);
      if (b.length >= 12) {
        const ftyp = b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
        const moov = b[4] === 0x6d && b[5] === 0x6f && b[6] === 0x6f && b[7] === 0x76;
        const mdat = b[4] === 0x6d && b[5] === 0x64 && b[6] === 0x61 && b[7] === 0x74;
        if (ftyp || moov || mdat) return true;
      }
    } catch (e) { /* fall through */ }

    const mime = (blob.type || '').toLowerCase();
    if (mime.includes('video/mp4') || mime.includes('video/quicktime')) {
      return blob.size >= 50000;
    }
    if (mime.includes('text/html') || mime.includes('text/plain') || mime.includes('json') || mime.includes('application/json')) {
      return false;
    }
    try {
      const text = await blob.slice(0, 512).text();
      if (text.includes('<!DOCTYPE') || text.includes('<html') || text.includes('{"code":') || text.includes('Access Denied') || text.includes('"error":')) {
        return false;
      }
    } catch (e) {
      // Binary data
    }
    return blob.size >= 50000;
  }

  /**
   * Extract direct MP4 stream URLs embedded in Instagram HTML (JSON-escaped aware)
   */
  function extractInstagramMp4FromHtml(html) {
    const seen = new Set();
    const out = [];
    const patterns = [
      /content="(https?:\/\/[^"]+\.mp4[^"]*)"/gi,
      /<video[^>]+src="(https?:\/\/[^"]+\.mp4[^"]*)"/gi,
      /"(?:url|video_url|src)"\s*:\s*"((?:\\.|[^"\\])*?)"/gi
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(html)) !== null) {
        let url = m[1]
          .replace(/\\\\u0026/g, '&')
          .replace(/\\u0026/g, '&')
          .replace(/\\\\u002F/g, '/')
          .replace(/\\u002F/g, '/')
          .replace(/\\\\\//g, '/')
          .replace(/\\\//g, '/')
          .replace(/\\(.)/g, '$1')
          .replace(/#.*$/, '')
          .trim();
        if (!/^https?:/i.test(url)) continue;
        if (!/\.mp4/i.test(url) && !/bytestart/i.test(url)) continue;
        if (!seen.has(url)) {
          seen.add(url);
          out.push(url);
        }
      }
    }
    return out;
  }

  /**
   * Resolves direct playable video URL and fetches validated Blob payload
   */
  async function fetchValidatedMedia(item) {
    const isVideo = item.type === 'video';
    const platform = item.platform || (item.id?.startsWith('tt_') ? 'tiktok' : item.id?.startsWith('fb_') ? 'facebook' : 'instagram');
    const shortcode = item.id || item.shortcode || '';

    let candidateUrls = [];
    const push = (u) => {
      if (u && /^https?:/i.test(u) && !u.includes('/video/') && !u.includes('/reel/') && !u.includes('/p/') && !candidateUrls.includes(u)) {
        candidateUrls.push(u);
      }
    };

    if (isVideo) {
      if (item.videoUrl) push(item.videoUrl);
      if (Array.isArray(item.videoCandidates)) item.videoCandidates.forEach(push);
      push(item.mediaUrl);
    } else {
      push(item.mediaUrl);
      push(item.displayUrl);
    }

    // 1. If platform is TikTok and candidate URL is a webpage or missing direct stream, resolve via TikWM
    if (platform === 'tiktok') {
      const sourceUrl = item.sourceUrl || item.videoUrl || item.mediaUrl || '';
      if (sourceUrl.includes('tiktok.com')) {
        try {
          const tikwmRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(sourceUrl)}`);
          if (tikwmRes.ok) {
            const tikwmJson = await tikwmRes.json();
            if (tikwmJson && tikwmJson.data && tikwmJson.data.play) {
              let directPlay = tikwmJson.data.play;
              if (directPlay.startsWith('//')) directPlay = 'https:' + directPlay;
              else if (directPlay.startsWith('/')) directPlay = 'https://www.tikwm.com' + directPlay;
              candidateUrls.unshift(directPlay);
            }
          }
        } catch (e) {
          console.warn('[EXPORT-UTILS] TikWM resolution failed:', e);
        }
      }
    }

    // 2. Try candidate URLs (direct CDN streams with real MP4 headers)
    for (const url of candidateUrls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const blob = await res.blob();
          if (isVideo) {
            const isValid = await validateVideoBlob(blob);
            if (isValid) {
              return { blob, extension: 'mp4', mimeType: 'video/mp4', isVideo: true };
            }
          } else if (blob.size > 2000 && !blob.type.includes('html')) {
            return { blob, extension: 'jpg', mimeType: 'image/jpeg', isVideo: false };
          }
        }
      } catch (err) {
        console.warn('[EXPORT-UTILS] Direct candidate fetch failed:', err);
      }
    }

    // 3. Same-origin re-scrape: extract fresh CDN streams from the post/reel page (sends session cookies)
    if (isVideo && platform === 'instagram' && shortcode) {
      try {
        const page = await fetch(`https://www.instagram.com/p/${shortcode}/`, {
          headers: { 'Accept': 'text/html' }
        });
        if (page.ok) {
          const html = await page.text();
          const freshUrls = extractInstagramMp4FromHtml(html);
          for (const url of freshUrls) {
            if (candidateUrls.includes(url)) continue;
            try {
              const res = await fetch(url);
              if (res.ok) {
                const blob = await res.blob();
                const isValid = await validateVideoBlob(blob);
                if (isValid) {
                  console.log(`[EXPORT-UTILS] Recovered fresh stream for ${shortcode} from page HTML`);
                  return { blob, extension: 'mp4', mimeType: 'video/mp4', isVideo: true };
                }
              }
            } catch (e) { /* try next */ }
          }
        }
      } catch (err) {
        console.warn('[EXPORT-UTILS] Same-origin page re-scrape failed:', err);
      }
    }

    // 3b. Same-origin re-scrape for Facebook reels (prefers HD tier streams)
    if (isVideo && platform === 'facebook' && shortcode) {
      try {
        const page = await fetch(`https://www.facebook.com/reel/${shortcode}/`, {
          headers: { 'Accept': 'text/html' }
        });
        if (page.ok) {
          const html = await page.text();
          const freshUrls = extractInstagramMp4FromHtml(html);
          for (const url of freshUrls) {
            if (candidateUrls.includes(url)) continue;
            try {
              const res = await fetch(url);
              if (res.ok) {
                const blob = await res.blob();
                const isValid = await validateVideoBlob(blob);
                if (isValid) {
                  console.log(`[EXPORT-UTILS] Recovered fresh Facebook stream for ${shortcode} from page HTML`);
                  return { blob, extension: 'mp4', mimeType: 'video/mp4', isVideo: true };
                }
              }
            } catch (e) { /* try next */ }
          }
        }
      } catch (err) {
        console.warn('[EXPORT-UTILS] Facebook same-origin re-scrape failed:', err);
      }
    }

    // 4. Optional: best-effort server-assisted fallback when the companion web app is running
    //    (authenticated via the API token — deducts 1 credit per video, resolves reels/TikTok server-side)
    if (isVideo && shortcode) {
      try {
        const stored = await chrome.storage.local.get(['apiBase', 'apiToken']);
        const apiBase = (stored.apiBase || '').replace(/\/$/, '');
        const apiToken = stored.apiToken || '';
        if (!apiBase || !apiToken) {
          throw new Error('No server configured in extension settings');
        }
        const dlUrl = `${apiBase}/api/media/download?url=${encodeURIComponent(item.sourceUrl || item.mediaUrl || '')}&shortcode=${encodeURIComponent(shortcode)}&type=video&platform=${encodeURIComponent(platform)}&token=${encodeURIComponent(apiToken)}`;
        const dlRes = await fetch(dlUrl, { cache: 'no-store' });
        if (dlRes.status === 402) {
          throw new Error('Insufficient credits. 1 video = 1 credit.');
        }
        if (dlRes.ok) {
          const blob = await dlRes.blob();
          const isValid = await validateVideoBlob(blob);
          if (isValid) {
            return { blob, extension: 'mp4', mimeType: 'video/mp4', isVideo: true };
          }
        }
      } catch (e) {
        if (e.message && e.message.includes('Insufficient credits')) throw e;
        console.warn('[EXPORT-UTILS] Server-assisted download failed:', e);
      }
    }

    // 5. Fallback: Try thumbnail image as cover JPG if video stream failed validation
    if (item.thumbnailUrl || item.displayUrl) {
      try {
        const thumbUrl = item.thumbnailUrl || item.displayUrl;
        const res = await fetch(thumbUrl);
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size > 1000 && !blob.type.includes('html')) {
            return { blob, extension: 'jpg', mimeType: 'image/jpeg', isVideo: false };
          }
        }
      } catch (e) {
        // ignore
      }
    }

    throw new Error(`Unable to fetch valid video stream for ${item.shortcode || item.id}`);
  }

  exports.exportToCsv = exportToCsv;
  exports.exportToJson = exportToJson;
  exports.exportToTxt = exportToTxt;
  exports.downloadBlob = downloadBlob;
  exports.validateVideoBlob = validateVideoBlob;
  exports.fetchValidatedMedia = fetchValidatedMedia;

})(typeof exports !== 'undefined' ? exports : (window.IGScraperExport = {}));
