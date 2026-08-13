import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

// AI Caption Generation
interface CaptionRequest {
  platform: 'instagram' | 'tiktok' | 'facebook';
  mediaType: 'video' | 'image' | 'carousel';
  shortcode: string;
  existingCaption?: string;
}

interface CaptionResult {
  caption: string;
  hashtags: string[];
}

// AI service configuration
const AI_SERVICE = process.env.AI_SERVICE || 'gemini'; // gemini | grok | ollama | openai
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GROK_API_KEY = process.env.GROK_API_KEY || '';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gpt-oss:120b';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Unified AI caption generation entry point
async function generateCaption(req: CaptionRequest): Promise<CaptionResult> {
  const { platform, mediaType, shortcode, existingCaption } = req;

  const context = `
    You are a professional social media content strategist.
    Generate an engaging ${platform} post caption for the following media. Do NOT use markdown, bold, or asterisks.
    Platform: ${platform}
    Media type: ${mediaType || 'video'}
    Shortcode: ${shortcode}
    ${existingCaption ? `Existing caption (use as context, enhance/rewrite it naturally): "${existingCaption}"` : 'No existing caption available.'}

    Requirements:
    - Write a natural, conversational, engaging caption (3-6 sentences max).
    - The tone must fit ${platform} (Instagram: aesthetic/inspirational; TikTok: casual/trendy; Facebook: community/friendly).
    - End the caption with a call-to-action.
    - Then on a NEW line, list 5-12 relevant hashtags, each separated by a space, prefixed with #.
    - Do not include any other text, labels, or explanations.
  `;

  // Try configured AI service first, then fall back through others
  const attempts: Array<() => Promise<CaptionResult>> = [];

  if (AI_SERVICE === 'gemini') {
    attempts.push(() => generateWithGemini(context, platform));
    if (GROK_API_KEY) attempts.push(() => generateWithGrok(context, platform));
    if (OLLAMA_BASE_URL) attempts.push(() => generateWithOllama(context, platform));
  } else if (AI_SERVICE === 'grok') {
    attempts.push(() => generateWithGrok(context, platform));
    if (GEMINI_API_KEY) attempts.push(() => generateWithGemini(context, platform));
    if (OLLAMA_BASE_URL) attempts.push(() => generateWithOllama(context, platform));
  } else if (AI_SERVICE === 'ollama') {
    attempts.push(() => generateWithOllama(context, platform));
    if (GEMINI_API_KEY) attempts.push(() => generateWithGemini(context, platform));
  }

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result && result.caption) return result;
    } catch (err) {
      console.warn(`[CAPTION-GEN] AI provider failed: ${err}`);
    }
  }

  // Deterministic fallback when no AI is reachable
  return fallbackCaption(platform, mediaType, shortcode);
}

/**
* Generate caption using Google Gemini 2.5 Flash API
*/
async function generateWithGemini(context: string, platform: string): Promise<CaptionResult> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: context }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 600 }
    })
  });

  if (!res.ok) throw new Error(`Gemini API error ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseCaptionResult(text, platform);
}

/**
* Generate caption using xAI Grok API
*/
async function generateWithGrok(context: string, platform: string): Promise<CaptionResult> {
  if (!GROK_API_KEY) throw new Error('GROK_API_KEY not set');
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'grok-2-1212',
      messages: [{ role: 'user', content: context }],
      temperature: 0.8,
      max_tokens: 600
    })
  });

  if (!res.ok) throw new Error(`Grok API error ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return parseCaptionResult(text, platform);
}

/**
* Generate caption using local Ollama server (supports open-source models like GPT-OSS 120B)
*/
async function generateWithOllama(context: string, platform: string): Promise<CaptionResult> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: context }],
      stream: false
    })
  });

  if (!res.ok) throw new Error(`Ollama API error ${res.status}`);
  const data = await res.json();
  const text = data?.message?.content || '';
  return parseCaptionResult(text, platform);
}

