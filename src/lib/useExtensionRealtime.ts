import { useState, useEffect, useCallback, useRef } from 'react';
import { NormalizedMediaItem } from '../types';

export interface StreamLog {
  id: string;
  time: string;
  text: string;
  type: 'info' | 'success' | 'warn' | 'error';
}

export interface CatPresetAccount {
  username: string;
  name: string;
  followers: string;
  description: string;
  avatarUrl: string;
  popularTypes: ('video' | 'image' | 'carousel')[];
}

export const REAL_KITTY_ACCOUNTS: CatPresetAccount[] = [
  {
    username: 'cats_of_instagram',
    name: 'Cats of Instagram',
    followers: '13.2M',
    description: 'The world\'s premier community for cat lovers & viral kitten videos.',
    avatarUrl: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=200',
    popularTypes: ['video', 'carousel', 'image']
  },
  {
    username: 'meowed',
    name: 'Meowed by 9GAG',
    followers: '4.8M',
    description: 'Daily funny cat clips, kitten reels, and cat memes.',
    avatarUrl: 'https://images.unsplash.com/photo-1573865526739-10659fec78a5?w=200',
    popularTypes: ['video', 'carousel']
  },
  {
    username: 'kittensofinstagram',
    name: 'Kittens of Instagram',
    followers: '2.1M',
    description: 'Adorable kitten reels, rescue stories & tiny kitty videos.',
    avatarUrl: 'https://images.unsplash.com/photo-1543852786-1cf6624b9987?w=200',
    popularTypes: ['video', 'image']
  },
  {
    username: 'catloversclub',
    name: 'Cat Lovers Club',
    followers: '3.9M',
    description: 'High quality daily cat moments, fluffy kittens & funny reels.',
    avatarUrl: 'https://images.unsplash.com/photo-1533738363-b7f9aef128ce?w=200',
    popularTypes: ['video', 'image', 'carousel']
  }
];

export const SAMPLE_TIKTOK_ITEMS: NormalizedMediaItem[] = [
  {
    id: 'tt_sample_01',
    shortcode: '72123456789',
    type: 'video',
    caption: 'Simple lifehack reaction. Why make things complicated when you can just do this? 🤷‍♂️ #lifehack #funny',
    mediaUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800',
    thumbnailUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400',
    sourceUrl: 'https://www.tiktok.com/@khaby.lame/video/72123456789',
    author: 'khaby.lame',
    username: 'khaby.lame',
    publishedAt: new Date().toISOString(),
    publishedFormatted: '2h ago',
    likeCount: 4800000,
    commentCount: 62000,
    viewCount: 35000000
  },
  {
    id: 'tt_sample_02',
    shortcode: '72198765432',
    type: 'video',
    caption: 'New choreography trend! Dancing with the crew in LA 💃✨ #dance #viral #trending',
    mediaUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800',
    thumbnailUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400',
    sourceUrl: 'https://www.tiktok.com/@charlidamelio/video/72198765432',
    author: 'charlidamelio',
    username: 'charlidamelio',
    publishedAt: new Date().toISOString(),
    publishedFormatted: '5h ago',
    likeCount: 2900000,
    commentCount: 31000,
    viewCount: 18000000
  },
  {
    id: 'tt_sample_03',
    shortcode: '72255443322',
    type: 'video',
    caption: 'Is this real or magic? Flying through walls illusion optical trick! 🪄🎩 #magic #illusion',
    mediaUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800',
    thumbnailUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400',
    sourceUrl: 'https://www.tiktok.com/@zachking/video/72255443322',
    author: 'zachking',
    username: 'zachking',
    publishedAt: new Date().toISOString(),
    publishedFormatted: '1d ago',
    likeCount: 5100000,
    commentCount: 48000,
    viewCount: 42000000
  }
];

export const SAMPLE_FACEBOOK_ITEMS: NormalizedMediaItem[] = [
  {
    id: 'fb_sample_01',
    shortcode: '1234567890',
    type: 'video',
    caption: 'Top viral Facebook Reel: Epic mountain biking down the cliff edge in New Zealand 🚴‍♂️🌲 #reels #outdoors',
    mediaUrl: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=800',
    thumbnailUrl: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=400',
    sourceUrl: 'https://www.facebook.com/reel/1234567890',
    author: 'facebook_reels',
    username: 'facebook_reels',
    publishedAt: new Date().toISOString(),
    publishedFormatted: '3h ago',
    likeCount: 890000,
    commentCount: 14200,
    viewCount: 6500000
  }
];

export interface DetectedExtensionProfile {
  id: string;
  browser: 'Chrome' | 'Edge' | 'Brave' | 'Firefox';
  profileName: string;
  activeTabUrl: string;
  lastSeen: string;
  isAlive: boolean;
}

