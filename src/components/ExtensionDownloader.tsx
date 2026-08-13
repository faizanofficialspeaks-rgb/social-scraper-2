import React from 'react';
import { Download, CheckCircle, ShieldCheck, Zap, Layers, Archive, Sparkles, AlertTriangle } from 'lucide-react';

interface DownloaderProps {
  onDownloadZip: () => void;
  isZipping: boolean;
}

export const ExtensionDownloader: React.FC<DownloaderProps> = ({ onDownloadZip, isZipping }) => {
  return (
    <div className="space-y-10">
      
      {/* Editorial Hero Banner */}
      <div className="bg-[#FBF9F6] border border-[#1A1A1A]/10 p-8 md:p-12 text-[#1A1A1A] relative">
        <div className="max-w-4xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white border border-[#1A1A1A]/20 text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A] mb-6">
            <Sparkles className="w-3.5 h-3.5 text-[#FF6321]" /> Manifest V3 Extension Engine
          </div>
          
          <h2 className="text-4xl md:text-5xl font-serif font-normal leading-tight tracking-tight mb-4 text-[#1A1A1A]">
            Instagram Content Scraper & Media Downloader
          </h2>
          
          <p className="text-[#1A1A1A]/70 text-sm md:text-base leading-relaxed mb-8 max-w-2xl font-sans font-normal">
            Zero-backend Chrome Manifest V3 Extension engineered to inspect network payloads, normalize dynamic GraphQL structures, auto-scroll profile feeds, and package posts, reels, metadata, and ZIP archives locally.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={onDownloadZip}
              disabled={isZipping}
              className="flex items-center gap-2 px-8 py-4 bg-[#1A1A1A] text-white hover:bg-black font-sans text-[12px] uppercase tracking-[0.15em] font-bold transition-all disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-4 h-4 text-[#FF6321]" />
              <span>{isZipping ? 'Generating Package...' : 'Download Extension ZIP'}</span>
            </button>

            <div className="text-[11px] font-sans text-[#1A1A1A]/50 uppercase tracking-[0.15em] italic">
              Ready for Chrome Load Unpacked • v3.0
            </div>
          </div>
        </div>
      </div>

      {/* Editorial Highlights Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white border border-[#1A1A1A]/10 p-8 flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 border border-[#1A1A1A]/10 bg-[#FBF9F6] flex items-center justify-center text-[#1A1A1A] mb-6">
              <Zap className="w-5 h-5 text-[#FF6321]" />
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40 mb-2">Network Layer</p>
            <h3 className="font-serif text-2xl font-normal text-[#1A1A1A] mb-3">MAIN-World Interceptor</h3>
            <p className="text-xs text-[#1A1A1A]/60 leading-relaxed font-sans">
              Intercepts fetch and XHR responses directly in Instagram context without breaking original requests or triggering bot detection.
            </p>
          </div>
        </div>

        <div className="bg-white border border-[#1A1A1A]/10 p-8 flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 border border-[#1A1A1A]/10 bg-[#FBF9F6] flex items-center justify-center text-[#1A1A1A] mb-6">
              <Layers className="w-5 h-5 text-[#1A1A1A]" />
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40 mb-2">Adapter Logic</p>
            <h3 className="font-serif text-2xl font-normal text-[#1A1A1A] mb-3">Resilient Normalizer</h3>
            <p className="text-xs text-[#1A1A1A]/60 leading-relaxed font-sans">
              Adapts dynamically to GraphQL queries, REST API candidates, Reel clips, sidecar carousels, and inline window variables.
            </p>
          </div>
        </div>

        <div className="bg-white border border-[#1A1A1A]/10 p-8 flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 border border-[#1A1A1A]/10 bg-[#FBF9F6] flex items-center justify-center text-[#1A1A1A] mb-6">
              <Archive className="w-5 h-5 text-[#1A1A1A]" />
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40 mb-2">Local Bundler</p>
            <h3 className="font-serif text-2xl font-normal text-[#1A1A1A] mb-3">JSZip Export Engine</h3>
            <p className="text-xs text-[#1A1A1A]/60 leading-relaxed font-sans">
              Bundling embedded JSZip engine for offline ZIP generation with media files, captions, and structured metadata.json export.
            </p>
          </div>
        </div>
      </div>

      {/* Feature Checklist */}
      <div className="bg-white border border-[#1A1A1A]/10 p-8">
        <p className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40 mb-2">Architectural Standards</p>
        <h3 className="font-serif text-2xl font-normal text-[#1A1A1A] mb-6 flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-[#FF6321]" />
          Full Specification Compliance
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-[#1A1A1A]/80 font-sans">
          <div className="flex items-start gap-3 p-4 bg-[#FBF9F6] border border-[#1A1A1A]/5">
            <CheckCircle className="w-4 h-4 text-[#1A1A1A] flex-shrink-0 mt-0.5" />
            <span><strong className="font-bold text-[#1A1A1A]">Manifest V3 Architecture:</strong> Native background worker, isolated content script, and MAIN world interceptor.</span>
          </div>
          <div className="flex items-start gap-3 p-4 bg-[#FBF9F6] border border-[#1A1A1A]/5">
            <CheckCircle className="w-4 h-4 text-[#1A1A1A] flex-shrink-0 mt-0.5" />
            <span><strong className="font-bold text-[#1A1A1A]">Multi-Tier Deduplication:</strong> Checks pk/ID → shortcode → source URL → media URL.</span>
          </div>
          <div className="flex items-start gap-3 p-4 bg-[#FBF9F6] border border-[#1A1A1A]/5">
            <CheckCircle className="w-4 h-4 text-[#1A1A1A] flex-shrink-0 mt-0.5" />
            <span><strong className="font-bold text-[#1A1A1A]">Media Ranking Algorithm:</strong> Selects maximum resolution progressive MP4 and HD images.</span>
          </div>
          <div className="flex items-start gap-3 p-4 bg-[#FBF9F6] border border-[#1A1A1A]/5">
            <CheckCircle className="w-4 h-4 text-[#1A1A1A] flex-shrink-0 mt-0.5" />
            <span><strong className="font-bold text-[#1A1A1A]">Controlled Auto-Scroll:</strong> Configurable scroll interval, stall detection, and auto-stop safety.</span>
          </div>
          <div className="flex items-start gap-3 p-4 bg-[#FBF9F6] border border-[#1A1A1A]/5">
            <CheckCircle className="w-4 h-4 text-[#1A1A1A] flex-shrink-0 mt-0.5" />
            <span><strong className="font-bold text-[#1A1A1A]">Isolated Shadow DOM Panel:</strong> Floating overlay completely immune to Instagram CSS leakage.</span>
          </div>
          <div className="flex items-start gap-3 p-4 bg-[#FBF9F6] border border-[#1A1A1A]/5">
            <CheckCircle className="w-4 h-4 text-[#1A1A1A] flex-shrink-0 mt-0.5" />
            <span><strong className="font-bold text-[#1A1A1A]">Complete Export Formats:</strong> Full metadata dump including captions, likes, views, and timestamp tags.</span>
          </div>
        </div>
      </div>

      {/* Editorial Notice */}
      <div className="border border-[#FF6321]/30 bg-[#FF6321]/5 p-6 text-xs text-[#1A1A1A] leading-relaxed flex items-start gap-4">
        <AlertTriangle className="w-5 h-5 text-[#FF6321] flex-shrink-0 mt-0.5" />
        <div>
          <strong className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-[#FF6321] block mb-1">
            Runtime Environment Verification
          </strong>
          <span className="font-sans text-[#1A1A1A]/80">
            Instagram dynamic payloads are executed in browser runtime context. Download the extension ZIP, unpack into Chrome, and inspect live scraping on Instagram via our step-by-step guide.
          </span>
        </div>
      </div>

    </div>
  );
};

