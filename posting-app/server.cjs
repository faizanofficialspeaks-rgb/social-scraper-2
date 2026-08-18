const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'privacy-policy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));
app.get('/health', (req, res) => res.json({ ok: true, service: 'fb-poster', now: new Date().toISOString() }));
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'fb-poster', now: new Date().toISOString() }));
app.get('/api/config', (req, res) => res.json({ url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY }));

const { admin } = require('./db.cjs');
const { resolvePageToken } = require('./fb.cjs');
const { pool, init } = require('./localdb.cjs');

async function requireUser(req, res, next) {
  const t = String(req.headers.authorization || '').replace(/^Bearer /i, '');
  if (!t) return res.status(401).json({ error: 'Missing token' });
  try {
    const { data, error } = await admin.auth.getUser(t);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });
    req.user = { id: data.user.id };
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

const DEFAULT_SETTINGS = {
  reels_per_day: 3,
  min_gap_minutes: 120,
  max_gap_minutes: 240,
  jitter_min: 10,
  jitter_max: 60,
  pattern: ['12:00', '15:00', '19:00'],
  auto_schedule: true,
};

async function getSettings(userId) {
  const { rows } = await pool.query('select * from settings where user_id = $1', [userId]);
  if (!rows.length) return { user_id: userId, ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...rows[0], pattern: Array.isArray(rows[0].pattern) ? rows[0].pattern : DEFAULT_SETTINGS.pattern };
}