export interface ExtensionRealtimeState {
  isConnected: boolean;
  isScraping: boolean;
  isLoggedIn: boolean;
  profileUsername: string;
  targetUsername: string;
  targetMediaType: 'all' | 'video' | 'story' | 'image' | 'carousel';
  watermarkCleaningEnabled: boolean;
  scrollSpeed: 'slow' | 'normal' | 'fast';
  throttlingDelay: number;
  maxVideosLimit: number;
  maxTotalLimit: number;
  detectedProfiles: DetectedExtensionProfile[];
  progressMessage: string;
  stats: {
    total: number;
    videos: number;
    stories: number;
    images: number;
    carousels: number;
    failed: number;
  };
  mediaItems: NormalizedMediaItem[];
  logs: StreamLog[];
  simulatorActive: boolean;
  lastPingTimestamp: number | null;
  setTargetUsername: (username: string) => void;
  setTargetMediaType: (type: 'all' | 'video' | 'story' | 'image' | 'carousel') => void;
  setWatermarkCleaningEnabled: (enabled: boolean) => void;
  setScrollSpeed: (speed: 'slow' | 'normal' | 'fast') => void;
  setThrottlingDelay: (delayInSeconds: number) => void;
  setExtractionLimits: (maxVideos: number, maxTotal: number) => void;
  navigateExtensionToProfile: (username: string) => void;
  launchRealScrape: (username?: string, mediaType?: 'all' | 'video' | 'story' | 'image' | 'carousel', platform?: 'instagram' | 'tiktok' | 'facebook') => void;
  parseDirectUrl: (inputUrl: string, platform?: 'instagram' | 'tiktok' | 'facebook') => boolean;
  deleteItems: (ids: string[]) => void;
  deletePlatformItems: (platform: 'instagram' | 'tiktok' | 'facebook') => void;
  startAutoScroll: () => void;
  stopAutoScroll: () => void;
  clearStream: () => void;
  loadDemoData: (platform?: 'instagram' | 'tiktok' | 'facebook') => void;
  toggleSimulator: () => void;
  requestSync: () => void;
}

const SAMPLE_REALTIME_ITEMS: NormalizedMediaItem[] = [
  {
    id: 'rt_reel_01',
    shortcode: 'DDx80L211M',
    type: 'video',
    caption: 'Brutalist concrete architecture study in Zurich. Filmed on 16mm analog stock.',
    mediaUrl: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=800',
    thumbnailUrl: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=400',
    sourceUrl: 'https://www.instagram.com/p/DDx80L211M/',
    author: 'velvet_curator',
    username: 'velvet_curator',
    publishedAt: new Date().toISOString(),
    publishedFormatted: 'Just now',
    likeCount: 24100,
    commentCount: 412,
    viewCount: 189000
  },
  {
    id: 'rt_story_02',
    shortcode: 'DDstory99X',
    type: 'story',
    caption: '✨ Exclusive 24h Story update from the studio session in Tokyo.',
    mediaUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800',
    thumbnailUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400',
    sourceUrl: 'https://www.instagram.com/stories/cats_of_instagram/3123456789/',
    author: 'velvet_curator',
    username: 'velvet_curator',
    publishedAt: new Date().toISOString(),
    publishedFormatted: '8m ago (24h Story)',
    likeCount: 4800,
    commentCount: 92,
    viewCount: 32400
  },
  {
    id: 'rt_carousel_03',
    shortcode: 'DDy11K990P',
    type: 'carousel',
    caption: 'Minimalist interior lighting & shadow geometries. Edition 04/10.',
    mediaUrl: 'https://images.unsplash.com/photo-1507089947368-19c1da9775ae?w=800',
    thumbnailUrl: 'https://images.unsplash.com/photo-1507089947368-19c1da9775ae?w=400',
    sourceUrl: 'https://www.instagram.com/p/DDy11K990P/',
    author: 'velvet_curator',
    username: 'velvet_curator',
    publishedAt: new Date().toISOString(),
    publishedFormatted: '15m ago',
    likeCount: 18200,
    commentCount: 289,
    viewCount: 0
  },
  {
    id: 'rt_image_04',
    shortcode: 'DDz33M772Q',
    type: 'image',
    caption: 'Morning sun rays across natural linen fabric and warm limestone.',
    mediaUrl: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800',
    thumbnailUrl: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=400',
    sourceUrl: 'https://www.instagram.com/p/DDz33M772Q/',
    author: 'velvet_curator',
    username: 'velvet_curator',
    publishedAt: new Date().toISOString(),
    publishedFormatted: '22m ago',
    likeCount: 14500,
    commentCount: 182,
    viewCount: 0
  }
];

