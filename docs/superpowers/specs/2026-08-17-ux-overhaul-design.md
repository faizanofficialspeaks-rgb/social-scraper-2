# UX Overhaul Design — SocialScraper Dashboard & Queue System

**Date:** 2026-08-17  
**Status:** Approved — Ready for Implementation  
**Author:** Assistant (via brainstorming skill)

---

## 1. Executive Summary

Complete UX overhaul of the SocialScraper web app to replace the fragmented Landing→Auth→Tabs flow with a unified **Dashboard-first** experience. Key changes:

- **Dashboard becomes default home** after login (replaces Landing tab)
- **Unified Queue** merges IG + FB scheduling with smart daily limits
- **Content Stage** gets per-item destination selector + global override
- **Smart Scheduling** — one-time time pattern setup, "same as yesterday" button
- **Duplicate prevention** — shortcode+platform+mediaUrlHash with warning toast
- **AI Caption** requires GEMINI_API_KEY (clear setup guide)
- **Analytics Dashboard** — 8 metrics + 7d/30d charts

---

## 2. Navigation & Flow Overhaul

### Current Tabs (8)
| Tab | ID | Purpose |
|-----|-----|---------|
| Landing | `home` | Unauthenticated marketing page |
| Instagram | `instagram` | Scrape IG |
| TikTok | `tiktok` | Scrape TT |
| Facebook | `facebook` | Scrape FB |
| Stage | `stage` | Curate scraped posts |
| AutoPost | `autopost` | IG queue |
| FBPost | `fbpost` | FB queue |
| Setup | `setup` | Extension build + account |

### New Tabs (6)
| Tab | ID | Purpose |
|-----|-----|---------|
| **Dashboard** | `dashboard` | **Default home** — analytics + quick actions |
| Scrape | `instagram` \| `tiktok` \| `facebook` | Sub-tabs under "Scrape" group |
| Stage | `stage` | Curate + destination selector |
| Queue | `queue` | **Unified** IG+FB queue with smart scheduling |
| FB Queue | `fbqueue` | Optional filtered FB-only view |
| Settings | `setup` | Extension build + account + scheduling config |

### Auth Flow
```
Unauthenticated → Landing Page → CTA → Auth Page → Dashboard (not Landing)
```
- Remove `home` tab from Sidebar entirely
- `handleLandingCta`: if authed → `setActiveTab('dashboard')`

---

## 3. Dashboard (New Home Tab)

### 8 Metric Cards
| Metric | Source | Visual |
|--------|--------|--------|
| Scraped This Month | `/api/analytics/dashboard` | Number + sparkline |
| Published This Month (IG+FB) | `publishQueue` + `contentStage` | Number + platform split |
| Failed This Month | `publishQueue` | Number + error breakdown |
| Downloads This Month | `/api/analytics/dashboard` | Number |
| Credits Used / Remaining | `/api/auth/me` | Progress bar |
| Queue Health | `publishQueue` | Pending / Posting / Scheduled badges |
| Platform Breakdown | `contentStage` + `publishQueue` | Donut chart |
| Time Series (7d/30d) | `/api/analytics/dashboard` | Recharts line chart |

### Quick Actions Row (4 buttons)
| Button | Action |
|--------|--------|
| Start Scraping | `setActiveTab('instagram')` |
| Open Content Stage | `setActiveTab('stage')` |
| Open Queue | `setActiveTab('queue')` |
| Generate Extension ZIP | `handleDownloadZip()` |

---

## 4. Content Stage — Destination Selector

### Per-Item Default (inline dropdown)
```tsx
<select value={item.destination} onChange={...}>
  <option value="ig">IG Queue</option>
  <option value="fb">FB Queue</option>
  <option value="both">Both</option>
</select>
```
- **Default per platform:** IG reels → `ig`, FB reels → `fb`, TikTok → `ig`
- Shown on each stage item card (right side, next to order controls)

### Global Override (top bar)
```tsx
<div className="flex items-center gap-2">
  <span className="text-xs font-bold uppercase">Push All to:</span>
  <select value={globalDestination} onChange={setGlobalDestination}>
    <option value="ig">IG Queue</option>
    <option value="fb">FB Queue</option>
    <option value="both">Both</option>
  </select>
  <span className="text-xs text-green-600">Overrides {overriddenCount} items</span>
</div>
```
- When changed → updates all **selected** items' `destination`
- Items with per-item override show `🔒` icon; clicking global shows "X items overridden"

---

## 5. Queue UX — Smart Scheduling System

