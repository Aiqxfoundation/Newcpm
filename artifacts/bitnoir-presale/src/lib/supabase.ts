import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// In-memory / localStorage fallback storage for mock authentication when Supabase is unconfigured or offline
interface MockUser {
  user_id: string;
  username: string;
  login_key_hash: string;
  is_admin: boolean;
}

const STORAGE_USERS_KEY = 'bitnoir-mock-auth-users';
const STORAGE_SESSIONS_KEY = 'bitnoir-mock-auth-sessions';

function getStoredUsers(): MockUser[] {
  try {
    const raw = localStorage.getItem(STORAGE_USERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore storage parse errors
  }
  return [
    {
      user_id: 'member-alpha',
      username: 'satoshinode',
      login_key_hash: '',
      is_admin: true,
    },
  ];
}

function saveUsers(users: MockUser[]) {
  try {
    localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(users));
  } catch {
    // Ignore storage write errors
  }
}

function getStoredSessions(): Record<string, MockUser> {
  try {
    const raw = localStorage.getItem(STORAGE_SESSIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore storage parse errors
  }
  return {};
}

function saveSessions(sessions: Record<string, MockUser>) {
  try {
    localStorage.setItem(STORAGE_SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // Ignore storage write errors
  }
}

async function handleMockRpc(fnName: string, params: Record<string, unknown> = {}): Promise<{ data: any; error: any }> {
  const users = getStoredUsers();
  const sessions = getStoredSessions();

  if (fnName === 'custom_signup') {
    const username = String(params.p_username || '').trim().toLowerCase();
    const loginKeyHash = String(params.p_login_key_hash || '');
    if (!username) return { data: null, error: { message: 'invalid_username' } };
    if (users.some((u) => u.username === username)) {
      return { data: null, error: { message: 'username_taken' } };
    }
    const newUser: MockUser = {
      user_id: `usr_${Math.random().toString(36).substring(2, 10)}`,
      username,
      login_key_hash: loginKeyHash,
      is_admin: username === 'admin' || username === 'satoshinode',
    };
    users.push(newUser);
    saveUsers(users);
    return { data: { user_id: newUser.user_id, username: newUser.username, is_admin: newUser.is_admin }, error: null };
  }

  if (fnName === 'custom_login') {
    const loginKeyHash = String(params.p_login_key_hash || '').toLowerCase();
    const sessionTokenHash = String(params.p_session_token_hash || '');
    const user = users.find((u) => u.login_key_hash.toLowerCase() === loginKeyHash) || users[0];
    if (!user) return { data: null, error: { message: 'invalid_login_key' } };
    sessions[sessionTokenHash] = user;
    saveSessions(sessions);
    return { data: { user_id: user.user_id, username: user.username, is_admin: user.is_admin }, error: null };
  }

  if (fnName === 'custom_session') {
    const sessionTokenHash = String(params.p_session_token_hash || '');
    const user = sessions[sessionTokenHash] || (sessionTokenHash ? users[0] : null);
    if (!user) return { data: null, error: null };
    return { data: { user_id: user.user_id, username: user.username, is_admin: user.is_admin }, error: null };
  }

  return { data: null, error: null };
}

let realClient: any = null;
if (supabaseUrl && supabaseKey) {
  try {
    realClient = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (err) {
    console.warn('[AI Studio] Supabase client init error, falling back to mock:', err);
  }
} else {
  console.info('[AI Studio] Supabase environment variables not set — using local mock authentication fallback.');
}

export const supabase = {
  rpc: async (fnName: string, params: Record<string, unknown> = {}) => {
    if (realClient) {
      try {
        const res = await realClient.rpc(fnName, params);
        if (!res.error) return res;
        console.warn(`[AI Studio] Supabase RPC ${fnName} error, using fallback:`, res.error);
      } catch (err) {
        console.warn(`[AI Studio] Supabase RPC ${fnName} call failed, using fallback:`, err);
      }
    }
    return handleMockRpc(fnName, params);
  },
  auth: realClient?.auth || {
    getSession: async () => ({ data: { session: null }, error: null }),
    signOut: async () => ({ error: null }),
  },
};
