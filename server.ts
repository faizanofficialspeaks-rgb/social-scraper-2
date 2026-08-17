import "dotenv/config";
import express from "express";
import path from "path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(express.json());

// Simple in-memory token bucket rate limiter
class RateLimiter {
  private buckets: Map<string, { tokens: number; lastRefill: number }> = new Map();
  
  constructor(
    private capacity: number,
    private refillRate: number // tokens per second
  ) {}
  
  private refill(bucket: { tokens: number; lastRefill: number }): { tokens: number; lastRefill: number } {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    const newTokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillRate);
    return { tokens: newTokens, lastRefill: now };
  }
  
  consume(key: string, tokens = 1): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: Date.now() };
      this.buckets.set(key, bucket);
    }
    bucket = this.refill(bucket);
    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      this.buckets.set(key, bucket);
      return true;
    }
    return false;
  }
  
  getRemaining(key: string): number {
    let bucket = this.buckets.get(key);
    if (!bucket) return this.capacity;
    bucket = this.refill(bucket);
    this.buckets.set(key, bucket);
    return Math.floor(bucket.tokens);
  }
  
  reset(key: string): void {
    this.buckets.delete(key);
  }
}

// Rate limiters for different endpoint groups
const proxyMediaLimiter = new RateLimiter(30, 0.5);   // 30 req burst, 0.5/sec refill = 30/min
const authLimiter = new RateLimiter(20, 0.33);        // 20 req burst, 0.33/sec refill = 20/min

function rateLimit(limiter: RateLimiter, keyFn: (req: express.Request) => string = (req) => req.ip || 'unknown') {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = keyFn(req);
    if (!limiter.consume(key)) {
      const remaining = limiter.getRemaining(key);
      res.setHeader('X-RateLimit-Remaining', remaining.toString());
      res.setHeader('Retry-After', Math.ceil(1 / 0.5).toString());
      return res.status(429).json({ 
        error: "RATE_LIMITED", 
        message: "Too many requests. Please slow down.",
        retryAfter: Math.ceil(1 / 0.5)
      });
    }
    res.setHeader('X-RateLimit-Remaining', limiter.getRemaining(key).toString());
    next();
  };
}

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

// ==========================================
// ANALYTICS (in-memory + .analytics.json persistence)
// ==========================================
const ANALYTICS_FILE = path.join(process.cwd(), ".analytics.json");
interface DayCounters { scraped: number; downloads: number }
let analyticsDays = new Map<string, DayCounters>();

function loadAnalytics() {
  try {
    if (!fs.existsSync(ANALYTICS_FILE)) return;
    const data = JSON.parse(fs.readFileSync(ANALYTICS_FILE, "utf8"));
    if (data && typeof data === "object") {
      analyticsDays = new Map(Object.entries(data));
    }
  } catch (e) {
    console.warn("[ANALYTICS] Could not load:", e);
  }
}

function saveAnalytics() {
  try {
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(Object.fromEntries(analyticsDays), null, 2), "utf8");
  } catch (e) {
    console.warn("[ANALYTICS] Could not persist:", e);
  }
}

function dayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function trackAnalytics(kind: "scrape" | "download", n = 1) {
  const key = dayKey();
  const cur = analyticsDays.get(key) || { scraped: 0, downloads: 0 };
  if (kind === "scrape") cur.scraped += n;
  else cur.downloads += n;
  analyticsDays.set(key, cur);
  saveAnalytics();
}

// ==========================================
// AUTH + CREDITS (Supabase)
// ==========================================
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);

let _adminClient: ReturnType<typeof createClient> | null = null;
let _anonClient: ReturnType<typeof createClient> | null = null;
function adminClient() {
  if (!_adminClient) _adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return _adminClient;
}
function anonClient() {
  if (!_anonClient) _anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  return _anonClient;
}

interface AuthUser { id: string; email: string }