/**
* Parse raw AI text into structured caption + hashtags
*/
function parseCaptionResult(text: string, platform: string): CaptionResult {
  if (!text) throw new Error('Empty AI response');

  // Extract hashtags from anywhere in the text
  const hashtagMatches = text.match(/#([A-Za-z0-9_]+)/g) || [];
  const hashtags = hashtagMatches.map(h => h.replace(/^#/, ''));

  // Remove hashtag-only lines and hashtag tokens to build clean caption
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^[#>*-]|^hashtags?:?$/i.test(l) && !/^#/.test(l));

  let caption = lines.join(' ');
  // Strip stray #tokens left inside the caption text
  caption = caption.replace(/#[A-Za-z0-9_]+/g, '').replace(/\s+/g, ' ').trim();

  // Clean hashtags (lowercase except useful ones, dedupe, cap at 12)
  const cleaned: string[] = [];
  for (const tag of hashtags) {
    const t = tag.toLowerCase();
    if (!cleaned.includes(t) && t.length > 1) cleaned.push(t);
    if (cleaned.length >= 12) break;
  }

  if (!caption) caption = platform === 'tiktok' ? 'New TikTok post' : `New ${platform} post`;
  if (cleaned.length === 0) return fallbackCaption(platform, 'video', '');
  return { caption, hashtags: cleaned };
}

/**
* Deterministic fallback caption when no AI provider is available/reachable
*/
function fallbackCaption(platform: string, mediaType: string, shortcode: string): CaptionResult {
  const presetCaptions: Record<string, string> = {
    instagram: `✨ New post! Check out this ${mediaType === 'video' ? 'video' : 'photo'}. What do you think? Drop a comment below!`,
    tiktok: `🎬 POV: this ${mediaType === 'video' ? 'video' : 'content'} hits different. Watch till the end!`,
    facebook: `📢 Just shared a new ${mediaType}. Let us know your thoughts in the comments!`
  };

  const presetTags: Record<string, string[]> = {
    instagram: ['instagood', 'photooftheday', 'reels', 'explore', 'viral', 'trending', 'instagram'],
    tiktok: ['fyp', 'foryou', 'viral', 'trending', 'tiktok', 'reels'],
    facebook: ['facebook', 'viral', 'trending', 'justposted']
  };

  const caption = shortcode
    ? `${presetCaptions[platform]} #${shortcode}`
    : presetCaptions[platform];

  return { caption, hashtags: presetTags[platform] || ['post'] };
}

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

// ==========================================
// SCHEDULER STATE
// ==========================================

interface ScheduledItem {
  id: string;
  shortcode: string;
  platform: 'instagram' | 'tiktok' | 'facebook';
  mediaUrl: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  caption?: string;
  type?: 'video' | 'image' | 'carousel';
  scheduledAt: number; // timestamp when next post should happen
  postedCount: number; // how many times this item has been posted
  cyclePosition: number; // position in cycle (0, 1, 2 for 3-item cycle)
  lastPostedAt?: number;
  gapAfterMs: number; // gap in ms after this post before next
  randomOffsetMs: number; // random offset for next scheduling
  // Platform-specific targeting
  targetPage?: string; // For Facebook: page ID/name; For IG: username
  platformSelect?: 'all' | 'instagram' | 'tiktok' | 'facebook'; // For half-half posting
  // Progress tracking (optional - set during posting)
  progress?: {
    percentage: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    error?: string;
    lastUpdate: number;
  };
}

interface SchedulerState {
  items: Map<string, ScheduledItem>;
  nextCyclePosition: number; // for cycle detection
  platformStats: {
    instagram: { posted: number; failed: number };
    tiktok: { posted: number; failed: number };
    facebook: { posted: number; failed: number };
  };
  config: {
    defaultGapMs: number; // default gap between posts
    maxCycleSize: number; // cycle size (3 means after 3 posts repeat)
    randomJitterMs: number; // random offset range
  };
  connectedPages: {          // Connected page accounts (real credentials)
    instagram: {
      username: string;
      igUserId?: string;
      accessToken?: string;
      expiresAt?: number;
      connected?: boolean;
    };
    tiktok: {
      openId?: string;
      username?: string;
      clientKey?: string;
      clientSecret?: string;
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
      connected?: boolean;
    };
    facebook: {
      pageId: string;
      pageName: string;
      accessToken?: string;
      expiresAt?: number;
      connected?: boolean;
    };
  };
}

// In-memory scheduler state (in production, use Redis or database)
const schedulerState: SchedulerState = {
  items: new Map(),
  nextCyclePosition: 0,
  platformStats: {
    instagram: { posted: 0, failed: 0 },
    tiktok: { posted: 0, failed: 0 },
    facebook: { posted: 0, failed: 0 }
  },
  config: {
    defaultGapMs: 60 * 60 * 1000, // 1 hour default gap
    maxCycleSize: 3,
    randomJitterMs: 30 * 60 * 1000 // 30 min jitter
  },
  connectedPages: {
    instagram: { username: '', igUserId: '', accessToken: '', expiresAt: 0 },
    tiktok: { openId: '', username: '', clientKey: '', clientSecret: '', accessToken: '', refreshToken: '', expiresAt: 0 },
    facebook: { pageId: '', pageName: '', accessToken: '', expiresAt: 0 }
  }
};

// ==========================================
// REAL PLATFORM INTEGRATIONS
// ==========================================

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Loose accessor for a platform connection (avoids union-type narrowing pain).
 */
function platformConn(platform: string): any {
  return (schedulerState.connectedPages as any)[platform] || {};
}

/**
 * Download media bytes from CDN/proxy URL (validates binary payload).
 */
async function downloadMediaBuffer(targetUrl: string): Promise<{ buffer: Buffer; mime: string }> {
  const res = await fetch(targetUrl, {
    headers: {
      "User-Agent": UA,
      "Referer": "https://www.instagram.com/",
      "Accept": "*/*",
    },
  });
  if (!res.ok) throw new Error(`Media fetch failed HTTP ${res.status} for ${targetUrl.substring(0, 80)}`);
  const mime = res.headers.get("content-type") || "application/octet-stream";
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (/text\/html|application\/json|text\/plain/i.test(mime)) {
    throw new Error(`Media endpoint returned non-media payload (${mime})`);
  }
  if (buffer.length < 2048) throw new Error(`Media payload too small (${buffer.length} bytes)`);
  return { buffer, mime };
}

/**
 * Pick the best direct media URL for an item (video first, then image).
 */
function pickMediaUrl(item: ScheduledItem): string {
  const candidates = [item.videoUrl, item.mediaUrl, item.thumbnailUrl].filter(Boolean) as string[];
  for (const url of candidates) {
    if (/\.mp4|bytestart|scontent|fbcdn|tiktokcdn|\.jpg|\.jpeg|\.png|candidate/i.test(url)) return url;
  }
  return candidates[0] || "";
}

/**
 * Post to Facebook Page via Graph API (real).
 * Video  -> POST /{page-id}/videos  (multipart upload)
 * Photo  -> POST /{page-id}/photos  (multipart upload)
 */
async function postToFacebook(item: ScheduledItem): Promise<{ success: boolean; error?: string; postId?: string }> {
  try {
    const fb = schedulerState.connectedPages.facebook;
    if (!fb.pageId || !fb.accessToken) {
      throw new Error("Facebook page not connected. Add your page access token in Options → Connected Pages.");
    }
    const mediaUrl = pickMediaUrl(item);
    if (!mediaUrl) throw new Error("No media URL available to publish");

    const { buffer, mime } = await downloadMediaBuffer(mediaUrl);
    const isVideo = item.type === "video" || /video|mp4|quicktime/i.test(mime);
    const filename = `media_${item.shortcode}.${isVideo ? "mp4" : "jpg"}`;
    const fieldName = isVideo ? "source" : "source";

    const form = new FormData();
    form.append(fieldName, new Blob([buffer], { type: isVideo ? "video/mp4" : mime }), filename);
    form.append("description", item.caption || "");
    form.append("access_token", fb.accessToken);

    const endpoint = isVideo
      ? `${GRAPH_API_BASE}/${fb.pageId}/videos`
      : `${GRAPH_API_BASE}/${fb.pageId}/photos`;

    const res = await fetch(endpoint, { method: "POST", body: form });
    const data: any = await res.json();
    if (!res.ok || data.error) {
      throw new Error(`Facebook Graph API: ${data.error?.message || res.statusText} (${res.status})`);
    }

    console.log(`[FB-PUBLISH] Post created: id=${data.id}`);
    return { success: true, postId: data.id };
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[FB-PUBLISH] Failed:`, err);
    return { success: false, error: message };
  }
}

/**
 * Post to Instagram via Instagram Graph API (real, requires IG Business/Professional linked to FB page).
 * Image/Video  -> POST /{ig-user-id}/media  (container) then /media_publish
 */
async function postToInstagram(item: ScheduledItem): Promise<{ success: boolean; error?: string; postId?: string }> {
  try {
    const ig = schedulerState.connectedPages.instagram;
    if (!ig.igUserId || !ig.accessToken) {
      throw new Error("Instagram not connected. Connect your Instagram Business account (via Facebook) first.");
    }
    const mediaUrl = pickMediaUrl(item);
    if (!mediaUrl) throw new Error("No media URL available to publish");

    const { buffer, mime } = await downloadMediaBuffer(mediaUrl);
    const isVideo = item.type === "video" || /video|mp4|quicktime/i.test(mime);
    const caption = (item.caption || "").slice(0, 2200); // IG caption limit

    // Step 1: Create media container
    const form = new FormData();
    form.append("media_type", isVideo ? "REELS" : "IMAGE");
    form.append(isVideo ? "video_url" : "image_url", mediaUrl);
    form.append("caption", caption);
    form.append("access_token", ig.accessToken);

    const containerRes = await fetch(`${GRAPH_API_BASE}/${ig.igUserId}/media`, {
      method: "POST",
      body: form,
    });
    const containerData: any = await containerRes.json();
    if (!containerRes.ok || containerData.error) {
      throw new Error(`Instagram Graph API (container): ${containerData.error?.message || containerRes.statusText} (${containerRes.status})`);
    }
    const containerId = containerData.id;

    // Step 2: Poll container status until FINISHED
    let status = "IN_PROGRESS";
    for (let i = 0; i < 30 && status !== "FINISHED"; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(
        `${GRAPH_API_BASE}/${containerId}?fields=status_code&access_token=${encodeURIComponent(ig.accessToken)}`
      );
      const statusData: any = await statusRes.json();
      if (statusData.error) throw new Error(`Instagram Graph API (status): ${statusData.error.message}`);
      status = statusData.status_code || "IN_PROGRESS";
      if (status === "ERROR") throw new Error("Instagram rejected media container (status ERROR)");
    }
    if (status !== "FINISHED") throw new Error("Instagram container did not reach FINISHED in time");

    // Step 3: Publish container
    const publishRes = await fetch(`${GRAPH_API_BASE}/${ig.igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: containerId, access_token: ig.accessToken }),
    });
    const publishData: any = await publishRes.json();
    if (!publishRes.ok || publishData.error) {
      throw new Error(`Instagram Graph API (publish): ${publishData.error?.message || publishRes.statusText} (${publishRes.status})`);
    }

    console.log(`[IG-PUBLISH] Post published: id=${publishData.id}`);
    return { success: true, postId: publishData.id };
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[IG-PUBLISH] Failed:`, err);
    return { success: false, error: message };
  }
}

/**
 * Post to TikTok via TikTok Content Posting API (real, requires TikTok developer app).
 * Flow: POST /v2/post/publish/video/init/ (multipart upload) → poll status
 */
let tiktokPendingPublishes: Map<string, { publishId: string; pollCount: number }> = new Map();

async function postToTikTok(item: ScheduledItem): Promise<{ success: boolean; error?: string; publishId?: string }> {
  try {
    const tk = schedulerState.connectedPages.tiktok;
    if (!tk.accessToken) {
      throw new Error("TikTok not connected. Add your TikTok access token (developer app required) in Options → Connected Pages.");
    }
    const mediaUrl = pickMediaUrl(item);
    if (!mediaUrl) throw new Error("No media URL available to publish");

    const { buffer, mime } = await downloadMediaBuffer(mediaUrl);
    const isVideo = item.type === "video" || /video|mp4|quicktime/i.test(mime);
    if (!isVideo) {
      throw new Error("TikTok only supports video publishing via the Content Posting API");
    }

    // Step 1: Initialize publish (multipart video upload)
    const form = new FormData();
    form.append("video", new Blob([buffer], { type: "video/mp4" }), `video_${item.shortcode}.mp4`);
    form.append(
      "post_info",
      JSON.stringify({
        title: (item.caption || "Check this out!").slice(0, 2200),
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_duet: false,
        disable_stitch: false,
        disable_comment: false,
      })
    );

    const initRes = await fetch(`${TIKTOK_API_BASE}/post/publish/video/init/`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${tk.accessToken}` },
      body: form,
    });
    const initData: any = await initRes.json();
    if (!initRes.ok || initData.error) {
      throw new Error(`TikTok API (init): ${initData.error?.message || initData.error?.code || initRes.statusText} (${initRes.status})`);
    }
    const publishId = initData.data?.publish_id;
    if (!publishId) throw new Error("TikTok init did not return publish_id");

    // Step 2: Poll publish status (up to 3 min)
    let pollCount = 0;
    let finalStatus = "";
    while (pollCount < 20) {
      await new Promise(r => setTimeout(r, 10000));
      pollCount++;
      const statusRes = await fetch(`${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${tk.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ publish_id: publishId }),
      });
      const statusData: any = await statusRes.json();
      if (!statusRes.ok || statusData.error) {
        throw new Error(`TikTok API (status): ${statusData.error?.message || statusRes.statusText}`);
      }
      finalStatus = statusData.data?.status || "PROCESSING_UPLOAD";
      if (finalStatus === "PUBLISH_COMPLETE") break;
      if (finalStatus === "FAILED" || finalStatus === "PUBLISH_FAILED") {
        throw new Error(`TikTok publish failed: ${finalStatus} — ${JSON.stringify(statusData.data?.fail_reason || "")}`);
      }
    }
    if (finalStatus !== "PUBLISH_COMPLETE") {
      throw new Error("TikTok publish did not complete in time");
    }

    console.log(`[TT-PUBLISH] Publish complete: publishId=${publishId}`);
    return { success: true, publishId };
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[TT-PUBLISH] Failed:`, err);
    return { success: false, error: message };
  }
}

