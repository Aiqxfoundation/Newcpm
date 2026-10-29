import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

export type AuthUser = { id: string; name: string; username: string; isAdmin?: boolean };

type AuthValue = {
  user: AuthUser | null;
  ready: boolean;
  signIn: (loginKey: string) => Promise<void>;
  signUp: (username: string, password: string, referral?: string) => Promise<string>;
  signOut: () => void;
};

const AuthContext = createContext<AuthValue>({
  user: null,
  ready: false,
  signIn: async () => undefined,
  signUp: async () => '',
  signOut: () => undefined,
});

const TOKEN_KEY = 'bitnoir-session-token';
const SIGNED_OUT_KEY = 'bitnoir-signed-out';
const DEMO_USER: AuthUser = { id: 'member-alpha', username: 'satoshinode', name: 'SatoshiNode', isAdmin: true };

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const signedOut = sessionStorage.getItem(SIGNED_OUT_KEY) === '1';
    if (!token) {
      // Demo build: start with the demo member unless the visitor explicitly signed out.
      setUser(signedOut ? null : DEMO_USER);
      setReady(true);
      return;
    }
    void sha256(token)
      .then((hash) => supabase.rpc('custom_session', { p_session_token_hash: hash }))
      .then(({ data }) => {
        setUser(data?.user_id ? { id: data.user_id, username: data.username, name: data.username, isAdmin: data.is_admin } : null);
      })
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const signIn = async (loginKey: string) => {
    const sessionToken = crypto.randomUUID() + crypto.randomUUID();
    const { data, error } = await supabase.rpc('custom_login', {
      p_login_key_hash: await sha256(loginKey.trim().toLowerCase()),
      p_session_token_hash: await sha256(sessionToken),
    });
    if (error || !data?.user_id) {
      throw new Error(error?.message?.includes('invalid_login_key') ? 'That login key is not recognized.' : 'Unable to sign in. Please try again.');
    }
    sessionStorage.setItem(TOKEN_KEY, sessionToken);
    sessionStorage.removeItem(SIGNED_OUT_KEY);
    setUser({ id: data.user_id, username: data.username, name: data.username, isAdmin: data.is_admin });
  };

  const signUp = async (username: string, password: string, referral?: string) => {
    const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const loginKey = `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    const { data, error } = await supabase.rpc('custom_signup', {
      p_username: clean,
      p_password: password,
      p_login_key_hash: await sha256(loginKey),
    });
    if (error || !data?.user_id) {
      const message = error?.message || '';
      if (message.includes('username_taken')) throw new Error('That username is already taken.');
      if (message.includes('weak_password')) throw new Error('Choose a password with at least 8 characters.');
      if (message.includes('invalid_username')) throw new Error('Use only letters, numbers, and underscores.');
      throw new Error(message || 'Unable to create your account. Please try again.');
    }
    if (referral) sessionStorage.setItem('bitnoir-pending-referral', referral.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ''));
    return loginKey;
  };

  const signOut = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.setItem(SIGNED_OUT_KEY, '1');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, ready, signIn, signUp, signOut }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
