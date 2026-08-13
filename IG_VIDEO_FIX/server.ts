import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

app.use(express.json());

// CORS headers for local app requests
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Helper to extract direct MP4 video URL from a TikTok post or video page
 */
async function resolveTikTokVideoUrl(shortcode: string, providedUrl?: string): Promise<string | null> {
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  // 1. If providedUrl is already a direct video file URL on tiktokcdn or tikwm
  if (providedUrl && (providedUrl.includes('tiktokcdn.com') || providedUrl.includes('tikwm.com') || providedUrl.includes('.mp4') || providedUrl.includes('bytestart='))) {
    return providedUrl;
  }

  const cleanUrl = providedUrl && providedUrl.includes('tiktok.com') 
    ? providedUrl 
    : (shortcode ? `https://www.tiktok.com/@user/video/${shortcode}` : null);

  if (!cleanUrl) return providedUrl || null;

  console.log(`[PROXY-SERVER] Resolving TikTok video URL for: ${cleanUrl}`);

  // Attempt 1: Fetch via TikWM API (Fast, no watermark, direct MP4)
  try {
    const tikwmApiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`;
    const tikwmRes = await fetch(tikwmApiUrl, {
      headers: { "User-Agent": userAgent }
    });
    if (tikwmRes.ok) {
      const tikwmJson = await tikwmRes.json();
      if (tikwmJson && tikwmJson.data && tikwmJson.data.play) {
        let directMp4 = tikwmJson.data.play;
        if (directMp4.startsWith("//")) directMp4 = "https:" + directMp4;
        else if (directMp4.startsWith("/")) directMp4 = "https://www.tikwm.com" + directMp4;
        console.log(`[PROXY-SERVER] Successfully resolved TikTok video via TikWM API: ${directMp4.substring(0, 80)}...`);
        return directMp4;
      }
    }
  } catch (err) {
    console.warn(`[PROXY-SERVER] TikWM resolution failed for ${cleanUrl}:`, err);
  }

  // Attempt 2: Fetch TikTok oEmbed endpoint
  try {
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(cleanUrl)}`;
    const oembedRes = await fetch(oembedUrl, {
      headers: { "User-Agent": userAgent }
    });
    if (oembedRes.ok) {
      const oembedJson = await oembedRes.json();
      if (oembedJson.html) {
        const mp4Match = oembedJson.html.match(/src="([^"]+tiktokcdn[^"]+)"/i) ||
                         oembedJson.html.match(/src="([^"]+\.mp4[^"]*)"/i);
        if (mp4Match && mp4Match[1]) {
          let directUrl = mp4Match[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
          if (directUrl.startsWith("//")) directUrl = "https:" + directUrl;
          console.log(`[PROXY-SERVER] Resolved TikTok video via oEmbed: ${directUrl.substring(0, 80)}...`);
          return directUrl;
        }
      }
    }
  } catch (err) {
    console.warn(`[PROXY-SERVER] oEmbed resolution failed for ${cleanUrl}:`, err);
  }

  // Attempt 3: Fetch TikTok page HTML directly
  try {
    const pageRes = await fetch(cleanUrl, {
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.tiktok.com/"
      }
    });

    if (pageRes.ok) {
      const html = await pageRes.text();
      const videoMatch =
        html.match(/"playAddr"\s*:\s*"([^"]+)"/i) ||
        html.match(/"play_addr"\s*:\s*\{\s*"url_list"\s*:\s*\[\s*"([^"]+)"/i) ||
        html.match(/"downloadAddr"\s*:\s*"([^"]+)"/i) ||
        html.match(/<video[^>]+src="([^"]+)"/i) ||
        html.match(/content="(https:\/\/[^"]+tiktokcdn[^"]+)"/i);

      if (videoMatch && videoMatch[1]) {
        let directUrl = videoMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
        if (directUrl.startsWith("//")) directUrl = "https:" + directUrl;
        console.log(`[PROXY-SERVER] Resolved TikTok video via page HTML: ${directUrl.substring(0, 80)}...`);
        return directUrl;
      }
    }
  } catch (err) {
    console.warn(`[PROXY-SERVER] Error resolving TikTok video page for ${cleanUrl}:`, err);
  }

  return providedUrl || null;
}

