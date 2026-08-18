const fs = require('fs');
const { pool } = require('./localdb.cjs');
const { postWithRetry } = require('./publisher.cjs');

const TEN_MIN = 10 * 60 * 1000;

async function processRow(row) {
  await pool.query(`update queue set status = 'processing' where id = $1`, [row.id]);
  const { rows: prof } = await pool.query('select fb_page_token, fb_page_id from fb_profile where user_id = $1', [row.user_id]);
  if (!prof.length || !prof[0].fb_page_token || !prof[0].fb_page_id) {
    await pool.query(`update queue set status = 'failed', error = 'Facebook not connected' where id = $1`, [row.id]);
    return;
  }
  if (!fs.existsSync(row.file_path)) {
    await pool.query(`update queue set status = 'failed', error = 'Video file not found - check folder path' where id = $1`, [row.id]);
    return;
  }
  try {
    const { postId } = await postWithRetry({ pageId: prof[0].fb_page_id, pageToken: prof[0].fb_page_token, filePath: row.file_path, caption: row.caption });
    await pool.query(
      `update queue set status = 'posted', fb_post_id = $2, posted_at = now() where id = $1`,
      [row.id, postId]
    );
  } catch (err) {
    const retries = Number(row.retry_count || 0);
    await pool.query(
      `update queue set status = 'failed', error = $2, retry_count = $3 where id = $1`,
      [row.id, String(err.message || err).slice(0, 500), retries + 1]
    );
  }
}

async function runDue() {
  await pool.query(
    `update queue set status = 'failed', error = 'Timeout - retry manually'
     where status = 'processing' and created_at < now() - interval '10 minutes'`
  );
  const { rows: due } = await pool.query(
    `select * from queue where status = 'queued' and scheduled_for <= now()
     order by scheduled_for limit 5`
  );
  for (const row of due) {
    try { await processRow(row); } catch (e) { console.error('[SCHED] row failed', row.id, e.message); }
  }
}

function startScheduler() {
  setInterval(() => { runDue().catch(e => console.error('[SCHED] loop error', e.message)); }, 30_000);
  runDue().catch(e => console.error('[SCHED] first run error', e.message));
  console.log('[SCHED] scheduler started (30s interval)');
}

module.exports = { startScheduler, runDue };