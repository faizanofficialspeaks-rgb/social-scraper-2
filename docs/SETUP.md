# Setup Guide

Everything you need to configure SocialScraper for production use.

---

## 1. GEMINI_API_KEY (AI Captions)

AI caption generation is **optional**. Without the key, the Stage panel shows the AI Caption button disabled with "(no key)" — template captions and manual editing still work.

1. Go to https://aistudio.google.com/apikey and create a key (free tier available).
2. Add it to your server environment:

   - **Local:** create/edit `.env` in the project root:
     ```
     GEMINI_API_KEY=your_key_here
     GEMINI_MODEL=gemini-2.5-flash
     ```
   - **Render.com:** add `GEMINI_API_KEY` to the service's Environment variables (already declared in `render.yaml`).

3. Restart the server. The Stage panel button enables immediately.

## 2. Scheduling Configuration

The unified Queue panel lets you control daily publishing limits and time windows. Settings live in `.scheduling-config.json` (created on first run) and are editable from the Queue → "Scheduling settings" form:

| Setting | Default | Meaning |
| --- | --- | --- |
| `maxPostsPerDay` | 10 | Max posts pushed per day (excess rolls to tomorrow at window start) |
| `maxReelsPerDay` | 5 | Max reels per day (same rollover) |
| `windowStart` | 09:00 | Daily publishing window start (HH:mm, server timezone) |
| `windowEnd` | 21:00 | Daily publishing window end |
| `intervalMinutes` | 30 | Min gap between auto-scheduled posts |
| `jitterMinutes` | 5 | Random jitter added to each slot (±) |
| `sameAsYesterdayOffsetMinutes` | 10 | Offset applied by "Same as Yesterday" |

**Per-item mode:** Auto (slot within the window, caps enforced) or Manual (exact `scheduledAt` you set inline in the queue table).

**"Same as Yesterday"** button copies yesterday's schedule pattern onto today using the configured offset.

## 3. Connecting Accounts

- **Instagram:** use the app's Google sign-in (the active Google account is used). The Queue panel shows the connected account.
- **Facebook:** Generate a Page Access Token (your own page — no app review needed):
  1. Open https://developers.facebook.com/tools/explorer
  2. Pick the "SocialScraper" app, add `pages_manage_posts`, `pages_read_engagement`, `publish_video`
  3. Get User Token → "Get Page Access Token" → choose your page (e.g. Alphaburx)
  4. Paste it in the Queue panel → Facebook card → Save.

## 4. Supabase (Accounts & Credits)

- Run `supabase/migrations/002_duplicate_and_bonus_guard.sql` in the SQL Editor (`https://supabase.com/dashboard/project/qclirsmxndgvuestzmwa/sql`).
- `.env`: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public) and `SUPABASE_SERVICE_ROLE_KEY` (server-only — keep secret, never expose client-side).

## 5. Production Run

```
npm run build      # bundles UI + server (dist/)
set NODE_ENV=production
set PORT=3010
node dist/server.cjs
```

## 6. Env Reference

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | – | HTTP port (default 3010) |
| `SUPABASE_URL` | ✓ | Supabase project URL |
| `SUPABASE_ANON_KEY` | ✓ | Public key (client) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Service-role key (server) — rotate if ever exposed |
| `GOOGLE_CLIENT_ID` | ✓ | Google OAuth client |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | – | AI captions (optional) |
| `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` | – | FB token exchange |
