const path = require('path');
const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'fb-poster', now: new Date().toISOString() });
});

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

app.post('/api/upload', requireUser, upload.fields([{ name: 'files', maxCount: 200 }, { name: 'metadata', maxCount: 1 }]), async (req, res) => {
  const uploaded = (req.files?.files || []);
  const files = uploaded.filter(f => /\.mp4$/i.test(f.originalname));
  const skipped = uploaded.filter(f => !/\.mp4$/i.test(f.originalname)).map(f => f.originalname);
  let captionMap = {};
  const metaFile = req.files?.metadata?.[0];
  const metaText = metaFile ? fs.readFileSync(metaFile.path, 'utf8') : String(req.body.metadata || '');
  try { captionMap = JSON.parse(metaText.replace(/^\uFEFF/, '')); } catch { /* ignore bad metadata */ }
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
    const dir = path.join(UPLOAD_ROOT, req.user.id);
    const stored = path.join(dir, `${data.id}.mp4`);
    fs.renameSync(f.path, stored);
    rows.push(data);
  }
  res.json({ rows, skipped, duplicates });
});

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

app.delete('/api/queue/:id', requireUser, async (req, res) => {
  const { error } = await admin
    .from('post_queue')
    .delete()
    .eq('id', req.params.id).eq('user_id', req.user.id)
    .eq('status', 'queued');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[FB-POSTER] listening on http://0.0.0.0:${PORT}`);
});

const { startScheduler } = require('./scheduler.cjs');
startScheduler();
