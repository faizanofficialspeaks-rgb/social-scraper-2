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

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[FB-POSTER] listening on http://0.0.0.0:${PORT}`);
});
