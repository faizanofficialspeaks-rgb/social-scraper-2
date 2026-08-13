import { NormalizedMediaItem } from '../types';

export function exportToJson(items: NormalizedMediaItem[]): string {
  return JSON.stringify(items, null, 2);
}

export function exportToCsv(items: NormalizedMediaItem[]): string {
  if (!items || items.length === 0) return '';

  const headers = ['id', 'shortcode', 'type', 'username', 'caption', 'mediaUrl', 'likeCount', 'commentCount', 'viewCount', 'publishedFormatted'];
  const rows = items.map(item => [
    escapeCsv(item.id),
    escapeCsv(item.shortcode),
    escapeCsv(item.type),
    escapeCsv(item.username),
    escapeCsv(item.caption),
    escapeCsv(item.mediaUrl),
    item.likeCount || 0,
    item.commentCount || 0,
    item.viewCount || 0,
    escapeCsv(item.publishedFormatted)
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

export function exportToTxt(items: NormalizedMediaItem[]): string {
  if (!items || items.length === 0) return 'No items collected.';

  return items.map((item, idx) => `
========================================
POST #${idx + 1} | @${item.username} | ${item.publishedFormatted}
Shortcode: ${item.shortcode}
Type: ${item.type.toUpperCase()}
Likes: ${item.likeCount} | Comments: ${item.commentCount} | Views: ${item.viewCount}
Media URL: ${item.mediaUrl}
----------------------------------------
CAPTION:
${item.caption || '(No caption text)'}
========================================
`).join('\n');
}

function escapeCsv(str: string): string {
  if (!str) return '""';
  const clean = String(str).replace(/"/g, '""');
  return `"${clean}"`;
}
