# Setup Guide

Everything you need to configure SocialScraper for production use.

---

## 1. Facebook Posting (separate app)

All Facebook posting (queue, scheduling, auto-post) lives in **`posting-app/`** — a separate, cloud-hosted app. This scraper app is **scrape + download only**.

1. Run `supabase/migrations/003_posting.sql` in the Supabase SQL Editor.
2. Deploy `posting-app/` to Koyeb (free tier) — steps: `posting-app/README.md`.
3. Workflow: scrape here → download ZIP → extract folder → drop it in the poster app → videos queue with captions auto-imported → posted 24/7 from the cloud.

## 2. Supabase (Accounts & Credits)

- Run `supabase/migrations/002_duplicate_and_bonus_guard.sql` in the SQL Editor (`https://supabase.com/dashboard/project/qclirsmxndgvuestzmwa/sql`).
- `.env`: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public) and `SUPABASE_SERVICE_ROLE_KEY` (server-only — keep secret, never expose client-side).

## 3. Production Run

```
npm run build      # bundles UI + server (dist/)
set NODE_ENV=production
set PORT=3010
node dist/server.cjs
```

## 6. Env Reference

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | – | HTTP port (default 3010) |
| `SUPABASE_URL` | ✓ | Supabase project URL |
| `SUPABASE_ANON_KEY` | ✓ | Public key (client) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Service-role key (server) — rotate if ever exposed |
| `GOOGLE_CLIENT_ID` | ✓ | Google OAuth client |
