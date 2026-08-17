# Facebook Poster App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolith — main app becomes a pure scraper/downloader, and Facebook posting moves to a new, dead-simple web app (`posting-app/`) hosted on Koyeb free tier with queue/dedup/FB-session state in Supabase.

**Architecture:** `posting-app/` = Express (CommonJS) serving a plain static single-page UI (no build step) + JSON API. Multer handles folder uploads; files hashed (sha256) for dedup; queue rows live in Supabase `post_queue`; scheduler (30s interval) posts due videos to Facebook via the verified `video_reels` 3-phase Graph API flow. Scraper app sheds all publish/queue/stage/FB/IG/AI/python code.

**Tech Stack:** Node >= 20 (fetch with `duplex: 'half'`), Express 4, multer 2, @supabase/supabase-js 2, plain HTML/JS/CSS frontend, Supabase Postgres (RLS), Facebook Graph API v21.0.

## Global Constraints

- No build step in `posting-app/` — plain static frontend, CommonJS server (`server.cjs`).
- No Python anywhere after cleanup. No `@google/genai` after cleanup.
- Duplication is impossible: unique `(user_id, file_hash)` in `post_queue`.
- FB posting engine: `video_reels` 3-phase exactly as verified in scraper app (start → rupload POST with `Authorization: OAuth`, `Content-Type: video/mp4`, `Offset: 0`, `File-Size` → finish; response field is `post_id`).
- Rate-limit code 368 → exponential backoff retry (30s/120s/300s, max 3 attempts).
- Scheduler never throws; every failure lands in `post_queue.error` with status `failed`.
- Frontend shows friendly messages; no crash states.
- Only `.mp4` accepted (case-insensitive), cap 500 MB per file.
- Auth: Supabase JWT `Authorization: Bearer`; user APIs use the anon client + RLS; scheduler uses the service-role client.
- Files live on ephemeral disk under `posting-app/uploads/<userId>/` and are deleted after a successful (or permanently failed) post.
- Commits: one per task, per-file style consistent with repo (`feat:`/`fix:`/`chore:`).
- Verification via `Invoke-WebRequest`/curl + temp node scripts in `C:\Users\FAIZAN~1\AppData\Local\Temp\opencode\` (no test framework in repo).

---

### Task 1: Scaffold posting-app (server + health + static)

**Files:**
- Create: `posting-app/package.json`
- Create: `posting-app/server.cjs`
- Create: `posting-app/public/index.html` (placeholder)
- Create: `posting-app/.env.example`
- Create: `posting-app/.gitignore`

**Interfaces:**
- Produces: `server.cjs` exports nothing; starts HTTP on `process.env.PORT || 8000`, serves `public/`, responds to `GET /api/health` with `{ ok: true }`. Later tasks add routes via `app.post(...)` inside `startServer()` — keep a single `app` in module scope.

- [ ] **Step 1: Create `posting-app/package.json`**

```json
{
  "name": "fb-poster-app",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node server.cjs",
    "dev": "node server.cjs"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.112.3",
    "dotenv": "^17.2.3",
    "express": "^4.21.2",
    "multer": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `posting-app/server.cjs`**

```js
const path = require('path');
const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'fb-poster', now: new Date().toISOString() });
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[FB-POSTER] listening on http://0.0.0.0:${PORT}`);
});
```

- [ ] **Step 3: Create `posting-app/public/index.html` placeholder**

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>FB Poster</title></head>
<body><h1>FB Poster — coming up</h1></body>
</html>
```

- [ ] **Step 4: Create `posting-app/.env.example` and `.gitignore`**

`.env.example`:
```
PORT=8000
SUPABASE_URL=""
SUPABASE_ANON_KEY=""
SUPABASE_SERVICE_ROLE_KEY=""
```

`.gitignore`:
```
node_modules/
.env
uploads/
```

- [ ] **Step 5: Install and boot-verify**

Run: `npm install` (in `posting-app/`), then start server with `Start-Process cmd '/c set PORT=8000&& node server.cjs > poster.log 2>&1'`, wait 3s, then:
```powershell
Invoke-WebRequest -Uri "http://localhost:8000/api/health" -UseBasicParsing
Invoke-WebRequest -Uri "http://localhost:8000/" -UseBasicParsing
```
Expected: both 200; health body `{"ok":true,...}`.

- [ ] **Step 6: Commit**

```bash
git add posting-app/
git commit -m "feat(poster-app): scaffold express server with health + static"
```

---

### Task 2: Supabase migration 003 + db helper + auth middleware

**Files:**
- Create: `supabase/migrations/003_posting.sql`
- Create: `posting-app/db.cjs`

**Interfaces:**
- Consumes: existing `public.profiles(id uuid primary key references auth.users(id), email text, ...)` from 001.
- Produces: `db.cjs` exports `{ anon, admin, requireUser }`. `requireUser(req,res,next)` sets `req.user` (`{id, email}`) and `req.userToken`. Migration adds `post_queue` columns/table; profiles gain `fb_user_token`, `fb_page_token`, `fb_page_id`, `fb_page_name`.

- [ ] **Step 1: Write `supabase/migrations/003_posting.sql`**

```sql
-- FB Poster app: FB session on profile + queue/dedup table
alter table public.profiles
  add column if not exists fb_user_token text,
  add column if not exists fb_page_token text,
  add column if not exists fb_page_id text,
  add column if not exists fb_page_name text;

create table if not exists public.post_queue (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  file_hash     text not null,
  file_name     text not null,
  caption       text not null default '',
  scheduled_for timestamptz not null default now(),
  status        text not null default 'queued',
  fb_post_id    text,
  error         text,
  retry_count   int not null default 0,
  created_at    timestamptz not null default now(),
  posted_at     timestamptz,
  unique (user_id, file_hash)
);
create index if not exists post_queue_due_idx
  on public.post_queue (user_id, status, scheduled_for);

alter table public.post_queue enable row level security;

drop policy if exists "post_queue_select_own" on public.post_queue;
create policy "post_queue_select_own"
  on public.post_queue for select using (auth.uid() = user_id);
drop policy if exists "post_queue_insert_own" on public.post_queue;
create policy "post_queue_insert_own"
  on public.post_queue for insert with check (auth.uid() = user_id);
drop policy if exists "post_queue_update_own" on public.post_queue;
create policy "post_queue_update_own"
  on public.post_queue for update using (auth.uid() = user_id);
drop policy if exists "post_queue_delete_own" on public.post_queue;
create policy "post_queue_delete_own"
  on public.post_queue for delete using (auth.uid() = user_id);

grant usage on schema public to anon, authenticated, service_role;
grant all on public.post_queue to anon, authenticated, service_role;
```