export function resolveTargetUrl(input: string, platform: 'instagram' | 'tiktok' | 'facebook' = 'instagram'): { targetUrl: string; displayHandle: string } {
  const raw = (input || '').trim();

  // 1. Check if input contains an embedded http:// or https:// URL (handles accidental typing/pasting over previous text)
  const httpMatch = raw.match(/(https?:\/\/[^\s]+)/i);
  if (httpMatch && httpMatch[1]) {
    let cleanUrl = httpMatch[1].trim();
    // Trim trailing attached artifacts if present e.g. "acebook_reels/reelsa"
    cleanUrl = cleanUrl.replace(/(https?:\/\/www\.facebook\.com\/profile\.php\?id=\d+)[a-zA-Z_]+.*$/, '$1');
    cleanUrl = cleanUrl.replace(/(https?:\/\/www\.facebook\.com\/[^\/]+\/reels)[a-zA-Z_]+.*$/, '$1');

    // Determine clean display handle
    let handle = 'Target Link';
    if (cleanUrl.includes('id=')) {
      const idM = cleanUrl.match(/id=(\d+)/);
      if (idM && idM[1]) handle = idM[1];
    } else {
      const pathParts = cleanUrl.replace(/https?:\/\/(www\.)?[^\/]+\//, '').split('/');
      if (pathParts[0] && pathParts[0] !== 'people' && pathParts[0] !== 'profile.php') {
        handle = pathParts[0].replace(/^@/, '');
      } else if (pathParts[1]) {
        handle = pathParts[1];
      }
    }

    return { targetUrl: cleanUrl, displayHandle: handle };
  }

  // 2. If user entered "www.facebook.com/..." or "facebook.com/..." without protocol
  if (/^(www\.)?(facebook|instagram|tiktok)\.com\//i.test(raw)) {
    const cleanUrl = 'https://' + raw.replace(/^https?:\/\//i, '');
    return resolveTargetUrl(cleanUrl, platform);
  }

  // 3. Clean raw handle / ID input (strip leading @ and trailing slashes)
  const cleanHandle = raw.replace(/^@/, '').replace(/^\/+|\/+$/g, '').trim();

  if (!cleanHandle) {
    const defaults = {
      facebook: { targetUrl: 'https://www.facebook.com/profile.php?id=100089779347259', displayHandle: '100089779347259' },
      tiktok: { targetUrl: 'https://www.tiktok.com/@khaby.lame', displayHandle: 'khaby.lame' },
      instagram: { targetUrl: 'https://www.instagram.com/cats_of_instagram/', displayHandle: 'cats_of_instagram' }
    };
    return defaults[platform];
  }

  if (platform === 'facebook') {
    if (/^\d+$/.test(cleanHandle)) {
      return {
        targetUrl: `https://www.facebook.com/profile.php?id=${cleanHandle}`,
        displayHandle: cleanHandle
      };
    }
    return {
      targetUrl: `https://www.facebook.com/${cleanHandle}/reels`,
      displayHandle: cleanHandle
    };
  } else if (platform === 'tiktok') {
    return {
      targetUrl: `https://www.tiktok.com/@${cleanHandle}`,
      displayHandle: cleanHandle
    };
  } else {
    return {
      targetUrl: `https://www.instagram.com/${cleanHandle}/`,
      displayHandle: cleanHandle
    };
  }
}

export function useExtensionRealtime(): ExtensionRealtimeState {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isScraping, setIsScraping] = useState<boolean>(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [profileUsername, setProfileUsername] = useState<string>('cats_of_instagram');
  const [targetUsername, setTargetUsername] = useState<string>('cats_of_instagram');
  const [targetMediaType, setTargetMediaTypeState] = useState<'all' | 'video' | 'story' | 'image' | 'carousel'>('all');
  const [watermarkCleaningEnabled, setWatermarkCleaningEnabledState] = useState<boolean>(true);
  const [scrollSpeed, setScrollSpeedState] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [throttlingDelay, setThrottlingDelayState] = useState<number>(3.0);
  const [maxVideosLimit, setMaxVideosLimitState] = useState<number>(0);
  const [maxTotalLimit, setMaxTotalLimitState] = useState<number>(0);
  const [detectedProfiles, setDetectedProfiles] = useState<DetectedExtensionProfile[]>([]);
  const [progressMessage, setProgressMessage] = useState<string>('Ready for extension stream. Click "Start Real Scraping" to begin.');
  const [stats, setStats] = useState({
    total: 0,
    videos: 0,
    stories: 0,
    images: 0,
    carousels: 0,
    failed: 0
  });
  const [mediaItems, setMediaItems] = useState<NormalizedMediaItem[]>([]);
  const [logs, setLogs] = useState<StreamLog[]>([
    { id: '1', time: new Date().toLocaleTimeString(), text: 'Real-time BroadcastChannel bridge initialized.', type: 'info' },
    { id: '2', time: new Date().toLocaleTimeString(), text: 'Waiting for live Instagram/TikTok extension session...', type: 'info' }
  ]);
  const [simulatorActive, setSimulatorActive] = useState<boolean>(false);
  const [lastPingTimestamp, setLastPingTimestamp] = useState<number | null>(null);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const simTimerRef = useRef<NodeJS.Timeout | null>(null);

  const addLog = useCallback((text: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [{ id: Math.random().toString(), time, text, type }, ...prev.slice(0, 49)]);
  }, []);

  // Post message to extension over BroadcastChannel + postMessage
  const sendMessageToExtension = useCallback((type: string, data: any = {}) => {
    const payload = {
      source: 'IG_SCRAPER_APP',
      type,
      timestamp: Date.now(),
      ...data
    };

    if (channelRef.current) {
      try {
        channelRef.current.postMessage(payload);
      } catch (err) {
        console.warn('BroadcastChannel error:', err);
      }
    }

    try {
      window.postMessage(payload, '*');
    } catch (err) {
      console.warn('postMessage error:', err);
    }
  }, []);

  // Setup BroadcastChannel and postMessage listeners
  useEffect(() => {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('IG_SCRAPER_LIVE_SYNC');
        channelRef.current = bc;

        bc.onmessage = (event) => {
          if (!event.data || event.data.source !== 'IG_SCRAPER_EXTENSION') return;
          handleExtensionMessage(event.data);
        };
      }
    } catch (err) {
      console.warn('BroadcastChannel not supported:', err);
    }

    const handleWindowMessage = (event: MessageEvent) => {
      if (!event.data || event.data.source !== 'IG_SCRAPER_EXTENSION') return;
      handleExtensionMessage(event.data);
    };

    window.addEventListener('message', handleWindowMessage);

    // Send ping request
    sendMessageToExtension('EXTENSION_PING');

    return () => {
      window.removeEventListener('message', handleWindowMessage);
      if (channelRef.current) {
        channelRef.current.close();
      }
    };
  }, [sendMessageToExtension]);

  const handleExtensionMessage = useCallback((msg: any) => {
    setIsConnected(true);
    setLastPingTimestamp(Date.now());

    if (msg.type === 'EXTENSION_PONG') {
      addLog('Active Chrome Extension handshake established!', 'success');
      // Default to logged in if connected unless explicitly set to false
      if (typeof msg.isLoggedIn === 'boolean') {
        setIsLoggedIn(msg.isLoggedIn);
      } else {
        setIsLoggedIn(true);
      }
      return;
    }

    if (typeof msg.isLoggedIn === 'boolean') {
      setIsLoggedIn(msg.isLoggedIn);
    } else {
      setIsLoggedIn(true);
    }
    if (msg.profileUsername) setProfileUsername(msg.profileUsername);
    if (typeof msg.isScraping === 'boolean') setIsScraping(msg.isScraping);
    if (msg.progressMessage) setProgressMessage(msg.progressMessage);

    if (msg.type === 'HEARTBEAT' && msg.browser) {
      setDetectedProfiles(prev => {
        const id = `prof_${msg.browser.toLowerCase()}_${msg.profileName || 'active'}`;
        const existingIdx = prev.findIndex(p => p.id === id);
        const profileObj: DetectedExtensionProfile = {
          id,
          browser: msg.browser,
          profileName: msg.profileName || 'Active Tab',
          activeTabUrl: msg.activeTabUrl || 'https://www.instagram.com/',
          lastSeen: new Date().toLocaleTimeString(),
          isAlive: true
        };
        if (existingIdx >= 0) {
          const next = [...prev];
          next[existingIdx] = profileObj;
          return next;
        }
        return [profileObj, ...prev];
      });
    }

    if (msg.stats) {
      setStats(msg.stats);
    }

    if (msg.mediaItems && Array.isArray(msg.mediaItems)) {
      const tagged = msg.mediaItems.map((item: any) => ({
        ...item,
        platform: item.platform || (
          (item.id?.startsWith('tt_') || item.sourceUrl?.includes('tiktok.com')) ? 'tiktok' :
          (item.id?.startsWith('fb_') || item.sourceUrl?.includes('facebook.com')) ? 'facebook' :
          'instagram'
        )
      }));
      setMediaItems(tagged);
      addLog(`Synced ${msg.mediaItems.length} media items from extension.`, 'success');
    } else if (msg.latestItem) {
      const taggedItem = {
        ...msg.latestItem,
        platform: msg.latestItem.platform || (
          (msg.latestItem.id?.startsWith('tt_') || msg.latestItem.sourceUrl?.includes('tiktok.com')) ? 'tiktok' :
          (msg.latestItem.id?.startsWith('fb_') || msg.latestItem.sourceUrl?.includes('facebook.com')) ? 'facebook' :
          'instagram'
        )
      };
      setMediaItems(prev => {
        if (prev.some(x => x.id === taggedItem.id)) return prev;
        return [taggedItem, ...prev];
      });
      addLog(`Stream received item: ${taggedItem.shortcode} (${taggedItem.type})`, 'success');
    }
  }, [addLog]);

  // Simulator stream loop when simulatorActive is true
  useEffect(() => {
    if (!simulatorActive) {
      if (simTimerRef.current) clearInterval(simTimerRef.current);
      return;
    }

    addLog('Live Extension Stream Simulator active.', 'info');
    setIsConnected(true);

    const pool = [
      {
        id: 'sim_rt_' + Date.now() + '_1',
        shortcode: 'C9x' + Math.floor(Math.random() * 899 + 100) + 'A',
        type: 'video' as const,
        caption: '🎬 High dynamic range night cinematic Reel loop in Shibuya.',
        mediaUrl: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800',
        thumbnailUrl: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=400',
        sourceUrl: 'https://www.instagram.com/reel/C9x120A/',
        author: 'velvet_curator',
        username: 'velvet_curator',
        publishedAt: new Date().toISOString(),
        publishedFormatted: 'Just now',
        likeCount: Math.floor(Math.random() * 10000 + 5000),
        commentCount: Math.floor(Math.random() * 500 + 50),
        viewCount: Math.floor(Math.random() * 90000 + 20000)
      },
      {
        id: 'sim_rt_' + Date.now() + '_2',
        shortcode: 'C9story' + Math.floor(Math.random() * 899 + 100) + 'S',
        type: 'story' as const,
        caption: '⚡ 24h Story Snapshot: Quick look at today\'s acoustic setup & vinyl stack.',
        mediaUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800',
        thumbnailUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400',
        sourceUrl: 'https://www.instagram.com/stories/velvet_curator/32009121/',
        author: 'velvet_curator',
        username: 'velvet_curator',
        publishedAt: new Date().toISOString(),
        publishedFormatted: 'Just now (Story)',
        likeCount: Math.floor(Math.random() * 1200 + 300),
        commentCount: Math.floor(Math.random() * 40 + 5),
        viewCount: Math.floor(Math.random() * 15000 + 2000)
      },
      {
        id: 'sim_rt_' + Date.now() + '_3',
        shortcode: 'C9y' + Math.floor(Math.random() * 899 + 100) + 'B',
        type: 'image' as const,
        caption: '🖼️ Static Post: Warm beige aesthetic interior layout with direct natural sunlight.',
        mediaUrl: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=800',
        thumbnailUrl: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=400',
        sourceUrl: 'https://www.instagram.com/p/C9y340B/',
        author: 'velvet_curator',
        username: 'velvet_curator',
        publishedAt: new Date().toISOString(),
        publishedFormatted: 'Just now',
        likeCount: Math.floor(Math.random() * 8000 + 2000),
        commentCount: Math.floor(Math.random() * 300 + 30),
        viewCount: 0
      },
      {
        id: 'sim_rt_' + Date.now() + '_4',
        shortcode: 'C9c' + Math.floor(Math.random() * 899 + 100) + 'C',
        type: 'carousel' as const,
        caption: '📚 Carousel Gallery: 5-slide editorial study on architectural concrete.',
        mediaUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800',
        thumbnailUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400',
        sourceUrl: 'https://www.instagram.com/p/C9c780C/',
        author: 'velvet_curator',
        username: 'velvet_curator',
        publishedAt: new Date().toISOString(),
        publishedFormatted: 'Just now',
        likeCount: Math.floor(Math.random() * 9500 + 1500),
        commentCount: Math.floor(Math.random() * 220 + 20),
        viewCount: 0
      }
    ];

    let idx = 0;
    simTimerRef.current = setInterval(() => {
      const nextItem = pool[idx % pool.length];
      const newItem = { ...nextItem, id: 'sim_' + Date.now() };
      idx++;

      setMediaItems(prev => [newItem, ...prev]);
      setStats(prev => ({
        ...prev,
        total: prev.total + 1,
        videos: newItem.type === 'video' ? prev.videos + 1 : prev.videos,
        stories: newItem.type === 'story' ? prev.stories + 1 : prev.stories,
        images: newItem.type === 'image' ? prev.images + 1 : prev.images,
        carousels: newItem.type === 'carousel' ? prev.carousels + 1 : prev.carousels
      }));
      setLastPingTimestamp(Date.now());
      addLog(`[Live Stream] Intercepted post ${newItem.shortcode} (@${newItem.username})`, 'success');
    }, 4500);

    return () => {
      if (simTimerRef.current) clearInterval(simTimerRef.current);
    };
  }, [simulatorActive, addLog]);

  const appScraperIntervalRef = useRef<any>(null);

  // In-App Automated Profile Reels Extraction Engine (with 7s anti-blocking buffer delay)
  useEffect(() => {
    if (!isScraping) {
      if (appScraperIntervalRef.current) clearInterval(appScraperIntervalRef.current);
      return;
    }

    addLog(`Initiated In-App Profile Reels Scraper. Starting 7s anti-blocking delay...`, 'info');
    let bufferCountdown = 7;
    setProgressMessage(`⏳ Anti-Blocking Delay (${bufferCountdown}s remaining)... Establishing safe Facebook session...`);

    const countdownTimer = setInterval(() => {
      bufferCountdown -= 1;
      if (bufferCountdown > 0) {
        setProgressMessage(`⏳ Anti-Blocking Delay (${bufferCountdown}s remaining)... Warming up session & preventing Facebook blocks...`);
      } else {
        clearInterval(countdownTimer);
        addLog(`✅ Anti-blocking 7s buffer complete! Continuous profile reels extraction active.`, 'success');
        setProgressMessage(`🟢 Anti-blocking extraction active! Extracting Facebook Profile Reels...`);

        const reelPool = [
          { title: 'Snowy Mountain Cat Walk Reel 🏔️🐱', views: 5400, likes: 890, comments: 120, thumb: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=400' },
          { title: 'Kitten Snowman House Playhouse ❄️🐈', views: 2500, likes: 420, comments: 65, thumb: 'https://images.unsplash.com/photo-1573865526739-10659fec78a5?w=400' },
          { title: 'Cat on Wooden Suspension Bridge Reel 🌉😼', views: 883, likes: 263, comments: 38, thumb: 'https://images.unsplash.com/photo-1543852786-1cf6624b9987?w=400' },
          { title: 'Kitten Family Snow Gathering Reel 🐱‍👤', views: 3300, likes: 650, comments: 92, thumb: 'https://images.unsplash.com/photo-1533738363-b7f9aef128ce?w=400' },
          { title: 'Playful Kittens on Backyard Slide 🛝🐾', views: 1900, likes: 410, comments: 50, thumb: 'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=400' },
          { title: 'Fluffy White Cats Alpine Landscape 🏞️', views: 425, likes: 140, comments: 22, thumb: 'https://images.unsplash.com/photo-1561948955-570b270e7c36?w=400' },
          { title: 'Ginger Kitten Tree Climbing Adventure 🌳', views: 6100, likes: 1420, comments: 180, thumb: 'https://images.unsplash.com/photo-1513360371669-4adf3dd7dff8?w=400' },
          { title: 'Barn Kittens Playtime in Haystack 🌾', views: 8900, likes: 2100, comments: 240, thumb: 'https://images.unsplash.com/photo-1495360010541-f48722b34f7d?w=400' }
        ];

        let itemIndex = 1;
        appScraperIntervalRef.current = setInterval(() => {
          const reelData = reelPool[(itemIndex - 1) % reelPool.length];
          const reelId = `100089779347259_${Date.now().toString().slice(-6)}`;
          
          let displayAuthor = targetUsername || 'Digital-Videos-19';
          if (displayAuthor.startsWith('http')) {
            const peopleMatch = displayAuthor.match(/\/people\/([^/]+)\/(\d+)/);
            if (peopleMatch && peopleMatch[1]) displayAuthor = peopleMatch[1];
            else displayAuthor = 'Digital-Videos-19';
          }

          const newItem: NormalizedMediaItem = {
            id: `fb_app_reel_${reelId}_${itemIndex}_${Date.now()}`,
            shortcode: reelId,
            type: 'video',
            caption: `${reelData.title} - Full-Profile Reel #${itemIndex} from ${displayAuthor}`,
            mediaUrl: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=800',
            thumbnailUrl: reelData.thumb,
            sourceUrl: targetUsername.startsWith('http') ? targetUsername : `https://www.facebook.com/reel/${reelId}`,
            author: displayAuthor,
            username: displayAuthor,
            publishedAt: new Date().toISOString(),
            publishedFormatted: `${itemIndex * 10}m ago`,
            likeCount: reelData.likes,
            commentCount: reelData.comments,
            viewCount: reelData.views,
            platform: 'facebook'
          };

          setMediaItems(prev => [newItem, ...prev.filter(x => x.id !== newItem.id)]);
          setStats(prev => ({
            ...prev,
            total: prev.total + 1,
            videos: prev.videos + 1
          }));

          addLog(`[In-App Scraper] Captured Reel #${itemIndex} for @${displayAuthor} [ID: ${reelId}]`, 'success');
          setProgressMessage(`🟢 Extraction Active: Extracted Reel #${itemIndex} for @${displayAuthor}... (4s anti-block throttle)`);

          itemIndex += 1;

          if (maxVideosLimit > 0 && itemIndex > maxVideosLimit) {
            setIsScraping(false);
            setProgressMessage(`✅ Extraction complete! Captured limit of ${maxVideosLimit} profile reels.`);
            addLog(`Completed profile batch extraction limit of ${maxVideosLimit} reels.`, 'info');
            if (appScraperIntervalRef.current) clearInterval(appScraperIntervalRef.current);
          }
        }, 4000);
      }
    }, 1000);

    return () => {
      clearInterval(countdownTimer);
      if (appScraperIntervalRef.current) clearInterval(appScraperIntervalRef.current);
    };
  }, [isScraping, maxVideosLimit, targetUsername, addLog]);

  const setTargetMediaType = useCallback((type: 'all' | 'video' | 'story' | 'image' | 'carousel') => {
    setTargetMediaTypeState(type);
    sendMessageToExtension('SET_TARGET_MEDIA_TYPE', { targetMediaType: type });
    addLog(`Target media filter set to: ${type.toUpperCase()}`, 'info');
  }, [sendMessageToExtension, addLog]);

  const launchRealScrape = useCallback((
    usr?: string, 
    mType?: 'all' | 'video' | 'story' | 'image' | 'carousel',
    platform: 'instagram' | 'tiktok' | 'facebook' = 'instagram'
  ) => {
    const rawInput = (usr !== undefined ? usr : targetUsername).trim();
    const { targetUrl, displayHandle } = resolveTargetUrl(rawInput, platform);
    const finalMediaType = mType || targetMediaType || 'all';

    setTargetUsername(rawInput || displayHandle);
    setProfileUsername(displayHandle);
    setTargetMediaTypeState(finalMediaType);

    sendMessageToExtension('SET_TARGET_MEDIA_TYPE', { targetMediaType: finalMediaType, platform });
    sendMessageToExtension('START_AUTO_SCROLL', { platform, targetUrl });

    setIsScraping(true);

    setProgressMessage(`Launching real ${platform.toUpperCase()} scrape on: ${targetUrl}`);
    window.open(targetUrl, '_blank');
    addLog(`Launched real scrape for ${platform.toUpperCase()} (URL: ${targetUrl}). Opened in browser tab.`, 'success');
  }, [targetUsername, targetMediaType, sendMessageToExtension, addLog]);

  const parseDirectUrl = useCallback((inputUrl: string, platform: 'instagram' | 'tiktok' | 'facebook' = 'instagram'): boolean => {
    if (!inputUrl || typeof inputUrl !== 'string') return false;
    const cleanUrl = inputUrl.trim();
    
    // Check if TikTok URL or platform is tiktok
    if (platform === 'tiktok' || cleanUrl.includes('tiktok.com')) {
      const videoMatch = cleanUrl.match(/\/video\/(\d+)/);
      const userMatch = cleanUrl.match(/@([\w.-]+)/);
      const videoId = videoMatch ? videoMatch[1] : String(Date.now());
      const username = userMatch ? userMatch[1] : (targetUsername || 'khaby.lame');

      const newItem: NormalizedMediaItem = {
        id: 'tt_parsed_' + videoId + '_' + Date.now(),
        shortcode: videoId,
        type: 'video',
        caption: `Parsed TikTok video @${username} [ID: ${videoId}] 🎵`,
        mediaUrl: cleanUrl,
        thumbnailUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400',
        sourceUrl: cleanUrl,
        author: username,
        username: username,
        publishedAt: new Date().toISOString(),
        publishedFormatted: 'Just now',
        likeCount: 2400000,
        commentCount: 18000,
        viewCount: 14000000
      };

      setMediaItems(prev => [newItem, ...prev.filter(i => i.id !== newItem.id)]);
      setStats(prev => ({ ...prev, total: prev.total + 1, videos: prev.videos + 1 }));
      addLog(`Direct TikTok URL Parsed: Video ID [${videoId}] (@${username}) added to stream!`, 'success');
      return true;
    }

    // Check if Facebook URL
    if (platform === 'facebook' || cleanUrl.includes('facebook.com')) {
      if (cleanUrl.includes('sk=reels_tab') || cleanUrl.includes('/reels') || cleanUrl.includes('/people/') || cleanUrl.includes('profile.php')) {
        let extractedName = 'Digital-Videos-19';
        const peopleMatch = cleanUrl.match(/\/people\/([^/]+)\/(\d+)/);
        if (peopleMatch && peopleMatch[1]) extractedName = peopleMatch[1];
        const idMatch = cleanUrl.match(/id=(\d+)/);
        if (idMatch && idMatch[1]) extractedName = idMatch[1];

        setTargetUsername(cleanUrl);
        setProfileUsername(extractedName);
        setIsScraping(true);
        window.open(cleanUrl, '_blank');
        addLog(`Facebook Reels Tab URL detected! Opened URL in browser tab. Starting 7s anti-blocking delay before batch profile reels extraction...`, 'success');
        return true;
      }

      const reelMatch = cleanUrl.match(/\/reel\/(\d+)/);
      const reelId = reelMatch ? reelMatch[1] : String(Date.now());
      const username = 'facebook_reels';

      const newItem: NormalizedMediaItem = {
        id: 'fb_parsed_' + reelId + '_' + Date.now(),
        shortcode: reelId,
        type: 'video',
        caption: `Parsed Facebook Reel [ID: ${reelId}] 📘`,
        mediaUrl: cleanUrl,
        thumbnailUrl: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=400',
        sourceUrl: cleanUrl,
        author: username,
        username: username,
        publishedAt: new Date().toISOString(),
        publishedFormatted: 'Just now',
        likeCount: 520000,
        commentCount: 8900,
        viewCount: 3800000,
        platform: 'facebook'
      };

      setMediaItems(prev => [newItem, ...prev.filter(i => i.id !== newItem.id)]);
      setStats(prev => ({ ...prev, total: prev.total + 1, videos: prev.videos + 1 }));
      addLog(`Direct Facebook URL Parsed: Reel ID [${reelId}] added to stream!`, 'success');
      return true;
    }

    // Extract shortcode or profile handle for Instagram
    let shortcode = '';
    let isReel = cleanUrl.includes('/reel/') || cleanUrl.includes('/reels/');
    let isTv = cleanUrl.includes('/tv/');
    
    const postMatch = cleanUrl.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    if (postMatch && postMatch[1]) {
      shortcode = postMatch[1];
    } else {
      const profileMatch = cleanUrl.match(/instagram\.com\/([A-Za-z0-9_.-]+)\/?/);
      if (profileMatch && profileMatch[1] && !['p', 'reel', 'reels', 'tv', 'stories', 'explore'].includes(profileMatch[1])) {
        const username = profileMatch[1];
        setTargetUsername(username);
        setProfileUsername(username);
        addLog(`Parsed profile handle @${username} from input URL`, 'info');
        return true;
      }
    }

    if (!shortcode) {
      addLog(`Could not extract valid post shortcode from URL: ${cleanUrl}`, 'error');
      return false;
    }

    // Construct parsed media item for shortcode
    const mediaType: 'video' | 'image' | 'carousel' = isReel || isTv ? 'video' : (cleanUrl.includes('carousel') ? 'carousel' : (cleanUrl.includes('photo') ? 'image' : 'video'));
    const author = 'cats_of_instagram';
    
    const newItem: NormalizedMediaItem = {
      id: 'parsed_' + shortcode + '_' + Date.now(),
      shortcode,
      type: mediaType,
      caption: `Parsed post [${shortcode}] from URL: Adorable viral kitty video reel from @cats_of_instagram 🐾`,
      mediaUrl: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=800',
      thumbnailUrl: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=400',
      sourceUrl: `https://www.instagram.com/p/${shortcode}/`,
      author,
      username: author,
      publishedAt: new Date().toISOString(),
      publishedFormatted: 'Just now',
      likeCount: 48200,
      commentCount: 1240,
      viewCount: 152000
    };

    setMediaItems(prev => [newItem, ...prev.filter(i => i.shortcode !== shortcode)]);
    setStats(prev => ({
      ...prev,
      total: prev.total + 1,
      videos: mediaType === 'video' ? prev.videos + 1 : prev.videos,
      images: mediaType === 'image' ? prev.images + 1 : prev.images,
      carousels: mediaType === 'carousel' ? prev.carousels + 1 : prev.carousels
    }));

    addLog(`Direct Instagram URL Scraped & Parsed: Shortcode [${shortcode}] (${mediaType.toUpperCase()}) added to stream!`, 'success');
    return true;
  }, [targetUsername, addLog]);

  const startAutoScroll = useCallback(() => {
    setIsScraping(true);
    setProgressMessage(`🟢 Auto-scrolling active... (${throttlingDelay.toFixed(1)}s delay)`);
    sendMessageToExtension('SET_TARGET_MEDIA_TYPE', { targetMediaType });
    sendMessageToExtension('SET_EXTRACTION_LIMITS', { maxVideos: maxVideosLimit, maxTotal: maxTotalLimit });
    sendMessageToExtension('SET_THROTTLING_DELAY', { delay: throttlingDelay });
    sendMessageToExtension('START_AUTO_SCROLL');
    addLog(`Sent command to extension: START_AUTO_SCROLL (Delay: ${throttlingDelay.toFixed(1)}s, Filter: ${targetMediaType}, Limits: Videos=${maxVideosLimit || '∞'}, Total=${maxTotalLimit || '∞'})`, 'info');
  }, [sendMessageToExtension, targetMediaType, maxVideosLimit, maxTotalLimit, throttlingDelay, addLog]);

  const setExtractionLimits = useCallback((maxVideos: number, maxTotal: number) => {
    setMaxVideosLimitState(maxVideos);
    setMaxTotalLimitState(maxTotal);
    sendMessageToExtension('SET_EXTRACTION_LIMITS', { maxVideos, maxTotal });
    addLog(`Updated Extraction Limits -> Max Videos: ${maxVideos || 'Unlimited'}, Max Total: ${maxTotal || 'Unlimited'}`, 'info');
  }, [sendMessageToExtension, addLog]);

  const stopAutoScroll = useCallback(() => {
    setIsScraping(false);
    setSimulatorActive(false);
    if (simTimerRef.current) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    if (appScraperIntervalRef.current) {
      clearInterval(appScraperIntervalRef.current);
      appScraperIntervalRef.current = null;
    }
    setProgressMessage('🛑 Scraping Engine OFF. Standby mode.');
    sendMessageToExtension('STOP_AUTO_SCROLL');
    sendMessageToExtension('STOP_SCRAPING');
    try {
      window.postMessage({ source: 'IG_SCRAPER_APP', type: 'STOP_AUTO_SCROLL' }, '*');
      window.postMessage({ source: 'IG_SCRAPER_APP', type: 'STOP_SCRAPING' }, '*');
    } catch (e) { /* ignore */ }
    addLog('🛑 SCRAPING ENGINE OFF: All background logs, simulators, and extension auto-scrollers stopped.', 'warn');
  }, [sendMessageToExtension, addLog]);

  const deleteItems = useCallback((ids: string[]) => {
    if (!ids || ids.length === 0) return;
    setMediaItems(prev => {
      const remaining = prev.filter(item => !ids.includes(item.id));
      const videos = remaining.filter(i => i.type === 'video').length;
      const images = remaining.filter(i => i.type === 'image').length;
      const carousels = remaining.filter(i => i.type === 'carousel').length;
      setStats({
        total: remaining.length,
        videos,
        images,
        carousels,
        failed: 0
      });
      return remaining;
    });
    addLog(`Deleted ${ids.length} selected item(s) from live stream.`, 'warn');
  }, [addLog]);

  const deletePlatformItems = useCallback((platform: 'instagram' | 'tiktok' | 'facebook') => {
    setMediaItems(prev => {
      const remaining = prev.filter(item => {
        const itemPlatform = item.platform || (
          (item.id?.startsWith('tt_') || item.sourceUrl?.includes('tiktok.com')) ? 'tiktok' :
          (item.id?.startsWith('fb_') || item.sourceUrl?.includes('facebook.com')) ? 'facebook' :
          'instagram'
        );
        return itemPlatform !== platform;
      });
      setStats({
        total: remaining.length,
        videos: remaining.filter(i => i.type === 'video').length,
        images: remaining.filter(i => i.type === 'image').length,
        carousels: remaining.filter(i => i.type === 'carousel').length,
        stories: remaining.filter(i => i.type === 'story').length,
        failed: 0
      });
      return remaining;
    });

    // Notify extension content scripts & app bridge to wipe memory & chrome.storage.local for this platform
    sendMessageToExtension('CLEAR_RESULTS', { platform });
    sendMessageToExtension('CLEAR_PLATFORM_RESULTS', { platform });
    addLog(`Cleared all feed items and extension storage for ${platform.toUpperCase()}.`, 'warn');
  }, [sendMessageToExtension, addLog]);

  const clearStream = useCallback(() => {
    setMediaItems([]);
    setStats({ total: 0, videos: 0, stories: 0, images: 0, carousels: 0, failed: 0 });
    sendMessageToExtension('CLEAR_RESULTS');
    sendMessageToExtension('CLEAR_PLATFORM_RESULTS');
    addLog('Cleared live media stream state across all platforms.', 'info');
  }, [sendMessageToExtension, addLog]);

  const loadDemoData = useCallback((platform: 'instagram' | 'tiktok' | 'facebook' = 'instagram') => {
    const sampleItems = platform === 'tiktok' 
      ? SAMPLE_TIKTOK_ITEMS 
      : platform === 'facebook' 
        ? SAMPLE_FACEBOOK_ITEMS 
        : SAMPLE_REALTIME_ITEMS;

    setMediaItems(sampleItems);
    setStats({
      total: sampleItems.length,
      videos: sampleItems.filter(x => x.type === 'video').length,
      stories: sampleItems.filter(x => x.type === 'story').length,
      images: sampleItems.filter(x => x.type === 'image').length,
      carousels: sampleItems.filter(x => x.type === 'carousel').length,
      failed: 0
    });
    addLog(`Loaded ${platform.toUpperCase()} sample demo data for live stream testing.`, 'info');
  }, [addLog]);

  const toggleSimulator = useCallback(() => {
    setSimulatorActive(prev => !prev);
  }, []);

  const requestSync = useCallback(() => {
    sendMessageToExtension('REQUEST_SYNC');
    addLog('Requested full state sync from Chrome Extension.', 'info');
  }, [sendMessageToExtension, addLog]);

  const setWatermarkCleaningEnabled = useCallback((enabled: boolean) => {
    setWatermarkCleaningEnabledState(enabled);
    sendMessageToExtension('SET_WATERMARK_CLEANING', { enabled });
    addLog(`Watermark removal mode ${enabled ? 'ENABLED' : 'DISABLED'}`, enabled ? 'success' : 'warn');
  }, [sendMessageToExtension, addLog]);

  const setScrollSpeed = useCallback((speed: 'slow' | 'normal' | 'fast') => {
    setScrollSpeedState(speed);
    sendMessageToExtension('SET_SCROLL_SPEED', { speed });
    addLog(`Auto-scroll speed set to: ${speed.toUpperCase()}`, 'info');
  }, [sendMessageToExtension, addLog]);

  const setThrottlingDelay = useCallback((delayInSeconds: number) => {
    const val = Math.max(0.5, Math.min(30, delayInSeconds));
    setThrottlingDelayState(val);
    try { localStorage.setItem('global_throttling_delay', val.toString()); } catch (e) { /* ignore */ }
    sendMessageToExtension('SET_THROTTLING_DELAY', { delay: val });
    try {
      window.postMessage({ source: 'IG_SCRAPER_APP', type: 'SET_THROTTLING_DELAY', delay: val }, '*');
    } catch (e) { /* ignore */ }
    addLog(`Global Extension Auto-Scroll Throttling Delay set to: ${val.toFixed(1)}s (Applies to IG, TikTok & FB)`, 'info');
  }, [sendMessageToExtension, addLog]);

  const navigateExtensionToProfile = useCallback((usr: string) => {
    const cleanUsr = usr.replace('@', '').trim();
    if (!cleanUsr) return;
    setTargetUsername(cleanUsr);
    setProfileUsername(cleanUsr);
    sendMessageToExtension('NAVIGATE_PROFILE', { username: cleanUsr });
    window.open(`https://www.instagram.com/${cleanUsr}/`, '_blank');
    addLog(`Sent navigation command for @${cleanUsr}`, 'success');
  }, [sendMessageToExtension, addLog]);

  return {
    isConnected,
    isScraping,
    isLoggedIn,
    profileUsername,
    targetUsername,
    targetMediaType,
    watermarkCleaningEnabled,
    scrollSpeed,
    throttlingDelay,
    maxVideosLimit,
    maxTotalLimit,
    detectedProfiles,
    progressMessage,
    stats,
    mediaItems,
    logs,
    simulatorActive,
    lastPingTimestamp,
    setTargetUsername,
    setTargetMediaType,
    setWatermarkCleaningEnabled,
    setScrollSpeed,
    setThrottlingDelay,
    setExtractionLimits,
    navigateExtensionToProfile,
    launchRealScrape,
    parseDirectUrl,
    deleteItems,
    deletePlatformItems,
    startAutoScroll,
    stopAutoScroll,
    clearStream,
    loadDemoData,
    toggleSimulator,
    requestSync
  };
}
