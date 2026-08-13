export interface NormalizedMediaItem {
  id: string;
  shortcode: string;
  type: 'video' | 'image' | 'carousel' | 'story';
  caption: string;
  mediaUrl: string;
  videoUrl?: string;
  videoCandidates?: string[];
  thumbnailUrl: string;
  sourceUrl: string;
  author: string;
  username: string;
  profilePicUrl?: string;
  publishedAt: string;
  publishedFormatted: string;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  duration?: number;
  width?: number;
  height?: number;
  platform?: 'instagram' | 'tiktok' | 'facebook';
  carouselItems?: Array<{
    type: string;
    mediaUrl: string;
    thumbnailUrl: string;
  }>;
}

export interface ExtensionFile {
  path: string;
  name: string;
  language: 'json' | 'javascript' | 'html' | 'css';
  category: 'manifest' | 'scripts' | 'utils' | 'ui';
  content: string;
}

export interface MockPayloadSample {
  id: string;
  name: string;
  description: string;
  data: object;
}