- [ ] **Step 2: Write `posting-app/db.cjs`**

```js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function requireUser(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Invalid token' });
  req.user = { id: data.user.id, email: data.user.email || '' };
  req.userToken = token;
  next();
}

module.exports = { anon, admin, requireUser };
```

- [ ] **Step 3: Verify**

- Owner runs `supabase/migrations/003_posting.sql` in Supabase SQL Editor (flag to owner; continue code-side regardless).
- Boot check: `node -e "const d=require('./db.cjs'); console.log(!!d.anon, !!d.admin, typeof d.requireUser)"` → `true true function`.
- If env vars missing it still boots (clients created lazily-safe: createClient with undefined throws — so set dummy values in a local `.env` from the scraper repo's `.env`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/003_posting.sql posting-app/db.cjs
git commit -m "feat(poster-app): post_queue migration + supabase db helper"
```

---

### Task 3: FB connect + status API

**Files:**
- Create: `posting-app/fb.cjs`
- Modify: `posting-app/server.cjs` (add routes)

**Interfaces:**
- Consumes: `db.cjs` (`admin`, `requireUser`).
- Produces: `fb.cjs` exports `resolvePageToken(token)` → `{ user: {id,name}, page: {id,name,access_token} }` or throws `Error(message)`; and `fbGet(url)` → parsed JSON. Routes: `POST /api/fb/connect` `{token}` (accepts page token OR user token — auto page-token conversion via `/me/accounts`), `GET /api/fb/status` → `{ connected: bool, page: {id,name} | null }`.

- [ ] **Step 1: Write `posting-app/fb.cjs`**

```js
async function fbGet(url) {
  const res = await fetch(url);
  return res.json();
}

async function resolvePageToken(token) {
  const me = await fbGet(`https://graph.facebook.com/v21.0/me?fields=name,id&access_token=${encodeURIComponent(token)}`);
  if (!me || me.error || !me.id) throw new Error(me?.error?.message || 'Invalid Facebook token');
  // Token may already be a page token: if /me returns a page, use it directly.
  if (me.id.startsWith('Page') || (me.name && /^Page\b/.test(me.name))) {
    const info = await fbGet(`https://graph.facebook.com/v21.0/${me.id}?fields=name,id,access_token&access_token=${encodeURIComponent(token)}`);
    if (info && !info.error && info.access_token) {
      return { user: null, page: { id: info.id, name: info.name, access_token: info.access_token } };
    }
  }
  const accounts = await fbGet(`https://graph.facebook.com/v21.0/me/accounts?access_token=${encodeURIComponent(token)}`);
  const page = accounts?.data?.[0];
  if (!page) throw new Error(accounts?.error?.message || 'No pages found for this token');
  return { user: { id: me.id, name: me.name }, page: { id: page.id, name: page.name, access_token: page.access_token } };
}

module.exports = { fbGet, resolvePageToken };
```

- [ ] **Step 2: Add routes to `posting-app/server.cjs`** (above the static middleware)

```js
const { admin, requireUser } = require('./db.cjs');
const { resolvePageToken } = require('./fb.cjs');

app.post('/api/fb/connect', requireUser, async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Token required' });
  try {
    const { user, page } = await resolvePageToken(token);
    const { error } = await admin
      .from('profiles')
      .update({
        fb_user_token: user ? token : null,
        fb_page_token: page.access_token,
        fb_page_id: page.id,
        fb_page_name: page.name,
      })
      .eq('id', req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ connected: true, page: { id: page.id, name: page.name } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/fb/status', requireUser, async (req, res) => {
  const { data, error } = await admin.from('profiles').select('fb_page_id, fb_page_name').eq('id', req.user.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ connected: !!(data?.fb_page_id), page: data?.fb_page_id ? { id: data.fb_page_id, name: data.fb_page_name } : null });
});
```

- [ ] **Step 3: Verify**

Restart server. Then with a real FB token (owner pastes into a temp script):
```js
// C:\Users\FAIZAN~1\AppData\Local\Temp\opencode\fb-connect-test.cjs
const http = require('http');
const token = process.argv[2];
const body = JSON.stringify({ token });
const req = http.request({ host: 'localhost', port: 8000, path: '/api/fb/connect', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.argv[3]}` } }, r => { let d=''; r.on('data', c => d+=c); r.on('end', () => console.log(r.statusCode, d)); });
req.end(body);
```
Expected: `200 {"connected":true,"page":{"id":"...","name":"Alphaburx"}}`. Unauthorized (no Bearer) → 401. Garbage token → 400 with FB error message.

- [ ] **Step 4: Commit**

```bash
git add posting-app/fb.cjs posting-app/server.cjs
git commit -m "feat(poster-app): facebook connect with page-token conversion"
```

---

### Task 4: Upload API (hash, metadata import, dedup)

**Files:**
- Modify: `posting-app/server.cjs`
- Create: `posting-app/uploads/` (gitignored, mkdir at boot)

**Interfaces:**
- Consumes: `requireUser`, `admin`.
- Produces: `POST /api/upload` — multipart `files` (multiple `.mp4`) + optional text field `metadata` (JSON string of the extension's `metadata.json`). Response: `{ rows: [...], skipped: [names], duplicates: [names] }`. `rows` are `post_queue` rows; existing-hash files come back with `status: 'duplicate'` and are NOT inserted (unique constraint), `duplicates` lists their names.

- [ ] **Step 1: Add multer + upload route to `posting-app/server.cjs`**

```js
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_ROOT = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, req.user.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('data', d => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

app.post('/api/upload', requireUser, upload.array('files', 200), async (req, res) => {
  const files = (req.files || []).filter(f => /\.mp4$/i.test(f.originalname));
  const skipped = (req.files || []).filter(f => !/\.mp4$/i.test(f.originalname)).map(f => f.originalname);
  let captionMap = {};
  try { captionMap = JSON.parse(req.body.metadata || '{}'); } catch { /* ignore bad metadata */ }
  const rows = [];
  const duplicates = [];
  for (const f of files) {
    const file_hash = await sha256File(f.path);
    const caption = String(captionMap[f.originalname] || captionMap[f.originalname.toLowerCase()] || '').slice(0, 2200);
    const { data, error } = await admin
      .from('post_queue')
      .insert({ user_id: req.user.id, file_hash, file_name: f.originalname, caption })
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === '23505') {
        fs.unlinkSync(f.path);
        duplicates.push(f.originalname);
        continue;
      }
      fs.unlinkSync(f.path);
      return res.status(500).json({ error: error.message });
    }
    rows.push(data);
  }
  res.json({ rows, skipped, duplicates });
});
```

- [ ] **Step 2: Verify**

- Restart server. Create temp folder with 2 mp4s (copy any small mp4 from `C:\Users\FAIZAN~1\AppData\Local\Temp\opencode\` or generate with ffmpeg if available; otherwise reuse a short mp4) + a `metadata.json` mapping one filename to a caption.
- Upload with token:
```powershell
$token = "USER_JWT"; curl.exe -s -H "Authorization: Bearer $token" -F "files=@video1.mp4" -F "files=@video2.mp4" -F "metadata=@metadata.json" http://localhost:8000/api/upload
```
- Expected: `rows` length 2, captions imported for the mapped file. Upload the SAME folder again → second call returns those 2 in `duplicates`, `rows` empty, no 500.

- [ ] **Step 3: Commit**

```bash
git add posting-app/server.cjs
git commit -m "feat(poster-app): folder upload with sha256 dedup + metadata captions"
```

---

### Task 5: Queue API

**Files:**
- Modify: `posting-app/server.cjs`

**Interfaces:**
- Consumes: `requireUser`, `admin`.
- Produces: `GET /api/queue` → user's rows (newest first, status ordered queued→processing→posted→failed→duplicate); `POST /api/queue/:id/now` → set `scheduled_for=now()`, `status='queued'`; `PATCH /api/queue/:id/schedule` `{scheduled_for}` → update (only when `status='queued'`); `DELETE /api/queue/:id` → delete (only when `status='queued'`). All scoped to `req.user.id`.

- [ ] **Step 1: Add queue routes to `posting-app/server.cjs`**

```js
app.get('/api/queue', requireUser, async (req, res) => {
  const { data, error } = await admin
    .from('post_queue')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ rows: data || [] });
});

app.post('/api/queue/:id/now', requireUser, async (req, res) => {
  const { error } = await admin
    .from('post_queue')
    .update({ scheduled_for: new Date().toISOString(), status: 'queued' })
    .eq('id', req.params.id).eq('user_id', req.user.id)
    .eq('status', 'queued');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.patch('/api/queue/:id/schedule', requireUser, async (req, res) => {
  const when = new Date(req.body?.scheduled_for);
  if (isNaN(when.getTime())) return res.status(400).json({ error: 'Invalid scheduled_for' });
  const { error } = await admin
    .from('post_queue')
    .update({ scheduled_for: when.toISOString() })
    .eq('id', req.params.id).eq('user_id', req.user.id)
    .eq('status', 'queued');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.delete('/api/queue/:id', requireUser, async (req, res) => {
  const { error } = await admin
    .from('post_queue')
    .delete()
    .eq('id', req.params.id).eq('user_id', req.user.id)
    .eq('status', 'queued');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
```

- [ ] **Step 2: Verify**

Restart server, upload a video, then:
```powershell
$token="USER_JWT"; curl.exe -s -H "Authorization: Bearer $token" http://localhost:8000/api/queue
curl.exe -s -X POST -H "Authorization: Bearer $token" http://localhost:8000/api/queue/<id>/now
```
Expected: queue lists the row; `now` returns `{"ok":true}`; PATCH with bad date → 400; DELETE removes only queued rows.

- [ ] **Step 3: Commit**

```bash
git add posting-app/server.cjs
git commit -m "feat(poster-app): queue list/now/schedule/delete api"
```

---

### Task 6: FB publishing engine (video_reels 3-phase + retry)

**Files:**
- Modify: `posting-app/fb.cjs`
- Create: `posting-app/publisher.cjs`

**Interfaces:**
- Consumes: `fb.cjs` unchanged; files on disk.
- Produces: `publisher.cjs` exports `publishVideo({ pageId, pageToken, filePath, caption })` → `{ postId, url }` (throws on failure after retries) and `isRateLimit(err)` → bool. Rate-limit (code 368) retries with 30s/120s/300s sleeps (max 3 attempts); other Graph errors fail fast with readable `err.message`.

- [ ] **Step 1: Add `publishVideo` to `posting-app/fb.cjs`**

```js
const fs = require('fs');

async function publishVideo({ pageId, pageToken, filePath, caption }) {
  const size = fs.statSync(filePath).size;
  const base = `https://graph.facebook.com/v21.0/${pageId}/video_reels`;

  const startRes = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: pageToken, upload_phase: 'start', video_file_size: size }),
  });
  const start = await startRes.json();
  if (!start.upload_session_id) throw new Error(start.error?.error?.message || start.error?.message || 'start phase failed');

  const upRes = await fetch(start.upload_url, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${pageToken}`,
      'Content-Type': 'video/mp4',
      Offset: '0',
      'File-Size': String(size),
    },
    body: fs.createReadStream(filePath),
    duplex: 'half',
  });
  const up = await upRes.json();
  if (up.error) throw new Error(up.error.message || 'upload phase failed');

  const finRes = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: pageToken,
      upload_phase: 'finish',
      upload_session_id: start.upload_session_id,
      video_id: start.video_id,
      description: caption || '',
    }),
  });
  const fin = await finRes.json();
  if (!fin.post_id) throw new Error(fin.error?.error?.message || fin.error?.message || 'finish phase failed');

  return { postId: fin.post_id, url: `https://www.facebook.com/reel/${fin.post_id}` };
}

function isRateLimit(err) {
  return /368|rate limit|temporarily blocked/i.test(String(err.message || ''));
}

module.exports = { fbGet, resolvePageToken, publishVideo, isRateLimit };
```

- [ ] **Step 2: Create `posting-app/publisher.cjs` (retry wrapper)**

```js
const { publishVideo, isRateLimit } = require('./fb.cjs');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const BACKOFF = [30_000, 120_000, 300_000];

async function postWithRetry(opts) {
  let attempts = 0;
  for (;;) {
    try {
      return await publishVideo(opts);
    } catch (err) {
      if (!isRateLimit(err) || attempts >= BACKOFF.length) throw err;
      await sleep(BACKOFF[attempts]);
      attempts += 1;
    }
  }
}

module.exports = { postWithRetry, isRateLimit };
```

- [ ] **Step 3: Verify (rate-limit unit check — no real post)**

```js
// C:\Users\FAIZAN~1\AppData\Local\Temp\opencode\retry-test.cjs
const { isRateLimit } = require('D:/instagram-scraper-&-downloader-extension/posting-app/publisher.cjs');
console.assert(isRateLimit(new Error('(#368) limit reached')), '368 detected');
console.assert(!isRateLimit(new Error('boom')), 'other not rate limit');
console.log('retry logic OK');
```
Run: `node retry-test.cjs` → `retry logic OK`.

- [ ] **Step 4: Commit**

```bash
git add posting-app/fb.cjs posting-app/publisher.cjs
git commit -m "feat(poster-app): video_reels 3-phase engine with rate-limit retry"
```

---

### Task 7: Scheduler (30s interval, stale handling)

**Files:**
- Create: `posting-app/scheduler.cjs`
- Modify: `posting-app/server.cjs` (start scheduler at boot)

**Interfaces:**
- Consumes: `admin` (db.cjs), `postWithRetry` (publisher.cjs), `UPLOAD_ROOT` path convention `<root>/<userId>/<id>.mp4`.
- Produces: `scheduler.cjs` exports `startScheduler()` — every 30s: mark `processing` rows older than 10 min as `failed` (error `timeout`); fetch due `queued` rows (limit 5, ordered by scheduled_for); process sequentially: `status=processing` → load profile `fb_page_token` → `postWithRetry` → `status=posted` + `fb_post_id` + `posted_at` + delete file → on error `status=failed` + `error` (after retries exhausted), keep file for manual retry? NO — spec: files deleted after success or permanent failure; failure keeps file so `now` retry still works. Correct: on failure keep file; on success delete.

- [ ] **Step 1: Create `posting-app/scheduler.cjs`**

```js
const fs = require('fs');
const path = require('path');
const { admin } = require('./db.cjs');
const { postWithRetry } = require('./publisher.cjs');

const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const TEN_MIN = 10 * 60 * 1000;

async function processRow(row) {
  await admin.from('post_queue').update({ status: 'processing' }).eq('id', row.id);
  const { data: profile } = await admin.from('profiles').select('fb_page_token, fb_page_id').eq('id', row.user_id).maybeSingle();
  if (!profile?.fb_page_token || !profile?.fb_page_id) {
    await admin.from('post_queue').update({ status: 'failed', error: 'Facebook not connected' }).eq('id', row.id);
    return;
  }
  const filePath = path.join(UPLOAD_ROOT, row.user_id, `${row.id}.mp4`);
  if (!fs.existsSync(filePath)) {
    await admin.from('post_queue').update({ status: 'failed', error: 'Video file missing (redeploy?) — re-upload' }).eq('id', row.id);
    return;
  }
  try {
    const { postId } = await postWithRetry({ pageId: profile.fb_page_id, pageToken: profile.fb_page_token, filePath, caption: row.caption });
    await admin.from('post_queue').update({ status: 'posted', fb_post_id: postId, posted_at: new Date().toISOString() }).eq('id', row.id);
    fs.unlinkSync(filePath);
  } catch (err) {
    const retries = Number(row.retry_count || 0);
    await admin.from('post_queue').update({ status: 'failed', error: String(err.message || err).slice(0, 500), retry_count: retries + 1 }).eq('id', row.id);
  }
}

async function runDue() {
  const { data: stuck } = await admin.from('post_queue')
    .select('id').eq('status', 'processing')
    .filter('created_at', 'lt', new Date(Date.now() - TEN_MIN).toISOString());
  for (const r of stuck || []) {
    await admin.from('post_queue').update({ status: 'failed', error: 'Timeout — retry manually' }).eq('id', r.id);
  }
  const { data: due } = await admin
    .from('post_queue')
    .select('*').eq('status', 'queued').lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for').limit(5);
  for (const row of due || []) {
    try { await processRow(row); } catch (e) { console.error('[SCHED] row failed', row.id, e.message); }
  }
}

function startScheduler() {
  setInterval(() => { runDue().catch(e => console.error('[SCHED] loop error', e.message)); }, 30_000);
  runDue().catch(e => console.error('[SCHED] first run error', e.message));
  console.log('[SCHED] scheduler started (30s interval)');
}

module.exports = { startScheduler, runDue };
```

- [ ] **Step 2: Wire into `posting-app/server.cjs`** (after `app.listen`)

```js
const { startScheduler } = require('./scheduler.cjs');
startScheduler();
```

- [ ] **Step 3: Fix file-name coupling between upload and scheduler**

Upload stores files as `<Date.now()>-<sanitized original>` but scheduler expects `<row.id>.mp4`. In Task 4's upload route, after each insert rename the stored file — replace the insert loop body with:

```js
  for (const f of files) {
    const file_hash = await sha256File(f.path);
    const caption = String(captionMap[f.originalname] || captionMap[f.originalname.toLowerCase()] || '').slice(0, 2200);
    const { data, error } = await admin
      .from('post_queue')
      .insert({ user_id: req.user.id, file_hash, file_name: f.originalname, caption })
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === '23505') {
        fs.unlinkSync(f.path);
        duplicates.push(f.originalname);
        continue;
      }
      fs.unlinkSync(f.path);
      return res.status(500).json({ error: error.message });
    }
    const stored = path.join(dir, `${data.id}.mp4`);
    fs.renameSync(f.path, stored);
    rows.push(data);
  }
```

where `dir = path.join(UPLOAD_ROOT, req.user.id)` (already defined in the multer destination callback — hoist it to the route scope).

- [ ] **Step 4: Verify**

Restart server. Confirm log prints `[SCHED] scheduler started`. Upload a video, `PATCH scheduled_for` to 1 minute in the future, wait 90s, then `GET /api/queue` — expected `status: 'posted'` with `fb_post_id` (real FB page connected; if rate-limited, `failed` with error text — acceptable, engine verified in Task 6/3). Re-upload same file → `duplicates` (dedup intact after posting).

- [ ] **Step 5: Commit**

```bash
git add posting-app/scheduler.cjs posting-app/server.cjs
git commit -m "feat(poster-app): 30s scheduler with stale timeout + file rename fix"
```

---

### Task 8: Frontend — single-page simple UI

**Files:**
- Create: `posting-app/public/index.html` (replace placeholder)
- Create: `posting-app/public/style.css`
- Create: `posting-app/public/app.js`

**Interfaces:**
- Consumes: all API routes above; supabase-js v2 ESM from CDN (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`).
- Produces: full UI per spec: login (Google OAuth), FB connect card, upload drop zone, queue list with per-row caption/time/Post Now/status chips, bulk "Sab Post Karo", friendly errors, 5s polling of `/api/queue`.

- [ ] **Step 1: Write `posting-app/public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Easy FB Poster</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>Easy FB Poster</h1>
    <div id="authBox"></div>
  </header>

  <main id="app" class="hidden">
    <section class="card" id="fbCard">
      <h2>1 · Facebook Connect</h2>
      <p class="sub">Paste your Facebook Page Token (or user token — auto-converts).</p>
      <input type="password" id="fbToken" placeholder="EAAG... (Facebook token)" autocomplete="off">
      <button id="fbConnect">Connect Facebook</button>
      <div id="fbStatus" class="chip"></div>
    </section>

    <section class="card" id="uploadCard">
      <h2>2 · Videos Upload</h2>
      <p class="sub">Extracted ZIP folder drop karo — captions metadata.json se auto aa jayengi.</p>
      <label class="dropzone" id="dropzone">
        <input type="file" id="fileInput" webkitdirectory multiple hidden>
        <span>📁 Folder drop karo ya click karo</span>
      </label>
      <div id="uploadMsg"></div>
    </section>

    <section class="card" id="queueCard">
      <div class="row-between">
        <h2>3 · Queue <span id="queueCount" class="chip"></span></h2>
        <button id="postAll" class="primary">Sab Post Karo</button>
      </div>
      <div id="queueList"></div>
    </section>
  </main>

  <div id="loginPrompt" class="card hidden">
    <p>App use karne ke liye login karo.</p>
    <button id="loginBtn" class="primary">Google se Login</button>
  </div>

  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `posting-app/public/style.css`**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f7; color: #1a1a1a; }
header { background: #1a1a1a; color: #fff; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; }
header h1 { font-size: 18px; }
main { max-width: 760px; margin: 24px auto; padding: 0 16px; display: grid; gap: 16px; }
.card { background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; padding: 20px; }
.card h2 { font-size: 15px; margin-bottom: 6px; }
.sub { font-size: 13px; color: #666; margin-bottom: 12px; }
input[type=password], input[type=text] { width: 100%; padding: 10px; border: 1px solid #d0d0d0; border-radius: 8px; margin-bottom: 10px; font-size: 14px; }
button { padding: 10px 18px; border: none; border-radius: 8px; background: #e5e5e5; font-size: 14px; cursor: pointer; }
button.primary { background: #1877f2; color: #fff; }
button:disabled { opacity: .5; cursor: not-allowed; }
.dropzone { display: flex; align-items: center; justify-content: center; border: 2px dashed #1877f2; border-radius: 12px; padding: 28px; cursor: pointer; color: #1877f2; font-size: 14px; }
.dropzone.dragover { background: #e8f0fe; }
.chip { display: inline-block; padding: 3px 10px; border-radius: 999px; background: #eee; font-size: 12px; }
.chip.ok { background: #d1f2dc; color: #0a6b2d; }
.chip.err { background: #fdd9d9; color: #a41616; }
.chip.warn { background: #fff3cd; color: #8a6d00; }
.row-between { display: flex; justify-content: space-between; align-items: center; }
#queueList { display: grid; gap: 10px; margin-top: 12px; }
.qrow { border: 1px solid #eee; border-radius: 10px; padding: 12px; display: grid; gap: 8px; }
.qrow .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.qrow .name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qrow textarea { width: 100%; min-height: 52px; border: 1px solid #d0d0d0; border-radius: 8px; padding: 8px; font-size: 13px; font-family: inherit; resize: vertical; }
.qrow .bottom { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.qrow input[type=datetime-local] { padding: 6px 8px; border: 1px solid #d0d0d0; border-radius: 8px; font-size: 13px; }
.hidden { display: none !important; }
#uploadMsg, #authBox button { font-size: 13px; }
video { width: 120px; height: 80px; object-fit: cover; border-radius: 8px; background: #000; }
```

- [ ] **Step 3: Write `posting-app/public/app.js`**

```js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

const SUPABASE_URL = 'REPLACE_WITH_SUPABASE_URL';   // served from /api/config
const SUPABASE_ANON = 'REPLACE_WITH_SUPABASE_ANON'; // served from /api/config
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
let user = null;

const $ = id => document.getElementById(id);
const api = async (path, opts = {}) => {
  const headers = { ...(opts.body ? { 'Content-Type': 'application/json' } : {}) };
  if (user) headers.Authorization = `Bearer ${user.access_token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function refreshAuth() {
  const { data } = await supabase.auth.getSession();
  user = data.session || null;
  const box = $('authBox');
  if (user) {
    box.innerHTML = `<span style="font-size:13px">${esc(user.user.email)}</span> <button id="logout">Logout</button>`;
    $('logout').onclick = () => supabase.auth.signOut().then(refreshAuth);
    $('app').classList.remove('hidden');
    $('loginPrompt').classList.add('hidden');
    refreshFBStatus();
    refreshQueue();
  } else {
    box.innerHTML = '';
    $('app').classList.add('hidden');
    $('loginPrompt').classList.remove('hidden');
  }
}

async function refreshFBStatus() {
  const chip = $('fbStatus');
  try {
    const s = await api('/api/fb/status');
    chip.className = 'chip' + (s.connected ? ' ok' : ' warn');
    chip.textContent = s.connected ? `Connected ✓ · ${esc(s.page.name)}` : 'Connected nahi — token paste karo';
  } catch (e) { chip.className = 'chip err'; chip.textContent = e.message; }
}

function rowHtml(r) {
  const st = { queued: ['Queued', ''], posted: ['Posted ✓', 'ok'], failed: ['Failed', 'err'], duplicate: ['Duplicate', 'warn'], processing: ['Posting...', ''] }[r.status] || [r.status, ''];
  const when = new Date(r.scheduled_for);
  const local = new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return `<div class="qrow" data-id="${r.id}">
    <div class="top"><span class="name">${esc(r.file_name)}</span><span class="chip ${st[1]}">${st[0]}</span></div>
    <textarea data-field="caption">${esc(r.caption)}</textarea>
    <div class="bottom">
      <input type="datetime-local" data-field="scheduled_for" value="${local}">
      <button data-act="now" class="primary" ${r.status !== 'queued' ? 'disabled' : ''}>Post Now</button>
      <button data-act="del" ${r.status !== 'queued' ? 'disabled' : ''}>Delete</button>
      ${r.error ? `<span class="chip err">${esc(r.error)}</span>` : ''}
    </div></div>`;
}

async function refreshQueue() {
  try {
    const { rows } = await api('/api/queue');
    $('queueCount').textContent = rows.filter(r => r.status === 'queued').length + ' pending';
    $('queueList').innerHTML = rows.length ? rows.map(rowHtml).join('') : '<p class="sub">Koi videos nahi — folder drop karo.</p>';
    document.querySelectorAll('.qrow').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('[data-act=now]').onclick = async () => { await api(`/api/queue/${id}/now`, { method: 'POST' }); refreshQueue(); };
      row.querySelector('[data-act=del]').onclick = async () => { await api(`/api/queue/${id}`, { method: 'DELETE' }); refreshQueue(); };
      const when = row.querySelector('[data-field=scheduled_for]');
      when.onchange = async () => { await api(`/api/queue/${id}/schedule`, { method: 'PATCH', body: JSON.stringify({ scheduled_for: new Date(when.value).toISOString() }) }); refreshQueue(); };
      const cap = row.querySelector('[data-field=caption]');
      cap.onchange = async () => { /* captions update endpoint (Task 9) or skip */ };
    });
  } catch (e) { $('queueList').innerHTML = `<p class="chip err">${esc(e.message)}</p>`; }
}

$('loginBtn').onclick = () => supabase.auth.signInWithOAuth({ provider: 'google' });
$('fbConnect').onclick = async () => {
  const btn = $('fbConnect');
  btn.disabled = true;
  try { await api('/api/fb/connect', { method: 'POST', body: JSON.stringify({ token: $('fbToken').value.trim() }) }); $('fbToken').value = ''; refreshFBStatus(); }
  catch (e) { $('fbStatus').className = 'chip err'; $('fbStatus').textContent = e.message; }
  btn.disabled = false;
};

$('fileInput').onchange = () => uploadFiles($('fileInput').files);
$('dropzone').ondragover = e => { e.preventDefault(); $('dropzone').classList.add('dragover'); };
$('dropzone').ondragleave = () => $('dropzone').classList.remove('dragover');
$('dropzone').ondrop = e => { e.preventDefault(); $('dropzone').classList.remove('dragover'); uploadFiles(e.dataTransfer.files); };

async function uploadFiles(fileList) {
  const files = [...fileList];
  const meta = files.find(f => /metadata\.json$/i.test(f.name));
  const vids = files.filter(f => /\.mp4$/i.test(f.name));
  $('uploadMsg').textContent = vids.length ? `Uploading ${vids.length} videos...` : 'Koi .mp4 video nahi mila folder mein.';
  const fd = new FormData();
  vids.forEach(f => fd.append('files', f, f.name));
  if (meta) fd.append('metadata', await meta.text());
  try {
    const r = await api('/api/upload', { method: 'POST', body: fd });
    const parts = [];
    if (r.rows.length) parts.push(`${r.rows.length} queued`);
    if (r.duplicates.length) parts.push(`${r.duplicates.length} duplicate (skip)`);
    if (r.skipped.length) parts.push(`${r.skipped.length} skipped (non-mp4)`);
    $('uploadMsg').textContent = parts.join(' · ') || 'Kuch nahi hua.';
    $('uploadMsg').className = r.duplicates.length || r.skipped.length ? 'chip warn' : 'chip ok';
    refreshQueue();
  } catch (e) { $('uploadMsg').className = 'chip err'; $('uploadMsg').textContent = e.message; }
}

$('postAll').onclick = async () => {
  const { rows } = await api('/api/queue');
  for (const r of rows.filter(r => r.status === 'queued')) await api(`/api/queue/${r.id}/now`, { method: 'POST' });
  refreshQueue();
};

supabase.auth.onAuthStateChange(() => refreshAuth());
refreshAuth();
setInterval(refreshQueue, 5000);
```

**Note for implementer:** `SUPABASE_URL`/`SUPABASE_ANON` are placeholders — Task 10 (Koyeb/env) replaces them with a tiny `GET /api/config` endpoint returning the anon pair (public keys are safe to expose), and `app.js` fetches them on boot. Keep the `cap.onchange` handler as a no-op until Task 9 adds the caption-save endpoint.

- [ ] **Step 4: Verify**

Restart server; open `http://localhost:8000/`. Expected: header + 3 cards; login button shows when logged out; after Google login (Supabase project must have Google provider — same as scraper app), FB connect card accepts token; upload a test folder → rows appear with auto captions; Post Now works; status chips update after polling.

- [ ] **Step 5: Commit**

```bash
git add posting-app/public/
git commit -m "feat(poster-app): simple single-page UI (login, fb connect, upload, queue)"
```

---

### Task 9: Caption save endpoint + local E2E pass

**Files:**
- Modify: `posting-app/server.cjs`
- Modify: `posting-app/public/app.js`

**Interfaces:**
- Produces: `PATCH /api/queue/:id/caption` `{caption}` → update caption (any status except `posted`? allow queued+failed so a failed post can be retried with fixed caption). Wire `cap.onchange` to it.

- [ ] **Step 1: Add endpoint to `posting-app/server.cjs`**

```js
app.patch('/api/queue/:id/caption', requireUser, async (req, res) => {
  const caption = String(req.body?.caption || '').slice(0, 2200);
  const { error } = await admin
    .from('post_queue')
    .update({ caption })
    .eq('id', req.params.id).eq('user_id', req.user.id)
    .in('status', ['queued', 'failed']);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
```

- [ ] **Step 2: Wire frontend** — replace the no-op in `refreshQueue()`:

```js
const cap = row.querySelector('[data-field=caption]');
cap.onchange = async () => { await api(`/api/queue/${id}/caption`, { method: 'PATCH', body: JSON.stringify({ caption: cap.value }) }); };
```

- [ ] **Step 3: Full local E2E (temp script + real FB page)**

```js
// C:\Users\FAIZAN~1\AppData\Local\Temp\opencode\poster-e2e.cjs
// Flow: connect (token arg) -> status -> upload 1 mp4 (path arg) -> list -> now -> poll 3 min for posted
```
Steps run manually by owner (needs real FB token + JWT): connect → upload → Post Now → wait → expect `posted` with reel URL; then upload the same file again → `duplicates`. Also kill the server mid-upload and confirm the row is `failed`/`queued` and re-postable — no crash, no lost state.

- [ ] **Step 4: Commit**

```bash
git add posting-app/server.cjs posting-app/public/app.js
git commit -m "feat(poster-app): caption editing + e2e verified locally"
```

---

### Task 10: Koyeb deploy config + /api/config + README

**Files:**
- Create: `posting-app/koyeb.yaml`
- Create: `posting-app/README.md`
- Modify: `posting-app/server.cjs`, `posting-app/public/app.js`

**Interfaces:**
- Produces: `GET /api/config` → `{ url, anon }` (read from env); frontend boot: `const cfg = await (await fetch('/api/config')).json();` then `createClient(cfg.url, cfg.anon)`. `koyeb.yaml` deploys the service.

- [ ] **Step 1: Add `/api/config` to `posting-app/server.cjs`**

```js
app.get('/api/config', (req, res) => {
  res.json({ url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY });
});
```

- [ ] **Step 2: Frontend boot change** — replace the two REPLACE_WITH constants:

```js
const cfg = await (await fetch('/api/config')).json();
const supabase = createClient(cfg.url, cfg.anon);
```
(move inside top-level await; `index.html` script is `type=module` so top-level await works).

- [ ] **Step 3: Create `posting-app/koyeb.yaml`**

```yaml
name: fb-poster
services:
  - name: web
    type: web
    instance_types:
      - type: free
    ports:
      - port: 8000
        protocol: http
    routes:
      - path: /
    health_checks:
      - port: 8000
        path: /api/health
        check_interval: 60
    env:
      - name: PORT
        value: "8000"
      # secrets set in Koyeb dashboard (sync via UI):
      # SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
    build:
      type: buildpack
      build_command: npm install
    run: npm start
```

- [ ] **Step 4: Create `posting-app/README.md`** — deploy steps: push repo → Koyeb dashboard → "Create Web Service" → select repo → root directory `posting-app` → Free instance → set env vars (Supabase trio) → deploy; then cron-job.org free job hitting `https://<service>.koyeb.app/api/health` every 30 min (keep-alive); migration 003 note; extension flow link.

- [ ] **Step 5: Verify**

Restart locally; `curl /api/config` returns URL+anon; frontend still logs in. Commit.

```bash
git add posting-app/
git commit -m "feat(poster-app): koyeb config, api config endpoint, readme"
```

---

### Task 11: Main app cleanup — server + configs + deps

**Files:**
- Modify: `server.ts` (delete routes + helpers below)
- Modify: `render.yaml` (healthCheckPath → `/api/health`; remove PYTHON_BIN, GEMINI_API_KEY, pip build step)
- Modify: `package.json` (remove `@google/genai`), run `npm install` to update lockfile
- Modify: `.env.example` (remove Gemini + TikTok + PYTHON sections)
- Delete: `instagram_poster.py`, `requirements.txt`, `src/components/QueuePanel.tsx`, `src/components/ContentStagePanel.tsx`, `extension/publisher.js` (already deleted), `IG_VIDEO_FIX/` (check first — if it contains scraper-only fixes, keep; it's a legacy copy → delete per owner's earlier note)

**Interfaces:**
- Consumes: nothing (removal only).
- Produces: clean server that still serves: `/api/health`, `/api/auth/*` (me, apitoken, credits, deduct, validate-token), `/api/proxy-media`, `/api/media/download`, static SPA + `/extension`.

- [ ] **Step 1: Remove publish/queue/stage/FB/IG routes from `server.ts`**

Delete (grep first — line numbers shift):
- `app.post("/api/publish/connect"...)` through `app.get("/api/publish/status"...` (lines ~1503–2070: connect, test, disconnect, queue, set-platform, scheduling-config GET/PUT, schedule-like-yesterday, set-mode, set-time, status, remove, clear, trigger-now)
- `app.post("/api/facebook/pages"...)` through `app.post("/api/facebook/disconnect"...)` (pages, connect, switch-page, test, disconnect)
- `app.get("/api/analytics/dashboard"...)` (publish analytics — verify nothing else references it; remove)
- `app.post('/api/stage/upsert'...)` through `app.post('/api/stage/push-to-queue'...)` (upsert, get, update, remove, clear, caption, tags, push-to-queue)

Also delete now-dead code referenced only by those routes (grep each name before deleting):
- `publishToInstagram`, `publishToFacebook`, `publishQueue`, `queueInterval`/scheduler `setInterval`, `fbSession`/`loadFbSession`/`saveFbSession`, `loadPublishQueue`/`savePublishQueue`, `loadContentStage`/`saveContentStage`, `loadSchedulingConfig`/`saveSchedulingConfig`, Gemini caption functions (`generateCaption` etc.), `fbPagesLimiter`/`publishLimiter` if unused elsewhere, any `instagrapi`/`python` invocation helpers, `contentStage` variable + `.content-stage.json`, `schedulingConfig` + `.scheduling-config.json`, queue status file constants.

Keep: `generateApiToken`/auth, credits RPC calls, proxy-media, media download (credits deduction), extension static serving.

- [ ] **Step 2: `render.yaml`**

```yaml
    buildCommand: npm install && npm run build
    healthCheckPath: /api/health
```
Remove `PYTHON_BIN`, `GEMINI_API_KEY`, `DATA_DIR` (no longer needed — verify no server code reads DATA_DIR after cleanup; if `DATA_DIR` still used for any remaining state, keep it).

- [ ] **Step 3: `package.json` + deps**

Remove `"@google/genai": "^2.4.0"` from dependencies; run `npm install` (updates `package-lock.json`).

- [ ] **Step 4: Delete leftover files**

`instagram_poster.py`, `requirements.txt`, `src/components/QueuePanel.tsx`, `src/components/ContentStagePanel.tsx`. Verify no imports of QueuePanel/ContentStagePanel remain (grep; fix App.tsx in Task 12).

- [ ] **Step 5: Verify**

Run: `npm run lint` → 0 errors. `npm run build` → dist generated. Boot production (`dist/server.cjs` on 3010), check:
```powershell
Invoke-WebRequest http://localhost:3010/api/health     # 200
Invoke-WebRequest http://localhost:3010/api/auth/validate-token?token=<apiToken>  # 200 (valid token)
Invoke-WebRequest http://localhost:3010/extension/manifest.json  # 200
```
Expected: publish routes 404 (removed), core routes 200.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove publishing/queue/stage from scraper app (moved to poster-app)"
```

---

### Task 12: Main app cleanup — UI components + docs

**Files:**
- Modify: `src/App.tsx` (remove queue/fbqueue tabs + imports + `handleDownloadZip` stays)
- Modify: `src/components/RealtimeStreamDashboard.tsx` (remove scheduling/publish/stage-destination/AI-caption sections; keep scraping + download controls + extension bridge)
- Modify: `src/components/DashboardPanel.tsx`, `src/components/Header.tsx`, `src/components/AccountPanel.tsx` (remove FB/IG connect, queue nav, scheduling links)
- Modify: `docs/SETUP.md` (remove scheduling/FB/IG connect/AI sections; add pointer to `posting-app/README.md`)
- Delete: anything else referencing removed features (grep `publish`, `queue`, `stage`, `fbqueue`, `schedulingConfig`, `aiCaption`, `gemini`)

**Interfaces:**
- Consumes: cleaned `server.ts` (Task 11).
- Produces: scraper app UI with only: landing, auth, dashboard (stats/credits/API token), IG/TikTok/FB scraping tabs, Setup & Build (extension ZIP), Account.

- [ ] **Step 1: App.tsx** — remove `'queue'`/`'fbqueue'`/`'stage'` tab types, nav entries, `QueuePanel`/`ContentStagePanel` imports; keep `'dashboard' | 'instagram' | 'tiktok' | 'facebook' | 'setup' | 'account'`. Fix any `activeTab` guards referencing removed tabs.

- [ ] **Step 2: RealtimeStreamDashboard.tsx** — delete: scheduling settings panel, publish mode/time controls, stage destination picker, AI caption inputs (grep `scheduling`, `stage`, `aiCaption`, `GEMINI`, `publish` within the file; remove associated state/handlers/props). Keep: platform switch, scrape controls, progress, live stats, media list, download buttons, extension bridge (`onDownloadZip`, `onNavigate`).

- [ ] **Step 3: Other components** — Header: remove queue/publish nav items. DashboardPanel: remove queue/schedule stat cards (grep `queue`/`publish` usage; keep credits/extension stats). AccountPanel: remove FB/IG connect UI (grep `facebook`, `instagram` connect; keep API token + credits + logout).

- [ ] **Step 4: `docs/SETUP.md`** — strip publishing/scheduling/FB/IG-connect/Gemini/Python sections; update env reference (remove GEMINI_API_KEY, TIKTOK_*, PYTHON_BIN); add: "Posting ab alag app mein — `posting-app/README.md` dekho".

- [ ] **Step 5: Verify**

`npm run lint` → 0. `npm run build` → OK. Boot prod on 3010; open SPA: no console errors on dashboard/IG/tiktok/fb/setup tabs; extension ZIP download still works; `/api/health` 200.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: strip posting UI from scraper app, docs update"
```

---

### Task 13: Final verification + deploy handoff

**Files:** none (verification only).

- [ ] **Step 1: Both apps verify**

- Scraper: lint + build + prod boot + health + ZIP download (as Task 11 Step 5).
- Poster: boot; health; upload→schedule→posted E2E with real FB page; re-upload → duplicates; server restart mid-queue → queue intact (Supabase).

- [ ] **Step 2: Push + deploy**

`git push origin main`. Owner actions (documented in `posting-app/README.md`):
1. Supabase: run `supabase/migrations/003_posting.sql`.
2. Koyeb: create web service from repo (root dir `posting-app`), set 3 env vars, deploy.
3. cron-job.org: ping `https://<service>.koyeb.app/api/health` every 30 min.
4. Verify: open service URL → Google login → connect FB → upload folder → post.

- [ ] **Step 3: Final commit if any fixes**

```bash
git add -A
git commit -m "chore: poster app deploy fixes"
git push origin main
```