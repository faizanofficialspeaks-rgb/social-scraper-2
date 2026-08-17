import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckSquare, Film, Image as ImageIcon, Loader2, Plus, Send, Sparkles, Tag, Trash2, Music2, Send as SendIcon } from 'lucide-react';

import { API_BASE } from '../lib/apiBase';

interface StageItem {
  id: string;
  shortcode: string;
  platform: 'instagram' | 'tiktok' | 'facebook';
  mediaUrl: string;
  thumbnail?: string;
  type: 'video' | 'image';
  originalCaption?: string;
  caption: string;
  tags: string[];
  selected: boolean;
  order: number;
  destination?: 'ig' | 'fb' | 'both';
  status: 'new' | 'queued';
  createdAt: number;
}

const PLATFORM_BADGE: Record<string, string> = {
  instagram: 'bg-[#FF6321] text-white',
  tiktok: 'bg-[#FF0050] text-white',
  facebook: 'bg-[#1877F2] text-white',
};

interface ContentStagePanelProps {
  onNavigate?: (tab: 'queue' | 'fbqueue') => void;
}

export const ContentStagePanel: React.FC<ContentStagePanelProps> = ({ onNavigate }) => {
  const [items, setItems] = useState<StageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [pushResult, setPushResult] = useState<{ instagram: number; facebook: number } | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [globalDestination, setGlobalDestination] = useState<'ig' | 'fb' | 'both' | ''>('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBatchRef = useRef<{ items: any[]; flushId: number }>({ items: [], flushId: 0 });

  const fetchStage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/stage`);
      const data = await res.json();
      if (data.success) setItems(data.items || []);
    } catch {
      /* server down */
    } finally {
      setLoading(false);
    }
  }, []);

  const itemDestination = (item: StageItem): 'ig' | 'fb' | 'both' =>
    globalDestination || item.destination || (item.platform === 'facebook' ? 'fb' : 'ig');

  useEffect(() => {
    fetchStage();
    const interval = setInterval(fetchStage, 5000);
    return () => clearInterval(interval);
  }, [fetchStage]);

  const flushBatch = useCallback(async () => {
    const { items: batch, flushId } = pendingBatchRef.current;
    if (!batch.length) return;
    if (flushId === 0) return;
    pendingBatchRef.current = { items: [], flushId: 0 };
    try {
      await fetch(`${API_BASE}/api/stage/upsert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: batch }),
      });
      fetchStage();
    } catch {
      /* retry next cycle */
    }
  }, [fetchStage]);

  // Listen to the live scraper stream → stage new scraped items (debounced batch)
  useEffect(() => {
    const bc = new BroadcastChannel('IG_SCRAPER_LIVE_SYNC');
    bc.onmessage = (event) => {
      const msg = event.data;
      if (msg && msg.type === 'STATE_UPDATE' && Array.isArray(msg.mediaItems)) {
        const scraped = msg.mediaItems
          .filter((m: any) => m && (m.videoUrl || m.url))
          .map((m: any) => ({
            shortcode: m.shortcode || m.code || '',
            platform: m.platform || msg.platform || 'instagram',
            mediaUrl: m.videoUrl || m.url || '',
            type: m.type || (m.videoUrl ? 'video' : 'image'),
            thumbnail: m.thumbnail || '',
            caption: m.caption || '',
            timestamp: m.timestamp || Date.now(),
          }));
        if (!scraped.length) return;
        pendingBatchRef.current.items = pendingBatchRef.current.items.concat(scraped);
        pendingBatchRef.current.flushId++;
        const thisFlush = pendingBatchRef.current.flushId;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          if (pendingBatchRef.current.flushId === thisFlush) flushBatch();
        }, 3000);
      }
    };
    return () => {
      bc.close();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [flushBatch]);

  const updateItem = async (id: string, patch: Partial<StageItem>) => {
    try {
      await fetch(`${API_BASE}/api/stage/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    } catch {
      /* ignore */
    }
  };

  const toggleSelect = async (item: StageItem) => {
    const nextSelected = !item.selected;
    let nextOrder = item.order;
    if (nextSelected && nextOrder === 0) {
      const maxOrder = items.reduce((m, i) => (i.selected ? Math.max(m, i.order) : m), 0);
      nextOrder = maxOrder + 1;
    }
    await updateItem(item.id, { selected: nextSelected, order: nextOrder });
  };

  const moveOrder = async (item: StageItem, dir: -1 | 1) => {
    const ordered = items.filter((i) => i.selected).sort((a, b) => a.order - b.order);
    const idx = ordered.findIndex((i) => i.id === item.id);
    const swap = ordered[idx + dir];
    if (!swap) return;
    await updateItem(item.id, { order: swap.order });
    await updateItem(swap.id, { order: item.order });
  };

  const generateCaption = async (item: StageItem, useAi: boolean) => {
    setGeneratingId(item.id);
    setMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/stage/caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, useAi }),
      });
      const data = await res.json();
      if (data.success) {
        await updateItem(item.id, { caption: data.caption, tags: data.tags || item.tags });
        setMsg(`${item.shortcode || 'post'}: ${data.message}`);
      } else {
        setMsg(data.error || 'Caption generation failed');
      }
    } catch (err) {
      setMsg(`Server error: ${(err as Error).message}`);
    } finally {
      setGeneratingId(null);
    }
  };

  const addViralTags = async (item: StageItem) => {
    try {
      const res = await fetch(`${API_BASE}/api/stage/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: item.platform }),
      });
      const data = await res.json();
      if (data.success) {
        const merged = Array.from(new Set([...item.tags, ...data.tags])).slice(0, 30);
        await updateItem(item.id, { tags: merged });
      }
    } catch {
      /* ignore */
    }
  };

  const removeItem = async (item: StageItem) => {
    await fetch(`${API_BASE}/api/stage/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id }),
    });
    setItems((prev) => prev.filter((it) => it.id !== item.id));
    setMsg(`Removed ${item.shortcode || 'post'} — it will not be re-added from the stream.`);
  };

  const pushToQueue = async () => {
    setPushing(true);
    setMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/stage/push-to-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(globalDestination ? { destination: globalDestination } : {}),
      });
      const data = await res.json();
      setMsg(data.message || data.error || 'Push failed');
      if (data.success && typeof data.queued === 'object' && data.queued !== null) {
        setPushResult({
          instagram: Number(data.queued.instagram) || 0,
          facebook: Number(data.queued.facebook) || 0,
        });
      } else {
        setPushResult(null);
      }
      fetchStage();
    } catch (err) {
      setMsg(`Server error: ${(err as Error).message}`);
    } finally {
      setPushing(false);
    }
  };

  const selectedCount = items.filter((i) => i.selected).length;
  const orderedItems = items.filter((i) => i.selected).sort((a, b) => a.order - b.order);

  return (
    <section className="border border-[#1A1A1A]/15 bg-white p-6">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <h3 className="font-serif text-xl font-normal tracking-tight flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-[#19A76C]" />
          Content Stage
        </h3>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
          <span className="px-2 py-1 bg-[#F5F2ED] border border-[#1A1A1A]/15">{items.length} scraped</span>
          <span className={`px-2 py-1 border ${selectedCount ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-[#F5F2ED] border-[#1A1A1A]/15'}`}>
            {selectedCount} selected · order set
          </span>
        </div>
      </div>

      <p className="text-[11px] text-[#1A1A1A]/50 mb-4 font-sans">
        Scraped reels from Instagram / TikTok / Facebook auto-appear here. Select the ones you want, give them an order (1, 2, 3…),
        fix captions + viral tags, then push to the schedule. Deleted items never come back (no duplicates).
      </p>

      {!items.length ? (
        <div className="py-12 text-center text-sm text-[#1A1A1A]/40 font-sans">
          {loading ? 'Loading stage…' : 'Stage empty — start scraping on the Instagram / TikTok / Facebook tabs and scraped posts will appear here.'}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Global destination override bar */}
          <div className="flex items-center gap-2 flex-wrap pb-2 border-b border-[#1A1A1A]/10">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#1A1A1A]/50">Where to post:</span>
            <select
              value={globalDestination}
              onChange={(e) => setGlobalDestination(e.target.value as 'ig' | 'fb' | 'both' | '')}
              className="px-2 py-1.5 bg-white border border-[#1A1A1A]/20 text-[11px] font-mono font-bold focus:outline-none focus:border-[#19A76C]"
              title="Override destination for ALL selected items"
            >
              <option value="">Per-item (default)</option>
              <option value="ig">IG Queue</option>
              <option value="fb">FB Queue</option>
              <option value="both">Both IG + FB</option>
            </select>
            {globalDestination && (
              <span className="text-[10px] font-mono text-[#19A76C]">
                overriding {items.filter((i) => i.selected).length} selected items
              </span>
            )}
          </div>
          {/* Selected order strip */}
          {orderedItems.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap pb-2 border-b border-[#1A1A1A]/10">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#1A1A1A]/50">Post order:</span>
              {orderedItems.map((item) => (
                <span key={item.id} className="flex items-center gap-1 px-2 py-1 bg-[#1A1A1A] text-white text-[10px] font-mono font-bold">
                  #{item.order} {item.shortcode || 'media'}
                </span>
              ))}
            </div>
          )}

          {items.map((item) => (
            <div
              key={item.id}
              className={`border p-3 flex flex-col lg:flex-row gap-3 transition-colors ${item.selected ? 'border-[#19A76C]/60 bg-emerald-50/40' : 'border-[#1A1A1A]/10 bg-[#FBF9F6]'}`}
            >
              {/* Media thumb + platform */}
              <div className="flex items-center gap-3 lg:w-56 shrink-0">
                <button
                  onClick={() => toggleSelect(item)}
                  className={`relative w-20 h-20 border-2 shrink-0 overflow-hidden cursor-pointer transition-all ${
                    item.selected ? 'border-[#19A76C]' : 'border-[#1A1A1A]/15 hover:border-[#1A1A1A]/40'
                  }`}
                  title={item.selected ? 'Click to deselect' : 'Click to select for posting'}
                >
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-[#1A1A1A]/5 flex items-center justify-center">
                      {item.type === 'image' ? <ImageIcon className="w-6 h-6 text-[#1A1A1A]/30" /> : <Film className="w-6 h-6 text-[#1A1A1A]/30" />}
                    </div>
                  )}
                  {item.selected && (
                    <span className="absolute inset-0 bg-[#19A76C]/20 flex items-center justify-center">
                      <span className="w-7 h-7 bg-[#19A76C] text-white flex items-center justify-center text-sm font-mono font-bold rounded-full shadow">
                        {item.order || '✓'}
                      </span>
                    </span>
                  )}
                </button>
                <div className="space-y-1.5">
                  <span className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${PLATFORM_BADGE[item.platform] || 'bg-[#1A1A1A] text-white'}`}>
                    {item.platform}
                  </span>
                  <div className="font-mono text-xs text-[#1A1A1A] truncate max-w-[120px]">{item.shortcode || 'media'}</div>
                  <span className="text-[10px] font-mono text-[#1A1A1A]/40 uppercase">{item.type}</span>
                </div>
              </div>

              {/* Caption + tags */}
              <div className="flex-1 min-w-0 space-y-2">
                <textarea
                  value={item.caption}
                  onChange={(e) => updateItem(item.id, { caption: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-[#1A1A1A]/15 text-xs font-mono focus:outline-none focus:border-[#19A76C] resize-none"
                  placeholder="Caption… (original or generated)"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => generateCaption(item, false)}
                    disabled={generatingId === item.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-[#1A1A1A]/5 hover:bg-[#1A1A1A]/10 border border-[#1A1A1A]/20 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50"
                  >
                    {generatingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 text-[#19A76C]" />}
                    Generate Caption
                  </button>
                  <button
                    onClick={() => generateCaption(item, true)}
                    disabled={generatingId === item.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-[#19A76C]/10 hover:bg-[#19A76C]/20 border border-[#19A76C]/40 text-[#0f7a4d] text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50"
                    title="AI caption (requires GEMINI_API_KEY; falls back to template)"
                  >
                    {generatingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    AI Caption
                  </button>
                  {item.originalCaption && item.caption !== item.originalCaption && (
                    <button
                      onClick={() => updateItem(item.id, { caption: item.originalCaption || '' })}
                      className="px-2.5 py-1.5 bg-[#F5F2ED] hover:bg-[#1A1A1A]/10 border border-[#1A1A1A]/20 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                      title="Restore the original scraped caption"
                    >
                      Restore Original
                    </button>
                  )}
                  <button
                    onClick={() => addViralTags(item)}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-[#FF6321]/10 hover:bg-[#FF6321]/20 border border-[#FF6321]/40 text-[#c24d17] text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    <Tag className="w-3 h-3" />
                    + Viral Tags
                  </button>
                </div>
                {item.tags.length > 0 && (
                  <div className="flex items-start gap-1.5 flex-wrap">
                    <Tag className="w-3 h-3 text-[#FF6321] mt-0.5 shrink-0" />
                    <input
                      value={item.tags.join(' ')}
                      onChange={(e) =>
                        updateItem(item.id, {
                          tags: e.target.value.split(/\s+/).filter(Boolean).slice(0, 30),
                        })
                      }
                      className="flex-1 min-w-0 bg-transparent border-b border-dashed border-[#1A1A1A]/20 text-[11px] font-mono text-[#1A1A1A]/70 focus:outline-none focus:border-[#FF6321]"
                      placeholder="Edit hashtags…"
                    />
                  </div>
                )}
              </div>

              {/* Order + actions */}
              <div className="flex lg:flex-col items-center justify-between lg:justify-center gap-2 lg:w-40 shrink-0">
                <select
                  value={itemDestination(item)}
                  onChange={(e) => updateItem(item.id, { destination: e.target.value as 'ig' | 'fb' | 'both' })}
                  disabled={!!globalDestination}
                  className="w-full px-2 py-1.5 bg-white border border-[#1A1A1A]/20 text-[10px] font-mono font-bold focus:outline-none focus:border-[#19A76C] disabled:opacity-40"
                  title="Where this post should be published"
                >
                  <option value="ig">IG Queue</option>
                  <option value="fb">FB Queue</option>
                  <option value="both">Both</option>
                </select>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => moveOrder(item, -1)}
                    disabled={!item.selected}
                    className="p-1.5 border border-[#1A1A1A]/15 hover:bg-[#1A1A1A] hover:text-white transition-all cursor-pointer disabled:opacity-30"
                    title="Move earlier in order"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={item.order || ''}
                    placeholder="—"
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      updateItem(item.id, { order: isNaN(v) ? 0 : v, selected: !isNaN(v) && v > 0 ? true : item.selected });
                    }}
                    className="w-12 px-2 py-1.5 text-center bg-white border border-[#1A1A1A]/20 text-sm font-mono font-bold focus:outline-none focus:border-[#19A76C]"
                    title="Post order number (1 = first)"
                  />
                  <button
                    onClick={() => moveOrder(item, 1)}
                    disabled={!item.selected}
                    className="p-1.5 border border-[#1A1A1A]/15 hover:bg-[#1A1A1A] hover:text-white transition-all cursor-pointer disabled:opacity-30"
                    title="Move later in order"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  {!item.selected && (
                    <button
                      onClick={() => updateItem(item.id, { selected: true, order: (items.reduce((m, i) => (i.selected ? Math.max(m, i.order) : m), 0)) + 1 })}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-[#19A76C] text-white text-[10px] font-bold uppercase tracking-wider hover:bg-[#148a59] transition-all cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> Select
                    </button>
                  )}
                  <button
                    onClick={() => removeItem(item)}
                    className="p-1.5 border border-[#1A1A1A]/15 hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition-all cursor-pointer"
                    title="Remove — won't be re-added"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Push to queue */}
      <div className="mt-5 pt-4 border-t border-[#1A1A1A]/10 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="text-[11px] text-[#1A1A1A]/50 font-sans">
          {orderedItems.length > 0
            ? `Will push in order: ${orderedItems.map((i) => `#${i.order}`).join(' → ')} (30 min apart, first post ~now)`
            : 'Select posts, set their order and destination (IG / FB / Both) — then push them to the queue.'}
        </div>
        <button
          onClick={pushToQueue}
          disabled={pushing || !orderedItems.length}
          className="flex items-center gap-2 px-6 py-3 bg-[#19A76C] text-white hover:bg-[#148a59] font-sans text-[11px] uppercase tracking-[0.2em] font-bold transition-colors disabled:opacity-40 cursor-pointer"
        >
          {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendIcon className="w-4 h-4" />}
          {pushing ? 'Pushing…' : `Push ${orderedItems.length} to Queue`}
        </button>
      </div>

      {msg && <div className="mt-4 px-4 py-3 text-sm border font-mono bg-[#F5F2ED] border-[#1A1A1A]/15 text-[#1A1A1A]">{msg}</div>}

      {pushResult && onNavigate && (
        <div className="mt-3 flex items-center gap-3 flex-wrap bg-emerald-50/60 border border-emerald-300/60 px-4 py-3">
          <span className="text-xs font-mono font-bold text-emerald-700">
            Queued: IG {pushResult.instagram} · FB {pushResult.facebook}
          </span>
          <span className="text-[11px] text-emerald-700/70 font-sans">Ab agla step:</span>
          <button
            onClick={() => onNavigate('queue')}
            className="px-3 py-1.5 bg-[#19A76C] text-white text-[10px] font-bold uppercase tracking-wider hover:bg-[#148a59] transition-colors cursor-pointer"
          >
            Go to Unified Queue →
          </button>
        </div>
      )}
    </section>
  );
};
