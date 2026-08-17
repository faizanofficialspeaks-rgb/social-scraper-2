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