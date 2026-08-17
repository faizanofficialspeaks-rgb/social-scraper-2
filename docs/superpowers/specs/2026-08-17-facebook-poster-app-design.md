# Facebook Poster App — Design Spec

**Date:** 2026-08-17
**Status:** Approved (design review)
**Owner:** SocialScraper project

## Objective

Split the current monolith: the main app becomes a **pure scraper/downloader**, and all Facebook posting moves to a **new, extremely simple web app** ("Easy FB Poster") hosted on **Koyeb free tier**, with state in **Supabase (free)**.

User workflow (from product owner):

> User scrapes with the extension → downloads a ZIP → extracts it into a clean folder → opens the poster app → drops the folder → videos are queued with captions auto-imported from `metadata.json` → scheduled posts run 24/7 from the cloud even when the PC is off → re-uploading the same folder can never create duplicates.

## Non-Goals

- No Instagram/TikTok posting in the new app (FB only — confirmed with owner).
- No AI caption generation in the new app.
- No credits system in the new app.
- No extension changes.

## Architecture

```
posting-app/                    (new, separate service)
  server.cjs                    Express: static UI + API + FB engine + scheduler
  public/index.html             single-page UI (plain HTML/JS/CSS, no build step)
  public/app.js
  public/style.css
  koyeb.yaml                    Koyeb free service definition
  package.json                  express, multer, @supabase/supabase-js
  migrations/003_posting.sql    (shared supabase/migrations/003_posting.sql)
```

- **Hosting:** Koyeb free instance (512 MB RAM / 0.1 vCPU / 2 GB SSD). Keep-alive ping every 30–50 min from cron-job.org (free) so the instance never scales to zero.
- **State:** Supabase Postgres (free). Queue, dedup registry, FB session. Survives any redeploy/restart.
- **Files:** uploaded via browser (multer) to ephemeral disk → posted → deleted. No long-term file storage.
- **Runtime:** Node only. No Python. Plain static frontend (no Vite/React) to keep footprint tiny and deploys instant.
- Both apps live in the same repo. Scraper app keeps its `render.yaml`; poster app gets `posting-app/koyeb.yaml`.

## Data Model (Supabase, migration 003)

Add to existing `profiles` table (reuse): columns `fb_user_token`, `fb_page_id`, `fb_page_name` (text).

New table `post_queue`:

```sql
create table if not exists public.post_queue (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  file_hash     text not null,                    -- sha256 of file content
  file_name     text not null,
  caption       text default '',
  scheduled_for timestamptz not null,             -- post time (now() = immediate)
  status        text not null default 'queued',   -- queued|processing|posted|failed|duplicate
  fb_post_id    text,
  error         text,
  retry_count   int not null default 0,
  created_at    timestamptz not null default now(),
  posted_at     timestamptz,
  unique (user_id, file_hash)                     -- hard dedup guarantee
);
create index if not exists post_queue_due_idx on public.post_queue (user_id, status, scheduled_for);
```

Dedup = unique `(user_id, file_hash)`. Re-upload of an already-posted (or already-queued) file hits the constraint; the UI marks it "Already posted/queued" instead of erroring.

## Posting App UI (single page, dead simple)

Sections, top to bottom:

1. **Header** — app name, login/logout (Google via Supabase, same accounts as scraper app).
2. **Facebook Connect card**
   - Input for FB Page Token (or user token — auto-converts via `/me/accounts`, same logic as scraper app fix).
   - Page dropdown (when multiple pages), shows connected page name + green "Connected ✓" chip.
   - Token saved to `profiles` in Supabase → survives restarts/redeploys forever.
3. **Upload zone** — drag & drop or browse: folder or files (mp4 only). Shows friendly validation errors.
4. **Queue list** — one row per video:
   - preview thumbnail (poster frame via `<video>`), filename, caption (auto from `metadata.json` if present — matched by filename, editable), time picker (default "Post Now"), per-row **Post Now** button.
   - Status chips: Queued (time) / Posted ✓ / Failed ✗ (with error text) / Duplicate (greyed).
   - Bulk buttons: **"Sab Post Karo"** (post all immediately), delete row.
5. **Error display** — inline friendly messages; no crash states.

No settings page, no scheduling config page, no analytics.

