import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Radio, PlugZap, Unplug, RefreshCw, CalendarDays, Zap, Trash2,
  Wand2, PlusCircle, Loader2, AlertTriangle, CheckCircle2, Clock, Video
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

type Platform = 'instagram' | 'tiktok' | 'facebook';

interface ConnStatus {
  connected: boolean;
  needs: string[];
}

interface ScheduledItemView {
  id: string;
  shortcode: string;
  platform: Platform;
  scheduledAt: number;
  postedCount: number;
  cyclePosition: number;
  lastPostedAt?: number;
  progress?: {
    percentage: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    error?: string;
    lastUpdate: number;
  };
}

interface DashboardData {
  queueSize: number;
  config: {
    defaultGapMs: number;
    maxCycleSize: number;
    randomJitterMs: number;
  };
  platformStats: Record<Platform, { posted: number; failed: number }>;
  activeItems: ScheduledItemView[];
}

const PLATFORM_META: Record<Platform, { label: string; accent: string; icon: React.ReactNode }> = {
  instagram: { label: 'Instagram', accent: '#FF6321', icon: <Radio className="w-4 h-4" /> },
  tiktok: { label: 'TikTok', accent: '#FF0050', icon: <Radio className="w-4 h-4" /> },
  facebook: { label: 'Facebook', accent: '#1877F2', icon: <Radio className="w-4 h-4" /> }
};

