import React, { useState, useEffect, useRef } from 'react';
import { NormalizedMediaItem } from '../types';
import { X, Play, Download, ExternalLink, Heart, MessageCircle, Eye, ChevronLeft, ChevronRight, Music, Volume2, VolumeX, Sparkles, RefreshCw } from 'lucide-react';

interface MediaPreviewModalProps {
  item: NormalizedMediaItem | null;
  onClose: () => void;
  onDownload: (item: NormalizedMediaItem) => void;
  isValidating?: boolean;
  validatingStatus?: string | null;
}

export const MediaPreviewModal: React.FC<MediaPreviewModalProps> = ({ item, onClose, onDownload, isValidating, validatingStatus }) => {
  const [currentCarouselIdx, setCurrentCarouselIdx] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  if (!item) return null;

  const platform = item.platform || (
    (item.id?.startsWith('tt_') || item.sourceUrl?.includes('tiktok.com')) ? 'tiktok' :
    (item.id?.startsWith('fb_') || item.sourceUrl?.includes('facebook.com')) ? 'facebook' :
    'instagram'
  );

  const slides = item.carouselItems && item.carouselItems.length > 0 
    ? item.carouselItems 
    : [{ type: item.type, mediaUrl: item.mediaUrl, thumbnailUrl: item.thumbnailUrl }];

  const currentSlide = slides[currentCarouselIdx] || slides[0];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!slides || slides.length <= 1) return;
      if (e.key === 'ArrowRight') handleNextSlide();
      if (e.key === 'ArrowLeft') handlePrevSlide();
      if (e.key === ' ' && videoRef.current) {
        e.preventDefault();
        videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause();
      }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [slides, onClose]);

  // Construct direct proxy stream URL with platform tag
  const proxyVideoSrc = `/api/proxy-media?url=${encodeURIComponent(currentSlide.mediaUrl || item.mediaUrl)}&shortcode=${encodeURIComponent(item.shortcode || item.id)}&type=${encodeURIComponent(item.type)}&platform=${platform}`;

  const handleNextSlide = () => {
    setCurrentCarouselIdx((prev) => (prev + 1) % slides.length);
  };

  const handlePrevSlide = () => {
    setCurrentCarouselIdx((prev) => (prev - 1 + slides.length) % slides.length);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto font-sans animate-in fade-in duration-200">
      
      <div className="bg-[#121212] border border-white/10 text-white w-full max-w-5xl rounded-xl shadow-2xl overflow-hidden flex flex-col lg:flex-row max-h-[92vh] relative">
        
        {/* Top Right Close Button */}
        <button
          onClick={onClose}
          className="icon-btn absolute top-3 right-3 z-30 p-2 bg-black/60 hover:bg-black text-white/80 hover:text-white rounded-full transition-all cursor-pointer border border-white/20"
          title="Close Modal (Esc)"
        >
          <X className="w-5 h-5" />
        </button>

        {/* LEFT / TOP: Media Player Container */}
        <div className="lg:w-3/5 bg-black flex flex-col items-center justify-center relative min-h-[360px] sm:min-h-[480px] overflow-hidden group">
          
          {/* Badge indicator */}
          <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
            <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest rounded-md border backdrop-blur-md shadow-md ${
              item.type === 'video' ? 'bg-[#FF6321] text-white border-[#FF6321]' :
              item.type === 'story' ? 'bg-gradient-to-r from-amber-500 to-rose-500 text-white border-rose-400' :
              item.type === 'carousel' ? 'bg-indigo-900 text-white border-indigo-500' :
              'bg-slate-800 text-white border-slate-600'
            }`}>
              {item.type === 'video' ? '🎬 REEL / VIDEO' : item.type === 'story' ? '⚡ 24H STORY' : item.type === 'carousel' ? `📚 CAROUSEL (${currentCarouselIdx + 1}/${slides.length})` : '🖼️ PHOTO'}
            </span>

            {slides.length > 1 && (
              <span className="px-2 py-1 bg-black/70 backdrop-blur text-white text-[10px] font-mono border border-white/20 rounded-md">
                Slide {currentCarouselIdx + 1} of {slides.length}
              </span>
            )}
          </div>

          {/* Media Player Logic */}
          {item.type === 'video' || currentSlide.type === 'video' ? (
            <div className="w-full h-full flex flex-col items-center justify-center relative bg-black">
              <video
                ref={videoRef}
                key={`${proxyVideoSrc}_${playbackSpeed}`}
                src={proxyVideoSrc}
                poster={item.thumbnailUrl || item.mediaUrl}
                controls
                autoPlay
                loop
                muted={isMuted}
                className="max-h-[75vh] w-full object-contain"
                onLoadedMetadata={(e) => {
                  (e.target as HTMLVideoElement).playbackRate = playbackSpeed;
                }}
                onError={(e) => {
                  const target = e.target as HTMLVideoElement;
                  if (target.src !== (currentSlide.mediaUrl || item.mediaUrl)) {
                    console.log('Proxy video error, falling back to direct mediaUrl:', currentSlide.mediaUrl || item.mediaUrl);
                    target.src = currentSlide.mediaUrl || item.mediaUrl || '';
                  }
                }}
              />

              {/* Video Speed & Audio Controls Overlay */}
              <div className="absolute bottom-16 right-4 z-20 flex items-center gap-2 bg-black/70 backdrop-blur p-1.5 rounded-lg border border-white/20">
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="icon-btn p-1.5 text-white/80 hover:text-white transition-all cursor-pointer"
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
                </button>

                <div className="h-4 w-px bg-white/20" />

                <span className="text-[10px] text-white/60 font-mono pl-1">Speed:</span>
                {[1, 1.25, 1.5, 2].map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setPlaybackSpeed(spd)}
                    className={`icon-btn px-2 py-1 text-[10px] font-mono rounded cursor-pointer transition-all ${
                      playbackSpeed === spd ? 'bg-[#FF6321] text-white font-bold' : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center p-2 relative bg-black">
              <img
                src={currentSlide.mediaUrl || item.mediaUrl}
                alt={item.caption || 'Preview'}
                className="max-h-[75vh] w-auto max-w-full object-contain rounded"
              />
            </div>
          )}

          {/* Carousel Next / Prev Controls */}
          {slides.length > 1 && (
            <>
              <button
                onClick={handlePrevSlide}
                className="icon-btn absolute left-3 top-1/2 -translate-y-1/2 z-20 p-2.5 bg-black/70 hover:bg-black text-white rounded-full transition-all border border-white/20 cursor-pointer shadow-lg"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={handleNextSlide}
                className="icon-btn absolute right-3 top-1/2 -translate-y-1/2 z-20 p-2.5 bg-black/70 hover:bg-black text-white rounded-full transition-all border border-white/20 cursor-pointer shadow-lg"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

        </div>

        {/* RIGHT / BOTTOM: Media Details & Metrics Sidebar */}
        <div className="lg:w-2/5 p-6 flex flex-col justify-between space-y-6 overflow-y-auto bg-[#181818] border-l border-white/10">
          
          <div className="space-y-5">
            {/* Author Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 p-0.5">
                  <img
                    src={item.profilePicUrl || item.thumbnailUrl}
                    alt={item.username}
                    className="w-full h-full rounded-full object-cover bg-black"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${item.username}&background=FF6321&color=fff`;
                    }}
                  />
                </div>
                <div>
                  <h4 className="text-sm font-serif font-bold text-white flex items-center gap-1.5">
                    @{item.username || 'user'}
                  </h4>
                  <p className="text-[10px] text-white/50 font-mono">
                    Published: {item.publishedFormatted || new Date(item.publishedAt || Date.now()).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <a
                href={item.sourceUrl || item.mediaUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-[#FF6321] hover:bg-[#e05316] text-white transition-all cursor-pointer rounded-md shadow-md flex items-center gap-1.5 text-xs font-sans font-bold uppercase tracking-wider"
                title="Open original video on social media"
              >
                <span>Watch Video</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {/* Engagement Metrics Stats Grid */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white/5 p-3 rounded-lg border border-white/5 text-center">
                <div className="flex items-center justify-center gap-1 text-rose-400 text-xs font-bold mb-1">
                  <Heart className="w-3.5 h-3.5 fill-current" />
                  <span>Likes</span>
                </div>
                <p className="text-sm font-mono font-bold text-white">
                  {item.likeCount ? item.likeCount.toLocaleString() : 'N/A'}
                </p>
              </div>

              <div className="bg-white/5 p-3 rounded-lg border border-white/5 text-center">
                <div className="flex items-center justify-center gap-1 text-sky-400 text-xs font-bold mb-1">
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>Comments</span>
                </div>
                <p className="text-sm font-mono font-bold text-white">
                  {item.commentCount ? item.commentCount.toLocaleString() : 'N/A'}
                </p>
              </div>

              <div className="bg-white/5 p-3 rounded-lg border border-white/5 text-center">
                <div className="flex items-center justify-center gap-1 text-emerald-400 text-xs font-bold mb-1">
                  <Eye className="w-3.5 h-3.5" />
                  <span>Views</span>
                </div>
                <p className="text-sm font-mono font-bold text-white">
                  {item.viewCount ? `${(item.viewCount / 1000).toFixed(1)}k` : 'N/A'}
                </p>
              </div>
            </div>

            {/* Post Caption Text */}
            <div className="space-y-2">
              <label className="text-[10px] font-mono text-white/50 uppercase tracking-wider font-bold block">
                Post Caption & Hashtags
              </label>
              <div className="bg-black/40 p-4 rounded-lg border border-white/10 max-h-48 overflow-y-auto text-xs text-white/80 leading-relaxed space-y-2 font-sans whitespace-pre-wrap">
                {item.caption || 'No caption text available for this post.'}
              </div>
            </div>

            {/* Shortcode & Media Info */}
            <div className="p-3 bg-white/5 rounded-lg border border-white/10 space-y-1 text-[11px] font-mono text-white/70">
              <div className="flex justify-between">
                <span className="text-white/40">Shortcode:</span>
                <span className="text-[#FF6321]">{item.shortcode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Media Type:</span>
                <span className="uppercase text-white">{item.type}</span>
              </div>
              {item.type === 'video' && (
                <div className="flex justify-between items-center pt-1 border-t border-white/10 text-[10px]">
                  <span className="text-emerald-400 flex items-center gap-1">
                    <Music className="w-3 h-3" />
                    Audio Stream:
                  </span>
                  <span className="text-white/80">Original Audio (@{item.username})</span>
                </div>
              )}
            </div>

          </div>

          {/* Download Action Footer */}
          <div className="pt-4 border-t border-white/10 space-y-2">
            {isValidating ? (
              <div className="p-3 bg-cyan-950 border border-cyan-400 text-cyan-200 text-xs font-mono font-bold rounded-lg space-y-1 animate-pulse">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
                  <span>{validatingStatus || 'Validating media... confirming target URL is a playable MP4 file'}</span>
                </div>
                <p className="text-[10px] text-cyan-300/70 font-sans font-normal">
                  Checking binary stream payload & headers before beginning download...
                </p>
              </div>
            ) : (
              <button
                onClick={() => onDownload(item)}
                className="w-full py-3 bg-[#FF6321] hover:bg-[#e05316] text-white font-sans text-xs font-bold uppercase tracking-[0.15em] rounded-lg transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Download High Quality {item.type === 'video' ? 'MP4 Video' : 'Image'}
              </button>
            )}

            <p className="text-[10px] text-center text-white/40 font-mono">
              Streams full HD media cleanly bypassing watermark overlays
            </p>
          </div>

        </div>

      </div>

    </div>
  );
};
