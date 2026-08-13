import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Square, 
  Download, 
  RefreshCw, 
  Radio, 
  Terminal, 
  FileCode, 
  FileText,
  CheckCircle, 
  ArrowUpRight,
  Trash2,
  CheckSquare,
  Archive,
  Layers,
  Check,
  X,
  ExternalLink,
  Link,
  HelpCircle,
  Info,
  Globe,
  ShieldCheck,
  Zap,
  Filter,
  Image,
  Camera,
  Search,
  Eye,
  EyeOff,
  SlidersHorizontal,
  CopyX,
  Copy,
  Video,
  Music,
  Activity,
  Key
} from 'lucide-react';
import JSZip from 'jszip';
import { useExtensionRealtime, REAL_KITTY_ACCOUNTS } from '../lib/useExtensionRealtime';
import { SessionAuthGuard } from './SessionAuthGuard';
import { MediaPreviewModal } from './MediaPreviewModal';
import { exportToJson, exportToCsv, exportToTxt } from '../utils/export';
import { fetchMediaBinary } from '../utils/watermarkRemover';

interface RealtimeStreamDashboardProps {
  onDownloadZip: () => void;
  defaultPlatform?: 'instagram' | 'tiktok' | 'facebook';
  onPlatformChange?: (platform: 'instagram' | 'tiktok' | 'facebook') => void;
}

type StreamMediaType = 'video' | 'story' | 'image' | 'carousel';

const TIKTOK_PRESET_ACCOUNTS = [
  {
    username: 'khaby.lame',
    name: 'Khaby Lame',
    followers: '162.8M',
    description: 'The most followed TikTok creator known for silent lifehack reaction videos.',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200',
    popularTypes: ['video']
  },
  {
    username: 'charlidamelio',
    name: 'Charli D\'Amelio',
    followers: '155.2M',
    description: 'Top TikTok dance, lifestyle & viral video creator.',
    avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200',
    popularTypes: ['video']
  },
  {
    username: 'bellapoarch',
    name: 'Bella Poarch',
    followers: '94.1M',
    description: 'Viral music, lip-sync, & pop culture TikTok video creator.',
    avatarUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=200',
    popularTypes: ['video']
  },
  {
    username: 'zachking',
    name: 'Zach King',
    followers: '82.5M',
    description: 'Mind-bending digital sleight-of-hand & illusion viral videos.',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200',
    popularTypes: ['video']
  }
];

