# Easy FB Poster

Simple web app to publish Facebook Reels/posts. Runs on **localhost** — no cloud, no VPS. Supabase is used **only for login**; the queue, settings and Facebook profile live in **local PostgreSQL**.

## How it works

1. **Login** (email/password via Supabase)
2. **Connect Facebook** — paste a page token or user token (auto-converts). Multiple pages are saved — pick the posting page from the dropdown.
3. **Settings** — reels per day (default 3, max 4), gap between posts (default 2h, max 4h), random delay/jitter (default 10–60 min) and pattern times (e.g. 12:00 / 15:00 / 19:00). "Learn from posts" reads the times of already-posted videos and adopts them as the pattern.
4. **Load a folder** — give the app a local folder path (e.g. `D:\videos\batch-1`). It scans `.mp4` files directly (no upload), imports captions from `metadata.json`, skips duplicates by hash, and **auto-schedules** all videos on the pattern: each day the same times with a random 10–60 min delay, same-day gaps kept between min and max.
5. The local scheduler posts due videos every 30s while the PC is on. Per-row: Post Now, Retry, Delete, caption/time edit.

## Local Run

```bash
npm install
copy .env.example .env   # fill SUPABASE keys + local PG creds
npm start                # port 8081 (override with PORT env)
```

## Env Reference

| Var | From | Required |
|---|---|---|
| `PORT` | – | no (default 8000) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase (login only) | yes |
| `PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD` / `PG_DATABASE` | local PostgreSQL (defaults: 127.0.0.1:5433, outreachpro/outreachpro, db `fb_poster`) | no (defaults) |

## Notes

- Video files stay in your folders — the app only stores the path. Deleting a queued row removes the DB row, not the file.
- Facebook app must be in **Live mode** (public Privacy Policy URL, e.g. the Netlify static site) for real video posting; dev tokens fail with decryption/permission errors.
- Token expiry is estimated at 60 days from connect (shown in the UI with a warning below 7 days).