async function authenticateRequest(req: express.Request): Promise<AuthUser | null> {
  if (!supabaseConfigured) return null;
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (!token) return null;
    try {
      const { data, error } = await anonClient().auth.getUser(token);
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email || "" };
    } catch {
      return null;
    }
  }
  const apiToken = (req.headers["x-api-token"] as string) || (req.query.token as string) || "";
  if (apiToken) {
    try {
      const { data } = await adminClient()
        .from("profiles")
        .select("id, email")
        .eq("api_token", apiToken)
        .maybeSingle<ProfileRow>();
      if (data) return { id: data.id, email: data.email || "" };
    } catch {
      return null;
    }
  }
  return null;
}

interface ProfileRow {
  id: string;
  email: string;
  credits: number;
  api_token?: string | null;
}

async function getProfile(userId: string): Promise<ProfileRow | null> {
  // @ts-ignore - Supabase types don't include custom RPC functions
  const { data, error } = await adminClient().rpc("get_or_create_profile", { uid: userId }) as { data: ProfileRow | null; error: Error | null };
  if (error) {
    // @ts-ignore - Supabase types don't include custom table schema
    const { data: row } = await adminClient().from("profiles").select("*").eq("id", userId).maybeSingle<ProfileRow>();
    return row;
  }
  return data;
}

async function deductCredits(userId: string, amount: number): Promise<{ ok: boolean; balance: number }> {
  // @ts-ignore - Supabase types don't include custom RPC functions
  const { data, error } = await adminClient().rpc("deduct_credits", { uid: userId, amount }) as { data: { ok: boolean; balance: number } | null; error: Error | null };
  if (error) return { ok: false, balance: -1 };
  if (data === null || data === undefined) {
    const profile = await getProfile(userId);
    return { ok: false, balance: profile?.credits ?? 0 };
  }
  return data;
}

// Disposable / temporary email domains — temp-mail accounts get 0 credits and cannot download.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "yopmail.com",
  "temp-mail.org", "tempmail.com", "getnada.com", "maildrop.cc", "throwawaymail.com",
  "trashmail.com", "mailnesia.com", "spam4.me", "fakemail.net", "emailondeck.com",
  "disposablemail.com", "tempinbox.com", "33mail.com", "discards.email",
  "mailnator.com", "tmail.ws", "inboxbear.com", "mintemail.com", "mailcatch.com",
  "mytemp.email", "tempail.com", "temporary-mail.net", "spamgourmet.com",
  "jetable.org", "maildax.com", "emailfake.com", "fakeinbox.com", "tempr.email",
  "inboxes.com", "mailpoof.com", "tempemail.net", "luxusmail.org", "altaddress.com",
  "hushmail.com", "zoemail.org", "anonaddy.com", "moakt.com", "dispostable.com",
  "mailsac.com", "burnermail.io", "expirebox.com", "fleapost.com", "grr.la",
  "ignoremail.com", "mailnull.com", "sogetthis.com", "spamfree24.org",
  "throwaway.email", "tempmailo.com", "tmpmail.org", "tempmail.dev",
  "onetimeusemail.com", "one-time.email", "sends.cf", "dropmail.me",
]);

function isDisposableEmail(email: string): boolean {
  if (!email) return false;
  const domain = email.split("@")[1]?.toLowerCase() || "";
  if (!domain) return false;
  // Exact match or subdomain of a disposable domain
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  for (const d of DISPOSABLE_EMAIL_DOMAINS) {
    if (domain === d || domain.endsWith("." + d)) return true;
  }
  // IDN / punycode normalization
  try {
    const puny = domain.startsWith("xn--") ? domain : new URL(`http://${domain}`).hostname;
    if (DISPOSABLE_EMAIL_DOMAINS.has(puny)) return true;
    for (const d of DISPOSABLE_EMAIL_DOMAINS) {
      if (puny === d || puny.endsWith("." + d)) return true;
    }
  } catch { /* ignore */ }
  return false;
}

function restrictedEmail(email: string): boolean {
  return isDisposableEmail(email);
}

