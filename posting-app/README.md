# Easy FB Poster

Facebook Reels/posts publish karne wala simple web app. Scraper app (extension wala) se alag — yahan sirf uploading + Facebook posting.

## Workflow

1. User scraper app se extension ZIP download karta hai → extract karta hai (clean folder: videos + metadata.json)
2. Is app mein Google se login → **Connect Facebook** (page token ya user token paste — auto page-token convert)
3. Folder **drag & drop** → videos queue mein, captions `metadata.json` se auto import (edit bhi kar sakta hai)
4. Har video pe time set (ya **Post Now**) → cloud scheduler 24/7 post karta hai
5. Dobara upload karo → sha256 hash match → **duplicate skip** (kabhi double post nahi)

## Local Run

```bash
cd posting-app
copy .env.example .env   # SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY bharo
npm install
npm start                # port 8010 (PORT env se override)
```

## Supabase Setup

- `supabase/migrations/001_init.sql` + `002_*` + `003_posting.sql` SQL Editor mein run karo
- Google provider Auth mein enabled ho (scraper app ki tarah)

## Koyeb Deploy (free, 24/7)

1. Repo GitHub pe push karo (repo: `social-scraper-2`)
2. Koyeb dashboard → **Create Web Service** → GitHub → repo select karo
3. **Root directory**: `posting-app`
4. Instance: **Free** (512 MB / 0.1 vCPU) — region Frankfurt ya Washington DC
5. Env vars (secrets):
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
6. Deploy → `https://fb-poster-<you>.koyeb.app` milega

### Keep-alive (free instance sleep nahi hone dena)

Koyeb free instance 1 ghanta koi traffic nahi → scale to zero. Isliye:

- [cron-job.org](https://cron-job.org) pe free account banao
- Job: `GET https://fb-poster-<you>.koyeb.app/api/health` — **har 30 minute**
- Isse scheduler kabhi nahi soye ga, scheduled posts waqt par publish hoti rahengi

### Manual deploy (dockerfile ke baghair)

Koyeb buildpack `npm install && npm start` khud chala leta hai — koi Dockerfile zaroorat nahi.

## Env Reference

| Var | Kahan se | Zaroori? |
|---|---|---|
| `SUPABASE_URL` | Supabase → Settings → API | Yes |
| `SUPABASE_ANON_KEY` | same (public) | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | same (secret) | Yes |
| `PORT` | 8000 (Koyeb), 8010 (local) | default hai |

## Notes

- Files ephemeral disk pe rehti hain (upload → post → delete). Koyeb redeploy pe files reset ho jati hain — queue/dedup Supabase mein hai, is liye kuch nahi bigda, bas file missing wali rows `failed` ho jati hain aur re-upload par duplicate guard ke saath wapis jaa sakti hain.
- FB token dev token (Graph API Explorer) hai to expiry hogi — long-term ke liye proper Facebook Login app chahiye.