const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PG_HOST || '127.0.0.1',
  port: Number(process.env.PG_PORT || 5433),
  user: process.env.PG_USER || 'outreachpro',
  password: process.env.PG_PASSWORD || 'outreachpro',
  database: process.env.PG_DATABASE || 'fb_poster',
  max: 10,
});

async function init() {
  await pool.query(`
    create table if not exists queue (
      id            uuid primary key default gen_random_uuid(),
      user_id       text not null,
      file_path     text not null,
      file_name     text not null,
      file_hash     text not null,
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
    create index if not exists queue_due_idx on queue (user_id, status, scheduled_for);

    create table if not exists settings (
      user_id           text primary key,
      reels_per_day     int not null default 3,
      min_gap_minutes   int not null default 120,
      max_gap_minutes   int not null default 240,
      jitter_min        int not null default 10,
      jitter_max        int not null default 60,
      pattern           jsonb not null default '["12:00","15:00","19:00"]',
      auto_schedule     boolean not null default true,
      updated_at        timestamptz not null default now()
    );

    create table if not exists fb_profile (
      user_id           text primary key,
      fb_user_token     text,
      fb_page_token     text,
      fb_page_id        text,
      fb_page_name      text,
      fb_pages          jsonb,
      token_expires_at  timestamptz
    );
  `);
}

module.exports = { pool, init };