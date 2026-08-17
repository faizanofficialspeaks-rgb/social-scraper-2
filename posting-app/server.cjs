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
