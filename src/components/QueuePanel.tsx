import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send, Plug, Unplug, Zap, Trash2, RefreshCw, Loader2, CheckCircle2, XCircle, Clock,
  CalendarClock, KeyRound, Link2, StickyNote, Play, Facebook, RotateCcw, AlertTriangle,
  Settings2, CheckSquare, Square, Plus,
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

interface PublishStatus {
  success: boolean;
  connected: boolean;
  username: string;
  facebookConnected: boolean;
  facebookTokenValid: boolean;
  facebookPageName: string;
  facebookPageId: string;
  facebookPages?: Array<{ id: string; name: string; category?: string }>;
  queue: PublishItem[];
  stats: { posted: number; failed: number; pending: number };
  schedulingConfig?: SchedulingConfig;
  perPlatform: {
    instagram: { connected: boolean; posted: number; pending: number; failed: number };
    facebook: { connected: boolean; pageName: string; posted: number; pending: number; failed: number };
  };
}

interface QueuePanelProps {
  platformFilter?: 'all' | 'facebook';
}

const SECTION_LABEL =
  'text-[10px] font-sans font-bold uppercase tracking-[0.18em] text-[#1A1A1A]/50 mb-4';

export const QueuePanel: React.FC<QueuePanelProps> = ({ platformFilter = 'all' }) => {
  const [status, setStatus] = useState<PublishStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [duplicateToast, setDuplicateToast] = useState<{ message: string; existingShortcode?: string; existingPlatform?: string; existingScheduledAt?: number } | null>(null);
  const [showScheduleConfig, setShowScheduleConfig] = useState(false);
  const [cfgDraft, setCfgDraft] = useState<SchedulingConfig | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);
  const [likeYesterdayBusy, setLikeYesterdayBusy] = useState(false);

  // IG connection state
  const [connectMode, setConnectMode] = useState<'session' | 'password'>('session');
  const [sessionId, setSessionId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState('');

  // FB connection state
  const [fbMode, setFbMode] = useState<'pageToken' | 'userToken'>('pageToken');
  const [fbPageToken, setFbPageToken] = useState('');
  const [fbUserToken, setFbUserToken] = useState('');
  const [fbPages, setFbPages] = useState<Array<{ id: string; name: string; category?: string }>>([]);
  const [fbSelectedPage, setFbSelectedPage] = useState('');
  const [fbManualPageId, setFbManualPageId] = useState('');
  const [fbSwitching, setFbSwitching] = useState<string | null>(null);
  const [fbMsg, setFbMsg] = useState('');

  // Add-post form
  const [mediaUrl, setMediaUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [postType, setPostType] = useState<'video' | 'image'>('video');
  const [isReel, setIsReel] = useState(true);
  const [queuePlatform, setQueuePlatform] = useState<'instagram' | 'facebook'>('instagram');
  const [scheduleDate, setScheduleDate] = useState('');
  const [queueing, setQueueing] = useState(false);
  const [queueMsg, setQueueMsg] = useState('');

  const [triggering, setTriggering] = useState<string | null>(null);
  const [editingTimeId, setEditingTimeId] = useState<string | null>(null);
  const [editingTimeValue, setEditingTimeValue] = useState('');

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch(`${API_BASE}/api/publish/status`);
      const data = await res.json();
      setStatus(data);
      if (data.schedulingConfig) setCfgDraft((prev) => prev || data.schedulingConfig);
    } catch {
      /* server down */
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const visibleItems = (status?.queue || []).filter((i) => platformFilter === 'facebook' ? i.platform === 'facebook' : true);
  const igItems = (status?.queue || []).filter((i) => i.platform === 'instagram');
  const fbItems = (status?.queue || []).filter((i) => i.platform === 'facebook');

  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((i) => selectedIds.has(i.id) || ['posted', 'publishing', 'downloading'].includes(i.status));

  const toggleSelectAll = () => {
    const next = new Set(selectedIds);
    if (allVisibleSelected) {
      visibleItems.forEach((i) => next.delete(i.id));
    } else {
      visibleItems.forEach((i) => {
        if (!['posted', 'publishing', 'downloading'].includes(i.status)) next.add(i.id);
      });
    }
    setSelectedIds(next);
  };

  const deleteSelected = async () => {
    for (const id of selectedIds) {
      await fetch(`${API_BASE}/api/publish/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: id }),
      });
    }
    setSelectedIds(new Set());
    fetchStatus();
  };

  const scheduleLikeYesterday = async () => {
    setLikeYesterdayBusy(true);
    setQueueMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/publish/schedule-like-yesterday`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setQueueMsg(data.message || data.error || 'Done');
      fetchStatus();
    } catch (err) {
      setQueueMsg(`Server error: ${(err as Error).message}`);
    } finally {
      setLikeYesterdayBusy(false);
    }
  };

  const saveScheduleConfig = async () => {
    if (!cfgDraft) return;
    setSavingCfg(true);
    setQueueMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/publish/scheduling-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfgDraft }),
      });
      const data = await res.json();
      setQueueMsg(data.message || (data.error || 'Config saved'));
      if (data.success) setShowScheduleConfig(false);
      fetchStatus();
    } catch (err) {
      setQueueMsg(`Server error: ${(err as Error).message}`);
    } finally {
      setSavingCfg(false);
    }
  };

  const connect = async () => {
    if (connectMode === 'session' && !sessionId.trim()) {
      setConnectMsg('Paste the sessionid cookie from DevTools (Application → Cookies → instagram.com → sessionid).');
      return;
    }
    if (connectMode === 'password' && (!username.trim() || !password)) {
      setConnectMsg('Enter username and password.');
      return;
    }
    setConnecting(true);
    setConnectMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/publish/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          connectMode === 'session'
            ? { sessionId: sessionId.trim() }
            : { username: username.trim(), password },
        ),
      });
      const data = await res.json();
      setConnectMsg(data.message || (data.error || 'Connect failed'));
      if (data.success) {
        setSessionId('');
        setPassword('');
        fetchStatus();
      }
    } catch (err) {
      setConnectMsg(`Server error: ${(err as Error).message}`);
    } finally {
      setConnecting(false);
    }
  };

  const testConnection = async () => {
    setConnecting(true);
    setConnectMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/publish/test`, { method: 'POST' });
      const data = await res.json();
      setConnectMsg(data.message || (data.error || 'Test failed'));
      fetchStatus();
    } catch (err) {
      setConnectMsg(`Server error: ${(err as Error).message}`);
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setConnecting(true);
    try {
      const res = await fetch(`${API_BASE}/api/publish/disconnect`, { method: 'POST' });
      const data = await res.json();
      setConnectMsg(data.message || (data.error || 'Disconnect failed'));
      fetchStatus();
    } catch (err) {
      setConnectMsg(`Server error: ${(err as Error).message}`);
    } finally {
      setConnecting(false);
    }
  };

  const fbListPages = async () => {
    if (!fbUserToken.trim()) {
      setFbMsg('Paste your Facebook User Access Token first (Graph API Explorer).');
      return;
    }
    setConnecting(true);
    setFbMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/facebook/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userToken: fbUserToken.trim() }),
      });
      const data = await res.json();
      if (data.success && data.pages) {
        setFbPages(data.pages);
        setFbSelectedPage(data.pages[0]?.id || '');
        setFbMsg(`Found ${data.pages.length} pages you manage — select one to connect.`);
      } else {
        setFbMsg(data.error || data.message || 'Could not list pages');
      }
    } catch (err) {
      setFbMsg(`Server error: ${(err as Error).message}`);
    } finally {
      setConnecting(false);
    }
  };

  const fbConnect = async () => {
    setConnecting(true);
    setFbMsg('');
    try {
      const body =
        fbMode === 'pageToken'
          ? { pageToken: fbPageToken.trim(), pageId: '', pageName: '' }
          : { userToken: fbUserToken.trim(), pageId: fbSelectedPage || fbManualPageId.trim(), pageName: '' };
      const res = await fetch(`${API_BASE}/api/facebook/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setFbMsg(data.message || (data.error || 'Connect failed'));
      if (data.success) {
        setFbPageToken('');
        setFbUserToken('');
        setFbManualPageId('');
        setFbPages([]);
        fetchStatus();
      }
    } catch (err) {
      setFbMsg(`Server error: ${(err as Error).message}`);
    } finally {
      setConnecting(false);
    }
  };

  const fbTest = async () => {
    setConnecting(true);
    setFbMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/facebook/test`, { method: 'POST' });
      const data = await res.json();
      setFbMsg(data.message || (data.error || 'Test failed'));
      fetchStatus();
    } catch (err) {
      setFbMsg(`Server error: ${(err as Error).message}`);
    } finally {
      setConnecting(false);
    }
  };

  const fbSwitchPage = async (pageId: string) => {
    setFbSwitching(pageId);
    setFbMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/facebook/switch-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId }),
      });
      const data = await res.json();
      setFbMsg(data.message || (data.error || 'Switch failed'));
      fetchStatus();
    } catch (err) {
      setFbMsg(`Server error: ${(err as Error).message}`);
    } finally {
      setFbSwitching(null);
    }
  };

  const fbDisconnect = async () => {
    setConnecting(true);
    try {
      const res = await fetch(`${API_BASE}/api/facebook/disconnect`, { method: 'POST' });
      const data = await res.json();
      setFbMsg(data.message || (data.error || 'Disconnect failed'));
      fetchStatus();
    } catch (err) {
      setFbMsg(`Server error: ${(err as Error).message}`);
    } finally {
      setConnecting(false);
    }
  };

  const queuePost = async () => {
    if (!mediaUrl.trim()) {
      setQueueMsg('Enter a media URL (reel/post link, shortcode, or direct media URL).');
      return;
    }
    setQueueing(true);
    setQueueMsg('');
    try {
      const shortcode =
        mediaUrl.trim().match(/\/(?:p|reel|reels|tv|video)\/([A-Za-z0-9_-]+)/)?.[1] ||
        mediaUrl.trim().split('/').filter(Boolean).pop() ||
        mediaUrl.trim().slice(0, 24);
      const body: Record<string, unknown> = {
        shortcode,
        mediaUrl: mediaUrl.trim(),
        caption,
        type: postType,
        reel: isReel,
        platform: queuePlatform,
        schedulingMode: scheduleDate ? 'manual' : 'auto',
      };
      if (scheduleDate) body.scheduledAt = new Date(scheduleDate).getTime();
      const res = await fetch(`${API_BASE}/api/publish/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setQueueMsg(data.message || (data.error || 'Queue failed'));
      if (data.success) {
        if (data.duplicate) {
          setDuplicateToast({
            message: 'Similar post already queued — it was not added twice.',
            existingShortcode: data.existingShortcode,
            existingPlatform: data.existingPlatform,
            existingScheduledAt: data.existingScheduledAt,
          });
        }
        setMediaUrl('');
        setCaption('');
        fetchStatus();
      }
    } catch (err) {
      setQueueMsg(`Server error: ${(err as Error).message}`);
    } finally {
      setQueueing(false);
    }
  };

  const triggerNow = async (itemId: string) => {
    setTriggering(itemId);
    try {
      await fetch(`${API_BASE}/api/publish/trigger-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      });
      fetchStatus();
    } finally {
      setTriggering(null);
    }
  };

  const removeItem = async (itemId: string) => {
    await fetch(`${API_BASE}/api/publish/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId }),
    });
    fetchStatus();
  };

  const setPlatform = async (itemId: string, platform: 'instagram' | 'facebook') => {
    setQueueMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/publish/set-platform`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, platform }),
      });
      const data = await res.json();
      setQueueMsg(data.message || data.error || 'Platform update failed');
      fetchStatus();
    } catch (err) {
      setQueueMsg(`Server error: ${(err as Error).message}`);
    }
  };

  const setMode = async (itemId: string, mode: 'auto' | 'manual') => {
    setQueueMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/publish/set-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, mode }),
      });
      const data = await res.json();
      if (data.message) setQueueMsg(data.message);
      fetchStatus();
    } catch (err) {
      setQueueMsg(`Server error: ${(err as Error).message}`);
    }
  };

  const setManualTime = async (itemId: string) => {
    if (!editingTimeValue) return;
    const t = new Date(editingTimeValue).getTime();
    if (Number.isNaN(t)) return;
    setQueueMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/publish/set-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, scheduledAt: t }),
      });
      const data = await res.json();
      setQueueMsg(data.message || data.error || 'Time updated');
      setEditingTimeId(null);
      fetchStatus();
    } catch (err) {
      setQueueMsg(`Server error: ${(err as Error).message}`);
    }
  };

  const clearQueue = async () => {
    await fetch(`${API_BASE}/api/publish/clear`, { method: 'POST' });
    setSelectedIds(new Set());
    fetchStatus();
  };

  const defaultSchedule = () => {
    const d = new Date(Date.now() + 30 * 60 * 1000);
    d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  const statusBadge = (item: PublishItem) => {
    switch (item.status) {
      case 'queued':
        return <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-[#1A1A1A]/5 text-[#1A1A1A]/60 border border-[#1A1A1A]/15 flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> Queued</span>;
      case 'downloading':
      case 'publishing':
        return <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-300 flex items-center gap-1 animate-pulse"><Loader2 className="w-2.5 h-2.5 animate-spin" /> {item.status}</span>;
      case 'posted':
        return <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-300 flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" /> Posted</span>;
      case 'failed':
        return <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-red-50 text-red-700 border border-red-300 flex items-center gap-1"><XCircle className="w-2.5 h-2.5" /> Failed ×{item.attempts}</span>;
    }
  };

  const remaining = (item: PublishItem) => {
    if (item.status !== 'queued') return '';
    const diff = item.scheduledAt - Date.now();
    if (diff <= 0) return 'due now';
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return `${m}m ${s}s`;
  };

  const dtLocalValue = (ts: number) => {
    return new Date(ts - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-[#19A76C] border border-[#19A76C]/40 bg-[#19A76C]/10 px-2 py-1">
              Step 3 · Queue &amp; Post
            </span>
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-[#1A1A1A]/40 hidden md:inline">
              {platformFilter === 'facebook' ? 'Facebook items only' : 'Instagram + Facebook in one queue'}
            </span>
          </div>
          <h2 className="font-serif text-3xl font-normal tracking-tight text-[#1A1A1A]">Unified Queue</h2>
          <p className="text-sm text-[#1A1A1A]/60 mt-1 font-sans">
            Items pushed from Content Stage arrive here. Set Auto (follows the daily pattern) or Manual (exact time) per item.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowScheduleConfig(!showScheduleConfig)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#1A1A1A]/5 hover:bg-[#1A1A1A]/10 text-[#1A1A1A] border border-[#1A1A1A]/20 font-sans text-[11px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer"
          >
            <Settings2 className="w-3.5 h-3.5 text-[#19A76C]" />
            Scheduling Settings
          </button>
          <button
            onClick={scheduleLikeYesterday}
            disabled={likeYesterdayBusy || !visibleItems.length}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#19A76C] hover:bg-[#148a59] text-white font-sans text-[11px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer disabled:opacity-40"
            title="Copy yesterday's posting times (+ offset) to today's queued items"
          >
            {likeYesterdayBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            Same as Yesterday
          </button>
          <button
            onClick={clearQueue}
            disabled={!status?.queue?.length}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#1A1A1A]/5 hover:bg-[#1A1A1A]/10 text-[#1A1A1A] border border-[#1A1A1A]/20 font-sans text-[11px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-500" />
            Clear Queue
          </button>
        </div>
      </div>

      {duplicateToast && (
        <div className="flex items-center justify-between gap-3 flex-wrap border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-mono text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {duplicateToast.message}
              {duplicateToast.existingShortcode && (
                <span className="ml-1 text-amber-700/80">
                  (existing: {duplicateToast.existingShortcode} · {duplicateToast.existingPlatform} ·{' '}
                  {duplicateToast.existingScheduledAt ? new Date(duplicateToast.existingScheduledAt).toLocaleString() : 'unknown time'})
                </span>
              )}
            </span>
          </div>
          <button
            onClick={() => setDuplicateToast(null)}
            className="px-3 py-1 border border-amber-400 text-amber-800 text-[10px] font-bold uppercase tracking-wider hover:bg-amber-100 transition-all cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Scheduling settings */}
      {showScheduleConfig && cfgDraft && (
        <section className="border border-[#1A1A1A]/15 bg-white p-6">
          <h3 className="font-serif text-xl font-normal tracking-tight flex items-center gap-2 mb-4">
            <Settings2 className="w-4 h-4 text-[#19A76C]" />
            Daily Scheduling Pattern
          </h3>
          <p className="text-[11px] text-[#1A1A1A]/50 mb-4 font-sans">
            Auto-scheduled posts follow this daily pattern. Excess posts roll to the next day at window start.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className={SECTION_LABEL}>Max posts / day</label>
              <input
                type="number"
                min={1}
                value={cfgDraft.maxPostsPerDay}
                onChange={(e) => setCfgDraft({ ...cfgDraft, maxPostsPerDay: Number(e.target.value) || 1 })}
                className="w-full px-3 py-2.5 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono focus:outline-none focus:border-[#19A76C]"
              />
            </div>
            <div>
              <label className={SECTION_LABEL}>Max reels / day</label>
              <input
                type="number"
                min={0}
                value={cfgDraft.maxReelsPerDay}
                onChange={(e) => setCfgDraft({ ...cfgDraft, maxReelsPerDay: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2.5 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono focus:outline-none focus:border-[#19A76C]"
              />
            </div>
            <div>
              <label className={SECTION_LABEL}>Window start</label>
              <input
                type="time"
                value={cfgDraft.windowStart}
                onChange={(e) => setCfgDraft({ ...cfgDraft, windowStart: e.target.value })}
                className="w-full px-3 py-2.5 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono focus:outline-none focus:border-[#19A76C]"
              />
            </div>
            <div>
              <label className={SECTION_LABEL}>Window end</label>
              <input
                type="time"
                value={cfgDraft.windowEnd}
                onChange={(e) => setCfgDraft({ ...cfgDraft, windowEnd: e.target.value })}
                className="w-full px-3 py-2.5 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono focus:outline-none focus:border-[#19A76C]"
              />
            </div>
            <div>
              <label className={SECTION_LABEL}>Interval (min)</label>
              <input
                type="number"
                min={10}
                value={cfgDraft.intervalMinutes}
                onChange={(e) => setCfgDraft({ ...cfgDraft, intervalMinutes: Number(e.target.value) || 30 })}
                className="w-full px-3 py-2.5 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono focus:outline-none focus:border-[#19A76C]"
              />
            </div>
            <div>
              <label className={SECTION_LABEL}>Jitter (±min)</label>
              <input
                type="number"
                min={0}
                value={cfgDraft.jitterMinutes}
                onChange={(e) => setCfgDraft({ ...cfgDraft, jitterMinutes: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2.5 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono focus:outline-none focus:border-[#19A76C]"
              />
            </div>
            <div>
              <label className={SECTION_LABEL}>Yesterday offset (min)</label>
              <input
                type="number"
                min={0}
                value={cfgDraft.sameAsYesterdayOffsetMinutes}
                onChange={(e) => setCfgDraft({ ...cfgDraft, sameAsYesterdayOffsetMinutes: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2.5 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono focus:outline-none focus:border-[#19A76C]"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={saveScheduleConfig}
                disabled={savingCfg}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#19A76C] text-white hover:bg-[#148a59] font-sans text-[11px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer disabled:opacity-50 w-full justify-center"
              >
                {savingCfg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Save Pattern
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Connection cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="border border-[#1A1A1A]/15 bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-serif text-xl font-normal tracking-tight flex items-center gap-2">
              <Plug className="w-4 h-4 text-[#FF6321]" />
              Instagram
            </h3>
            <span
              className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] border flex items-center gap-1.5 ${
                status?.connected ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-red-50 text-red-700 border-red-300'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${status?.connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              {status?.connected ? `@${status.username}` : 'Disconnected'}
            </span>
          </div>

          {!status?.connected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-[#1A1A1A]/10 pb-3">
                <button
                  onClick={() => setConnectMode('session')}
                  className={`px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-bold border transition-all cursor-pointer ${
                    connectMode === 'session' ? 'bg-[#19A76C] text-white border-[#19A76C]' : 'bg-transparent text-[#1A1A1A]/50 border-[#1A1A1A]/20 hover:text-[#1A1A1A]'
                  }`}
                >
                  Session Cookie (Recommended)
                </button>
                <button
                  onClick={() => setConnectMode('password')}
                  className={`px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-bold border transition-all cursor-pointer ${
                    connectMode === 'password' ? 'bg-[#19A76C] text-white border-[#19A76C]' : 'bg-transparent text-[#1A1A1A]/50 border-[#1A1A1A]/20 hover:text-[#1A1A1A]'
                  }`}
                >
                  Username + Password
                </button>
              </div>

              {connectMode === 'session' ? (
                <div>
                  <label className={SECTION_LABEL}>
                    <span className="flex items-center gap-1.5"><KeyRound className="w-3 h-3" /> Session ID Cookie</span>
                  </label>
                  <input
                    type="text"
                    value={sessionId}
                    onChange={(e) => setSessionId(e.target.value)}
                    placeholder="Paste sessionid cookie here (login to instagram.com → DevTools → Application → Cookies)"
                    className="w-full px-4 py-3 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono placeholder:text-[#1A1A1A]/30 focus:outline-none focus:border-[#19A76C] focus:ring-1 focus:ring-[#19A76C]/40 transition-all"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={SECTION_LABEL}>Instagram Username</label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="@your_account"
                      className="w-full px-4 py-3 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono placeholder:text-[#1A1A1A]/30 focus:outline-none focus:border-[#19A76C] focus:ring-1 focus:ring-[#19A76C]/40 transition-all"
                    />
                  </div>
                  <div>
                    <label className={SECTION_LABEL}>Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full px-4 py-3 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono placeholder:text-[#1A1A1A]/30 focus:outline-none focus:border-[#19A76C] focus:ring-1 focus:ring-[#19A76C]/40 transition-all"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={connect}
                  disabled={connecting}
                  className="flex items-center gap-2 px-6 py-3 bg-[#19A76C] text-white hover:bg-[#148a59] font-sans text-[11px] uppercase tracking-[0.2em] font-bold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
                  {connecting ? 'Connecting...' : 'Connect'}
                </button>
                <button
                  onClick={testConnection}
                  disabled={connecting}
                  className="flex items-center gap-2 px-4 py-3 bg-[#1A1A1A]/5 hover:bg-[#1A1A1A]/10 text-[#1A1A1A] border border-[#1A1A1A]/20 font-sans text-[11px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer disabled:opacity-40"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${connecting ? 'animate-spin' : ''}`} />
                  Test
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="text-sm font-mono text-[#1A1A1A]">@{status.username}</div>
                <div className="text-[11px] text-[#1A1A1A]/50 mt-1">
                  Session cookie based login — the scheduler posts automatically.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={testConnection}
                  disabled={connecting}
                  className="flex items-center gap-2 px-4 py-2.5 bg-[#1A1A1A]/5 hover:bg-[#1A1A1A]/10 text-[#1A1A1A] border border-[#1A1A1A]/20 font-sans text-[11px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${connecting ? 'animate-spin' : ''}`} />
                  Test
                </button>
                <button
                  onClick={disconnect}
                  disabled={connecting}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A]/5 hover:bg-red-50 hover:text-red-700 text-[#1A1A1A] border border-[#1A1A1A]/20 hover:border-red-300 font-sans text-[11px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer disabled:opacity-50"
                >
                  <Unplug className="w-3.5 h-3.5" />
                  Disconnect
                </button>
              </div>
            </div>
          )}

          {connectMsg && (
            <div className={`mt-4 px-4 py-3 text-sm border font-mono ${connectMsg.toLowerCase().includes('expired') || connectMsg.toLowerCase().includes('failed') || connectMsg.toLowerCase().includes('error') ? 'bg-red-50 text-red-700 border-red-300' : 'bg-emerald-50 text-emerald-700 border-emerald-300'}`}>
              {connectMsg}
            </div>
          )}
        </section>

        <section className="border border-[#1A1A1A]/15 bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-serif text-xl font-normal tracking-tight flex items-center gap-2">
              <Facebook className="w-4 h-4 text-[#1877F2]" />
              Facebook Page
            </h3>
            <span
              className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] border flex items-center gap-1.5 ${
                status?.facebookConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-red-50 text-red-700 border-red-300'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${status?.facebookConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              {status?.facebookConnected ? status.facebookPageName || status.facebookPageId : status?.facebookTokenValid === false ? 'Token Expired — Reconnect' : 'Disconnected'}
            </span>
          </div>

          {!status?.facebookConnected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-[#1A1A1A]/10 pb-3 flex-wrap">
                <button
                  onClick={() => setFbMode('pageToken')}
                  className={`px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-bold border transition-all cursor-pointer ${
                    fbMode === 'pageToken' ? 'bg-[#1877F2] text-white border-[#1877F2]' : 'bg-transparent text-[#1A1A1A]/50 border-[#1A1A1A]/20 hover:text-[#1A1A1A]'
                  }`}
                >
                  Page Access Token (Recommended)
                </button>
                <button
                  onClick={() => setFbMode('userToken')}
                  className={`px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-bold border transition-all cursor-pointer ${
                    fbMode === 'userToken' ? 'bg-[#1877F2] text-white border-[#1877F2]' : 'bg-transparent text-[#1A1A1A]/50 border-[#1A1A1A]/20 hover:text-[#1A1A1A]'
                  }`}
                >
                  User Token → All Pages
                </button>
              </div>

              {fbMode === 'pageToken' ? (
                <div>
                  <label className={SECTION_LABEL}>Page Access Token</label>
                  <input
                    type="text"
                    value={fbPageToken}
                    onChange={(e) => setFbPageToken(e.target.value)}
                    placeholder="EAAG... (from Graph API Explorer with pages_manage_posts permission)"
                    className="w-full px-4 py-3 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono placeholder:text-[#1A1A1A]/30 focus:outline-none focus:border-[#1877F2] focus:ring-1 focus:ring-[#1877F2]/40 transition-all"
                  />
                  <p className="text-[11px] text-[#1A1A1A]/50 mt-2">
                    How to get it: <span className="font-mono">developers.facebook.com → Create App (Business type) → Graph API Explorer → Add your Page as a test user → Generate Access Token</span> with <span className="font-mono">pages_manage_posts</span> + <span className="font-mono">pages_read_engagement</span>.
                  </p>
                </div>
              ) : (
                <div>
                  <label className={SECTION_LABEL}>User Access Token</label>
                  <input
                    type="text"
                    value={fbUserToken}
                    onChange={(e) => setFbUserToken(e.target.value)}
                    placeholder="EAAG... (user token from Graph API Explorer)"
                    className="w-full px-4 py-3 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono placeholder:text-[#1A1A1A]/30 focus:outline-none focus:border-[#1877F2] focus:ring-1 focus:ring-[#1877F2]/40 transition-all"
                  />
                  <button
                    onClick={fbListPages}
                    disabled={connecting}
                    className="mt-3 flex items-center gap-2 px-4 py-2 bg-[#1A1A1A]/5 hover:bg-[#1A1A1A]/10 text-[#1A1A1A] border border-[#1A1A1A]/20 font-sans text-[11px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer disabled:opacity-50"
                  >
                    {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-[#1877F2]" />}
                    Fetch My Pages
                  </button>
                  {fbPages.length > 0 && (
                    <div className="mt-3">
                      <label className={SECTION_LABEL}>Select Page</label>
                      <select
                        value={fbSelectedPage}
                        onChange={(e) => setFbSelectedPage(e.target.value)}
                        className="w-full px-4 py-3 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono focus:outline-none focus:border-[#1877F2]"
                      >
                        {fbPages.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {p.category ? `· ${p.category}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="mt-3">
                    <label className={SECTION_LABEL}>Page ID (manual — if the pages list comes back empty)</label>
                    <input
                      type="text"
                      value={fbManualPageId}
                      onChange={(e) => setFbManualPageId(e.target.value)}
                      placeholder="e.g. 852686814586638"
                      className="w-full px-4 py-3 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono placeholder:text-[#1A1A1A]/30 focus:outline-none focus:border-[#1877F2]"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={fbConnect}
                  disabled={connecting}
                  className="flex items-center gap-2 px-6 py-3 bg-[#1877F2] text-white hover:bg-[#0f62c9] font-sans text-[11px] uppercase tracking-[0.2em] font-bold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
                  {connecting ? 'Connecting...' : 'Connect Page'}
                </button>
                <button
                  onClick={fbTest}
                  disabled={connecting}
                  className="flex items-center gap-2 px-4 py-3 bg-[#1A1A1A]/5 hover:bg-[#1A1A1A]/10 text-[#1A1A1A] border border-[#1A1A1A]/20 font-sans text-[11px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer disabled:opacity-40"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${connecting ? 'animate-spin' : ''}`} />
                  Test
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <div className="text-sm font-mono text-[#1A1A1A]">{status.facebookPageName || status.facebookPageId}</div>
                  <div className="text-[11px] text-[#1A1A1A]/50 mt-1">
                    Page Access Token connected — scheduler posts via Graph API.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={fbTest}
                    disabled={connecting}
                    className="flex items-center gap-2 px-4 py-2.5 bg-[#1A1A1A]/5 hover:bg-[#1A1A1A]/10 text-[#1A1A1A] border border-[#1A1A1A]/20 font-sans text-[11px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-[#1877F2] ${connecting ? 'animate-spin' : ''}`} />
                    Test
                  </button>
                  <button
                    onClick={fbDisconnect}
                    disabled={connecting}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A]/5 hover:bg-red-50 hover:text-red-700 text-[#1A1A1A] border border-[#1A1A1A]/20 hover:border-red-300 font-sans text-[11px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Unplug className="w-3.5 h-3.5" />
                    Disconnect
                  </button>
                </div>
              </div>

              {status.facebookPages && status.facebookPages.length >= 1 && (
                <div className="mt-6 border-t border-[#1A1A1A]/10 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-sans text-[11px] uppercase tracking-[0.2em] font-bold text-[#1A1A1A]/60">
                      Connected Pages ({status.facebookPages.length})
                    </h4>
                    <span className="text-[10px] text-[#1A1A1A]/40 font-sans uppercase tracking-wider">
                      switch the active posting page
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {status.facebookPages.map((p) => {
                      const isActive = p.id === status.facebookPageId;
                      return (
                        <div
                          key={p.id}
                          className={`flex items-center justify-between gap-3 px-4 py-2.5 border ${isActive ? 'border-emerald-300 bg-emerald-50/60' : 'border-[#1A1A1A]/15 bg-[#F5F2ED]/40'}`}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[#1A1A1A] truncate">{p.name}</div>
                            {p.category && <div className="text-[11px] text-[#1A1A1A]/50">{p.category}</div>}
                          </div>
                          {isActive ? (
                            <span className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] border border-emerald-300 bg-emerald-50 text-emerald-700 shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Connected
                            </span>
                          ) : (
                            <button
                              onClick={() => fbSwitchPage(p.id)}
                              disabled={!!fbSwitching}
                              className="flex items-center gap-2 px-3 py-1.5 bg-[#1877F2] hover:bg-[#0f62c9] text-white font-sans text-[10px] uppercase tracking-[0.15em] font-bold transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                            >
                              {fbSwitching === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                              {fbSwitching === p.id ? 'Switching...' : 'Switch'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {fbMsg && (
            <div className={`mt-4 px-4 py-3 text-sm border font-mono ${fbMsg.toLowerCase().includes('error') || fbMsg.toLowerCase().includes('invalid') || fbMsg.toLowerCase().includes('fail') ? 'bg-red-50 text-red-700 border-red-300' : 'bg-emerald-50 text-emerald-700 border-emerald-300'}`}>
              {fbMsg}
            </div>
          )}
        </section>
      </div>

      {/* Queue New Post */}
      <section className="border border-[#1A1A1A]/15 bg-white p-6">
        <h3 className="font-serif text-xl font-normal tracking-tight flex items-center gap-2 mb-5">
          <Plus className="w-4 h-4 text-[#19A76C]" />
          Queue New Post
        </h3>

        <div className="space-y-4">
          <div>
            <label className={SECTION_LABEL}>
              <span className="flex items-center gap-1.5"><Link2 className="w-3 h-3" /> Media URL / Shortcode</span>
            </label>
            <input
              type="text"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="https://www.instagram.com/reel/XXXX/ or shortcode or direct CDN video URL"
              className="w-full px-4 py-3 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono placeholder:text-[#1A1A1A]/30 focus:outline-none focus:border-[#19A76C] focus:ring-1 focus:ring-[#19A76C]/40 transition-all"
            />
          </div>

          <div>
            <label className={SECTION_LABEL}>
              <span className="flex items-center gap-1.5"><StickyNote className="w-3 h-3" /> Caption</span>
            </label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Caption for the post (up to 2200 chars)."
              rows={3}
              className="w-full px-4 py-3 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono placeholder:text-[#1A1A1A]/30 focus:outline-none focus:border-[#19A76C] focus:ring-1 focus:ring-[#19A76C]/40 transition-all resize-none"
            />
            <div className="mt-1 text-right text-[10px] font-mono text-[#1A1A1A]/40">{caption.length}/2200</div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <label className={SECTION_LABEL}>Platform</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQueuePlatform('instagram')}
                  className={`flex-1 px-3 py-2.5 text-[11px] uppercase tracking-[0.15em] font-bold border transition-all cursor-pointer ${
                    queuePlatform === 'instagram' ? 'bg-[#FF6321] text-white border-[#FF6321]' : 'bg-transparent text-[#1A1A1A]/50 border-[#1A1A1A]/20'
                  }`}
                >
                  IG
                </button>
                <button
                  onClick={() => setQueuePlatform('facebook')}
                  className={`flex-1 px-3 py-2.5 text-[11px] uppercase tracking-[0.15em] font-bold border transition-all cursor-pointer ${
                    queuePlatform === 'facebook' ? 'bg-[#1877F2] text-white border-[#1877F2]' : 'bg-transparent text-[#1A1A1A]/50 border-[#1A1A1A]/20'
                  }`}
                >
                  FB
                </button>
              </div>
            </div>
            <div>
              <label className={SECTION_LABEL}>Media Type</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPostType('video')}
                  className={`flex-1 px-3 py-2.5 text-[11px] uppercase tracking-[0.15em] font-bold border transition-all cursor-pointer ${
                    postType === 'video' ? 'bg-[#19A76C] text-white border-[#19A76C]' : 'bg-transparent text-[#1A1A1A]/50 border-[#1A1A1A]/20'
                  }`}
                >
                  Video
                </button>
                <button
                  onClick={() => setPostType('image')}
                  className={`flex-1 px-3 py-2.5 text-[11px] uppercase tracking-[0.15em] font-bold border transition-all cursor-pointer ${
                    postType === 'image' ? 'bg-[#19A76C] text-white border-[#19A76C]' : 'bg-transparent text-[#1A1A1A]/50 border-[#1A1A1A]/20'
                  }`}
                >
                  Image
                </button>
              </div>
            </div>

            {postType === 'video' && (
              <div>
                <label className={SECTION_LABEL}>Format</label>
                <button
                  onClick={() => setIsReel(!isReel)}
                  className={`w-full px-3 py-2.5 text-[11px] uppercase tracking-[0.15em] font-bold border transition-all cursor-pointer ${
                    isReel ? 'bg-[#19A76C] text-white border-[#19A76C]' : 'bg-transparent text-[#1A1A1A]/50 border-[#1A1A1A]/20'
                  }`}
                >
                  {isReel ? 'Reel' : 'Feed Video'}
                </button>
              </div>
            )}

            <div className="col-span-2">
              <label className={SECTION_LABEL}>
                <span className="flex items-center gap-1.5"><CalendarClock className="w-3 h-3" /> Schedule (empty = Auto pattern)</span>
              </label>
              <input
                type="datetime-local"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="w-full px-3 py-2.5 bg-[#F5F2ED] border border-[#1A1A1A]/20 text-sm font-mono focus:outline-none focus:border-[#19A76C]"
              />
            </div>
          </div>

          {queuePlatform === 'facebook' && (
            <div className="flex items-center gap-2 px-4 py-3 bg-[#1877F2]/5 border border-[#1877F2]/30 text-[12px] font-mono text-[#0f62c9]">
              <Facebook className="w-3.5 h-3.5 shrink-0" />
              {status?.facebookConnected
                ? <>Will post to: <strong>{status.facebookPageName || status.facebookPageId}</strong></>
                : 'No Facebook page connected — connect one above first.'}
            </div>
          )}

          <button
            onClick={queuePost}
            disabled={queueing}
            className="flex items-center gap-2 px-6 py-3 bg-[#1A1A1A] text-white hover:bg-black font-sans text-[11px] uppercase tracking-[0.2em] font-bold transition-colors disabled:opacity-50 cursor-pointer"
          >
            {queueing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 text-[#19A76C]" />}
            {queueing ? 'Queueing...' : 'Add to Queue'}
          </button>
          {queueMsg && <div className="px-4 py-3 text-sm border font-mono bg-[#F5F2ED] border-[#1A1A1A]/15 text-[#1A1A1A]">{queueMsg}</div>}
        </div>
      </section>

      {/* Queue */}
      <section className="border border-[#1A1A1A]/15 bg-white p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="font-serif text-xl font-normal tracking-tight flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#19A76C]" />
            {platformFilter === 'facebook' ? 'Facebook Queue' : 'Scheduled Queue'}
          </h3>
          {status && (
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider flex-wrap">
              <span className="px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-300">{status.stats.posted} posted</span>
              <span className="px-2 py-1 bg-amber-50 text-amber-700 border border-amber-300">{status.stats.pending} pending</span>
              <span className="px-2 py-1 bg-red-50 text-red-700 border border-red-300">{status.stats.failed} failed</span>
              <span className="px-2 py-1 bg-[#F5F2ED] text-[#1A1A1A]/60 border border-[#1A1A1A]/15">IG {igItems.length} · FB {fbItems.length}{status?.facebookConnected && fbItems.length > 0 ? ` → ${status.facebookPageName || status.facebookPageId}` : ''}</span>
            </div>
          )}
        </div>

        {visibleItems.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-3 pb-3 border-b border-[#1A1A1A]/10">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1A]/5 hover:bg-[#1A1A1A]/10 text-[10px] font-bold uppercase tracking-wider border border-[#1A1A1A]/20 transition-all cursor-pointer"
            >
              {allVisibleSelected ? <CheckSquare className="w-3 h-3 text-[#19A76C]" /> : <Square className="w-3 h-3" />}
              {allVisibleSelected ? 'Deselect All' : 'Select All'}
            </button>
            {selectedIds.size > 0 && (
              <button
                onClick={deleteSelected}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-wider border border-red-300 transition-all cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                Delete {selectedIds.size} selected
              </button>
            )}
            <span className="text-[10px] font-mono text-[#1A1A1A]/40 ml-auto">
              Auto = daily pattern · Manual = exact time
            </span>
          </div>
        )}

        {!visibleItems.length ? (
          <div className="py-12 text-center text-sm text-[#1A1A1A]/40 font-sans">
            {platformFilter === 'facebook'
              ? 'FB queue is empty. Push posts from the Content Stage (Step 2) — or add one manually above.'
              : 'Queue is empty. Scrape posts (Step 1) → send them to the Content Stage (Step 2) → push to the queue — or add a post manually above.'}
          </div>
        ) : (
          <div className="space-y-3">
            {visibleItems.map((item) => (
              <div
                key={item.id}
                className={`border p-4 flex flex-col md:flex-row md:items-center gap-3 ${item.duplicate ? 'border-amber-300 bg-amber-50/40' : 'border-[#1A1A1A]/10 bg-[#FBF9F6]'}`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  disabled={['posted', 'publishing', 'downloading'].includes(item.status)}
                  onChange={(e) => {
                    const next = new Set(selectedIds);
                    if (e.target.checked) next.add(item.id);
                    else next.delete(item.id);
                    setSelectedIds(next);
                  }}
                  className="accent-[#19A76C] disabled:opacity-30 shrink-0"
                />
                <div className="w-full md:w-24 h-20 shrink-0 bg-[#1A1A1A]/5 relative overflow-hidden border border-[#1A1A1A]/10">
                  {item.type === 'image' ? (
                    <img src={item.mediaUrl} alt={item.shortcode} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className={`w-full h-full bg-gradient-to-br flex flex-col items-center justify-center gap-1 ${item.platform === 'facebook' ? 'from-[#1877F2]/20 to-[#19A76C]/20' : 'from-[#FF6321]/20 to-[#19A76C]/20'}`}>
                      <Play className="w-5 h-5 text-[#1A1A1A]/50" />
                      <span className="text-[8px] font-bold uppercase tracking-widest text-[#1A1A1A]/40">
                        {item.reel ? 'Reel' : 'Video'}
                      </span>
                    </div>
                  )}
                  <span className={`absolute bottom-0 right-0 px-1 py-0.5 text-[8px] font-bold uppercase text-white ${item.platform === 'facebook' ? 'bg-[#1877F2]' : 'bg-[#FF6321]'}`}>
                    {item.platform === 'facebook' ? 'FB' : 'IG'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase ${item.platform === 'facebook' ? 'bg-[#1877F2]' : 'bg-[#FF6321]'} text-white`}>
                      {item.platform === 'facebook' ? 'FB' : 'IG'}
                    </span>
                    <span className="font-mono text-sm font-bold text-[#1A1A1A]">{item.shortcode}</span>
                    <span className="text-[10px] font-mono text-[#1A1A1A]/40 uppercase border border-[#1A1A1A]/10 px-1.5 py-0.5">{item.type}{item.reel && item.type === 'video' ? ' · reel' : ''}</span>
                    {item.destination && <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-[#19A76C]/10 text-[#0f7a4d] border border-[#19A76C]/40">{item.destination === 'both' ? 'Both' : item.destination === 'fb' ? '→ FB' : '→ IG'}</span>}
                    {statusBadge(item)}
                  </div>
                  {item.caption && (
                    <div className="text-xs text-[#1A1A1A]/60 mt-1 font-sans truncate">“{item.caption.slice(0, 90)}{item.caption.length > 90 ? '…' : ''}”</div>
                  )}
                  {item.error && <div className="text-[11px] font-mono text-red-600 mt-1 break-all">{item.error}</div>}
                  {item.postUrl && (
                    <a href={item.postUrl} target="_blank" rel="noreferrer" className="text-[11px] font-mono text-[#19A76C] mt-1 block hover:underline">
                      {item.postUrl}
                    </a>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[9px] font-sans uppercase tracking-wider text-[#1A1A1A]/40">Upload to:</span>
                    {(['instagram', 'facebook'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPlatform(item.id, p)}
                        disabled={['posted', 'publishing', 'downloading'].includes(item.status)}
                        className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          item.platform === p
                            ? p === 'instagram'
                              ? 'bg-[#FF6321] text-white border-[#FF6321]'
                              : 'bg-[#1877F2] text-white border-[#1877F2]'
                            : 'bg-white text-[#1A1A1A]/60 border-[#1A1A1A]/20 hover:border-[#1A1A1A]'
                        }`}
                      >
                        {p === 'instagram' ? 'IG' : 'FB'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <select
                    value={item.schedulingMode || 'auto'}
                    onChange={(e) => setMode(item.id, e.target.value as 'auto' | 'manual')}
                    disabled={item.status !== 'queued'}
                    className="px-2 py-1 border border-[#1A1A1A]/20 text-[10px] font-mono font-bold focus:outline-none focus:border-[#19A76C] disabled:opacity-40 bg-white"
                    title="Auto follows the daily pattern · Manual picks an exact time"
                  >
                    <option value="auto">Auto</option>
                    <option value="manual">Manual</option>
                  </select>
                  {editingTimeId === item.id && item.status === 'queued' ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="datetime-local"
                        value={editingTimeValue}
                        onChange={(e) => setEditingTimeValue(e.target.value)}
                        className="px-2 py-1 border border-[#19A76C] text-[10px] font-mono focus:outline-none bg-white"
                        autoFocus
                      />
                      <button
                        onClick={() => setManualTime(item.id)}
                        className="px-2 py-1 bg-[#19A76C] text-white text-[9px] font-bold uppercase tracking-wider hover:bg-[#148a59] transition-colors cursor-pointer"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingTimeId(null)}
                        className="px-2 py-1 border border-[#1A1A1A]/20 text-[9px] font-bold uppercase tracking-wider hover:bg-[#1A1A1A]/5 transition-colors cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="text-right">
                      <div className="text-[10px] font-mono text-[#1A1A1A]/50 uppercase">scheduled</div>
                      <button
                        onClick={() => {
                          setEditingTimeId(item.id);
                          setEditingTimeValue(dtLocalValue(item.scheduledAt));
                        }}
                        disabled={item.status !== 'queued'}
                        className={`text-xs font-mono text-[#1A1A1A] hover:text-[#19A76C] transition-colors disabled:cursor-default disabled:hover:text-[#1A1A1A] ${item.status === 'queued' ? 'cursor-pointer underline decoration-dotted underline-offset-2' : ''}`}
                        title="Click to edit the scheduled time"
                      >
                        {new Date(item.scheduledAt).toLocaleString()}
                        {item.status === 'queued' && <span className={`ml-1 font-bold ${item.platform === 'facebook' ? 'text-[#1877F2]' : 'text-[#19A76C]'}`}>({remaining(item)})</span>}
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() => triggerNow(item.id)}
                    disabled={triggering === item.id || item.status === 'posted' || item.status === 'publishing' || item.status === 'downloading'}
                    className="p-2 border border-[#1A1A1A]/20 hover:bg-[#19A76C] hover:text-white hover:border-[#19A76C] transition-all cursor-pointer disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit disabled:hover:border-[#1A1A1A]/20"
                    title="Post now"
                  >
                    {triggering === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => removeItem(item.id)}
                    disabled={item.status === 'publishing' || item.status === 'downloading'}
                    className="p-2 border border-[#1A1A1A]/20 hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition-all cursor-pointer disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit disabled:hover:border-[#1A1A1A]/20"
                    title="Remove from queue"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {loadingStatus && (
        <div className="text-center text-[10px] font-mono uppercase tracking-widest text-[#1A1A1A]/30 flex items-center justify-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Refreshing…
        </div>
      )}
    </div>
  );
};