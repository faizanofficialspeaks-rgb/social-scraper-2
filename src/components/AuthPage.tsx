import React, { useState } from 'react';
import { Mail, Lock, ArrowRight, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { isDisposableEmail } from '../lib/disposableEmails';

interface AuthPageProps {
  onBack: () => void;
  onAuthed: () => void;
  onDevEnter?: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ onBack, onAuthed, onDevEnter }) => {
  const { signIn, signUp, devMode } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!supabaseConfigured) {
      setError('Supabase keys are not set on the server — check SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.');
      return;
    }
    if (mode === 'signup' && isDisposableEmail(email)) {
      setError('Disposable / temporary email addresses are not allowed. Use a real email to get the 1000 free credits.');
      return;
    }
    setBusy(true);
    const { error: err } = mode === 'login' ? await signIn(email, password) : await signUp(email, password);
    setBusy(false);
    if (err) {
      if (mode === 'signup' && /already registered|already been registered|already exists/i.test(err)) {
        setMode('login');
        setError('An account with this email already exists — sign in instead.');
        return;
      }
      if (mode === 'signup' && /confirmation/i.test(err)) {
        setInfo(err + ' — Check your email to confirm, then sign in.');
      } else {
        setError(err);
      }
      return;
    }
    if (mode === 'signup' && !err) {
      setInfo('Account created! Sign in to continue.');
      setMode('login');
      return;
    }
    onAuthed();
  };

  const handleGoogle = async () => {
    setError(null);
    setInfo(null);
    if (!supabase) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) setError(error.message);
    } catch (e: any) {
      setError(e?.message || 'Google login failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDevEnter = () => {
    setInfo('Dev mode: opening the app without authentication (Supabase keys are still required for production).');
    if (onDevEnter) onDevEnter();
    setTimeout(onAuthed, 300);
  };

  return (
    <div className="min-h-screen bg-[#000000] text-[#ebebeb] landing-font antialiased selection:bg-[#ccff00] selection:text-black flex items-center justify-center p-4">
      <div className="w-full max-w-[1600px]">
        <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[calc(100vh-2rem)] rounded-[2.5rem] ring-1 ring-white/10 bg-[#0c0c0c] overflow-hidden landing-noise">
          {/* Left: pitch panel */}
          <div className="hidden lg:flex flex-col justify-between p-14 relative landing-grid-bg">
            <button onClick={onBack} className="flex items-center gap-2 text-white/50 hover:text-white text-sm transition-colors cursor-pointer w-fit">
              ← Back to home
            </button>
            <div>
              <div className="w-12 h-12 rounded-xl bg-[#ccff00] text-black flex items-center justify-center font-bold text-2xl mb-8">S</div>
              <h2 className="text-5xl font-bold tracking-[-0.05em] leading-[1.05]">
                Sign in,
                <br />
                <span className="italic text-[#ccff00]">grab 1000 free credits</span>
                <br />
                and get started.
              </h2>
              <div className="mt-8 space-y-3">
                {['1 video = 1 credit', 'Deducted on downloads & exports', 'API token for the extension'].map((t) => (
                  <div key={t} className="flex items-center gap-2 text-white/60 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-[#ccff00]" /> {t}
                  </div>
                ))}
              </div>
            </div>
            <div className="landing-mono text-[10px] uppercase tracking-[0.2em] text-white/30">
              Scrape · Curate · Auto-post
            </div>
          </div>

          {/* Right: form */}
          <div className="flex items-center justify-center p-8 lg:p-14">
            <div className="w-full max-w-md">
              <button onClick={onBack} className="lg:hidden flex items-center gap-2 text-white/50 hover:text-white text-sm mb-8 cursor-pointer">
                ← Back to home
              </button>

              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-[#ccff00]" />
                <span className="landing-mono text-[10px] uppercase tracking-[0.25em] text-white/50">SocialScraper Account</span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight mb-1">
                {mode === 'login' ? 'Welcome back' : 'Create account'}
              </h1>
              <p className="text-white/50 text-sm mb-8">
                {mode === 'login' ? 'Access your credits and dashboard.' : 'Get 1000 credits instantly on signup.'}
              </p>

              {!supabaseConfigured && (
                <div className="mb-6 p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300 text-xs flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Supabase keys not found (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Set the keys and rebuild to enable auth.</span>
                </div>
              )}

              {devMode && (
                <button
                  onClick={handleDevEnter}
                  className="mb-6 w-full p-3 rounded-xl border border-[#ccff00]/40 bg-[#ccff00]/10 text-[#ccff00] text-sm font-bold cursor-pointer hover:bg-[#ccff00]/20 transition-colors"
                >
                  Dev Mode — open app without authentication
                </button>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="landing-mono text-[10px] uppercase tracking-[0.2em] text-white/50 mb-2 block">Email</label>
                  <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 focus-within:border-[#ccff00]/60 transition-colors">
                    <Mail className="w-4 h-4 text-white/40" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-white/25"
                    />
                  </div>
                </div>
                <div>
                  <label className="landing-mono text-[10px] uppercase tracking-[0.2em] text-white/50 mb-2 block">Password</label>
                  <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 focus-within:border-[#ccff00]/60 transition-colors">
                    <Lock className="w-4 h-4 text-white/40" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-white/25"
                    />
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs">{error}</div>
                )}
                {info && (
                  <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-xs">{info}</div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full flex items-center justify-center gap-2 bg-[#ccff00] text-black font-bold rounded-xl px-6 py-4 text-sm hover:scale-[1.02] transition-transform disabled:opacity-50 cursor-pointer"
                  style={{ boxShadow: '0 0 24px rgba(204,255,0,0.25)' }}
                >
                  {busy ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create account'} <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="flex items-center gap-3 my-5">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-white/30">or continue with</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <button
                onClick={handleGoogle}
                disabled={busy || !supabaseConfigured}
                className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-bold text-white hover:bg-white/10 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.86c2.26-2.09 3.56-5.17 3.56-8.87z"/>
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z"/>
                  <path fill="#FBBC05" d="M5.27 14.29A7.17 7.17 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09z"/>
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"/>
                </svg>
                {mode === 'login' ? 'Sign in with Google' : 'Sign up with Google'}
              </button>

              <p className="mt-4 text-center text-[10px] text-white/25">
                Google sign-in creates an account automatically the first time — no separate signup needed.
              </p>

              <div className="mt-6 text-center text-sm text-white/40">
                {mode === 'login' ? (
                  <>New here?{' '}
                    <button onClick={() => { setMode('signup'); setError(null); setInfo(null); }} className="text-[#ccff00] font-bold cursor-pointer hover:underline">Sign up</button>
                  </>
                ) : (
                  <>Already have an account?{' '}
                    <button onClick={() => { setMode('login'); setError(null); setInfo(null); }} className="text-[#ccff00] font-bold cursor-pointer hover:underline">Sign in</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
