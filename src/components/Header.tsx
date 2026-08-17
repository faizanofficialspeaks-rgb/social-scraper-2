import React from 'react';
import { Download, Settings, Zap, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface HeaderProps {
  onDownloadZip: () => void;
  isZipping: boolean;
  onOpenConfig?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onDownloadZip, isZipping, onOpenConfig }) => {
  const { user, credits, signOut } = useAuth();

  return (
    <header className="bg-[#FBF9F6] border-b border-[#1A1A1A]/10 text-[#1A1A1A] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          
          {/* Logo & Brand */}
          <div className="flex items-center gap-4">
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
                Multi-Platform Real-Time Scraper & Auto-Poster
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            {user && credits !== null && (
              <div
                className="flex items-center gap-2 px-3.5 py-2 bg-[#1A1A1A] text-[#ccff00] border border-[#1A1A1A]"
                title="1 video = 1 credit"
              >
                <Zap className="w-4 h-4" />
                <span className="font-bold text-sm">{credits}</span>
                <span className="hidden sm:inline text-[9px] uppercase tracking-[0.15em] text-white/60">credits</span>
              </div>
            )}

            {user && (
              <button
                onClick={() => signOut()}
                className="hidden md:flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.15em] font-bold text-[#1A1A1A]/60 hover:text-[#1A1A1A] border border-[#1A1A1A]/20 hover:border-[#1A1A1A]/50 transition-colors cursor-pointer"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="max-w-28 truncate">{user.email?.split('@')[0]}</span>
              </button>
            )}

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
