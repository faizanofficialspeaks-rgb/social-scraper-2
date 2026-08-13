import React from 'react';
import { Chrome, CheckCircle2, FolderOpen, Terminal } from 'lucide-react';

export const TestingGuide: React.FC = () => {
  return (
    <div className="space-y-8 font-sans">
      
      {/* Editorial Title Header */}
      <div className="bg-[#FBF9F6] border border-[#1A1A1A]/10 p-8 shadow-sm">
        <p className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40 mb-1">Developer Execution</p>
        <h3 className="text-3xl font-serif font-normal text-[#1A1A1A] mb-2 flex items-center gap-3">
          <Chrome className="w-6 h-6 text-[#1A1A1A]" />
          Chrome Extension Loading & Runtime Verification
        </h3>
        <p className="text-xs text-[#1A1A1A]/60 font-sans leading-relaxed max-w-2xl">
          Follow these exact steps to unpack the generated extension package into Google Chrome and verify live content scraping on Instagram.
        </p>
      </div>

      {/* Step by Step Loading Instructions */}
      <div className="bg-white border border-[#1A1A1A]/10 p-8 space-y-6">
        <p className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40">Deployment Protocol</p>
        <h4 className="font-serif text-2xl font-normal text-[#1A1A1A] flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-[#FF6321]" /> Step 1: Unpack and Load into Chrome
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
          <div className="bg-[#FBF9F6] p-6 border border-[#1A1A1A]/10 space-y-3">
            <div className="w-7 h-7 bg-[#1A1A1A] text-white font-bold flex items-center justify-center text-xs font-mono">1</div>
            <strong className="text-[#1A1A1A] font-bold block text-sm font-sans uppercase tracking-wider">Download & Extract</strong>
            <p className="text-[#1A1A1A]/60 leading-relaxed font-sans">Click "Download ZIP" in the navigation bar and extract the archive into a local directory on your machine.</p>
          </div>

          <div className="bg-[#FBF9F6] p-6 border border-[#1A1A1A]/10 space-y-3">
            <div className="w-7 h-7 bg-[#1A1A1A] text-white font-bold flex items-center justify-center text-xs font-mono">2</div>
            <strong className="text-[#1A1A1A] font-bold block text-sm font-sans uppercase tracking-wider">Open Extensions Page</strong>
            <p className="text-[#1A1A1A]/60 leading-relaxed font-sans">Open Google Chrome and navigate to <code className="bg-white px-2 py-0.5 border border-[#1A1A1A]/20 text-[#FF6321] font-mono text-[11px]">chrome://extensions</code> in your address bar.</p>
          </div>

          <div className="bg-[#FBF9F6] p-6 border border-[#1A1A1A]/10 space-y-3">
            <div className="w-7 h-7 bg-[#1A1A1A] text-white font-bold flex items-center justify-center text-xs font-mono">3</div>
            <strong className="text-[#1A1A1A] font-bold block text-sm font-sans uppercase tracking-wider">Load Unpacked</strong>
            <p className="text-[#1A1A1A]/60 leading-relaxed font-sans">Enable <strong>Developer mode</strong> toggle top-right, click <strong>Load unpacked</strong>, and select the extracted folder.</p>
          </div>
        </div>
      </div>

      {/* Manual Testing Checklist */}
      <div className="bg-white border border-[#1A1A1A]/10 p-8 space-y-6">
        <p className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40">Verification Protocol</p>
        <h4 className="font-serif text-2xl font-normal text-[#1A1A1A] flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-[#FF6321]" /> Step 2: Instagram Live Runtime Checklist
        </h4>

        <div className="space-y-4 text-xs text-[#1A1A1A]">
          <div className="flex items-start gap-4 bg-[#FBF9F6] p-5 border border-[#1A1A1A]/10">
            <input type="checkbox" className="mt-1 accent-[#1A1A1A] w-4 h-4 cursor-pointer" />
            <div>
              <strong className="text-[#1A1A1A] font-bold block text-sm font-sans uppercase tracking-wider mb-1">1. Open Instagram Profile Page</strong>
              <p className="text-[#1A1A1A]/60 font-sans leading-relaxed">
                Navigate to any public Instagram profile (e.g. <code className="text-[#FF6321] font-mono">https://www.instagram.com/instagram/</code>). Ensure our shadow-root isolated floating panel appears in bottom-right.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 bg-[#FBF9F6] p-5 border border-[#1A1A1A]/10">
            <input type="checkbox" className="mt-1 accent-[#1A1A1A] w-4 h-4 cursor-pointer" />
            <div>
              <strong className="text-[#1A1A1A] font-bold block text-sm font-sans uppercase tracking-wider mb-1">2. Verify Interceptor Logs</strong>
              <p className="text-[#1A1A1A]/60 font-sans leading-relaxed">
                Open Chrome DevTools (F12) Console tab. Verify namespace log messages starting with <code className="text-[#FF6321] font-mono">[IG-SCRAPER-MAIN]</code> and <code className="text-[#FF6321] font-mono">[IG-SCRAPER]</code>.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 bg-[#FBF9F6] p-5 border border-[#1A1A1A]/10">
            <input type="checkbox" className="mt-1 accent-[#1A1A1A] w-4 h-4 cursor-pointer" />
            <div>
              <strong className="text-[#1A1A1A] font-bold block text-sm font-sans uppercase tracking-wider mb-1">3. Test Controlled Auto-Scroll</strong>
              <p className="text-[#1A1A1A]/60 font-sans leading-relaxed">
                Click "Auto-Scroll" in the panel. Verify page scrolls smoothly and discovered media items populate the floating grid with deduplication active.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 bg-[#FBF9F6] p-5 border border-[#1A1A1A]/10">
            <input type="checkbox" className="mt-1 accent-[#1A1A1A] w-4 h-4 cursor-pointer" />
            <div>
              <strong className="text-[#1A1A1A] font-bold block text-sm font-sans uppercase tracking-wider mb-1">4. Test Local ZIP Download & Metadata Export</strong>
              <p className="text-[#1A1A1A]/60 font-sans leading-relaxed">
                Click "ZIP" or "Export" to verify client-side JSZip packaging of MP4/JPG files and complete metadata JSON export.
              </p>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

