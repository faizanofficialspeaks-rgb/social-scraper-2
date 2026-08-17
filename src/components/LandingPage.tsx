import React from 'react';
import {
  Radio, Send, Zap, Layers, Facebook, Instagram, TrendingUp, Sparkles, Archive,
  ArrowRight, Check, Clock, ChevronRight,
} from 'lucide-react';

interface LandingPageProps {
  onOpenDashboard: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onOpenDashboard }) => {
  const bars = [32, 55, 42, 70, 58, 82, 64, 92, 74, 60, 88, 96];
  const swatches = ['#ccff00', '#10b981', '#FF6321', '#1877F2', '#ebebeb', '#0a0a0a'];

  return (
    <div className="min-h-screen bg-[#000000] text-[#ebebeb] landing-font antialiased selection:bg-[#ccff00] selection:text-black">
      {/* Floating Shell */}
      <div className="max-w-[1600px] mx-auto bg-[#0c0c0c] rounded-[2.5rem] ring-1 ring-white/10 shadow-2xl landing-noise overflow-hidden">
        <div className="relative">
          {/* Decorative glow spheres */}
          <div className="pointer-events-none absolute -top-40 -left-40 w-[480px] h-[480px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(204,255,0,0.14) 0%, transparent 70%)', filter: 'blur(120px)' }} />
          <div className="pointer-events-none absolute top-1/3 -right-40 w-[420px] h-[420px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%)', filter: 'blur(120px)' }} />

          {/* ===== Navigation ===== */}
          <header className="relative z-20 flex items-center justify-between px-6 md:px-10 py-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#ccff00] text-black flex items-center justify-center font-bold text-lg">
                S
              </div>
              <span className="font-semibold tracking-tight text-lg">SocialScraper</span>
            </div>

            <nav className="hidden lg:flex items-center gap-1 px-2 py-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(12px)' }}>
              {['Home', 'Features', 'Workflow', 'Pricing'].map((l) => (
                <a key={l} href={`#${l.toLowerCase()}`} className="px-4 py-1.5 text-sm text-white/70 hover:text-white transition-colors rounded-full">
                  {l}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-2 landing-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ccff00] landing-pulse" />
                API ONLINE
              </div>
              <button
                onClick={onOpenDashboard}
                className="flex items-center gap-2 bg-white text-black rounded-full px-5 py-2 text-sm font-bold hover:scale-105 transition-transform cursor-pointer"
              >
                Open Dashboard <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* ===== Hero ===== */}
          <section className="relative z-10 grid grid-cols-12 gap-8 px-6 md:px-10 pt-10 md:pt-16 pb-16 landing-grid-bg">
            <div className="col-span-12 lg:col-span-7">
              <div className="inline-flex items-center gap-2 landing-mono text-[11px] uppercase tracking-[0.25em] bg-[#ccff00]/10 text-[#ccff00] border border-[#ccff00]/30 rounded-full px-3 py-1.5">
                <Sparkles className="w-3 h-3" /> AI-Powered Content Engine
              </div>
              <h1 className="mt-6 text-[3.2rem] leading-[0.9] md:text-[5.5rem] lg:text-[7.5rem] font-bold tracking-[-0.06em]">
                Scrape the feed.
                <br />
                <span className="italic bg-gradient-to-r from-[#ccff00] to-white bg-clip-text text-transparent">
                  Download
                </span>{' '}
                the best.
                <br />
                Auto-post
                <span className="italic text-[#ccff00]"> on Facebook.</span>
              </h1>
              <p className="mt-8 max-w-xl text-lg text-white/60 leading-relaxed">
                Real-time multi-platform scraping + one-click downloads, and a separate
                cloud-hosted poster app that auto-posts to Facebook 24/7 — even when your PC is off.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <button
                  onClick={onOpenDashboard}
                  className="flex items-center gap-2 bg-[#ccff00] text-black font-bold rounded-full px-8 py-4 text-base hover:scale-105 transition-transform cursor-pointer"
                  style={{ boxShadow: '0 0 30px rgba(204,255,0,0.3)' }}
                >
                  Launch Dashboard <ChevronRight className="w-5 h-5" />
                </button>
                <span className="landing-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
                  No signup · Runs on your VPS
                </span>
              </div>
            </div>

            {/* Hero mockup — floating glass cards */}
            <div className="col-span-12 lg:col-span-5 relative min-h-[420px]">
              <div className="absolute top-6 left-2 landing-glass rounded-[1.5rem] p-5 w-64 landing-float" style={{ animationDelay: '0s' }}>
                <div className="flex items-center justify-between mb-4">
                  <span className="landing-mono text-[10px] uppercase tracking-[0.2em] text-white/50">Live Stream</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#ccff00] landing-pulse" />
                </div>
                <div className="flex items-end gap-1.5 h-24">
                  {bars.map((h, i) => (
                    <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: i % 3 === 0 ? '#ccff00' : 'rgba(255,255,255,0.15)' }} />
                  ))}
                </div>
                <div className="mt-4 landing-mono text-[10px] uppercase tracking-[0.15em] text-white/40">1,284 posts / hr</div>
              </div>

              <div className="absolute bottom-4 right-2 landing-glass rounded-[1.5rem] p-5 w-72 landing-float" style={{ animationDelay: '1.5s' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Instagram className="w-4 h-4 text-[#ccff00]" />
                  <span className="landing-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Auto-Post</span>
                </div>
                <div className="flex items-center justify-between bg-black/40 rounded-xl px-3 py-2.5 border border-white/10">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded bg-gradient-to-br from-[#FF6321] to-[#1877F2]" />
                    <div>
                      <div className="text-xs font-semibold">@mikaasa.hania</div>
                      <div className="text-[10px] text-white/40">via Graph API</div>
                    </div>
                  </div>
                  <Check className="w-4 h-4 text-[#ccff00]" />
                </div>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-white/50">
                  <Clock className="w-3 h-3" /> Posted 2m ago · Reel 4.2k views
                </div>
              </div>

              <div className="absolute top-1/2 right-8 flex items-center gap-2 bg-[#ccff00] text-black text-[10px] font-bold uppercase tracking-[0.15em] rounded-full px-3 py-1.5 landing-float" style={{ animationDelay: '3s' }}>
                <Radio className="w-3 h-3" /> AI Cursor
              </div>
            </div>
          </section>

          {/* ===== Bento Grid Features ===== */}
          <section id="features" className="relative z-10 px-6 md:px-10 py-14">
            <div className="flex items-end justify-between mb-8">
              <div>
                <div className="landing-mono text-[11px] uppercase tracking-[0.25em] text-[#ccff00]">Capabilities</div>
                <h2 className="text-4xl md:text-5xl font-bold tracking-[-0.05em] mt-2">One pipeline, <span className="italic text-[#ccff00]">every platform.</span></h2>
              </div>
              <span className="hidden md:block landing-mono text-[10px] uppercase tracking-[0.2em] text-white/30">v2.0 · 2026</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {/* Large 2x2 — live data viz */}
              <div className="col-span-1 sm:col-span-2 lg:row-span-2 rounded-[2.5rem] border border-white/10 p-7 hover:border-[#ccff00]/40 transition-colors bg-[#0a0a0a]">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <div className="text-2xl font-bold tracking-tight">Real-Time Stream</div>
                    <div className="text-white/50 text-sm mt-1">Scrape Instagram, TikTok &amp; Facebook live</div>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-[#ccff00] landing-pulse" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="landing-glass rounded-2xl p-4">
                    <div className="text-3xl font-bold">12.4k</div>
                    <div className="text-[10px] landing-mono uppercase tracking-[0.15em] text-white/40 mt-1">reels extracted</div>
                    <div className="mt-3 flex items-end gap-1 h-12">
                      {bars.slice(0, 8).map((h, i) => (
                        <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: 'rgba(204,255,0,0.6)' }} />
                      ))}
                    </div>
                  </div>
                  <div className="landing-glass rounded-2xl p-4">
                    <div className="text-3xl font-bold">3</div>
                    <div className="text-[10px] landing-mono uppercase tracking-[0.15em] text-white/40 mt-1">platforms</div>
                    <div className="mt-3 space-y-2">
                      {[['Instagram', '#FF6321'], ['TikTok', '#FF0050'], ['Facebook', '#1877F2']].map(([n, c]) => (
                        <div key={n as string} className="flex items-center gap-2 text-xs text-white/70">
                          <span className="w-2 h-2 rounded-full" style={{ background: c as string }} /> {n}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-5 landing-mono text-[10px] uppercase tracking-[0.2em] text-white/30">
                  chrome mv3 extension · real-time parsing · bulk export zip
                </div>
              </div>

              {/* Tall 1x2 — token swatches */}
              <div className="rounded-[2.5rem] border border-white/10 p-7 hover:border-[#ccff00]/40 transition-colors bg-[#0a0a0a]">
                <div className="text-2xl font-bold tracking-tight mb-5">Design Tokens</div>
                <div className="grid grid-cols-2 gap-3">
                  {swatches.map((c) => (
                    <div key={c} className="landing-glass rounded-2xl p-3 flex flex-col items-start gap-2">
                      <div className="w-9 h-9 rounded-xl" style={{ background: c }} />
                      <span className="landing-mono text-[9px] uppercase text-white/40 tracking-wider">{c}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Accent solid lime */}
              <div className="rounded-[2.5rem] bg-[#ccff00] text-black p-7 landing-noise">
                <Zap className="w-7 h-7" />
                <div className="text-2xl font-bold tracking-tight mt-4">Auto-Poster</div>
                <p className="text-sm mt-2 leading-relaxed">
                  Facebook via Graph API — separate cloud app, scheduler runs 24/7 in the cloud. Even when your PC is off.
                </p>
                <div className="mt-6 landing-mono text-[10px] uppercase tracking-[0.15em] font-bold">FB ✓ Cloud ✓</div>
              </div>

              {/* Standard cards */}
              <div className="rounded-[2.5rem] border border-white/10 p-7 hover:border-[#ccff00]/40 transition-colors bg-[#0a0a0a]">
                <Layers className="w-6 h-6 text-[#ccff00]" />
                <div className="text-xl font-bold tracking-tight mt-4">One-Click Downloads</div>
                <p className="text-sm text-white/50 mt-2 leading-relaxed">Direct MP4 saves, ZIP packages, JSON/CSV export — zero duplicates.</p>
              </div>
              <div className="rounded-[2.5rem] border border-white/10 p-7 hover:border-[#ccff00]/40 transition-colors bg-[#0a0a0a]">
                <Send className="w-6 h-6 text-[#ccff00]" />
                <div className="text-xl font-bold tracking-tight mt-4">Folder Queue</div>
                <p className="text-sm text-white/50 mt-2 leading-relaxed">Drop your extracted ZIP folder — captions auto-import, schedule or post now.</p>
              </div>
              <div className="rounded-[2.5rem] border border-white/10 p-7 hover:border-[#ccff00]/40 transition-colors bg-[#0a0a0a]">
                <Archive className="w-6 h-6 text-[#ccff00]" />
                <div className="text-xl font-bold tracking-tight mt-4">Bulk Download</div>
                <p className="text-sm text-white/50 mt-2 leading-relaxed">ZIP packages, JSON/CSV export, duplicates finder.</p>
              </div>
              <div className="rounded-[2.5rem] border border-white/10 p-7 hover:border-[#ccff00]/40 transition-colors bg-[#0a0a0a]">
                <Facebook className="w-6 h-6 text-[#ccff00]" />
                <div className="text-xl font-bold tracking-tight mt-4">Page Connect</div>
                <p className="text-sm text-white/50 mt-2 leading-relaxed">Paste one token in the poster app — it converts to a long-lived page token automatically.</p>
              </div>
            </div>
          </section>

          {/* ===== Methodology (contrast section) ===== */}
          <section id="workflow" className="relative z-10 mt-10 rounded-t-[4rem] bg-[#e5e5e5] text-black px-6 md:px-14 py-16 landing-noise">
            <div className="flex items-end justify-between mb-12">
              <div>
                <div className="landing-mono text-[11px] uppercase tracking-[0.25em] text-black/50">Methodology</div>
                <h2 className="text-4xl md:text-5xl font-bold tracking-[-0.05em] mt-2">Three steps. <span className="italic">Zero busywork.</span></h2>
              </div>
              <span className="hidden md:block landing-mono text-[10px] uppercase tracking-[0.2em] text-black/30">01 → 03</span>
            </div>

            <div className="grid md:grid-cols-3 gap-10">
              {[
                { n: '01', t: 'Scrape', d: 'Live stream real posts, reels & carousels from any public account — Instagram, TikTok or Facebook.' },
                { n: '02', t: 'Download', d: 'One-click media saves with dedup — videos, images, ZIPs, JSON/CSV export.' },
                { n: '03', t: 'Auto-Post', d: 'Drop the folder in the cloud poster app — captions auto-import, schedule or post now, 24/7.' },
              ].map((s) => (
                <div key={s.n} className="border-t border-black/15 pt-6">
                  <div className="w-12 h-12 rounded-full bg-black text-white flex items-center justify-center landing-mono text-sm font-bold mb-5">
                    {s.n}
                  </div>
                  <h3 className="text-2xl font-bold tracking-tight">{s.t}</h3>
                  <p className="mt-3 text-black/60 leading-relaxed text-sm">{s.d}</p>
                </div>
              ))}
            </div>

            <div className="mt-16 flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="text-center md:text-left">
                <div className="text-sm font-semibold tracking-tight">"I stop copy-pasting. Stage it, schedule it, done."</div>
                <div className="landing-mono text-[10px] uppercase tracking-[0.2em] text-black/40 mt-2">Content operator · SocialScraper</div>
              </div>
              <button
                onClick={onOpenDashboard}
                className="flex items-center gap-2 bg-black text-white font-bold rounded-full px-8 py-4 hover:scale-105 transition-transform cursor-pointer"
              >
                Open Dashboard <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </section>

          {/* ===== Footer ===== */}
          <footer className="relative z-10 bg-[#000000] px-6 md:px-10 pt-16 overflow-hidden">
            <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 text-[10rem] font-bold tracking-tighter text-white/[0.05] select-none landing-font">
              SOCIAL
            </div>
            <div className="relative z-10 text-center">
              <button
                onClick={onOpenDashboard}
                className="inline-flex items-center gap-2 bg-[#ccff00] text-black font-bold rounded-full px-10 py-5 text-lg hover:scale-105 transition-transform cursor-pointer"
                style={{ boxShadow: '0 0 30px rgba(204,255,0,0.3)' }}
              >
                Start Scraping <TrendingUp className="w-5 h-5" />
              </button>
              <p className="landing-mono text-[10px] uppercase tracking-[0.25em] text-white/30 mt-4">
                Multi-platform scraper · curator · auto-poster
              </p>
            </div>

            <div className="relative z-10 mt-14 grid md:grid-cols-3 gap-8 border-t border-white/10 pt-8 pb-10">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#ccff00] text-black flex items-center justify-center font-bold text-sm">S</div>
                  <span className="font-semibold">SocialScraper</span>
                </div>
                <p className="text-white/40 text-sm mt-3 max-w-xs">Scrape · Curate · Auto-post — Instagram, TikTok &amp; Facebook in one pipeline.</p>
              </div>
              <div className="flex flex-col gap-2 text-sm text-white/50">
                <span className="landing-mono text-[10px] uppercase tracking-[0.2em] text-white/30 mb-1">Platform</span>
                {['Privacy', 'Terms of Service', 'Docs', 'Changelog'].map((l) => (
                  <a key={l} href="#" className="hover:text-white transition-colors">{l}</a>
                ))}
              </div>
              <div className="flex flex-col gap-4">
                <span className="landing-mono text-[10px] uppercase tracking-[0.2em] text-white/30">Status</span>
                <div className="flex items-center gap-2 text-sm text-white/60">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#ccff00] landing-pulse" />
                  Graph API connected · scheduler 24/7
                </div>
                <div className="flex gap-3">
                  {['IG', 'FB', 'TT'].map((p) => (
                    <div key={p} className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center text-[10px] font-bold hover:border-[#ccff00] hover:text-[#ccff00] transition-colors">
                      {p}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="border-t border-white/5 py-5 text-center landing-mono text-[10px] uppercase tracking-[0.2em] text-white/20">
              © 2026 SocialScraper · Built for content operators
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};