// Current user + credits + api token
app.get("/api/auth/me", rateLimit(authLimiter), async (req, res) => {
  if (!supabaseConfigured) {
    res.status(503).json({ error: "SUPABASE_NOT_CONFIGURED", message: "Supabase keys are not set on the server — add SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY." });
    return;
  }
  const user = await authenticateRequest(req);
  if (!user) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }
  const profile = await getProfile(user.id);
  const restricted = restrictedEmail(user.email);
  res.json({
    user: { id: user.id, email: user.email },
    credits: restricted ? 0 : profile?.credits ?? 0,
    apiToken: profile?.api_token || null,
    restricted,
  });
});

// Generate / reveal API token (used by the Chrome extension)
app.post("/api/auth/apitoken", rateLimit(authLimiter), async (req, res) => {
  const user = await authenticateRequest(req);
  if (!user) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }
  if (!supabaseConfigured) {
    res.status(503).json({ error: "SUPABASE_NOT_CONFIGURED" });
    return;
  }
  const { createHash } = await import("node:crypto");
  const token = createHash("sha256").update(user.id + Date.now().toString() + Math.random().toString()).digest("hex").slice(0, 32);
  // @ts-ignore - Supabase types don't include custom table schema
  await adminClient().from("profiles").update({ api_token: token }).eq("id", user.id);
  res.json({ apiToken: token });
});

// Credit balance
app.get("/api/credits", rateLimit(authLimiter), async (req, res) => {
  const user = await authenticateRequest(req);
  if (!user) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }
  const profile = await getProfile(user.id);
  res.json({ credits: restrictedEmail(user.email) ? 0 : profile?.credits ?? 0, email: user.email });
});

// Debit credits (before download)
app.post("/api/credits/deduct", rateLimit(authLimiter), async (req, res) => {
  const user = await authenticateRequest(req);
  if (!user) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }
  if (restrictedEmail(user.email)) {
    res.status(402).json({ error: "INSUFFICIENT_CREDITS", credits: 0, message: "Disposable email accounts are not eligible for downloads. Sign up with a real email." });
    return;
  }
  const count = Math.max(1, Math.min(1000, parseInt(req.body?.count ?? "1", 10) || 1));
  const { ok, balance } = await deductCredits(user.id, count);
  if (!ok) {
    res.status(402).json({ error: "INSUFFICIENT_CREDITS", credits: balance, message: "Insufficient credits. 1 video = 1 credit. Contact the owner to top up." });
    return;
  }
  res.json({ ok: true, credits: balance, deducted: count });
});

// Extension token validation
app.get("/api/auth/validate-token", rateLimit(authLimiter), async (req, res) => {
  if (!supabaseConfigured) {
    res.json({ valid: false, error: "SUPABASE_NOT_CONFIGURED" });
    return;
  }
  const token = (req.query.token as string) || "";
  if (!token) {
    res.json({ valid: false, error: "MISSING_TOKEN" });
    return;
  }
  try {
    const { data } = await adminClient()
      .from("profiles")
      .select("id, email, credits")
      .eq("api_token", token)
      .maybeSingle<ProfileRow>();
    res.json(data
      ? { valid: true, credits: restrictedEmail(data.email || "") ? 0 : data.credits, email: data.email, restricted: restrictedEmail(data.email || "") }
      : { valid: false });
  } catch {
    res.json({ valid: false });
  }
});

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Helper to extract direct MP4 video URL candidates from a TikTok post or video page
 * Returns multiple candidates for fallback streaming (like Instagram/Facebook)
 */