/**
 * Extract every direct MP4/CDN candidate URL embedded in Instagram page HTML,
 * preferring the highest-resolution video_versions streams first.
 * Handles JSON-escaped (\\u0026, \\/, \\\\) and raw meta-tag attributes.
 */
function extractInstagramMp4Candidates(html: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const highRes: { url: string; area: number }[] = [];

  const patterns = [
    /content="(https?:\/\/[^"]+\.mp4[^"]*)"/gi,                    // <meta property="og:video" content="...">
    /<video[^>]+src="(https?:\/\/[^"]+\.mp4[^"]*)"/gi,             // <video src="...">
    /"video_versions"\s*:\s*\[[^\]]*"url"\s*:\s*"((?:\\.|[^"\\])*?)"/gi,
    /"(?:video_url|downloadAddr|playAddr|src|url)"\s*:\s*"((?:\\.|[^"\\])*?)"/gi
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      let url = m[1];
      try {
        url = url
          .replace(/\\\\u0026/g, '&')   // \\\u0026 (double-escaped)
          .replace(/\\u0026/g, '&')     // \u0026
          .replace(/\\\\u002F/g, '/')
          .replace(/\\u002F/g, '/')
          .replace(/\\\\\//g, '/')
          .replace(/\\\//g, '/')
          .replace(/\\"/g, '"')
          .replace(/\\$/g, '')
          .trim();
      } catch (e) { /* ignore */ }

      if (!/^https?:/i.test(url)) continue;
      const isMp4Like = /\.mp4/i.test(url) || /bytestart/i.test(url) || /_n\.mp4/i.test(url);
      if (!isMp4Like) continue;

      // Normalize to a clean, cacheable direct URL
      url = url.replace(/#.*$/, '').trim();
      if (!seen.has(url)) {
        seen.add(url);
        result.push(url);
      }
    }
  }

  // Parse video_versions blocks with their resolution and prefer the largest one
  const vvArrRe = /"video_versions"\s*:\s*\[((?:\\.|[^\]])*)\]/g;
  let vvMatch: RegExpExecArray | null;
  while ((vvMatch = vvArrRe.exec(html)) !== null) {
    const objRe = /\{"type":\d+,"width":(\d+),"height":(\d+),"url":"((?:\\.|[^"\\])*?)"/g;
    let om: RegExpExecArray | null;
    while ((om = objRe.exec(vvMatch[1])) !== null) {
      let url = om[3]
        .replace(/\\\\u0026/g, '&')
        .replace(/\\u0026/g, '&')
        .replace(/\\\\u002F/g, '/')
        .replace(/\\u002F/g, '/')
        .replace(/\\\\\//g, '/')
        .replace(/\\\//g, '/')
        .replace(/\\$/g, '')
        .trim();
      if (!/^https?:/i.test(url) || !url.includes('.mp4')) continue;
      const area = parseInt(om[1], 10) * parseInt(om[2], 10);
      highRes.push({ url, area });
    }
  }
  highRes.sort((a, b) => b.area - a.area);
  highRes.forEach(c => {
    if (!seen.has(c.url)) {
      seen.add(c.url);
      result.unshift(c.url); // best quality first
    }
  });

  return result;
}

/**
 * Helper: returns true if the buffer starts with an MP4/QuickTime container header.
 */
function isMp4Buffer(buf: Buffer): boolean {
  if (!buf || buf.length < 12) return false;
  // "ftyp" box magic at offset 4, or QuickTime "moov"/"mdat" marker
  return (
    (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) ||
    (buf[4] === 0x6d && buf[5] === 0x6f && buf[6] === 0x6f && buf[7] === 0x76) || // moov
    (buf[4] === 0x6d && buf[5] === 0x64 && buf[6] === 0x61 && buf[7] === 0x74)    // mdat
  );
}

