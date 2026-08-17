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
const fbPagesLimiter = new RateLimiter(10, 0.1);      // 10 req burst, 0.1/sec refill = 6/min
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

// INSTAGRAM AUTO-POST (session-based â€” no Meta app / no review)
// ==========================================

const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");
const DATA_DIR = process.env.DATA_DIR || process.cwd();
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ignore */ }
const IG_POSTER_SCRIPT = path.join(process.cwd(), "instagram_poster.py");
const IG_SESSION_CRED_FILE = path.join(DATA_DIR, ".ig-poster-session.json");
const PUBLISH_QUEUE_FILE = path.join(DATA_DIR, ".publish-queue.json");

interface PublishItem {
  id: string;
  shortcode: string;
  mediaUrl: string;
  caption?: string;
  type: 'video' | 'image';
  reel: boolean;
  platform: 'instagram' | 'facebook';
  scheduledAt: number;
  status: 'queued' | 'downloading' | 'publishing' | 'posted' | 'failed';
  attempts: number;
  postedAt?: number;
  postUrl?: string;
  error?: string;
  idempotencyKey?: string;
  destination?: 'ig' | 'fb' | 'both';
  schedulingMode?: 'auto' | 'manual';
}

let publishQueue: Map<string, PublishItem> = new Map();

function generateIdempotencyKey(shortcode: string, mediaUrl: string, platform: string): string {
  return createHash("sha256").update(`${shortcode}|${mediaUrl}|${platform}`).digest("hex").slice(0, 32);
}

function findByIdempotencyKey(key: string): PublishItem | undefined {
  for (const item of publishQueue.values()) {
    if (item.idempotencyKey === key) return item;
  }
  return undefined;
}

// ==========================================
// FACEBOOK PAGE CONNECTION (Page Access Token — no app review needed for your own pages)
// ==========================================
const FB_GRAPH = "https://graph.facebook.com/v21.0";
const FB_SESSION_CRED_FILE = path.join(DATA_DIR, ".fb-poster-session.json");

interface FacebookPageSession {
  pageId: string;
  pageName: string;
  accessToken: string;
  connected: boolean;
  igUserId?: string;
  igUsername?: string;
  igGraphApi?: boolean;
  userToken?: string;
  allPages?: Array<{ id: string; name: string; category?: string }>;
}

function saveFacebookPosterSession(session: FacebookPageSession) {
  try {
    fs.writeFileSync(FB_SESSION_CRED_FILE, JSON.stringify(session, null, 2), "utf8");
  } catch (e) {
    console.warn("[FB-POSTER] Could not persist session:", e);
  }
}

