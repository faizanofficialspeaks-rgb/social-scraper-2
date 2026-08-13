import React, { useState } from 'react';
import { MOCK_PAYLOADS } from '../data/mockPayloads';
import { Sparkles, Code, Play, RefreshCw, CheckCircle2, Video, Image, FileText } from 'lucide-react';
import { NormalizedMediaItem } from '../types';

export const ParserSandbox: React.FC = () => {
  const [selectedSampleId, setSelectedSampleId] = useState<string>(MOCK_PAYLOADS[0].id);
  const [jsonInput, setJsonInput] = useState<string>(JSON.stringify(MOCK_PAYLOADS[0].data, null, 2));
  const [parsedResults, setParsedResults] = useState<NormalizedMediaItem[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const selectedSample = MOCK_PAYLOADS.find(p => p.id === selectedSampleId) || MOCK_PAYLOADS[0];

  const handleSampleChange = (id: string) => {
    setSelectedSampleId(id);
    const sample = MOCK_PAYLOADS.find(p => p.id === id);
    if (sample) {
      const formatted = JSON.stringify(sample.data, null, 2);
      setJsonInput(formatted);
      runParser(formatted);
    }
  };

  const runParser = (rawJson: string) => {
    setParseError(null);
    try {
      const payload = JSON.parse(rawJson);
      
      // Inline normalizer execution matching extension implementation
      const results: NormalizedMediaItem[] = [];
      
      function traverse(node: any) {
        if (!node || typeof node !== 'object') return;

        const isCandidate = (node.pk || node.id || node.code || node.shortcode) &&
          (node.media_type || node.is_video !== undefined || node.video_versions || node.display_url);

        if (isCandidate) {
          const id = String(node.pk || node.id || node.code || node.shortcode);
          const shortcode = node.code || node.shortcode || id;
          const isVideo = node.is_video || node.media_type === 2 || Boolean(node.video_versions);
          
          let mediaUrl = node.video_url || node.display_url;
          if (Array.isArray(node.video_versions) && node.video_versions.length > 0) {
            mediaUrl = node.video_versions[0].url;
          }

          let caption = '';
          if (typeof node.caption === 'string') caption = node.caption;
          else if (node.caption?.text) caption = node.caption.text;
          else if (node.edge_media_to_caption?.edges?.[0]?.node?.text) {
            caption = node.edge_media_to_caption.edges[0].node.text;
          }

          if (mediaUrl) {
            results.push({
              id,
              shortcode,
              type: isVideo ? 'video' : 'image',
              caption,
              mediaUrl,
              thumbnailUrl: node.display_url || mediaUrl,
              sourceUrl: `https://www.instagram.com/${isVideo ? 'reel' : 'p'}/${shortcode}/`,
              author: node.owner?.full_name || node.user?.full_name || 'Creator Studio',
              username: node.owner?.username || node.user?.username || 'creator_studio',
              publishedAt: new Date().toISOString(),
              publishedFormatted: new Date().toLocaleDateString(),
              likeCount: node.edge_media_preview_like?.count || node.like_count || 0,
              commentCount: node.edge_media_to_comment?.count || node.comment_count || 0,
              viewCount: node.video_view_count || node.view_count || 0
            });
          }
        }

        if (Array.isArray(node.edges)) {
          node.edges.forEach((e: any) => traverse(e.node || e));
        } else if (Array.isArray(node.items)) {
          node.items.forEach((i: any) => traverse(i));
        } else {
          for (const k in node) {
            if (node[k] && typeof node[k] === 'object') traverse(node[k]);
          }
        }
      }

      traverse(payload);

      // Deduplicate results
      const uniqueMap = new Map();
      results.forEach(item => {
        if (!uniqueMap.has(item.id)) uniqueMap.set(item.id, item);
      });

      setParsedResults(Array.from(uniqueMap.values()));
    } catch (err: any) {
      setParseError('Invalid JSON format: ' + err.message);
      setParsedResults([]);
    }
  };

  React.useEffect(() => {
    runParser(jsonInput);
  }, []);

  return (
    <div className="space-y-8">
      
      {/* Editorial Controls Header */}
      <div className="bg-[#FBF9F6] border border-[#1A1A1A]/10 p-8 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold text-[#1A1A1A]/40 mb-1">Payload Testing</p>
          <h3 className="text-3xl font-serif font-normal text-[#1A1A1A] flex items-center gap-3">
            Response Adapter Normalizer
          </h3>
          <p className="text-xs text-[#1A1A1A]/60 font-sans mt-2 max-w-xl">
            Test real or mocked Instagram GraphQL network payloads directly against our dynamic media normalization algorithm.
          </p>
        </div>

        <div className="flex items-center gap-3 bg-white p-2 border border-[#1A1A1A]/10">
          <label className="text-[10px] uppercase tracking-[0.15em] font-sans font-bold text-[#1A1A1A]/60 pl-2">Sample:</label>
          <select
            value={selectedSampleId}
            onChange={(e) => handleSampleChange(e.target.value)}
            className="bg-[#FBF9F6] border border-[#1A1A1A]/20 text-[#1A1A1A] text-xs px-3 py-2 font-sans font-semibold focus:outline-none focus:border-[#1A1A1A]"
          >
            {MOCK_PAYLOADS.map(sample => (
              <option key={sample.id} value={sample.id}>{sample.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Editorial Workspace */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Raw JSON Input */}
        <div className="bg-white border border-[#1A1A1A]/10 p-6 flex flex-col h-[520px]">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#1A1A1A]/10">
            <span className="text-[10px] font-sans font-bold text-[#1A1A1A]/60 uppercase tracking-[0.2em] flex items-center gap-2">
              <Code className="w-3.5 h-3.5 text-[#1A1A1A]" /> Intercepted GraphQL Payload
            </span>
            <button
              onClick={() => runParser(jsonInput)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1A] text-white hover:bg-black text-[10px] font-sans font-bold uppercase tracking-[0.15em] cursor-pointer"
            >
              <Play className="w-3 h-3 text-[#FF6321]" /> Execute Adapter
            </button>
          </div>

          <textarea
            value={jsonInput}
            onChange={(e) => {
              setJsonInput(e.target.value);
              runParser(e.target.value);
            }}
            className="w-full flex-1 bg-[#FAF8F5] border border-[#1A1A1A]/10 p-4 font-mono text-xs text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] resize-none leading-relaxed"
            placeholder="Paste raw Instagram API payload JSON..."
          />

          {parseError && (
            <div className="mt-3 text-xs text-[#FF6321] bg-[#FF6321]/5 p-3 border border-[#FF6321]/20 font-sans">
              {parseError}
            </div>
          )}
        </div>

        {/* Normalized Output */}
        <div className="bg-[#FBF9F6] border border-[#1A1A1A]/10 p-6 flex flex-col h-[520px]">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#1A1A1A]/10">
            <span className="text-[10px] font-sans font-bold text-[#1A1A1A]/60 uppercase tracking-[0.2em] flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#FF6321]" /> Normalized Output ({parsedResults.length})
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {parsedResults.length === 0 ? (
              <div className="text-center py-24 text-[#1A1A1A]/40 text-xs font-sans italic">
                No normalized media candidates found in payload.
              </div>
            ) : (
              parsedResults.map(item => (
                <div key={item.id} className="bg-white border border-[#1A1A1A]/10 p-5 space-y-3">
                  <div className="flex items-center justify-between text-xs font-sans">
                    <span className="font-bold text-[#1A1A1A]">@{item.username}</span>
                    <span className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${
                      item.type === 'video' ? 'bg-[#1A1A1A] text-white' : 'border border-[#1A1A1A] text-[#1A1A1A]'
                    }`}>
                      {item.type}
                    </span>
                  </div>

                  <p className="text-xs text-[#1A1A1A]/70 line-clamp-2 font-serif italic">"{item.caption || 'No caption text'}"</p>

                  <div className="grid grid-cols-3 gap-2 text-[10px] text-[#1A1A1A]/60 font-sans uppercase tracking-wider bg-[#FBF9F6] p-2.5 border border-[#1A1A1A]/5">
                    <div>Likes: <strong className="text-[#1A1A1A]">{item.likeCount}</strong></div>
                    <div>Comments: <strong className="text-[#1A1A1A]">{item.commentCount}</strong></div>
                    <div>Views: <strong className="text-[#1A1A1A]">{item.viewCount}</strong></div>
                  </div>

                  <div className="text-[10px] font-mono text-[#1A1A1A]/40 truncate">
                    URL: <span className="text-[#FF6321]">{item.mediaUrl}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

    </div>
  );
};
