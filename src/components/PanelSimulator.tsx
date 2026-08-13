import React, { useState } from 'react';
import { Play, Square, Download, FileText } from 'lucide-react';

export const PanelSimulator: React.FC = () => {
  const [isScraping, setIsScraping] = useState(false);
  const [mediaItems, setMediaItems] = useState([
    {
      id: 'sim_1',
      shortcode: 'C3x9Lp2M1qX',
      type: 'Reel',
      title: 'The Minimalist Workspace',
      fileDetails: '2.4MB • .MP4',
      caption: 'Curated architectural tip for design studios.',
      mediaUrl: 'https://images.unsplash.com/photo-1554080353-a576cf803bda?w=600',
      likeCount: 18400,
      commentCount: 342
    },
    {
      id: 'sim_2',
      shortcode: 'C3x9K81P0aY',
      type: 'Carousel',
      title: 'Abstract Architecture Study',
      fileDetails: '1.8MB • .JPG',
      caption: 'Morning light across geometric concrete forms.',
      mediaUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600',
      likeCount: 9210,
      commentCount: 182
    },
    {
      id: 'sim_3',
      shortcode: 'C3x9J70M9bZ',
      type: 'Image',
      title: 'Morning Light Study',
      fileDetails: '4.1MB • .JPG',
      caption: 'Soft shadow interplay on warm linen canvas.',
      mediaUrl: 'https://images.unsplash.com/photo-1511367461989-f85a21fda167?w=600',
      likeCount: 14300,
      commentCount: 210
    }
  ]);

  const [filter, setFilter] = useState<'all' | 'reels' | 'images'>('all');

  const handleStartScroll = () => {
    setIsScraping(true);
    setTimeout(() => {
      setMediaItems(prev => [
        ...prev,
        {
          id: 'sim_4',
          shortcode: 'Cw82L10M9pZ',
          type: 'Reel',
          title: 'Urban Exploration Series',
          fileDetails: '12.4MB • .MP4',
          caption: 'High dynamic range capture in Tokyo.',
          mediaUrl: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=600',
          likeCount: 34100,
          commentCount: 890
        }
      ]);
    }, 1800);
  };

  const handleStopScroll = () => {
    setIsScraping(false);
  };

  const filteredItems = mediaItems.filter(item => {
    if (filter === 'reels') return item.type === 'Reel';
    if (filter === 'images') return item.type === 'Image' || item.type === 'Carousel';
    return true;
  });

  return (
    <div className="space-y-8 font-sans">
      
      {/* Editorial Description */}
      <div className="bg-[#FBF9F6] border border-[#1A1A1A]/10 p-8 shadow-sm">
        <p className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40 mb-1">Injected Component</p>
        <h3 className="text-3xl font-serif font-normal text-[#1A1A1A] mb-2">
          Floating Shadow DOM Extension Panel
        </h3>
        <p className="text-xs text-[#1A1A1A]/60 font-sans max-w-2xl">
          Live simulation of the shadow-root isolated floating panel injected directly onto Instagram profile pages.
        </p>
      </div>

      {/* Editorial Browser Container */}
      <div className="relative bg-[#F5F2ED] border border-[#1A1A1A]/10 min-h-[640px] overflow-hidden flex flex-col">
        
        {/* Editorial Browser Top Bar */}
        <div className="bg-[#1A1A1A] px-6 py-3 flex items-center justify-between text-[#F5F2ED]">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
            <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
            <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
          </div>

          <div className="bg-[#111111] border border-white/10 text-[#F5F2ED]/70 text-[11px] font-mono px-6 py-1 w-1/2 text-center truncate">
            https://www.instagram.com/velvet_curator/
          </div>

          <div className="text-[10px] font-sans uppercase tracking-[0.2em] text-[#FF6321] font-bold">
            Live DOM
          </div>
        </div>

        {/* Mock Instagram Page Context - Editorial Theme */}
        <div className="flex-1 p-8 bg-white text-[#1A1A1A]">
          <div className="max-w-2xl mx-auto space-y-8">
            <div className="flex items-center gap-6 pb-6 border-b border-[#1A1A1A]/10">
              <div className="w-20 h-20 rounded-full bg-[#1A1A1A] flex items-center justify-center text-white italic font-serif text-2xl overflow-hidden border border-[#1A1A1A]">
                <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200" className="w-full h-full object-cover grayscale" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40 mb-1">Curated Feed</p>
                <h2 className="font-serif text-3xl font-normal leading-none mb-2">@velvet_curator</h2>
                <p className="text-xs text-[#1A1A1A]/60 font-sans">Visual Culture & Architectural Archive • 142K Curator Community</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="aspect-[3/4] bg-[#F5F2ED] overflow-hidden relative group">
                <img src="https://images.unsplash.com/photo-1554080353-a576cf803bda?auto=format&fit=crop&q=80&w=400" className="w-full h-full object-cover grayscale transition-all group-hover:grayscale-0" />
              </div>
              <div className="aspect-[3/4] bg-[#F5F2ED] overflow-hidden relative group">
                <img src="https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=400" className="w-full h-full object-cover grayscale transition-all group-hover:grayscale-0" />
              </div>
              <div className="aspect-[3/4] bg-[#F5F2ED] overflow-hidden relative group">
                <img src="https://images.unsplash.com/photo-1511367461989-f85a21fda167?auto=format&fit=crop&q=80&w=400" className="w-full h-full object-cover grayscale transition-all group-hover:grayscale-0" />
              </div>
            </div>
          </div>
        </div>

        {/* Floating Panel (Design HTML Exact Theme) */}
        <div className="absolute bottom-6 right-6 w-96 bg-[#FBF9F6] border border-[#1A1A1A] shadow-2xl flex flex-col max-h-[500px] z-30 font-serif">
          
          {/* Header */}
          <div className="p-4 bg-[#1A1A1A] text-white flex items-center justify-between">
            <div>
              <p className="text-[9px] uppercase tracking-[0.2em] font-sans font-bold text-white/50">Extension v3.0</p>
              <h4 className="text-xl font-normal leading-tight font-serif">IG-Scraper</h4>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isScraping ? 'bg-[#FF6321] animate-pulse' : 'bg-green-500'}`} />
              <span className="text-[10px] font-sans uppercase tracking-widest text-white/80">
                {isScraping ? 'Scraping' : 'Live Session'}
              </span>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="px-4 py-2.5 bg-white border-b border-[#1A1A1A]/10 flex items-center justify-between text-[10px] font-sans uppercase tracking-[0.15em] text-[#1A1A1A]/70">
            <span>Discovered: <strong className="text-[#1A1A1A]">{mediaItems.length}</strong></span>
            <span>Speed: <strong className="text-[#1A1A1A]">4.2/s</strong></span>
          </div>

          {/* Control Actions */}
          <div className="p-3 bg-[#FBF9F6] border-b border-[#1A1A1A]/10 flex gap-2">
            {!isScraping ? (
              <button
                onClick={handleStartScroll}
                className="flex-1 py-2.5 bg-[#1A1A1A] text-white font-sans text-[10px] uppercase tracking-[0.15em] font-bold hover:bg-black transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Play className="w-3 h-3 text-[#FF6321]" /> Auto-Scroll
              </button>
            ) : (
              <button
                onClick={handleStopScroll}
                className="flex-1 py-2.5 border border-[#1A1A1A] text-[#1A1A1A] font-sans text-[10px] uppercase tracking-[0.15em] font-bold hover:bg-[#1A1A1A] hover:text-white transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Square className="w-3 h-3 text-[#FF6321]" /> Pause
              </button>
            )}
            <button className="px-3 py-2.5 border border-[#1A1A1A]/20 bg-white text-[#1A1A1A] font-sans text-[10px] uppercase tracking-[0.15em] font-bold hover:border-[#1A1A1A] transition-colors flex items-center gap-1">
              <Download className="w-3 h-3" /> ZIP
            </button>
            <button className="px-3 py-2.5 border border-[#1A1A1A]/20 bg-white text-[#1A1A1A] font-sans text-[10px] uppercase tracking-[0.15em] font-bold hover:border-[#1A1A1A] transition-colors flex items-center gap-1">
              <FileText className="w-3 h-3" /> JSON
            </button>
          </div>

          {/* Filters */}
          <div className="px-4 py-2 bg-white border-b border-[#1A1A1A]/10 flex gap-4 text-[10px] font-sans uppercase tracking-[0.2em] font-bold">
            <span onClick={() => setFilter('all')} className={`cursor-pointer ${filter === 'all' ? 'text-[#1A1A1A] border-b border-[#1A1A1A]' : 'text-[#1A1A1A]/30'}`}>All Media</span>
            <span onClick={() => setFilter('reels')} className={`cursor-pointer ${filter === 'reels' ? 'text-[#1A1A1A] border-b border-[#1A1A1A]' : 'text-[#1A1A1A]/30'}`}>Reels</span>
            <span onClick={() => setFilter('images')} className={`cursor-pointer ${filter === 'images' ? 'text-[#1A1A1A] border-b border-[#1A1A1A]' : 'text-[#1A1A1A]/30'}`}>Images</span>
          </div>

          {/* Media Items Grid inside panel */}
          <div className="p-4 flex-1 overflow-y-auto grid grid-cols-2 gap-3 bg-white">
            {filteredItems.map(item => (
              <div key={item.id} className="group cursor-pointer">
                <div className="aspect-[3/4] bg-[#F5F2ED] relative overflow-hidden mb-2 border border-[#1A1A1A]/5">
                  <img src={item.mediaUrl} className="w-full h-full object-cover grayscale transition-all group-hover:grayscale-0" />
                  <div className="absolute top-2 left-2 bg-white/90 backdrop-blur px-2 py-0.5 text-[8px] font-sans font-bold uppercase tracking-tighter text-[#1A1A1A]">
                    {item.type}
                  </div>
                </div>
                <p className="font-sans text-[10px] font-bold uppercase tracking-tighter truncate text-[#1A1A1A]">{item.title}</p>
                <p className="font-sans text-[9px] text-[#1A1A1A]/40 uppercase tracking-widest">{item.fileDetails}</p>
              </div>
            ))}
          </div>

        </div>

      </div>

    </div>
  );
};

