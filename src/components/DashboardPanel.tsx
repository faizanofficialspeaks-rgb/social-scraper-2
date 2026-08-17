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