### Daily Limits (Settings → Scheduling Config)
```tsx
interface SchedulingConfig {
  maxPostsPerDay: number;      // default: 10
  maxReelsPerDay: number;      // default: 5
  postingWindowStart: string;  // "09:00"
  postingWindowEnd: string;    // "21:00"
  intervalMinutes: number;     // default: 30
  jitterMinutes: number;       // default: 5 (±)
  sameAsYesterdayOffsetMinutes: number; // default: 10
}
```

### "Same as Yesterday" Button
```tsx
<button onClick={copyYesterdaySchedule}>
  <RotateCcw className="w-4 h-4" /> Same as Yesterday (+{offset} min)
</button>
```
- Fetches yesterday's posted/scheduled items from `publishQueue`
- Copies exact time slots, shifts each by `sameAsYesterdayOffsetMinutes`
- Only applies to unscheduled (or "Auto") items

### Per-Item Scheduling
| Mode | Behavior |
|------|----------|
| **Auto** (default) | Follows daily pattern; time auto-assigned on queue |
| **Manual** | User picks exact datetime; badge shows "Manual" |

### Bulk Actions (Queue table)
| Action | Implementation |
|--------|----------------|
| Select All | Checkbox column + header checkbox |
| Bulk Schedule | Opens modal → applies pattern to selected |
| Bulk Delete | `POST /api/publish/clear` with item IDs |
| Bulk Platform | Dropdown → updates `platform` on selected |

---

## 6. Duplicate Prevention

### Check Key
```ts
function duplicateKey(item: StageItem | PublishItem): string {
  const hash = crypto.createHash('sha256')
    .update(item.mediaUrl)
    .digest('hex')
    .slice(0, 12);
  return `${item.shortcode}|${item.platform}|${hash}`;
}
```

### Behavior
- **Check on:** `/api/publish/queue` and `/api/stage/push-to-queue`
- **If duplicate found:** Return `{ success: true, warning: true, existingItemId }`
- **UI:** Toast "⚠️ Similar post already queued — [View Existing] [Add Anyway]"
- **Not blocking** — user can override

---

## 7. AI Caption — GEMINI_API_KEY Required

### Client-Side
```tsx
<button
  disabled={!import.meta.env.VITE_GEMINI_API_KEY}
  title={!import.meta.env.VITE_GEMINI_API_KEY 
    ? "Set GEMINI_API_KEY in .env to enable AI captions. See Setup Guide →"
    : "Generate AI caption"}
>
  {generating ? <Loader2 /> : <Sparkles />} AI Caption
</button>
```

### Server-Side (unchanged)
```ts
async function generateCaptionGemini(prompt: string): Promise<string | null> {
  if (!process.env.GEMINI_API_KEY) return null; // returns null → template fallback
  // ... Gemini call
}
```

### Setup Guide Link
- Tooltip links to `SETUP.md#gemini-api-key` (to be created)

---

## 8. Server-Side API Changes

### New Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/analytics/dashboard` | GET | Returns all 8 dashboard metrics |
| `/api/publish/check-duplicate` | POST | `{ shortcode, platform, mediaUrl }` → `{ duplicate: boolean, existingItem }` |
| `/api/publish/scheduling-config` | GET/PUT | Get/update `SchedulingConfig` |
| `/api/stage/push-to-queue` | POST | Add `destination: 'ig' \| 'fb' \| 'both'` per item |

### Modified Endpoints
| Endpoint | Change |
|----------|--------|
| `/api/publish/queue` | Accept `destination`, enforce daily limits |
| `/api/stage/push-to-queue` | Accept `destination` per item, route to correct queue |
| `/api/publish/status` | Add `schedulingConfig` to response |

---

## 9. Data Models

### StageItem (add field)
```ts
interface StageItem {
  // ... existing
  destination?: 'ig' | 'fb' | 'both'; // default: platform-based
}
```

### PublishItem (add field)
```ts
interface PublishItem {
  // ... existing
  destination?: 'ig' | 'fb' | 'both'; // set at queue time
  schedulingMode?: 'auto' | 'manual';
}
```

### SchedulingConfig (new, persisted in `.scheduling-config.json`)
```ts
interface SchedulingConfig {
  maxPostsPerDay: number;
  maxReelsPerDay: number;
  postingWindowStart: string; // "09:00"
  postingWindowEnd: string;   // "21:00"
  intervalMinutes: number;
  jitterMinutes: number;
  sameAsYesterdayOffsetMinutes: number;
}
```

---

## 10. UI Component Changes

### Sidebar.tsx
- Remove `home` group entirely
- Add `dashboard` as first group (no step number)
- Rename `autopost` → `queue`, `fbpost` → `fbqueue` (optional)
- Update icons: `BarChart2` for Dashboard, `Send` for Queue