function loadFacebookPosterSession(): FacebookPageSession | null {
  try {
    if (!fs.existsSync(FB_SESSION_CRED_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(FB_SESSION_CRED_FILE, "utf8"));
    if (data && data.pageId && data.accessToken) {
      console.log(`[FB-POSTER] Loaded saved Facebook session for page: ${data.pageName || data.pageId}`);
      return data as FacebookPageSession;
    }
  } catch (e) {
    console.warn("[FB-POSTER] Could not load session:", e);
  }
  return null;
}

let fbTokenValidity: { checkedAt: number; valid: boolean; pageName?: string } | null = null;
const FB_TOKEN_CHECK_TTL = 10 * 60 * 1000;

async function checkFacebookToken(): Promise<{ valid: boolean; pageName?: string }> {
  const fb = loadFacebookPosterSession();
  if (!fb) return { valid: false };
  if (fbTokenValidity && Date.now() - fbTokenValidity.checkedAt < FB_TOKEN_CHECK_TTL) {
    return { valid: fbTokenValidity.valid, pageName: fbTokenValidity.pageName };
  }
  const result = await fbGraphGet<{ id: string; name: string }>(`/${fb.pageId}?fields=id,name`, fb.accessToken);
  fbTokenValidity = { checkedAt: Date.now(), valid: result.ok, pageName: result.data?.name };
  if (!result.ok) console.warn(`[FB-POSTER] Stored token is invalid or expired: ${result.error}`);
  return { valid: result.ok, pageName: result.data?.name };
}

async function fbGraphGet<T>(path: string, accessToken: string): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(`${FB_GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(accessToken)}`);
    const json = await res.json();
    if (json.error) return { ok: false, error: `${json.error.message} (code ${json.error.code})` };
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function fbGraphPost<T>(path: string, accessToken: string, body: Record<string, string | number | boolean>): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) form.append(k, String(v));
    form.append("access_token", accessToken);
    const res = await fetch(`${FB_GRAPH}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const json = await res.json();
    if (json.error) return { ok: false, error: `${json.error.message} (code ${json.error.code})` };
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

interface SidecarResult {
  ok: boolean;
  message: string;
  username?: string;
  url?: string;
  code?: string;
  [key: string]: unknown;
}

function runPythonSidecar(args: string[]): Promise<SidecarResult> {
  return new Promise(resolve => {
    const child = spawn(PYTHON_BIN, [IG_POSTER_SCRIPT, ...args], { windowsHide: true, cwd: DATA_DIR });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", d => (stdout += d));
    child.stderr.on("data", d => (stderr += d));
    child.on("error", err => {
      resolve({ ok: false, message: `Python sidecar failed to start: ${err.message}. Install Python 3.8+ and run: pip install instagrapi` });
    });
child.on("close", code => {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      // JSON is emitted as the last stdout line (earlier lines are library progress logs)
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line.startsWith("{")) continue;
        try {
          resolve(JSON.parse(line));
          return;
        } catch {
          continue;
        }
      }
      resolve({ ok: false, message: stderr.trim() || stdout.trim() || `sidecar exited with code ${code}` });
    });
  });
}

function saveInstagramPosterSession() {
  try {
    const username = process.env.IG_POSTER_USERNAME || "";
    if (!username) return;
    fs.writeFileSync(IG_SESSION_CRED_FILE, JSON.stringify({ username, connected: true }, null, 2), "utf8");
  } catch (e) {
    console.warn("[IG-POSTER] Could not persist session:", e);
  }
}

function loadInstagramPosterSession(): string {
  try {
    if (!fs.existsSync(IG_SESSION_CRED_FILE)) return "";
    const data = JSON.parse(fs.readFileSync(IG_SESSION_CRED_FILE, "utf8"));
    if (data && data.username) {
      console.log(`[IG-POSTER] Loaded saved Instagram session for: @${data.username}`);
      return data.username;
    }
  } catch (e) {
    console.warn("[IG-POSTER] Could not load session:", e);
  }
  return "";
}

function savePublishQueue() {
  try {
    fs.writeFileSync(PUBLISH_QUEUE_FILE, JSON.stringify(Array.from(publishQueue.values()), null, 2), "utf8");
  } catch (e) {
    console.warn("[IG-POSTER] Could not persist queue:", e);
  }
}

function loadPublishQueue() {
  try {
    if (!fs.existsSync(PUBLISH_QUEUE_FILE)) return;
    const items: PublishItem[] = JSON.parse(fs.readFileSync(PUBLISH_QUEUE_FILE, "utf8"));
    if (Array.isArray(items)) {
      publishQueue = new Map(items.map(i => [i.id, i]));
      // Recover stale in-flight items after a restart (upload died with the old process)
      for (const item of publishQueue.values()) {
        if (item.status === 'publishing' || item.status === 'downloading') {
          item.status = 'queued';
        }
      }
      savePublishQueue();
      console.log(`[IG-POSTER] Loaded ${items.length} queued posts from disk`);
    }
  } catch (e) {
    console.warn("[IG-POSTER] Could not load queue:", e);
  }
}

async function downloadPublishMedia(item: PublishItem): Promise<Buffer> {
  // Direct CDN media URL first
  try {
    const res = await fetch(item.mediaUrl, {
      headers: { "User-Agent": UA, "Referer": "https://www.instagram.com/", "Accept": "*/*" }
    });
    if (res.ok) {
      const mime = res.headers.get("content-type") || "";
      const buf = Buffer.from(await res.arrayBuffer());
      if (!/text\/html|application\/json|text\/plain/i.test(mime) && buf.length > 2048) return buf;
    }
  } catch (e) { /* fall through to resolution */ }

  // 'VIDEO:shortcode' style or reel page URL â€” resolve direct streams first
  const cleanCode = item.shortcode || (item.mediaUrl.match(/\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/) || [])[1] || "";
  const candidates = await resolveInstagramVideoCandidates(cleanCode, item.mediaUrl.startsWith("http") ? item.mediaUrl : undefined);
  for (const url of candidates) {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Referer": "https://www.instagram.com/", "Accept": "*/*" } });
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 2048) return buf;
  }
  throw new Error(`Could not download media for ${item.shortcode || item.id}`);
}

async function publishToFacebook(item: PublishItem, mediaBuffer: Buffer): Promise<{ ok: boolean; url?: string; message?: string }> {
  const fb = loadFacebookPosterSession();
  if (!fb) return { ok: false, message: "No Facebook page connected — connect in the Auto-Post panel first." };

  // Direct video URL for Graph API upload (avoids temp file for Facebook)
  let mediaFileBuffer: Buffer | null = null;
  let uploadPath: string;

  if (item.type === 'video') {
    if (item.reel) {
      uploadPath = `/${fb.pageId}/reels`;
    } else {
      uploadPath = `/${fb.pageId}/videos`;
    }
  } else {
    uploadPath = `/${fb.pageId}/photos`;
  }

  if (item.type === 'video') {
    // Prefer video_url (Graph accepts direct MP4 links); fall back to binary upload
    try {
      const body: Record<string, string | number | boolean> = {
        caption: (item.caption || "").slice(0, 1500) || "Shared via SocialScraper",
        description: (item.caption || "").slice(0, 1500) || "Shared via SocialScraper",
        published: true,
      };
      if (!/^https?:\/\//i.test(item.mediaUrl)) {
        mediaFileBuffer = mediaBuffer;
      } else {
        body.video_url = item.mediaUrl;
      }
      const result = item.reel
        ? await fbGraphPost<{ id: string }>(uploadPath, fb.accessToken, body)
        : await fbGraphPost<{ id: string }>(uploadPath, fb.accessToken, body);
      if (result.ok) {
        return { ok: true, url: `https://www.facebook.com/${fb.pageId}/posts/${result.data?.id || ''}`, message: "Posted to Facebook" };
      }
      if (result.error?.toLowerCase().includes("video_url") || result.error?.toLowerCase().includes("invalid parameter")) {
        // Some pages require binary upload — fall through to binary
      } else {
        return { ok: false, message: result.error };
      }
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  // Binary upload via multipart for photos or video_url fallback
  if (item.type === 'image' || mediaFileBuffer) {
    try {
      const form = new FormData();
      const mime = item.type === 'image' ? 'image/jpeg' : 'video/mp4';
      const ext = item.type === 'image' ? 'jpg' : 'mp4';
      form.append('file', new Blob([mediaFileBuffer || mediaBuffer], { type: mime }), `media_${item.id}.${ext}`);
      form.append('caption', (item.caption || '').slice(0, 1500) || 'Shared via SocialScraper');
      form.append('access_token', fb.accessToken);
      const res = await fetch(`${FB_GRAPH}${uploadPath}`, { method: 'POST', body: form });
      const json = await res.json();
      if (json.error) return { ok: false, message: `${json.error.message} (code ${json.error.code})` };
      return { ok: true, url: `https://www.facebook.com/${fb.pageId}/posts/${json.id || ''}`, message: 'Posted to Facebook' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  return { ok: false, message: 'Could not upload to Facebook' };
}

async function publishToInstagramGraphApi(item: PublishItem, fb: FacebookPageSession): Promise<{ ok: boolean; url?: string; message?: string }> {
  if (!fb.igUserId) return { ok: false, message: "No Instagram business account linked to the connected page" };
  const mediaUrl = item.mediaUrl;
  if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl)) {
    return { ok: false, message: "IG Graph API needs a public media URL — scraped mediaUrl is missing" };
  }

  // Step 1: create the container
  const isVideo = item.type === 'video';
  const params: Record<string, string> = {
    access_token: fb.accessToken,
    caption: (item.caption || "").slice(0, 2200),
  };
  if (isVideo) {
    params.media_type = item.reel ? 'REELS' : 'VIDEO';
    params.video_url = mediaUrl;
    if (item.reel) params.share_to_feed = 'true';
  } else {
    params.image_url = mediaUrl;
  }

  const container = await fbGraphPost<{ id: string }>(`/${fb.igUserId}/media`, fb.accessToken, params);
  if (!container.ok || !container.data?.id) {
    return { ok: false, message: container.error || "Could not create IG media container" };
  }
  const containerId = container.data.id;

  // Videos need processing before publish — poll container status (max ~90s)
  if (isVideo) {
    const deadline = Date.now() + 90 * 1000;
    while (Date.now() < deadline) {
      const status = await fbGraphGet<{ status_code?: string; status?: string }>(`/${containerId}?fields=status_code`, fb.accessToken);
      const code = status.data?.status_code || "";
      if (code === 'FINISHED') break;
      if (code === 'ERROR' || (status.data?.status && /error/i.test(status.data.status))) {
        return { ok: false, message: `IG video processing error: ${status.data?.status || code}` };
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Step 2: publish
  const publish = await fbGraphPost<{ id: string }>(`/${fb.igUserId}/media_publish`, fb.accessToken, { creation_id: containerId });
  if (!publish.ok || !publish.data?.id) {
    return { ok: false, message: publish.error || "IG media_publish failed" };
  }
  const shortcode = await fbGraphGet<{ shortcode?: string }>(`/${publish.data.id}?fields=shortcode`, fb.accessToken);
  return {
    ok: true,
    url: shortcode.data?.shortcode ? `https://www.instagram.com/p/${shortcode.data.shortcode}/` : `https://www.instagram.com/p/${publish.data.id}/`,
    message: 'Posted to Instagram via Graph API',
  };
}

async function publishItemNow(item: PublishItem): Promise<boolean> {
  if (item.status === 'posted') return true;
  if (item.platform === 'facebook') {
    const fb = loadFacebookPosterSession();
    if (!fb) {
      item.status = 'failed';
      item.error = 'No Facebook page connected — connect in the Auto-Post panel first.';
      savePublishQueue();
      return false;
    }
  } else {
    const fb = loadFacebookPosterSession();
    const username = loadInstagramPosterSession();
    if (!fb?.igUserId && !username) {
      item.status = 'failed';
      item.error = 'No Instagram available — link an Instagram business account to the connected page (Graph API) or connect an IG session.';
      savePublishQueue();
      return false;
    }
  }

  item.status = 'downloading';
  savePublishQueue();
  let tmpFile = "";
  try {
    const caption = (item.caption || "").slice(0, 2200);
    let success = false;
    let postUrl = "";
    let failMessage = "";

    if (item.platform === 'facebook') {
      const buf = await downloadPublishMedia(item);
      const fb = loadFacebookPosterSession()!;
      // Facebook: try video_url first (no temp upload), binary as fallback
      const res = await publishToFacebook(item, buf);
      if (res.ok) {
        success = true;
        postUrl = res.url || '';
      } else {
        failMessage = res.message || 'Facebook publish failed';
      }
    } else {
      // Instagram: prefer Graph API (no download, uses public media URL) — fall back to instagrapi sidecar
      const fb = loadFacebookPosterSession();
      if (fb?.igUserId) {
        const res = await publishToInstagramGraphApi(item, fb);
        if (res.ok) {
          success = true;
          postUrl = res.url || '';
        } else {
          failMessage = res.message || 'IG Graph API publish failed';
        }
      } else {
        failMessage = 'No Instagram business account linked to the connected page';
      }

      if (!success) {
        const username = loadInstagramPosterSession();
        if (username) {
          const buf = await downloadPublishMedia(item);
          const tmpDir = path.join(DATA_DIR, ".tmp");
          fs.mkdirSync(tmpDir, { recursive: true });
          tmpFile = path.join(tmpDir, `post_${item.id}_${Date.now()}.${item.type === 'video' ? 'mp4' : 'jpg'}`);
          fs.writeFileSync(tmpFile, buf);
          const side = await runPythonSidecar([
            "publish",
            "--username", username,
            "--media", tmpFile,
            "--caption", caption,
            "--type", item.type,
            "--reel", item.reel ? "true" : "false"
          ]);
          if (side.ok) {
            success = true;
            postUrl = side.url || `https://www.instagram.com/p/${side.code || ''}`;
          } else {
            failMessage = `${failMessage} | sidecar: ${side.message}`;
          }
        }
      }
    }

    if (!success) throw new Error(failMessage);

    item.status = 'posted';
    item.postedAt = Date.now();
    item.postUrl = postUrl;
    item.error = undefined;
    savePublishQueue();
    console.log(`[IG-POSTER] Posted ${item.shortcode} on ${item.platform}: ${postUrl}`);
    return true;
  } catch (err) {
    const message = (err as Error).message;
    item.attempts = (item.attempts || 0) + 1;
    item.status = item.attempts >= 3 ? 'failed' : 'queued';
    item.error = message;
    if (item.status === 'queued') {
      item.scheduledAt = Date.now() + 5 * 60 * 1000; // retry in 5 min
    }
    savePublishQueue();
    console.warn(`[IG-POSTER] Failed ${item.shortcode} on ${item.platform}: ${message}`);
    return false;
  } finally {
    if (tmpFile) fs.rmSync(tmpFile, { force: true });
  }
}

// Simple semaphore for concurrent queue processing
class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise(resolve => this.waitQueue.push(resolve));
  }

  release(): void {
    this.permits++;
    const next = this.waitQueue.shift();
    if (next) {
      this.permits--;
      next();
    }
  }
}

const PUBLISH_CONCURRENCY = parseInt(process.env.PUBLISH_CONCURRENCY || "2", 10);
const publishSemaphore = new Semaphore(PUBLISH_CONCURRENCY);

loadPublishQueue();

// Process due queue items (20s interval) - now with concurrent processing via semaphore
setInterval(async () => {
  const dueItems = Array.from(publishQueue.values()).filter(
    item => item.scheduledAt <= Date.now() &&
      !['posted', 'failed', 'publishing', 'downloading'].includes(item.status)
  );

  if (dueItems.length === 0) return;

  console.log(`[IG-POSTER] Processing ${dueItems.length} due queue items (concurrency: ${PUBLISH_CONCURRENCY})`);

  await Promise.all(dueItems.map(async (item) => {
    await publishSemaphore.acquire();
    try {
      await publishItemNow(item);
    } finally {
      publishSemaphore.release();
    }
  }));
}, 20 * 1000);

app.post("/api/publish/connect", async (req, res) => {
  try {
    const { sessionId, username, password } = req.body || {};
    if ((!username || !password) && !sessionId) {
      return res.status(400).json({ error: "Provide sessionId (cookie â€” recommended) or username + password" });
    }
    if (process.env.IG_POSTER_USERNAME) {
      process.env.IG_POSTER_USERNAME = "";
    }
    const side = sessionId
      ? await runPythonSidecar(["connect", "--sessionid", sessionId, ...(username ? ["--username", username] : [])])
      : await runPythonSidecar(["connect", "--username", username, "--password", password]);
    if (!side.ok) throw new Error(side.message);
    process.env.IG_POSTER_USERNAME = side.username || username || "";
    saveInstagramPosterSession();
    console.log(`[IG-POSTER] Connected: @${side.username || username}`);
    res.json({ success: true, username: side.username || username, message: side.message });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/publish/test", async (req, res) => {
  try {
    const username = loadInstagramPosterSession();
    if (!username) return res.json({ success: false, connected: false, message: "No session connected" });
    const side = await runPythonSidecar(["status", "--username", username]);
    res.json({ success: side.ok, connected: side.ok, username: side.username || username, message: side.message });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/publish/disconnect", async (req, res) => {
  try {
    const username = loadInstagramPosterSession();
    if (username) await runPythonSidecar(["disconnect", "--username", username]);
    process.env.IG_POSTER_USERNAME = "";
    fs.rmSync(IG_SESSION_CRED_FILE, { force: true });
    res.json({ success: true, message: "Instagram session disconnected" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ==========================================
// SMART SCHEDULING
// ==========================================
const SCHEDULING_CONFIG_FILE = path.join(process.cwd(), ".scheduling-config.json");

interface SchedulingConfig {
  maxPostsPerDay: number;
  maxReelsPerDay: number;
  windowStart: string;
  windowEnd: string;
  intervalMinutes: number;
  jitterMinutes: number;
  sameAsYesterdayOffsetMinutes: number;
}

const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  maxPostsPerDay: 10,
  maxReelsPerDay: 5,
  windowStart: "09:00",
  windowEnd: "21:00",
  intervalMinutes: 30,
  jitterMinutes: 5,
  sameAsYesterdayOffsetMinutes: 10,
};

function loadSchedulingConfig(): SchedulingConfig {
  try {
    if (!fs.existsSync(SCHEDULING_CONFIG_FILE)) return { ...DEFAULT_SCHEDULING_CONFIG };
    const raw = JSON.parse(fs.readFileSync(SCHEDULING_CONFIG_FILE, "utf8"));
    return { ...DEFAULT_SCHEDULING_CONFIG, ...raw };
  } catch (e) {
    console.warn("[SCHEDULE] Could not load config:", e);
    return { ...DEFAULT_SCHEDULING_CONFIG };
  }
}

function saveSchedulingConfig(cfg: SchedulingConfig) {
  fs.writeFileSync(SCHEDULING_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}

function minutesOf(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function generateAutoSlots(count: number, cfg: SchedulingConfig, now: Date = new Date()): number[] {
  const start = minutesOf(cfg.windowStart);
  const end = minutesOf(cfg.windowEnd);
  const capacity = Math.max(1, Math.floor((end - start) / Math.max(10, cfg.intervalMinutes)));
  const n = Math.min(Math.max(1, count), capacity);
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const slots: number[] = [];
  for (let i = 0; i < n; i++) {
    const slotMin = start + i * cfg.intervalMinutes;
    let t = base.getTime() + slotMin * 60 * 1000;
    if (t <= now.getTime()) t = now.getTime() + 60 * 1000;
    const jitter = cfg.jitterMinutes > 0 ? Math.round((Math.random() * 2 - 1) * cfg.jitterMinutes * 60 * 1000) : 0;
    slots.push(t + jitter);
  }
  return slots;
}

app.post("/api/publish/queue", (req, res) => {
  try {
    const { shortcode, mediaUrl, caption, scheduledAt, type, reel, platform, destination, schedulingMode } = req.body || {};
    if (!mediaUrl || !shortcode) {
      return res.status(400).json({ error: "mediaUrl and shortcode are required" });
    }
    if (!["video", "image"].includes(type || "video")) {
      return res.status(400).json({ error: "type must be video or image" });
    }
    const targetPlatform = platform === "facebook" ? "facebook" : "instagram";
    if (targetPlatform === "facebook" && !loadFacebookPosterSession()) {
      return res.status(400).json({ error: "No Facebook page connected — connect first in the Queue panel" });
    }

    // Idempotency: prevent duplicate queue entries for same content
    const idempotencyKey = generateIdempotencyKey(shortcode, mediaUrl, targetPlatform);
    const existing = findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return res.json({
        success: true,
        itemId: existing.id,
        message: "Post already queued (duplicate detected)",
        duplicate: true,
        existingShortcode: existing.shortcode,
        existingPlatform: existing.platform,
        existingScheduledAt: existing.scheduledAt,
        existingStatus: existing.status,
      });
    }

    const id = `post_${shortcode}_${Date.now()}`;

    // Daily caps: excess items roll to tomorrow at window start
    const cfg = loadSchedulingConfig();
    if (schedulingMode !== "manual") {
      const igItems = Array.from(publishQueue.values()).filter(
        (i) => i.platform === "instagram" && ["queued", "downloading", "publishing"].includes(i.status),
      );
      const fbItems = Array.from(publishQueue.values()).filter(
        (i) => i.platform === "facebook" && ["queued", "downloading", "publishing"].includes(i.status),
      );
      const targetItems = targetPlatform === "facebook" ? fbItems : igItems;
      const countToday = targetItems.filter(
        (i) => new Date(i.scheduledAt).toDateString() === new Date().toDateString(),
      ).length;
      let limitHit = countToday >= cfg.maxPostsPerDay;
      if (targetPlatform === "instagram" && !limitHit && reel !== false) {
        const reelsToday = targetItems.filter(
          (i) => i.reel && new Date(i.scheduledAt).toDateString() === new Date().toDateString(),
        ).length;
        limitHit = reelsToday >= cfg.maxReelsPerDay;
      }
      if (limitHit) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const [hh, mm] = cfg.windowStart.split(":").map(Number);
        tomorrow.setHours(hh, mm, 0, 0);
        publishQueue.set(id, {
          id,
          shortcode,
          mediaUrl,
          caption,
          type: type || "video",
          reel: reel !== false,
          platform: targetPlatform,
          scheduledAt: tomorrow.getTime(),
          status: "queued",
          attempts: 0,
          idempotencyKey,
          destination,
          schedulingMode: schedulingMode || "auto",
        });
        savePublishQueue();
        return res.json({
          success: true,
          itemId: id,
          message: `Daily limit reached — scheduled for tomorrow ${cfg.windowStart}`,
          deferredToTomorrow: true,
        });
      }
    }

    publishQueue.set(id, {
      id,
      shortcode,
      mediaUrl,
      caption,
      type: type || "video",
      reel: reel !== false,
      platform: targetPlatform,
      scheduledAt:
        schedulingMode === "manual" || scheduledAt
          ? scheduledAt
            ? Number(scheduledAt)
            : Date.now() + 60 * 1000
          : generateAutoSlots(1, cfg)[0],
      status: "queued",
      attempts: 0,
      idempotencyKey,
      destination,
      schedulingMode: schedulingMode || "auto",
    });
    savePublishQueue();
    console.log(`[IG-POSTER] Queued ${shortcode} (${targetPlatform}) at ${new Date(publishQueue.get(id)!.scheduledAt).toLocaleString()}`);
    res.json({ success: true, itemId: id, message: "Post queued" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/publish/set-platform", (req, res) => {
  try {
    const { itemId, platform } = req.body || {};
    if (!itemId) return res.status(400).json({ error: "itemId is required" });
    if (!['instagram', 'facebook'].includes(platform)) {
      return res.status(400).json({ error: "platform must be instagram or facebook" });
    }
    const item = publishQueue.get(itemId);
    if (!item) return res.status(404).json({ error: "Queue item not found" });
    if (item.status === 'posted') {
      return res.status(400).json({ error: "Already posted — can't change platform" });
    }
    if (platform === 'facebook' && !loadFacebookPosterSession()) {
      return res.status(400).json({ error: "No Facebook page connected — connect first" });
    }
    if (platform === 'instagram' && !loadInstagramPosterSession()) {
      return res.status(400).json({ error: "No Instagram account connected — connect first" });
    }
    item.platform = platform;
    savePublishQueue();
    console.log(`[IG-POSTER] Item ${itemId} platform changed -> ${platform}`);
    res.json({ success: true, message: `Platform changed to ${platform}` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/publish/scheduling-config", (req, res) => {
  res.json({ success: true, config: loadSchedulingConfig() });
});

app.put("/api/publish/scheduling-config", (req, res) => {
  try {
    const { config } = req.body || {};
    if (!config || typeof config !== "object") return res.status(400).json({ error: "config object required" });
    const merged: SchedulingConfig = { ...DEFAULT_SCHEDULING_CONFIG, ...config };
    merged.maxPostsPerDay = Math.max(1, Math.min(100, Number(merged.maxPostsPerDay) || 10));
    merged.maxReelsPerDay = Math.max(0, Math.min(100, Number(merged.maxReelsPerDay) || 5));
    merged.intervalMinutes = Math.max(10, Math.min(1440, Number(merged.intervalMinutes) || 30));
    merged.jitterMinutes = Math.max(0, Math.min(60, Number(merged.jitterMinutes) || 5));
    merged.sameAsYesterdayOffsetMinutes = Math.max(0, Math.min(120, Number(merged.sameAsYesterdayOffsetMinutes) || 10));
    saveSchedulingConfig(merged);
    res.json({ success: true, config: merged });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/publish/schedule-like-yesterday", (req, res) => {
  try {
    const { offsetMinutes } = req.body || {};
    const cfg = loadSchedulingConfig();
    const offset = offsetMinutes === undefined ? cfg.sameAsYesterdayOffsetMinutes : Number(offsetMinutes) || 0;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yKey = yesterday.toDateString();
    const yesterdayItems = Array.from(publishQueue.values()).filter(
      (i) => i.status === "posted" && i.postedAt && new Date(i.postedAt).toDateString() === yKey,
    );
    const times = yesterdayItems
      .map((i) => {
        const d = new Date(i.postedAt!);
        return d.getHours() * 60 + d.getMinutes();
      })
      .sort((a, b) => a - b);
    const pending = Array.from(publishQueue.values()).filter((i) => i.status === "queued");
    const targets = pending.slice(0, cfg.maxPostsPerDay);
    const assigned: Array<{ id: string; scheduledAt: number }> = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const useTimes = times.length ? times : [minutesOf(cfg.windowStart) + offset];
    targets.forEach((item, i) => {
      const t = base.getTime() + (useTimes[i % useTimes.length] + offset) * 60 * 1000;
      if (t <= Date.now()) return;
      item.scheduledAt = t;
      item.schedulingMode = "auto";
      assigned.push({ id: item.id, scheduledAt: t });
    });
    savePublishQueue();
    res.json({
      success: true,
      assigned,
      message: times.length
        ? `Copied yesterday's ${times.length} posting times (+${offset} min offset) to today's queue`
        : `No posts yesterday — scheduled from ${cfg.windowStart} +${offset} min`,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/publish/set-mode", (req, res) => {
  try {
    const { itemId, mode } = req.body || {};
    const item = publishQueue.get(itemId);
    if (!item) return res.status(404).json({ error: "Queue item not found" });
    if (item.status !== "queued") return res.status(400).json({ error: "Only queued items can change mode" });
    item.schedulingMode = mode === "manual" ? "manual" : "auto";
    savePublishQueue();
    res.json({ success: true, message: `Mode set to ${item.schedulingMode}` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/publish/set-time", (req, res) => {
  try {
    const { itemId, scheduledAt } = req.body || {};
    const item = publishQueue.get(itemId);
    if (!item) return res.status(404).json({ error: "Queue item not found" });
    const t = Number(scheduledAt);
    if (!t || Number.isNaN(t)) return res.status(400).json({ error: "scheduledAt (ms) required" });
    item.scheduledAt = t;
    item.schedulingMode = "manual";
    savePublishQueue();
    res.json({ success: true, scheduledAt: t, message: `Rescheduled to ${new Date(t).toLocaleString()}` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/publish/status", async (req, res) => {
  const username = loadInstagramPosterSession();
  const fb = loadFacebookPosterSession();
  const fbToken = await checkFacebookToken();
  const items = Array.from(publishQueue.values()).sort((a, b) => a.scheduledAt - b.scheduledAt);
  res.json({
    success: true,
    connected: !!username,
    username,
    facebookConnected: !!fb && fbToken.valid,
    facebookTokenValid: fbToken.valid,
    facebookPageName: (fbToken.valid && fbToken.pageName) || fb?.pageName || "",
    facebookPageId: fb?.pageId || "",
    facebookPages: fb?.allPages || [],
    igGraphApiConnected: !!fb?.igUserId,
    igGraphApiUsername: fb?.igUsername || "",
    igGraphApiUserId: fb?.igUserId || "",
    queue: items,
    schedulingConfig: loadSchedulingConfig(),
    stats: {
      posted: items.filter(i => i.status === 'posted').length,
      failed: items.filter(i => i.status === 'failed').length,
      pending: items.filter(i => ['queued', 'downloading', 'publishing'].includes(i.status)).length
    },
    perPlatform: {
      instagram: {
        connected: !!username,
        posted: items.filter(i => i.platform === 'instagram' && i.status === 'posted').length,
        pending: items.filter(i => i.platform === 'instagram' && ['queued', 'downloading', 'publishing'].includes(i.status)).length,
        failed: items.filter(i => i.platform === 'instagram' && i.status === 'failed').length,
      },
      facebook: {
        connected: !!fb && fbToken.valid,
        pageName: (fbToken.valid && fbToken.pageName) || fb?.pageName || "",
        posted: items.filter(i => i.platform === 'facebook' && i.status === 'posted').length,
        pending: items.filter(i => i.platform === 'facebook' && ['queued', 'downloading', 'publishing'].includes(i.status)).length,
        failed: items.filter(i => i.platform === 'facebook' && i.status === 'failed').length,
      },
    },
  });
});

// ==========================================
// FACEBOOK PAGE CONNECT (Page Access Token — no app review for your own pages)
// ==========================================

app.post("/api/facebook/pages", rateLimit(fbPagesLimiter), async (req, res) => {
  try {
    const { userToken } = req.body || {};
    if (!userToken) return res.status(400).json({ error: "Provide a Facebook User Access Token" });
    const result = await fbGraphGet<{ data: Array<{ id: string; name: string; access_token: string; category?: string }> }>("/me/accounts", userToken);
    if (!result.ok || !result.data) {
      return res.status(400).json({ error: result.error || "Could not list pages — is the token valid and app in development mode?" });
    }
    const pages = (result.data.data || []).map((p) => ({ id: p.id, name: p.name, category: p.category || "" }));
    res.json({ success: true, pages, message: pages.length ? `Found ${pages.length} pages you manage` : "No pages found for this token" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/facebook/connect", async (req, res) => {
  try {
    const { pageId, pageName, pageToken, userToken } = req.body || {};
    let token = pageToken || "";
    let pid = pageId || "";
    let pname = pageName || "";
    let allPages: FacebookPageSession["allPages"];
    let userTokenSaved = "";
    if (!token && userToken) {
      const result = await fbGraphGet<{ data: Array<{ id: string; name: string; access_token: string; category?: string }> }>("/me/accounts", userToken);
      if (result.ok && result.data && result.data.data.length) {
        const pages = result.data.data || [];
        const chosen = pages.find((p) => p.id === pid) || pages[0];
        token = chosen.access_token;
        pid = chosen.id;
        pname = chosen.name;
        allPages = pages.map((p) => ({ id: p.id, name: p.name, category: p.category || "" }));
        userTokenSaved = userToken;
      } else if (pid) {
        const page = await fbGraphGet<{ id: string; name: string; access_token?: string }>(`/${pid}?fields=access_token,name`, userToken);
        if (!page.ok || !page.data?.access_token) {
          return res.status(400).json({ error: page.error || `Could not fetch page ${pid} access token — does this user token have pages permission on that page?` });
        }
        token = page.data.access_token;
        pname = page.data.name || pname;
      } else {
        return res.status(400).json({ error: result.error || "No pages found for this token — provide a pageId or a page token" });
      }
    }
    if (!token) return res.status(400).json({ error: "Provide pageToken or userToken" });
    if (!pid) {
      const me = await fbGraphGet<{ id: string; name: string; first_name?: string; last_name?: string }>("/me?fields=id,name,first_name,last_name", token);
      if (!me.ok || !me.data || !me.data.id) {
        return res.status(400).json({ error: me.error || "Could not resolve page from token — is this a valid Page Access Token?" });
      }
      if (me.data.first_name || me.data.last_name) {
        // User token pasted in the page-token field — auto-convert via /me/accounts instead of erroring
        const accts = await fbGraphGet<{ data: Array<{ id: string; name: string; access_token: string; category?: string }> }>("/me/accounts", token);
        if (accts.ok && accts.data && accts.data.data && accts.data.data.length) {
          const pages = accts.data.data;
          const chosen = pages.find((p) => p.id === pid) || pages[0];
          userTokenSaved = token;
          token = chosen.access_token;
          pid = chosen.id;
          pname = chosen.name;
          allPages = pages.map((p) => ({ id: p.id, name: p.name, category: p.category || "" }));
          console.log(`[FB-POSTER] Auto-converted user token → page token for ${pname} (${pid})`);
        } else {
          return res.status(400).json({ error: `This token belongs to the personal profile "${me.data.name}" (${me.data.id}) and has no manageable pages. Generate a token for your Page (e.g. Alphaburx) in Graph API Explorer → "Get Page Access Token" → select the PAGE, or paste your User Access Token in the "User Token" field instead.` });
        }
      } else {
        pid = me.data.id;
        pname = pname || me.data.name || "";
      }
    }
    if (!pname) {
      const check = await fbGraphGet<{ id: string; name: string }>(`/${pid}?fields=id,name`, token);
      if (!check.ok || !check.data) return res.status(400).json({ error: check.error || "Page token invalid" });
      pname = check.data.name || pname;
    }
    const session: FacebookPageSession = { pageId: pid, pageName: pname, accessToken: token, connected: true };
    if (userTokenSaved) session.userToken = userTokenSaved;
    if (allPages) session.allPages = allPages;
    const ig = await fbGraphGet<{ instagram_business_account?: { id: string; username?: string } }>(
      `/${pid}?fields=instagram_business_account{id,username}`, token
    );
    if (ig.ok && ig.data && ig.data.instagram_business_account) {
      session.igUserId = ig.data.instagram_business_account.id;
      session.igUsername = ig.data.instagram_business_account.username || "";
      session.igGraphApi = true;
      console.log(`[FB-POSTER] Linked Instagram business account: @${session.igUsername} (${session.igUserId}) — IG Graph API enabled`);
    } else {
      session.igGraphApi = false;
      console.log(`[FB-POSTER] No Instagram business account linked to page ${pname} — IG posting falls back to instagrapi`);
    }
    saveFacebookPosterSession(session);
    fbTokenValidity = null;
    console.log(`[FB-POSTER] Connected page: ${pname} (${pid})`);
    res.json({ success: true, pageId: pid, pageName: pname, igUserId: session.igUserId, igUsername: session.igUsername, igGraphApi: session.igGraphApi, message: `Connected to page: ${pname}` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/facebook/switch-page", async (req, res) => {
  try {
    const fb = loadFacebookPosterSession();
    if (!fb) return res.status(400).json({ error: "No Facebook session — connect first" });
    if (!fb.userToken) {
      return res.status(400).json({ error: "Session was connected with a Page Access Token — reconnect with a User Token to switch between pages" });
    }
    const { pageId } = req.body || {};
    if (!pageId) return res.status(400).json({ error: "pageId is required" });
    const page = await fbGraphGet<{ id: string; name: string; access_token?: string }>(
      `/${pageId}?fields=access_token,name`, fb.userToken
    );
    if (!page.ok || !page.data?.access_token) {
      return res.status(400).json({ error: page.error || `Could not fetch page ${pageId} access token — does this user token manage that page?` });
    }
    const session: FacebookPageSession = { ...fb, pageId, pageName: page.data.name, accessToken: page.data.access_token, connected: true };
    const ig = await fbGraphGet<{ instagram_business_account?: { id: string; username?: string } }>(
      `/${pageId}?fields=instagram_business_account{id,username}`, session.accessToken
    );
    session.igUserId = undefined;
    session.igUsername = undefined;
    session.igGraphApi = false;
    if (ig.ok && ig.data && ig.data.instagram_business_account) {
      session.igUserId = ig.data.instagram_business_account.id;
      session.igUsername = ig.data.instagram_business_account.username || "";
      session.igGraphApi = true;
    }
    saveFacebookPosterSession(session);
    fbTokenValidity = null;
    console.log(`[FB-POSTER] Switched active page: ${session.pageName} (${pageId})`);
    res.json({ success: true, pageId, pageName: session.pageName, igUsername: session.igUsername, igGraphApi: session.igGraphApi, message: `Switched to page: ${session.pageName}` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/facebook/test", async (req, res) => {
  try {
    const fb = loadFacebookPosterSession();
    if (!fb) return res.json({ success: false, connected: false, message: "No Facebook page connected" });
    const result = await fbGraphGet<{ id: string; name: string }>(`/${fb.pageId}?fields=id,name`, fb.accessToken);
    if (!result.ok) {
      return res.json({ success: false, connected: false, message: result.error || "Page token invalid or expired — reconnect" });
    }
    res.json({ success: true, connected: true, pageName: result.data?.name || fb.pageName, message: `Session valid — connected to page: ${result.data?.name || fb.pageName}` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/facebook/disconnect", (req, res) => {
  try {
    fs.rmSync(FB_SESSION_CRED_FILE, { force: true });
    fbTokenValidity = { checkedAt: 0, valid: false };
    res.json({ success: true, message: "Facebook page disconnected" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/publish/remove", (req, res) => {
  const { itemId } = req.body || {};
  if (!itemId || !publishQueue.delete(itemId)) {
    return res.status(404).json({ error: "Item not found in queue" });
  }
  savePublishQueue();
  res.json({ success: true, message: "Post removed from queue" });
});

app.post("/api/publish/clear", (req, res) => {
  publishQueue.clear();
  savePublishQueue();
  res.json({ success: true, message: "Publish queue cleared" });
});

app.post("/api/publish/trigger-now", async (req, res) => {
  try {
    const { itemId } = req.body || {};
    if (!itemId || !publishQueue.has(itemId)) {
      return res.status(404).json({ error: "Item not found in queue" });
    }
    const item = publishQueue.get(itemId)!;
    const ok = await publishItemNow(item);
    res.json({ success: ok, itemId, status: item.status, postUrl: item.postUrl, error: item.error, message: ok ? "Posted successfully" : `Failed: ${item.error}` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ==========================================
// INSTAGRAM AUTO-POST END

// ==========================================
// ANALYTICS DASHBOARD
// ==========================================

app.get("/api/analytics/dashboard", (req, res) => {
  try {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const items = Array.from(publishQueue.values());
    const monthPosted = items.filter((i) => i.status === "posted" && i.postedAt && i.postedAt >= monthStart);
    const monthFailed = items.filter((i) => i.status === "failed" && i.postedAt && i.postedAt >= monthStart);

    let monthScraped = 0;
    let monthDownloads = 0;
    const timeSeries: Array<{ date: string; scraped: number; published: number; failed: number; downloads: number }> = [];
    for (let d = 29; d >= 0; d--) {
      const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
      const key = dayKey(dt);
      const counters = analyticsDays.get(key) || { scraped: 0, downloads: 0 };
      const dayItems = items.filter((i) => i.postedAt && dayKey(new Date(i.postedAt)) === key);
      const entry = {
        date: key,
        scraped: counters.scraped,
        published: dayItems.filter((i) => i.status === "posted").length,
        failed: dayItems.filter((i) => i.status === "failed").length,
        downloads: counters.downloads,
      };
      timeSeries.push(entry);
      if (key.startsWith(monthKey)) {
        monthScraped += entry.scraped;
        monthDownloads += entry.downloads;
      }
    }

    const stageCounts = Array.from(contentStage.values()).reduce<Record<string, number>>(
      (acc, s) => { acc[s.platform] = (acc[s.platform] || 0) + 1; return acc; },
      {},
    );

    res.json({
      success: true,
      month: { scraped: monthScraped, published: monthPosted.length, failed: monthFailed.length, downloads: monthDownloads },
      credits: null,
      queueHealth: {
        queued: items.filter((i) => i.status === "queued" && i.scheduledAt > Date.now()).length,
        publishing: items.filter((i) => ["downloading", "publishing"].includes(i.status)).length,
        scheduled: items.filter((i) => i.status === "queued").length,
      },
      perPlatform: {
        instagram: monthPosted.filter((i) => i.platform === "instagram").length,
        facebook: monthPosted.filter((i) => i.platform === "facebook").length,
        stage: stageCounts,
      },
      timeSeries,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ==========================================
// CONTENT STAGE (scraped-post triage: select, order, caption, tags → queue)
// ==========================================

const CONTENT_STAGE_FILE = path.join(DATA_DIR, ".content-stage.json");

interface StageItem {
  id: string;
  shortcode: string;
  platform: 'instagram' | 'tiktok' | 'facebook';
  mediaUrl: string;
  thumbnail?: string;
  type: 'video' | 'image';
  originalCaption?: string;
  caption: string;
  tags: string[];
selected: boolean;
  order: number;
  destination?: "ig" | "fb" | "both";
  status: "new" | "queued";
  createdAt: number;
}

const VIRAL_TAG_LIBRARY: Record<string, string[]> = {
  instagram: ['#reels', '#explorepage', '#viral', '#trending', '#reelsinstagram', '#instagood', '#fyp', '#viralreels'],
  tiktok: ['#fyp', '#foryou', '#viral', '#trending', '#tiktok', '#foryoupage', '#explore', '#trend'],
  facebook: ['#reels', '#viral', '#trending', '#facebookreels', '#explore', '#fbreels', '#viralvideo'],
};

let contentStage: Map<string, StageItem> = new Map();
const dismissedStageKeys: Map<string, number> = new Map(); // key -> timestamp
const DISMISSED_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

function saveContentStage() {
  try {
    cleanupDismissedKeys();
    fs.writeFileSync(
      CONTENT_STAGE_FILE,
      JSON.stringify({ items: Array.from(contentStage.values()), dismissed: Array.from(dismissedStageKeys.keys()) }, null, 2),
      'utf8',
    );
  } catch (e) {
    console.warn('[STAGE] Could not persist:', e);
  }
}

function loadContentStage() {
  try {
    if (!fs.existsSync(CONTENT_STAGE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(CONTENT_STAGE_FILE, 'utf8'));
    if (Array.isArray(data.items)) contentStage = new Map(data.items.map((i: StageItem) => [i.id, i]));
    if (Array.isArray(data.dismissed)) data.dismissed.forEach((k: string) => dismissedStageKeys.set(k, Date.now()));
    console.log(`[STAGE] Loaded ${contentStage.size} staged items from disk`);
  } catch (e) {
    console.warn('[STAGE] Could not load:', e);
  }
}

function cleanupDismissedKeys(): void {
  const now = Date.now();
  for (const [key, ts] of dismissedStageKeys.entries()) {
    if (now - ts > DISMISSED_TTL) dismissedStageKeys.delete(key);
  }
}

function isDismissed(key: string): boolean {
  cleanupDismissedKeys();
  return dismissedStageKeys.has(key);
}

function dismissKey(key: string): void {
  cleanupDismissedKeys();
  dismissedStageKeys.set(key, Date.now());
}

function stageKeyOf(item: { shortcode?: string; mediaUrl?: string }): string {
  // Prefer shortcode for stable identity; fallback to a hash of mediaUrl for stability
  if (item.shortcode) return `sc:${item.shortcode}`;
  if (item.mediaUrl) {
    // Extract Instagram shortcode from URL if present, otherwise hash the URL
    const scMatch = item.mediaUrl.match(/(?:p|reel|reels)\/([A-Za-z0-9_-]{6,})/);
    if (scMatch) return `sc:${scMatch[1]}`;
    // Fallback: simple hash of mediaUrl for uniqueness
    let hash = 0;
    for (let i = 0; i < item.mediaUrl.length; i++) {
      hash = ((hash << 5) - hash) + item.mediaUrl.charCodeAt(i);
      hash |= 0;
    }
    return `url:${Math.abs(hash).toString(36)}`;
  }
  return 'unknown';
}

async function generateCaptionGemini(prompt: string): Promise<string | null> {
  try {
    if (!process.env.GEMINI_API_KEY) return null;
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const res = await ai.models.generateContent({ model, contents: prompt });
    return res.text?.trim() || null;
  } catch (e) {
    console.warn('[STAGE] Gemini caption failed:', (e as Error).message);
    return null;
  }
}

function captionFromTemplate(item: StageItem): string {
  const base = (item.originalCaption || item.caption || '').trim().slice(0, 1800);
  return base || `Fresh content from the stream ✨`;
}

app.post('/api/stage/upsert', (req, res) => {
  try {
    const { items, force } = req.body || {};
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
    let added = 0;
    const skipped: { shortcode?: string; reason: string }[] = [];
    for (const raw of items) {
      const mediaUrl = raw.mediaUrl || raw.videoUrl || raw.url ||
        (Array.isArray(raw.videoCandidates) ? raw.videoCandidates[0] : '') ||
        raw.sourceUrl || '';
      if (!mediaUrl) {
        skipped.push({ shortcode: raw.shortcode, reason: 'no media url' });
        continue;
      }
      const key = stageKeyOf({ shortcode: raw.shortcode, mediaUrl });
      // Manual sends (force) are never blocked by the dismissed list —
      // only the live auto-feed honors it to avoid resurrecting removed items.
      if (!force && isDismissed(key)) {
        skipped.push({ shortcode: raw.shortcode, reason: 'dismissed (previously removed or cleared)' });
        continue;
      }
      const id = `stage_${key}_${raw.timestamp || Date.now()}`;
      const existing = Array.from(contentStage.values()).find((s) => stageKeyOf(s) === key);
      if (existing) {
        if (!existing.originalCaption && raw.caption) existing.originalCaption = String(raw.caption);
        if (!existing.thumbnail && raw.thumbnail) existing.thumbnail = raw.thumbnail;
        continue;
      }
contentStage.set(id, {
        id,
        shortcode: String(raw.shortcode || ""),
        platform: ["instagram", "tiktok", "facebook"].includes(raw.platform) ? raw.platform : "instagram",
        mediaUrl,
        thumbnail: raw.thumbnail || "",
        type: raw.type === "image" ? "image" : "video",
        originalCaption: raw.caption ? String(raw.caption) : "",
        caption: raw.caption ? String(raw.caption) : "",
        tags: [],
        selected: false,
        order: 0,
        destination: raw.platform === "facebook" ? "fb" : "ig",
        status: "new",
        createdAt: Date.now(),
      });
      added++;
    }
    if (added) saveContentStage();
    if (added) trackAnalytics("scrape", added);
    res.json({ success: true, added, skipped, total: contentStage.size });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/stage', (req, res) => {
  const items = Array.from(contentStage.values()).sort((a, b) => {
    if (a.order && b.order) return a.order - b.order;
    return b.createdAt - a.createdAt;
  });
  res.json({
    success: true,
    aiCaptionAvailable: !!process.env.GEMINI_API_KEY,
    items,
    total: items.length,
    selected: items.filter((i) => i.selected).length,
  });
});

app.post('/api/stage/update', (req, res) => {
  try {
    const { id, caption, tags, selected, order, destination } = req.body || {};
    const item = contentStage.get(id);
    if (!item) return res.status(404).json({ error: 'Stage item not found' });
    if (typeof caption === 'string') item.caption = caption;
    if (Array.isArray(tags)) item.tags = tags.filter((t) => typeof t === 'string').slice(0, 30);
    if (typeof selected === 'boolean') item.selected = selected;
    if (typeof order === 'number') item.order = Math.max(0, Math.floor(order));
    if (['ig', 'fb', 'both'].includes(destination)) item.destination = destination;
    saveContentStage();
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/stage/remove', (req, res) => {
  try {
    const { id } = req.body || {};
    const item = contentStage.get(id);
    if (!item) return res.status(404).json({ error: 'Stage item not found' });
    dismissKey(stageKeyOf(item));
    contentStage.delete(id);
    saveContentStage();
    res.json({ success: true, message: 'Removed from stage — will not be re-added (expires in 30 days)' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/stage/clear', (req, res) => {
  for (const item of contentStage.values()) dismissKey(stageKeyOf(item));
  contentStage.clear();
  saveContentStage();
  res.json({ success: true, message: 'Stage cleared — items will not be re-added (expires in 30 days)' });
});

app.post('/api/stage/caption', async (req, res) => {
  try {
    const { id, useAi } = req.body || {};
    const item = contentStage.get(id);
    if (!item) return res.status(404).json({ error: 'Stage item not found' });

    let generated: string | null = null;
    if (useAi) {
      const prompt = [
        `Write a short engaging Instagram-style caption (max 300 chars, no hashtags) for a ${item.platform} ${item.type} post.`,
        `Original caption: ${JSON.stringify(item.originalCaption || item.caption || '(none)')}`,
        'If the original caption is meaningful, expand it slightly. If it is generic (just "Instagram video" etc.), invent a fun catchy caption.',
        'Reply with only the caption text.',
      ].join('\n');
      generated = await generateCaptionGemini(prompt);
    }
    const tags = item.tags.length ? item.tags : VIRAL_TAG_LIBRARY[item.platform] || [];
    const caption = (generated || captionFromTemplate(item)) + '\n\n' + tags.join(' ');
    if (generated) {
      item.caption = caption;
      saveContentStage();
    }
    res.json({
      success: true,
      caption,
      ai: !!generated,
      tags,
      message: generated ? 'AI caption generated' : 'Template caption with viral tags',
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/stage/tags', (req, res) => {
  try {
    const { id, platform } = req.body || {};
    const tags = VIRAL_TAG_LIBRARY[(platform || (id && contentStage.get(id)?.platform)) as string] || VIRAL_TAG_LIBRARY.instagram;
    res.json({ success: true, tags });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/stage/push-to-queue', async (req, res) => {
  try {
    const { scheduledAt, destination: globalDestination } = req.body || {};
    const selected = Array.from(contentStage.values())
      .filter((i) => i.selected && i.status === 'new')
      .sort((a, b) => (a.order || 9999) - (b.order || 9999));
    if (!selected.length) return res.status(400).json({ error: 'No selected stage items to push' });
    const destOf = (i: StageItem): 'ig' | 'fb' | 'both' =>
      (globalDestination || i.destination || (i.platform === 'facebook' ? 'fb' : 'ig')) as 'ig' | 'fb' | 'both';
    const fbSession = loadFacebookPosterSession();
    const fbToken = fbSession ? await checkFacebookToken() : { valid: false };
    const igSession = loadInstagramPosterSession();
    const wantsFb = selected.some((i) => ['fb', 'both'].includes(destOf(i)));
    if (wantsFb && (!fbSession || !fbToken.valid)) {
      return res.status(400).json({ error: 'Selected items include Facebook destinations but the Facebook page token is missing or expired — reconnect in the Queue tab first' });
    }
    const wantsIg = selected.some((i) => ['ig', 'both'].includes(destOf(i)));
    if (wantsIg && !igSession) {
      return res.status(400).json({ error: 'Selected items include Instagram destinations but no Instagram account is connected — connect one in the Queue tab first' });
    }
    const base = scheduledAt ? Number(scheduledAt) : Date.now() + 60 * 1000;
    const GAP_MS = 30 * 60 * 1000;
    const pushed: string[] = [];
    const duplicates: Array<{ shortcode: string; platform: string; existingId: string; scheduledAt: number }> = [];
    let igCount = 0;
    let fbCount = 0;
    for (let idx = 0; idx < selected.length; idx++) {
      const item = selected[idx];
      const dest = destOf(item);
      const targets: Array<'instagram' | 'facebook'> =
        dest === 'both' ? ['instagram', 'facebook'] : [dest === 'fb' ? 'facebook' : 'instagram'];
      for (const t of targets) {
        const dupKey = generateIdempotencyKey(item.shortcode || 'media', item.mediaUrl, t);
        const dup = findByIdempotencyKey(dupKey);
        if (dup) {
          duplicates.push({ shortcode: item.shortcode || 'media', platform: t, existingId: dup.id, scheduledAt: dup.scheduledAt });
          continue;
        }
        const id = `post_${item.shortcode || 'media'}_${Date.now()}_${idx}_${t}`;
        publishQueue.set(id, {
          id,
          shortcode: item.shortcode || 'media',
          mediaUrl: item.mediaUrl,
          caption: (item.caption || '').trim(),
          type: item.type,
          reel: true,
          platform: t,
          destination: dest,
          scheduledAt: base + pushed.length * GAP_MS,
          status: 'queued',
          attempts: 0,
        });
        if (t === 'facebook') fbCount++;
        else igCount++;
        pushed.push(id);
      }
      item.status = 'queued';
      item.selected = false;
    }
    savePublishQueue();
    saveContentStage();
    console.log(`[STAGE] Pushed ${pushed.length} staged posts into publish queue`);
    res.json({
      success: true,
      pushed,
      duplicates,
      queued: { instagram: igCount, facebook: fbCount },
      message: duplicates.length
        ? `Pushed ${pushed.length} posts to queue (${GAP_MS / 60000} min apart) · ${duplicates.length} already-queued duplicates skipped`
        : `Pushed ${pushed.length} posts to queue (${GAP_MS / 60000} min apart)`,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

loadAnalytics();
loadContentStage();

// ==========================================
// CONTENT STAGE END
// ==========================================
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