## Server API (posting-app/server.cjs)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | health + keep-alive target |
| POST | `/api/fb/connect` | validate token, auto page-token convert, save to profile |
| POST | `/api/upload` | multipart upload (multer); parse any `metadata.json`; insert queue rows; hash files (sha256) |
| GET | `/api/queue` | list user's queue with statuses |
| POST | `/api/queue/:id/now` | post immediately |
| PATCH | `/api/queue/:id/schedule` | change scheduled_for |
| DELETE | `/api/queue/:id` | remove (only queued) |
| GET | `/api/auth/validate-token` | (optional) parity with scraper app token gate |

Auth: Supabase JWT (Bearer) — service-role key used server-side for writes.

## FB Posting Engine

Reuse the verified `video_reels` 3-phase flow from scraper app `server.ts`:

1. `POST /{page_id}/video_reels` with `upload_phase=start`, `video_file_size`, `access_token`
2. `POST {upload_url}` with headers `Authorization: OAuth <token>`, `Content-Type: video/mp4`, `Offset: 0`, `File-Size: <bytes>` — body = raw file bytes
3. `POST /{page_id}/video_reels` with `upload_phase=finish`, `upload_session_id`, `access_token`, `description` — response contains `post_id`
4. Reel URL: `https://www.facebook.com/reel/{post_id}`

Error handling:
- Code 368 (rate limit): auto-retry with exponential backoff, max 3 attempts, then mark `failed` with readable message.
- Any failure: row → `failed`, error stored, UI shows it. Scheduler never throws out of a catch.
- Scheduler: `setInterval` 30s, picks due `queued` rows (skip `processing` older than 10 min → mark failed timeout), posts one at a time.

## Scraper App Cleanup (main app)

Remove:
- `QueuePanel.tsx`, FB queue tab, queue/scheduling settings in `RealtimeStreamDashboard.tsx`
- Stage destination feature (`ContentStagePanel` usage, `.content-stage.json`)
- Server: `/api/publish/*` endpoints, in-process scheduler, `.publish-queue.json`, FB connect endpoints, IG Graph API posting, instagrapi (python) paths, `.fb-poster-session.json`/`.ig-poster-session.json`
- AI caption generation (Gemini) — publishing-only feature
- `instagram_poster.py`, `requirements.txt`, `PYTHON_BIN` env
- docs/SETUP.md sections for scheduling/FB/IG connect (replace with pointer to poster app)

Keep:
- Scraping dashboards (IG/TikTok/FB), extension ZIP download (fresh files from `extension/`), media downloads + credits, API token gate, landing/auth.

## Deployment (Koyeb)

- `posting-app/koyeb.yaml`: `type: web`, free instance, env `PORT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- GitHub repo `faizanofficialspeaks-rgb/social-scraper-2` → Koyeb "Deploy from repo" pointing at `posting-app/` (or root with dockerfile). Root dir: `posting-app`, build command: `npm install` (no build), run: `npm start`.
- Keep-alive: cron-job.org free job → `GET https://<app>.koyeb.app/api/health` every 30 min (well under 1 h idle).
- Migration 003 runs manually once in Supabase SQL Editor (owner action, same as 001/002).

## Error Handling & Reliability

- File validation: extension `.mp4` (case-insensitive), size cap 500 MB, skip non-video files with a list of skipped names shown in UI.
- Upload failures → per-file messages, never all-or-nothing.
- Duplicate constraint → friendly "Already posted/queued" chip, row greyed out.
- FB rate limit → backoff retries; exhausted → clear failure message.
- Scheduler crashes → process exits are caught; queue rows persist (Supabase) so nothing lost; next boot re-runs due items.
- Server restart / Koyeb redeploy: queue, dedup, FB session all survive (cloud DB).

## Testing

- Node temp scripts: upload→queue→schedule→post to a test FB page; verify status transitions; re-upload same file → `duplicate`; rate-limit simulation → retry/backoff.
- Manual UI pass: folder drop, caption import from metadata.json, Post Now, time scheduling, error display.
- After scraper-app cleanup: `npm run lint` + `npm run build` clean; production boot + health OK; downloads/credits still work; ZIP download works.

## Out of Scope (future)

- IG posting in poster app, AI captions, multi-page bulk posting, ZIP upload (folder only), credits in poster app.