### App.tsx
- Remove `view === 'landing'` check for authed users
- Default `activeTab = 'dashboard'` after auth
- Update `handleNavigate` to support new tab IDs

### ContentStagePanel.tsx
- Add `destination` select per item
- Add global override bar at top
- Pass `destination` in push-to-queue payload

### AutoPostPanel.tsx → QueuePanel.tsx (rename + merge)
- Merge IG + FB queue into single table
- Add `destination` column (badge)
- Add scheduling mode (Auto/Manual) per item
- Add bulk actions toolbar
- Add scheduling config panel (collapsible)
- Add "Same as Yesterday" button

### New: DashboardPanel.tsx
- Metric cards grid (2×4 on desktop, 1×8 mobile)
- Recharts line chart for time series
- Quick actions row

### New: SchedulingConfigModal.tsx
- Form for `SchedulingConfig`
- Live preview of today's generated slots

---

## 11. Files to Create / Modify

### Create
| File | Purpose |
|------|---------|
| `src/components/DashboardPanel.tsx` | New dashboard home |
| `src/components/QueuePanel.tsx` | Unified queue (replaces AutoPostPanel + FacebookPostPanel) |
| `src/components/SchedulingConfigModal.tsx` | Scheduling config UI |
| `src/lib/scheduling.ts` | Scheduling logic (generateSlots, copyYesterday, etc.) |
| `server.ts` additions | New endpoints + scheduling enforcement |
| `docs/SETUP.md` | GEMINI_API_KEY setup guide |

### Modify
| File | Changes |
|------|---------|
| `src/App.tsx` | Remove `home` tab, default to `dashboard`, update navigation |
| `src/components/Sidebar.tsx` | New tab structure |
| `src/components/ContentStagePanel.tsx` | Destination selector + global override |
| `src/components/AutoPostPanel.tsx` | → Replace with QueuePanel |
| `src/components/FacebookPostPanel.tsx` | → Merge into QueuePanel |
| `server.ts` | New endpoints, duplicate check, scheduling enforcement |

### Delete
| File | Reason |
|------|--------|
| `src/components/AutoPostPanel.tsx` | Merged into QueuePanel |
| `src/components/FacebookPostPanel.tsx` | Merged into QueuePanel |

---

## 12. Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Update Sidebar + App.tsx navigation
- [ ] Create DashboardPanel with metrics + quick actions
- [ ] Add `/api/analytics/dashboard` endpoint
- [ ] Test auth flow: Landing → Auth → Dashboard

### Phase 2: Content Stage + Destination (Week 1-2)
- [ ] Add per-item destination selector in ContentStagePanel
- [ ] Add global override bar
- [ ] Update `/api/stage/push-to-queue` to accept destination
- [ ] Test: scrape → stage → push to IG/FB/Both

### Phase 3: Unified Queue + Smart Scheduling (Week 2-3)
- [ ] Create QueuePanel (merge AutoPost + FBPost)
- [ ] Add scheduling config modal + persistence
- [ ] Implement scheduling engine (generateSlots, copyYesterday)
- [ ] Add daily limits enforcement in `/api/publish/queue`
- [ ] Add bulk actions + scheduling mode (Auto/Manual)

### Phase 4: Duplicate Prevention + AI Caption (Week 3)
- [ ] Add duplicate check endpoint + UI toast
- [ ] Disable AI Caption without GEMINI_API_KEY + setup guide
- [ ] Test duplicate scenarios

### Phase 5: Analytics + Polish (Week 3-4)
- [ ] Complete Dashboard metrics + Recharts
- [ ] Add time series chart (7d/30d)
- [ ] Add scheduling config to Settings tab
- [ ] E2E test: scrape → stage → queue → post

---

## 13. Success Criteria

| Metric | Target |
|--------|--------|
| Dashboard load time | < 500ms |
| Queue scheduling (10 items) | < 200ms |
| Duplicate check | < 50ms |
| "Same as Yesterday" (30 items) | < 100ms |
| Zero duplicate posts in production | 100% |
| AI Caption works with API key | 100% |

---

## 14. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Scheduling engine complexity | Start simple: fixed interval + jitter; add daily limits later |
| Merging AutoPost + FBPost | Keep platform-specific logic in `publishItemNow`; queue just routes |
| Dashboard metrics performance | Cache `/api/analytics/dashboard` for 60s; use DB aggregations |
| Migration of existing queue items | Add `destination` + `schedulingMode` defaults on load |

---

**Design Approved:** ✅  
**Next Step:** Invoke `writing-plans` to create implementation plan with task breakdown.