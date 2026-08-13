import React from 'react';
import { Download, Sparkles, Terminal, Play, FileCode, Radio, Settings, CalendarClock } from 'lucide-react';

interface HeaderProps {
  activeTab: 'instagram' | 'tiktok' | 'facebook' | 'setup' | 'publisher';
  setActiveTab: (tab: 'instagram' | 'tiktok' | 'facebook' | 'setup' | 'publisher') => void;
  onDownloadZip: () => void;
  isZipping: boolean;
  onOpenConfig?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, onDownloadZip, isZipping, onOpenConfig }) => {
  return (
    <header className="bg-[#FBF9F6] border-b border-[#1A1A1A]/10 text-[#1A1A1A] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          
          {/* Logo & Brand */}
          <div className="flex items-center gap-4 cursor-pointer" onClick={() => setActiveTab('instagram')}>
            <div className="w-10 h-10 border border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F2ED] font-serif italic text-xl flex items-center justify-center font-bold">
              IG
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-serif text-2xl font-normal leading-none tracking-tight text-[#1A1A1A]">
                  SocialScraper
                </h1>
                <span className="px-2 py-0.5 text-[9px] font-sans font-bold tracking-[0.15em] uppercase border border-[#1A1A1A] text-[#1A1A1A] bg-white">
                  MV3 Live
                </span>
              </div>
              <p className="text-[10px] font-sans font-medium uppercase tracking-[0.15em] text-[#1A1A1A]/50 mt-1">
                Multi-Platform Real-Time Scraper
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="hidden md:flex items-center gap-2 border-b border-[#1A1A1A]/10 pb-1">
            {/* Instagram Tab */}
            <button
              onClick={() => setActiveTab('instagram')}
              className={`px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-sans font-bold transition-all flex items-center gap-1.5 border ${
                activeTab === 'instagram'
                  ? 'bg-[#FF6321] text-white border-[#FF6321] shadow-sm'
                  : 'bg-transparent text-[#1A1A1A]/60 border-transparent hover:text-[#1A1A1A]'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${activeTab === 'instagram' ? 'text-white animate-pulse' : 'text-[#FF6321]'}`} />
              Instagram 📸
            </button>

            {/* TikTok Tab */}
            <button
              onClick={() => setActiveTab('tiktok')}
              className={`px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-sans font-bold transition-all flex items-center gap-1.5 border ${
                activeTab === 'tiktok'
                  ? 'bg-[#FF0050] text-white border-[#FF0050] shadow-sm'
                  : 'bg-transparent text-[#1A1A1A]/60 border-transparent hover:text-[#1A1A1A]'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${activeTab === 'tiktok' ? 'text-white animate-pulse' : 'text-[#FF0050]'}`} />
              TikTok 🎵
            </button>

            {/* Facebook Tab */}
            <button
              onClick={() => setActiveTab('facebook')}
              className={`px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-sans font-bold transition-all flex items-center gap-1.5 border ${
                activeTab === 'facebook'
                  ? 'bg-[#1877F2] text-white border-[#1877F2] shadow-sm'
                  : 'bg-transparent text-[#1A1A1A]/60 border-transparent hover:text-[#1A1A1A]'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${activeTab === 'facebook' ? 'text-white animate-pulse' : 'text-[#1877F2]'}`} />
              Facebook 📘
            </button>

            {/* Publisher Tab */}
            <button
              onClick={() => setActiveTab('publisher')}
              className={`px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-sans font-bold transition-all flex items-center gap-1.5 border ${
                activeTab === 'publisher'
                  ? 'bg-[#1A1A1A] text-white border-[#1A1A1A] shadow-sm'
                  : 'bg-transparent text-[#1A1A1A]/60 border-transparent hover:text-[#1A1A1A]'
              }`}
            >
              <CalendarClock className={`w-3.5 h-3.5 ${activeTab === 'publisher' ? 'text-white' : 'text-[#FF6321]'}`} />
              Publisher
            </button>

            {/* Extension Setup Tab */}
            <button
              onClick={() => setActiveTab('setup')}
              className={`px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-sans font-bold transition-all flex items-center gap-1.5 border ${
                activeTab === 'setup'
                  ? 'bg-[#1A1A1A] text-white border-[#1A1A1A] shadow-sm'
                  : 'bg-transparent text-[#1A1A1A]/60 border-transparent hover:text-[#1A1A1A]'
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-amber-500" />
              Extension Setup
            </button>
          </nav>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            {onOpenConfig && (
              <button
                onClick={onOpenConfig}
                className="flex items-center gap-2 px-3.5 py-2.5 bg-[#1A1A1A]/5 hover:bg-[#1A1A1A]/10 text-[#1A1A1A] border border-[#1A1A1A]/20 font-sans text-[11px] uppercase tracking-[0.15em] font-bold transition-all cursor-pointer"
                title="Global Extension & Scraper Configuration"
              >
                <Settings className="w-4 h-4 text-[#FF6321]" />
                <span className="hidden sm:inline">Settings</span>
              </button>
            )}

            <button
              onClick={onDownloadZip}
              disabled={isZipping}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] text-white hover:bg-black font-sans text-[11px] uppercase tracking-[0.15em] font-bold transition-colors disabled:opacity-50 cursor-pointer active:scale-98"
            >
              <Download className="w-3.5 h-3.5 text-[#FF6321]" />
              <span>{isZipping ? 'Packaging...' : 'Download ZIP'}</span>
            </button>
          </div>

        </div>
      </div>
    </header>
  );
};

