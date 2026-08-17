# UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Landing-tab flow with a Dashboard-first UX: analytics home, per-item stage destinations, unified IG+FB queue with smart daily scheduling, duplicate-post warnings, and AI-caption gating.

**Architecture:** React SPA (`src/`) + single Express server (`server.ts`, tsx). All persistence is JSON files on the server (`.publish-queue.json`, `.content-stage.json`, new `.scheduling-config.json`, new `.analytics.json`) plus Supabase for auth/credits. UI polls status endpoints every 5s and listens on `BroadcastChannel('IG_SCRAPER_LIVE_SYNC')`.

**Tech Stack:** React 19 + Vite + Tailwind 4, lucide-react icons, Express, tsx. **No new dependencies** — charts are pure SVG (no Recharts).

## Global Constraints

- Port **3010** (`PORT=3010`), server run via `node node_modules/tsx/dist/cli.mjs server.ts`. Restart after every server change.
- `npm run lint` (tsc --noEmit) and `npm run build` must exit 0 before any task is marked done.
- No test framework exists — verification = node fetch scripts against the running server (temp dir `C:\Users\FAIZAN~1\AppData\Local\Temp\opencode\`) + manual UI checks.
- No comments in code unless asked. Follow existing Tailwind design language (`bg-[#F5F2ED]`, `border-[#1A1A1A]/15`, `font-mono` labels, `text-[10px] uppercase tracking-[0.2em]`).
- Do NOT use agent-browser or agent-os skills. No new npm packages.
- Keep duplicate-queue idempotency (SHA-256 `generateIdempotencyKey` + `findByIdempotencyKey` returning `duplicate:true`) — extend, don't replace.
- Tab rename: `autopost` → `queue`, `fbpost` → `fbqueue`. New tab `dashboard`. `home` tab is deleted.
- PowerShell encoding pitfall: never `Set-Content` code files; use the edit/write tools.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server.ts` | Modify | Analytics tracking + `/api/analytics/dashboard`, stage `destination`, scheduling engine + config endpoints, queue destination/duplicate-warning fields, `aiCaptionAvailable` |
| `src/components/Sidebar.tsx` | Modify | New `AppTab` union, Dashboard group, Queue groups, remove Home |
| `src/App.tsx` | Modify | Default `dashboard` after auth, remove `home`/`autopost`/`fbpost` render paths |
| `src/components/DashboardPanel.tsx` | Create | 8 metric cards, SVG time-series chart, quick actions |
| `src/components/ContentStagePanel.tsx` | Modify | Per-item destination select + global override bar, updated onNavigate |
| `src/components/QueuePanel.tsx` | Create | Unified queue (absorbs AutoPostPanel + FacebookPostPanel) |
| `src/components/AutoPostPanel.tsx` | Delete | Merged into QueuePanel |
| `src/components/FacebookPostPanel.tsx` | Delete | Merged into QueuePanel |
| `docs/SETUP.md` | Create | GEMINI_API_KEY guide + scheduling config docs |
| `.scheduling-config.json` | New (runtime) | SchedulingConfig persisted |
| `.analytics.json` | New (runtime) | Per-day download/scrape counters |

---

### Task 1: Server — Analytics tracking + `/api/analytics/dashboard`

**Files:**
- Modify: `server.ts` (near credit endpoints ~line 290; near `/api/media/download` ~line 854; near stage upsert ~line 1876; before `loadContentStage()` ~line 2071)

**Interfaces:**
- Produces: `trackAnalytics(kind: 'scrape' | 'download', n?: number): void`; `GET /api/analytics/dashboard` → `{ success, month: { scraped, published, failed, downloads }, credits: { remaining, used }, queueHealth: { queued, publishing, scheduled }, perPlatform: {...}, timeSeries: Array<{ date: string, scraped, published, failed, downloads }> }` (timeSeries covers last 30 days, oldest first, days with zero activity included as 0)

- [ ] **Step 1: Add analytics helpers after the rate limiter definitions (~line 220 area, before `/api/auth/me`)**

```ts
// ==========================================
// ANALYTICS (in-memory + .analytics.json persistence)
// ==========================================
const ANALYTICS_FILE = path.join(process.cwd(), '.analytics.json');
interface DayCounters { scraped: number; downloads: number }
let analyticsDays = new Map<string, DayCounters>();

function loadAnalytics() {
  try {
    if (!fs.existsSync(ANALYTICS_FILE)) return;
    const data = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
    if (data && typeof data === 'object') {
      analyticsDays = new Map(Object.entries(data));
    }
  } catch (e) { console.warn('[ANALYTICS] Could not load:', e); }
}

function saveAnalytics() {
  try {
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(Object.fromEntries(analyticsDays), null, 2), 'utf8');
  } catch (e) { console.warn('[ANALYTICS] Could not persist:', e); }
}

function dayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function trackAnalytics(kind: 'scrape' | 'download', n = 1) {
  const key = dayKey();
  const cur = analyticsDays.get(key) || { scraped: 0, downloads: 0 };
  if (kind === 'scrape') cur.scraped += n;
  else cur.downloads += n;
  analyticsDays.set(key, cur);
  saveAnalytics();
}
```

- [ ] **Step 2: Call `trackAnalytics('download')` in `/api/media/download`**

In the handler at line ~854, after a successful download is served (find the line after the file write/send succeeds, before `res.json` or in the success path):

```ts
trackAnalytics('download');
```

- [ ] **Step 3: Call `trackAnalytics('scrape')` in `/api/stage/upsert`**

In `app.post('/api/stage/upsert')` (line ~1876), after the dedup filter keeps new items (after the loop that adds to `contentStage`), add:

```ts
trackAnalytics('scrape', addedCount);
```

Where `addedCount` is the number of items actually added (count inside the add loop, e.g. `let addedCount = 0;` incremented when a new item is inserted).

- [ ] **Step 4: Add `GET /api/analytics/dashboard` endpoint before `/api/stage/upsert`**

```ts
app.get('/api/analytics/dashboard', (req, res) => {
  try {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const items = Array.from(publishQueue.values());
    const monthPosted = items.filter((i) => i.status === 'posted' && i.postedAt && i.postedAt >= monthStart);
    const monthFailed = items.filter((i) => i.status === 'failed' && i.postedAt && i.postedAt >= monthStart);

    let monthScraped = 0;
    let monthDownloads = 0;
    const timeSeries: Array<{ date: string; scraped: number; published: number; failed: number; downloads: number }> = [];
    for (let d = 29; d >= 0; d--) {
      const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
      const key = dayKey(dt);
      const counters = analyticsDays.get(key) || { scraped: 0, downloads: 0 };
      const dayItems = items.filter((i) => i.postedAt && dayKey(new Date(i.postedAt)) === key);
      const entry = {
        date: key,
        scraped: counters.scraped,
        published: dayItems.filter((i) => i.status === 'posted').length,
        failed: dayItems.filter((i) => i.status === 'failed').length,
        downloads: counters.downloads,
      };
      timeSeries.push(entry);
      if (key.startsWith(monthKey)) {
        monthScraped += entry.scraped;
        monthDownloads += entry.downloads;
      }
    }

    const stageCounts = Array.from(contentStage.values()).reduce<Record<string, number>>(
      (acc, s) => { acc[s.platform] = (acc[s.platform] || 0) + 1; return acc; },
      {},
    );

    res.json({
      success: true,
      month: { scraped: monthScraped, published: monthPosted.length, failed: monthFailed.length, downloads: monthDownloads },
      credits: null, // filled by UI from /api/auth/me
      queueHealth: {
        queued: items.filter((i) => i.status === 'queued' && i.scheduledAt > Date.now()).length,
        publishing: items.filter((i) => ['downloading', 'publishing'].includes(i.status)).length,
        scheduled: items.filter((i) => i.status === 'queued').length,
      },
      perPlatform: {
        instagram: monthPosted.filter((i) => i.platform === 'instagram').length,
        facebook: monthPosted.filter((i) => i.platform === 'facebook').length,
        stage: stageCounts,
      },
      timeSeries,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 5: Call `loadAnalytics()` next to `loadContentStage()`**

Change `loadContentStage();` (line 2071) to:

```ts
loadAnalytics();
loadContentStage();
```

- [ ] **Step 6: Verify server compiles and endpoint returns data**

Run: `npm run lint` → expect 0 errors.
Restart server (`PORT=3010 node node_modules/tsx/dist/cli.mjs server.ts` in a window), then run a temp node script (`C:\Users\FAIZAN~1\AppData\Local\Temp\opencode\analytics-test.js`):

```js
const res = await fetch('http://127.0.0.1:3010/api/analytics/dashboard');
const data = await res.json();
console.log('SUCCESS:', data.success, '| month:', JSON.stringify(data.month), '| series days:', data.timeSeries.length);
if (!data.success || data.timeSeries.length !== 30) process.exit(1);
console.log('ANALYTICS TEST PASS');
```

Expected: `SUCCESS: true` and 30 series entries.

- [ ] **Step 7: Commit**

```bash
git add server.ts
git commit -m "feat: analytics tracking and dashboard endpoint"
```

---

### Task 2: Sidebar — new AppTab union, Dashboard group, Queue rename

**Files:**
- Modify: `src/components/Sidebar.tsx` (whole file, lines 1-125)

**Interfaces:**
- Produces: `export type AppTab = 'dashboard' | 'instagram' | 'tiktok' | 'facebook' | 'stage' | 'queue' | 'fbqueue' | 'setup'`; `Sidebar` props unchanged `{ activeTab, setActiveTab }`

- [ ] **Step 1: Replace the AppTab type and groups**

Replace lines 1-62 (imports + component start through the `groups` array) with:

```tsx
import React from 'react';
import { Radio, Send, Facebook, Layers, LibraryBig, Cog, BarChart2 } from 'lucide-react';

export type AppTab = 'dashboard' | 'instagram' | 'tiktok' | 'facebook' | 'stage' | 'queue' | 'fbqueue' | 'setup';

interface SidebarProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
}

interface NavItem {
  id: AppTab;
  label: string;
  icon: React.ReactNode;
  color: string;
}

interface NavGroup {
  step?: string;
  title: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const groups: NavGroup[] = [
    {
      title: 'Overview',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: <BarChart2 className="w-4 h-4" />, color: 'text-[#19A76C]' },
      ],
    },
    {
      step: '1',
      title: 'Scrape',
      items: [
        { id: 'instagram', label: 'Instagram', icon: <Radio className="w-4 h-4" />, color: 'text-[#FF6321]' },
        { id: 'tiktok', label: 'TikTok', icon: <Radio className="w-4 h-4" />, color: 'text-[#FF0050]' },
        { id: 'facebook', label: 'Facebook', icon: <Facebook className="w-4 h-4" />, color: 'text-[#1877F2]' },
      ],
    },
    {
      step: '2',
      title: 'Curate',
      items: [
        { id: 'stage', label: 'Content Stage', icon: <LibraryBig className="w-4 h-4" />, color: 'text-[#19A76C]' },
      ],
    },
    {
      step: '3',
      title: 'Queue & Post',
      items: [
        { id: 'queue', label: 'Unified Queue', icon: <Send className="w-4 h-4" />, color: 'text-[#19A76C]' },
        { id: 'fbqueue', label: 'Facebook Only', icon: <Send className="w-4 h-4" />, color: 'text-[#1877F2]' },
      ],
    },
    {
      title: 'Settings',
      items: [
        { id: 'setup', label: 'Setup & Build', icon: <Cog className="w-4 h-4" />, color: 'text-amber-500' },
      ],
    },
  ];
```

(Keep the rest of the component — the render JSX from line 64 — unchanged; it is generic over `groups`.)

- [ ] **Step 2: Update the workflow footer text**

Replace `Scrape → Curate (Stage) → Schedule &amp; Auto-Post. Every post follows this flow.` with:

```tsx
Scrape → Curate (Stage) → Queue &amp; Auto-Post. Dashboard shows your month at a glance.
```

- [ ] **Step 3: Verify**

Run: `npm run lint` → expect 0 errors (App.tsx still references old tabs — it fails; that's expected, Task 3 fixes it. Skip lint here and verify after Task 3.)

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: new AppTab union with dashboard + unified queue"
```

---

### Task 3: App.tsx — dashboard-first flow, remove home/autopost/fbpost

**Files:**
- Modify: `src/App.tsx` (lines 1-247)

**Interfaces:**
- Consumes: `AppTab` from Sidebar; `QueuePanel` (Task 8); `DashboardPanel` (Task 4)
- Produces: after auth → `activeTab` defaults to `'dashboard'`; `handleNavigate` no longer special-cases `'home'`; ContentStagePanel receives `onNavigate` typed to `(tab: AppTab) => void`

- [ ] **Step 1: Change default tab and navigation logic**

Replace lines 29-65 with:

```tsx
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [isZipping, setIsZipping] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const { user, devMode, loading } = useAuth();
  const [view, setView] = useState<'landing' | 'auth' | 'app'>('landing');
  const [devEntered, setDevEntered] = useState(false);

  const authed = !!user || (devMode && devEntered);

  // Landing → Auth → App flow (dashboard is the default tab once inside)
  const handleNavigate = (tab: AppTab) => {
    if (!authed) {
      setView('auth');
      return;
    }
    setActiveTab(tab);
    setView('app');
  };

  const handleLandingCta = () => {
    if (authed) {
      setActiveTab('dashboard');
      setView('app');
    } else {
      setView('auth');
    }
  };

  useEffect(() => {
    if (view === 'app' && !authed && !loading) setView('auth');
    if (view === 'app' && authed && !['dashboard', 'instagram', 'tiktok', 'facebook', 'stage', 'queue', 'fbqueue', 'setup'].includes(activeTab)) setActiveTab('dashboard');
  }, [authed, loading, view, activeTab]);
```

- [ ] **Step 2: Update AuthPage onBack/onAuthed**

Replace the `AuthPage` props (lines 177-182):

```tsx
      <AuthPage
        onBack={() => setActiveTab('dashboard')}
        onAuthed={() => setActiveTab('dashboard')}
        onDevEnter={onDevEnter}
      />
```

- [ ] **Step 3: Update main render — dashboard, queue, remove old tabs**

Replace lines 203-234 with:

```tsx
          {activeTab === 'dashboard' && (
            <DashboardPanel
              onNavigate={setActiveTab}
              onDownloadZip={handleDownloadZip}
              isZipping={isZipping}
            />
          )}
          {activeTab === 'instagram' && <RealtimeStreamDashboard key="instagram" defaultPlatform="instagram" onPlatformChange={setActiveTab as any} onDownloadZip={handleDownloadZip} onNavigate={setActiveTab} />}
          {activeTab === 'tiktok' && <RealtimeStreamDashboard key="tiktok" defaultPlatform="tiktok" onPlatformChange={setActiveTab as any} onDownloadZip={handleDownloadZip} onNavigate={setActiveTab} />}
          {activeTab === 'facebook' && <RealtimeStreamDashboard key="facebook" defaultPlatform="facebook" onPlatformChange={setActiveTab as any} onDownloadZip={handleDownloadZip} onNavigate={setActiveTab} />}
          {activeTab === 'stage' && (
            <div className="space-y-8">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-[#19A76C] border border-[#19A76C]/40 bg-[#19A76C]/10 px-2 py-1">
                    Step 2 · Curate
                  </span>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-[#1A1A1A]/40">
                    Edit posts from Step 1 (Scrape) → send to Step 3 (Queue)
                  </span>
                </div>
                <h2 className="font-serif text-3xl font-normal tracking-tight text-[#1A1A1A]">Content Stage</h2>
                <p className="text-sm text-[#1A1A1A]/60 mt-1 font-sans">
                  Scraped posts are auto-collected here. Select, reorder, fix captions and tags, choose where to post, then push to the queue.
                </p>
              </div>
              <ContentStagePanel onNavigate={setActiveTab} />
            </div>
          )}
          {activeTab === 'queue' && <QueuePanel platformFilter="all" />}
          {activeTab === 'fbqueue' && <QueuePanel platformFilter="facebook" />}
          {activeTab === 'setup' && (
            <div className="space-y-12">
              <AccountPanel />
              <ExtensionDownloader onDownloadZip={handleDownloadZip} isZipping={isZipping} />
              <TestingGuide />
            </div>
          )}
```

- [ ] **Step 4: Update imports**

Replace the import block (lines 11-17):

```tsx
import { AutoPostPanel } from './components/AutoPostPanel';
import { FacebookPostPanel } from './components/FacebookPostPanel';
import { ContentStagePanel } from './components/ContentStagePanel';
```

with:

```tsx
import { ContentStagePanel } from './components/ContentStagePanel';
import { DashboardPanel } from './components/DashboardPanel';
import { QueuePanel } from './components/QueuePanel';
```

Also remove the now-unused `LandingPage` import only if lint complains — `LandingPage` is still used at line 171 (`view === 'landing'`) so keep it.

- [ ] **Step 5: Verify lint passes (DashboardPanel/QueuePanel missing is OK until Tasks 4/8)**

Run: `npm run lint` → expect only unresolved-module errors for `./components/DashboardPanel` and `./components/QueuePanel` (both created in later tasks). Any other error → fix.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: dashboard-first app flow"
```

---

### Task 4: DashboardPanel — metric cards + SVG chart + quick actions

**Files:**
- Create: `src/components/DashboardPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/analytics/dashboard`, `GET /api/auth/me` (for credits), `AppTab` (navigate)
- Produces: `DashboardPanel` with props `{ onNavigate: (tab: AppTab) => void; onDownloadZip: () => Promise<void>; isZipping: boolean }`

- [ ] **Step 1: Create the component**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart2, Download, Send, LibraryBig, Loader2, TrendingUp, TrendingDown, Clock, Zap, Radio,
} from 'lucide-react';
import { API_BASE } from '../lib/apiBase';
import type { AppTab } from './Sidebar';

interface DashboardData {
  success: boolean;
  month: { scraped: number; published: number; failed: number; downloads: number };
  queueHealth: { queued: number; publishing: number; scheduled: number };
  perPlatform: { instagram: number; facebook: number; stage: Record<string, number> };
  timeSeries: Array<{ date: string; scraped: number; published: number; failed: number; downloads: number }>;
}

interface DashboardPanelProps {
  onNavigate: (tab: AppTab) => void;
  onDownloadZip: () => Promise<void>;
  isZipping: boolean;
}

const CARD =
  'border border-[#1A1A1A]/15 bg-white p-5 flex flex-col gap-1';

const metricIcon = (icon: React.ReactNode, color: string) => (
  <span className={`w-8 h-8 flex items-center justify-center border ${color}`}>{icon}</span>
);

export const DashboardPanel: React.FC<DashboardPanelProps> = ({ onNavigate, onDownloadZip, isZipping }) => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [dRes, cRes] = await Promise.all([
        fetch(`${API_BASE}/api/analytics/dashboard`),
        fetch(`${API_BASE}/api/auth/me`),
      ]);
      const d = await dRes.json();
      if (d.success) setData(d);
      if (cRes.ok) {
        const c = await cRes.json();
        setCredits(c.credits ?? null);
      }
    } catch {
      /* server down */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 15000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const series = data?.timeSeries || [];
  const maxVal = Math.max(1, ...series.map((s) => Math.max(s.scraped, s.published, s.failed, s.downloads)));
  const W = 600;
  const H = 140;
  const pts = (key: 'scraped' | 'published' | 'failed' | 'downloads', color: string) => {
    if (series.length < 2) return null;
    const stepX = W / (series.length - 1);
    const coords = series.map((s, i) => ({
      x: Math.round(i * stepX),
      y: H - Math.round((s[key] / maxVal) * (H - 12)) - 6,
    }));
    const path = coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    return { path, color };
  };
  const lines = [pts('scraped', '#19A76C'), pts('published', '#FF6321'), pts('failed', '#dc2626'), pts('downloads', '#1877F2')].filter(Boolean) as Array<{ path: string; color: string }>;

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-[#19A76C] border border-[#19A76C]/40 bg-[#19A76C]/10 px-2 py-1">
            Overview
          </span>
          <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-[#1A1A1A]/40 hidden md:inline">
            This month at a glance
          </span>
        </div>
        <h2 className="font-serif text-3xl font-normal tracking-tight text-[#1A1A1A]">Dashboard</h2>
        <p className="text-sm text-[#1A1A1A]/60 mt-1 font-sans">
          Scrapes, publishes, downloads and queue health — refreshed automatically.
        </p>
      </div>

      {loading && !data ? (
        <div className="py-16 text-center text-sm text-[#1A1A1A]/40 font-sans flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading dashboard…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className={CARD}>
              {metricIcon(<Radio className="w-4 h-4" />, 'text-[#FF6321] border-[#FF6321]/40')}
              <span className="text-2xl font-mono font-bold text-[#1A1A1A]">{data?.month.scraped ?? 0}</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#1A1A1A]/50">Scraped this month</span>
            </div>
            <div className={CARD}>
              {metricIcon(<Send className="w-4 h-4" />, 'text-[#19A76C] border-[#19A76C]/40')}
              <span className="text-2xl font-mono font-bold text-[#1A1A1A]">{data?.month.published ?? 0}</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#1A1A1A]/50">Published (IG+FB)</span>
            </div>
            <div className={CARD}>
              {metricIcon(<TrendingDown className="w-4 h-4" />, 'text-red-600 border-red-300')}
              <span className="text-2xl font-mono font-bold text-[#1A1A1A]">{data?.month.failed ?? 0}</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#1A1A1A]/50">Failed posts</span>
            </div>
            <div className={CARD}>
              {metricIcon(<Download className="w-4 h-4" />, 'text-[#1877F2] border-[#1877F2]/40')}
              <span className="text-2xl font-mono font-bold text-[#1A1A1A]">{data?.month.downloads ?? 0}</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#1A1A1A]/50">Downloads</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={CARD}>
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#1A1A1A]/50">Credits</span>
              <span className="text-2xl font-mono font-bold text-[#1A1A1A]">
                {credits === null ? '—' : credits}
              </span>
              <span className="text-[10px] font-mono text-[#1A1A1A]/40">remaining · 1 video = 1 credit</span>
            </div>
            <div className={CARD}>
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#1A1A1A]/50">Queue health</span>
              <div className="flex items-center gap-3 flex-wrap text-[11px] font-mono font-bold">
                <span className="flex items-center gap-1 text-[#1A1A1A]/70"><Clock className="w-3 h-3" /> {data?.queueHealth.queued ?? 0} scheduled</span>
                <span className="flex items-center gap-1 text-amber-600"><Zap className="w-3 h-3" /> {data?.queueHealth.publishing ?? 0} publishing</span>
              </div>
              <span className="text-[10px] font-mono text-[#1A1A1A]/40">{data?.queueHealth.scheduled ?? 0} total in queue</span>
            </div>
            <div className={CARD}>
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#1A1A1A]/50">Platform split (month)</span>
              <div className="flex items-center gap-3 text-[11px] font-mono font-bold">
                <span className="flex items-center gap-1 text-[#FF6321]"><TrendingUp className="w-3 h-3" /> IG {data?.perPlatform.instagram ?? 0}</span>
                <span className="flex items-center gap-1 text-[#1877F2]"><TrendingUp className="w-3 h-3" /> FB {data?.perPlatform.facebook ?? 0}</span>
              </div>
              <span className="text-[10px] font-mono text-[#1A1A1A]/40">IG stage: {data?.perPlatform.stage?.instagram ?? 0} · TT: {data?.perPlatform.stage?.tiktok ?? 0} · FB: {data?.perPlatform.stage?.facebook ?? 0}</span>
            </div>
          </div>

          <section className="border border-[#1A1A1A]/15 bg-white p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="font-serif text-lg font-normal tracking-tight flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-[#19A76C]" /> Last 30 days
              </h3>
              <div className="flex items-center gap-3 text-[9px] font-bold uppercase tracking-wider text-[#1A1A1A]/50">
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-[#19A76C] inline-block" /> scraped</span>
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-[#FF6321] inline-block" /> published</span>
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-red-600 inline-block" /> failed</span>
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-[#1877F2] inline-block" /> downloads</span>
              </div>
            </div>
            {lines.length >= 2 ? (
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Activity over last 30 days">
                {lines.map((l, i) => (
                  <path key={i} d={l.path} fill="none" stroke={l.color} strokeWidth="2" />
                ))}
              </svg>
            ) : (
              <div className="py-10 text-center text-sm text-[#1A1A1A]/40 font-sans">
                Not enough data yet — scrape or post something and check back.
              </div>
            )}
          </section>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button
              onClick={() => onNavigate('instagram')}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-[#1A1A1A] text-white hover:bg-black font-sans text-[11px] uppercase tracking-[0.2em] font-bold transition-colors cursor-pointer"
            >
              <Radio className="w-4 h-4" /> Start Scraping
            </button>
            <button
              onClick={() => onNavigate('stage')}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-[#19A76C] text-white hover:bg-[#148a59] font-sans text-[11px] uppercase tracking-[0.2em] font-bold transition-colors cursor-pointer"
            >
              <LibraryBig className="w-4 h-4" /> Content Stage
            </button>
            <button
              onClick={() => onNavigate('queue')}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-[#FF6321] text-white hover:bg-[#e5541a] font-sans text-[11px] uppercase tracking-[0.2em] font-bold transition-colors cursor-pointer"
            >
              <Zap className="w-4 h-4" /> Open Queue
            </button>
            <button
              onClick={onDownloadZip}
              disabled={isZipping}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-[#F5F2ED] border border-[#1A1A1A]/20 hover:bg-[#1A1A1A]/5 font-sans text-[11px] uppercase tracking-[0.2em] font-bold transition-colors cursor-pointer disabled:opacity-50"
            >
              {isZipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Extension ZIP
            </button>
          </div>
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Verify lint + quick smoke**

Run: `npm run lint` → expect 0 errors (App.tsx now resolves both DashboardPanel and QueuePanel imports? No — QueuePanel is Task 8; lint will still flag it. Temporarily acceptable; final lint gate is at Task 8 end. Confirm only the QueuePanel import error remains.)

- [ ] **Step 3: Commit**

```bash
git add src/components/DashboardPanel.tsx
git commit -m "feat: dashboard panel with metrics and 30-day chart"
```

---

### Task 5: Server — stage `destination` + push-to-queue routing

**Files:**
- Modify: `server.ts` (`StageItem` interface ~line 1770s; `/api/stage/upsert`, `/api/stage/update`, `/api/stage`, `/api/stage/push-to-queue`)

**Interfaces:**
- Consumes: existing `contentStage: Map`, `publishQueue: Map`, `savePublishQueue`, `saveContentStage`
- Produces: `StageItem.destination?: 'ig' | 'fb' | 'both'`; `POST /api/stage/push-to-queue` accepts `{ destination?: 'ig' | 'fb' | 'both' }` global override; each pushed item carries `destination`; returns `queued: { instagram, facebook }` and `pushed`

- [ ] **Step 1: Add `destination` to StageItem interface**

Find `interface StageItem` and add after `order: number;`:

```ts
  destination?: 'ig' | 'fb' | 'both';
```

- [ ] **Step 2: Default destination in `/api/stage/upsert`**

In the upsert loop where a new item is created (find `contentStage.set(` inside `/api/stage/upsert`), add the destination default to the object:

```ts
        destination: m.platform === 'facebook' ? 'fb' : 'ig',
```

Also count added items for analytics: before the loop add `let addedCount = 0;` and inside the add branch after `contentStage.set(...)` add `addedCount++;`. After the loop add `if (addedCount > 0) trackAnalytics('scrape', addedCount);`

- [ ] **Step 3: Accept destination in `/api/stage/update`**

In `/api/stage/update` (line ~1941), the patch spread already applies arbitrary fields — verify it accepts `destination` by checking the handler uses `Object.assign(item, patch)`. If it does, no change needed. If it whitelists fields, add `'destination'` to the whitelist.

- [ ] **Step 4: Rewrite `/api/stage/push-to-queue` to respect destinations**

Replace the whole handler (lines 2022-2069) with:

```ts
app.post('/api/stage/push-to-queue', (req, res) => {
  try {
    const { scheduledAt, destination: globalDestination } = req.body || {};
    const selected = Array.from(contentStage.values())
      .filter((i) => i.selected && i.status === 'new')
      .sort((a, b) => (a.order || 9999) - (b.order || 9999));
    if (!selected.length) return res.status(400).json({ error: 'No selected stage items to push' });
    const fbSession = loadFacebookPosterSession();
    const igSession = loadInstagramPosterSession();
    const wantsFb = selected.some((i) => {
      const dest = globalDestination || i.destination || (i.platform === 'facebook' ? 'fb' : 'ig');
      return dest === 'fb' || dest === 'both';
    });
    if (wantsFb && !fbSession) {
      return res.status(400).json({ error: 'Selected items include Facebook destinations but no Facebook page is connected — connect a page first' });
    }
    if (selected.some((i) => {
      const dest = globalDestination || i.destination || (i.platform === 'facebook' ? 'fb' : 'ig');
      return dest === 'ig' || dest === 'both';
    }) && !igSession) {
      return res.status(400).json({ error: 'Selected items include Instagram destinations but no Instagram account is connected — connect one in the Queue tab first' });
    }
    const base = scheduledAt ? Number(scheduledAt) : Date.now() + 60 * 1000;
    const GAP_MS = 30 * 60 * 1000;
    const pushed: string[] = [];
    let igCount = 0;
    let fbCount = 0;
    for (let idx = 0; idx < selected.length; idx++) {
      const item = selected[idx];
      const dest = (globalDestination || item.destination || (item.platform === 'facebook' ? 'fb' : 'ig')) as 'ig' | 'fb' | 'both';
      const caption = (item.caption || '').trim();
      const targets = dest === 'both' ? (['instagram', 'facebook'] as const) : [dest === 'fb' ? 'facebook' : 'instagram'];
      for (const t of targets) {
        const id = `post_${item.shortcode || 'media'}_${Date.now()}_${idx}_${t}`;
        publishQueue.set(id, {
          id,
          shortcode: item.shortcode || 'media',
          mediaUrl: item.mediaUrl,
          caption,
          type: item.type,
          reel: true,
          platform: t,
          destination: dest,
          scheduledAt: base + pushed.length * GAP_MS,
          status: 'queued',
          attempts: 0,
        });
        if (t === 'facebook') fbCount++;
        else igCount++;
        pushed.push(id);
      }
      item.status = 'queued';
      item.selected = false;
    }
    savePublishQueue();
    saveContentStage();
    console.log(`[STAGE] Pushed ${pushed.length} posts into publish queue`);
    res.json({ success: true, pushed, queued: { instagram: igCount, facebook: fbCount }, message: `Pushed ${pushed.length} posts to queue (${GAP_MS / 60000} min apart)` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 5: Verify**

Run: `npm run lint` → 0 errors. Restart server. Run temp script (`C:\Users\FAIZAN~1\AppData\Local\Temp\opencode\stage-dest-test.js`):

```js
// Requires: server running, IG + FB connected (FB via user token), at least 2 selected stage items
const res = await fetch('http://127.0.0.1:3010/api/stage', { method: 'GET' });
const stage = await res.json();
if (!stage.success) { console.log('FAIL: stage fetch'); process.exit(1); }
const sel = (stage.items || []).filter((i) => i.selected && i.status === 'new');
console.log('selected stage items:', sel.length, sel.map((i) => `${i.platform}:${i.destination || 'default'}`));
const before = await (await fetch('http://127.0.0.1:3010/api/publish/status')).json();
console.log('queue before:', before.queue.length);
const push = await (await fetch('http://127.0.0.1:3010/api/stage/push-to-queue', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ destination: 'ig' }),
})).json();
console.log('push result:', JSON.stringify(push));
if (!push.success) { console.log('FAIL:', push.error); process.exit(1); }
const after = await (await fetch('http://127.0.0.1:3010/api/publish/status')).json();
const igAdded = after.queue.filter((q) => q.destination === 'ig').length - before.queue.filter((q) => q.destination === 'ig').length;
console.log('new IG-destination items:', igAdded);
if (igAdded !== sel.length) { console.log('FAIL: destination routing mismatch'); process.exit(1); }
console.log('STAGE DESTINATION TEST PASS');
```

Expected: push succeeds and all new items have `destination === 'ig'`.

- [ ] **Step 6: Commit**

```bash
git add server.ts
git commit -m "feat: per-item destination routing from stage to queue"
```

---

### Task 6: ContentStagePanel — destination selector + global override

**Files:**
- Modify: `src/components/ContentStagePanel.tsx` (lines 1-460)

**Interfaces:**
- Consumes: `StageItem.destination` from server; `onNavigate: (tab: AppTab) => void` (change from `'autopost' | 'fbpost'`)
- Produces: push payload `{ destination?: 'ig' | 'fb' | 'both' }` when global override set; per-item `updateItem(id, { destination })`

- [ ] **Step 1: Update props type + StageItem**

Replace line 29 with:

```tsx
  onNavigate?: (tab: 'queue' | 'fbqueue') => void;
```

Add to the `StageItem` interface (after `order: number;`):

```ts
  destination?: 'ig' | 'fb' | 'both';
```

- [ ] **Step 2: Add global override state + per-item default helper**

After `const [pushResult, setPushResult] = ...` (line 36) add:

```tsx
  const [globalDestination, setGlobalDestination] = useState<'ig' | 'fb' | 'both' | ''>('');
  const [overridden, setOverridden] = useState(0);
```

Add helper after `fetchStage` (line 53):

```tsx
  const itemDestination = (item: StageItem): 'ig' | 'fb' | 'both' =>
    globalDestination || item.destination || (item.platform === 'facebook' ? 'fb' : 'ig');
```

- [ ] **Step 3: Add destination UI — global bar + per-item select**

Insert the global override bar inside the `{!items.length ? (...) : (...)}` block, directly above `{/* Selected order strip */}`:

```tsx
          <div className="flex items-center gap-2 flex-wrap pb-2 border-b border-[#1A1A1A]/10">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#1A1A1A]/50">Where to post:</span>
            <select
              value={globalDestination}
              onChange={(e) => setGlobalDestination(e.target.value as 'ig' | 'fb' | 'both' | '')}
              className="px-2 py-1.5 bg-white border border-[#1A1A1A]/20 text-[11px] font-mono font-bold focus:outline-none focus:border-[#19A76C]"
              title="Override destination for ALL selected items"
            >
              <option value="">Per-item (default)</option>
              <option value="ig">IG Queue</option>
              <option value="fb">FB Queue</option>
              <option value="both">Both IG + FB</option>
            </select>
            {globalDestination && (
              <span className="text-[10px] font-mono text-[#19A76C]">
                overriding {items.filter((i) => i.selected).length} selected items
              </span>
            )}
          </div>
```

Add the per-item select in each item card — inside the right-side action column (`{/* Order + actions */}` div), before the order controls:

```tsx
                <select
                  value={itemDestination(item)}
                  onChange={(e) => updateItem(item.id, { destination: e.target.value as 'ig' | 'fb' | 'both' })}
                  disabled={!!globalDestination}
                  className="w-full px-2 py-1.5 bg-white border border-[#1A1A1A]/20 text-[10px] font-mono font-bold focus:outline-none focus:border-[#19A76C] disabled:opacity-40 mb-2"
                  title="Where this post should be published"
                >
                  <option value="ig">IG Queue</option>
                  <option value="fb">FB Queue</option>
                  <option value="both">Both</option>
                </select>
```

- [ ] **Step 4: Update pushToQueue to send global destination**

In `pushToQueue` (line 193), change the body to:

```tsx
        body: JSON.stringify(globalDestination ? { destination: globalDestination } : {}),
```

- [ ] **Step 5: Update push-result navigation buttons**

Replace lines 439-455 (the `{pushResult.instagram > 0 && ...}` / `{pushResult.facebook > 0 && ...}` buttons) with:

```tsx
          <button
            onClick={() => onNavigate('queue')}
            className="px-3 py-1.5 bg-[#19A76C] text-white text-[10px] font-bold uppercase tracking-wider hover:bg-[#148a59] transition-colors cursor-pointer"
          >
            Go to Unified Queue →
          </button>
```

Also update the helper text at line 419 to mention destinations:

```tsx
            ? `Will push in order: ${orderedItems.map((i) => `#${i.order}`).join(' → ')} (30 min apart, first post ~now)`
            : 'Select posts, set their order and destination (IG / FB / Both) — then push them to the queue.'
```

- [ ] **Step 6: Remove unused import if lint complains**

`Send` and `SendIcon` are both imported (line 2). If lint flags duplicate/unused, drop the plain `Send` import and keep `SendIcon`.

- [ ] **Step 7: Verify**

Run: `npm run lint` → expect 0 errors (still ignoring the pending QueuePanel import error from App.tsx). Restart server; manual UI check: select items → per-item dropdown shows platform default → pick "FB Queue" → push → status message shows correct counts.

- [ ] **Step 8: Commit**

```bash
git add src/components/ContentStagePanel.tsx
git commit -m "feat: stage destination selector with global override"
```

---

### Task 7: Server — scheduling config, auto slots, daily caps, same-as-yesterday

**Files:**
- Modify: `server.ts` (add config section before `/api/publish/queue`; modify `/api/publish/queue`; add two new endpoints)

**Interfaces:**
- Produces: `SchedulingConfig` type + `getSchedulingConfig()` / `saveSchedulingConfig()`; `generateAutoSlots(count: number, cfg: SchedulingConfig, now: Date): number[]` (pure, exported for tests); `GET /api/publish/scheduling-config`; `PUT /api/publish/scheduling-config`; `POST /api/publish/schedule-like-yesterday` → `{ success, assigned: Array<{ id, scheduledAt }> }`
- Consumes: `publishQueue`, `savePublishQueue`, `loadInstagramPosterSession`, `loadFacebookPosterSession`

- [ ] **Step 1: Add config + slot engine before `/api/publish/queue` (line ~1468)**

```ts
// ==========================================
// SMART SCHEDULING
// ==========================================
const SCHEDULING_CONFIG_FILE = path.join(process.cwd(), '.scheduling-config.json');

interface SchedulingConfig {
  maxPostsPerDay: number;
  maxReelsPerDay: number;
  windowStart: string; // "09:00"
  windowEnd: string;   // "21:00"
  intervalMinutes: number;
  jitterMinutes: number;
  sameAsYesterdayOffsetMinutes: number;
}

const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  maxPostsPerDay: 10,
  maxReelsPerDay: 5,
  windowStart: '09:00',
  windowEnd: '21:00',
  intervalMinutes: 30,
  jitterMinutes: 5,
  sameAsYesterdayOffsetMinutes: 10,
};

function loadSchedulingConfig(): SchedulingConfig {
  try {
    if (!fs.existsSync(SCHEDULING_CONFIG_FILE)) return { ...DEFAULT_SCHEDULING_CONFIG };
    const raw = JSON.parse(fs.readFileSync(SCHEDULING_CONFIG_FILE, 'utf8'));
    return { ...DEFAULT_SCHEDULING_CONFIG, ...raw };
  } catch (e) {
    console.warn('[SCHEDULE] Could not load config:', e);
    return { ...DEFAULT_SCHEDULING_CONFIG };
  }
}

function saveSchedulingConfig(cfg: SchedulingConfig) {
  fs.writeFileSync(SCHEDULING_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function minutesOf(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Pure slot generator: n consecutive slots inside the window, spaced by interval, jittered ±jitterMinutes. */
export function generateAutoSlots(count: number, cfg: SchedulingConfig, now: Date = new Date()): number[] {
  const start = minutesOf(cfg.windowStart);
  const end = minutesOf(cfg.windowEnd);
  const capacity = Math.max(1, Math.floor((end - start) / Math.max(10, cfg.intervalMinutes)));
  const n = Math.min(Math.max(1, count), capacity);
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const slots: number[] = [];
  for (let i = 0; i < n; i++) {
    const slotMin = start + i * cfg.intervalMinutes;
    let t = base.getTime() + slotMin * 60 * 1000;
    if (t <= now.getTime()) t = now.getTime() + 60 * 1000;
    const jitter = cfg.jitterMinutes > 0 ? Math.round((Math.random() * 2 - 1) * cfg.jitterMinutes * 60 * 1000) : 0;
    slots.push(t + jitter);
  }
  return slots;
}
```

- [ ] **Step 2: Apply auto slots + daily caps in `/api/publish/queue`**

In `POST /api/publish/queue` (line ~1468), after the duplicate check and before `const id = ...`, replace the `scheduledAt` defaulting. Current code: `scheduledAt: scheduledAt ? Number(scheduledAt) : Date.now() + 60 * 1000,` inside the set. Change the destructure line to also read `destination` and `schedulingMode`, and replace the `scheduledAt` assignment:

```ts
    const { shortcode, mediaUrl, caption, scheduledAt, type, reel, platform, destination, schedulingMode } = req.body || {};
```

Then before `publishQueue.set(...)`:

```ts
    const cfg = loadSchedulingConfig();
    const igItems = Array.from(publishQueue.values()).filter((i) => i.platform === 'instagram' && ['queued', 'downloading', 'publishing'].includes(i.status));
    const fbItems = Array.from(publishQueue.values()).filter((i) => i.platform === 'facebook' && ['queued', 'downloading', 'publishing'].includes(i.status));
    const targetItems = targetPlatform === 'facebook' ? fbItems : igItems;
    if (schedulingMode !== 'manual') {
      const countToday = targetItems.filter((i) => new Date(i.scheduledAt).toDateString() === new Date().toDateString()).length;
      if (targetPlatform === 'instagram') {
        const reelsToday = targetItems.filter((i) => i.reel && new Date(i.scheduledAt).toDateString() === new Date().toDateString()).length;
        if (countToday >= cfg.maxPostsPerDay || (reel !== false && reelsToday >= cfg.maxReelsPerDay)) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const [hh, mm] = cfg.windowStart.split(':').map(Number);
          tomorrow.setHours(hh, mm, 0, 0);
          const finalScheduledAt = tomorrow.getTime();
          publishQueue.set(id, { id, shortcode, mediaUrl, caption, type: type || 'video', reel: reel !== false, platform: targetPlatform, scheduledAt: finalScheduledAt, status: 'queued', attempts: 0, destination, schedulingMode: schedulingMode || 'auto' });
          savePublishQueue();
          return res.json({ success: true, itemId: id, message: `Daily limit reached — scheduled for tomorrow ${cfg.windowStart}`, deferredToTomorrow: true });
        }
      } else if (countToday >= cfg.maxPostsPerDay) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const [hh, mm] = cfg.windowStart.split(':').map(Number);
        tomorrow.setHours(hh, mm, 0, 0);
        const finalScheduledAt = tomorrow.getTime();
        publishQueue.set(id, { id, shortcode, mediaUrl, caption, type: type || 'video', reel: reel !== false, platform: targetPlatform, scheduledAt: finalScheduledAt, status: 'queued', attempts: 0, destination, schedulingMode: schedulingMode || 'auto' });
        savePublishQueue();
        return res.json({ success: true, itemId: id, message: `Daily limit reached — scheduled for tomorrow ${cfg.windowStart}`, deferredToTomorrow: true });
      }
    }
```

Then keep the existing `publishQueue.set(id, {...})` but change `scheduledAt: scheduledAt ? Number(scheduledAt) : Date.now() + 60 * 1000,` to:

```ts
      scheduledAt: schedulingMode === 'manual' || scheduledAt ? (scheduledAt ? Number(scheduledAt) : Date.now() + 60 * 1000) : generateAutoSlots(1, cfg)[0],
```

and add `destination, schedulingMode: schedulingMode || 'auto',` to the same object. Note: the deferred-tomorrow branches above use `id` before it's declared — declare `const id = `post_${shortcode}_${Date.now()}`;` BEFORE the config block instead of after. Move the existing `const id` line up.

- [ ] **Step 3: Add config GET/PUT + same-as-yesterday endpoints (before `/api/publish/status`, line ~1543)**

```ts
app.get('/api/publish/scheduling-config', (req, res) => {
  res.json({ success: true, config: loadSchedulingConfig() });
});

app.put('/api/publish/scheduling-config', (req, res) => {
  try {
    const { config } = req.body || {};
    if (!config || typeof config !== 'object') return res.status(400).json({ error: 'config object required' });
    const merged: SchedulingConfig = { ...DEFAULT_SCHEDULING_CONFIG, ...config };
    merged.maxPostsPerDay = Math.max(1, Math.min(100, Number(merged.maxPostsPerDay) || 10));
    merged.maxReelsPerDay = Math.max(0, Math.min(100, Number(merged.maxReelsPerDay) || 5));
    merged.intervalMinutes = Math.max(10, Math.min(1440, Number(merged.intervalMinutes) || 30));
    merged.jitterMinutes = Math.max(0, Math.min(60, Number(merged.jitterMinutes) || 5));
    merged.sameAsYesterdayOffsetMinutes = Math.max(0, Math.min(120, Number(merged.sameAsYesterdayOffsetMinutes) || 10));
    saveSchedulingConfig(merged);
    res.json({ success: true, config: merged });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/publish/schedule-like-yesterday', (req, res) => {
  try {
    const { offsetMinutes } = req.body || {};
    const cfg = loadSchedulingConfig();
    const offset = offsetMinutes === undefined ? cfg.sameAsYesterdayOffsetMinutes : Number(offsetMinutes) || 0;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yKey = yesterday.toDateString();
    const yesterdayItems = Array.from(publishQueue.values()).filter(
      (i) => i.status === 'posted' && i.postedAt && new Date(i.postedAt).toDateString() === yKey,
    );
    const times = yesterdayItems.map((i) => {
      const d = new Date(i.postedAt!);
      return d.getHours() * 60 + d.getMinutes();
    }).sort((a, b) => a - b);
    const pending = Array.from(publishQueue.values()).filter((i) => i.status === 'queued' && !i.scheduledAt);
    const targets = pending.length ? pending : Array.from(publishQueue.values()).filter((i) => i.status === 'queued');
    const assigned: Array<{ id: string; scheduledAt: number }> = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const useTimes = times.length ? times : [minutesOf(cfg.windowStart) + offset];
    targets.slice(0, cfg.maxPostsPerDay).forEach((item, i) => {
      const t = base.getTime() + (useTimes[i % useTimes.length] + offset) * 60 * 1000;
      if (t <= Date.now()) return;
      item.scheduledAt = t;
      item.schedulingMode = 'auto';
      assigned.push({ id: item.id, scheduledAt: t });
    });
    savePublishQueue();
    res.json({
      success: true,
      assigned,
      message: times.length
        ? `Copied yesterday's ${times.length} posting times (+${offset} min offset) to today's queue`
        : `No posts yesterday — scheduled from ${cfg.windowStart} +${offset} min`,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 4: Include `schedulingConfig` in `/api/publish/status`**

In the status response object (line ~1548), add:

```ts
    schedulingConfig: loadSchedulingConfig(),
```

- [ ] **Step 5: Verify slot engine + endpoints**

Run: `npm run lint` → 0 errors. Restart server. Temp script (`C:\Users\FAIZAN~1\AppData\Local\Temp\opencode\schedule-test.js`):

```js
const base = 'http://127.0.0.1:3010';
const cfgRes = await fetch(base + '/api/publish/scheduling-config');
const cfg = (await cfgRes.json()).config;
console.log('config:', JSON.stringify(cfg));
const putRes = await fetch(base + '/api/publish/scheduling-config', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ config: { maxPostsPerDay: 3, intervalMinutes: 15, jitterMinutes: 0 } }),
});
const saved = (await putRes.json()).config;
console.log('saved:', JSON.stringify(saved));
if (saved.maxPostsPerDay !== 3) { console.log('FAIL: config not saved'); process.exit(1); }
const likeRes = await fetch(base + '/api/publish/schedule-like-yesterday', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ offsetMinutes: 10 }),
});
const like = await likeRes.json();
console.log('like-yesterday:', like.message, '| assigned:', like.assigned.length);
await fetch(base + '/api/publish/scheduling-config', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ config: cfg }),
});
console.log('SCHEDULING TEST PASS');
```

Expected: config round-trips, like-yesterday responds with message.

- [ ] **Step 6: Commit**

```bash
git add server.ts
git commit -m "feat: smart scheduling engine with daily caps and same-as-yesterday"
```

---

### Task 8: QueuePanel — unified queue (absorbs AutoPostPanel + FacebookPostPanel)

**Files:**
- Create: `src/components/QueuePanel.tsx`
- Delete: `src/components/AutoPostPanel.tsx`, `src/components/FacebookPostPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/publish/status`, `POST /api/publish/connect`, `POST /api/publish/test`, `POST /api/publish/disconnect`, `POST /api/publish/queue`, `POST /api/publish/set-platform`, `POST /api/publish/remove`, `POST /api/publish/clear`, `POST /api/publish/trigger-now`, `GET/PUT /api/publish/scheduling-config`, `POST /api/publish/schedule-like-yesterday`, `POST /api/facebook/connect`, `POST /api/facebook/pages`, `POST /api/facebook/switch-page`, `POST /api/facebook/test`, `POST /api/facebook/disconnect`, `GET /api/auth/me`
- Produces: `QueuePanel` props `{ platformFilter?: 'all' | 'facebook' }`

- [ ] **Step 1: Create QueuePanel with connection cards (IG + FB), scheduling bar, unified queue table, bulk actions, duplicate toast**

Key structure (design language copied from the existing panels — full code below):

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send, Plug, Unplug, Zap, Trash2, Plus, RefreshCw, Loader2, CheckCircle2, XCircle, Clock,
  CalendarClock, KeyRound, Link2, StickyNote, Play, Facebook, RotateCcw, AlertTriangle,
} from 'lucide-react';
import { API_BASE } from '../lib/apiBase';

interface PublishItem {
  id: string;
  shortcode: string;
  mediaUrl: string;
  caption?: string;
  type: 'video' | 'image';
  reel: boolean;
  platform: 'instagram' | 'facebook';
  scheduledAt: number;
  status: 'queued' | 'downloading' | 'publishing' | 'posted' | 'failed';
  attempts: number;
  postedAt?: number;
  postUrl?: string;
  error?: string;
  destination?: 'ig' | 'fb' | 'both';
  schedulingMode?: 'auto' | 'manual';
  duplicate?: boolean;
  existingItemId?: string;
}

interface SchedulingConfig {
  maxPostsPerDay: number;
  maxReelsPerDay: number;
  windowStart: string;
  windowEnd: string;
  intervalMinutes: number;
  jitterMinutes: number;
  sameAsYesterdayOffsetMinutes: number;
}

interface QueuePanelProps {
  platformFilter?: 'all' | 'facebook';
}
```

Then inside the component (abridged here — implement exactly the behaviors listed, reusing the connection UI markup from AutoPostPanel for IG and FacebookPostPanel for FB):

1. **State:** `status`, `schedulingConfig`, `selectedIds: Set<string>`, `duplicateToast: { message, existingShortcode } | null`, IG connect fields, FB connect fields (reuse from existing panels), `showScheduleConfig` boolean.
2. **fetchStatus** every 5s (same as AutoPostPanel) — also fetches `/api/publish/scheduling-config`.
3. **Queue table**: renders `status.queue` filtered by `platformFilter` (`facebook` → only `platform === 'facebook'`), sorted by `scheduledAt`. Each row: checkbox (disabled when status is posting/downloading/posted), thumbnail, shortcode, platform badge (IG orange / FB blue), status badge, `destination` badge if present, caption preview, error, postUrl, scheduling mode select (`Auto` / `Manual`), scheduled time — inline `datetime-local` input when Manual, countdown when Auto, trigger-now + remove buttons.
4. **Bulk bar**: Select all visible / clear selection, "Delete selected" (loops `/api/publish/remove`), "Schedule like yesterday" (POST with offset from config), "Open scheduling settings" (collapsible form for the 7 config fields, PUT on save, with live "today's slots preview" via `generateAutoSlots` client copy).
5. **Duplicate toast**: listens for `duplicate: true` in queue responses (from stage push and manual queue) and shows `<AlertTriangle>` toast "Similar post already queued — [View] [Add Anyway]"; View navigates to the row (scroll into view); Add Anyway sends with `forceDuplicate: true`? No — server treats repeat queue call as duplicate; Add Anyway simply re-POSTs to `/api/publish/queue` (idempotency returns duplicate again) — so Add Anyway instead reveals the existing item (click → scroll) and the user edits its time. Keep behavior: toast shows existing shortcode + scheduled time; "View" scrolls; "Dismiss" closes.
6. **Add Post form** (manual queue): media URL, caption, type, reel, platform selector (IG/FB), schedule datetime-local, "Add to Queue" → POST `/api/publish/queue` with `{ platform, schedulingMode }`; shows `data.message` (including duplicate/deferred messages).
7. **FB page section**: compact — page name + switch-page select (reuse FacebookPostPanel logic) + test/disconnect.
8. **Stats chips**: posted/pending/failed (from status.stats), plus today's posted count.

Full code: write the complete component following the above spec, copying markup from the existing panels (they are the reference for styling tokens). It will be ~550 lines. Key unique pieces:

```tsx
  const queueItem = (item: PublishItem) => (
    <div key={item.id} className={`border p-4 flex flex-col md:flex-row md:items-center gap-3 ${item.duplicate ? 'border-amber-300 bg-amber-50/40' : 'border-[#1A1A1A]/10 bg-[#FBF9F6]'}`}>
      <input
        type="checkbox"
        checked={selectedIds.has(item.id)}
        disabled={['posted', 'publishing', 'downloading'].includes(item.status)}
        onChange={(e) => {
          const next = new Set(selectedIds);
          if (e.target.checked) next.add(item.id); else next.delete(item.id);
          setSelectedIds(next);
        }}
        className="accent-[#19A76C] disabled:opacity-30"
      />
      {/* thumbnail (reuse from AutoPostPanel), shortcode, platform badge, statusBadge */}
      ...
      <div className="flex items-center gap-2">
        <select
          value={item.schedulingMode || 'auto'}
          onChange={(e) => setItemMode(item.id, e.target.value as 'auto' | 'manual')}
          disabled={item.status !== 'queued'}
          className="px-2 py-1 border border-[#1A1A1A]/20 text-[10px] font-mono font-bold focus:outline-none focus:border-[#19A76C] disabled:opacity-40"
        >
          <option value="auto">Auto</option>
          <option value="manual">Manual</option>
        </select>
        {item.schedulingMode === 'manual' && item.status === 'queued' ? (
          <input
            type="datetime-local"
            defaultValue={new Date(item.scheduledAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
            onBlur={(e) => setManualTime(item.id, e.target.value)}
            className="px-2 py-1 border border-[#1A1A1A]/20 text-[10px] font-mono focus:outline-none focus:border-[#19A76C]"
          />
        ) : (
          <div className="text-right">
            <div className="text-[10px] font-mono text-[#1A1A1A]/50 uppercase">scheduled</div>
            <div className="text-xs font-mono text-[#1A1A1A]">
              {new Date(item.scheduledAt).toLocaleString()}
              {item.status === 'queued' && <span className="ml-1 text-[#19A76C] font-bold">({remaining(item)})</span>}
            </div>
          </div>
        )}
        <button onClick={() => triggerNow(item.id)} ...><Zap /></button>
        <button onClick={() => removeItem(item.id)} ...><Trash2 /></button>
      </div>
    </div>
  );
```

Server helpers used by QueuePanel (add to `server.ts` in this task):

```ts
app.post('/api/publish/set-mode', (req, res) => {
  try {
    const { itemId, mode } = req.body || {};
    const item = publishQueue.get(itemId);
    if (!item) return res.status(404).json({ error: 'Queue item not found' });
    if (item.status !== 'queued') return res.status(400).json({ error: 'Only queued items can change mode' });
    item.schedulingMode = mode === 'manual' ? 'manual' : 'auto';
    savePublishQueue();
    res.json({ success: true, message: `Mode set to ${item.schedulingMode}` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/publish/set-time', (req, res) => {
  try {
    const { itemId, scheduledAt } = req.body || {};
    const item = publishQueue.get(itemId);
    if (!item) return res.status(404).json({ error: 'Queue item not found' });
    const t = Number(scheduledAt);
    if (!t || Number.isNaN(t)) return res.status(400).json({ error: 'scheduledAt (ms) required' });
    item.scheduledAt = t;
    item.schedulingMode = 'manual';
    savePublishQueue();
    res.json({ success: true, scheduledAt: t, message: `Rescheduled to ${new Date(t).toLocaleString()}` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 2: Delete old panels + verify lint + build**

```bash
git rm src/components/AutoPostPanel.tsx src/components/FacebookPostPanel.tsx
npm run lint
npm run build
```

Expected: both exit 0 — App.tsx imports now resolve, no references to deleted files remain.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: unified queue panel with smart scheduling and bulk actions"
```

---

### Task 9: Duplicate-post warning in queue responses

**Files:**
- Modify: `server.ts` (`POST /api/publish/queue` duplicate branch)

**Interfaces:**
- Consumes: existing `findByIdempotencyKey`
- Produces: duplicate response gains `existingShortcode`, `existingScheduledAt`, `existingPlatform` so the UI toast can show details

- [ ] **Step 1: Enrich the duplicate response**

In `/api/publish/queue`, the existing branch:

```ts
    if (existing) {
      return res.json({
        success: true,
        itemId: existing.id,
        message: "Post already queued (duplicate detected)",
        duplicate: true,
      });
    }
```

Replace with:

```ts
    if (existing) {
      return res.json({
        success: true,
        itemId: existing.id,
        message: "Post already queued (duplicate detected)",
        duplicate: true,
        existingShortcode: existing.shortcode,
        existingPlatform: existing.platform,
        existingScheduledAt: existing.scheduledAt,
        existingStatus: existing.status,
      });
    }
```

- [ ] **Step 2: Also enrich `/api/stage/push-to-queue` for duplicates**

In the push-to-queue loop, before creating a new item for target `t`, check idempotency (the queue already has `generateIdempotencyKey` + `findByIdempotencyKey` — reuse them):

```ts
      for (const t of targets) {
        const dupKey = generateIdempotencyKey(item.shortcode || 'media', item.mediaUrl, t);
        const dup = findByIdempotencyKey(dupKey);
        if (dup) {
          duplicates.push({ shortcode: item.shortcode || 'media', platform: t, existingId: dup.id, scheduledAt: dup.scheduledAt });
          continue;
        }
        const id = `post_${item.shortcode || 'media'}_${Date.now()}_${idx}_${t}`;
        ...
      }
```

Declare `const duplicates: Array<{ shortcode: string; platform: string; existingId: string; scheduledAt: number }> = [];` before the loop, and include `duplicates` in the response JSON. Do NOT skip marking the stage item as queued if at least one target was queued; if ALL targets were duplicates, mark the item queued anyway (it's already in the queue) and `item.selected = false`.

- [ ] **Step 3: Verify**

Run: `npm run lint` → 0. Restart server. Temp script (needs an existing queued post; queue the same URL twice):

```js
const base = 'http://127.0.0.1:3010';
const body = { shortcode: 'DupTest123', mediaUrl: 'https://example.com/dup-video.mp4', type: 'video', reel: true, platform: 'instagram', schedulingMode: 'manual', scheduledAt: Date.now() + 3600000 };
const r1 = await (await fetch(base + '/api/publish/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
console.log('first:', r1.message);
const r2 = await (await fetch(base + '/api/publish/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
console.log('second:', r2.message, '| duplicate:', r2.duplicate, '| existingShortcode:', r2.existingShortcode, '| existingScheduledAt:', r2.existingScheduledAt);
if (!r2.duplicate || !r2.existingShortcode) { console.log('FAIL: duplicate details missing'); process.exit(1); }
await (await fetch(base + '/api/publish/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: r1.itemId }) })).json();
console.log('DUPLICATE DETAILS TEST PASS');
```

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat: duplicate warning details in queue responses"
```

---

### Task 10: AI caption gating + SETUP.md guide

**Files:**
- Modify: `server.ts` (`GET /api/stage`), `src/components/ContentStagePanel.tsx`
- Create: `docs/SETUP.md`

**Interfaces:**
- Produces: `GET /api/stage` response gains `aiCaptionAvailable: boolean`; AI Caption button disabled with tooltip when false

- [ ] **Step 1: Expose availability from `/api/stage`**

In `GET /api/stage` (line ~1928), change the response to:

```ts
    res.json({ success: true, aiCaptionAvailable: !!process.env.GEMINI_API_KEY, items: Array.from(contentStage.values()) });
```

- [ ] **Step 2: Gate the button in ContentStagePanel**

Add state `aiAvailable` (default false), set it in `fetchStage`:

```tsx
      const data = await res.json();
      if (data.success) {
        setItems(data.items || []);
        setAiAvailable(!!data.aiCaptionAvailable);
      }
```

Replace the AI Caption button (lines 317-325) with:

```tsx
                  <button
                    onClick={() => generateCaption(item, true)}
                    disabled={generatingId === item.id || !aiAvailable}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-[#19A76C]/10 hover:bg-[#19A76C]/20 border border-[#19A76C]/40 text-[#0f7a4d] text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title={aiAvailable ? 'AI caption (Gemini)' : 'AI captions need GEMINI_API_KEY on the server — see docs/SETUP.md. Template captions still work.'}
                  >
                    {generatingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    AI Caption {!aiAvailable && '(no key)'}
                  </button>
```

- [ ] **Step 3: Write docs/SETUP.md**

```markdown
# Setup Guide

## GEMINI_API_KEY (AI Captions)

AI captions on the Content Stage use Google Gemini. Without a key, the "AI Caption" button is disabled and template captions are used instead.

1. Get a free key at https://aistudio.google.com/apikey
2. Add it to your server environment:
   - `.env`: `GEMINI_API_KEY=your_key_here` (optional: `GEMINI_MODEL=gemini-2.5-flash`)
3. Restart the server. The Content Stage will enable the AI Caption button.
4. The key is never sent to the browser — only the availability flag is.

## Smart Scheduling (Queue tab)

- **Max posts/day** and **Max reels/day** cap how many items are scheduled for today; excess items roll to tomorrow at window start.
- **Posting window** (`HH:MM` to `HH:MM`) defines the daily time range.
- **Interval** spaces posts apart; **Jitter (±min)** adds randomness to look human.
- **Same as Yesterday** copies yesterday's actual posting times (+ offset) to today's unscheduled items.
- Per-item: set mode to **Manual** to pick an exact time, or leave **Auto** to follow the pattern.

## Environment variables

| Var | Purpose |
|-----|---------|
| `PORT` | Server port (use 3010) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Auth + credits |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | AI captions |
| `PUBLISH_CONCURRENCY` | Parallel publish workers (default 2) |
```

- [ ] **Step 4: Verify + commit**

Run: `npm run lint` → 0. Restart server. Manual: open Stage — button shows "(no key)" when `.env` has no GEMINI_API_KEY; with key set, button enables and generates.

```bash
git add server.ts src/components/ContentStagePanel.tsx docs/SETUP.md
git commit -m "feat: gate AI captions behind GEMINI_API_KEY with setup guide"
```

---

### Task 11: End-to-end verification

**Files:**
- Create: temp script (not committed)

- [ ] **Step 1: Full E2E node script**

`C:\Users\FAIZAN~1\AppData\Local\Temp\opencode\ux-e2e.js`:

```js
// Full UX overhaul E2E — requires: server on 3010, IG + FB connected, >=2 selected stage items
const base = 'http://127.0.0.1:3010';
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) process.exitCode = 1;
};
const j = (r) => r.json();

// 1. Analytics
const a = await j(await fetch(base + '/api/analytics/dashboard'));
check('analytics endpoint', a.success && a.timeSeries.length === 30, JSON.stringify(a.month));

// 2. Config round-trip
const c1 = (await j(await fetch(base + '/api/publish/scheduling-config'))).config;
const c2 = (await j(await fetch(base + '/api/publish/scheduling-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { ...c1, intervalMinutes: 45 } }) }))).config;
check('config PUT', c2.intervalMinutes === 45);
await fetch(base + '/api/publish/scheduling-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: c1 }) });

// 3. Like-yesterday
const ly = await j(await fetch(base + '/api/publish/schedule-like-yesterday', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offsetMinutes: 5 }) }));
check('like-yesterday', ly.success, ly.message);

// 4. Stage push with destination
const st = await j(await fetch(base + '/api/stage'));
check('stage fetch', st.success && 'aiCaptionAvailable' in st, 'aiCaptionAvailable=' + st.aiCaptionAvailable);
const sel = (st.items || []).filter((i) => i.selected && i.status === 'new');
if (sel.length >= 2) {
  const p = await j(await fetch(base + '/api/stage/push-to-queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination: 'ig' }) }));
  check('stage push destination', p.success && p.queued.instagram === sel.length, JSON.stringify(p.queued));
}

// 5. Duplicate details
const dupBody = { shortcode: 'E2EDupX1', mediaUrl: 'https://example.com/e2e-dup.mp4', type: 'video', reel: true, platform: 'instagram', schedulingMode: 'manual', scheduledAt: Date.now() + 7200000 };
const q1 = await j(await fetch(base + '/api/publish/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dupBody) }));
const q2 = await j(await fetch(base + '/api/publish/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dupBody) }));
check('duplicate details', q2.duplicate && !!q2.existingShortcode, q2.message);
await fetch(base + '/api/publish/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: q1.itemId }) });

// 6. Status shape
const s = await j(await fetch(base + '/api/publish/status'));
check('status has schedulingConfig', !!s.schedulingConfig, 'maxPostsPerDay=' + (s.schedulingConfig || {}).maxPostsPerDay);

// 7. Mode/time endpoints
const pending = s.queue.find((i) => i.status === 'queued');
if (pending) {
  const m = await j(await fetch(base + '/api/publish/set-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: pending.id, mode: 'manual' }) }));
  check('set-mode', m.success);
  const t = await j(await fetch(base + '/api/publish/set-time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: pending.id, scheduledAt: Date.now() + 3600000 }) }));
  check('set-time', t.success);
}

console.log(process.exitCode ? 'E2E: FAILURES PRESENT' : 'E2E: ALL PASS');
process.exit(process.exitCode || 0);
```

- [ ] **Step 2: Run E2E**

Run: `node C:\Users\FAIZAN~1\AppData\Local\Temp\opencode\ux-e2e.js` → expect all PASS.

- [ ] **Step 3: Final gates**

Run: `npm run lint` → 0. Run: `npm run build` → 0. Restart server.

- [ ] **Step 4: Manual UI checklist (do these by hand in the browser at 127.0.0.1:3010)**

- [ ] Logged-out user hits `/` → Landing → Sign in → lands on **Dashboard** (not Landing)
- [ ] Sidebar shows: Dashboard, Scrape (IG/TT/FB), Content Stage, Unified Queue, Facebook Only, Setup & Build — no Landing item
- [ ] Dashboard shows 8 metric areas + 30-day chart + 4 quick-action buttons; Quick actions navigate correctly
- [ ] Stage: per-item destination dropdown defaults (FB items → FB Queue); global override bar updates selected items; push routes to correct queue and shows "Go to Unified Queue"
- [ ] Queue tab: both IG and FB items visible; Facebook Only shows FB only; stats chips correct
- [ ] Queue: Auto/Manual per item; Manual shows datetime-local input; Save keeps time
- [ ] Queue: bulk select → Delete selected removes rows
- [ ] Queue: "Same as Yesterday" button assigns times with message
- [ ] Queue: scheduling settings form saves; today's slots preview updates
- [ ] Queue: manual add with an already-queued URL shows amber "duplicate" toast with existing shortcode + time
- [ ] Stage AI Caption button: disabled with "(no key)" when GEMINI_API_KEY unset; works when set

- [ ] **Step 5: Commit any fixes produced during checklist**

```bash
git add -A
git commit -m "fix: polish from manual UX checklist"
```

---

## Self-Review

- **Spec coverage:** Dashboard ✓ (Tasks 1, 4) · post-login redirect ✓ (Task 3) · stage destination per-item + global override ✓ (Tasks 5, 6) · daily max posts + max reels ✓ (Task 7) · per-video time (Auto/Manual + set-time) ✓ (Tasks 7, 8) · same-as-yesterday + one-time daily pattern ✓ (Tasks 7, 8) · duplicate warning toast (shortcode+platform+URL hash via existing idempotency) ✓ (Task 9) · AI caption gating + guide ✓ (Task 10) · long verified todo list ✓ (Task 11).
- **Placeholder scan:** All code blocks are concrete. The only intentionally-abridged section is QueuePanel markup, which explicitly reuses the already-existing panel code (AutoPostPanel/FacebookPostPanel are the reference and are read directly by the implementing engineer).
- **Type consistency:** `AppTab` union matches across Sidebar/App/ContentStagePanel/QueuePanel. `destination: 'ig' | 'fb' | 'both'` consistent server+client. `schedulingMode: 'auto' | 'manual'` consistent. `generateAutoSlots(count, cfg, now?)` used in server only (client preview is a local copy). `trackAnalytics('scrape'|'download')` matches call sites. `aiCaptionAvailable` matches fetch + button gating.