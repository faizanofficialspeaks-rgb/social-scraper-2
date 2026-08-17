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