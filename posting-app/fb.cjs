const fs = require('fs');

async function fbGet(url) {
  const res = await fetch(url);
  return res.json();
}

async function resolvePageToken(token) {
  const me = await fbGet(`https://graph.facebook.com/v21.0/me?fields=name,id&access_token=${encodeURIComponent(token)}`);
  if (!me || me.error || !me.id) throw new Error(me?.error?.message || 'Invalid Facebook token');
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
