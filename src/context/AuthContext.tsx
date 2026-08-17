import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, supabaseConfigured, authFetch } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';

interface Profile {
  credits: number;
  apiToken: string | null;
  email: string;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  devMode: boolean;
  serverConfigured: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  generateApiToken: () => Promise<string | null>;
  credits: number | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [serverConfigured, setServerConfigured] = useState(true);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    try {
      const res = await authFetch('/api/auth/me');
      if (res.status === 503) {
        setServerConfigured(false);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setProfile({ credits: data.credits ?? 0, apiToken: data.apiToken ?? null, email: data.user?.email ?? user.email ?? '' });
        setServerConfigured(true);
      }
    } catch {
      // offline — profile as-is
    }
  }, [user]);

  useEffect(() => {
    if (!supabase) {
      setDevMode(true);
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) refreshProfile();
  }, [user, refreshProfile]);

  const signIn = async (email: string, password: string) => {
    if (!supabase) return { error: 'Supabase is not configured' };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message || null };
  };

  const signUp = async (email: string, password: string) => {
    if (!supabase) return { error: 'Supabase is not configured' };
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message || null };
  };

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  };

  const generateApiToken = async (): Promise<string | null> => {
    const res = await authFetch('/api/auth/apitoken', { method: 'POST' });
    if (!res.ok) return null;
    const data = await res.json();
    await refreshProfile();
    return data.apiToken as string;
  };

  const credits = profile?.credits ?? null;

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, devMode, serverConfigured, signIn, signUp, signOut, refreshProfile, generateApiToken, credits }}
    >
      {children}
    </AuthContext.Provider>
  );
};