/**
 * Resolve up to N direct MP4 candidate URLs for an Instagram reel/post.
 * Returns direct CDN URLs when possible, otherwise page-SSR extracted streams.
 */
async function resolveInstagramVideoCandidates(shortcode: string, providedUrl?: string): Promise<string[]> {
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  const candidates: string[] = [];

  // 1. If providedUrl is already a direct mp4 stream, probe it first
  if (providedUrl && (providedUrl.includes('.mp4') || providedUrl.includes('bytestart=') || /^https?:\/\/[^/]+\/(scontent|video)/i.test(providedUrl))) {
    candidates.push(providedUrl);
  }

  const cleanCode = shortcode || (providedUrl ? providedUrl.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/)?.[2] : null);
  if (!cleanCode) return candidates;

  const urlsToTry = [
    `https://www.instagram.com/p/${cleanCode}/embed/captioned/`,
    `https://www.instagram.com/reel/${cleanCode}/embed/captioned/`,
    `https://www.instagram.com/p/${cleanCode}/`,
    `https://www.instagram.com/reel/${cleanCode}/`
  ];

  for (const pageUrl of urlsToTry) {
    try {
      const res = await fetch(pageUrl, {
        headers: {
          "User-Agent": userAgent,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none"
        }
      });
      if (!res.ok) continue;
      const html = await res.text();
      const extracted = extractInstagramMp4Candidates(html);
      extracted.forEach(u => {
        if (!candidates.includes(u)) candidates.push(u);
      });
      // Prefer CDN-quality sources first (highest-res scontent streams)
      candidates.sort((a, b) => (b.includes('scontent') && b.includes('.mp4') ? 1 : 0) - (a.includes('scontent') && a.includes('.mp4') ? 1 : 0));
      if (extracted.length > 0) break;
    } catch (err) {
      console.warn(`[PROXY-SERVER] Error fetching ${pageUrl}:`, err);
    }
  }

  return candidates;
}

/**
 * Extract direct Facebook CDN video stream URLs embedded in page HTML,
 * prioritizing HD/browser-native quality tiers over SD playable_url.
 */