async function resolveTikTokVideoCandidates(shortcode: string, providedUrl?: string): Promise<string[]> {
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  const candidates: string[] = [];

  // 1. If providedUrl is already a direct video file URL on tiktokcdn or tikwm
  if (providedUrl && (providedUrl.includes('tiktokcdn.com') || providedUrl.includes('tikwm.com') || providedUrl.includes('.mp4') || providedUrl.includes('bytestart='))) {
    candidates.push(providedUrl);
  }

  const cleanUrl = providedUrl && providedUrl.includes('tiktok.com') 
    ? providedUrl 
    : (shortcode ? `https://www.tiktok.com/@user/video/${shortcode}` : null);

  if (!cleanUrl) return candidates;

  console.log(`[PROXY-SERVER] Resolving TikTok video candidates for: ${cleanUrl}`);

  // Attempt 1: Fetch via TikWM API (Fast, no watermark, direct MP4)
  try {
    const tikwmApiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`;
    const tikwmRes = await fetch(tikwmApiUrl, { headers: { "User-Agent": userAgent } });
    if (tikwmRes.ok) {
      const tikwmJson = await tikwmRes.json();
      if (tikwmJson && tikwmJson.data && tikwmJson.data.play) {
        let directMp4 = tikwmJson.data.play;
        if (directMp4.startsWith("//")) directMp4 = "https:" + directMp4;
        else if (directMp4.startsWith("/")) directMp4 = "https://www.tikwm.com" + directMp4;
        if (!candidates.includes(directMp4)) {
          candidates.push(directMp4);
          console.log(`[PROXY-SERVER] TikTok candidate 1 (TikWM): ${directMp4.substring(0, 80)}...`);
        }
      }
      // Also check for HD/watermark variants
      if (tikwmJson.data?.hdplay && !candidates.includes(tikwmJson.data.hdplay)) {
        let hdUrl = tikwmJson.data.hdplay;
        if (hdUrl.startsWith("//")) hdUrl = "https:" + hdUrl;
        else if (hdUrl.startsWith("/")) hdUrl = "https://www.tikwm.com" + hdUrl;
        candidates.push(hdUrl);
        console.log(`[PROXY-SERVER] TikTok candidate 2 (HD): ${hdUrl.substring(0, 80)}...`);
      }
    }
  } catch (err) {
    console.warn(`[PROXY-SERVER] TikWM resolution failed for ${cleanUrl}:`, err);
  }

  // Attempt 2: Fetch TikTok oEmbed endpoint
  try {
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(cleanUrl)}`;
    const oembedRes = await fetch(oembedUrl, { headers: { "User-Agent": userAgent } });
    if (oembedRes.ok) {
      const oembedJson = await oembedRes.json();
      if (oembedJson.html) {
        const mp4Match = oembedJson.html.match(/src="([^"]+tiktokcdn[^"]+)"/i) ||
                         oembedJson.html.match(/src="([^"]+\.mp4[^"]*)"/i);
        if (mp4Match && mp4Match[1]) {
          let directUrl = mp4Match[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
          if (directUrl.startsWith("//")) directUrl = "https:" + directUrl;
          if (!candidates.includes(directUrl)) {
            candidates.push(directUrl);
            console.log(`[PROXY-SERVER] TikTok candidate 3 (oEmbed): ${directUrl.substring(0, 80)}...`);
          }
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
        if (!candidates.includes(directUrl)) {
          candidates.push(directUrl);
          console.log(`[PROXY-SERVER] TikTok candidate 4 (HTML): ${directUrl.substring(0, 80)}...`);
        }
      }
      // Also extract all play_addr url_list entries
      const urlListMatches = html.matchAll(/"play_addr"\s*:\s*\{\s*"url_list"\s*:\s*\[([^\]]+)\]/gi);
      for (const match of urlListMatches) {
        const urls = match[1].match(/"([^"]+)"/g) || [];
        for (const u of urls) {
          let url = u.replace(/"/g, '').replace(/\\u0026/g, "&").replace(/\\/g, "");
          if (url.startsWith("//")) url = "https:" + url;
          if (url.includes('tiktokcdn') && !candidates.includes(url)) {
            candidates.push(url);
            console.log(`[PROXY-SERVER] TikTok candidate 5 (url_list): ${url.substring(0, 80)}...`);
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[PROXY-SERVER] Error resolving TikTok video page for ${cleanUrl}:`, err);
  }

  // Prefer tiktokcdn.com URLs first (direct CDN streams)
  return candidates.sort((a, b) => {
    const aScore = a.includes('tiktokcdn.com') ? 2 : (a.includes('tikwm.com') ? 1 : 0);
    const bScore = b.includes('tiktokcdn.com') ? 2 : (b.includes('tikwm.com') ? 1 : 0);
    return bScore - aScore;
  });
}

// Backward compatibility - returns first candidate only
async function resolveTikTokVideoUrl(shortcode: string, providedUrl?: string): Promise<string | null> {
  const candidates = await resolveTikTokVideoCandidates(shortcode, providedUrl);
  return candidates[0] || providedUrl || null;
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

  // HD streams first, then SD â€” deduped overall
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
 * Shared media resolution: returns ordered candidate URLs for a target media item.
 */
async function resolveMediaCandidates(targetUrl: string, shortcode: string, mediaType: string, platform: string) {
  if (!targetUrl && !shortcode) {
    throw new Error("MISSING_PARAMS");
  }
  let resolvedUrl = targetUrl;
  let urlCandidates: string[] = [];

  if (mediaType === "video" || (targetUrl && (targetUrl.includes("/reel/") || targetUrl.includes("/p/") || targetUrl.includes("/video/") || targetUrl.includes("/watch/")))) {
    if (platform === "tiktok" || (targetUrl && targetUrl.includes("tiktok.com"))) {
      urlCandidates = await resolveTikTokVideoCandidates(shortcode, targetUrl);
      if (urlCandidates.length > 0) resolvedUrl = urlCandidates[0];
    } else if (platform === "facebook" || (targetUrl && targetUrl.includes("facebook.com"))) {
      urlCandidates = await resolveFacebookVideoCandidates(shortcode, targetUrl);
      urlCandidates = urlCandidates.sort((a, b) => {
        const hdScore = (u: string) => (/(hd|quality_hd|native_hd)/i.test(u) || u.includes('_hd')) ? 2 : (u.includes('.mp4') ? 1 : 0);
        return hdScore(b) - hdScore(a);
      });
      if (urlCandidates.length > 0) resolvedUrl = urlCandidates[0];
    } else {
      urlCandidates = await resolveInstagramVideoCandidates(shortcode, targetUrl);
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
    throw new Error("NO_MEDIA_RESOLVED");
  }
  return { resolvedUrl, urlCandidates };
}

/**
 * Shared media streaming: tries every candidate until a valid binary is found.
 */
async function streamMediaCandidates(res: express.Response, opts: { resolvedUrl: string; urlCandidates: string[]; platform: string; mediaType: string; attachment: boolean }) {
  const { resolvedUrl, urlCandidates, platform, mediaType, attachment } = opts;

  const baseHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Encoding": "identity"
  };

  console.log(`[PROXY-SERVER] Proxying media request for [${mediaType}] -> ${resolvedUrl.substring(0, 90)}... (${urlCandidates.length} candidate(s))`);

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

      if (/text\/html|application\/json|text\/plain/i.test(contentType) || buffer.length < 2048) {
        console.warn(`[PROXY-SERVER] Candidate yielded invalid payload (${contentType}) — skipping`);
        continue;
      }

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
      if (attachment) {
        const ext = isImage ? "jpg" : "mp4";
        const filename = `socialscraper_${Date.now()}.${ext}`;
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      }
      res.send(buffer);
      return true;
    } catch (err) {
      console.warn(`[PROXY-SERVER] Candidate fetch failed: ${err}`);
      continue;
    }
  }

  res.status(404).json({ error: "All media candidates failed to produce a valid binary" });
  return false;
}

/**
 * Proxy media endpoint: Fetches full-quality MP4/JPG directly from CDN, bypassing browser CORS restrictions.
 * Free preview path (images + video preview).
 */
app.get("/api/proxy-media", rateLimit(proxyMediaLimiter), async (req, res) => {
  const targetUrl = req.query.url as string;
  const shortcode = req.query.shortcode as string;
  const mediaType = (req.query.type as string) || "video";
  const platform = (req.query.platform as string) || "instagram";

  try {
    const { resolvedUrl, urlCandidates } = await resolveMediaCandidates(targetUrl, shortcode, mediaType, platform);
    await streamMediaCandidates(res, { resolvedUrl, urlCandidates, platform, mediaType, attachment: false });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "MISSING_PARAMS") {
      res.status(400).json({ error: "Missing url or shortcode query parameter" });
      return;
    }
    if (msg === "NO_MEDIA_RESOLVED") {
      res.status(404).json({ error: "Could not resolve direct media URL" });
      return;
    }
    console.error("[PROXY-SERVER] Proxy media error:", err);
    res.status(500).json({ error: "Failed to proxy media", message: msg });
  }
});

/**
 * Download endpoint: authenticated (JWT or API token), deducts 1 credit per video download.
 */
app.get("/api/media/download", async (req, res) => {
  const user = await authenticateRequest(req);
  if (!user) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Sign in or use your API token (x-api-token header)." });
    return;
  }

  const targetUrl = req.query.url as string;
  const shortcode = req.query.shortcode as string;
  const mediaType = (req.query.type as string) || "video";
  const platform = (req.query.platform as string) || "instagram";

  if (!targetUrl && !shortcode) {
    res.status(400).json({ error: "Missing url or shortcode query parameter" });
    return;
  }

  const isVideo = mediaType === "video" || (targetUrl && (targetUrl.includes("/reel/") || targetUrl.includes("/p/") || targetUrl.includes("/video/") || targetUrl.includes("/watch/")));

  try {
    // Resolve the media first — never charge a credit for a download that fails to resolve.
    const { resolvedUrl, urlCandidates } = await resolveMediaCandidates(targetUrl, shortcode, mediaType, platform);

    if (isVideo && supabaseConfigured) {
      if (restrictedEmail(user.email)) {
        res.status(402).json({ error: "INSUFFICIENT_CREDITS", credits: 0, message: "Disposable email accounts are not eligible for downloads. Sign up with a real email." });
        return;
      }
      const { ok, balance } = await deductCredits(user.id, 1);
      if (!ok) {
        res.status(402).json({ error: "INSUFFICIENT_CREDITS", credits: balance, message: "Insufficient credits. 1 video = 1 credit." });
        return;
      }
      console.log(`[CREDITS] User ${user.id} downloaded 1 video. Balance: ${balance}`);
    }

    await streamMediaCandidates(res, { resolvedUrl, urlCandidates, platform, mediaType, attachment: true });
    trackAnalytics("download");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "NO_MEDIA_RESOLVED") {
      res.status(404).json({ error: "Could not resolve direct media URL" });
      return;
    }
    console.error("[MEDIA-DOWNLOAD] Download error:", err);
    res.status(500).json({ error: "Failed to download media", message: msg });
  }
});

// ==========================================
// ANALYTICS DASHBOARD (scrape/download stats only — publishing moved to posting-app)
// ==========================================

loadAnalytics();

app.get("/api/analytics/dashboard", (req, res) => {
  try {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const timeSeries: Array<{ date: string; scraped: number; downloads: number }> = [];
    let monthScraped = 0;
    let monthDownloads = 0;
    for (let d = 29; d >= 0; d--) {
      const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
      const key = dayKey(dt);
      const counters = analyticsDays.get(key) || { scraped: 0, downloads: 0 };
      timeSeries.push({ date: key, scraped: counters.scraped, downloads: counters.downloads });
      if (key.startsWith(monthKey)) {
        monthScraped += counters.scraped;
        monthDownloads += counters.downloads;
      }
    }
    res.json({
      success: true,
      month: { scraped: monthScraped, downloads: monthDownloads },
      timeSeries,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Unknown API routes â†’ clean JSON 404 (instead of SPA fallback HTML)
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ==========================================

// ==========================================

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
    // Serve the extension sources so the in-app ZIP packager works in production too
    const extensionPath = path.join(process.cwd(), "extension");
    app.use("/extension", express.static(extensionPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Full-stack Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

