/**
 * Autenticação: Supabase (produção) ou login de desenvolvimento (DEV_LOGIN=1 no servidor).
 * O token fica na sessão da aba (dev) ou no cliente Supabase.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { api, configureApi } from './api';

export interface Me { id: string; email: string | null; full_name: string | null; crm: string | null }
type Mode = 'supabase' | 'dev' | 'none';

interface AuthState {
  mode: Mode | null;
  me: Me | null;
  loading: boolean;
  supabase: SupabaseClient | null;
  loginDev(email: string, full_name: string, crm: string): Promise<void>;
  loginSupabase(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refreshMe(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const DEV_KEY = 'dh.devtoken';

function readDevToken(): string | null {
  try { return sessionStorage.getItem(DEV_KEY); } catch { return null; }
}
function writeDevToken(t: string | null) {
  try { t ? sessionStorage.setItem(DEV_KEY, t) : sessionStorage.removeItem(DEV_KEY); } catch { /* armazenamento indisponível */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [devToken, setDevToken] = useState<string | null>(readDevToken);

  const token = useCallback(async () => {
    if (supabase) return (await supabase.auth.getSession()).data.session?.access_token ?? null;
    return devToken;
  }, [supabase, devToken]);

  const logout = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    writeDevToken(null);
    setDevToken(null);
    setMe(null);
  }, [supabase]);

  useEffect(() => { configureApi({ token, unauthorized: () => { void logout(); } }); }, [token, logout]);

  const refreshMe = useCallback(async () => {
    if (!(await token())) { setMe(null); return; }
    try { setMe(await api.get<Me>('/api/me')); } catch { setMe(null); }
  }, [token]);

  // Configuração pública do servidor define o modo de login
  useEffect(() => {
    (async () => {
      const cfg = await fetch('/api/public/config').then((r) => r.json()).catch(() => ({ auth: 'none' }));
      if (cfg.auth === 'supabase') {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
        setSupabase(sb);
        sb.auth.onAuthStateChange(() => { void 0; });
      }
      setMode(cfg.auth);
    })();
  }, []);

  useEffect(() => {
    if (mode === null) return;
    setLoading(true);
    refreshMe().finally(() => setLoading(false));
  }, [mode, refreshMe]);

  const value = useMemo<AuthState>(() => ({
    mode, me, loading, supabase,
    async loginDev(email, full_name, crm) {
      const r = await api.post<{ access_token: string }>('/api/public/dev-login', { email, full_name, crm });
      writeDevToken(r.access_token);
      setDevToken(r.access_token);
    },
    async loginSupabase(email, password) {
      if (!supabase) throw new Error('Supabase não configurado.');
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha inválidos.' : error.message);
      await refreshMe();
    },
    logout,
    refreshMe
  }), [mode, me, loading, supabase, logout, refreshMe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider ausente');
  return c;
}