/**
 * Get the appropriate poster function for a platform
 */
function getPoster(platform: 'instagram' | 'tiktok' | 'facebook') {
  switch (platform) {
    case 'instagram': return postToInstagram;
    case 'tiktok': return postToTikTok;
    case 'facebook': return postToFacebook;
  }
}

/**
 * Calculate next scheduled time with gap and random jitter
 */
function calculateNextScheduledTime(
  currentTime: number,
  gapAfterMs: number,
  randomJitterMs: number,
  cyclePosition: number,
  maxCycleSize: number
): number {
  // Base gap after post
  const baseDelay = gapAfterMs;
  
  // Random offset to avoid pattern detection
  const randomOffset = Math.floor(Math.random() * randomJitterMs);
  
  // Cycle-based adjustment (simple example: space out cycle positions)
  const cycleAdjustment = (cyclePosition * 15 * 60 * 1000); // 15min per cycle position
  
  return currentTime + baseDelay + randomOffset + cycleAdjustment;
}

// ==========================================
// API ENDPOINTS
// ==========================================

/**
 * POST /api/schedule/add - Add media to publish queue
 */
app.post("/api/schedule/add", (req, res) => {
  try {
    const {
      id,
      shortcode,
      platform,
      mediaUrl,
      thumbnailUrl,
      caption,
      type,
      gapAfterMs = schedulerState.config.defaultGapMs,
      randomOffsetMs = schedulerState.config.randomJitterMs
    } = req.body;

    if (!id || !shortcode || !platform || !mediaUrl) {
      return res.status(400).json({ error: "Missing required fields: id, shortcode, platform, mediaUrl" });
    }

    if (!['instagram', 'tiktok', 'facebook'].includes(platform)) {
      return res.status(400).json({ error: "Invalid platform. Must be: instagram, tiktok, or facebook" });
    }

    const newItem: ScheduledItem = {
      id,
      shortcode,
      platform,
      mediaUrl,
      thumbnailUrl,
      caption,
      type,
      scheduledAt: Date.now() + gapAfterMs, // schedule first post after gap
      postedCount: 0,
      cyclePosition: schedulerState.nextCyclePosition,
      gapAfterMs,
      randomOffsetMs
    };

    schedulerState.items.set(id, newItem);
    
    // Advance cycle position for next item
    schedulerState.nextCyclePosition = (schedulerState.nextCyclePosition + 1) % schedulerState.config.maxCycleSize;

    console.log(`[SCHEDULER] Added item to queue: ${shortcode} on ${platform}`);
    
    res.json({ 
      success: true, 
      itemId: id,
      message: "Item added to publishing queue",
      scheduledAt: newItem.scheduledAt
    });
  } catch (err) {
    console.error("[SCHEDULER] Error adding item:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/caption/generate - Generate AI caption + hashtags for a post
 */
app.post("/api/caption/generate", async (req, res) => {
  try {
    const { platform, mediaType, shortcode, existingCaption } = req.body;

    if (!['instagram', 'tiktok', 'facebook'].includes(platform)) {
      return res.status(400).json({ error: "Invalid platform. Must be: instagram, tiktok, facebook" });
    }
    if (!shortcode) {
      return res.status(400).json({ error: "shortcode is required" });
    }

    const result = await generateCaption({
      platform,
      mediaType: mediaType || 'video',
      shortcode,
      existingCaption
    });

    res.json({
      success: true,
      caption: result.caption,
      hashtags: result.hashtags,
      hashtagString: result.hashtags.map(h => `#${h}`).join(' ')
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/schedule/add-with-caption - Add media to queue, auto-generating caption+hashtags
 */
app.post("/api/schedule/add-with-caption", async (req, res) => {
  try {
    const {
      id,
      shortcode,
      platform,
      mediaUrl,
      thumbnailUrl,
      type,
      gapAfterMs = schedulerState.config.defaultGapMs,
      randomOffsetMs = schedulerState.config.randomJitterMs,
      targetPage,
      platformSelect,
      existingCaption,
      generateCaptionAI = true
    } = req.body;

    if (!id || !shortcode || !platform || !mediaUrl) {
      return res.status(400).json({ error: "Missing required fields: id, shortcode, platform, mediaUrl" });
    }
    if (!['instagram', 'tiktok', 'facebook'].includes(platform)) {
      return res.status(400).json({ error: "Invalid platform. Must be: instagram, tiktok, facebook" });
    }

    let caption = existingCaption;
    let hashtags: string[] = [];
    let captionSource = 'provided';

    if (generateCaptionAI && !caption) {
      try {
        const result = await generateCaption({ platform, mediaType: type || 'video', shortcode, existingCaption });
        caption = result.caption;
        hashtags = result.hashtags;
        captionSource = 'ai';
      } catch (e) {
        console.warn(`[SCHEDULER] AI caption generation failed for ${shortcode}, using fallback:`, e);
        const fb = fallbackCaption(platform, type || 'video', shortcode);
        caption = fb.caption;
        hashtags = fb.hashtags;
        captionSource = 'fallback';
      }
    }

    // Append hashtags to caption if generated
    const fullCaption = captionSource !== 'provided' && hashtags.length > 0
      ? `${caption}\n\n${hashtags.map(h => `#${h}`).join(' ')}`
      : caption;

    const newItem: ScheduledItem = {
      id,
      shortcode,
      platform,
      mediaUrl,
      thumbnailUrl,
      caption: fullCaption,
      type,
      scheduledAt: Date.now() + gapAfterMs,
      postedCount: 0,
      cyclePosition: schedulerState.nextCyclePosition,
      gapAfterMs,
      randomOffsetMs,
      targetPage,
      platformSelect,
      progress: {
        percentage: 0,
        status: 'pending',
        lastUpdate: Date.now()
      }
    };

    schedulerState.items.set(id, newItem);
    schedulerState.nextCyclePosition = (schedulerState.nextCyclePosition + 1) % schedulerState.config.maxCycleSize;

    console.log(`[SCHEDULER] Added item with ${captionSource} caption: ${shortcode} on ${platform}`);

    res.json({
      success: true,
      itemId: id,
      caption: fullCaption,
      hashtags,
      captionSource,
      message: "Item added with AI-generated caption",
      scheduledAt: newItem.scheduledAt
    });
  } catch (err) {
    console.error("[SCHEDULER] Error adding item with caption:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/schedule/status - Get scheduler status
 */
app.get("/api/schedule/status", (req, res) => {
  res.json({
    success: true,
    queueSize: schedulerState.items.size,
    config: schedulerState.config,
    platformStats: schedulerState.platformStats,
    activeItems: Array.from(schedulerState.items.values()).map(item => ({
      id: item.id,
      shortcode: item.shortcode,
      platform: item.platform,
      scheduledAt: item.scheduledAt,
      postedCount: item.postedCount,
      cyclePosition: item.cyclePosition,
      lastPostedAt: item.lastPostedAt
    }))
  });
});

/**
 * POST /api/schedule/remove - Remove item from queue
 */
app.post("/api/schedule/remove", (req, res) => {
  try {
    const { itemId } = req.body;
    const removed = schedulerState.items.delete(itemId);
    
    res.json({ 
      success: removed, 
      message: removed ? "Item removed from queue" : "Item not found in queue"
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/schedule/clear - Clear all scheduled items
 */
app.post("/api/schedule/clear", (req, res) => {
  schedulerState.items.clear();
  schedulerState.nextCyclePosition = 0;
  res.json({ success: true, message: "Scheduler queue cleared" });
});

/**
 * POST /api/schedule/trigger-now - Manually trigger next post
 */
app.post("/api/schedule/trigger-now", async (req, res) => {
  try {
    const { platform } = req.body || {};
    
    // Find the next eligible item for this platform ('all' matches any)
    let nextItem: ScheduledItem | null = null;
    let nextEarliestTime = Infinity;
    
    for (const item of schedulerState.items.values()) {
      if (platform && platform !== 'all' && item.platform !== platform) continue;
      if (item.scheduledAt < nextEarliestTime) {
        nextEarliestTime = item.scheduledAt;
        nextItem = item;
      }
    }
    
    if (!nextItem) {
      return res.json({ success: false, message: "No scheduled items in queue" });
    }
    
    // Check platform connectivity before posting
    const targetPlatform = nextItem.platform;
    const conn = platformConn(targetPlatform);
    const connected = !!conn?.connected || !!(conn?.accessToken || conn?.pageId || conn?.igUserId);

    if (!connected) {
      return res.json({
        success: false,
        message: `${targetPlatform} not connected. Add credentials in Options → Connected Pages first.`,
        needsConnection: true
      });
    }
    
    // Execute posting now
    const poster = getPoster(nextItem.platform);
    const result = await poster(nextItem);
    
    if (result.success) {
      nextItem.postedCount++;
      nextItem.cyclePosition = (nextItem.cyclePosition + 1) % schedulerState.config.maxCycleSize;
      nextItem.lastPostedAt = Date.now();
      nextItem.scheduledAt = Date.now() + nextItem.gapAfterMs + nextItem.randomOffsetMs;
      nextItem.progress = { percentage: 100, status: 'completed', lastUpdate: Date.now() };
      schedulerState.platformStats[targetPlatform].posted++;
    } else {
      nextItem.progress = { percentage: 0, status: 'failed', error: result.error, lastUpdate: Date.now() };
      nextItem.scheduledAt = Date.now() + 10 * 60 * 1000;
      schedulerState.platformStats[targetPlatform].failed++;
    }
    
    return res.json({
      success: result.success,
      itemId: nextItem.id,
      shortcode: nextItem.shortcode,
      platform: targetPlatform,
      postId: (result as any).postId || (result as any).publishId,
      message: result.success ? "Posting completed" : `Posting failed: ${result.error}`
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/schedule/connect-page - Connect a page account for a platform (real credentials)
 */
app.post("/api/schedule/connect-page", (req, res) => {
  try {
    const {
      platform,
      pageId, pageName, accessToken, expiresAt,
      igUserId, username,
      openId, clientKey, clientSecret, refreshToken, tiktokUsername
    } = req.body;

    if (!['instagram', 'tiktok', 'facebook'].includes(platform)) {
      return res.status(400).json({ error: "Invalid platform" });
    }

    if (!accessToken && platform === 'facebook') {
      return res.status(400).json({ error: "Facebook requires an accessToken (Page access token)" });
    }

    if (platform === 'instagram') {
      if (!igUserId || !accessToken) {
        return res.status(400).json({ error: "Instagram requires igUserId and accessToken (IG Business via Facebook Graph)" });
      }
      schedulerState.connectedPages.instagram = {
        username: username || pageId || '',
        igUserId,
        accessToken,
        expiresAt: expiresAt ? Date.now() + expiresAt * 1000 : 0,
        connected: true
      };
    } else if (platform === 'tiktok') {
      if (!accessToken) {
        return res.status(400).json({ error: "TikTok requires accessToken (Content Posting API)" });
      }
      schedulerState.connectedPages.tiktok = {
        openId: openId || '',
        username: tiktokUsername || '',
        clientKey: clientKey || '',
        clientSecret: clientSecret || '',
        accessToken,
        refreshToken: refreshToken || '',
        expiresAt: expiresAt ? Date.now() + expiresAt * 1000 : 0,
        connected: true
      };
    } else if (platform === 'facebook') {
      if (!pageId) {
        return res.status(400).json({ error: "Facebook requires pageId" });
      }
      schedulerState.connectedPages.facebook = {
        pageId,
        pageName: pageName || pageId,
        accessToken,
        expiresAt: expiresAt ? Date.now() + expiresAt * 1000 : 0,
        connected: true
      };
    }

    console.log(`[SCHEDULER] Connected ${platform} page: ${pageId || username || igUserId || openId || ''}`);
    
    res.json({ success: true, message: "Page connected successfully" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/schedule/disconnect-page - Remove a platform connection
 */
app.post("/api/schedule/disconnect-page", (req, res) => {
  try {
    const { platform } = req.body;
    if (!['instagram', 'tiktok', 'facebook'].includes(platform)) {
      return res.status(400).json({ error: "Invalid platform" });
    }
    schedulerState.connectedPages[platform] = {
      instagram: { username: '' },
      tiktok: { openId: '' },
      facebook: { pageId: '', pageName: '' },
    }[platform] as any;
    res.json({ success: true, message: `Disconnected ${platform}` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/schedule/disconnected-pages - Get connected page accounts
 */
app.get("/api/schedule/disconnected-pages", (req, res) => {
  res.json({
    success: true,
    connectedPages: schedulerState.connectedPages
  });
});

/**
 * GET /api/schedule/connection-status - Which platforms are ready to publish
 */
app.get("/api/schedule/connection-status", (req, res) => {
  const status: Record<string, { connected: boolean; needs: string[] }> = {};
  for (const platform of ['instagram', 'tiktok', 'facebook'] as const) {
    const c = platformConn(platform);
    const connected = !!(c?.connected && (c.accessToken || c.pageId || c.igUserId));
    status[platform] = {
      connected,
      needs: connected
        ? []
        : platform === 'facebook'
          ? ['Page access token', 'Page ID']
          : platform === 'instagram'
            ? ['IG user ID', 'FB access token with instagram_basic']
            : ['TikTok access token', 'Client Key/Secret']
    };
  }
  res.json({ success: true, status });
});

/**
 * POST /api/schedule/test-connection - Verify a platform connection with a lightweight API call
 */
app.post("/api/schedule/test-connection", async (req, res) => {
  try {
    const { platform } = req.body;
    if (!['instagram', 'tiktok', 'facebook'].includes(platform)) {
      return res.status(400).json({ error: "Invalid platform" });
    }

    if (platform === 'facebook') {
      const fb = schedulerState.connectedPages.facebook;
      if (!fb.accessToken || !fb.pageId) throw new Error("Not connected");
      const r = await fetch(`${GRAPH_API_BASE}/${fb.pageId}?fields=name,id&access_token=${encodeURIComponent(fb.accessToken)}`);
      const d: any = await r.json();
      if (d.error) throw new Error(`Facebook: ${d.error.message}`);
      return res.json({ success: true, message: `Facebook OK — page: ${d.name || fb.pageName}` });
    }

    if (platform === 'instagram') {
      const ig = schedulerState.connectedPages.instagram;
      if (!ig.accessToken || !ig.igUserId) throw new Error("Not connected");
      const r = await fetch(`${GRAPH_API_BASE}/${ig.igUserId}?fields=username&access_token=${encodeURIComponent(ig.accessToken)}`);
      const d: any = await r.json();
      if (d.error) throw new Error(`Instagram: ${d.error.message}`);
      return res.json({ success: true, message: `Instagram OK — @${d.username || ig.username}` });
    }

    if (platform === 'tiktok') {
      const tk = schedulerState.connectedPages.tiktok;
      if (!tk.accessToken) throw new Error("Not connected");
      const r = await fetch(`${TIKTOK_API_BASE}/user/info/?fields=open_id,union_id,avatar_url,display_name`, {
        headers: { "Authorization": `Bearer ${tk.accessToken}` }
      });
      const d: any = await r.json();
      if (d.error) throw new Error(`TikTok: ${d.error.message || d.error.code}`);
      const info = d.data?.user;
      return res.json({ success: true, message: `TikTok OK — @${info?.display_name || tk.username || 'user'}` });
    }
  } catch (err) {
    return res.status(400).json({ success: false, error: (err as Error).message });
  }
});

/**
 * POST /api/schedule/update-progress - Update progress on a scheduled item
 */
app.post("/api/schedule/update-progress", (req, res) => {
  try {
    const { itemId, percentage, status, error } = req.body;
    
    const item = schedulerState.items.get(itemId);
    if (!item) {
      return res.status(404).json({ error: "Item not found" });
    }
    
    item.progress = {
      percentage,
      status: status || 'pending',
      error: error,
      lastUpdate: Date.now()
    };
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/schedule/dashboard - Get full dashboard status
 */
app.get("/api/schedule/dashboard", (req, res) => {
  const activeItems = Array.from(schedulerState.items.values()).map(item => ({
    id: item.id,
    shortcode: item.shortcode,
    platform: item.platform,
    targetPage: item.targetPage,
    platformSelect: item.platformSelect,
    scheduledAt: item.scheduledAt,
    postedCount: item.postedCount,
    cyclePosition: item.cyclePosition,
    progress: item.progress,
    gapAfterMs: item.gapAfterMs,
    randomOffsetMs: item.randomOffsetMs
  }));
  
  res.json({
    success: true,
    queueSize: schedulerState.items.size,
    config: schedulerState.config,
    platformStats: schedulerState.platformStats,
    connectedPages: schedulerState.connectedPages,
    activeItems: activeItems
  });
});

/**
 * POST /api/schedule/config - Update scheduler config (gap, cycle size, jitter)
 */
app.post("/api/schedule/config", (req, res) => {
  try {
    const { defaultGapMs, maxCycleSize, randomJitterMs } = req.body || {};
    if (typeof defaultGapMs === "number" && defaultGapMs >= 0) {
      schedulerState.config.defaultGapMs = defaultGapMs;
    }
    if (typeof maxCycleSize === "number" && maxCycleSize >= 1 && maxCycleSize <= 100) {
      schedulerState.config.maxCycleSize = maxCycleSize;
      schedulerState.nextCyclePosition = schedulerState.nextCyclePosition % maxCycleSize;
    }
    if (typeof randomJitterMs === "number" && randomJitterMs >= 0) {
      schedulerState.config.randomJitterMs = randomJitterMs;
    }
    console.log("[SCHEDULER] Config updated:", schedulerState.config);
    res.json({ success: true, config: schedulerState.config });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ==========================================
// CRON SCHEDULER JOB
// ==========================================

/**
 * Run scheduled posts - this would be called by a cron job
 * In production, this would be set up via system cron or a cron library
 */
function runScheduledPosts() {
  const now = Date.now();
  const posted: string[] = [];
  
  for (const item of schedulerState.items.values()) {
    if (!item) continue;
    
    const platform = item.platform;
    const connected = platformConn(platform)?.connected ||
      !!(platformConn(platform)?.accessToken ||
         platformConn(platform)?.pageId ||
         platformConn(platform)?.igUserId);

    // If platform not connected, reschedule the item instead of erroring
    if (!connected) {
      const retryMs = 5 * 60 * 1000; // retry in 5 minutes
      item.scheduledAt = now + retryMs;
      item.progress = {
        percentage: 0,
        status: 'pending',
        error: `${platform} not connected — waiting for credentials`,
        lastUpdate: now
      };
      console.warn(`[CRON] ${item.shortcode} skipped: ${platform} not connected. Retry in 5min.`);
      continue;
    }
    
    // Check if it's time to post this item
    if (item.scheduledAt <= now) {
      const poster = getPoster(item.platform);
      poster(item).then(result => {
        if (result.success) {
          item.postedCount++;
          item.cyclePosition = (item.cyclePosition + 1) % schedulerState.config.maxCycleSize;
          item.lastPostedAt = Date.now();
          item.scheduledAt = Date.now() + item.gapAfterMs + item.randomOffsetMs;
          item.progress = {
            percentage: 100,
            status: 'completed',
            lastUpdate: Date.now()
          };
          schedulerState.platformStats[platform].posted++;
          posted.push(item.id);
          console.log(`[CRON] Successfully posted: ${item.shortcode} (${platform})`);
        } else {
          item.progress = {
            percentage: 0,
            status: 'failed',
            error: result.error || 'Unknown error',
            lastUpdate: Date.now()
          };
          // Reschedule retry in 10 minutes (avoid tight error loops)
          item.scheduledAt = Date.now() + 10 * 60 * 1000;
          schedulerState.platformStats[platform].failed++;
          console.warn(`[CRON] Failed to post: ${item.shortcode} (${platform}) - ${result.error}`);
        }
      });
    }
  }
  
  console.log(`[CRON] Scheduler check: ${posted.length} items posted, ${schedulerState.items.size} total in queue`);
  
  return posted;
}

// Initialize cron-like scheduling
// In production, use: setInterval(runScheduledPosts, 30 * 1000) or a cron library
// For now, we'll set a 30-second interval for demonstration
setInterval(runScheduledPosts, 30 * 1000);

console.log("[SCHEDULER] Scheduler initialized with 30-second check interval");

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
