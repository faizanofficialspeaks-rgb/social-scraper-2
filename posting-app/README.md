# Easy FB Poster

Simple web app to publish Facebook Reels/posts. Separate from the scraper app (extension one) — here it is only uploading + Facebook posting. Runs on **localhost** — no cloud, no VPS.

## Workflow

1. User downloads the extension ZIP from the scraper app → extracts it (clean folder: videos + metadata.json)
2. In this app: login (email/password) → **Connect Facebook** (page token or user token — auto page-token conversion)
3. Folder **drag & drop** → videos go into the queue, captions auto-imported from `metadata.json` (editable)
4. Set a time per video (or **Post Now**) → the local scheduler posts it while the PC is on
5. Re-upload → sha256 hash match → **duplicate skipped** (never double-posted)

## Local Run

```bash
cd posting-app
copy .env.example .env   # fill SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY
npm install
npm start                # port 8010 (override with PORT env)
```

## Supabase Setup

- Run `supabase/migrations/001_init.sql` + `002_*` + `003_posting.sql` in the SQL Editor
- Email/password provider enabled in Auth

## Env Reference

| Var | From | Required |
|---|---|---|
| `SUPABASE_URL` | Supabase → Settings → API | Yes |
| `SUPABASE_ANON_KEY` | same (public) | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | same (secret) | Yes |
| `PORT` | 8010 (local) | default |

## Notes

- Video files live in the local `uploads/` folder (upload → post → delete). The queue/dedup lives in Supabase.
- FB dev token (Graph API Explorer) expires — for permanent access use a proper Facebook Login app. Facebook app must be in **Live mode** (requires a public Privacy Policy URL, e.g. the Netlify static site) for real video posting.
