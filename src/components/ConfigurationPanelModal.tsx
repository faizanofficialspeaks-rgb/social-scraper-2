import React from 'react';
import { Settings, X, ShieldCheck, Zap, Filter, Check, Sliders, RefreshCw, Clock, Gauge, ShieldAlert } from 'lucide-react';
import { useExtensionRealtime } from '../lib/useExtensionRealtime';

interface ConfigurationPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConfigurationPanelModal: React.FC<ConfigurationPanelModalProps> = ({ isOpen, onClose }) => {
  const realtime = useExtensionRealtime();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[#1A1A1A] text-white w-full max-w-2xl border border-white/20 shadow-2xl overflow-hidden font-sans">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 bg-black/40">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#FF6321] text-white">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-serif text-white font-normal">
                Global Scraper Configuration
              </h2>
              <p className="text-[11px] font-mono text-white/60 uppercase tracking-wider">
                Syncs directly with Chrome & Edge Extensions via BroadcastChannel
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          
          {/* Main Setting 1: Automatic Watermark Removal Toggle */}
          <div className={`p-5 border transition-all ${
            realtime.watermarkCleaningEnabled
              ? 'bg-emerald-950/40 border-emerald-500/50'
              : 'bg-white/5 border-white/10'
          }`}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className={`w-5 h-5 ${realtime.watermarkCleaningEnabled ? 'text-emerald-400' : 'text-white/40'}`} />
                  <h3 className="text-base font-serif text-white">
                    Automatic Watermark Removal
                  </h3>
                  <span className={`text-[9px] font-mono px-2 py-0.5 uppercase font-bold ${
                    realtime.watermarkCleaningEnabled ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/50'
                  }`}>
                    {realtime.watermarkCleaningEnabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>
                <p className="text-xs text-white/70 leading-relaxed">
                  When enabled, Instagram account handles, bottom overlay bars, and logo watermark stamps are automatically stripped from scraped image canvas downloads and `.mp4` video files prior to ZIP packaging.
                </p>
              </div>

              {/* Big Switch Toggle */}
              <button
                onClick={() => realtime.setWatermarkCleaningEnabled(!realtime.watermarkCleaningEnabled)}
                className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  realtime.watermarkCleaningEnabled ? 'bg-emerald-500' : 'bg-white/20'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    realtime.watermarkCleaningEnabled ? 'translate-x-7' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] font-mono text-white/50">
              <span>Applies to live stream, ZIP archives & extension processing</span>
              <span className="text-emerald-400 font-bold">Canvas Crop + Bottom Overlay Filter</span>
            </div>
          </div>

          {/* Setting 2: Global Extension Auto-Scroll & Scraping Throttling */}
          <div className="p-5 bg-white/5 border border-white/10 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#FF6321]" />
                <h3 className="text-sm font-serif text-white">
                  Global Auto-Scroll Delay & Throttling Speed
                </h3>
              </div>
              <span className="text-xs font-mono px-2.5 py-1 bg-[#FF6321]/20 text-[#FF6321] border border-[#FF6321]/40 font-bold">
                {realtime.throttlingDelay.toFixed(1)}s Delay / Step
              </span>
            </div>

            <p className="text-xs text-white/60 leading-relaxed">
              <strong>Global Extension Control:</strong> Adjusting this setting dynamically controls auto-scroll step speed and request throttling across <strong>Instagram, TikTok, and Facebook</strong> extensions centrally. Higher delays mimic human browsing and prevent rate limiting.
            </p>

            {/* Presets Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { delay: 1.0, label: '1.0s Aggressive', risk: 'High Rate' },
                { delay: 2.5, label: '2.5s Standard', risk: 'Balanced' },
                { delay: 5.0, label: '5.0s Stealth', risk: 'Safe' },
                { delay: 8.0, label: '8.0s Safe Guard', risk: 'Ultra Safe' }
              ].map((p) => {
                const isSelected = Math.abs(realtime.throttlingDelay - p.delay) < 0.1;
                return (
                  <button
                    key={p.delay}
                    type="button"
                    onClick={() => realtime.setThrottlingDelay(p.delay)}
                    className={`p-2.5 text-left border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#FF6321] border-[#FF6321] text-white shadow-sm'
                        : 'bg-black/30 border-white/10 text-white/70 hover:border-white/30'
                    }`}
                  >
                    <div className="text-xs font-bold font-mono flex items-center justify-between">
                      <span>{p.label}</span>
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </div>
                    <div className="text-[10px] text-white/60 mt-0.5">{p.risk}</div>
                  </button>
                );
              })}
            </div>

            {/* Interactive Range Slider */}
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-white/70">
                <span>Custom Throttling Delay:</span>
                <span className="text-[#FF6321] font-bold">{realtime.throttlingDelay.toFixed(1)} sec</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="15.0"
                step="0.5"
                value={realtime.throttlingDelay}
                onChange={(e) => realtime.setThrottlingDelay(parseFloat(e.target.value))}
                className="w-full accent-[#FF6321] bg-white/10 h-2 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono text-white/40">
                <span>0.5s (Fast / Unsafe)</span>
                <span>5.0s (Recommended)</span>
                <span>15.0s (Max Stealth)</span>
              </div>
            </div>

            {/* Live Throttling Insights Bar */}
            <div className="p-3 bg-black/40 border border-white/10 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono">
              <div className="flex items-center gap-2 text-white/70">
                <Gauge className="w-3.5 h-3.5 text-sky-400" />
                <span>Est. Throughput: <strong className="text-white">~{Math.round(60 / (realtime.throttlingDelay || 3))} actions/min</strong></span>
              </div>

              <div className="flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                <span>Detection Risk: </span>
                {realtime.throttlingDelay < 2.0 ? (
                  <span className="text-rose-400 font-bold bg-rose-950/60 px-1.5 py-0.5 border border-rose-500/40">HIGH (Fast Rate)</span>
                ) : realtime.throttlingDelay <= 4.5 ? (
                  <span className="text-amber-300 font-bold bg-amber-950/60 px-1.5 py-0.5 border border-amber-500/40">BALANCED</span>
                ) : (
                  <span className="text-emerald-400 font-bold bg-emerald-950/60 px-1.5 py-0.5 border border-emerald-500/40">ULTRA SAFE</span>
                )}
              </div>
            </div>
          </div>

          {/* Setting 3: Auto-Scroll Speed Control */}
          <div className="p-5 bg-white/5 border border-white/10 space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#FF6321]" />
              <h3 className="text-sm font-serif text-white">
                Auto-Scroll Step Speed
              </h3>
            </div>
            <p className="text-xs text-white/60">
              Controls the automated page scrolling speed inside Instagram active browser tabs.
            </p>
            <div className="grid grid-cols-3 gap-3 pt-1">
              {[
                { id: 'slow', label: '1x Slow (2.5s)', desc: 'Stealth & low CPU' },
                { id: 'normal', label: '2x Normal (1.5s)', desc: 'Recommended default' },
                { id: 'fast', label: '3x Turbo (0.8s)', desc: 'Fast bulk extraction' }
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => realtime.setScrollSpeed(s.id as any)}
                  className={`p-3 text-left border transition-all cursor-pointer ${
                    realtime.scrollSpeed === s.id
                      ? 'bg-[#FF6321] border-[#FF6321] text-white'
                      : 'bg-black/30 border-white/10 text-white/70 hover:border-white/30'
                  }`}
                >
                  <div className="text-xs font-bold uppercase font-mono flex items-center justify-between">
                    <span>{s.label}</span>
                    {realtime.scrollSpeed === s.id && <Check className="w-3.5 h-3.5" />}
                  </div>
                  <div className="text-[10px] text-white/60 mt-1">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Setting 3: Target Media Filter */}
          <div className="p-5 bg-white/5 border border-white/10 space-y-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-[#FF6321]" />
              <h3 className="text-sm font-serif text-white">
                Media Stream Type Filter
              </h3>
            </div>
            <p className="text-xs text-white/60">
              Filters incoming Instagram GraphQL and REST feeds to scrape specific media types only.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'all', label: 'All Content' },
                { id: 'video', label: 'Reels & MP4' },
                { id: 'image', label: 'Single JPG' },
                { id: 'carousel', label: 'Carousels' }
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => realtime.setTargetMediaType(m.id as any)}
                  className={`py-2 px-3 text-xs font-mono uppercase font-bold border text-center transition-all cursor-pointer ${
                    realtime.targetMediaType === m.id
                      ? 'bg-white text-black border-white'
                      : 'bg-black/20 text-white/70 border-white/10 hover:border-white/30'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Setting 4: Profile Target Handle */}
          <div className="p-5 bg-white/5 border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#FF6321]" />
                <h3 className="text-sm font-serif text-white">
                  Target Instagram Account
                </h3>
              </div>
              <span className="text-xs font-mono text-[#FF6321]">
                @{realtime.targetUsername}
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={realtime.targetUsername}
                onChange={(e) => realtime.setTargetUsername(e.target.value)}
                placeholder="Enter Instagram handle e.g. cats_of_instagram"
                className="flex-1 px-3 py-2 bg-black/50 border border-white/20 text-white text-xs font-mono focus:outline-none focus:border-[#FF6321]"
              />
              <button
                onClick={() => realtime.navigateExtensionToProfile(realtime.targetUsername)}
                className="px-4 py-2 bg-[#FF6321] hover:bg-[#e05316] text-white text-xs font-bold font-sans uppercase tracking-wider cursor-pointer"
              >
                Set & Navigate
              </button>
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-black/40 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Settings Broadcasted live to browser extension</span>
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-white text-black hover:bg-gray-200 font-sans text-xs font-bold uppercase tracking-wider cursor-pointer"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
};