const SECTION_LABEL = 'text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40 mb-2';

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(ms: number): string {
  if (ms >= 3600000) {
    const h = Math.floor(ms / 3600000);
    const m = Math.round((ms % 3600000) / 60000);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const m = Math.floor(ms / 60000);
  return m ? `${m}m` : `${Math.round(ms / 1000)}s`;
}

export const AutoPublisherPanel: React.FC = () => {
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [conn, setConn] = useState<Record<Platform, ConnStatus>>({
    instagram: { connected: false, needs: [] },
    tiktok: { connected: false, needs: [] },
    facebook: { connected: false, needs: [] }
  });
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashError, setDashError] = useState('');

  const [gap, setGap] = useState(3600);
  const [cycle, setCycle] = useState(3);
  const [jitter, setJitter] = useState(1800);
  const [platforms, setPlatforms] = useState<Record<Platform, boolean>>({
    instagram: true, tiktok: true, facebook: true
  });
  const [working, setWorking] = useState('');

  // Connection form state
  const [connectTarget, setConnectTarget] = useState<Platform>('instagram');
  const [formInputs, setFormInputs] = useState<Record<string, string>>({});
  const [formMsg, setFormMsg] = useState<{ text: string; error?: boolean } | null>(null);

  // Caption generator state
  const [genPlatform, setGenPlatform] = useState<Platform>('instagram');
  const [genMediaType, setGenMediaType] = useState<'video' | 'image' | 'carousel'>('video');
  const [genShortcode, setGenShortcode] = useState('');
  const [genCaption, setGenCaption] = useState('');
  const [genHashtags, setGenHashtags] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState('');
  const [queuedId, setQueuedId] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);

  const fetchJson = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      await fetchJson('/api/health');
      setServerOnline(true);
      setDashError('');
    } catch {
      setServerOnline(false);
      setDashError('Server offline — start it with npm run dev');
      return;
    }
    try {
      const [statusRes, dashRes] = await Promise.all([
        fetchJson('/api/schedule/connection-status'),
        fetchJson('/api/schedule/dashboard')
      ]);
      setConn(statusRes.status);
      setDashboard(dashRes);
    } catch (e) {
      setDashError((e as Error).message);
    }
  }, [fetchJson]);

  useEffect(() => {
    refreshAll();
    pollRef.current = window.setInterval(refreshAll, 5000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [refreshAll]);

  // TikTok OAuth callback: ?code=...&state=... lands on this SPA after authorize
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;
    (async () => {
      try {
        await fetchJson('/api/tiktok/exchange', {
          method: 'POST',
          body: JSON.stringify({ code })
        });
        setFormMsg({ text: 'TikTok authorized — account connected successfully' });
        const statusRes = await fetchJson('/api/schedule/connection-status');
        setConn(statusRes.status);
      } catch (e) {
        setFormMsg({ text: `TikTok OAuth failed: ${(e as Error).message}`, error: true });
      }
      window.history.replaceState({}, document.title, window.location.pathname);
      setWorking('');
    })();
  }, [fetchJson]);

  const busy = (label: string) => {
    setWorking(label);
    return setTimeout(() => setWorking(''), 4000);
  };

  const handleSaveConfig = async () => {
    busy('Saving scheduler config...');
    await fetchJson('/api/schedule/config', {
      method: 'POST',
      body: JSON.stringify({
        defaultGapMs: gap * 1000,
        maxCycleSize: cycle,
        randomJitterMs: jitter * 1000
      })
    });
    await refreshAll();
  };

  const handleTriggerNow = async () => {
    busy('Posting next item now...');
    const res = await fetchJson('/api/schedule/trigger-now', {
      method: 'POST',
      body: JSON.stringify({ platform: 'all' })
    });
    setDashError(res.success ? '' : res.message);
    await refreshAll();
  };

  const setInput = (key: string, value: string) =>
    setFormInputs(prev => ({ ...prev, [key]: value }));

  const handleConnect = async () => {
    setFormMsg(null);
    busy(`Connecting ${connectTarget}...`);
    try {
      await fetchJson('/api/schedule/connect-page', {
        method: 'POST',
        body: JSON.stringify({ platform: connectTarget, ...formInputs })
      });
      setFormInputs({});
      setFormMsg({ text: `${PLATFORM_META[connectTarget].label} connected successfully` });
      const statusRes = await fetchJson('/api/schedule/connection-status');
      setConn(statusRes.status);
    } catch (e) {
      setFormMsg({ text: (e as Error).message, error: true });
    }
    setWorking('');
  };

  const handleTikTokOAuth = async () => {
    setFormMsg(null);
    busy('Redirecting to TikTok...');
    try {
      const res = await fetchJson('/api/tiktok/oauth-url');
      window.location.href = res.url;
    } catch (e) {
      setFormMsg({ text: (e as Error).message, error: true });
      setWorking('');
    }
  };

  const handleDisconnect = async (platform: Platform) => {
    busy(`Disconnecting ${platform}...`);
    await fetchJson('/api/schedule/disconnect-page', {
      method: 'POST',
      body: JSON.stringify({ platform })
    });
    const statusRes = await fetchJson('/api/schedule/connection-status');
    setConn(statusRes.status);
  };

  const handleTest = async (platform: Platform) => {
    busy(`Testing ${platform} connection...`);
    try {
      const res = await fetchJson('/api/schedule/test-connection', {
        method: 'POST',
        body: JSON.stringify({ platform })
      });
      setDashError(res.message);
    } catch (e) {
      setDashError((e as Error).message);
    }
    setWorking('');
  };

  const handleRemove = async (itemId: string) => {
    await fetchJson('/api/schedule/remove', {
      method: 'POST',
      body: JSON.stringify({ itemId })
    });
    await refreshAll();
  };

  const handleClear = async () => {
    await fetchJson('/api/schedule/clear', { method: 'POST', body: '{}' });
    await refreshAll();
  };

  const handleGenerateCaption = async () => {
    if (!genShortcode.trim()) {
      setGenError('Enter a shortcode / post ID');
      setGenCaption('');
      return;
    }
    setGenBusy(true);
    setGenError('');
    try {
      const res = await fetchJson('/api/caption/generate', {
        method: 'POST',
        body: JSON.stringify({ platform: genPlatform, mediaType: genMediaType, shortcode: genShortcode.trim() })
      });
      setGenCaption(res.caption);
      setGenHashtags(res.hashtagString);
      setQueuedId(null);
    } catch (e) {
      setGenError((e as Error).message);
    }
    setGenBusy(false);
  };

  const handleQueueCaption = async () => {
    if (!genShortcode.trim() || !genCaption) return;
    busy('Queuing post with AI caption...');
    try {
      const mediaUrl =
        genMediaType === 'video'
          ? genPlatform === 'tiktok'
            ? `${window.location.origin}/demo.mp4`
            : 'VIDEO:' + genShortcode.trim()
          : 'IMAGE:' + genShortcode.trim();
      const res = await fetchJson('/api/schedule/add-with-caption', {
        method: 'POST',
        body: JSON.stringify({
          id: `${genPlatform}-${genShortcode.trim()}-${Date.now()}`,
          shortcode: genShortcode.trim(),
          platform: genPlatform,
          mediaUrl,
          type: genMediaType,
          existingCaption: `${genCaption}\n\n${genHashtags}`,
          generateCaptionAI: false,
          targetPage: 'queue',
          platformSelect: genPlatform
        })
      });
      setQueuedId(res.itemId);
      await refreshAll();
    } catch (e) {
      setGenError((e as Error).message);
    }
    setWorking('');
  };

  const platformAccent = (p: Platform) => PLATFORM_META[p].accent;

  const inputCls =
    'w-full px-3 py-2 bg-white border border-[#1A1A1A]/20 focus:outline-none focus:border-[#1A1A1A] text-[13px] font-sans text-[#1A1A1A] placeholder:text-[#1A1A1A]/30';

  return (
    <div className="space-y-8">

      {/* Server status bar */}
      <div className={`flex items-center justify-between border p-5 ${
        serverOnline === false ? 'border-red-900/20 bg-red-50' : 'border-[#1A1A1A]/10 bg-[#FBF9F6]'
      }`}>
        <div className="flex items-center gap-4">
          <div className={`w-2.5 h-2.5 rounded-full ${serverOnline ? 'bg-green-600' : serverOnline === null ? 'bg-[#1A1A1A]/30 animate-pulse' : 'bg-red-600'}`} />
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40">
              Publisher Server · {API_BASE.replace(/^https?:\/\//, '')}
            </p>
            <p className="font-serif text-lg leading-tight mt-0.5">
              {serverOnline === null ? 'Checking server...' : serverOnline ? 'Server online — scheduler active' : 'Server offline'}
            </p>
            {dashError && <p className="text-xs text-[#FF6321] mt-1 font-sans">{dashError}</p>}
          </div>
        </div>
        <button
          onClick={refreshAll}
          className="flex items-center gap-2 px-4 py-2.5 border border-[#1A1A1A]/20 hover:bg-[#1A1A1A]/5 text-[#1A1A1A] font-sans text-[10px] uppercase tracking-[0.15em] font-bold transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${working ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* LEFT: Platform connections */}
        <div className="lg:col-span-2 space-y-8">
          <section className="bg-[#FBF9F6] border border-[#1A1A1A]/10 p-6">
            <p className={SECTION_LABEL}>Connect Accounts</p>
            <h3 className="font-serif text-2xl font-normal mb-1 flex items-center gap-3">
              <PlugZap className="w-5 h-5 text-[#FF6321]" />
              Platform Connections
            </h3>
            <p className="text-xs text-[#1A1A1A]/60 mb-6 font-sans">Real credentials required — publisher posts via each platform's official API.</p>

            <div className="space-y-3">
              {(Object.keys(PLATFORM_META) as Platform[]).map(p => {
                const c = conn[p];
                return (
                  <div key={p} className="border border-[#1A1A1A]/10 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 border border-[#1A1A1A]/10 bg-[#FBF9F6] flex items-center justify-center" style={{ color: platformAccent(p) }}>
                          {PLATFORM_META[p].icon}
                        </span>
                        <span className="font-sans text-[12px] font-bold uppercase tracking-[0.1em]">{PLATFORM_META[p].label}</span>
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-[0.15em] px-2 py-1 font-sans ${
                        c.connected ? 'bg-green-100 text-green-800' : 'bg-[#1A1A1A]/5 text-[#1A1A1A]/50'
                      }`}>
                        {c.connected ? 'Connected' : 'Not connected'}
                      </span>
                    </div>
                    {!c.connected && (
                      <ul className="mt-3 space-y-1">
                        {c.needs.map((n, i) => (
                          <li key={i} className="text-[11px] text-[#1A1A1A]/50 font-sans flex items-center gap-1.5">
                            <span className="w-1 h-1 bg-[#FF6321]" /> {n}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!c.connected && p === 'tiktok' && (
                      <button onClick={handleTikTokOAuth} className="mt-3 w-full flex items-center justify-center gap-2 bg-[#1A1A1A] text-white hover:bg-black px-3 py-2.5 font-sans text-[10px] uppercase tracking-[0.15em] font-bold transition-all">
                        {working === 'Redirecting to TikTok...' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3 text-[#FF0050]" />}
                        Connect with TikTok (Login Kit OAuth)
                      </button>
                    )}
                    <div className="mt-3 flex gap-2">
                      {c.connected ? (
                        <button onClick={() => handleDisconnect(p)} className="flex-1 flex items-center justify-center gap-1.5 border border-[#1A1A1A]/20 px-3 py-2 text-[10px] uppercase tracking-[0.15em] font-bold font-sans hover:bg-[#1A1A1A]/5">
                          <Unplug className="w-3 h-3" /> Disconnect
                        </button>
                      ) : (
                        <button onClick={() => { setConnectTarget(p); setFormInputs({}); setFormMsg(null); }} className="flex-1 flex items-center justify-center gap-1.5 text-white px-3 py-2 text-[10px] uppercase tracking-[0.15em] font-bold font-sans" style={{ background: platformAccent(p) }}>
                          <PlusCircle className="w-3 h-3" /> Add Credentials
                        </button>
                      )}
                      <button onClick={() => handleTest(p)} disabled={!c.connected} className="flex-1 flex items-center justify-center gap-1.5 border border-[#1A1A1A]/20 px-3 py-2 text-[10px] uppercase tracking-[0.15em] font-bold font-sans hover:bg-[#1A1A1A]/5 disabled:opacity-40">
                        <Zap className="w-3 h-3" /> Test
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Connection form */}
          <section className="bg-[#FBF9F6] border border-[#1A1A1A]/10 p-6">
            <p className={SECTION_LABEL}>Credentials</p>
            <h4 className="font-serif text-xl font-normal mb-1">Add {PLATFORM_META[connectTarget].label} Account</h4>
            <p className="text-xs text-[#1A1A1A]/60 mb-4 font-sans">Tokens are stored in server memory only.</p>

            <div className="flex gap-1 mb-4 border border-[#1A1A1A]/10">
              {(Object.keys(PLATFORM_META) as Platform[]).map(p => (
                <button key={p} onClick={() => { setConnectTarget(p); setFormInputs({}); setFormMsg(null); }} className={`flex-1 py-2 text-[10px] uppercase tracking-[0.15em] font-bold font-sans transition-all ${
                  connectTarget === p ? 'text-white' : 'text-[#1A1A1A]/40 hover:text-[#1A1A1A]'
                }`} style={connectTarget === p ? { background: platformAccent(p) } : undefined}>
                  {PLATFORM_META[p].label}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {connectTarget === 'instagram' && (
                <>
                  <div>
                    <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Instagram Username</label>
                    <input className={inputCls} placeholder="@handle" value={formInputs.username || ''} onChange={e => setInput('username', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">IG User ID (Business)</label>
                    <input className={inputCls} placeholder="1784140..." value={formInputs.igUserId || ''} onChange={e => setInput('igUserId', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Facebook Access Token</label>
                    <input className={inputCls} type="password" placeholder="FB token with instagram_basic" value={formInputs.accessToken || ''} onChange={e => setInput('accessToken', e.target.value)} />
                  </div>
                </>
              )}
              {connectTarget === 'tiktok' && (
                <>
                  <div>
                    <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Access Token</label>
                    <input className={inputCls} type="password" placeholder="TikTok Content Posting API token" value={formInputs.accessToken || ''} onChange={e => setInput('accessToken', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Open ID</label>
                    <input className={inputCls} placeholder="open_id" value={formInputs.openId || ''} onChange={e => setInput('openId', e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Client Key</label>
                      <input className={inputCls} value={formInputs.clientKey || ''} onChange={e => setInput('clientKey', e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Client Secret</label>
                      <input className={inputCls} value={formInputs.clientSecret || ''} onChange={e => setInput('clientSecret', e.target.value)} />
                    </div>
                  </div>
                </>
              )}
              {connectTarget === 'facebook' && (
                <>
                  <div>
                    <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Page ID</label>
                    <input className={inputCls} placeholder="1234567890" value={formInputs.pageId || ''} onChange={e => setInput('pageId', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Page Name</label>
                    <input className={inputCls} placeholder="My Page" value={formInputs.pageName || ''} onChange={e => setInput('pageName', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Page Access Token</label>
                    <input className={inputCls} type="password" placeholder="EAAG..." value={formInputs.accessToken || ''} onChange={e => setInput('accessToken', e.target.value)} />
                  </div>
                </>
              )}
            </div>

            {formMsg && (
              <div className={`mt-4 px-3 py-2 text-xs font-sans border ${formMsg.error ? 'border-red-900/20 bg-red-50 text-red-900' : 'border-green-800/20 bg-green-50 text-green-900'}`}>
                {formMsg.text}
              </div>
            )}

            <button onClick={handleConnect} className="mt-4 w-full flex items-center justify-center gap-2 bg-[#1A1A1A] text-white hover:bg-black py-3 font-sans text-[11px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer">
              {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5 text-[#FF6321]" />}
              Save Connection
            </button>
          </section>
        </div>

        {/* RIGHT: Scheduler + caption + calendar */}
        <div className="lg:col-span-3 space-y-8">

          {/* Scheduler config */}
          <section className="bg-[#FBF9F6] border border-[#1A1A1A]/10 p-6">
            <p className={SECTION_LABEL}>Auto-Publisher</p>
            <h3 className="font-serif text-2xl font-normal mb-1 flex items-center gap-3">
              <Clock className="w-5 h-5 text-[#FF6321]" />
              Schedule & Timing
            </h3>
            <p className="text-xs text-[#1A1A1A]/60 mb-6 font-sans">
              Items are reposted in cycles with configurable gaps and random jitter to avoid pattern detection.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Gap Between Posts</label>
                <div className="flex items-center">
                  <input type="number" min={0} className={inputCls} value={gap} onChange={e => setGap(Number(e.target.value))} />
                </div>
                <small className="block text-[10px] text-[#1A1A1A]/40 mt-1 font-sans">seconds · current {fmtDuration(gap * 1000)}</small>
              </div>
              <div>
                <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Cycle Size</label>
                <select className={inputCls} value={cycle} onChange={e => setCycle(Number(e.target.value))}>
                  <option value={1}>1 — no repeat</option>
                  <option value={3}>3 posts then repeat</option>
                  <option value={5}>5 posts then repeat</option>
                  <option value={10}>10 posts then repeat</option>
                </select>
                <small className="block text-[10px] text-[#1A1A1A]/40 mt-1 font-sans">posts before content cycles back</small>
              </div>
              <div>
                <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Random Jitter</label>
                <input type="number" min={0} className={inputCls} value={jitter} onChange={e => setJitter(Number(e.target.value))} />
                <small className="block text-[10px] text-[#1A1A1A]/40 mt-1 font-sans">seconds · current {fmtDuration(jitter * 1000)}</small>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-6">
              <span className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40">Publish targets:</span>
              {(Object.keys(PLATFORM_META) as Platform[]).map(p => (
                <label key={p} className="flex items-center gap-2 cursor-pointer text-[11px] font-bold uppercase tracking-[0.1em] font-sans">
                  <input type="checkbox" className="accent-[#1A1A1A]" checked={platforms[p]} onChange={() => setPlatforms(prev => ({ ...prev, [p]: !prev[p] }))} />
                  <span style={{ color: platformAccent(p) }}>{PLATFORM_META[p].label}</span>
                </label>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={handleSaveConfig} className="flex items-center gap-2 bg-[#1A1A1A] text-white hover:bg-black px-5 py-2.5 font-sans text-[10px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#FF6321]" /> Save Config
              </button>
              <button onClick={handleTriggerNow} className="flex items-center gap-2 border border-[#1A1A1A]/20 hover:bg-[#1A1A1A]/5 text-[#1A1A1A] px-5 py-2.5 font-sans text-[10px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer">
                <Zap className="w-3.5 h-3.5 text-[#FF6321]" /> Trigger Next Post Now
              </button>
              <button onClick={handleClear} className="flex items-center gap-2 border border-red-900/20 text-red-900 hover:bg-red-50 px-5 py-2.5 font-sans text-[10px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer">
                <Trash2 className="w-3.5 h-3.5" /> Clear Queue
              </button>
            </div>
          </section>

          {/* AI Caption Generator */}
          <section className="bg-[#FBF9F6] border border-[#1A1A1A]/10 p-6">
            <p className={SECTION_LABEL}>AI Assist</p>
            <h3 className="font-serif text-2xl font-normal mb-1 flex items-center gap-3">
              <Wand2 className="w-5 h-5 text-[#FF6321]" />
              Caption Generator
            </h3>
            <p className="text-xs text-[#1A1A1A]/60 mb-6 font-sans">
              Generates captions + hashtags via configured AI (Gemini · Grok · Ollama) then queues the post.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Target Platform</label>
                <select className={inputCls} value={genPlatform} onChange={e => setGenPlatform(e.target.value as Platform)}>
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="facebook">Facebook</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Media Type</label>
                <select className={inputCls} value={genMediaType} onChange={e => setGenMediaType(e.target.value as 'video' | 'image' | 'carousel')}>
                  <option value="video">Video</option>
                  <option value="image">Image</option>
                  <option value="carousel">Carousel</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold font-sans uppercase tracking-[0.1em] mb-1">Shortcode / Post ID</label>
                <input className={inputCls} placeholder="e.g. AbC123" value={genShortcode} onChange={e => setGenShortcode(e.target.value)} />
              </div>
            </div>

            <button onClick={handleGenerateCaption} disabled={genBusy} className="mt-4 flex items-center gap-2 bg-[#1A1A1A] text-white hover:bg-black px-5 py-2.5 font-sans text-[10px] uppercase tracking-[0.15em] font-bold transition-all disabled:opacity-50 cursor-pointer">
              {genBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5 text-[#FF6321]" />}
              {genBusy ? 'Generating...' : 'Generate Caption & Hashtags'}
            </button>

            {genError && (
              <div className="mt-4 px-3 py-2 text-xs font-sans border border-red-900/20 bg-red-50 text-red-900">{genError}</div>
            )}

            {genCaption && (
              <div className="mt-4 border border-[#1A1A1A]/10 bg-white p-5">
                <p className={SECTION_LABEL}>Result</p>
                <p className="text-sm leading-relaxed font-sans text-[#1A1A1A] whitespace-pre-wrap">{genCaption}</p>
                {genHashtags && (
                  <p className="mt-3 text-sm font-sans text-[#FF6321] whitespace-pre-wrap">{genHashtags}</p>
                )}
                <button onClick={handleQueueCaption} className="mt-4 flex items-center gap-2 text-white px-5 py-2.5 font-sans text-[10px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer" style={{ background: platformAccent(genPlatform) }}>
                  <PlusCircle className="w-3.5 h-3.5" />
                  {queuedId ? 'Queued — click to requeue' : 'Queue This Post With Caption'}
                </button>
              </div>
            )}
          </section>

          {/* Calendar / queue timeline */}
          <section className="bg-[#FBF9F6] border border-[#1A1A1A]/10 p-6">
            <p className={SECTION_LABEL}>Upcoming Posts</p>
            <h3 className="font-serif text-2xl font-normal mb-1 flex items-center gap-3">
              <CalendarDays className="w-5 h-5 text-[#FF6321]" />
              Schedule Timeline
            </h3>
            <p className="text-xs text-[#1A1A1A]/60 mb-6 font-sans">
              {dashboard ? `Queue size: ${dashboard.queueSize} · ${Object.entries(dashboard.platformStats).map(([p, s]) => `${PLATFORM_META[p as Platform].label}: ${(s as { posted: number; failed: number }).posted} posted / ${(s as { posted: number; failed: number }).failed} failed`).join(' · ')}` : 'Loading queue...'}
            </p>

            {!dashboard || dashboard.activeItems.length === 0 ? (
              <div className="border border-dashed border-[#1A1A1A]/20 p-8 text-center">
                <p className="text-xs text-[#1A1A1A]/40 font-sans uppercase tracking-[0.15em] font-bold">
                  Queue is empty — generate a caption above and queue a post
                </p>
              </div>
            ) : (
              <div className="space-y-0">
                {[...dashboard.activeItems]
                  .sort((a, b) => a.scheduledAt - b.scheduledAt)
                  .map(item => {
                    const pct = item.progress?.percentage ?? 0;
                    const status = item.progress?.status ?? 'pending';
                    return (
                      <div key={item.id} className="flex items-center gap-4 py-3 border-b border-[#1A1A1A]/5 last:border-b-0">
                        <div className="w-9 h-9 border border-[#1A1A1A]/10 bg-white flex items-center justify-center flex-shrink-0" style={{ color: platformAccent(item.platform) }}>
                          {item.progress?.status === 'completed' ? <CheckCircle2 className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[12px] font-bold text-[#1A1A1A] truncate">{item.shortcode}</span>
                            <span className="text-[10px] uppercase tracking-[0.1em] font-bold font-sans px-1.5 py-0.5 border border-[#1A1A1A]/15 text-[#1A1A1A]/60">
                              {PLATFORM_META[item.platform].label}
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.1em] font-bold font-sans text-[#1A1A1A]/40">
                              cycle {item.cyclePosition + 1}/{dashboard?.config.maxCycleSize ?? 3} · posted {item.postedCount}x
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="h-1 flex-1 bg-[#1A1A1A]/10 max-w-[180px]">
                              <div className={`h-full ${status === 'failed' ? 'bg-red-600' : 'bg-[#1A1A1A]'}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[10px] font-sans text-[#1A1A1A]/50">
                              next {fmtTime(item.scheduledAt)}{item.progress?.error ? ` · ${item.progress.error}` : ''}
                            </span>
                          </div>
                        </div>
                        <button onClick={() => handleRemove(item.id)} title="Remove from queue" className="p-2 border border-[#1A1A1A]/10 hover:border-red-900/30 hover:text-red-900 text-[#1A1A1A]/40 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>

          <div className="border border-[#FF6321]/30 bg-[#FF6321]/5 p-5 text-xs text-[#1A1A1A] leading-relaxed flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-[#FF6321] flex-shrink-0 mt-0.5" />
            <div className="font-sans text-[#1A1A1A]/80">
              <strong className="font-bold text-[10px] uppercase tracking-[0.2em] text-[#FF6321] block mb-1">Server Memory Note</strong>
              Queue, credentials and stats live in server memory. Restarting the server clears the queue. Credentials are stored in <code className="bg-[#1A1A1A]/5 px-1 font-mono">.env</code> for persistence across restarts in production mode.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};