function extractFacebookVideoCandidates(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const hd: string[] = [];
  const sd: string[] = [];

  const patterns = [
    /"(?:browser_native_hd_url|playable_url_quality_hd|hq_playable_url|hd_src)"\s*:\s*"((?:\\.|[^"\\])*?)"/gi,
    /"(?:video_src|playable_url|browser_native_sd_url|playable_url_quality_sd)"\s*:\s*"((?:\\.|[^"\\])*?)"/gi,
    /<video[^>]+src="(https?:\/\/[^"]+\.mp4[^"]*)"/gi,
    /content="(https?:\/\/[^"]+\.mp4[^"]*)"/gi
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      let url = m[1];
      try {
        url = url
          .replace(/\\\\u0026/g, '&')
          .replace(/\\u0026/g, '&')
          .replace(/\\\\u002F/g, '/')
          .replace(/\\u002F/g, '/')
          .replace(/\\\\\//g, '/')
          .replace(/\\\//g, '/')
          .replace(/\\(u005C|u002F|u0026)/g, '')
          .replace(/\\"/g, '"')
          .replace(/\\$/g, '')
          .trim();
      } catch (e) { /* ignore */ }

      if (!/^https?:/i.test(url)) continue;
      if (!/\.mp4/i.test(url) && !/fbcdn\.net/i.test(url)) continue;
      url = url.replace(/#.*$/, '').trim();
      if (seen.has(url)) continue;
      seen.add(url);

      const isHd = /(hd|quality_hd|native_hd)/i.test(re.source) || /quality_HD|(?:-|_|\/)hd/i.test(url);
      (isHd ? hd : sd).push(url);
    }
  }

  // HD streams first, then SD — deduped overall
  [...hd, ...sd].forEach(u => {
    if (!out.includes(u)) out.push(u);
  });
  return out;
}

/**
 * Resolve direct Facebook reel/post video stream candidates (HD preferred).
 * Works for reel pages, watch pages, and classic /videos/ URLs.
 */
async function resolveFacebookVideoCandidates(shortcode: string, providedUrl?: string): Promise<string[]> {
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  const candidates: string[] = [];

  // 1. If providedUrl is already a direct fbcdn stream, probe it first
  if (providedUrl && (providedUrl.includes('.mp4') || providedUrl.includes('fbcdn.net'))) {
    candidates.push(providedUrl);
  }

  let cleanId = '';
  if (shortcode) {
    const m = shortcode.match(/(\d+)/);
    cleanId = m ? m[1] : shortcode;
  }
  const providedMatch = providedUrl ? providedUrl.match(/\/(reel|videos|watch)\/(\d+)/) : null;
  const videoId = cleanId || (providedMatch ? providedMatch[2] : '');
  if (videoId && !/^\d+$/.test(videoId)) {
    // Allow alphabetic reel handles too by falling back to the raw value
  }

  const urlsToTry = [
    `${videoId ? `https://www.facebook.com/reel/${videoId}/` : ''}`,
    `${providedUrl && providedUrl.includes('/reel/') ? providedUrl : ''}`,
    `${videoId ? `https://www.facebook.com/watch/?v=${videoId}` : ''}`,
    `${videoId ? `https://m.facebook.com/reel/${videoId}/` : ''}`
  ].filter(u => u && u.startsWith('http'));

  if (urlsToTry.length === 0) {
    // If only a full page URL was supplied, attempt it directly
    if (providedUrl) urlsToTry.push(providedUrl);
  }

  for (const pageUrl of urlsToTry) {
    try {
      const res = await fetch(pageUrl, {
        headers: {
          "User-Agent": userAgent,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none"
        }
      });
      if (!res.ok) continue;
      const html = await res.text();
      const extracted = extractFacebookVideoCandidates(html);
      extracted.forEach(u => {
        if (!candidates.includes(u)) candidates.push(u);
      });
      if (extracted.length > 0) break;
    } catch (err) {
      console.warn(`[PROXY-SERVER] Error fetching Facebook ${pageUrl}:`, err);
    }
  }

  return candidates;
}

/**
 * Proxy media endpoint: Fetches full-quality MP4/JPG directly from CDN, bypassing browser CORS restrictions.
 */
app.get("/api/proxy-media", async (req, res) => {
  const targetUrl = req.query.url as string;
  const shortcode = req.query.shortcode as string;
  const mediaType = (req.query.type as string) || "video";
  const platform = (req.query.platform as string) || "instagram";

  if (!targetUrl && !shortcode) {
    res.status(400).json({ error: "Missing url or shortcode query parameter" });
    return;
  }

  try {
    let resolvedUrl = targetUrl;
    let urlCandidates: string[] = [];

    // For video / reel items, resolve direct MP4 URL based on platform
    if (mediaType === "video" || (targetUrl && (targetUrl.includes("/reel/") || targetUrl.includes("/p/") || targetUrl.includes("/video/") || targetUrl.includes("/watch/")))) {
      if (platform === "tiktok" || (targetUrl && targetUrl.includes("tiktok.com"))) {
        const resolved = await resolveTikTokVideoUrl(shortcode, targetUrl);
        if (resolved) {
          resolvedUrl = resolved;
          urlCandidates = [resolved];
        }
      } else if (platform === "facebook" || (targetUrl && targetUrl.includes("facebook.com"))) {
        urlCandidates = await resolveFacebookVideoCandidates(shortcode, targetUrl);
        // HD-tier streams first
        urlCandidates = urlCandidates.sort((a, b) => {
          const hdScore = (u: string) => (/(hd|quality_hd|native_hd)/i.test(u) || u.includes('_hd')) ? 2 : (u.includes('.mp4') ? 1 : 0);
          return hdScore(b) - hdScore(a);
        });
        if (urlCandidates.length > 0) resolvedUrl = urlCandidates[0];
      } else {
        urlCandidates = await resolveInstagramVideoCandidates(shortcode, targetUrl);
        // Prefer the highest-resolution scontent direct stream first
        urlCandidates = urlCandidates.sort((a, b) => {
          const score = (u: string) => {
            if (u.includes('.mp4') && (u.includes('scontent') || u.includes('cdninstagram'))) return 3;
            if (u.includes('.mp4')) return 2;
            if (u.includes('bytestart')) return 1;
            return 0;
          };
          return score(b) - score(a);
        });
        if (urlCandidates.length > 0) resolvedUrl = urlCandidates[0];
      }
    } else if (resolvedUrl) {
      urlCandidates = [resolvedUrl];
    }

    if (!resolvedUrl || urlCandidates.length === 0) {
      res.status(404).json({ error: "Could not resolve direct media URL" });
      return;
    }

    // Set up request headers to bypass CDN blocking
    const baseHeaders: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Accept-Encoding": "identity" // Prevent chunk encoding issues for binary streaming
    };

    console.log(`[PROXY-SERVER] Proxying media request for [${mediaType}] -> ${resolvedUrl.substring(0, 90)}... (${urlCandidates.length} candidate(s))`);

    // Try every candidate until we get a genuine video/image binary
    for (const candidate of urlCandidates) {
      const headers = { ...baseHeaders };
      if (platform === "tiktok" || (candidate || '').includes("tiktokcdn")) {
        headers["Referer"] = "https://www.tiktok.com/";
      } else {
        headers["Referer"] = "https://www.instagram.com/";
      }

      try {
        console.log(`[PROXY-SERVER] Trying candidate: ${candidate.substring(0, 90)}...`);
        const cdnResponse = await fetch(candidate, { headers });

        if (!cdnResponse.ok) {
          console.warn(`[PROXY-SERVER] Candidate returned HTTP ${cdnResponse.status}`);
          continue;
        }

        const contentType = cdnResponse.headers.get("content-type") || "";
        const arrayBuffer = await cdnResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Reject HTML/JSON login-page shams before streaming them to the client
        if (/text\/html|application\/json|text\/plain/i.test(contentType) || buffer.length < 2048) {
          console.warn(`[PROXY-SERVER] Candidate yielded invalid payload (${contentType}) — skipping`);
          continue;
        }

        // For videos, verify the actual MP4 container header (prevents tiny/renamed images)
        if (mediaType === "video" && !isMp4Buffer(buffer)) {
          console.warn(`[PROXY-SERVER] Candidate payload is not a real MP4 (${buffer.length} bytes) — skipping`);
          continue;
        }

        const isImage = /image/i.test(contentType);
        const finalType = isImage && !/mp4|quicktime|video/i.test(contentType) ? (contentType || "image/jpeg") : contentType;

        console.log(`[PROXY-SERVER] Media successfully fetched. Binary size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB (${buffer.length} bytes), Type: ${finalType}, URL: ${candidate.substring(0, 60)}`);

        res.setHeader("Content-Type", finalType);
        res.setHeader("Content-Length", buffer.length);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(buffer);
        return;
      } catch (err) {
        console.warn(`[PROXY-SERVER] Candidate fetch failed: ${err}`);
        continue;
      }
    }

    res.status(404).json({ error: "All media candidates failed to produce a valid binary" });
  } catch (err: any) {
    console.error("[PROXY-SERVER] Proxy media error:", err);
    res.status(500).json({ error: "Failed to proxy media", message: err.message });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Full-stack Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