function minutesToMs(m) { return m * 60 * 1000; }
function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function planSchedule(s, count, now) {
  const slots = [...s.pattern];
  while (slots.length < s.reels_per_day) {
    const last = slots[slots.length - 1].split(':').map(Number);
    const m = last[0] * 60 + last[1] + s.min_gap_minutes;
    if (m >= 24 * 60) break;
    slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  const daySlots = slots.slice(0, s.reels_per_day);
  const times = [];
  let day = new Date(now);
  day.setSeconds(0, 0);
  while (times.length < count) {
    let prev = null;
    for (const t of daySlots) {
      const [h, m] = t.split(':').map(Number);
      const slot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      if (slot > now) {
        let cand = new Date(slot.getTime() + randInt(s.jitter_min, s.jitter_max) * 60000);
        if (prev) {
          const gap = cand.getTime() - prev.getTime();
          if (gap < minutesToMs(s.min_gap_minutes)) cand = new Date(prev.getTime() + minutesToMs(s.min_gap_minutes));
          else if (gap > minutesToMs(s.max_gap_minutes)) cand = new Date(prev.getTime() + minutesToMs(s.max_gap_minutes));
        }
        times.push(cand);
        prev = cand;
        if (times.length >= count) break;
      }
    }
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  }
  return times;
}

// ---------- Facebook ----------

app.post('/api/fb/connect', requireUser, async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Token required' });
  try {
    const { user, page, pages } = await resolvePageToken(token);
    await pool.query(
      `insert into fb_profile (user_id, fb_user_token, fb_page_token, fb_page_id, fb_page_name, fb_pages, token_expires_at)
       values ($1,$2,$3,$4,$5,$6, now() + interval '60 days')
       on conflict (user_id) do update set
         fb_user_token = excluded.fb_user_token,
         fb_page_token = excluded.fb_page_token,
         fb_page_id = excluded.fb_page_id,
         fb_page_name = excluded.fb_page_name,
         fb_pages = excluded.fb_pages,
         token_expires_at = excluded.token_expires_at`,
      [req.user.id, user ? token : null, page.access_token, page.id, page.name, JSON.stringify(pages)]
    );
    res.json({ connected: true, page: { id: page.id, name: page.name }, pages: pages.map(p => ({ id: p.id, name: p.name })) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/fb/status', requireUser, async (req, res) => {
  const { rows } = await pool.query('select * from fb_profile where user_id = $1', [req.user.id]);
  const p = rows[0];
  res.json({
    connected: !!(p?.fb_page_id),
    page: p?.fb_page_id ? { id: p.fb_page_id, name: p.fb_page_name } : null,
    pages: (p?.fb_pages || []).map(x => ({ id: x.id, name: x.name })),
    tokenExpiresAt: p?.token_expires_at || null,
  });
});

app.post('/api/fb/select', requireUser, async (req, res) => {
  const pageId = String(req.body?.pageId || '');
  const { rows } = await pool.query('select fb_pages from fb_profile where user_id = $1', [req.user.id]);
  const pages = rows[0]?.fb_pages || [];
  const page = pages.find(p => p.id === pageId);
  if (!page) return res.status(400).json({ error: 'Page not found' });
  await pool.query('update fb_profile set fb_page_id = $1, fb_page_name = $2, fb_page_token = $3 where user_id = $4',
    [page.id, page.name, page.access_token, req.user.id]);
  res.json({ ok: true, page: { id: page.id, name: page.name } });
});

// ---------- Settings ----------

app.get('/api/settings', requireUser, async (req, res) => {
  res.json(await getSettings(req.user.id));
});

app.post('/api/settings', requireUser, async (req, res) => {
  const b = req.body || {};
  const s = {
    reels_per_day: Math.min(4, Math.max(1, Number(b.reels_per_day) || 3)),
    min_gap_minutes: Math.min(240, Math.max(60, Number(b.min_gap_minutes) || 120)),
    max_gap_minutes: Math.min(480, Math.max(Number(b.min_gap_minutes) || 120, Number(b.max_gap_minutes) || 240)),
    jitter_min: Math.min(120, Math.max(0, Number(b.jitter_min) || 10)),
    jitter_max: Math.min(120, Math.max(Number(b.jitter_min) || 10, Number(b.jitter_max) || 60)),
    pattern: (Array.isArray(b.pattern) ? b.pattern : []).filter(t => /^\d{1,2}:\d{2}$/.test(t)).slice(0, 4),
    auto_schedule: b.auto_schedule !== false,
  };
  if (!s.pattern.length) return res.status(400).json({ error: 'Pattern required (at least one time like 12:00)' });
  await pool.query(
    `insert into settings (user_id, reels_per_day, min_gap_minutes, max_gap_minutes, jitter_min, jitter_max, pattern, auto_schedule, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8, now())
     on conflict (user_id) do update set
       reels_per_day = excluded.reels_per_day,
       min_gap_minutes = excluded.min_gap_minutes,
       max_gap_minutes = excluded.max_gap_minutes,
       jitter_min = excluded.jitter_min,
       jitter_max = excluded.jitter_max,
       pattern = excluded.pattern,
       auto_schedule = excluded.auto_schedule,
       updated_at = now()`,
    [req.user.id, s.reels_per_day, s.min_gap_minutes, s.max_gap_minutes, s.jitter_min, s.jitter_max, JSON.stringify(s.pattern), s.auto_schedule]
  );
  res.json({ ok: true });
});

// ---------- Folder load (direct filesystem access) ----------

app.post('/api/folder/load', requireUser, async (req, res) => {
  const folder = String(req.body?.path || '').trim();
  if (!folder) return res.status(400).json({ error: 'Folder path required' });
  let entries;
  try { entries = fs.readdirSync(folder, { withFileTypes: true }); }
  catch { return res.status(400).json({ error: 'Folder not found or not accessible' }); }

  const files = entries.filter(e => e.isFile() && /\.mp4$/i.test(e.name)).map(e => e.name);
  let captionMap = {};
  const meta = entries.find(e => e.isFile() && /^metadata\.json$/i.test(e.name));
  if (meta) {
    try { captionMap = JSON.parse(fs.readFileSync(path.join(folder, meta.name), 'utf8').replace(/^\uFEFF/, '')); } catch { /* ignore */ }
  }
  const queued = [], duplicates = [];
  for (const name of files) {
    const fp = path.join(folder, name);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
    const caption = String(captionMap[name] || captionMap[name.toLowerCase()] || '').slice(0, 2200);
    try {
      const { rows } = await pool.query(
        `insert into queue (user_id, file_path, file_name, file_hash, caption)
         values ($1,$2,$3,$4,$5) returning id, created_at`,
        [req.user.id, fp, name, hash, caption]
      );
      queued.push(rows[0].id);
    } catch (e) {
      if (e.code === '23505') duplicates.push(name);
      else return res.status(500).json({ error: e.message });
    }
  }
  let scheduled = 0;
  const s = await getSettings(req.user.id);
  if (s.auto_schedule && queued.length) {
    const { rows } = await pool.query(`update queue set status = 'queued', scheduled_for = $2::timestamptz where id = $1 returning scheduled_for`, [queued[0], new Date()]);
    const times = planSchedule(s, queued.length, new Date());
    for (let i = 0; i < queued.length; i++) {
      if (times[i]) await pool.query('update queue set scheduled_for = $2 where id = $1', [queued[i], times[i].toISOString()]);
    }
    scheduled = Math.min(queued.length, times.length);
  }
  res.json({ queued: queued.length, duplicates: duplicates.length, scheduled, skipped: files.length - queued.length - duplicates.length });
});

// ---------- Queue ----------

app.get('/api/queue', requireUser, async (req, res) => {
  const { rows } = await pool.query(
    'select * from queue where user_id = $1 order by created_at desc limit 500',
    [req.user.id]
  );
  res.json({ rows });
});

app.post('/api/queue/:id/now', requireUser, async (req, res) => {
  await pool.query(
    `update queue set scheduled_for = now(), status = 'queued' where id = $1 and user_id = $2 and status = 'queued'`,
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

app.post('/api/queue/:id/retry', requireUser, async (req, res) => {
  await pool.query(
    `update queue set scheduled_for = now(), status = 'queued', error = null, retry_count = 0 where id = $1 and user_id = $2 and status = 'failed'`,
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

app.patch('/api/queue/:id/schedule', requireUser, async (req, res) => {
  const when = new Date(req.body?.scheduled_for);
  if (isNaN(when)) return res.status(400).json({ error: 'Bad time' });
  await pool.query(
    `update queue set scheduled_for = $3 where id = $1 and user_id = $2 and status in ('queued','failed')`,
    [req.params.id, req.user.id, when.toISOString()]
  );
  res.json({ ok: true });
});

app.patch('/api/queue/:id/caption', requireUser, async (req, res) => {
  const caption = String(req.body?.caption || '').slice(0, 2200);
  await pool.query(
    `update queue set caption = $3 where id = $1 and user_id = $2 and status in ('queued','failed')`,
    [req.params.id, req.user.id, caption]
  );
  res.json({ ok: true });
});

app.delete('/api/queue/:id', requireUser, async (req, res) => {
  await pool.query(
    `delete from queue where id = $1 and user_id = $2 and status in ('queued','failed','duplicate')`,
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

// ---------- Manual upload (dropzone fallback) ----------

const UPLOAD_ROOT = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_ROOT),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

app.post('/api/upload', requireUser, upload.fields([{ name: 'files', maxCount: 200 }, { name: 'metadata', maxCount: 1 }]), async (req, res) => {
  const uploaded = (req.files?.files || []);
  const files = uploaded.filter(f => /\.mp4$/i.test(f.originalname));
  const skipped = uploaded.filter(f => !/\.mp4$/i.test(f.originalname)).map(f => f.originalname);
  let captionMap = {};
  const metaFile = req.files?.metadata?.[0];
  const metaText = metaFile ? fs.readFileSync(metaFile.path, 'utf8') : String(req.body.metadata || '');
  try { captionMap = JSON.parse(metaText.replace(/^\uFEFF/, '')); } catch { /* ignore */ }
  const queued = [], duplicates = [];
  for (const f of files) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(f.path)).digest('hex');
    const caption = String(captionMap[f.originalname] || captionMap[f.originalname.toLowerCase()] || '').slice(0, 2200);
    try {
      const { rows } = await pool.query(
        `insert into queue (user_id, file_path, file_name, file_hash, caption)
         values ($1,$2,$3,$4,$5) returning id`,
        [req.user.id, f.path, f.originalname, hash, caption]
      );
      queued.push(rows[0].id);
    } catch (e) {
      if (e.code === '23505') { duplicates.push(f.originalname); fs.unlinkSync(f.path); }
      else return res.status(500).json({ error: e.message });
    }
  }
  const s = await getSettings(req.user.id);
  let scheduled = 0;
  if (s.auto_schedule && queued.length) {
    const times = planSchedule(s, queued.length, new Date());
    for (let i = 0; i < queued.length; i++) {
      if (times[i]) await pool.query('update queue set scheduled_for = $2 where id = $1', [queued[i], times[i].toISOString()]);
    }
    scheduled = Math.min(queued.length, times.length);
  }
  res.json({ rows: [], queued: queued.length, duplicates, skipped, scheduled });
});

// ---------- Thumbnail (resolve file path from DB only) ----------

app.get('/uploads/:id', async (req, res) => {
  const m = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(req.params.id);
  if (!m) return res.status(400).json({ error: 'Bad id' });
  const { rows } = await pool.query('select file_path from queue where id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.sendFile(rows[0].file_path, err => { if (err) res.status(404).json({ error: 'File missing' }); });
});

// ---------- Static + start ----------

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8000;
init().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[FB-POSTER] listening on http://0.0.0.0:${PORT}`);
    const { startScheduler } = require('./scheduler.cjs');
    startScheduler();
  });
}).catch(e => {
  console.error('[FB-POSTER] DB init failed:', e.message);
  process.exit(1);
});