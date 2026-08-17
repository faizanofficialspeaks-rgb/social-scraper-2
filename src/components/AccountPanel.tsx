import React, { useState } from 'react';
import { KeyRound, Copy, Check, RefreshCw, ShieldCheck, Zap, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const AccountPanel: React.FC = () => {
  const { user, profile, credits, generateApiToken, serverConfigured } = useAuth();
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleGenerate = async () => {
    setBusy(true);
    setMsg(null);
    const token = await generateApiToken();
    setBusy(false);
    if (!token) {
      setMsg('Token could not be generated — is the server connected?');
      return;
    }
    setShowToken(true);
    setMsg('New API token created. Paste it into the extension Settings.');
  };

  const copyToken = async () => {
    if (!profile?.apiToken) return;
    await navigator.clipboard.writeText(profile.apiToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-[#1A1A1A] text-white p-6 border border-white/10 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-4 h-4 text-[#ccff00]" />
            <span className="px-2 py-0.5 text-white text-[9px] font-bold uppercase tracking-[0.2em] bg-[#ccff00]/20 border border-[#ccff00]/40 text-[#ccff00]">
              Account & Credits
            </span>
          </div>
          <h2 className="font-serif text-2xl text-white">My Account</h2>
          <p className="text-xs text-white/50 mt-1 font-mono">{user?.email || profile?.email || '—'}</p>
        </div>
        <div className="flex items-center gap-3 px-5 py-3 border border-[#ccff00]/40 bg-[#ccff00]/10">
          <Zap className="w-5 h-5 text-[#ccff00]" />
          <div>
            <div className="text-2xl font-bold text-[#ccff00] leading-none">{credits ?? '—'}</div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-white/50 mt-1">credits · 1 video = 1 credit</div>
          </div>
        </div>
      </div>

      {!serverConfigured && (
        <div className="flex items-start gap-2 p-3 border border-amber-500/40 bg-amber-950/40 text-amber-300 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Supabase keys not found on the server — credits are not syncing. Set the SUPABASE_* keys in .env.
        </div>
      )}

      <div className="border-t border-white/10 pt-5">
        <div className="flex items-center gap-2 mb-2">
          <KeyRound className="w-4 h-4 text-[#ccff00]" />
          <h3 className="text-sm font-bold uppercase tracking-[0.15em] text-white/80">Chrome Extension API Token</h3>
        </div>
        <p className="text-xs text-white/50 leading-relaxed mb-4 max-w-2xl">
          This token gates access to the Chrome extension — the extension verifies it before every scrape.
          Paste it into the extension Options (right-click icon → Options) under "API Token".
          If the token leaks, generate a new one — the old one becomes invalid automatically.
        </p>

        {profile?.apiToken ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 bg-black/50 border border-white/15 rounded px-4 py-3">
              <code className="flex-1 text-[12px] font-mono text-[#ccff00] break-all">
                {showToken ? profile.apiToken : '•'.repeat(Math.min(32, (profile.apiToken || '').length))}
              </code>
              <button
                onClick={() => setShowToken(!showToken)}
                className="text-[10px] uppercase tracking-widest text-white/50 hover:text-white cursor-pointer"
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
              <button
                onClick={copyToken}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#ccff00] text-black text-[10px] font-bold uppercase tracking-widest hover:bg-white cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button
              onClick={handleGenerate}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2 border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:text-white hover:border-white/40 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} /> Generate New Token
            </button>
          </div>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={busy}
            className="flex items-center gap-2 px-5 py-3 bg-[#ccff00] text-black text-[11px] font-bold uppercase tracking-widest hover:bg-white cursor-pointer disabled:opacity-50"
          >
            <KeyRound className="w-4 h-4" /> {busy ? 'Generating...' : 'Generate API Token'}
          </button>
        )}

        {msg && <p className="mt-3 text-xs text-emerald-400">{msg}</p>}
      </div>
    </div>
  );
};