export const RealtimeStreamDashboard: React.FC<RealtimeStreamDashboardProps> = ({ 
  onDownloadZip,
  defaultPlatform = 'instagram',
  onPlatformChange
}) => {
  const realtime = useExtensionRealtime();

  // Platform Switcher State
  const [activePlatform, setActivePlatform] = useState<'instagram' | 'tiktok' | 'facebook'>(defaultPlatform);

  useEffect(() => {
    if (defaultPlatform) {
      setActivePlatform(defaultPlatform);
      if (defaultPlatform === 'tiktok') {
        realtime.setTargetUsername('khaby.lame');
        setDirectUrlInput('https://www.tiktok.com/@khaby.lame/video/72123456789');
      } else if (defaultPlatform === 'facebook') {
        realtime.setTargetUsername('100089779347259');
        setDirectUrlInput('https://www.facebook.com/reel/1234567890');
      } else {
        realtime.setTargetUsername('cats_of_instagram');
        setDirectUrlInput('https://www.instagram.com/p/DbxxjezIddE/');
      }
    }
  }, [defaultPlatform]);

  // CRM Deduplication State
  const [showDedupeModal, setShowDedupeModal] = useState<boolean>(false);
  const [dedupeResults, setDedupeResults] = useState<{
    duplicateGroups: { key: string; items: typeof realtime.mediaItems }[];
    duplicateIds: string[];
    totalDuplicates: number;
  } | null>(null);
  const [dedupeToast, setDedupeToast] = useState<string | null>(null);

  // Media Type Visibility System State (Reels, Stories, Static Posts, Carousels)
  const [enabledMediaTypes, setEnabledMediaTypes] = useState<Set<StreamMediaType>>(
    new Set(['video', 'story', 'image', 'carousel'])
  );
  const [streamSearchQuery, setStreamSearchQuery] = useState<string>('');

  const [showLogs, setShowLogs] = useState<boolean>(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewItem, setPreviewItem] = useState<typeof realtime.mediaItems[0] | null>(null);
  const [isZippingSelected, setIsZippingSelected] = useState<boolean>(false);
  const [directUrlInput, setDirectUrlInput] = useState<string>('https://www.instagram.com/p/DbxxjezIddE/');
  const [showArchModal, setShowArchModal] = useState<boolean>(false);
  const [showBulkExportModal, setShowBulkExportModal] = useState<boolean>(false);
  const [parseSuccessMsg, setParseSuccessMsg] = useState<string | null>(null);

  // Clear Feed Confirmation Modal State
  const [clearFeedPrompt, setClearFeedPrompt] = useState<{
    isOpen: boolean;
    platform: 'instagram' | 'tiktok' | 'facebook';
    itemCount: number;
  }>({
    isOpen: false,
    platform: 'instagram',
    itemCount: 0
  });

  // Bulk Export Customization Options
  const [exportIncludeMedia, setExportIncludeMedia] = useState<boolean>(true);
  const [exportIncludeMetadata, setExportIncludeMetadata] = useState<boolean>(true);
  const [exportIncludeCsv, setExportIncludeCsv] = useState<boolean>(true);
  const [exportIncludeTxt, setExportIncludeTxt] = useState<boolean>(true);
  const [exportCleanWatermarks, setExportCleanWatermarks] = useState<boolean>(true);
  const [zipProgressPercent, setZipProgressPercent] = useState<number>(0);
  const [zipProgressStatus, setZipProgressStatus] = useState<string | null>(null);

  // Media MP4 Stream Validation Status State
  const [validatingMediaStatus, setValidatingMediaStatus] = useState<string | null>(null);
  const [validatingItemId, setValidatingItemId] = useState<string | null>(null);

  const handlePlatformSwitch = (platform: 'instagram' | 'tiktok' | 'facebook') => {
    setActivePlatform(platform);
    if (onPlatformChange) {
      onPlatformChange(platform);
    }
    if (platform === 'tiktok') {
      realtime.setTargetUsername('khaby.lame');
      setDirectUrlInput('https://www.tiktok.com/@khaby.lame/video/72123456789');
    } else if (platform === 'facebook') {
      realtime.setTargetUsername('100089779347259');
      setDirectUrlInput('https://www.facebook.com/reel/1234567890');
    } else {
      realtime.setTargetUsername('cats_of_instagram');
      setDirectUrlInput('https://www.instagram.com/p/DbxxjezIddE/');
    }
  };

  const handleScanDuplicates = () => {
    const groups: Record<string, typeof realtime.mediaItems> = {};

    realtime.mediaItems.forEach(item => {
      // Grouping key determination by shortcode or mediaUrl
      const key = (item.shortcode && item.shortcode.length > 2)
        ? item.shortcode.toLowerCase().trim()
        : (item.mediaUrl ? item.mediaUrl.split('?')[0] : item.id);

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
    });

    const duplicateGroups: { key: string; items: typeof realtime.mediaItems }[] = [];
    const duplicateIds: string[] = [];

    Object.entries(groups).forEach(([key, items]) => {
      if (items.length > 1) {
        duplicateGroups.push({ key, items });
        // Keep index 0 as original, mark index 1..n as duplicates to remove
        items.slice(1).forEach(dup => duplicateIds.push(dup.id));
      }
    });

    setDedupeResults({
      duplicateGroups,
      duplicateIds,
      totalDuplicates: duplicateIds.length
    });
    setShowDedupeModal(true);
  };

  const handlePurgeDuplicates = () => {
    if (!dedupeResults || dedupeResults.duplicateIds.length === 0) return;

    const count = dedupeResults.duplicateIds.length;
    realtime.deleteItems(dedupeResults.duplicateIds);

    setDedupeToast(`Successfully purged ${count} duplicate video(s) & post(s) from CRM collection!`);
    setTimeout(() => setDedupeToast(null), 5000);

    setShowDedupeModal(false);
    setDedupeResults(null);
  };

  // Stream Type Visibility Toggles
  const toggleMediaTypeVisibility = (type: StreamMediaType) => {
    setEnabledMediaTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const setOnlyMediaType = (type: StreamMediaType) => {
    setEnabledMediaTypes(new Set([type]));
  };

  const enableAllMediaTypes = () => {
    setEnabledMediaTypes(new Set(['video', 'story', 'image', 'carousel']));
  };

  // Filtered stream items calculation based on active platform, toggled media types & search query
  const platformItems = realtime.mediaItems.filter(item => {
    const itemPlatform = item.platform || (
      (item.id?.startsWith('tt_') || item.sourceUrl?.includes('tiktok.com')) ? 'tiktok' :
      (item.id?.startsWith('fb_') || item.sourceUrl?.includes('facebook.com')) ? 'facebook' :
      'instagram'
    );
    return itemPlatform === activePlatform;
  });

  const filteredItems = platformItems.filter(item => {
    // 1. Toggle visibility filter
    if (!enabledMediaTypes.has(item.type)) return false;

    // 2. Stream Search filter
    if (streamSearchQuery.trim()) {
      const q = streamSearchQuery.toLowerCase().trim();
      const matchCaption = item.caption?.toLowerCase().includes(q);
      const matchUser = item.username?.toLowerCase().includes(q);
      const matchShortcode = item.shortcode?.toLowerCase().includes(q);
      return matchCaption || matchUser || matchShortcode;
    }

    return true;
  });

  const totalStreamCount = platformItems.length;
  const hiddenCount = totalStreamCount - filteredItems.length;

  const typeCounts = {
    video: platformItems.filter(i => i.type === 'video').length,
    story: platformItems.filter(i => i.type === 'story').length,
    image: platformItems.filter(i => i.type === 'image').length,
    carousel: platformItems.filter(i => i.type === 'carousel').length,
  };

  const selectedItems = realtime.mediaItems.filter(item => selectedIds.has(item.id));
  const isAllSelected = filteredItems.length > 0 && filteredItems.every(item => selectedIds.has(item.id));
  const isSomeSelected = selectedIds.size > 0;

  // --- Selection Handlers ---
  const toggleSelectItem = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    if (isAllSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredItems.forEach(item => next.delete(item.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredItems.forEach(item => next.add(item.id));
        return next;
      });
    }
  };

  const handleSelectByType = (type: StreamMediaType) => {
    const matching = realtime.mediaItems.filter(i => i.type === type);
    setSelectedIds(new Set(matching.map(m => m.id)));
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  // --- Bulk Action Operations ---
  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    const idsToDelete = Array.from(selectedIds) as string[];
    realtime.deleteItems(idsToDelete);
    setSelectedIds(new Set());
  };

  const handleBulkExportJson = () => {
    const itemsToExport = selectedItems.length > 0 ? selectedItems : realtime.mediaItems;
    const jsonStr = exportToJson(itemsToExport);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `instagram_${realtime.profileUsername}_${itemsToExport.length}_items.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkExportCsv = () => {
    const itemsToExport = selectedItems.length > 0 ? selectedItems : realtime.mediaItems;
    const csvStr = exportToCsv(itemsToExport);
    const blob = new Blob([csvStr], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `instagram_${realtime.profileUsername}_${itemsToExport.length}_items.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkExportTxt = () => {
    const itemsToExport = selectedItems.length > 0 ? selectedItems : realtime.mediaItems;
    const txtStr = exportToTxt(itemsToExport);
    const blob = new Blob([txtStr], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `instagram_${realtime.profileUsername}_${itemsToExport.length}_captions.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkDownloadZip = async () => {
    const itemsToZip = selectedItems.length > 0 ? selectedItems : filteredItems.length > 0 ? filteredItems : realtime.mediaItems;
    if (itemsToZip.length === 0) return;

    setIsZippingSelected(true);
    setZipProgressPercent(5);
    setZipProgressStatus('Initializing ZIP Archive structure...');
    try {
      const zip = new JSZip();

      // Check which media types actually exist in this download batch
      const hasVideos = itemsToZip.some(i => i.type === 'video');
      const hasStories = itemsToZip.some(i => i.type === 'story');
      const hasImages = itemsToZip.some(i => i.type === 'image');
      const hasCarousels = itemsToZip.some(i => i.type === 'carousel');

      // Create folders ONLY for media types present in batch
      const videoFolder = (exportIncludeMedia && hasVideos) ? zip.folder('01_VIDEOS_REELS_MP4') : null;
      const storyFolder = (exportIncludeMedia && hasStories) ? zip.folder('02_STORIES_24H') : null;
      const imageFolder = (exportIncludeMedia && hasImages) ? zip.folder('03_STATIC_PHOTOS_JPG') : null;
      const carouselFolder = (exportIncludeMedia && hasCarousels) ? zip.folder('04_CAROUSEL_GALLERIES') : null;
      const metadataFolder = (exportIncludeMetadata || exportIncludeCsv || exportIncludeTxt) ? zip.folder('05_METADATA_AND_CAPTIONS') : null;

      // 00_READ_ME_HOW_TO_EXTRACT.txt
      const readmeText = `===================================================================
INSTAGRAM MEDIA EXPORT - EASY EXTRACTOR GUIDE
===================================================================
Target Profile: @${realtime.profileUsername || 'instagram'}
Total Exported Items: ${itemsToZip.length}
Watermark Cleaning Status: ${exportCleanWatermarks ? 'ENABLED (Overlays Stripped)' : 'RAW MEDIA'}
Date Exported: ${new Date().toLocaleString()}

GENERATED FOLDERS IN THIS ARCHIVE:
-------------------------------------------------------------------
${hasVideos ? '1. 📁 01_VIDEOS_REELS_MP4/\n   Contains video posts and Instagram Reels in native .mp4 format.\n' : ''}${hasStories ? '2. 📁 02_STORIES_24H/\n   Contains ephemeral 24-hour Instagram Stories & highlights.\n' : ''}${hasImages ? '3. 📁 03_STATIC_PHOTOS_JPG/\n   Contains high-resolution single photo posts in .jpg format.\n' : ''}${hasCarousels ? '4. 📁 04_CAROUSEL_GALLERIES/\n   Contains multi-photo gallery album folders.\n' : ''}${metadataFolder ? '5. 📁 05_METADATA_AND_CAPTIONS/\n   Contains metadata.json, captions, and posts_table.csv.\n' : ''}
HOW TO EXTRACT:
-------------------------------------------------------------------
- On Windows: Right click this file -> 'Extract All...'
- On macOS: Double-click this .zip file to unpack instantly into folders.
===================================================================`;

      zip.file('00_READ_ME_HOW_TO_EXTRACT.txt', readmeText);

      // Metadata exports inside 05_METADATA_AND_CAPTIONS
      if (metadataFolder) {
        if (exportIncludeMetadata) metadataFolder.file('metadata.json', exportToJson(itemsToZip));
        if (exportIncludeCsv) metadataFolder.file('posts_table.csv', exportToCsv(itemsToZip));
        if (exportIncludeTxt) metadataFolder.file('captions_summary.txt', exportToTxt(itemsToZip));
      }

      // Fetch and pack media binary files
      if (exportIncludeMedia) {
        for (let i = 0; i < itemsToZip.length; i++) {
          const item = itemsToZip[i];
          const idxNum = String(i + 1).padStart(2, '0');
          const percent = Math.round(10 + ((i + 1) / itemsToZip.length) * 75);
          setZipProgressPercent(percent);
          setZipProgressStatus(`Processing item ${i + 1}/${itemsToZip.length} (@${item.username} - ${item.type.toUpperCase()})...`);

          try {
            setValidatingItemId(item.id);
            const { blob, filename } = await fetchMediaBinary(item, {
              enabled: exportCleanWatermarks,
              cropBottomOverlay: true,
              blurWatermarkZone: true,
              onStatusUpdate: (status) => {
                setZipProgressStatus(status);
                setValidatingMediaStatus(status);
              }
            });

            const formattedFilename = `${idxNum}_${filename}`;

            if (item.type === 'video') {
              videoFolder?.file(formattedFilename, blob);
            } else if (item.type === 'story') {
              storyFolder?.file(formattedFilename, blob);
            } else if (item.type === 'image') {
              imageFolder?.file(formattedFilename, blob);
            } else if (item.type === 'carousel') {
              const sub = carouselFolder?.folder(`carousel_${idxNum}_${item.shortcode}`);
              sub?.file(`main_${filename}`, blob);
              sub?.file(`caption.txt`, `Caption for post ${item.shortcode}:\n\n${item.caption || ''}\n\nMedia URL: ${item.mediaUrl}`);
            }
          } catch (err) {
            console.warn(`Error processing ZIP media for ${item.shortcode}:`, err);
          }
        }
      }

      setZipProgressPercent(90);
      setZipProgressStatus('Compressing ZIP file archive...');
      const content = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        const compPercent = Math.round(90 + (metadata.percent / 10));
        setZipProgressPercent(compPercent);
      });

      setZipProgressPercent(100);
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Instagram_Bulk_Export_${realtime.profileUsername || 'instagram'}_${itemsToZip.length}_items.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setZipProgressStatus(`Successfully downloaded ${itemsToZip.length} items as ZIP!`);
      setTimeout(() => {
        setZipProgressStatus('');
        setZipProgressPercent(0);
        setClearFeedPrompt({
          isOpen: true,
          platform: activePlatform,
          itemCount: itemsToZip.length
        });
      }, 1000);
    } catch (err) {
      console.error('ZIP export error:', err);
      setZipProgressStatus('Failed to generate ZIP archive.');
    } finally {
      setIsZippingSelected(false);
    }
  };

  const handleDirectMediaDownload = async (item: typeof realtime.mediaItems[0]) => {
    setValidatingItemId(item.id);
    setValidatingMediaStatus(`Validating media... confirming target URL is a playable MP4 file for @${item.username || 'user'}`);
    try {
      const { blob, filename } = await fetchMediaBinary(item, {
        enabled: exportCleanWatermarks,
        onStatusUpdate: (status) => setValidatingMediaStatus(status)
      });
      setValidatingMediaStatus(`Validation successful: Playable MP4 verified for @${item.username || 'user'}! Starting download...`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setTimeout(() => {
        setValidatingMediaStatus(null);
        setValidatingItemId(null);
      }, 3500);
    } catch (err) {
      console.warn('Direct media download failed, trying proxy download endpoint:', err);
      setValidatingMediaStatus(`Direct download notice: redirecting to stream endpoint...`);
      const proxyUrl = `/api/proxy-media?url=${encodeURIComponent(item.mediaUrl || '')}&shortcode=${encodeURIComponent(item.shortcode || '')}&type=${encodeURIComponent(item.type || 'video')}`;
      window.open(proxyUrl, '_blank');
      setTimeout(() => {
        setValidatingMediaStatus(null);
        setValidatingItemId(null);
      }, 3500);
    }
  };

  const handleDirectUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!directUrlInput) return;
    const ok = realtime.parseDirectUrl(directUrlInput, activePlatform);
    if (ok) {
      setParseSuccessMsg(`Successfully parsed & extracted ${activePlatform.toUpperCase()} post into live stream!`);
      setTimeout(() => setParseSuccessMsg(null), 4000);
    } else {
      setParseSuccessMsg(`Unable to parse link. Please ensure link matches ${activePlatform === 'tiktok' ? 'tiktok.com/@user/video/...' : activePlatform === 'facebook' ? 'facebook.com/reel/...' : 'instagram.com/p/...'}`);
      setTimeout(() => setParseSuccessMsg(null), 4000);
    }
  };

  return (
    <div className="space-y-8 font-sans">
      
      {/* Top Prominent Real-Time Scraping Master Controller */}
      <div className="bg-[#1A1A1A] text-[#F5F2ED] p-6 sm:p-8 border border-[#1A1A1A]/10 shadow-lg relative overflow-hidden space-y-6">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#FF6321]/15 rounded-full blur-3xl pointer-events-none" />
        
        {/* Banner Header & Live Bridge Status */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex flex-wrap items-center gap-2.5 mb-2">
              <span className={`inline-flex items-center gap-2 px-3 py-1 text-[10px] font-sans font-bold uppercase tracking-[0.2em] border ${
                realtime.isScraping
                  ? 'bg-emerald-950 text-emerald-400 border-emerald-500/50'
                  : 'bg-white/10 text-white border-white/15'
              }`}>
                <span className={`w-2.5 h-2.5 rounded-full ${realtime.isScraping ? 'bg-emerald-400 animate-ping' : (realtime.isConnected ? 'bg-[#FF6321] animate-pulse' : 'bg-amber-400')}`} />
                {realtime.isScraping ? 'SCRAPER RUNNING' : (realtime.isConnected ? 'Bridge Ready (Extension Active)' : 'Bridge Standby')}
              </span>

              <span className="px-2.5 py-1 bg-black/60 text-white/80 border border-white/10 text-[9px] font-mono font-bold">
                Target: @{realtime.targetUsername || 'cats_of_instagram'} ({activePlatform.toUpperCase()})
              </span>
            </div>

            <h2 className="text-2xl sm:text-4xl font-serif font-normal text-white">
              Social Scraper & Live Stream Command Engine
            </h2>
            <p className="text-xs text-white/70 font-sans max-w-2xl leading-relaxed mt-1">
              Extract real posts, videos, reels, and captions directly from Instagram or TikTok via the active browser extension.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowArchModal(true)}
              className="p-3 bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer border border-white/20"
              title="How Extension Scraping Works"
            >
              <HelpCircle className="w-5 h-5 text-[#FF6321]" />
            </button>
          </div>
        </div>

        {/* Platform & Target Handle Selector Toolbar */}
        <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-sans">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-white/60 uppercase font-mono text-[10px]">Platform:</span>
            <div className="flex items-center gap-1 bg-black/40 p-1 border border-white/10">
              <button
                onClick={() => handlePlatformSwitch('instagram')}
                className={`px-3 py-1.5 font-bold uppercase text-[10px] tracking-wider transition-all cursor-pointer ${
                  activePlatform === 'instagram' ? 'bg-[#FF6321] text-white' : 'text-white/60 hover:text-white'
                }`}
              >
                Instagram 📸
              </button>
              <button
                onClick={() => handlePlatformSwitch('tiktok')}
                className={`px-3 py-1.5 font-bold uppercase text-[10px] tracking-wider transition-all cursor-pointer ${
                  activePlatform === 'tiktok' ? 'bg-[#FF0050] text-white' : 'text-white/60 hover:text-white'
                }`}
              >
                TikTok 🎵
              </button>
              <button
                onClick={() => handlePlatformSwitch('facebook')}
                className={`px-3 py-1.5 font-bold uppercase text-[10px] tracking-wider transition-all cursor-pointer ${
                  activePlatform === 'facebook' ? 'bg-[#1877F2] text-white' : 'text-white/60 hover:text-white'
                }`}
              >
                Facebook 📘
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 w-full sm:w-auto flex-1 max-w-md">
            <div className="flex items-center gap-2">
              <span className="text-white/60 uppercase font-mono text-[10px] shrink-0">
                {activePlatform === 'facebook' ? 'FB Profile ID / URL:' : 'Target Handle:'}
              </span>
              <input
                type="text"
                value={realtime.targetUsername}
                onChange={(e) => realtime.setTargetUsername(e.target.value.replace(/^@/, ''))}
                placeholder={
                  activePlatform === 'facebook'
                    ? 'e.g. 100089779347259 or paste full URL'
                    : activePlatform === 'tiktok'
                    ? 'e.g. khaby.lame'
                    : 'e.g. cats_of_instagram'
                }
                className={`w-full px-3 py-1.5 bg-black/40 border text-white text-xs font-mono focus:outline-none ${
                  activePlatform === 'facebook' ? 'border-[#1877F2]/50 focus:border-[#1877F2]' : 'border-white/20 focus:border-[#FF6321]'
                }`}
              />
            </div>
            {activePlatform === 'facebook' && (
              <span className="text-[10px] font-mono text-[#1877F2] font-semibold">
                💡 Paste profile URL, numeric ID (e.g. 100089779347259), or page handle.
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={realtime.requestSync}
              className="px-3 py-1.5 bg-[#FF6321]/20 hover:bg-[#FF6321]/30 text-[#FF6321] border border-[#FF6321]/50 font-mono text-[10px] uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 font-bold"
              title="Sync latest extension scraped items"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Sync Stream</span>
            </button>

            <div className="flex items-center gap-1 bg-black/40 border border-white/20 px-2 py-1">
              <span className="text-white/60 font-mono text-[10px] uppercase">Limit:</span>
              <select
                value={realtime.maxVideosLimit || 0}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10) || 0;
                  realtime.setExtractionLimits(val, val);
                }}
                className="bg-transparent text-white font-mono text-xs focus:outline-none cursor-pointer"
              >
                <option value={0} className="bg-slate-900 text-white">Unlimited (∞)</option>
                <option value={5} className="bg-slate-900 text-white">5 Videos</option>
                <option value={10} className="bg-slate-900 text-white">10 Videos</option>
                <option value={25} className="bg-slate-900 text-white">25 Videos</option>
                <option value={50} className="bg-slate-900 text-white">50 Videos</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => realtime.deletePlatformItems(activePlatform)}
              className="px-3.5 py-1.5 bg-white/5 hover:bg-rose-950/60 text-white/70 hover:text-rose-300 font-mono text-[10px] uppercase tracking-wider transition-all cursor-pointer border border-white/10"
            >
              Clear {activePlatform.toUpperCase()} Feed ({platformItems.length})
            </button>
          </div>
        </div>

        {/* Session Auth & Health Guard Component */}
        <div className="pt-4 border-t border-white/10 space-y-4">
          <SessionAuthGuard
            platform={activePlatform}
            isLoggedIn={realtime.isLoggedIn}
            isConnected={realtime.isConnected}
            isScraping={realtime.isScraping}
            targetUsername={realtime.targetUsername}
            progressMessage={realtime.progressMessage}
            onStartScrape={() => {
              realtime.launchRealScrape(realtime.targetUsername, realtime.targetMediaType, activePlatform);
            }}
            onStopScrape={realtime.stopAutoScroll}
            onOpenLoginTab={() => {
              const loginUrl = activePlatform === 'tiktok'
                ? 'https://www.tiktok.com/login'
                : activePlatform === 'facebook'
                ? 'https://www.facebook.com/login'
                : 'https://www.instagram.com/accounts/login/';
              window.open(loginUrl, '_blank');
            }}
            onDownloadZip={onDownloadZip}
          />

          {/* Live Scraper Control & Batch Progress Tracker for All Active Platforms */}
          <div 
            className="bg-[#18191A] border p-5 shadow-lg text-white space-y-4"
            style={{ borderColor: activePlatform === 'tiktok' ? '#00f2fe' : activePlatform === 'facebook' ? '#1877F2' : '#E1306C' }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <span 
                  className="px-2.5 py-1 text-white text-[10px] font-sans font-bold uppercase tracking-wider"
                  style={{ backgroundColor: activePlatform === 'tiktok' ? '#00f2fe' : activePlatform === 'facebook' ? '#1877F2' : '#E1306C', color: activePlatform === 'tiktok' ? '#000' : '#fff' }}
                >
                  {activePlatform.toUpperCase()} Live Batch Scraper Control
                </span>
                <span className="text-xs font-mono font-bold">
                  {realtime.isScraping ? (
                    <span className="text-emerald-400 animate-pulse">🟢 Live Scraping Active (@{realtime.profileUsername || 'Target'})</span>
                  ) : (
                    <span className="text-amber-400">⏸️ Scraper Idle / Standby</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-white/80">
                  Media Items Captured: <strong className="text-white text-sm">{platformItems.length}</strong> {realtime.maxVideosLimit ? `/ ${realtime.maxVideosLimit}` : ''}
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono text-white/80">
                <span>Extraction Batch Progress</span>
                <span>{realtime.maxVideosLimit ? Math.min(100, Math.round((platformItems.length / realtime.maxVideosLimit) * 100)) : (realtime.isScraping ? 75 : 100)}%</span>
              </div>
              <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                <div 
                  className="h-full transition-all duration-300" 
                  style={{ 
                    width: `${realtime.maxVideosLimit ? Math.min(100, Math.round((platformItems.length / realtime.maxVideosLimit) * 100)) : (realtime.isScraping ? 75 : 100)}%`,
                    backgroundColor: activePlatform === 'tiktok' ? '#00f2fe' : activePlatform === 'facebook' ? '#1877F2' : '#E1306C'
                  }} 
                />
              </div>
            </div>

            {/* Stop Scraping, Pause, Resume & Cancel Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10">
              <div className="text-xs text-white/70 font-mono max-w-md truncate">
                {realtime.progressMessage || `Ready to auto-scroll and scrape ${activePlatform.toUpperCase()} posts.`}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {realtime.isScraping ? (
                  <>
                    <button
                      type="button"
                      onClick={realtime.stopAutoScroll}
                      className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-sans text-xs font-bold uppercase tracking-wider flex items-center gap-2 cursor-pointer shadow-lg border border-rose-400 transition-all active:scale-95"
                    >
                      <Square className="w-4 h-4 fill-current text-white" />
                      <span>🛑 STOP SCRAPING</span>
                    </button>

                    <button
                      type="button"
                      onClick={realtime.stopAutoScroll}
                      className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-sans text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow transition-all"
                    >
                      <span>Pause Scroll</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => realtime.launchRealScrape(realtime.targetUsername, realtime.targetMediaType, activePlatform)}
                    className="px-5 py-2.5 font-sans text-xs font-bold uppercase tracking-wider flex items-center gap-2 cursor-pointer shadow-lg transition-all text-white border border-white/20 active:scale-95"
                    style={{ backgroundColor: activePlatform === 'tiktok' ? '#00b3bc' : activePlatform === 'facebook' ? '#1877F2' : '#E1306C' }}
                  >
                    <Play className="w-4 h-4 fill-current text-white animate-pulse" />
                    <span>START / RESUME SCRAPE</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => realtime.deletePlatformItems(activePlatform)}
                  className="px-3 py-2 bg-white/5 hover:bg-rose-950/60 text-white/70 hover:text-rose-300 font-sans text-xs font-bold uppercase tracking-wider border border-white/10 cursor-pointer transition-all"
                >
                  Clear {activePlatform.toUpperCase()} Batch
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* APP-CONTROLLED REMOTE EXTENSION COMMAND CENTER & WATERMARK CLEANER */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Remote Command Panel */}
        <div className="lg:col-span-2 bg-[#1A1A1A] text-white p-6 shadow-md border border-[#1A1A1A] space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-[#FF6321] text-white text-[9px] font-sans font-bold uppercase tracking-[0.2em]">
                  Remote Control Panel
                </span>
                <span className="text-xs text-emerald-400 font-mono font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                  App-Operated Bridge Active
                </span>
              </div>
              <h3 className="text-xl font-serif text-white mt-1">
                Operate Extension Directly From App
              </h3>
            </div>

            {/* Bulk ZIP Download Button with Progress */}
            <button
              onClick={() => setShowBulkExportModal(true)}
              disabled={isZippingSelected}
              className="px-5 py-2.5 bg-[#FF6321] hover:bg-[#e05316] disabled:bg-gray-600 text-white font-sans text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer shadow-md"
            >
              {isZippingSelected ? (
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
              ) : (
                <Archive className="w-4 h-4 text-white" />
              )}
              {isZippingSelected ? `Zipping (${zipProgressPercent}%)...` : 'Bulk Export Center (.zip)'}
            </button>
          </div>

          {zipProgressStatus && (
            <div className="p-3 bg-[#FF6321]/20 border border-[#FF6321]/40 text-amber-200 text-xs font-mono font-bold space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#FF6321]" />
                  <span>{zipProgressStatus}</span>
                </span>
                {zipProgressPercent > 0 && <span className="text-[#FF6321]">{zipProgressPercent}%</span>}
              </div>
              {zipProgressPercent > 0 && (
                <div className="w-full bg-white/10 h-1.5 overflow-hidden">
                  <div className="bg-[#FF6321] h-full transition-all duration-300" style={{ width: `${zipProgressPercent}%` }} />
                </div>
              )}
            </div>
          )}

          {validatingMediaStatus && !zipProgressStatus && (
            <div className="p-3 bg-cyan-950/80 border border-cyan-400/60 text-cyan-200 text-xs font-mono font-bold shadow-lg space-y-1.5 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
                  <span className="text-white font-sans font-bold">{validatingMediaStatus}</span>
                </div>
                <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 text-[9px] uppercase tracking-wider font-mono">
                  Validating MP4 Stream
                </span>
              </div>
              <p className="text-[10px] text-cyan-300/70 font-sans font-normal">
                Checking stream length, video headers, and ensuring genuine .mp4 binary payload before initiating download.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            
            {/* Auto-Scroll Speed Controls */}
            <div className="space-y-2">
              <label className="text-xs font-mono font-bold text-white/80 uppercase tracking-wider flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-[#FF6321]" /> Auto-Scroll Speed:
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'slow', label: '1x Slow' },
                  { id: 'normal', label: '2x Normal' },
                  { id: 'fast', label: '3x Turbo' }
                ].map((s) => (
                  <button
                    key={s.id}
                    onClick={() => realtime.setScrollSpeed(s.id as any)}
                    className={`py-2 px-2 text-[10px] font-mono font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                      realtime.scrollSpeed === s.id
                        ? 'bg-[#FF6321] text-white border-[#FF6321]'
                        : 'bg-white/5 text-white/70 border-white/10 hover:border-white/30'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Watermark Cleaner Toggle */}
            <div className="space-y-2">
              <label className="text-xs font-mono font-bold text-white/80 uppercase tracking-wider flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-[#FF6321]" /> Instagram Watermark Cleaner:
              </label>
              <button
                onClick={() => realtime.setWatermarkCleaningEnabled(!realtime.watermarkCleaningEnabled)}
                className={`w-full py-2.5 px-3 border flex items-center justify-between text-xs font-sans font-bold transition-all cursor-pointer ${
                  realtime.watermarkCleaningEnabled
                    ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-white/60'
                }`}
              >
                <span className="flex items-center gap-2">
                  <CheckSquare className={`w-4 h-4 ${realtime.watermarkCleaningEnabled ? 'text-emerald-400' : 'text-white/40'}`} />
                  Auto-Strip Watermark Overlays
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-black/40">
                  {realtime.watermarkCleaningEnabled ? 'ACTIVE' : 'OFF'}
                </span>
              </button>
              <p className="text-[10px] text-white/50 font-sans">
                Automatically crops bottom overlay badges & removes Instagram watermark stamps from images & `.mp4` video downloads inside the ZIP!
              </p>
            </div>

          </div>

          {/* Smart Auto-Stop & Extraction Limits Conditions */}
          <div className="space-y-3 pt-4 border-t border-white/10">
            <div className="flex items-center justify-between">
              <label className="text-xs font-mono font-bold text-white/90 uppercase tracking-wider flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-[#FF6321]" /> Extraction Limits & Auto-Stop Rules:
              </label>
              <span className="text-[10px] text-[#FF6321] font-mono">
                {(realtime.maxVideosLimit > 0 || realtime.maxTotalLimit > 0) ? '● Auto-Stop Active' : '∞ Unlimited'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white/5 p-3.5 border border-white/10 rounded-lg">
              {/* Limit Max Reels */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[11px] font-sans text-white/80">
                  <span>Max Reels / Videos Limit:</span>
                  <span className="font-mono text-[#FF6321] font-bold">
                    {realtime.maxVideosLimit > 0 ? `${realtime.maxVideosLimit} Reel(s)` : 'Unlimited'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {[1, 3, 5, 10, 0].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => realtime.setExtractionLimits(num, realtime.maxTotalLimit)}
                      className={`flex-1 py-1.5 text-[10px] font-mono border transition-all cursor-pointer ${
                        realtime.maxVideosLimit === num 
                          ? 'bg-[#FF6321] text-white border-[#FF6321] font-bold shadow-sm'
                          : 'bg-black/40 text-white/60 border-white/10 hover:border-white/30'
                      }`}
                    >
                      {num === 0 ? '∞ All' : `${num}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Limit Max Total Items */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[11px] font-sans text-white/80">
                  <span>Max Total Posts Limit:</span>
                  <span className="font-mono text-[#FF6321] font-bold">
                    {realtime.maxTotalLimit > 0 ? `${realtime.maxTotalLimit} Posts` : 'Unlimited'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {[5, 10, 25, 50, 0].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => realtime.setExtractionLimits(realtime.maxVideosLimit, num)}
                      className={`flex-1 py-1.5 text-[10px] font-mono border transition-all cursor-pointer ${
                        realtime.maxTotalLimit === num 
                          ? 'bg-[#FF6321] text-white border-[#FF6321] font-bold shadow-sm'
                          : 'bg-black/40 text-white/60 border-white/10 hover:border-white/30'
                      }`}
                    >
                      {num === 0 ? '∞ All' : `${num}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Quick Remote Navigation Bar */}
          <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs font-serif text-white/90">
              Remote Target Handle: <span className="font-mono text-[#FF6321] font-bold">@{realtime.targetUsername || 'cats_of_instagram'}</span>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => realtime.navigateExtensionToProfile(realtime.targetUsername)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-[11px] font-sans font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer border border-white/20"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[#FF6321]" /> Navigate & Scrape
              </button>
              {!realtime.isScraping ? (
                <button
                  onClick={realtime.startAutoScroll}
                  className="px-4 py-2 bg-[#FF6321] hover:bg-[#e05316] text-white text-[11px] font-sans font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Play className="w-3 h-3 fill-current" /> Start
                </button>
              ) : (
                <button
                  onClick={realtime.stopAutoScroll}
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white text-[11px] font-sans font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-current" /> Pause
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Browser & Profile Heartbeat Detector */}
        <div className="bg-white border border-[#1A1A1A]/10 p-6 shadow-sm flex flex-col justify-between space-y-4 font-sans">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="px-2.5 py-1 bg-[#1A1A1A] text-white text-[9px] font-bold uppercase tracking-[0.2em]">
                Extension Profiles Monitor
              </span>
              <span className="text-[10px] font-mono text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 border border-emerald-200">
                ● Connected
              </span>
            </div>
            <h4 className="text-lg font-serif text-[#1A1A1A]">
              Installed Extension Profiles
            </h4>
            <p className="text-xs text-[#1A1A1A]/60 mt-1">
              Live heartbeat detecting active extension instances across your Chrome and Microsoft Edge profiles:
            </p>
          </div>

          <div className="space-y-3">
            {realtime.detectedProfiles.map((p) => (
              <div key={p.id} className="p-3 bg-[#FBF9F6] border border-[#1A1A1A]/10 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#1A1A1A] flex items-center gap-1.5 font-sans">
                    <Globe className="w-3.5 h-3.5 text-[#FF6321]" />
                    {p.browser} — {p.profileName}
                  </span>
                  <span className="text-[9px] font-mono font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5">
                    ACTIVE
                  </span>
                </div>
                <p className="text-[10px] text-[#1A1A1A]/60 font-mono truncate">
                  {p.activeTabUrl}
                </p>
                <div className="text-[9px] text-[#1A1A1A]/40 font-mono flex items-center justify-between pt-1">
                  <span>Heartbeat: {p.lastSeen}</span>
                  <span className="text-[#FF6321]">Remote Bridge OK</span>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-[#1A1A1A]/10 text-[10px] text-[#1A1A1A]/60 flex items-center justify-between">
            <span>Install in both Chrome & Edge for dual profile scraping.</span>
            <button
              onClick={() => onDownloadZip()}
              className="text-[#FF6321] font-bold hover:underline cursor-pointer"
            >
              Get Extension ZIP
            </button>
          </div>
        </div>

      </div>
      <div className="bg-[#FBF9F6] border border-[#1A1A1A]/10 p-6 shadow-sm relative">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 bg-[#1A1A1A] text-white text-[9px] font-sans font-bold uppercase tracking-[0.2em]">
                Direct Link Parser
              </span>
              <span className="text-xs text-[#FF6321] font-mono font-bold">
                No Login Required / Instant Extraction
              </span>
            </div>
            <h3 className="text-xl font-serif text-[#1A1A1A] mt-2">
              Scrape Specific Instagram Post or Reel URL
            </h3>
            <p className="text-xs text-[#1A1A1A]/60 font-sans mt-0.5">
              Paste any public Instagram post link (e.g. <code className="text-[#1A1A1A] font-bold font-mono">https://www.instagram.com/p/DbxxjezIddE/</code>) to extract shortcode metadata, media URLs, and captions.
            </p>
          </div>

          <button
            onClick={() => setShowArchModal(true)}
            className="text-xs font-sans font-bold text-[#FF6321] hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Info className="w-3.5 h-3.5" /> How does it work without a session?
          </button>
        </div>

        <form onSubmit={handleDirectUrlSubmit} className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Link className="w-4 h-4 text-[#1A1A1A]/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={directUrlInput}
              onChange={(e) => setDirectUrlInput(e.target.value)}
              placeholder="https://www.instagram.com/p/DbxxjezIddE/"
              className="w-full pl-10 pr-4 py-3 bg-white border border-[#1A1A1A]/20 focus:outline-none focus:border-[#1A1A1A] text-xs font-mono"
            />
          </div>

          <button
            type="submit"
            className="w-full sm:w-auto px-6 py-3 bg-[#1A1A1A] hover:bg-black text-white text-xs font-sans font-bold uppercase tracking-[0.15em] transition-all cursor-pointer shrink-0"
          >
            Parse & Extract Post
          </button>
        </form>

        {parseSuccessMsg && (
          <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-sans font-bold flex items-center justify-between">
            <span>{parseSuccessMsg}</span>
            <button onClick={() => setParseSuccessMsg(null)} className="text-emerald-800 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <div className="bg-white border border-[#1A1A1A]/10 p-4 shadow-sm">
          <p className="text-[10px] font-sans uppercase tracking-[0.2em] font-bold text-[#1A1A1A]/40 mb-1">Target Account</p>
          <p className="text-base font-serif text-[#1A1A1A] font-bold truncate">@{realtime.profileUsername || 'velvet_curator'}</p>
        </div>

        <div className="bg-white border border-[#1A1A1A]/10 p-4 shadow-sm">
          <p className="text-[10px] font-sans uppercase tracking-[0.2em] font-bold text-[#1A1A1A]/40 mb-1">Discovered Total</p>
          <p className="text-2xl font-serif text-[#1A1A1A]">{realtime.stats.total}</p>
        </div>

        <div className="bg-white border border-[#1A1A1A]/10 p-4 shadow-sm">
          <p className="text-[10px] font-sans uppercase tracking-[0.2em] font-bold text-[#1A1A1A]/40 mb-1">Reels & Videos</p>
          <p className="text-2xl font-serif text-[#FF6321]">{realtime.stats.videos}</p>
        </div>

        <div className="bg-white border border-[#1A1A1A]/10 p-4 shadow-sm">
          <p className="text-[10px] font-sans uppercase tracking-[0.2em] font-bold text-[#1A1A1A]/40 mb-1">Stories (24h)</p>
          <p className="text-2xl font-serif text-amber-600">{realtime.stats.stories || 0}</p>
        </div>

        <div className="bg-white border border-[#1A1A1A]/10 p-4 shadow-sm">
          <p className="text-[10px] font-sans uppercase tracking-[0.2em] font-bold text-[#1A1A1A]/40 mb-1">Images & Carousel</p>
          <p className="text-2xl font-serif text-[#1A1A1A]">{realtime.stats.images + realtime.stats.carousels}</p>
        </div>

        <div className="bg-white border border-[#1A1A1A]/10 p-4 shadow-sm col-span-2 sm:col-span-1">
          <p className="text-[10px] font-sans uppercase tracking-[0.2em] font-bold text-[#1A1A1A]/40 mb-1">Stream Mode</p>
          <button
            onClick={realtime.toggleSimulator}
            className="text-xs font-sans font-bold uppercase tracking-wider text-[#FF6321] hover:underline flex items-center gap-1.5 mt-1 cursor-pointer"
          >
            <Radio className="w-3.5 h-3.5" />
            {realtime.simulatorActive ? 'Live Simulator On' : 'Extension Only'}
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* STREAM VISIBILITY & MEDIA TYPE FILTERING SYSTEM                           */}
      {/* ========================================================================= */}
      <div className="bg-white border border-[#1A1A1A]/10 p-6 shadow-sm space-y-5">
        
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1A1A1A]/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 bg-[#1A1A1A] text-white text-[9px] font-sans font-bold uppercase tracking-[0.2em] flex items-center gap-1.5">
                <Filter className="w-3 h-3 text-[#FF6321]" />
                Stream Filtering System
              </span>
              <span className="text-xs text-[#FF6321] font-sans font-bold">
                {filteredItems.length} of {totalStreamCount} Items Visible
              </span>
            </div>
            <h3 className="text-xl font-serif text-[#1A1A1A] mt-2">
              Media Type Visibility Controls
            </h3>
            <p className="text-xs text-[#1A1A1A]/60 font-sans mt-0.5">
              Toggle visibility switches for specific media types (Reels, Stories, Static Posts, Carousels) while monitoring the live stream.
            </p>
          </div>

          {/* Quick Preset Buttons & Reset */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#1A1A1A]/50 mr-1 hidden lg:inline">
              Presets:
            </span>
            <button
              onClick={enableAllMediaTypes}
              className={`px-3 py-1.5 text-[10px] font-sans font-bold uppercase tracking-wider transition-all cursor-pointer border ${
                enabledMediaTypes.size === 4
                  ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                  : 'bg-[#FBF9F6] text-[#1A1A1A]/70 border-[#1A1A1A]/15 hover:border-[#1A1A1A]'
              }`}
            >
              Show All ({totalStreamCount})
            </button>
            <button
              onClick={() => setOnlyMediaType('video')}
              className={`px-3 py-1.5 text-[10px] font-sans font-bold uppercase tracking-wider transition-all cursor-pointer border ${
                enabledMediaTypes.size === 1 && enabledMediaTypes.has('video')
                  ? 'bg-[#FF6321] text-white border-[#FF6321]'
                  : 'bg-[#FBF9F6] text-[#1A1A1A]/70 border-[#1A1A1A]/15 hover:border-[#1A1A1A]'
              }`}
            >
              Reels Only ({typeCounts.video})
            </button>
            <button
              onClick={() => setOnlyMediaType('story')}
              className={`px-3 py-1.5 text-[10px] font-sans font-bold uppercase tracking-wider transition-all cursor-pointer border ${
                enabledMediaTypes.size === 1 && enabledMediaTypes.has('story')
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-[#FBF9F6] text-[#1A1A1A]/70 border-[#1A1A1A]/15 hover:border-[#1A1A1A]'
              }`}
            >
              Stories Only ({typeCounts.story})
            </button>
            <button
              onClick={() => setOnlyMediaType('image')}
              className={`px-3 py-1.5 text-[10px] font-sans font-bold uppercase tracking-wider transition-all cursor-pointer border ${
                enabledMediaTypes.size === 1 && enabledMediaTypes.has('image')
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-[#FBF9F6] text-[#1A1A1A]/70 border-[#1A1A1A]/15 hover:border-[#1A1A1A]'
              }`}
            >
              Static Posts ({typeCounts.image})
            </button>
            <button
              onClick={() => setOnlyMediaType('carousel')}
              className={`px-3 py-1.5 text-[10px] font-sans font-bold uppercase tracking-wider transition-all cursor-pointer border ${
                enabledMediaTypes.size === 1 && enabledMediaTypes.has('carousel')
                  ? 'bg-indigo-900 text-white border-indigo-900'
                  : 'bg-[#FBF9F6] text-[#1A1A1A]/70 border-[#1A1A1A]/15 hover:border-[#1A1A1A]'
              }`}
            >
              Carousels ({typeCounts.carousel})
            </button>
          </div>
        </div>

        {/* Media Type Interactive Visibility Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* 1. Reels & Videos Toggle Card */}
          <div
            onClick={() => toggleMediaTypeVisibility('video')}
            className={`p-4 border transition-all cursor-pointer relative flex flex-col justify-between ${
              enabledMediaTypes.has('video')
                ? 'bg-[#1A1A1A] text-white border-[#1A1A1A] shadow-md ring-1 ring-[#FF6321]/40'
                : 'bg-gray-50 text-gray-400 border-gray-200 hover:border-gray-300'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-none ${enabledMediaTypes.has('video') ? 'bg-[#FF6321] text-white' : 'bg-gray-200 text-gray-500'}`}>
                    <Play className="w-4 h-4 fill-current" />
                  </div>
                  <span className="text-xs font-sans font-bold uppercase tracking-wider">
                    Reels & Videos
                  </span>
                </div>
                
                <div className={`w-9 h-5 flex items-center p-0.5 transition-colors ${
                  enabledMediaTypes.has('video') ? 'bg-[#FF6321] justify-end' : 'bg-gray-300 justify-start'
                }`}>
                  <div className="w-4 h-4 bg-white shadow-sm" />
                </div>
              </div>

              <p className={`text-[11px] leading-relaxed ${enabledMediaTypes.has('video') ? 'text-white/80' : 'text-gray-400'}`}>
                Short-form video clips, Reels, and MP4 video posts.
              </p>
            </div>

            <div className="mt-3 pt-2 border-t border-current/10 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
              <span>{typeCounts.video} Items</span>
              <span className={enabledMediaTypes.has('video') ? 'text-[#FF6321]' : 'text-gray-400'}>
                {enabledMediaTypes.has('video') ? '✓ Visible' : '✕ Hidden'}
              </span>
            </div>
          </div>

          {/* 2. Instagram Stories Toggle Card */}
          <div
            onClick={() => toggleMediaTypeVisibility('story')}
            className={`p-4 border transition-all cursor-pointer relative flex flex-col justify-between ${
              enabledMediaTypes.has('story')
                ? 'bg-[#1A1A1A] text-white border-[#1A1A1A] shadow-md ring-1 ring-amber-500/40'
                : 'bg-gray-50 text-gray-400 border-gray-200 hover:border-gray-300'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-none ${enabledMediaTypes.has('story') ? 'bg-gradient-to-r from-amber-500 to-rose-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                    <Camera className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-sans font-bold uppercase tracking-wider">
                    Instagram Stories
                  </span>
                </div>

                <div className={`w-9 h-5 flex items-center p-0.5 transition-colors ${
                  enabledMediaTypes.has('story') ? 'bg-amber-500 justify-end' : 'bg-gray-300 justify-start'
                }`}>
                  <div className="w-4 h-4 bg-white shadow-sm" />
                </div>
              </div>

              <p className={`text-[11px] leading-relaxed ${enabledMediaTypes.has('story') ? 'text-white/80' : 'text-gray-400'}`}>
                Ephemeral 24-hour Story clips, photos, and highlights.
              </p>
            </div>

            <div className="mt-3 pt-2 border-t border-current/10 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
              <span>{typeCounts.story} Items</span>
              <span className={enabledMediaTypes.has('story') ? 'text-amber-400' : 'text-gray-400'}>
                {enabledMediaTypes.has('story') ? '✓ Visible' : '✕ Hidden'}
              </span>
            </div>
          </div>

          {/* 3. Static Posts Toggle Card */}
          <div
            onClick={() => toggleMediaTypeVisibility('image')}
            className={`p-4 border transition-all cursor-pointer relative flex flex-col justify-between ${
              enabledMediaTypes.has('image')
                ? 'bg-[#1A1A1A] text-white border-[#1A1A1A] shadow-md ring-1 ring-emerald-500/40'
                : 'bg-gray-50 text-gray-400 border-gray-200 hover:border-gray-300'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-none ${enabledMediaTypes.has('image') ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                    <Image className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-sans font-bold uppercase tracking-wider">
                    Static Posts
                  </span>
                </div>

                <div className={`w-9 h-5 flex items-center p-0.5 transition-colors ${
                  enabledMediaTypes.has('image') ? 'bg-emerald-600 justify-end' : 'bg-gray-300 justify-start'
                }`}>
                  <div className="w-4 h-4 bg-white shadow-sm" />
                </div>
              </div>

              <p className={`text-[11px] leading-relaxed ${enabledMediaTypes.has('image') ? 'text-white/80' : 'text-gray-400'}`}>
                Single photograph posts and high-res static images.
              </p>
            </div>

            <div className="mt-3 pt-2 border-t border-current/10 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
              <span>{typeCounts.image} Items</span>
              <span className={enabledMediaTypes.has('image') ? 'text-emerald-400' : 'text-gray-400'}>
                {enabledMediaTypes.has('image') ? '✓ Visible' : '✕ Hidden'}
              </span>
            </div>
          </div>

          {/* 4. Carousels Toggle Card */}
          <div
            onClick={() => toggleMediaTypeVisibility('carousel')}
            className={`p-4 border transition-all cursor-pointer relative flex flex-col justify-between ${
              enabledMediaTypes.has('carousel')
                ? 'bg-[#1A1A1A] text-white border-[#1A1A1A] shadow-md ring-1 ring-indigo-500/40'
                : 'bg-gray-50 text-gray-400 border-gray-200 hover:border-gray-300'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-none ${enabledMediaTypes.has('carousel') ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                    <Layers className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-sans font-bold uppercase tracking-wider">
                    Carousels
                  </span>
                </div>

                <div className={`w-9 h-5 flex items-center p-0.5 transition-colors ${
                  enabledMediaTypes.has('carousel') ? 'bg-indigo-600 justify-end' : 'bg-gray-300 justify-start'
                }`}>
                  <div className="w-4 h-4 bg-white shadow-sm" />
                </div>
              </div>

              <p className={`text-[11px] leading-relaxed ${enabledMediaTypes.has('carousel') ? 'text-white/80' : 'text-gray-400'}`}>
                Multi-media album posts & multi-photo gallery feeds.
              </p>
            </div>

            <div className="mt-3 pt-2 border-t border-current/10 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
              <span>{typeCounts.carousel} Items</span>
              <span className={enabledMediaTypes.has('carousel') ? 'text-indigo-300' : 'text-gray-400'}>
                {enabledMediaTypes.has('carousel') ? '✓ Visible' : '✕ Hidden'}
              </span>
            </div>
          </div>

        </div>

        {/* Live Search & Filter Notice Bar */}
        <div className="pt-3 border-t border-[#1A1A1A]/10 flex flex-col sm:flex-row items-center justify-between gap-3">
          
          {/* Keyword Search Input */}
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-[#1A1A1A]/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={streamSearchQuery}
              onChange={(e) => setStreamSearchQuery(e.target.value)}
              placeholder="Search stream by caption keywords, @handles, or shortcodes..."
              className="w-full pl-10 pr-8 py-2 bg-[#FBF9F6] border border-[#1A1A1A]/20 text-xs font-mono focus:outline-none focus:border-[#1A1A1A]"
            />
            {streamSearchQuery && (
              <button
                onClick={() => setStreamSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#1A1A1A]/40 hover:text-[#1A1A1A] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Visibility Banner / Notice */}
          <div className="text-xs font-sans text-[#1A1A1A]/70 flex items-center gap-2 shrink-0">
            {hiddenCount > 0 ? (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-bold">
                <EyeOff className="w-3.5 h-3.5 text-amber-600" />
                <span>{hiddenCount} item{hiddenCount > 1 ? 's' : ''} hidden by active filters</span>
                <button
                  onClick={enableAllMediaTypes}
                  className="ml-1 text-[#FF6321] hover:underline cursor-pointer uppercase text-[10px]"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-emerald-700 text-[11px] font-bold">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                <span>All {totalStreamCount} stream items currently visible</span>
              </div>
            )}
          </div>

        </div>

      </div>

      {/* Control Actions & Global Export Bar */}
      <div className="bg-[#FBF9F6] border border-[#1A1A1A]/10 p-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-sans font-bold uppercase tracking-[0.2em] text-[#1A1A1A]/60 mr-2">Quick Select:</span>
          <button
            onClick={enableAllMediaTypes}
            className="px-3 py-1.5 bg-white border border-[#1A1A1A]/10 text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white text-[10px] font-sans uppercase font-bold tracking-wider transition-all cursor-pointer"
          >
            All Stream ({realtime.mediaItems.length})
          </button>
          <button
            onClick={() => handleSelectByType('video')}
            className="px-3 py-1.5 bg-white border border-[#1A1A1A]/10 text-[#FF6321] hover:bg-[#FF6321] hover:text-white text-[10px] font-sans uppercase font-bold tracking-wider transition-all cursor-pointer"
          >
            Select Reels ({typeCounts.video})
          </button>
          <button
            onClick={() => handleSelectByType('story')}
            className="px-3 py-1.5 bg-white border border-[#1A1A1A]/10 text-amber-700 hover:bg-amber-600 hover:text-white text-[10px] font-sans uppercase font-bold tracking-wider transition-all cursor-pointer"
          >
            Select Stories ({typeCounts.story})
          </button>
          <button
            onClick={() => handleSelectByType('image')}
            className="px-3 py-1.5 bg-white border border-[#1A1A1A]/10 text-emerald-800 hover:bg-emerald-700 hover:text-white text-[10px] font-sans uppercase font-bold tracking-wider transition-all cursor-pointer"
          >
            Select Photos ({typeCounts.image})
          </button>
          <button
            onClick={() => handleSelectByType('carousel')}
            className="px-3 py-1.5 bg-white border border-[#1A1A1A]/10 text-indigo-900 hover:bg-indigo-900 hover:text-white text-[10px] font-sans uppercase font-bold tracking-wider transition-all cursor-pointer"
          >
            Select Carousels ({typeCounts.carousel})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleBulkExportJson}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-[#1A1A1A]/20 hover:border-[#1A1A1A] text-[#1A1A1A] text-[10px] font-sans uppercase tracking-[0.15em] font-bold transition-all cursor-pointer"
          >
            <FileCode className="w-3.5 h-3.5 text-[#FF6321]" /> JSON Export
          </button>

          <button
            onClick={handleBulkExportCsv}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-[#1A1A1A]/20 hover:border-[#1A1A1A] text-[#1A1A1A] text-[10px] font-sans uppercase tracking-[0.15em] font-bold transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> CSV Captions
          </button>

          <button
            onClick={onDownloadZip}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#1A1A1A] text-white hover:bg-black text-[10px] font-sans uppercase tracking-[0.15em] font-bold transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#FF6321]" /> Extension ZIP
          </button>

          <button
            onClick={() => setShowLogs(!showLogs)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#1A1A1A]/10 text-[#1A1A1A]/60 hover:text-[#1A1A1A] text-[10px] font-sans uppercase tracking-[0.15em] font-bold transition-all cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5" /> {showLogs ? 'Hide Logs' : 'Show Logs'}
          </button>
        </div>
      </div>

      {/* Real-time Stream Terminal Logs */}
      {showLogs && (
        <div className="bg-[#111111] border border-[#1A1A1A]/20 p-5 rounded-none font-mono text-xs text-[#F5F2ED] space-y-2 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between pb-2 border-b border-white/10 text-[10px] uppercase tracking-widest text-white/40">
            <span className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-[#FF6321]" /> Extension Network & Interceptor Feed Logs
            </span>
            <span>{realtime.logs.length} events logged</span>
          </div>
          {realtime.logs.map(log => (
            <div key={log.id} className="flex items-start gap-3 text-[11px] leading-relaxed">
              <span className="text-white/30 shrink-0">[{log.time}]</span>
              <span className={
                log.type === 'success' ? 'text-green-400' :
                log.type === 'warn' ? 'text-amber-400' :
                log.type === 'error' ? 'text-rose-400' : 'text-[#F5F2ED]/80'
              }>
                {log.text}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* --- BULK ACTION TOOLBAR --- */}
      <div className="space-y-4">
        
        {/* Bulk Action Header Bar */}
        <div className={`p-4 transition-all border ${
          isSomeSelected 
            ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white shadow-lg' 
            : 'bg-white border-[#1A1A1A]/10 text-[#1A1A1A]'
        }`}>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            
            {/* Left Selection Controls */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleSelectAllFiltered}
                className={`flex items-center gap-2 px-3 py-1.5 text-[11px] font-sans font-bold uppercase tracking-[0.15em] border transition-all cursor-pointer ${
                  isSomeSelected
                    ? 'bg-white/10 hover:bg-white/20 border-white/20 text-white'
                    : 'bg-[#FBF9F6] hover:bg-[#1A1A1A] hover:text-white border-[#1A1A1A]/20 text-[#1A1A1A]'
                }`}
              >
                <div className={`w-4 h-4 border flex items-center justify-center ${
                  isAllSelected ? 'bg-[#FF6321] border-[#FF6321] text-white' : 'border-current'
                }`}>
                  {isAllSelected && <Check className="w-3 h-3 stroke-[3]" />}
                </div>
                <span>
                  {isAllSelected ? 'Deselect All' : `Select All (${filteredItems.length})`}
                </span>
              </button>

              {isSomeSelected && (
                <>
                  <span className="px-2.5 py-1 bg-[#FF6321] text-white text-[10px] font-sans font-bold uppercase tracking-widest">
                    {selectedIds.size} Selected
                  </span>

                  <button
                    onClick={handleClearSelection}
                    className="text-[10px] font-sans uppercase tracking-widest underline text-white/70 hover:text-white cursor-pointer ml-1"
                  >
                    Clear Selection
                  </button>
                </>
              )}

              {!isSomeSelected && (
                <div className="hidden sm:flex items-center gap-1 text-[10px] font-sans text-[#1A1A1A]/50 uppercase tracking-wider ml-2">
                  <span>Quick Select:</span>
                  <button onClick={() => handleSelectByType('video')} className="px-2 py-0.5 hover:bg-[#1A1A1A]/5 cursor-pointer font-bold">Videos</button>
                  <span>•</span>
                  <button onClick={() => handleSelectByType('image')} className="px-2 py-0.5 hover:bg-[#1A1A1A]/5 cursor-pointer font-bold">Images</button>
                  <span>•</span>
                  <button onClick={() => handleSelectByType('carousel')} className="px-2 py-0.5 hover:bg-[#1A1A1A]/5 cursor-pointer font-bold">Carousels</button>
                </div>
              )}
            </div>

            {/* Right Action Operations */}
            <div className="flex flex-wrap items-center gap-2">
              
              {/* Delete Selected */}
              <button
                onClick={handleBulkDelete}
                disabled={!isSomeSelected}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-[10px] font-sans uppercase tracking-[0.15em] font-bold border transition-all cursor-pointer ${
                  isSomeSelected
                    ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600 shadow-sm'
                    : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                }`}
                title="Delete selected items from live stream"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete {isSomeSelected ? `(${selectedIds.size})` : ''}</span>
              </button>

              {/* CRM Deduplication & Duplicate Finder Button */}
              <button
                onClick={handleScanDuplicates}
                disabled={realtime.mediaItems.length === 0}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-[10px] font-sans uppercase tracking-[0.15em] font-bold border transition-all cursor-pointer ${
                  isSomeSelected
                    ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500 shadow-sm'
                    : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                }`}
                title="Scan CRM stream for duplicate videos & posts"
              >
                <CopyX className="w-3.5 h-3.5 text-amber-600" />
                <span>Find & Delete Duplicates</span>
              </button>

              {/* Download Selected ZIP */}
              <button
                onClick={handleBulkDownloadZip}
                disabled={!isSomeSelected && filteredItems.length === 0}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-[10px] font-sans uppercase tracking-[0.15em] font-bold border transition-all cursor-pointer ${
                  isSomeSelected
                    ? 'bg-[#FF6321] hover:bg-[#e05316] text-white border-[#FF6321] shadow-sm'
                    : 'bg-white text-[#1A1A1A] border-[#1A1A1A]/20 hover:border-[#1A1A1A]'
                }`}
                title="Package selected items into a formatted ZIP archive"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>{isZippingSelected ? 'Zipping...' : `Download ZIP ${isSomeSelected ? `(${selectedIds.size})` : ''}`}</span>
              </button>

              {/* Export Dropdown Group */}
              <div className="flex items-center border border-white/20 bg-white/10 rounded-none overflow-hidden">
                <button
                  onClick={handleBulkExportJson}
                  disabled={!isSomeSelected && filteredItems.length === 0}
                  className={`flex items-center gap-1 px-3 py-2 text-[10px] font-sans uppercase tracking-[0.15em] font-bold transition-all cursor-pointer ${
                    isSomeSelected
                      ? 'text-white hover:bg-white/20'
                      : 'text-[#1A1A1A] hover:bg-[#1A1A1A]/5 border border-[#1A1A1A]/20'
                  }`}
                  title="Export selected as JSON"
                >
                  <FileCode className="w-3 h-3 text-[#FF6321]" />
                  <span>JSON</span>
                </button>

                <button
                  onClick={handleBulkExportCsv}
                  disabled={!isSomeSelected && filteredItems.length === 0}
                  className={`flex items-center gap-1 px-3 py-2 text-[10px] font-sans uppercase tracking-[0.15em] font-bold transition-all cursor-pointer border-l ${
                    isSomeSelected
                      ? 'text-white hover:bg-white/20 border-white/20'
                      : 'text-[#1A1A1A] hover:bg-[#1A1A1A]/5 border-[#1A1A1A]/20'
                  }`}
                  title="Export selected as CSV captions"
                >
                  <Download className="w-3 h-3" />
                  <span>CSV</span>
                </button>

                <button
                  onClick={handleBulkExportTxt}
                  disabled={!isSomeSelected && filteredItems.length === 0}
                  className={`flex items-center gap-1 px-3 py-2 text-[10px] font-sans uppercase tracking-[0.15em] font-bold transition-all cursor-pointer border-l ${
                    isSomeSelected
                      ? 'text-white hover:bg-white/20 border-white/20'
                      : 'text-[#1A1A1A] hover:bg-[#1A1A1A]/5 border-[#1A1A1A]/20'
                  }`}
                  title="Export selected as TXT summary"
                >
                  <FileText className="w-3 h-3" />
                  <span>TXT</span>
                </button>
              </div>

            </div>
          </div>

          {/* Inline Bulk Export Progress Bar for Toolbar */}
          {zipProgressStatus && (
            <div className="p-3 bg-[#1A1A1A] text-white border-l-4 border-[#FF6321] space-y-2 shadow-md animate-in fade-in">
              <div className="flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#FF6321]" />
                  <span className="font-bold text-amber-300">Bulk ZIP Progress:</span>
                  <span className="text-white/90">{zipProgressStatus}</span>
                </div>
                <span className="font-bold text-[#FF6321] text-xs font-mono">{zipProgressPercent}%</span>
              </div>
              <div className="w-full bg-white/20 h-2 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-[#FF6321] to-amber-400 h-full transition-all duration-300"
                  style={{ width: `${Math.max(zipProgressPercent, 3)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Streamed Items Grid with Selection Checkboxes */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40">
              Incoming Stream Items ({filteredItems.length})
            </p>
            <button
              onClick={realtime.clearStream}
              className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#FF6321] hover:underline cursor-pointer"
            >
              Clear Stream
            </button>
          </div>

          {filteredItems.length === 0 ? (
            <div className="bg-white border border-[#1A1A1A]/10 p-12 sm:p-16 text-center space-y-6 shadow-sm">
              <div className="w-16 h-16 bg-[#FBF9F6] border border-[#1A1A1A]/15 rounded-full flex items-center justify-center mx-auto text-[#FF6321]">
                <Radio className="w-8 h-8 animate-pulse" />
              </div>
              <div className="max-w-md mx-auto space-y-2">
                <h4 className="text-xl font-serif text-[#1A1A1A]">
                  Real Scraping Feed Empty
                </h4>
                <p className="text-xs text-[#1A1A1A]/60 font-sans leading-relaxed">
                  Automatic fake item streaming is disabled. To capture real posts, reels, or stories, launch a real scraping session on your target profile using the Chrome Extension or load sample data for UI testing.
                </p>
              </div>

              {/* Action Buttons inside Empty Feed State */}
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    realtime.launchRealScrape(realtime.targetUsername, realtime.targetMediaType, activePlatform);
                  }}
                  className={`px-6 py-3 font-sans text-xs font-bold uppercase tracking-[0.15em] flex items-center gap-2 transition-all shadow-md cursor-pointer text-white ${
                    activePlatform === 'tiktok' ? 'bg-[#FF0050] hover:bg-[#d00040]' : activePlatform === 'facebook' ? 'bg-[#1877F2] hover:bg-[#115cc4]' : 'bg-[#FF6321] hover:bg-[#e05316]'
                  }`}
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Start Real {activePlatform.toUpperCase()} Scrape @{realtime.targetUsername || 'cats_of_instagram'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => realtime.loadDemoData(activePlatform)}
                  className="px-5 py-3 bg-[#1A1A1A] hover:bg-black text-white font-sans text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-sm cursor-pointer"
                >
                  <Play className="w-4 h-4 text-amber-400" />
                  <span>Load {activePlatform.toUpperCase()} Demo Data (UI Test)</span>
                </button>

                <button
                  type="button"
                  onClick={realtime.toggleSimulator}
                  className={`px-4 py-3 font-sans text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer border ${
                    realtime.simulatorActive
                      ? 'bg-amber-500 text-white border-amber-600'
                      : 'bg-[#FBF9F6] text-[#1A1A1A]/70 border-[#1A1A1A]/20 hover:border-[#1A1A1A]'
                  }`}
                >
                  <Activity className="w-4 h-4 text-[#FF6321]" />
                  <span>Simulated Feed: {realtime.simulatorActive ? 'ON' : 'OFF'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {filteredItems.map(item => {
                const isSelected = selectedIds.has(item.id);

                return (
                  <div
                    key={item.id}
                    className={`bg-white border transition-all overflow-hidden group shadow-sm flex flex-col justify-between relative ${
                      isSelected
                        ? 'border-[#FF6321] ring-2 ring-[#FF6321]/30 bg-[#FF6321]/5'
                        : 'border-[#1A1A1A]/10 hover:border-[#1A1A1A]/40'
                    }`}
                  >
                    
                    {/* Checkbox Selector Badge Overlay */}
                    <div className="absolute top-3 right-3 z-20">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectItem(item.id);
                        }}
                        className={`w-7 h-7 flex items-center justify-center border shadow-md transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#FF6321] border-[#FF6321] text-white'
                            : 'bg-white/90 hover:bg-white border-[#1A1A1A]/30 text-[#1A1A1A]'
                        }`}
                        title={isSelected ? 'Deselect item' : 'Select item'}
                      >
                        {isSelected ? (
                          <Check className="w-4 h-4 stroke-[3]" />
                        ) : (
                          <div className="w-3.5 h-3.5 border border-[#1A1A1A]/40" />
                        )}
                      </button>
                    </div>

                    <div>
                      {/* Media Image Preview Container */}
                      <div 
                        onClick={() => setPreviewItem(item)}
                        className="aspect-[3/4] bg-[#FBF9F6] relative overflow-hidden border-b border-[#1A1A1A]/10 cursor-pointer group/thumb"
                      >
                        <img
                          src={item.thumbnailUrl || item.mediaUrl}
                          alt={item.caption || 'Media item'}
                          className={`w-full h-full object-cover transition-all duration-300 ${
                            isSelected ? 'scale-105 opacity-90' : 'group-hover/thumb:scale-105'
                          }`}
                          loading="lazy"
                        />
                        
                        {/* Hover Overlay with Preview Trigger or Validating Badge */}
                        {validatingItemId === item.id ? (
                          <div className="absolute inset-0 bg-cyan-950/90 z-30 flex flex-col items-center justify-center p-3 text-center space-y-2 text-white animate-pulse">
                            <RefreshCw className="w-6 h-6 animate-spin text-cyan-400 shrink-0" />
                            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-cyan-300">
                              Validating Media...
                            </span>
                            <p className="text-[9px] text-cyan-200/80 font-sans leading-tight">
                              Confirming target URL is a playable MP4 file before download
                            </p>
                          </div>
                        ) : (
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="px-3 py-1.5 bg-[#FF6321] text-white text-xs font-sans font-bold uppercase tracking-wider rounded shadow-lg flex items-center gap-1.5">
                              <Eye className="w-3.5 h-3.5" /> Preview Media
                            </span>
                          </div>
                        )}

                        <div className={`absolute top-3 left-3 px-2.5 py-1 text-[9px] font-sans font-bold uppercase tracking-widest shadow-md flex items-center gap-1.5 ${
                          item.type === 'video' ? 'bg-[#FF6321] text-white' :
                          item.type === 'story' ? 'bg-gradient-to-r from-amber-500 to-rose-500 text-white' :
                          item.type === 'carousel' ? 'bg-indigo-900 text-white' :
                          'bg-[#1A1A1A] text-white'
                        }`}>
                          {item.type === 'video' && <Play className="w-3 h-3 fill-current" />}
                          {item.type === 'story' && <Camera className="w-3 h-3" />}
                          {item.type === 'image' && <Image className="w-3 h-3" />}
                          {item.type === 'carousel' && <Layers className="w-3 h-3" />}
                          <span>{item.type === 'video' ? 'Reel' : item.type === 'story' ? '24h Story' : item.type}</span>
                        </div>

                        {item.viewCount ? (
                          <div className="absolute bottom-3 right-3 bg-black/80 text-white backdrop-blur px-2 py-0.5 text-[9px] font-mono">
                            {(item.viewCount / 1000).toFixed(1)}k views
                          </div>
                        ) : null}
                      </div>

                      {/* Content Info */}
                      <div className="p-4 space-y-2">
                        <div className="flex items-center justify-between text-[10px] font-sans font-bold text-[#1A1A1A]/50">
                          <span>@{item.username || 'user'}</span>
                          <span>{item.publishedFormatted || 'Live'}</span>
                        </div>

                        <p className="text-xs font-serif italic text-[#1A1A1A] line-clamp-2 leading-relaxed">
                          "{item.caption || 'No caption text provided'}"
                        </p>
                      </div>
                    </div>

                    {/* Card Action Footer */}
                    <div className="p-4 pt-2 border-t border-[#1A1A1A]/5 mt-2 flex items-center justify-between bg-gray-50/50">
                      <div className="text-[10px] font-sans text-[#1A1A1A]/60 gap-3 flex">
                        <span>❤️ {item.likeCount ? item.likeCount.toLocaleString() : 0}</span>
                        <span>💬 {item.commentCount ? item.commentCount.toLocaleString() : 0}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setPreviewItem(item)}
                          className="p-1 hover:bg-[#FF6321]/10 text-[#FF6321] transition-colors"
                          title="Interactive Media Preview"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => handleDirectMediaDownload(item)}
                          disabled={validatingItemId === item.id}
                          className="p-1 hover:bg-[#1A1A1A]/10 text-[#1A1A1A] transition-colors disabled:opacity-50"
                          title="Download media"
                        >
                          {validatingItemId === item.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-600" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <button
                          onClick={() => realtime.deleteItems([item.id])}
                          className="p-1 hover:bg-rose-100 text-rose-600 transition-colors"
                          title="Delete item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>

                        <a
                          href={item.sourceUrl || item.mediaUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-1 bg-[#1A1A1A] hover:bg-black text-white text-[10px] font-sans font-bold uppercase tracking-wider flex items-center gap-1 transition-colors rounded shadow-sm"
                          title="Watch original video / reel in new tab"
                        >
                          <span>Open Video</span>
                          <ArrowUpRight className="w-3.5 h-3.5 text-[#FF6321]" />
                        </a>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* --- ARCHITECTURE EXPLANATION MODAL --- */}
      {showArchModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#1A1A1A] max-w-2xl w-full p-6 sm:p-8 shadow-2xl relative font-sans space-y-6 animate-in fade-in zoom-in-95">
            <button
              onClick={() => setShowArchModal(false)}
              className="absolute top-4 right-4 p-2 text-[#1A1A1A]/60 hover:text-[#1A1A1A] hover:bg-gray-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <span className="px-2.5 py-1 bg-[#FF6321] text-white text-[9px] font-bold uppercase tracking-[0.2em]">
                Scraping Architecture & Session Explained
              </span>
              <h3 className="text-2xl font-serif text-[#1A1A1A] mt-2">
                How Instagram Scraping Works (Without Extension vs. With Real Session)
              </h3>
            </div>

            <div className="space-y-4 text-xs leading-relaxed text-[#1A1A1A]/80">
              
              {/* Method 1: Public URL / No Login */}
              <div className="bg-[#FBF9F6] p-4 border border-[#1A1A1A]/10 space-y-2">
                <div className="flex items-center gap-2 text-[#1A1A1A] font-bold">
                  <Globe className="w-4 h-4 text-[#FF6321]" />
                  <span>1. Direct Link Extraction (No Extension & No Logged-In Session)</span>
                </div>
                <p>
                  When you provide a direct link (such as <code className="bg-white px-1 py-0.5 font-mono text-[#FF6321]">https://www.instagram.com/p/DbxxjezIddE/</code>):
                </p>
                <ul className="list-disc pl-5 space-y-1 text-[#1A1A1A]/70">
                  <li><strong>Public oEmbed API:</strong> Instagram exposes a lightweight oEmbed endpoint (<code className="font-mono text-[10px]">/oembed/?url=...</code>) that returns public thumbnail, author, and embed HTML without session cookies.</li>
                  <li><strong>Document JSON-LD Script Tags:</strong> Public Instagram post pages embed structured JSON data inside <code className="font-mono text-[10px]">&lt;script type="application/ld+json"&gt;</code> tags containing caption text, publication timestamps, and media URLs.</li>
                  <li><strong>Limitations:</strong> Instagram strictly rate-limits anonymous server IPs and blocks automated batch scrolling beyond 1–2 posts without an authenticated user session.</li>
                </ul>
              </div>

              {/* Method 2: Real Chrome Extension */}
              <div className="bg-[#1A1A1A] text-white p-4 space-y-2">
                <div className="flex items-center gap-2 text-white font-bold">
                  <ShieldCheck className="w-4 h-4 text-[#FF6321]" />
                  <span>2. Unpacked Chrome Extension Bridge (Real Logged-in Session)</span>
                </div>
                <p className="text-white/80">
                  When you use our Chrome Extension on an open Instagram profile:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-white/70">
                  <li><strong>Active Session Reuse:</strong> The extension runs inside your browser tab where you are already logged into Instagram, utilizing your native session cookies naturally.</li>
                  <li><strong>Network Request Interception:</strong> It hooks directly into <code className="font-mono text-[10px] text-[#FF6321]">window.fetch</code> and <code className="font-mono text-[10px] text-[#FF6321]">XMLHttpRequest</code> to intercept live JSON payloads (<code className="font-mono text-[10px]">/api/v1/feed/user/...</code>) as Instagram loads them.</li>
                  <li><strong>Real-Time Broadcast:</strong> Captured posts, Reels, and Carousels are streamed instantly into this web application via <code className="font-mono text-[10px] text-[#FF6321]">BroadcastChannel</code> and <code className="font-mono text-[10px] text-[#FF6321]">postMessage</code>.</li>
                </ul>
              </div>

            </div>

            <div className="pt-4 border-t border-[#1A1A1A]/10 flex justify-end">
              <button
                onClick={() => setShowArchModal(false)}
                className="px-6 py-2.5 bg-[#1A1A1A] text-white text-xs font-sans font-bold uppercase tracking-wider hover:bg-black transition-all cursor-pointer"
              >
                Got It, Close Explanation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- CONSOLIDATED BULK EXPORT ZIP MODAL --- */}
      {showBulkExportModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#1A1A1A] max-w-2xl w-full p-6 sm:p-8 shadow-2xl relative font-sans space-y-6 animate-in fade-in zoom-in-95">
            <button
              onClick={() => setShowBulkExportModal(false)}
              className="absolute top-4 right-4 p-2 text-[#1A1A1A]/60 hover:text-[#1A1A1A] hover:bg-gray-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header */}
            <div className="border-b border-[#1A1A1A]/10 pb-4">
              <span className="px-2.5 py-1 bg-[#1A1A1A] text-white text-[9px] font-bold uppercase tracking-[0.2em] inline-flex items-center gap-1.5">
                <Archive className="w-3 h-3 text-[#FF6321]" />
                Bulk ZIP Export Center
              </span>
              <h3 className="text-2xl font-serif text-[#1A1A1A] mt-2">
                Consolidated Media & Metadata Exporter
              </h3>
              <p className="text-xs text-[#1A1A1A]/70 font-sans mt-1">
                Package selected cached Instagram posts, Reels, Stories, and gallery assets into a clean ZIP archive with organized subfolders.
              </p>
            </div>

            {/* Scope Summary */}
            <div className="bg-[#FBF9F6] border border-[#1A1A1A]/10 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#1A1A1A]">
                <span>Scope: {selectedItems.length > 0 ? `${selectedItems.length} Selected Items` : `${filteredItems.length} Visible Stream Items`}</span>
                <span className="text-[#FF6321]">@{realtime.profileUsername || 'instagram'}</span>
              </div>

              {/* Media type count breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-sans">
                <div className="bg-white p-2.5 border border-[#1A1A1A]/10 flex items-center justify-between">
                  <span className="text-gray-500 font-bold">Reels & Videos:</span>
                  <span className="font-bold text-[#FF6321]">
                    {(selectedItems.length > 0 ? selectedItems : filteredItems).filter(i => i.type === 'video').length}
                  </span>
                </div>
                <div className="bg-white p-2.5 border border-[#1A1A1A]/10 flex items-center justify-between">
                  <span className="text-gray-500 font-bold">24h Stories:</span>
                  <span className="font-bold text-amber-600">
                    {(selectedItems.length > 0 ? selectedItems : filteredItems).filter(i => i.type === 'story').length}
                  </span>
                </div>
                <div className="bg-white p-2.5 border border-[#1A1A1A]/10 flex items-center justify-between">
                  <span className="text-gray-500 font-bold">Photos:</span>
                  <span className="font-bold text-emerald-700">
                    {(selectedItems.length > 0 ? selectedItems : filteredItems).filter(i => i.type === 'image').length}
                  </span>
                </div>
                <div className="bg-white p-2.5 border border-[#1A1A1A]/10 flex items-center justify-between">
                  <span className="text-gray-500 font-bold">Carousels:</span>
                  <span className="font-bold text-indigo-900">
                    {(selectedItems.length > 0 ? selectedItems : filteredItems).filter(i => i.type === 'carousel').length}
                  </span>
                </div>
              </div>
            </div>

            {/* Config Checkboxes */}
            <div className="space-y-3">
              <h4 className="text-xs font-sans uppercase font-bold tracking-wider text-[#1A1A1A]/70">
                Configure Export Contents:
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-sans">
                <label className="flex items-center gap-3 p-3 bg-white border border-[#1A1A1A]/10 cursor-pointer hover:border-[#1A1A1A]/30">
                  <input
                    type="checkbox"
                    checked={exportIncludeMedia}
                    onChange={(e) => setExportIncludeMedia(e.target.checked)}
                    className="w-4 h-4 accent-[#FF6321]"
                  />
                  <div>
                    <span className="font-bold text-[#1A1A1A]">Media Binaries (.mp4 / .jpg)</span>
                    <p className="text-[10px] text-gray-500">Includes videos, stories, and images</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 bg-white border border-[#1A1A1A]/10 cursor-pointer hover:border-[#1A1A1A]/30">
                  <input
                    type="checkbox"
                    checked={exportCleanWatermarks}
                    onChange={(e) => setExportCleanWatermarks(e.target.checked)}
                    className="w-4 h-4 accent-[#FF6321]"
                  />
                  <div>
                    <span className="font-bold text-[#1A1A1A]">Watermark & Overlay Removal</span>
                    <p className="text-[10px] text-gray-500">Strips video logo badges & overlays</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 bg-white border border-[#1A1A1A]/10 cursor-pointer hover:border-[#1A1A1A]/30">
                  <input
                    type="checkbox"
                    checked={exportIncludeMetadata}
                    onChange={(e) => setExportIncludeMetadata(e.target.checked)}
                    className="w-4 h-4 accent-[#FF6321]"
                  />
                  <div>
                    <span className="font-bold text-[#1A1A1A]">JSON Dataset</span>
                    <p className="text-[10px] text-gray-500">Full post raw data (metadata.json)</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 bg-white border border-[#1A1A1A]/10 cursor-pointer hover:border-[#1A1A1A]/30">
                  <input
                    type="checkbox"
                    checked={exportIncludeCsv}
                    onChange={(e) => setExportIncludeCsv(e.target.checked)}
                    className="w-4 h-4 accent-[#FF6321]"
                  />
                  <div>
                    <span className="font-bold text-[#1A1A1A]">CSV Spreadsheet</span>
                    <p className="text-[10px] text-gray-500">Table view for Excel (posts_table.csv)</p>
                  </div>
                </label>
              </div>
            </div>

            {/* Progress indicator */}
            {isZippingSelected && (
              <div className="space-y-2 p-4 bg-[#1A1A1A] text-white">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="flex items-center gap-2 text-[#FF6321]">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Packaging Consolidated ZIP...
                  </span>
                  <span>{zipProgressPercent}%</span>
                </div>
                <div className="w-full bg-white/20 h-2 rounded-none overflow-hidden">
                  <div
                    className="bg-[#FF6321] h-full transition-all duration-300"
                    style={{ width: `${zipProgressPercent}%` }}
                  />
                </div>
                <p className="text-[10px] font-mono text-white/70 truncate">
                  {zipProgressStatus}
                </p>
              </div>
            )}

            {/* Modal Action Buttons */}
            <div className="pt-4 border-t border-[#1A1A1A]/10 flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-[11px] text-[#1A1A1A]/50 font-sans">
                Organizes files into subfolders by media type.
              </span>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setShowBulkExportModal(false)}
                  disabled={isZippingSelected}
                  className="flex-1 sm:flex-initial px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-[#1A1A1A] text-xs font-sans font-bold uppercase tracking-wider transition-all cursor-pointer"
                >
                  Close
                </button>

                <button
                  onClick={async () => {
                    await handleBulkDownloadZip();
                  }}
                  disabled={isZippingSelected || (selectedItems.length === 0 && filteredItems.length === 0)}
                  className="flex-1 sm:flex-initial px-6 py-2.5 bg-[#FF6321] hover:bg-[#e05316] disabled:bg-gray-400 text-white text-xs font-sans font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 shadow-md"
                >
                  <Archive className="w-4 h-4" />
                  <span>{isZippingSelected ? 'Zipping...' : 'Start ZIP Download'}</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* --- STICKY FLOATING BULK EXPORT PROGRESS WIDGET --- */}
      {zipProgressStatus && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full bg-[#1A1A1A] border border-[#FF6321] text-white p-4 shadow-2xl space-y-3 font-sans animate-in slide-in-from-bottom-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-[#FF6321] text-white">
                <Archive className="w-4 h-4" />
              </div>
              <div>
                <h5 className="text-xs font-bold uppercase tracking-wider text-white">
                  Bulk ZIP Generator
                </h5>
                <p className="text-[10px] text-amber-300 font-mono">
                  {isZippingSelected ? 'Processing Archive...' : 'Download Ready!'}
                </p>
              </div>
            </div>
            <span className="text-sm font-mono font-bold text-[#FF6321]">
              {zipProgressPercent}%
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="w-full bg-white/20 h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-[#FF6321] via-amber-400 to-[#FF6321] h-full transition-all duration-300"
                style={{ width: `${Math.max(zipProgressPercent, 3)}%` }}
              />
            </div>
            <p className="text-[11px] font-mono text-white/80 truncate">
              {zipProgressStatus}
            </p>
          </div>
        </div>
      )}

      {/* --- CRM DEDUPLICATION & DUPLICATE CLEANER MODAL --- */}
      {showDedupeModal && dedupeResults && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#1A1A1A] max-w-2xl w-full p-6 sm:p-8 shadow-2xl relative font-sans space-y-6 animate-in fade-in zoom-in-95">
            <button
              onClick={() => setShowDedupeModal(false)}
              className="absolute top-4 right-4 p-2 text-[#1A1A1A]/60 hover:text-[#1A1A1A] hover:bg-gray-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Modal Header */}
            <div className="border-b border-[#1A1A1A]/10 pb-4">
              <span className="px-2.5 py-1 bg-amber-500 text-white text-[9px] font-bold uppercase tracking-[0.2em] inline-flex items-center gap-1.5">
                <CopyX className="w-3.5 h-3.5 text-white" />
                CRM Duplicate Media Cleaner
              </span>
              <h3 className="text-2xl font-serif text-[#1A1A1A] mt-2">
                Duplicate Video & Post Detection Manager
              </h3>
              <p className="text-xs text-[#1A1A1A]/70 font-sans mt-1">
                Scanned all {realtime.mediaItems.length} cached media items in your CRM stream collection.
              </p>
            </div>

            {/* Results Summary */}
            {dedupeResults.totalDuplicates === 0 ? (
              <div className="p-8 bg-emerald-50 border border-emerald-200 text-center space-y-3">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle className="w-6 h-6" />
                </div>
                <h4 className="text-lg font-serif text-emerald-900 font-bold">
                  Clean CRM Stream Collection!
                </h4>
                <p className="text-xs text-emerald-700 max-w-md mx-auto">
                  No duplicate videos, reels, or static posts were found in the stream. All {realtime.mediaItems.length} items are unique.
                </p>
                <button
                  onClick={() => setShowDedupeModal(false)}
                  className="px-5 py-2 bg-emerald-800 text-white text-xs font-bold uppercase tracking-wider cursor-pointer hover:bg-emerald-900"
                >
                  Close Window
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-amber-50 border border-amber-200 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-amber-900 font-sans uppercase tracking-wider">
                      Found {dedupeResults.totalDuplicates} Duplicate Instance(s) across {dedupeResults.duplicateGroups.length} Media Group(s)
                    </p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Purging will keep 1 original copy of each unique post and permanently remove redundant copies.
                    </p>
                  </div>
                  <span className="px-3 py-1 bg-amber-500 text-white text-xs font-mono font-bold">
                    {dedupeResults.totalDuplicates} To Delete
                  </span>
                </div>

                {/* Duplicate Groups Preview List */}
                <div className="max-h-64 overflow-y-auto space-y-3 pr-2">
                  {dedupeResults.duplicateGroups.map((group, idx) => (
                    <div key={group.key || idx} className="p-3 bg-gray-50 border border-gray-200 space-y-2 text-xs">
                      <div className="flex items-center justify-between text-[11px] font-mono font-bold text-[#1A1A1A]">
                        <span className="text-amber-800">
                          Group #{idx + 1}: Key [{group.key.slice(0, 24)}...]
                        </span>
                        <span className="text-gray-500">
                          {group.items.length} Instances
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {group.items.map((item, itemIdx) => (
                          <div
                            key={item.id}
                            className={`p-2 border flex items-center gap-2 ${
                              itemIdx === 0
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                : 'bg-rose-50 border-rose-200 text-rose-900'
                            }`}
                          >
                            <img
                              src={item.thumbnailUrl || item.mediaUrl}
                              alt="Preview"
                              className="w-10 h-10 object-cover border border-black/10 shrink-0"
                            />
                            <div className="min-w-0 flex-1 text-[10px]">
                              <p className="font-bold truncate">@{item.username}</p>
                              <p className="text-gray-500 truncate">{item.caption || 'No caption'}</p>
                              <span className={`font-mono font-bold uppercase tracking-widest text-[9px] ${
                                itemIdx === 0 ? 'text-emerald-700' : 'text-rose-600'
                              }`}>
                                {itemIdx === 0 ? '✓ Keep Original' : '🗑️ Duplicate (Delete)'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Action Buttons */}
                <div className="pt-4 border-t border-gray-200 flex items-center justify-end gap-3">
                  <button
                    onClick={() => setShowDedupeModal(false)}
                    className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold uppercase tracking-wider cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePurgeDuplicates}
                    className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-md cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Purge {dedupeResults.totalDuplicates} Duplicate Video(s)</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- DEDUPLICATION TOAST FEEDBACK --- */}
      {dedupeToast && (
        <div className="fixed top-6 right-6 z-50 bg-amber-500 text-white font-sans text-xs font-bold px-5 py-3.5 shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 border border-amber-600">
          <CheckCircle className="w-5 h-5 text-white" />
          <span>{dedupeToast}</span>
          <button onClick={() => setDedupeToast(null)} className="ml-2 text-white/80 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* --- INTERACTIVE MEDIA PREVIEW MODAL --- */}
      <MediaPreviewModal
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        onDownload={handleDirectMediaDownload}
        isValidating={Boolean(validatingItemId && previewItem && validatingItemId === previewItem.id)}
        validatingStatus={validatingMediaStatus}
      />

      {/* --- POST-DOWNLOAD CLEAR FEED CONFIRMATION MODAL --- */}
      {clearFeedPrompt.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#1A1A1A] border border-[#FF6321]/40 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center space-x-3 border-b border-white/10 pb-4">
              <div className="p-3 bg-[#FF6321]/20 border border-[#FF6321]/40 rounded-xl text-[#FF6321]">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Download Finished 🎉</h3>
                <p className="text-xs text-white/60">Exported {clearFeedPrompt.itemCount} items for {clearFeedPrompt.platform.toUpperCase()}</p>
              </div>
            </div>

            <p className="text-sm text-white/80 leading-relaxed font-sans">
              Download complete ho gaya hai. Kya aap <strong className="text-[#FF6321]">{clearFeedPrompt.platform.toUpperCase()}</strong> ki active feed data ko dashboard app se <strong>clear / delete</strong> karna chahte hain?
            </p>

            <div className="flex items-center justify-end space-x-3 pt-4 border-t border-white/10">
              <button
                onClick={() => setClearFeedPrompt({ isOpen: false, platform: 'instagram', itemCount: 0 })}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-white/70 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
              >
                Nahi, Keep Feed Data
              </button>
              <button
                onClick={() => {
                  realtime.deletePlatformItems(clearFeedPrompt.platform);
                  setClearFeedPrompt({ isOpen: false, platform: 'instagram', itemCount: 0 });
                }}
                className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider bg-rose-600 hover:bg-rose-500 text-white rounded-lg shadow-lg shadow-rose-600/30 transition-all flex items-center space-x-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Haan, Clear Feed</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
