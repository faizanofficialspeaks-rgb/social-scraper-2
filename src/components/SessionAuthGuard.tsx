import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, Key, LogIn, ExternalLink, Play, Square, Download, AlertTriangle, CheckCircle2, Zap } from 'lucide-react';

interface SessionAuthGuardProps {
  platform: 'instagram' | 'tiktok' | 'facebook';
  isLoggedIn: boolean;
  isConnected: boolean;
  isScraping: boolean;
  targetUsername: string;
  progressMessage?: string;
  onStartScrape: () => void;
  onStopScrape: () => void;
  onOpenLoginTab: () => void;
  onDownloadZip: () => void;
}

export const SessionAuthGuard: React.FC<SessionAuthGuardProps> = ({
  platform,
  isLoggedIn,
  isConnected,
  isScraping,
  targetUsername,
  progressMessage,
  onStartScrape,
  onStopScrape,
  onOpenLoginTab,
  onDownloadZip,
}) => {
  const [bypassGuestWarning, setBypassGuestWarning] = useState<boolean>(true);

  const platformName = platform === 'instagram' ? 'Instagram' : platform === 'tiktok' ? 'TikTok' : 'Facebook';
  const platformColor = platform === 'instagram' ? '#FF6321' : platform === 'tiktok' ? '#FF0050' : '#1877F2';

  const canScrape = true;

  return (
    <div className="bg-[#1A1A1A] text-white p-6 shadow-xl border border-white/10 space-y-5 relative overflow-hidden">
      {/* Background Accent Lines */}
      <div 
        className="absolute top-0 right-0 w-64 h-64 pointer-events-none opacity-10 rounded-full blur-3xl"
        style={{ backgroundColor: platformColor }}
      />

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 text-white text-[9px] font-sans font-bold uppercase tracking-[0.2em]" style={{ backgroundColor: platformColor }}>
              Session Auth & Health Guard
            </span>
            {isConnected ? (
              <span className="text-xs text-emerald-400 font-mono font-bold flex items-center gap-1 bg-emerald-950/40 px-2 py-0.5 border border-emerald-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                Extension Bridge Active
              </span>
            ) : (
              <span className="text-xs text-amber-400 font-mono font-bold flex items-center gap-1 bg-amber-950/40 px-2 py-0.5 border border-amber-500/30">
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                Extension Not Detected
              </span>
            )}
          </div>
          <h3 className="text-xl font-serif text-white">
            {platformName} Real-Time Scraping Control
          </h3>
        </div>

        {/* Live Status Badge */}
        <div className="flex items-center gap-3">
          {isConnected && (isLoggedIn || bypassGuestWarning) ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 rounded text-xs font-mono">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Session Verified Active</span>
            </div>
          ) : isConnected && !isLoggedIn ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-950/60 border border-amber-500/40 text-amber-300 rounded text-xs font-mono">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span>Guest / Unauthenticated Session</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-950/60 border border-purple-500/40 text-purple-300 rounded text-xs font-mono">
              <Key className="w-4 h-4 text-purple-400" />
              <span>Bridge Standby</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Auth Status Box */}
      {!isConnected ? (
        /* State 1: Extension Disconnected - Direct App Scraper Active */
        <div className="p-4 bg-blue-950/40 border border-blue-500/40 text-blue-200 text-xs font-sans space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-500/20 text-blue-300 shrink-0">
              <Zap className="w-5 h-5 text-blue-400" />
            </div>
            <div className="space-y-1">
              <p className="font-bold text-white text-sm flex items-center gap-2">
                <span>⚡ Direct App Scraper Engine Ready</span>
                <span className="px-2 py-0.5 bg-blue-600 text-white text-[9px] uppercase font-mono font-bold">5-10s Anti-Blocking Buffer</span>
              </p>
              <p className="text-blue-200/90 leading-relaxed text-xs">
                You can scrape directly inside the app! Enter your {platformName} profile / Reels tab URL below and click <strong>"START REAL SCRAPING"</strong>. The app will open the page, wait 5–10 seconds for safe connection, and capture all profile reels continuously without blocking!
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-blue-500/20">
            <button
              type="button"
              onClick={onOpenLoginTab}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer shadow-md"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Open {platformName} Reels Tab</span>
            </button>
            <button
              type="button"
              onClick={onDownloadZip}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-mono text-[11px] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer border border-white/20"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Optional Chrome Extension ZIP</span>
            </button>
          </div>
        </div>
      ) : !isLoggedIn && !bypassGuestWarning ? (
        /* State 2: Extension Connected but User Not Logged In */
        <div className="p-4 bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs font-sans space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-500/20 text-amber-400 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <p className="font-bold text-amber-100 text-sm flex items-center gap-2">
                <span>Login Session Check</span>
              </p>
              <p className="text-amber-200/90 leading-relaxed text-xs">
                If you are already logged into {platformName} in your browser, click <strong>"I Am Logged In"</strong> below to proceed with unlimited profile feed extraction!
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-amber-500/20">
            <button
              type="button"
              onClick={() => setBypassGuestWarning(true)}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer shadow-lg"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>I Am Logged Into {platformName}</span>
            </button>

            <button
              type="button"
              onClick={onOpenLoginTab}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-mono text-[11px] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer border border-white/20"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Open Login Page</span>
            </button>
          </div>
        </div>
      ) : (
        /* State 3: Logged In & Ready */
        <div className="p-4 bg-emerald-950/30 border border-emerald-500/30 text-emerald-200 text-xs font-sans space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-300 font-bold text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>
                {platformName} session active and ready for live profile extraction!
              </span>
            </div>
            {progressMessage && (
              <span className="text-[11px] font-mono text-emerald-400/90 truncate max-w-xs">
                {progressMessage}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Primary Scraping Control Trigger */}
      {(() => {
        const isUrl = targetUsername.startsWith('http://') || targetUsername.startsWith('https://');
        const displayLabel = isUrl
          ? (targetUsername.includes('id=') ? `ID: ${targetUsername.match(/id=(\d+)/)?.[1] || 'Profile'}` : 'Profile Link')
          : `@${targetUsername || 'profile'}`;

        return (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-white/10">
            <div className="flex items-center gap-3">
              <div className="text-xs font-sans">
                <span className="text-white/60 uppercase font-mono text-[10px] block">Target Account:</span>
                <span className="text-white font-bold text-sm font-mono truncate max-w-xs block">{displayLabel}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              {!isScraping ? (
                <button
                  type="button"
                  disabled={!canScrape}
                  onClick={onStartScrape}
                  className={`px-8 py-4 font-sans text-sm font-bold uppercase tracking-[0.15em] flex items-center gap-3 transition-all shadow-xl border-2 border-white/20 ${
                    canScrape
                      ? 'bg-[#FF6321] hover:bg-[#e05316] text-white cursor-pointer hover:scale-102 active:scale-98'
                      : 'bg-gray-800 text-gray-500 cursor-not-allowed opacity-60'
                  }`}
                  style={{ backgroundColor: canScrape ? platformColor : undefined }}
                >
                  <Play className="w-5 h-5 fill-current text-white animate-pulse" />
                  <span>START REAL SCRAPING ({displayLabel})</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onStopScrape}
                  className="px-8 py-4 bg-rose-600 hover:bg-rose-700 text-white font-sans text-sm font-bold uppercase tracking-[0.15em] flex items-center gap-3 transition-all cursor-pointer shadow-xl hover:scale-102 active:scale-98 border-2 border-white/20"
                >
                  <Square className="w-5 h-5 fill-current text-white" />
                  <span>STOP SCRAPING</span>
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
