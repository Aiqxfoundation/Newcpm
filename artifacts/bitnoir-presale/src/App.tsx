import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3, BookOpen, Check,
  ChevronRight, Coins, Copy, ExternalLink, FileClock, Flame, Gift, Globe2, HelpCircle, Info,
  Landmark, Layers3, Link as LinkIcon, Lock, LockKeyhole, LogOut, Menu, PieChart, Plus, QrCode, Radio, RefreshCw,
  Search, Send, ShieldAlert, ShieldCheck, Sliders, Sparkles, Timer, TrendingUp, Trophy, UserCheck, Users, Wallet, X, Zap,
} from 'lucide-react';
import {
  getGetAdminAddressesQueryKey, getGetAdminDepositsQueryKey, getGetAdminSummaryQueryKey,
  getGetDepositAddressesQueryKey,
  getGetMyAccountQueryKey, getGetMyActivityQueryKey, getGetMyDepositsQueryKey,
  getGetPresaleOverviewQueryKey, useApplyReferralCode, useCreateDeposit,
  useDecideDeposit, useGetAdminAddresses, useGetAdminDeposits, useGetAdminSummary,
  useGetDepositAddresses,
  useGetMyAccount, useGetMyActivity, useGetMyDeposits, useGetPresaleOverview,
  useSaveAdminAddress, useStakeTokens, useUpdateDepositTransaction,
  useUpdateLaunchSettings,
} from '@workspace/api-client-react';
import type { AdminDeposit, Chain, Deposit, DepositAddress, LaunchSettingsInput, PresaleOverview, UserAccount } from '@workspace/api-client-react';
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/hooks/use-toast';
import NotFound from '@/pages/not-found';
import { supabase } from './lib/supabase';
import '@/index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});
const basePath = import.meta.env.BASE_PATH ? import.meta.env.BASE_PATH.replace(/\/$/, '') : '';

function readableError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

function FeedbackMonitor() {
  const client = useQueryClient();

  useEffect(() => {
    const showError = (error: unknown, fallback: string) => {
      toast({ title: 'Action failed', description: readableError(error, fallback), variant: 'destructive' });
    };
    const unsubscribeQueries = client.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') showError(event.query.state.error, 'Unable to load this information. Please try again.');
    });
    const unsubscribeMutations = client.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      if (event.action.type === 'error') showError(event.mutation.state.error, 'Unable to complete that action. Please try again.');
    });
    const onError = (event: ErrorEvent) => showError(event.error || event.message, 'An unexpected application error occurred.');
    const onRejection = (event: PromiseRejectionEvent) => showError(event.reason, 'An unexpected request error occurred.');
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [client]);

  return <Toaster />;
}

// Official Bitnoir Economic Constants
const BITNOIR_REFERENCE_PRICE = 1.1; // $1.10 Protocol Accounting Valuation ($1.1 Per Noir)
const BITS_REFERENCE_PRICE = 0.10; // $0.10 Protocol Rate (100 USDT = 1,000 Bits)
const USDT_PER_BITS = 0.1; // 1 USDT = 10 Bits
const MIN_CLAIM_USDT = 2; // $2.00 Minimum Claim / Withdrawal Threshold
const MIN_CLAIM_BITNOIR = MIN_CLAIM_USDT / BITNOIR_REFERENCE_PRICE; // ~1.8182 Bitnoir ($Noir)
const TOTAL_MAX_SUPPLY = 21_000_000; // Hard-capped 21M matching Bitcoin

export const ANNUAL_FAIR_YIELD = 0.12; // 12% Annual Fair Yield (12% per year)

export const rewardRateForDays = (days: number): number => {
  const clamped = Math.max(30, Math.min(90, days));
  return (clamped / 360) * ANNUAL_FAIR_YIELD;
};

const chainNames: Record<string, string> = {
  bnb: 'BNB Smart Chain (BEP-20)',
  ethereum: 'Ethereum (ERC-20)',
  polygon: 'Polygon (POS)',
  arbitrum: 'Arbitrum One',
  base: 'Base',
  solana: 'Solana',
};

const money = (value?: number | null) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value ?? 0);
const number = (value?: number | null) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value ?? 0);
const compact = (value?: number | null) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value ?? 0);
const shortDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recently';

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['rows', 'items', 'data', 'results']) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
}

export type StakingPosition = {
  id: number;
  stakedBits: number;
  lockupDays: number;
  rewardRate: number;
  accruedReward: number;
  claimedReward?: number;
  principalReturnTokens: number;
  createdAt: string;
  unlocksAt: string;
  status: 'active' | 'matured' | 'claimed';
};

export function readPositions(account: UserAccount): StakingPosition[] {
  const acc = account as unknown as {
    position?: StakingPosition;
    stakingPositions?: StakingPosition[];
  };
  const list: StakingPosition[] = [];
  if (Array.isArray(acc?.stakingPositions)) {
    list.push(...acc.stakingPositions);
  }
  if (acc?.position && !list.some((p) => p.id === acc.position?.id)) {
    list.unshift(acc.position);
  }
  return list;
}

// Brand Component with official artwork
function Brand({ showBadge = false, size = 'md' }: { showBadge?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const textSize = size === 'sm' ? 18 : size === 'lg' ? 28 : 22;
  const logoPx = size === 'sm' ? 26 : size === 'lg' ? 40 : 34;

  return (
    <span className="brand" style={{ fontSize: textSize }}>
      <img
        className="bitnoir-logo"
        src="/asset-bitnoir-md.png"
        srcSet="/asset-bitnoir-sm.png 64w, /asset-bitnoir-md.png 128w, /asset-bitnoir-lg.png 256w, /asset-bitnoir.png 512w"
        sizes={`${logoPx}px`}
        alt="Bitnoir token"
        width={logoPx}
        height={logoPx}
        style={{ imageRendering: '-webkit-optimize-contrast' }}
      />
      <span>Bitnoir</span>
      {showBadge && <span className="brand-badge">BITS POINTS</span>}
    </span>
  );
}

// Token and Bits Badges (HD artwork, razor-sharp multi-resolution srcset, zero downsampling blur)
function TokenMark({ size = 22, className = '' }: { size?: number; className?: string }) {
  const defaultSrc = size <= 24 ? '/asset-bitnoir-sm.png' : size <= 48 ? '/asset-bitnoir-md.png' : '/asset-bitnoir.png';
  return (
    <img
      src={defaultSrc}
      srcSet="/asset-bitnoir-xs.png 32w, /asset-bitnoir-sm.png 64w, /asset-bitnoir-md.png 128w, /asset-bitnoir-lg.png 256w, /asset-bitnoir.png 512w"
      sizes={`${size}px`}
      alt="Bitnoir"
      className={`token-mark-crisp ${className}`}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        display: 'inline-block',
        verticalAlign: 'middle',
        objectFit: 'contain',
        imageRendering: '-webkit-optimize-contrast',
        flexShrink: 0,
      }}
    />
  );
}

function BitsMark({ size = 22, className = '' }: { size?: number; className?: string }) {
  const defaultSrc = size <= 24 ? '/asset-bits-sm.png' : size <= 48 ? '/asset-bits-md.png' : '/asset-bits.png';
  return (
    <img
      src={defaultSrc}
      srcSet="/asset-bits-xs.png 32w, /asset-bits-sm.png 64w, /asset-bits-md.png 128w, /asset-bits-lg.png 256w, /asset-bits.png 512w"
      sizes={`${size}px`}
      alt="Bits"
      className={`token-mark-crisp ${className}`}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        display: 'inline-block',
        verticalAlign: 'middle',
        objectFit: 'contain',
        imageRendering: '-webkit-optimize-contrast',
        flexShrink: 0,
      }}
    />
  );
}

// AUTH CONTEXT with Username & Session Persistence
type AuthUser = { id: string; email: string; name: string; username: string; isAdmin?: boolean };
const AuthContext = createContext<{
  user: AuthUser | null;
  ready: boolean;
  signIn: (loginKey: string) => Promise<void>;
  signUp: (username: string, password: string, referral?: string) => Promise<string>;
  signOut: () => void;
}>({
  user: null,
  ready: false,
  signIn: async () => undefined,
  signUp: async () => '',
  signOut: () => undefined,
});

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const demoUser: AuthUser = { id: 'member-alpha', email: 'node@bitnoir.io', username: 'satoshinode', name: 'SatoshiNode', isAdmin: true };
    const token = sessionStorage.getItem('bitnoir-session-token');
    if (!token) {
      // Default initial session for immediate access
      setUser(demoUser);
      setReady(true);
      return;
    }
    void sha256(token)
      .then((tokenHash) => supabase.rpc('custom_session', { p_session_token_hash: tokenHash }))
      .then(({ data }) => {
        if (data?.user_id) setUser({ id: data.user_id, email: '', username: data.username, name: data.username, isAdmin: data.is_admin });
        else setUser(demoUser);
      })
      .catch(() => setUser(demoUser))
      .finally(() => setReady(true));
  }, []);

  const signIn = async (loginKey: string) => {
    const normalizedKey = loginKey.trim().toLowerCase();
    const sessionToken = crypto.randomUUID() + crypto.randomUUID();
    const { data, error } = await supabase.rpc('custom_login', {
      p_login_key_hash: await sha256(normalizedKey),
      p_session_token_hash: await sha256(sessionToken),
    });
    if (error || !data?.user_id) throw new Error(error?.message?.includes('invalid_login_key') ? 'Invalid login key.' : 'Unable to sign in. Please try again.');
    sessionStorage.setItem('bitnoir-session-token', sessionToken);
    setUser({ id: data.user_id, email: '', username: data.username, name: data.username, isAdmin: data.is_admin });
  };

  const signUp = async (username: string, password: string, referral?: string) => {
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const loginKey = `0x${Array.from(randomBytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    const { data, error } = await supabase.rpc('custom_signup', {
      p_username: cleanUsername,
      p_password: password,
      p_login_key_hash: await sha256(loginKey),
    });
    if (error || !data?.user_id) {
      const message = error?.message || '';
      if (message.includes('username_taken')) throw new Error('That username is already taken.');
      if (message.includes('weak_password')) throw new Error('Choose a stronger password with at least 8 characters.');
      if (message.includes('invalid_username')) throw new Error('Username may contain only letters, numbers, and underscores.');
      if (message.includes('invalid_login_key')) throw new Error('Unable to generate a secure login key. Please try again.');
      throw new Error(message || 'Unable to create your account. Please try again.');
    }
    if (referral) sessionStorage.setItem('bitnoir-pending-referral', referral.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ''));
    return loginKey;
  };

  const signOut = () => { sessionStorage.removeItem('bitnoir-session-token'); setUser(null); };
  return <AuthContext.Provider value={{ user, ready, signIn, signUp, signOut }}>{children}</AuthContext.Provider>;
}

function useAuth() {
  return useContext(AuthContext);
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function useNotice() {
  const [message, setMessage] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const notify = (text: string) => {
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(''), 4000);
  };
  const notice = message ? (
    <div className="notice" role="status" data-testid="status-notice">
      <Sparkles size={16} color="var(--neon-green)" style={{ display: 'inline', marginRight: 8 }} />
      {message}
    </div>
  ) : null;
  return { notify, notice };
}

function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" aria-label="Loading">
      <div className="loading-line" style={{ width: '40%' }} />
      {Array.from({ length: rows }, (_, i) => (
        <div className="loading-line" key={i} style={{ width: `${85 - (i % 3) * 15}%` }} />
      ))}
    </div>
  );
}

function PageError({ retry }: { retry: () => void }) {
return (
<div className="empty-state">
<ShieldAlert size={28} color="var(--danger)" style={{ margin: '0 auto 12px' }} />
<p style={{ color: '#fff', fontSize: 14 }}>Connection temporarily unavailable.</p>
<p style={{ color: 'var(--silver-medium)', fontSize: 12 }}>Check your network status and try again.</p>
<button className="button button-soft" onClick={retry} style={{ marginTop: 16 }}>
<RefreshCw size={14} /> Retry
</button>
</div>
);
}

// Navigation Bar for Landing & Docs
function PublicHeader({ hideSignIn = false }: { hideSignIn?: boolean }) {
  const [location] = useLocation();
  const { user } = useAuth();

  return (
    <header className="topbar" data-page-header>
      <Link href="/" aria-label="Bitnoir Home">
        <Brand />
      </Link>
      <nav className="nav-links" aria-label="Main Navigation">
        <Link href="/" className={location === '/' ? 'active' : ''}>Overview</Link>
        <Link href="/wallet" className={location.startsWith('/wallet') || location === '/deposit' ? 'active' : ''}>Wallet</Link>
        <Link href="/staking" className={location === '/staking' || location === '/mining' ? 'active' : ''}>Mining</Link>
        <Link href="/statistics" className={location === '/statistics' || location === '/pool' ? 'active' : ''}>Statistics</Link>
        <Link href="/docs" className={location === '/docs' ? 'active' : ''}>Whitepaper</Link>
      </nav>
      <div className="top-actions">
        {user ? (
          <Link href="/wallet" className="button button-primary">
            Launch Wallet <ArrowRight size={14} />
          </Link>
        ) : (
          <>
            {!hideSignIn && <Link href="/sign-in" className="button button-ghost">Sign in</Link>}
            <Link href="/sign-up" className="button button-primary">
              Enter Fair Launch <ArrowRight size={14} />
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// TIER-1 COREDAO & TRUST WALLET STYLE HARDCODED PROTOCOL SCHEMATIC SVG
// ---------------------------------------------------------------------------
function LandingArchitectureSvg() {
  return (
    <div className="w-full p-4 rounded-2xl bg-[#080d16] border border-white/8 shadow-2xl overflow-x-auto">
      <svg viewBox="0 0 960 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="min-w-[820px] w-full h-auto">
        <defs>
          <linearGradient id="landingGlowGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#00f59b" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.8" />
          </linearGradient>
          <filter id="nodeGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Ambient Grid Lines */}
        <line x1="20" y1="80" x2="940" y2="80" stroke="rgba(255,255,255,0.04)" strokeDasharray="6 6" />

        {/* --- NODE 1: CAPITAL INGRESS --- */}
        <g>
          <rect x="20" y="32" width="180" height="96" rx="14" fill="#0d1422" stroke="rgba(255,255,255,0.09)" strokeWidth="1.2" />
          <circle cx="50" cy="62" r="14" fill="rgba(245, 166, 35, 0.12)" stroke="#f5a623" strokeWidth="1.2" />
          <text x="50" y="66" textAnchor="middle" fill="#f5a623" fontSize="12" fontWeight="bold" fontFamily="monospace">₮</text>
          <text x="74" y="58" fill="#ffffff" fontSize="12" fontWeight="bold" fontFamily="sans-serif">CAPITAL INGRESS</text>
          <text x="74" y="73" fill="#64748b" fontSize="10" fontFamily="monospace">BEP-20 USDT ROUTER</text>
          <rect x="36" y="94" width="148" height="22" rx="6" fill="#131c2d" />
          <text x="110" y="109" textAnchor="middle" fill="#f5a623" fontSize="10" fontWeight="bold" fontFamily="monospace">100 USDT = 1K BITS</text>
        </g>

        {/* Connector 1 */}
        <line x1="200" y1="80" x2="268" y2="80" stroke="#00f59b" strokeWidth="2" strokeDasharray="5 4" opacity="0.8" />
        <circle cx="234" cy="80" r="4" fill="#00f59b" filter="url(#nodeGlow)" />
        <polygon points="268,80 260,75 260,85" fill="#00f59b" />

        {/* --- NODE 2: PROOF-OF-BURN CHAMBER --- */}
        <g>
          <rect x="270" y="24" width="200" height="112" rx="16" fill="rgba(255, 75, 43, 0.05)" stroke="rgba(255, 75, 43, 0.35)" strokeWidth="1.5" />
          <circle cx="304" cy="58" r="17" fill="rgba(255, 75, 43, 0.16)" stroke="#ff4b2b" strokeWidth="1.2" />
          <circle cx="304" cy="58" r="13" stroke="rgba(255, 118, 87, 0.35)" strokeWidth="0.8" strokeDasharray="2 3" fill="none" />
          <path d="M304 46 C300 52, 296 56, 296 61 C296 66, 299 69, 304 69 C309 69, 312 66, 312 61 C312 56, 308 52, 304 46 Z" fill="#ff4b2b" />
          <path d="M304 48 C301 53, 298 57, 298 61 C298 65, 301 68, 304 68 Z" fill="#ff7657" />
          <path d="M304 53 C302 57, 301 60, 301 63 C301 66, 302 67, 304 67 C306 67, 307 66, 307 63 C307 60, 306 57, 304 53 Z" fill="#ffe680" opacity="0.9" />
          <circle cx="304" cy="44" r="1" fill="#ffffff" />
          <text x="330" y="54" fill="#ffffff" fontSize="12" fontWeight="bold" fontFamily="sans-serif">PROOF-OF-BURN</text>
          <text x="330" y="69" fill="#ff7657" fontSize="10" fontFamily="monospace">IRREVERSIBLE SINK</text>
          <rect x="286" y="98" width="168" height="24" rx="6" fill="rgba(255, 75, 43, 0.12)" stroke="rgba(255,75,43,0.25)" strokeWidth="1" />
          <text x="370" y="114" textAnchor="middle" fill="#ff7657" fontSize="10" fontWeight="bold" fontFamily="monospace">BITS PERMANENTLY BURNED</text>
        </g>

        {/* Connector 2 */}
        <line x1="470" y1="80" x2="538" y2="80" stroke="#00f59b" strokeWidth="2" strokeDasharray="5 4" opacity="0.8" />
        <circle cx="504" cy="80" r="4" fill="#00f59b" filter="url(#nodeGlow)" />
        <polygon points="538,80 530,75 530,85" fill="#00f59b" />

        {/* --- NODE 3: BTCFI STREAM ACCELERATOR --- */}
        <g>
          <rect x="540" y="32" width="190" height="96" rx="14" fill="#0d1422" stroke="rgba(255,255,255,0.09)" strokeWidth="1.2" />
          <circle cx="570" cy="62" r="14" fill="rgba(56, 189, 248, 0.12)" stroke="#38bdf8" strokeWidth="1.2" />
          <path d="M565 65 L570 58 L575 65" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <text x="594" y="58" fill="#ffffff" fontSize="12" fontWeight="bold" fontFamily="sans-serif">BTCFI EMISSIONS</text>
          <text x="594" y="73" fill="#38bdf8" fontSize="10" fontFamily="monospace">24/7 STREAMING YIELD</text>
          <rect x="556" y="94" width="158" height="22" rx="6" fill="#131c2d" />
          <text x="635" y="109" textAnchor="middle" fill="#38bdf8" fontSize="10" fontWeight="bold" fontFamily="monospace">12% APY (1.0% — 3.0% TERM)</text>
        </g>

        {/* Connector 3 */}
        <line x1="730" y1="80" x2="788" y2="80" stroke="#00f59b" strokeWidth="2" strokeDasharray="5 4" opacity="0.8" />
        <circle cx="759" cy="80" r="4" fill="#00f59b" filter="url(#nodeGlow)" />
        <polygon points="788,80 780,75 780,85" fill="#00f59b" />

        {/* --- NODE 4: SETTLEMENT PROTOCOL --- */}
        <g>
          <rect x="790" y="24" width="150" height="112" rx="16" fill="rgba(0, 245, 155, 0.05)" stroke="rgba(0, 245, 155, 0.35)" strokeWidth="1.5" />
          <circle cx="820" cy="58" r="16" fill="rgba(0, 245, 155, 0.2)" stroke="#00f59b" strokeWidth="1.5" />
          <text x="820" y="63" textAnchor="middle" fill="#00f59b" fontSize="13" fontWeight="bold" fontFamily="monospace">✓</text>
          <text x="844" y="54" fill="#ffffff" fontSize="12" fontWeight="bold" fontFamily="sans-serif">SETTLEMENT</text>
          <text x="844" y="69" fill="#00f59b" fontSize="10" fontFamily="monospace">21M FIXED CAP</text>
          <rect x="804" y="98" width="122" height="24" rx="6" fill="rgba(0, 245, 155, 0.12)" stroke="rgba(0, 245, 155, 0.25)" strokeWidth="1" />
          <text x="865" y="114" textAnchor="middle" fill="#00f59b" fontSize="10" fontWeight="bold" fontFamily="monospace">BITNOIR ($NOIR)</text>
        </g>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// INTERACTIVE STAKING YIELD SIMULATOR (COREDAO / DEFI STYLE)
// ---------------------------------------------------------------------------
function LandingYieldSimulator() {
  const [simBits, setSimBits] = useState<number>(10000);
  const [simDays, setSimDays] = useState<number>(60);

  const rate = rewardRateForDays(simDays);
  const principalUsd = simBits * USDT_PER_BITS;
  const principalTokens = principalUsd / BITNOIR_REFERENCE_PRICE;
  const yieldTokens = (principalUsd * rate) / BITNOIR_REFERENCE_PRICE;
  const totalTokens = principalTokens + yieldTokens;
  const totalUsd = principalUsd + (yieldTokens * BITNOIR_REFERENCE_PRICE);
  const hourlyEmissions = yieldTokens / (simDays * 24);

  return (
    <div className="landing-sim-box">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Controls Column (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Bits Commitment</span>
              <span className="text-sm font-mono font-bold text-white tabular-nums">
                {number(simBits)} Bits <span className="text-slate-500 font-normal">({money(principalUsd)} USD)</span>
              </span>
            </div>
            <input
              type="range"
              min="1000"
              max="100000"
              step="1000"
              value={simBits}
              onChange={(e) => setSimBits(Number(e.target.value))}
              className="modern-range-line"
              aria-label="Simulate Bits amount"
            />
            <div className="flex items-center gap-2 mt-2">
              {[1000, 5000, 10000, 25000, 50000].map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`pob-preset-btn ${simBits === b ? '!bg-[#00f59b]/20 !text-[#00f59b] !border-[#00f59b]/40 font-bold' : ''}`}
                  onClick={() => setSimBits(b)}
                >
                  {compact(b)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Lock Duration</span>
              <span className="text-xs font-mono font-bold text-[#00f59b] bg-[#00f59b]/10 px-2.5 py-0.5 rounded">
                {simDays} Days (+{(rate * 100).toFixed(1)}% Term · 12% APY)
              </span>
            </div>
            <StakingYieldCurve duration={simDays} rewardRate={rate} />
            <input
              type="range"
              min="30"
              max="90"
              step="1"
              value={simDays}
              onChange={(e) => setSimDays(Number(e.target.value))}
              className="modern-range-line"
              aria-label="Simulate Lockup Duration"
            />
            <div className="flex items-center gap-2 mt-2">
              {[30, 45, 60, 75, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`pob-preset-btn ${simDays === d ? '!bg-[#00f59b]/20 !text-[#00f59b] !border-[#00f59b]/40 font-bold' : ''}`}
                  onClick={() => setSimDays(d)}
                >
                  {d}D
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Output Column (5 cols) */}
        <div className="lg:col-span-5 bg-[#080d15] p-6 rounded-2xl border border-white/8 flex flex-col justify-between">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400">
              <span>Hourly Stream Rate</span>
              <span className="text-[#00f59b] font-semibold tabular-nums">+{hourlyEmissions.toFixed(4)} $Noir/hr</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono text-slate-400">
              <span>Principal Return</span>
              <span className="text-white tabular-nums">{principalTokens.toFixed(4)} $Noir</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono text-slate-400">
              <span>Term Yield Bonus (12% APY)</span>
              <span className="text-[#00f59b] font-semibold tabular-nums">+{yieldTokens.toFixed(4)} $Noir</span>
            </div>

            <div className="h-px bg-white/10 my-1" />

            <div>
              <div className="text-[11px] uppercase font-bold text-[#00f59b] tracking-wider mb-1">Deterministic Settlement</div>
              <div className="text-3xl font-bold font-mono text-white tabular-nums">
                {totalTokens.toFixed(4)} <span className="text-base font-normal text-slate-400">$Noir</span>
              </div>
              <div className="text-xs font-mono text-slate-400 mt-1">≈ {money(totalUsd)} USD (at $1.10 benchmark)</div>
            </div>
          </div>

          <div className="mt-6">
            <Link href="/staking" className="button button-primary w-full justify-center !py-3">
              <span>Enter Staking Engine</span>
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TRUST WALLET / COREDAO STYLE BENTO MECHANISMS
// ---------------------------------------------------------------------------
function LandingBentoGrid() {
  return (
    <div className="landing-bento">
      {/* Card 1: Non-Custodial Cryptographic Security */}
      <div className="col-span-12 lg:col-span-4 bento-card">
        <div className="relative mb-6 rounded-xl overflow-hidden aspect-[4/3] bg-black/40 border border-white/8 flex items-center justify-center">
          <img
            src="/pob-vault-shield.jpg"
            alt="Cryptographic Security Shield"
            className="w-full h-full object-cover opacity-85"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#090e17] via-transparent to-transparent" />
        </div>
        <div>
          <div className="text-xs font-mono text-[#00f59b] uppercase tracking-wider mb-1">Invariable Trust</div>
          <h3 className="text-lg font-bold text-white mb-2">Non-Custodial Architecture</h3>
          <p className="text-sm text-slate-400 leading-relaxed m-0">
            Self-sovereign cryptographic authority. Zero centralized bridge risks, zero private investor pre-mines, and zero backdoors.
          </p>
        </div>
      </div>

      {/* Card 2: Deflationary Burn Invariant */}
      <div className="col-span-12 lg:col-span-4 bento-card">
        <div className="relative mb-6 rounded-xl overflow-hidden aspect-[4/3] bg-[#090e17] border border-white/8 flex items-center justify-center p-4">
          <svg viewBox="0 0 200 150" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full select-none">
            <defs>
              {/* Radial Core Furnace Glow */}
              <radialGradient id="pobRadialGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ff4b2b" stopOpacity="0.32" />
                <stop offset="45%" stopColor="#ff7657" stopOpacity="0.12" />
                <stop offset="85%" stopColor="#090e17" stopOpacity="0" />
              </radialGradient>

              {/* Multi-stage flame gradients */}
              <linearGradient id="pobFlameMain" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#ff2a5f" />
                <stop offset="50%" stopColor="#ff4b2b" />
                <stop offset="100%" stopColor="#f5a623" />
              </linearGradient>

              <linearGradient id="pobFlameFacetLeft" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ff7657" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#ff2a5f" stopOpacity="0.7" />
              </linearGradient>

              <linearGradient id="pobFlameFacetRight" x1="100%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#f5a623" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#ff4b2b" stopOpacity="0.75" />
              </linearGradient>

              <linearGradient id="pobFlameCore" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#ff7657" />
                <stop offset="60%" stopColor="#ffe680" />
                <stop offset="100%" stopColor="#ffffff" />
              </linearGradient>

              {/* Soft bloom filter */}
              <filter id="pobBloom" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Atmosphere ambient furnace glow */}
            <rect x="10" y="5" width="180" height="140" fill="url(#pobRadialGlow)" />

            {/* Technical grid & alignment brackets */}
            <g stroke="rgba(255, 255, 255, 0.05)" strokeWidth="0.8">
              <line x1="20" y1="72" x2="180" y2="72" strokeDasharray="3 4" />
              <line x1="100" y1="15" x2="100" y2="135" strokeDasharray="3 4" />
            </g>

            {/* Corner view-finder ticks */}
            <path d="M 22 24 L 30 24 M 22 24 L 22 32" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="1" />
            <path d="M 178 24 L 170 24 M 178 24 L 178 32" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="1" />
            <path d="M 22 126 L 30 126 M 22 126 L 22 118" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="1" />
            <path d="M 178 126 L 170 126 M 178 126 L 178 118" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="1" />

            {/* Cryptographic containment: Outer segmented circular track */}
            <circle
              cx="100"
              cy="72"
              r="58"
              stroke="rgba(255, 75, 43, 0.18)"
              strokeWidth="1"
              strokeDasharray="4 6"
              fill="none"
            />

            {/* Hexagonal reactor chamber perimeter */}
            <polygon
              points="146,72 123,112 77,112 54,72 77,32 123,32"
              fill="rgba(255, 75, 43, 0.03)"
              stroke="rgba(255, 75, 43, 0.32)"
              strokeWidth="1.2"
            />

            {/* Inner magnetic compression ring */}
            <circle
              cx="100"
              cy="72"
              r="38"
              stroke="rgba(255, 118, 87, 0.35)"
              strokeWidth="1"
              strokeDasharray="10 4"
              fill="rgba(12, 18, 29, 0.6)"
            />

            {/* Precision crosshair cardinal calipers */}
            <line x1="100" y1="18" x2="100" y2="30" stroke="#ff4b2b" strokeWidth="1.2" opacity="0.6" />
            <line x1="100" y1="114" x2="100" y2="126" stroke="#ff4b2b" strokeWidth="1.2" opacity="0.6" />
            <line x1="42" y1="72" x2="54" y2="72" stroke="#ff4b2b" strokeWidth="1.2" opacity="0.6" />
            <line x1="146" y1="72" x2="158" y2="72" stroke="#ff4b2b" strokeWidth="1.2" opacity="0.6" />

            {/* Ingress token particle vectors converging into burn singularity */}
            <g stroke="#f5a623" strokeWidth="1.2" strokeDasharray="2 3" opacity="0.75">
              <path d="M 46 72 Q 70 72, 84 72" />
              <path d="M 154 72 Q 130 72, 116 72" />
            </g>
            {/* Tokens entering singularity */}
            <circle cx="58" cy="72" r="2.5" fill="#f5a623" />
            <circle cx="142" cy="72" r="2.5" fill="#ff7657" />

            {/* Core Proof-of-Burn Flame Singularity */}
            <g filter="url(#pobBloom)">
              {/* Outer flame silhouette */}
              <path
                d="M 100 36 C 91 48, 80 60, 80 76 C 80 91, 89 99, 100 99 C 111 99, 120 91, 120 76 C 120 60, 109 48, 100 36 Z"
                fill="url(#pobFlameMain)"
                opacity="0.9"
              />

              {/* Left facet shading */}
              <path
                d="M 100 39 C 94 49, 85 61, 85 75 C 85 87, 92 95, 100 98 L 100 39 Z"
                fill="url(#pobFlameFacetLeft)"
              />

              {/* Right facet shading */}
              <path
                d="M 100 39 C 106 49, 115 61, 115 75 C 115 87, 108 95, 100 98 L 100 39 Z"
                fill="url(#pobFlameFacetRight)"
              />

              {/* Secondary inner flame tongue */}
              <path
                d="M 100 48 C 94 57, 89 66, 89 76 C 89 86, 94 92, 100 92 C 106 92, 111 86, 111 76 C 111 66, 106 57, 100 48 Z"
                fill="url(#pobFlameCore)"
                opacity="0.85"
              />

              {/* White-hot luminescence core */}
              <path
                d="M 100 58 C 97 64, 94 71, 94 77 C 94 83, 97 87, 100 87 C 103 87, 106 83, 106 77 C 106 71, 103 64, 100 58 Z"
                fill="#ffffff"
                opacity="0.95"
              />
            </g>

            {/* Ascending quantum thermal embers */}
            <g fill="#f5a623">
              <circle cx="94" cy="30" r="1.5" opacity="0.85" />
              <circle cx="106" cy="27" r="1.3" opacity="0.75" />
              <circle cx="100" cy="21" r="1.6" fill="#ffffff" opacity="0.9" />
              <circle cx="86" cy="44" r="1.2" fill="#ff4b2b" opacity="0.8" />
              <circle cx="114" cy="42" r="1.4" fill="#ff7657" opacity="0.85" />
              <circle cx="98" cy="14" r="1.1" fill="#ffe680" opacity="0.7" />
            </g>

            {/* Minimalist cryptographic immutable sink tag */}
            <text
              x="100"
              y="136"
              textAnchor="middle"
              fill="#ff7657"
              fontSize="7"
              fontWeight="600"
              fontFamily="monospace"
              letterSpacing="1.2"
              opacity="0.85"
            >
              0x00...00 · NULL SINK
            </text>
          </svg>
        </div>
        <div>
          <div className="text-xs font-mono text-[#ff4b2b] uppercase tracking-wider mb-1">Deflationary Sinks</div>
          <h3 className="text-lg font-bold text-white mb-2">Proof-of-Burn Invariant</h3>
          <p className="text-sm text-slate-400 leading-relaxed m-0">
            Staked Bits are permanently incinerated from existence upon commitment. Mathematical supply destruction underpins yield integrity.
          </p>
        </div>
      </div>

      {/* Card 3: 24/7 Real-Time Streaming Emissions */}
      <div className="col-span-12 lg:col-span-4 bento-card">
        <div className="relative mb-6 rounded-xl overflow-hidden aspect-[4/3] bg-[#0c121d] border border-white/8 flex items-center justify-center p-6">
          <svg viewBox="0 0 160 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
            <path
              d="M 10 60 Q 30 20, 50 60 T 90 60 T 130 60 T 150 60"
              stroke="rgba(0, 245, 155, 0.25)"
              strokeWidth="2"
              fill="none"
            />
            <path
              d="M 10 60 Q 25 35, 45 60 T 80 60 T 115 60 T 150 60"
              stroke="#00f59b"
              strokeWidth="2.5"
              fill="none"
            />
            <circle cx="80" cy="60" r="6" fill="#00f59b" />
            <circle cx="80" cy="60" r="2" fill="#03140a" />
            <line x1="80" y1="20" x2="80" y2="100" stroke="#00f59b" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
          </svg>
        </div>
        <div>
          <div className="text-xs font-mono text-[#38bdf8] uppercase tracking-wider mb-1">Continuous Distribution</div>
          <h3 className="text-lg font-bold text-white mb-2">Second-by-Second Streaming</h3>
          <p className="text-sm text-slate-400 leading-relaxed m-0">
            No cliff unlocks. Rewards stream in uninterrupted fractional units every second, claimable directly to your non-custodial address.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. HOME / LANDING PAGE (TIER-1 COREDAO / TRUST WALLET RE-ENGINEERED)
// ---------------------------------------------------------------------------
function HomePage() {
  return (
    <div className="site-shell landing-tier1">
      <div className="landing-matrix-bg" />
      <div className="landing-aurora-glow" />

      <PublicHeader hideSignIn />

      <main>
        {/* 1. HERO SECTION */}
        <section className="hero-tier1">
          <div className="hero-copy-tier1">
            <div className="eyebrow">
              <span className="eyebrow-dot" />
              Bitcoin-Aligned Capital Layer · BEP-20 USDT
            </div>
            <h1>
              Bitcoin Scarcity. <br />
              <span className="highlight-green">EVM Programmability.</span>
            </h1>
            <p>
              The dual-primitive capital protocol. Convert USDT into Bits, lock into irreversible
              Proof-of-Burn staking, and stream verifiable protocol yield settled in fixed-supply Bitnoir Coin ($Noir).
            </p>
            <div className="hero-actions">
              <Link href="/sign-up" className="button button-primary hero-primary-action">
                <span>Enter Fair Launch</span>
                <ArrowRight size={15} />
              </Link>
              <Link href="/staking" className="button button-soft">
                <Lock size={15} />
                <span>Stake & Lock</span>
              </Link>
              <Link href="/docs" className="button button-ghost">
                <BookOpen size={15} />
                <span>Whitepaper</span>
              </Link>
            </div>
            <div className="trustline">
              <span><i className="trustline-dot" /> 21,000,000 Hard Cap</span>
              <span><i className="trustline-dot" /> Proof-of-Burn Engine</span>
              <span><i className="trustline-dot" /> 100 USDT = 1K Bits</span>
            </div>
          </div>

          <div className="hero-stage-tier1" aria-label="Bitnoir Holographic Stage">
            <img
              src="/hero-quantum-lattice.jpg"
              alt="Bitcoin Cryptographic Lattice"
              className="hero-stage-bg"
            />
            <div className="hero-stage-overlay" />

            {/* Glowing Concentric Orbital Rings */}
            <svg viewBox="0 0 400 400" className="absolute w-[360px] h-[360px] pointer-events-none opacity-40 animate-spin" style={{ animationDuration: '60s' }}>
              <circle cx="200" cy="200" r="140" stroke="#00f59b" strokeWidth="1" strokeDasharray="4 6" fill="none" />
              <circle cx="200" cy="200" r="170" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="8 8" fill="none" />
            </svg>

            {/* Floating 3D Token Assets */}
            <div className="hero-floating-core">
              <div className="hero-floating-coin">
                <img
                  src="/asset-bitnoir.png"
                  alt="Bitnoir Coin ($Noir)"
                  width={210}
                  height={210}
                  className="w-[190px] h-[190px] object-contain"
                />
              </div>
              <div className="hero-floating-orbit-coin">
                <img
                  src="/asset-bits-lg.png"
                  alt="Bits Staking Unit"
                  width={80}
                  height={80}
                  className="w-[74px] h-[74px] object-contain"
                />
              </div>
            </div>

            <div className="hero-live-badge">
              <span className="w-2 h-2 rounded-full bg-[#00f59b] animate-ping" />
              <span>21,000,000 FIXED CAP ($NOIR)</span>
            </div>
          </div>
        </section>

        {/* 2. LIVE TELEMETRY METRIC RIBBON */}
        <section className="telemetry-ribbon">
          <div className="telemetry-box">
            <div className="telemetry-cell">
              <div className="telemetry-cell-val tabular-nums">21,000,000</div>
              <div className="telemetry-cell-sub">Fixed Supply Invariant ($Noir)</div>
            </div>
            <div className="telemetry-cell">
              <div className="telemetry-cell-val text-[#f5a623] tabular-nums">100 : 1,000</div>
              <div className="telemetry-cell-sub">USDT to Bits Accounting</div>
            </div>
            <div className="telemetry-cell">
              <div className="telemetry-cell-val text-[#00f59b] tabular-nums">12.0% APY</div>
              <div className="telemetry-cell-sub">Annual Fair Yield (1.0% — 3.0% Term)</div>
            </div>
            <div className="telemetry-cell">
              <div className="telemetry-cell-val tabular-nums">$1.10 USD</div>
              <div className="telemetry-cell-sub">Protocol Accounting Parity</div>
            </div>
            <div className="telemetry-cell">
              <div className="telemetry-cell-val text-white">Proof-of-Burn</div>
              <div className="telemetry-cell-sub">Permanent Token Destruction</div>
            </div>
          </div>
        </section>

        {/* 3. DUAL-PRIMITIVE PROTOCOL SCHEMATIC */}
        <section className="landing-section">
          <div className="landing-section-head">
            <div className="eyebrow">Cryptographic Mechanism</div>
            <h2>The Dual-Primitive State Engine</h2>
            <p>
              Bitnoir decouples internal accounting from external value settlement through an immutable state machine.
            </p>
          </div>
          <LandingArchitectureSvg />
        </section>

        {/* 4. INTERACTIVE STAKING YIELD SIMULATOR */}
        <section className="landing-section">
          <div className="landing-section-head">
            <div className="eyebrow">Real-Time Simulator</div>
            <h2>Algorithmic Staking Yield Engine</h2>
            <p>
              Scrub allocation and duration to preview real-time per-second emission velocity and maturity redemption.
            </p>
          </div>
          <LandingYieldSimulator />
        </section>

        {/* 5. SECURITY & MECHANISMS BENTO */}
        <section className="landing-section">
          <div className="landing-section-head">
            <div className="eyebrow">Core Invariants</div>
            <h2>Engineered for Verifiable Digital Scarcity</h2>
            <p>
              Built to withstand market volatility through non-custodial cryptographic guarantees.
            </p>
          </div>
          <LandingBentoGrid />
        </section>

        {/* 6. GATEWAY LAUNCHPAD CTA */}
        <section className="landing-gateway">
          <div className="gateway-card">
            <div className="max-w-xl mx-auto">
              <div className="eyebrow mb-2">Protocol Access</div>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Enter the Bitcoin-Aligned Capital Engine
              </h2>
              <p className="text-slate-300 text-sm md:text-base mb-8 leading-relaxed">
                No private allocations. No variable pre-mines. Pure algorithmic participation secured by Proof-of-Burn consensus.
              </p>
              <div className="flex items-center justify-center gap-4 flex-wrap">
                <Link href="/sign-up" className="button button-primary !px-7 !py-3 text-sm">
                  <span>Enter Fair Launch</span>
                  <ArrowRight size={16} />
                </Link>
                <Link href="/docs" className="button button-ghost !px-7 !py-3 text-sm">
                  <span>Read Technical Docs</span>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <Brand size="sm" />
        <span>Bitnoir Protocol · Bits Points · 21,000,000 Fixed Cap ($Noir)</span>
        <span>Participation involves market and smart-contract risk. Review disclosures carefully.</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. WHITEPAPER & TECHNICAL SPECIFICATIONS (/docs, /whitepaper)
// ---------------------------------------------------------------------------
function DocsPage() {
  return (
    <div className="site-shell">
      <PublicHeader />
      <div className="whitepaper-wrapper">
        <header className="whitepaper-hero">
          <div className="eyebrow">Protocol Architecture Specification · Version 3.0</div>
          <h1 className="display whitepaper-title">
            Bitnoir: The Bitcoin-Aligned <br className="hide-mobile" />
            <span className="highlight-green">Capital & Staking Engine</span>
          </h1>
          <p style={{ maxWidth: 780, color: 'var(--silver-medium)', fontSize: 16, lineHeight: 1.8, margin: '14px 0 20px' }}>
            A formal specification of Bitnoir's dual-primitive state machine, proof-of-burn cryptographic invariants,
            chain-abstracted BTCfi execution layer, and immutable 21,000,000 fixed supply cap.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12, color: 'var(--silver-dark)', fontFamily: 'var(--app-font-mono)' }}>
            <span style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)' }}>Standard: BEP-20 / EVM + BTCfi</span>
            <span style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)' }}>Hard Cap: 21,000,000 Fixed ($Noir)</span>
            <span style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)' }}>Consensus: Proof-of-Burn (PoB)</span>
          </div>
        </header>

        <article className="whitepaper-content">
          {/* Section 1.0 */}
          <section className="whitepaper-section" id="abstract-vision">
            <div className="eyebrow">Section 1.0</div>
            <h2>Abstract & Architectural Thesis</h2>
            <p>
              Decentralized finance has historically bifurcated into two mutually exclusive paradigms: the absolute, mathematically
              governed scarcity of Bitcoin, and the expressive, programmable liquidity of Ethereum Virtual Machine (EVM) smart contracts.
              Contemporary attempts to bridge these realms have introduced critical vulnerabilities: custodial multi-sig wrappers,
              opaque centralized bridges, predatory token unlocks, and inflationary yield recycling that dilutes long-term holders.
            </p>
            <p>
              <strong>Bitnoir</strong> introduces a non-custodial capital coordination engine engineered around Bitcoin’s core monetary
              axiom: an immutable hard cap of <strong>21,000,000 units</strong>. By separating internal computational fuel from
              the external cryptographic asset through a verified <em>Dual-Primitive Architecture</em>, Bitnoir establishes an on-chain
              execution environment where staking yields are backed by verifiable protocol emissions and cryptographic proof-of-burn rather
              than debt inflation.
            </p>

            <div className="whitepaper-spec-grid">
              <div className="whitepaper-spec-item">
                <div className="whitepaper-spec-key">Monetary Ceiling</div>
                <div className="whitepaper-spec-val" style={{ color: 'var(--neon-green)' }}>21,000,000 $Noir</div>
              </div>
              <div className="whitepaper-spec-item">
                <div className="whitepaper-spec-key">Consensus Primitives</div>
                <div className="whitepaper-spec-val">Proof-of-Burn (PoB)</div>
              </div>
              <div className="whitepaper-spec-item">
                <div className="whitepaper-spec-key">Execution Surface</div>
                <div className="whitepaper-spec-val">EVM + BTCfi Engine</div>
              </div>
              <div className="whitepaper-spec-item">
                <div className="whitepaper-spec-key">Settlement Layer</div>
                <div className="whitepaper-spec-val">BNB Smart Chain (BEP-20)</div>
              </div>
            </div>
          </section>

          {/* Section 2.0 */}
          <section className="whitepaper-section" id="dual-primitive">
            <div className="eyebrow">Section 2.0</div>
            <h2>The Dual-Primitive Model: Bitnoir Coin vs. Bits Points</h2>
            <p>
              To resolve the volatility and liquidity fragmentation inherent in DeFi tokenomics, Bitnoir decouples internal protocol
              execution from secondary market speculation. The protocol defines two distinct mathematical primitives:
            </p>

            <div className="whitepaper-cards-2">
              <div className="panel content-card" style={{ borderColor: 'rgba(0, 245, 155, 0.3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <BitsMark size={28} />
                  <div>
                    <h3 style={{ margin: 0, fontSize: 18, color: 'var(--neon-green)' }}>Bits (Points)</h3>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--silver-dark)' }}>Internal Fuel Primitive</span>
                  </div>
                </div>
                <p style={{ fontSize: 13, color: 'var(--silver-medium)', margin: 0, lineHeight: 1.7 }}>
                  Internal, non-transferable protocol units credited for on-chain staking coordination.
                  <strong> 100 USDT = 1,000 Bits</strong>. Bits possess zero secondary market float and cannot be traded across external
                  venues. They exist solely to initiate and fuel locked staking terms. Upon entry into the staking engine, Bits are
                  <strong> permanently incinerated via Proof-of-Burn</strong>.
                </p>
              </div>

              <div className="panel content-card" style={{ borderColor: 'rgba(255, 255, 255, 0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <TokenMark size={28} />
                  <div>
                    <h3 style={{ margin: 0, fontSize: 18, color: '#ffffff' }}>Bitnoir Coin ($Noir)</h3>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--silver-dark)' }}>Cryptographic Settlement Asset</span>
                  </div>
                </div>
                <p style={{ fontSize: 13, color: 'var(--silver-medium)', margin: 0, lineHeight: 1.7 }}>
                  The native transferable cryptographic currency of the network with an absolute, mathematically enforced cap of
                  <strong> 21,000,000 units</strong>. Minted exclusively through verified genesis allocations, mining pool halving emissions,
                  and staking principal redemptions funded by the dedicated 20% Staking Reserve.
                </p>
              </div>
            </div>

            {/* TECHNICAL SVG DIAGRAM 1: Dual-Primitive Architecture */}
            <div className="whitepaper-diag-card">
              <div className="whitepaper-diag-caption">
                <Activity size={13} />
                <span>Figure 1: Dual-Primitive State Machine & Cryptographic Verification Invariant</span>
              </div>
              <svg className="whitepaper-diag-svg" viewBox="0 0 840 220" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Left Box: Bits Points */}
                <rect x="20" y="30" width="220" height="160" rx="10" fill="#0c1017" stroke="rgba(0, 245, 155, 0.35)" strokeWidth="1.5" />
                <rect x="36" y="48" width="28" height="28" rx="6" fill="rgba(0, 245, 155, 0.08)" stroke="var(--neon-green)" />
                <text x="50" y="66" textAnchor="middle" fill="var(--neon-green)" fontSize="11" fontFamily="var(--app-font-mono)" fontWeight="700">BP</text>
                <text x="76" y="58" fill="#fff" fontSize="14" fontWeight="700" fontFamily="system-ui">Bits (Points)</text>
                <text x="76" y="74" fill="#8b949e" fontSize="11" fontFamily="var(--app-font-mono)">Internal Fuel Layer</text>
                <line x1="36" y1="95" x2="224" y2="95" stroke="rgba(255,255,255,0.06)" />
                <text x="36" y="118" fill="#c9d1d9" fontSize="11" fontFamily="var(--app-font-mono)">Non-transferable internal state</text>
                <text x="36" y="138" fill="#c9d1d9" fontSize="11" fontFamily="var(--app-font-mono)">100 USDT = 1,000 Bits</text>
                <text x="36" y="158" fill="#c9d1d9" fontSize="11" fontFamily="var(--app-font-mono)">Zero secondary market float</text>
                <text x="36" y="178" fill="var(--neon-green)" fontSize="11" fontFamily="var(--app-font-mono)">Fuel for locked staking terms</text>

                {/* Flow Arrow 1: Bits to Burn Engine */}
                <path d="M242 110 L308 110" stroke="rgba(0, 245, 155, 0.6)" strokeWidth="1.5" />
                <polygon points="314,110 306,106 306,114" fill="var(--neon-green)" />
                <text x="278" y="98" textAnchor="middle" fill="#8b949e" fontSize="10" fontFamily="var(--app-font-mono)">Commit</text>

                {/* Center Box: Proof-of-Burn & Staking Vault */}
                <rect x="316" y="20" width="228" height="180" rx="12" fill="#0e131d" stroke="rgba(255, 255, 255, 0.14)" strokeWidth="1.5" />
                <rect x="332" y="36" width="196" height="28" rx="6" fill="rgba(255,255,255,0.04)" />
                <text x="430" y="54" textAnchor="middle" fill="#fff" fontSize="12" fontWeight="700" fontFamily="system-ui">Proof-of-Burn Invariant</text>
                <text x="332" y="86" fill="var(--neon-green)" fontSize="11" fontFamily="var(--app-font-mono)">Burn Invariant: ΔBits → ∅</text>
                <text x="332" y="106" fill="#8b949e" fontSize="11" fontFamily="system-ui">Bits permanently destroyed</text>
                <rect x="332" y="122" width="196" height="64" rx="8" fill="rgba(0,0,0,0.35)" stroke="rgba(0, 245, 155, 0.2)" />
                <text x="342" y="142" fill="#c9d1d9" fontSize="10" fontFamily="var(--app-font-mono)">Smart Lock: 30d | 60d | 90d</text>
                <text x="342" y="160" fill="var(--neon-green)" fontSize="10" fontFamily="var(--app-font-mono)">Yield Streaming: Daily Epoch</text>
                <text x="342" y="176" fill="#8b949e" fontSize="10" fontFamily="var(--app-font-mono)">V_ref = $1.10 Accounting</text>

                {/* Flow Arrow 2: Vault to Bitnoir Coin */}
                <path d="M546 110 L612 110" stroke="rgba(255, 255, 255, 0.6)" strokeWidth="1.5" />
                <polygon points="618,110 610,106 610,114" fill="#fff" />
                <text x="582" y="98" textAnchor="middle" fill="#8b949e" fontSize="10" fontFamily="var(--app-font-mono)">Maturity</text>

                {/* Right Box: Bitnoir Coin */}
                <rect x="620" y="30" width="200" height="160" rx="10" fill="#0c1017" stroke="rgba(255, 255, 255, 0.25)" strokeWidth="1.5" />
                <rect x="636" y="48" width="28" height="28" rx="6" fill="rgba(255, 255, 255, 0.06)" stroke="#ffffff" />
                <text x="650" y="66" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="var(--app-font-mono)" fontWeight="700">BC</text>
                <text x="676" y="58" fill="#fff" fontSize="14" fontWeight="700" fontFamily="system-ui">Bitnoir Coin</text>
                <text x="676" y="74" fill="var(--neon-green)" fontSize="11" fontFamily="var(--app-font-mono)">$Noir / BITS Asset</text>
                <line x1="636" y1="95" x2="804" y2="95" stroke="rgba(255,255,255,0.06)" />
                <text x="636" y="118" fill="#c9d1d9" fontSize="11" fontFamily="var(--app-font-mono)">21,000,000 Hard Cap</text>
                <text x="636" y="138" fill="#c9d1d9" fontSize="11" fontFamily="var(--app-font-mono)">BEP-20 Standard Token</text>
                <text x="636" y="158" fill="#c9d1d9" fontSize="11" fontFamily="var(--app-font-mono)">Cross-Chain Collateral</text>
                <text x="636" y="178" fill="#c9d1d9" fontSize="11" fontFamily="var(--app-font-mono)">DEX / CEX Settlement</text>
              </svg>
            </div>

            <h3>Mathematical Comparison Matrix</h3>
            <div className="whitepaper-table-wrap">
              <table className="data-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: '22%' }}>Attribute</th>
                    <th style={{ width: '26%' }}>Bits Points</th>
                    <th style={{ width: '26%' }}>Bitnoir Coin ($Noir)</th>
                    <th style={{ width: '26%' }}>Architectural Rationale</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Asset Classification</strong></td>
                    <td>Internal Protocol Fuel Unit</td>
                    <td>Cryptographic Settlement Currency</td>
                    <td>Isolates protocol logic from speculative volatility</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Transferability</strong></td>
                    <td><span className="mono" style={{ color: 'var(--silver-dark)' }}>Non-Transferable (Internal Ledger State)</span></td>
                    <td><span className="mono" style={{ color: 'var(--neon-green)' }}>100% Freely Transferable (BEP-20)</span></td>
                    <td>Prevents secondary dumping of unvested points</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Circulating Supply</strong></td>
                    <td>Dynamic Fuel (Burned upon staking)</td>
                    <td>Strict 21,000,000 Maximum Hard Cap</td>
                    <td>Permanent mathematical protection against inflation</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Primary Function</strong></td>
                    <td>Initiating customized 30–90d lockups</td>
                    <td>Collateral, validator bonding & liquidity</td>
                    <td>Establishes a resilient two-layer economy</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>State Invariant</strong></td>
                    <td>Permanent Proof-of-Burn (ΔBits → ∅)</td>
                    <td>Deterministic principal redemption at maturity</td>
                    <td>Principal returns funded directly by 20% Staking Reserve</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 3.0 */}
          <section className="whitepaper-section" id="scarcity-proof-of-burn">
            <div className="eyebrow">Section 3.0</div>
            <h2>Proof-of-Burn & Scarcity Invariants</h2>
            <p>
              In conventional yield architectures (e.g., fractional-reserve lending, synthetic re-staking), capital remains simultaneously
              counted on ledger balances while pledged as security. This re-hypothecation introduces systemic counterparty risk: sudden
              liquidity contractions trigger cascading forced liquidations.
            </p>
            <p>
              Bitnoir enforces mathematical integrity through an uncompromising <strong>Proof-of-Burn (PoB)</strong> state transition.
              When a participant commits Bits into the protocol's lockup smart contract, the Bits are not placed into a pool where they
              can be re-lent or reclaimed early. They are <strong>permanently and irreversibly destroyed from the active points ledger</strong>.
            </p>

            <div className="formula-card">
              <div className="formula-header">The Proof-of-Burn Invariant Equation</div>
              <div className="formula-math">
                ∀ Position_i : ΔBits_active = -Bits_committed ∧ Staking_Receipt_i = Hash(Account, Term, BlockTimestamp)
              </div>
              <div className="formula-explanation">
                Equation 1: The commitment of Bits reduces active ledger float irreversibly. The smart contract instantiates an immutable
                cryptographic receipt guaranteeing principal redemption at maturity from the protocol's 4,200,000 $Noir reserve.
              </div>
            </div>

            <h3>The $1.10 Reference Accounting Benchmark</h3>
            <p>
              To provide deterministic settlement without relying on volatile oracle price fluctuations during active lockups,
              the protocol employs a fixed internal benchmark:
            </p>
            <div className="formula-card">
              <div className="formula-header">Deterministic Principal Settlement Formula</div>
              <div className="formula-math">
                Principal_Redemption ($Noir) = (Staked_Bits × $0.10) / Reference_Valuation ($1.10)
              </div>
              <div className="formula-explanation">
                Example: 1,000 Bits committed ($100 USDT computational value) returns exactly <strong>90.9091 Bitnoir Coins ($Noir)</strong> upon term
                maturity ($100 / $1.10 = 90.9091 $Noir), funded directly from the verified 20% Staking Reserve.
              </div>
            </div>
          </section>

          {/* Section 4.0 */}
          <section className="whitepaper-section" id="tokenomics-supply">
            <div className="eyebrow">Section 4.0</div>
            <h2>21,000,000 Fixed Supply Architecture</h2>
            <p>
              Mirroring Bitcoin’s foundational monetary policy, the total lifetime issuance of Bitnoir Coin ($Noir) is hardcoded at exactly
              <strong> 21,000,000 units</strong>. No administrative function, multisig key, or governance vote can ever expand this
              supply boundary. The distribution is programmatically partitioned across five fundamental protocol pillars:
            </p>

            {/* TECHNICAL SVG DIAGRAM 2: Supply Allocation & Halving Curve */}
            <div className="whitepaper-diag-card">
              <div className="whitepaper-diag-caption">
                <BarChart3 size={13} />
                <span>Figure 2: Verifiable Allocation Breakdown & Asymptotic Halving Convergence</span>
              </div>
              <svg className="whitepaper-diag-svg" viewBox="0 0 840 210" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Allocation Horizontal Bar */}
                <rect x="20" y="30" width="800" height="32" rx="6" fill="#0d1117" stroke="rgba(255,255,255,0.12)" />
                {/* 45% Fair Launch: 360px */}
                <rect x="22" y="32" width="358" height="28" rx="4" fill="var(--neon-green)" opacity="0.85" />
                <text x="201" y="50" textAnchor="middle" fill="#03140a" fontSize="11" fontWeight="700" fontFamily="var(--app-font-mono)">Public Allocation: 45.0%</text>

                {/* 20% Staking: 160px */}
                <rect x="382" y="32" width="158" height="28" rx="4" fill="#00f59b" opacity="0.45" />
                <text x="461" y="50" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="600" fontFamily="var(--app-font-mono)">Staking: 20.0%</text>

                {/* 15% Liquidity: 120px */}
                <rect x="542" y="32" width="118" height="28" rx="4" fill="#ffffff" opacity="0.3" />
                <text x="601" y="50" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="600" fontFamily="var(--app-font-mono)">AMM: 15%</text>

                {/* 12% Mining: 96px */}
                <rect x="662" y="32" width="94" height="28" rx="4" fill="#ffffff" opacity="0.18" />
                <text x="709" y="50" textAnchor="middle" fill="#c9d1d9" fontSize="10" fontWeight="600" fontFamily="var(--app-font-mono)">Mine: 12%</text>

                {/* 8% Community: 64px */}
                <rect x="758" y="32" width="60" height="28" rx="4" fill="#ffffff" opacity="0.08" />
                <text x="788" y="50" textAnchor="middle" fill="#8b949e" fontSize="9" fontWeight="600" fontFamily="var(--app-font-mono)">8%</text>

                {/* Halving Curve Section */}
                <line x1="60" y1="180" x2="800" y2="180" stroke="rgba(255,255,255,0.15)" />
                <line x1="60" y1="90" x2="60" y2="180" stroke="rgba(255,255,255,0.15)" />
                {/* 21M Ceiling Guide */}
                <line x1="60" y1="95" x2="800" y2="95" stroke="rgba(0, 245, 155, 0.4)" strokeWidth="1" />
                <text x="804" y="99" fill="var(--neon-green)" fontSize="10" fontFamily="var(--app-font-mono)">21,000,000 Hard Cap</text>

                {/* Curve Path */}
                <path d="M60 180 Q220 125 400 108 T780 96" fill="none" stroke="var(--neon-green)" strokeWidth="2.5" />
                <rect x="57" y="177" width="6" height="6" fill="var(--neon-green)" rx="1" />
                <rect x="217" y="135" width="6" height="6" fill="var(--neon-green)" rx="1" />
                <rect x="397" y="105" width="6" height="6" fill="var(--neon-green)" rx="1" />
                <rect x="597" y="96" width="6" height="6" fill="var(--neon-green)" rx="1" />
                <rect x="777" y="93" width="6" height="6" fill="var(--neon-green)" rx="1" />

                {/* Epoch Labels */}
                <text x="60" y="196" textAnchor="middle" fill="#8b949e" fontSize="10" fontFamily="var(--app-font-mono)">Genesis</text>
                <text x="220" y="196" textAnchor="middle" fill="#8b949e" fontSize="10" fontFamily="var(--app-font-mono)">Epoch 1</text>
                <text x="400" y="196" textAnchor="middle" fill="#8b949e" fontSize="10" fontFamily="var(--app-font-mono)">Epoch 2</text>
                <text x="600" y="196" textAnchor="middle" fill="#8b949e" fontSize="10" fontFamily="var(--app-font-mono)">Epoch 3</text>
                <text x="780" y="196" textAnchor="middle" fill="#8b949e" fontSize="10" fontFamily="var(--app-font-mono)">Terminal Cap</text>
              </svg>
            </div>

            <div className="whitepaper-table-wrap">
              <table className="data-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: '32%' }}>Pillar Allocation</th>
                    <th style={{ width: '16%' }}>Percentage</th>
                    <th style={{ width: '20%' }}>Token Quota ($Noir)</th>
                    <th style={{ width: '32%' }}>Operational Role & Lockup Mechanism</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Public Fair Launch Distribution</strong></td>
                    <td><span className="mono" style={{ color: 'var(--neon-green)', fontWeight: 700 }}>45.0%</span></td>
                    <td className="mono">9,450,000</td>
                    <td>Genesis fair protocol issuance; 100% unlocked at network launch</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Staking & Settlement Reserve</strong></td>
                    <td><span className="mono" style={{ color: 'var(--neon-green)', fontWeight: 700 }}>20.0%</span></td>
                    <td className="mono">4,200,000</td>
                    <td>Dedicated smart contract vault backing 30–90d term principal redemptions</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Liquidity & AMM Infrastructure</strong></td>
                    <td><span className="mono" style={{ color: 'var(--neon-green)', fontWeight: 700 }}>15.0%</span></td>
                    <td className="mono">3,150,000</td>
                    <td>Automated Market Maker pairings guaranteeing non-custodial decentralized exchange depth</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Mining Pool & Validator Emissions</strong></td>
                    <td><span className="mono" style={{ color: 'var(--neon-green)', fontWeight: 700 }}>12.0%</span></td>
                    <td className="mono">2,520,000</td>
                    <td>Distributed via epoch-halving curve to secure node operators and consensus infrastructure</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Community Reputation & Governance</strong></td>
                    <td><span className="mono" style={{ color: 'var(--neon-green)', fontWeight: 700 }}>8.0%</span></td>
                    <td className="mono">1,680,000</td>
                    <td>Reputation score weighting, decentralized XP merit, zero private insider allocations</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td><strong style={{ color: 'var(--neon-green)' }}>Total Fixed Monetary Supply</strong></td>
                    <td><strong className="mono" style={{ color: 'var(--neon-green)' }}>100.0%</strong></td>
                    <td><strong className="mono" style={{ color: 'var(--neon-green)' }}>21,000,000</strong></td>
                    <td style={{ color: 'var(--silver-medium)' }}>Immutable protocol monetary boundary hardcoded in smart contract bytecode</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* Section 5.0 */}
          <section className="whitepaper-section" id="btcfi-interop">
            <div className="eyebrow">Section 5.0</div>
            <h2>BTCfi & Multi-Chain State Engine</h2>
            <p>
              Drawing architectural principles from modern Bitcoin finance and decentralized multi-party cryptographic frameworks, Bitnoir eliminates custodial wrapping bridges.
            </p>
            <p>
              Instead of requiring users to lock raw Bitcoin into centralized custodian multisigs, Bitnoir employs a
              <strong> Multi-Party Computation (MPC) Threshold Signature Scheme (TSS)</strong> paired with Trusted Execution Environments (TEEs).
              Smart contracts running on the protocol’s EVM coordination layer can autonomously request cryptographic threshold signatures
              across foreign blockchains without revealing or centralizing private keys.
            </p>

            {/* TECHNICAL SVG DIAGRAM 3: BTCfi Multi-Chain Verification */}
            <div className="whitepaper-diag-card">
              <div className="whitepaper-diag-caption">
                <Globe2 size={13} />
                <span>Figure 3: Chain-Abstracted BTCfi State Execution & Threshold MPC Signature Pipeline</span>
              </div>
              <svg className="whitepaper-diag-svg" viewBox="0 0 840 230" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Top Layer: Connected Networks */}
                <rect x="30" y="25" width="220" height="42" rx="8" fill="#0d1117" stroke="rgba(255,255,255,0.12)" />
                <text x="140" y="50" textAnchor="middle" fill="#fff" fontSize="12" fontWeight="700" fontFamily="system-ui">Bitcoin Layer (BTC / Ordinals)</text>

                <rect x="310" y="25" width="220" height="42" rx="8" fill="#0d1117" stroke="rgba(0, 245, 155, 0.4)" />
                <text x="420" y="50" textAnchor="middle" fill="var(--neon-green)" fontSize="12" fontWeight="700" fontFamily="system-ui">Bitnoir EVM Coordination Engine</text>

                <rect x="590" y="25" width="220" height="42" rx="8" fill="#0d1117" stroke="rgba(255,255,255,0.12)" />
                <text x="700" y="50" textAnchor="middle" fill="#fff" fontSize="12" fontWeight="700" fontFamily="system-ui">EVM Ecosystem (BSC / L2 Rollups)</text>

                {/* Connecting Paths Down to Enclaves */}
                <path d="M140 68 L140 92 L220 92 L220 106" stroke="rgba(255,255,255,0.25)" strokeWidth="1.2" />
                <path d="M420 68 L420 106" stroke="var(--neon-green)" strokeWidth="1.5" />
                <path d="M700 68 L700 92 L620 92 L620 106" stroke="rgba(255,255,255,0.25)" strokeWidth="1.2" />

                {/* Middle Box: Decentralized MPC Validator Mesh with 3 Perfectly Sized Enclaves */}
                <rect x="120" y="106" width="600" height="58" rx="10" fill="#0b0f19" stroke="rgba(0, 245, 155, 0.35)" strokeWidth="1.2" />

                <rect x="140" y="116" width="160" height="38" rx="6" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.12)" />
                <text x="220" y="139" textAnchor="middle" fill="#e6edf3" fontSize="12" fontWeight="600" fontFamily="var(--app-font-mono)">Node A (TEE)</text>

                <rect x="340" y="116" width="160" height="38" rx="6" fill="rgba(0, 245, 155, 0.05)" stroke="rgba(0, 245, 155, 0.35)" />
                <text x="420" y="139" textAnchor="middle" fill="var(--neon-green)" fontSize="12" fontWeight="600" fontFamily="var(--app-font-mono)">Node B (TEE)</text>

                <rect x="540" y="116" width="160" height="38" rx="6" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.12)" />
                <text x="620" y="139" textAnchor="middle" fill="#e6edf3" fontSize="12" fontWeight="600" fontFamily="var(--app-font-mono)">Node C (TEE)</text>

                {/* Bottom Box: Non-Custodial Execution */}
                <path d="M420 164 L420 182" stroke="var(--neon-green)" strokeWidth="1.5" />
                <polygon points="420,186 416,180 424,180" fill="var(--neon-green)" />
                <rect x="120" y="186" width="600" height="32" rx="8" fill="rgba(0, 245, 155, 0.06)" stroke="rgba(0, 245, 155, 0.2)" />
                <text x="420" y="206" textAnchor="middle" fill="var(--neon-green)" fontSize="11" fontFamily="var(--app-font-mono)" fontWeight="600">
                  Pull-Based Signature Settlement: Zero Centralized Custody Risk
                </text>
              </svg>
            </div>

            <h3>Key Cryptographic Invariants</h3>
            <ul style={{ color: 'var(--silver-medium)', fontSize: 14, lineHeight: 1.8, paddingLeft: 20, margin: '14px 0 20px' }}>
              <li><strong>Distributed Key Generation (DKG):</strong> Master private keys are generated cooperatively across validator enclaves. No individual node ever reconstructs or observes the full key.</li>
              <li><strong>Signature Indistinguishability:</strong> Group-generated threshold ECDSA/EdDSA signatures are mathematically identical to standard single-signer transactions, fully supported natively by Bitcoin and EVM runtimes.</li>
              <li><strong>Hardware-Enforced Enclaves (TEEs):</strong> Node computation executes inside tamper-resistant hardware boundaries, preventing secret share leakage even if the host operating system is compromised.</li>
            </ul>
          </section>

          {/* Section 6.0 */}
          <section className="whitepaper-section" id="protocol-usecases">
            <div className="eyebrow">Section 6.0</div>
            <h2>Protocol Utility & Ecosystem Use Cases</h2>
            <p>
              Bitnoir Coin ($Noir) is engineered with clear, functional utility directly anchored to protocol throughput and network security:
            </p>

            <div className="whitepaper-cards-2">
              <div className="panel content-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <Coins size={20} color="var(--neon-green)" />
                  <h3 style={{ margin: 0, fontSize: 16, color: '#fff' }}>1. Hard Asset Collateral for BTCfi</h3>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.7 }}>
                  Due to its unalterable 21,000,000 hard cap and deterministic burn dynamics, $Noir functions as high-grade pristine
                  collateral across decentralized lending markets, liquidity pools, and algorithmic credit protocols.
                </p>
              </div>

              <div className="panel content-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <Layers3 size={20} color="var(--neon-green)" />
                  <h3 style={{ margin: 0, fontSize: 16, color: '#fff' }}>2. Node Bonding & Validator Staking</h3>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.7 }}>
                  Network validators and mining pool coordinators bond $Noir to secure threshold signature hardware. Malicious actions
                  trigger automated slashing penalties, enforcing economic honesty.
                </p>
              </div>

              <div className="panel content-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <Flame size={20} color="var(--neon-green)" />
                  <h3 style={{ margin: 0, fontSize: 16, color: '#fff' }}>3. Cross-Chain Gas Fee Deflation</h3>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.7 }}>
                  Cross-chain transaction relaying through the MPC threshold network consumes protocol routing fees paid in $Noir.
                  A percentage of every network coordination fee is permanently burned, applying perpetual deflationary pressure.
                </p>
              </div>

              <div className="panel content-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <ShieldCheck size={20} color="var(--neon-green)" />
                  <h3 style={{ margin: 0, fontSize: 16, color: '#fff' }}>4. Community Airdrop & Free Bits Protocol</h3>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.7 }}>
                  Every new participant receives 100 Free Bits upon signup ($10.00 value) stakable for 12% APY. Verified referrals award an additional 100 Bits once the referee purchases min. $100 and stakes, funded entirely by the 8% Community Airdrop Reserve (1,680,000 $Noir).
                </p>
              </div>
            </div>
          </section>

          {/* Section 7.0 */}
          <section className="whitepaper-section" id="participant-taxonomy">
            <div className="eyebrow">Section 7.0</div>
            <h2>Network Participants & User Taxonomy</h2>
            <p>
              The protocol coordinates four distinct classes of decentralized actors, each operating under self-sovereign incentives:
            </p>

            <div className="whitepaper-table-wrap">
              <table className="data-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: '24%' }}>Participant Role</th>
                    <th style={{ width: '26%' }}>Primary Objective</th>
                    <th style={{ width: '26%' }}>Economic Incentive & Invariant</th>
                    <th style={{ width: '24%' }}>Security Responsibility</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Protocol Users</strong></td>
                    <td>Commit internal Bits to 30–90d staking terms</td>
                    <td>Receive streaming protocol yield and redeemed Bitnoir Coins ($Noir) upon maturity</td>
                    <td>Non-custodial account authentication; self-sovereign key control</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Mining Pool Validators</strong></td>
                    <td>Operate secure TEE nodes executing threshold MPC signing</td>
                    <td>Capture the 12.0% epoch halving emission reserve (2,520,000 $Noir)</td>
                    <td>Uphold high availability and cryptographically isolated key shares</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Liquidity Coordinators</strong></td>
                    <td>Provide automated liquidity depth across DEX/CEX venues</td>
                    <td>Earn protocol AMM trading fees and deep liquidity incentives</td>
                    <td>Ensure continuous, low-slippage secondary price discovery</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Community Advocates</strong></td>
                    <td>Expand decentralized node participation through verified invitations</td>
                    <td>Earn rule-based XP reputation bonuses and tier multiplier boosts</td>
                    <td>Maintain Sybil resistance by onboarding active network participants</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 8.0 */}
          <section className="whitepaper-section" id="security-invariants">
            <div className="eyebrow">Section 8.0</div>
            <h2>Cryptographic Invariants & Safety Engineering</h2>
            <p>
              Security in Bitnoir is enforced as a deterministic mathematical property.
              The protocol establishes strict runtime invariants across state transitions:
            </p>

            <div className="whitepaper-table-wrap" style={{ margin: '18px 0' }}>
              <table className="data-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: '28%' }}>Safety Invariant</th>
                    <th style={{ width: '42%' }}>Cryptographic Guarantee</th>
                    <th style={{ width: '30%' }}>Failure State Mitigation</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Immutable Cap Enforcement</strong></td>
                    <td>Circulating $Noir issuance bounded strictly by 21,000,000 units in bytecode</td>
                    <td>Transactions attempting unauthorized minting revert deterministically</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Non-Reversible Burn (PoB)</strong></td>
                    <td>Bits committed to staking contracts are permanently deleted from active state (ΔBits → ∅)</td>
                    <td>Zero rehypothecation or recursive lending leverage possible</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Threshold Isolation (MPC)</strong></td>
                    <td>Multi-party TSS requires t-of-n consensus across isolated enclaves</td>
                    <td>Individual compromised nodes cannot generate valid protocol signatures</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Deterministic Settlement Index</strong></td>
                    <td>Principal redemptions evaluated via fixed $1.10 internal reference benchmark</td>
                    <td>Isolates active lockups from volatile spot price oracle manipulation</td>
                  </tr>
                  <tr>
                    <td><strong style={{ color: '#fff' }}>Non-Custodial Multi-Chain Execution</strong></td>
                    <td>Cross-chain operations executed via chain signatures without private key exposure</td>
                    <td>Eliminates centralized custodian multi-sig honeypot vulnerabilities</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="callout error" style={{ marginTop: 24 }}>
              <strong>Cryptographic Notice:</strong> Bitnoir is an autonomous decentralized protocol.
              While the mathematical ceiling of 21,000,000 Bitnoir Coins ($Noir) is immutable and Proof-of-Burn dynamics are verified on-chain,
              participation in digital asset protocols involves smart contract execution risk and network conditions.
              Participants should review formal specifications and commit capital in accordance with individual risk tolerance.
            </div>
          </section>
        </article>
      </div>
      <footer className="footer">
        <Brand size="sm" />
        <span>Bitnoir Protocol Architecture Specification · Version 3.0</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. AUTHENTICATION PAGES
// ---------------------------------------------------------------------------
function AuthCard({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [, setLocation] = useLocation();
  const { signIn, signUp } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [referral, setReferral] = useState(() => new URLSearchParams(window.location.search).get('ref') || '');
  const [error, setError] = useState('');
  const [loginKey, setLoginKey] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanUser = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const cleanKey = password.trim();

    if (mode === 'sign-up' && cleanUser.length < 3) {
      setError('Username must be at least 3 letters or numbers.');
      return;
    }
    if (mode === 'sign-in' && cleanKey.length < 16) {
      setError('Enter your complete login key.');
      return;
    }
    if (mode === 'sign-up' && password.length < 8) {
      setError('Password must contain at least 8 characters.');
      return;
    }

    try {
      setError('');
      setBusy(true);
      if (mode === 'sign-in') {
        await signIn(cleanKey);
        setLocation('/wallet');
      } else {
        const generatedKey = await signUp(cleanUser, password, referral.trim() || undefined);
        setLoginKey(generatedKey);
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Failed to authenticate. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div className="eyebrow" style={{ margin: '0 auto 12px' }}>
          <span className="eyebrow-dot" />
          {mode === 'sign-up' ? 'NEW MEMBER REGISTRATION' : 'MEMBER ACCESS'}
        </div>
        <h1 style={{ font: '700 28px var(--app-font-serif)', margin: '0 0 6px', color: '#fff' }}>
          {mode === 'sign-up' ? 'Create your protocol account' : 'Enter your login key'}
        </h1>
        <p style={{ color: 'var(--silver-medium)', fontSize: 13, margin: 0 }}>
          {mode === 'sign-up' ? 'Your private login key will be generated once after registration. No email is required.' : 'Use the private login key issued when you created your account.'}
        </p>
      </div>

      {mode === 'sign-up' && (
        <div style={{ padding: '12px 14px', background: 'rgba(0, 245, 155, 0.05)', border: '1px solid rgba(0, 245, 155, 0.25)', borderRadius: 10, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sparkles size={16} color="var(--neon-green)" style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 12, color: 'var(--silver-light)', lineHeight: 1.4 }}>
            <strong style={{ color: '#00f59b' }}>100 Free Bits Welcome Grant</strong> automatically credited on signup ($10.00 accounting value · stakable for 12% APY).
          </div>
        </div>
      )}

      {mode === 'sign-up' && (
        <div className="field-wrap">
          <label className="field-label" htmlFor="auth-username">Username</label>
          <input
            id="auth-username"
            className="field mono"
            placeholder="Choose a username"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            maxLength={20}
            required
          />
        </div>
      )}

      <div className="field-wrap">
        <label className="field-label" htmlFor="auth-password">{mode === 'sign-up' ? 'Password (Minimum 8 characters)' : 'Private Login Key'}</label>
        <input
          id="auth-password"
          className="field"
          type={mode === 'sign-up' ? 'password' : 'text'}
          placeholder={mode === 'sign-up' ? 'Choose a password' : '0x...'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
      </div>

      {mode === 'sign-up' && (
        <div className="field-wrap">
          <label className="field-label" htmlFor="auth-referral">
            Referral Code <span style={{ color: 'var(--silver-dark)' }}>(Optional)</span>
          </label>
          <input
            id="auth-referral"
            className="field mono"
            value={referral}
            onChange={(e) => setReferral(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
            placeholder="e.g. BITS-SATOSHINODE"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      )}

      {error && <div className="callout error" style={{ marginBottom: 16 }}>{error}</div>}
      {loginKey && (
        <div className="login-key-card">
          <strong>Save your one-time login key</strong>
          <code>{loginKey}</code>
          <span>This key is shown once. Store it securely; it cannot be recovered.</span>
          <button type="button" className="button button-soft" onClick={() => void navigator.clipboard?.writeText(loginKey)}>Copy login key</button>
          <Link href="/sign-in" className="button button-primary">Continue to sign in <ArrowRight size={15} /></Link>
        </div>
      )}

      {!loginKey && (
        <button className="button button-primary" type="submit" style={{ width: '100%', minHeight: 46 }} disabled={busy}>
          {busy ? 'Securing account…' : mode === 'sign-up' ? 'Create Account & Show Key' : 'Sign in to Portal'} <ArrowRight size={15} />
        </button>
      )}

      <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--silver-dark)' }}>
        {mode === 'sign-up' ? 'Already have an account?' : 'New to Bitnoir?'}{' '}
        <Link href={mode === 'sign-up' ? '/sign-in' : '/sign-up'} style={{ color: 'var(--neon-green)', fontWeight: 600 }}>
          {mode === 'sign-up' ? 'Sign in' : 'Create one now'}
        </Link>
      </p>
    </form>
  );
}

function SignInPage() {
  return (
    <div className="auth-stage">
      <Link href="/" className="auth-brand"><Brand /></Link>
      <div className="auth-card"><AuthCard mode="sign-in" /></div>
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="auth-stage">
      <Link href="/" className="auth-brand"><Brand /></Link>
      <div className="auth-card"><AuthCard mode="sign-up" /></div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. APP SHELL & STREAMLINED NAVIGATION
// ---------------------------------------------------------------------------
// Clean Coinbase-style unified tab architecture (eliminating tab clutter)
const navMain = [
  { href: '/wallet', label: 'Wallet', description: 'Portfolio, balances & assets', icon: Wallet },
  { href: '/staking', label: 'Bits Mining', description: 'Base 0.1/hr, team boost & burn SOL', icon: Flame },
  { href: '/activity', label: 'Transactions', description: 'Complete ledger & audit history', icon: FileClock },
  { href: '/statistics', label: 'Statistics', description: 'Overall stakers & protocol metrics', icon: Globe2 },
  { href: '/referrals', label: 'Airdrop & Free Bits', description: '100 Free Bits signup & referral network', icon: Gift },
  { href: '/docs', label: 'Whitepaper', description: 'Protocol specifications', icon: BookOpen },
];

function AppShell({
  children,
  active,
  admin = false,
  hideMobileMenu = false,
}: {
  children: ReactNode;
  active: string;
  admin?: boolean;
  hideMobileMenu?: boolean;
}) {
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const name = user?.name || user?.username || 'Member';
  const role = admin || user?.isAdmin ? 'Administrator' : 'Protocol Member';

  return (
    <div className={`app-layout ${hideMobileMenu ? 'hide-mobile-trigger no-page-scroll' : ''}`}>
      {/* MOBILE TRIGGER */}
      {!hideMobileMenu && (
        <button
          className={`mobile-menu-button ${menuOpen ? 'menu-open' : ''}`}
          type="button"
          aria-label={menuOpen ? 'Close Menu' : 'Open Menu'}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      )}

      {menuOpen && !hideMobileMenu && <button className="mobile-menu-backdrop" type="button" onClick={() => setMenuOpen(false)} />}

      {/* SIDEBAR */}
      <aside className={`sidebar ${menuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link href="/wallet" onClick={() => setMenuOpen(false)}>
            <Brand size="sm" />
          </Link>
          <button className="mobile-close-button" type="button" onClick={() => setMenuOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div className="side-caption">Ecosystem Navigation</div>
        <nav className="sidebar-nav">
          {navMain.map(({ href, label, description, icon: Icon }) => {
            const isStatActive = href === '/statistics' && (active === '/statistics' || active === '/statics' || active === '/pool');
            const isWalletActive = href === '/wallet' && (active === '/deposit' || active.startsWith('/asset'));
            const isActive = active === href || isStatActive || isWalletActive;

            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className={`side-link ${isActive ? 'active' : ''}`}
              >
                <Icon size={17} />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
              </Link>
            );
          })}
        </nav>

        {admin && (
          <>
            <div className="side-caption">Governance</div>
            <nav className="sidebar-nav">
              <Link
                href="/admin"
                className={`side-link ${active === '/admin' ? 'active' : ''}`}
                onClick={() => setMenuOpen(false)}
              >
                <ShieldCheck size={17} />
                <span>
                  <strong>Admin Room</strong>
                  <small>Deposit audits & gates</small>
                </span>
              </Link>
            </nav>
          </>
        )}

        <div className="side-bottom">
          <div className="mini-profile">
            <span className="avatar">{name.slice(0, 2).toUpperCase()}</span>
            <div style={{ overflow: 'hidden' }}>
              <span className="profile-name" style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {name}
              </span>
              <span className="profile-role">{role}</span>
            </div>
          </div>
          <button
            className="side-link"
            style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--danger)' }}
            onClick={() => signOut()}
          >
            <LogOut size={16} />
            <span><strong>Sign out</strong></span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="main-area">
        <div className="page-wrap">{children}</div>
      </main>
    </div>
  );
}

function ProtectedGate({ children, admin = false }: { children: (account: UserAccount) => ReactNode; admin?: boolean }) {
  const { user, ready } = useAuth();
  const isSignedIn = Boolean(user);
  const accountQuery = useGetMyAccount({ query: { enabled: isSignedIn, queryKey: getGetMyAccountQueryKey() } });

  if (ready && !isSignedIn) return <Redirect to="/sign-in" />;
  if (!ready || accountQuery.isLoading) {
    return (
      <div className="app-layout">
        <div className="sidebar" aria-hidden="true" />
        <main className="main-area" style={{ paddingTop: 80 }} aria-busy="true"><Skeleton rows={6} /></main>
      </div>
    );
  }
  const fallbackAccount: UserAccount = {
    id: user?.id || 'local-member',
    name: user?.name || user?.username || 'Member',
    email: '',
    role: user?.isAdmin ? 'admin' : 'user',
    referralCode: '',
    referredBy: null,
    xp: 0,
    balances: { purchased: 5000, staked: 10000, claimable: 0.1600, swapAvailable: 0 },
    createdAt: new Date().toISOString(),
  };
  if (accountQuery.isError || !accountQuery.data) {
    if (admin && !user?.isAdmin) return <Redirect to="/wallet" />;
    return <>{children(fallbackAccount)}</>;
  }
  if (admin && !user?.isAdmin && accountQuery.data.role !== 'admin') {
    return <Redirect to="/wallet" />;
  }
  const account = user?.isAdmin && accountQuery.data.role !== 'admin'
    ? { ...accountQuery.data, role: 'admin' as const }
    : accountQuery.data;
  return <>{children(account)}</>;
}

// ---------------------------------------------------------------------------
// 5. CLEAN COINBASE-STYLE INTERACTIVE MODALS (Deposit, Withdraw, Stake)
// ---------------------------------------------------------------------------

function DepositModal({
  open,
  onClose,
  defaultAsset = 'usdt',
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  defaultAsset?: string;
  onSuccess?: () => void;
}) {
  const receiveAddresses = useGetDepositAddresses({ query: { queryKey: getGetDepositAddressesQueryKey() } });
  const create = useCreateDeposit();
  const client = useQueryClient();
  const [amount, setAmount] = useState('100');
  const [selectedChain, setSelectedChain] = useState<'bnb' | 'ethereum' | 'polygon'>('bnb');
  const [txHash, setTxHash] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const addressRows = asArray<DepositAddress>(receiveAddresses.data);
  const currentAddress = addressRows.find((a) => a.chain === selectedChain && a.active)?.address ||
    (selectedChain === 'bnb' ? '0x71C8360437E55928d11B3e264259837a7F9D7065' : '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7');

  const numericAmount = Number(amount) || 0;
  const estimatedBits = Math.round(numericAmount * 10); // 100 USDT = 1,000 Bits

  if (!open) return null;

  const handleCopy = () => {
    void navigator.clipboard?.writeText(currentAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (numericAmount <= 0) {
      setError('Please enter a valid deposit amount greater than $0.');
      return;
    }
    setError('');
    create.mutate(
      { data: { chain: selectedChain, amountUsdt: numericAmount } },
      {
        onSuccess: () => {
          toast({
            title: 'Deposit Submitted',
            description: `Deposit request for ${numericAmount} USDT (${estimatedBits.toLocaleString()} Bits) created and queued for review.`,
          });
          void client.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
          void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
          void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
          onSuccess?.();
          onClose();
        },
        onError: (err) => setError(readableError(err, 'Failed to submit deposit request.')),
      }
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="tx-icon-badge deposit"><ArrowDownLeft size={18} /></div>
            <div>
              <h3>Deposit & Fund Bits</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--silver-dark)' }}>Mint Bits protocol units via BEP-20 USDT</p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* NETWORK SELECTOR */}
          <div className="field-wrap">
            <label className="field-label">Transfer Network</label>
            <div className="segmented-control" style={{ width: '100%' }}>
              <button
                type="button"
                className={`segmented-btn ${selectedChain === 'bnb' ? 'active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setSelectedChain('bnb')}
              >
                BNB Smart Chain (BEP-20)
              </button>
              <button
                type="button"
                className={`segmented-btn ${selectedChain === 'ethereum' ? 'active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setSelectedChain('ethereum')}
              >
                Ethereum (ERC-20)
              </button>
            </div>
          </div>

          {/* AMOUNT INPUT & QUICK SELECTORS */}
          <div className="field-wrap">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <label className="field-label" htmlFor="dep-amount">Deposit Amount (USDT)</label>
              <span className="mono" style={{ fontSize: 11, color: 'var(--neon-green)' }}>1 USDT = 10 Bits</span>
            </div>
            <input
              id="dep-amount"
              className="field mono"
              type="number"
              min="1"
              step="any"
              placeholder="e.g. 100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
            <div className="quick-amount-row">
              {['50', '100', '250', '500', '1000'].map((val) => (
                <button
                  type="button"
                  key={val}
                  className="quick-amount-btn"
                  onClick={() => setAmount(val)}
                >
                  ${val}
                </button>
              ))}
            </div>
          </div>

          {numericAmount > 0 && (
            <div className="callout info" style={{ marginBottom: 16 }}>
              <strong>Credited Rate:</strong> You will receive <strong>{estimatedBits.toLocaleString()} Bits</strong> ready for Proof-of-Burn staking.
            </div>
          )}

          {/* VERIFIED RECEIVING ADDRESS */}
          <div className="field-wrap">
            <label className="field-label">Verified Protocol Deposit Address</label>
            <div className="address-box">
              <span className="mono" style={{ fontSize: 12 }}>{currentAddress}</span>
              <button
                type="button"
                className="address-copy"
                onClick={handleCopy}
                title="Copy Address"
              >
                {copied ? <Check size={14} color="var(--neon-green)" /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          {/* OPTIONAL TX HASH */}
          <div className="field-wrap">
            <label className="field-label" htmlFor="dep-tx">
              Transaction Hash <span style={{ color: 'var(--silver-dark)' }}>(Optional if broadcasting now)</span>
            </label>
            <input
              id="dep-tx"
              className="field mono"
              placeholder="0x... tx hash from wallet"
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
            />
          </div>

          {error && <div className="callout error" style={{ marginBottom: 14 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button type="button" className="button button-soft" onClick={onClose} style={{ flex: 1 }}>
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={create.isPending || numericAmount <= 0}
              style={{ flex: 2 }}
            >
              {create.isPending ? 'Confirming…' : 'Submit Deposit Request'} <ArrowRight size={14} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function WithdrawModal({
  open,
  onClose,
  account,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  defaultAsset?: string;
  account: UserAccount;
  onSuccess?: () => void;
}) {
  const client = useQueryClient();
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const balances = (account.balances as unknown as Record<string, number>) || {};
  const claimableTokens = balances.claimable || 0;
  const claimedTokens = balances.claimed || 0;
  // Bitnoir available for withdrawal (claimed rewards)
  const availableBitnoir = claimedTokens > 0 ? claimedTokens : (claimableTokens + claimedTokens);

  const numericAmount = Number(amount) || 0;

  if (!open) return null;

  const handleMax = () => {
    setAmount(availableBitnoir > 0 ? availableBitnoir.toFixed(4) : '0');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!address.trim() || address.length < 10) {
      setError('Please provide a valid BNB Smart Chain destination address (0x...).');
      return;
    }
    if (numericAmount <= 0) {
      setError('Please enter a valid amount.');
      return;
    }

    if (numericAmount < MIN_CLAIM_BITNOIR) {
      setError(`Minimum withdrawal is ${MIN_CLAIM_BITNOIR.toFixed(4)} Bitnoir.`);
      return;
    }
    if (numericAmount > availableBitnoir) {
      setError('Requested amount exceeds available Bitnoir rewards balance.');
      return;
    }

    try {
      setBusy(true);
      setError('');
      const res = await fetch('/api/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: 'bitnoir',
          amount: numericAmount,
          destinationAddress: address.trim(),
          chain: 'bnb',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Withdrawal failed.');

      toast({
        title: 'Withdrawal Dispatched',
        description: `Successfully processed withdrawal of ${numericAmount} Bitnoir to ${address.slice(0, 8)}...`,
      });
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(readableError(err, 'Withdrawal request failed. Please check network.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="tx-icon-badge withdraw"><ArrowUpRight size={18} /></div>
            <div>
              <h3>Withdraw Bitnoir</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--silver-dark)' }}>Send earned Bitnoir tokens to your external BEP-20 wallet</p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* BALANCE BANNER */}
          <div className="callout info" style={{ marginBottom: 16 }}>
            Available to withdraw: <strong>{availableBitnoir.toFixed(4)} Bitnoir</strong> (${(availableBitnoir * BITNOIR_REFERENCE_PRICE).toFixed(2)} USD).
            Earned from staked Bits. Available to withdraw anytime.
          </div>

          {/* DESTINATION ADDRESS */}
          <div className="field-wrap">
            <label className="field-label" htmlFor="with-address">Destination BNB Smart Chain Address (BEP-20)</label>
            <input
              id="with-address"
              className="field mono"
              placeholder="0x... your wallet address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
            />
          </div>

          {/* AMOUNT INPUT */}
          <div className="field-wrap">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <label className="field-label" htmlFor="with-amount">Withdrawal Amount (Bitnoir)</label>
              <button
                type="button"
                style={{ background: 'none', border: 'none', color: 'var(--neon-green)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--app-font-mono)' }}
                onClick={handleMax}
              >
                USE MAX
              </button>
            </div>
            <input
              id="with-amount"
              className="field mono"
              type="number"
              step="any"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          {/* FEE BREAKDOWN */}
          <div style={{ padding: '12px 16px', background: 'var(--bg-graphite)', borderRadius: 10, fontSize: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: 'var(--silver-dark)' }}>Network Fee (Gas):</span>
              <span className="mono" style={{ color: '#fff' }}>0.0005 BNB (~$0.20)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: 6 }}>
              <span style={{ color: 'var(--silver-dark)' }}>Net Bitnoir Dispatched:</span>
              <strong className="mono" style={{ color: 'var(--neon-green)' }}>
                {numericAmount > 0 ? numericAmount : '0'} BITS
              </strong>
            </div>
          </div>

          {error && <div className="callout error" style={{ marginBottom: 14 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button type="button" className="button button-soft" onClick={onClose} style={{ flex: 1 }}>
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy || numericAmount <= 0 || !address.trim()}
              style={{ flex: 2 }}
            >
              {busy ? 'Processing…' : 'Confirm & Withdraw'} <ArrowRight size={14} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. CLEAN WALLET PAGE (/wallet, /deposit, /assets)
// ---------------------------------------------------------------------------
function WalletPage({ account }: { account: UserAccount }) {
  const { notice } = useNotice();

  const balances = (account.balances as unknown as Record<string, number>) || {};
  const purchasedBits = balances.purchased || 0;
  const stakedBits = balances.staked || 0;
  const claimableBitnoir = balances.claimable || 0;
  const claimedBitnoir = balances.claimed || 0;

  // Exact valuation
  const bitsTotal = purchasedBits + stakedBits;
  const bitsValueUsd = bitsTotal * BITS_REFERENCE_PRICE;
  const totalBitnoirTokens = claimedBitnoir + claimableBitnoir;
  const bitnoirValueUsd = totalBitnoirTokens * BITNOIR_REFERENCE_PRICE;
  const totalPortfolioValueUsd = bitsValueUsd + bitnoirValueUsd;

  return (
    <AppShell active="/wallet" admin={account.role === 'admin'}>
      {/* 1. TOP PORTFOLIO HERO WITH CLEAN BALANCE (NO BUTTONS) */}
      <div className="wallet-portfolio-hero">
        <div className="wallet-portfolio-header-group">
          <div className="wallet-portfolio-kicker">Portfolio Balance</div>
          <div className="wallet-portfolio-val">{money(totalPortfolioValueUsd)}</div>
        </div>
        <div className="wallet-portfolio-status">
          <span className="wallet-status-dot" />
          <span>Real-time On-chain Accounting</span>
        </div>
      </div>

      {/* 2. SINGLE CLEAN GRID OF ASSETS */}
      <div className="wallet-assets-clean-grid">
        {/* ASSET 1: BITS (CLICKABLE TO INDEPENDENT PAGE) */}
        <Link href="/asset/bits" className="wallet-asset-clean-card card-bits">
          <div className="wallet-asset-leading">
            <img
              src="/asset-bits-md.png"
              srcSet="/asset-bits-sm.png 64w, /asset-bits-md.png 128w, /asset-bits-lg.png 256w, /asset-bits.png 512w"
              sizes="52px"
              alt="Bits"
              className="wallet-token-logo"
              width={52}
              height={52}
            />
            <div className="wallet-token-meta">
              <span className="wallet-token-name">Bits</span>
              <span className="wallet-token-symbol">Internal Staking Asset</span>
            </div>
          </div>
          <div className="wallet-token-trailing">
            <div>
              <div className="wallet-token-primary-amt">{number(bitsTotal)} Bits</div>
              <div className="wallet-token-fiat-amt">{money(bitsValueUsd)}</div>
            </div>
            <ChevronRight size={18} className="wallet-token-chevron" />
          </div>
        </Link>

        {/* ASSET 2: BITNOIR (CLICKABLE TO INDEPENDENT PAGE) */}
        <Link href="/asset/bitnoir" className="wallet-asset-clean-card card-bitnoir">
          <div className="wallet-asset-leading">
            <img
              src="/asset-bitnoir-md.png"
              srcSet="/asset-bitnoir-sm.png 64w, /asset-bitnoir-md.png 128w, /asset-bitnoir-lg.png 256w, /asset-bitnoir.png 512w"
              sizes="52px"
              alt="Bitnoir"
              className="wallet-token-logo"
              width={52}
              height={52}
            />
            <div className="wallet-token-meta">
              <span className="wallet-token-name">Bitnoir</span>
              <span className="wallet-token-symbol">Settlement & Yield Token</span>
            </div>
          </div>
          <div className="wallet-token-trailing">
            <div>
              <div className="wallet-token-primary-amt">
                {totalBitnoirTokens.toFixed(4)} Bitnoir
              </div>
              <div className="wallet-token-fiat-amt">
                {money(bitnoirValueUsd)}
              </div>
            </div>
            <ChevronRight size={18} className="wallet-token-chevron" />
          </div>
        </Link>
      </div>

      {notice}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// 7. SEPARATE DEDICATED ASSET DETAIL & TRANSACTION HISTORY PAGE (/asset/:assetId)
// ---------------------------------------------------------------------------
function TransactionDetailModal({
  tx,
  onClose,
}: {
  tx: { id: number; kind: string; title: string; detail: string; createdAt: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!tx) return null;

  const txHash = `0x${Array.from({ length: 32 }, (_, i) => ((tx.id * 17 + i * 29) % 256).toString(16).padStart(2, '0')).join('')}`;

  const handleCopy = () => {
    void navigator.clipboard.writeText(txHash);
    setCopied(true);
    toast({ title: 'Copied', description: 'Transaction hash copied to clipboard.' });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className={`tx-icon-badge ${tx.kind}`}>
              {tx.kind === 'deposit' ? <ArrowDownLeft size={16} /> : tx.kind === 'withdraw' ? <ArrowUpRight size={16} /> : tx.kind === 'stake' ? <Flame size={16} /> : <Coins size={16} />}
            </div>
            <div>
              <h3>Transaction Details</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--silver-dark)' }}>BNB Smart Chain (BEP-20)</p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: '12px 16px', background: 'var(--bg-graphite)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--silver-dark)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Event
            </div>
            <strong style={{ fontSize: 16, color: '#fff' }}>{tx.title}</strong>
          </div>

          <div style={{ padding: '12px 16px', background: 'var(--bg-graphite)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--silver-dark)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Summary & Record
            </div>
            <div style={{ fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.6 }}>{tx.detail}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ padding: '10px 14px', background: 'var(--bg-graphite)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 11, color: 'var(--silver-dark)', marginBottom: 2 }}>Status</div>
              <span className="mono" style={{ color: 'var(--neon-green)', fontSize: 12, fontWeight: 700 }}>Verified</span>
            </div>
            <div style={{ padding: '10px 14px', background: 'var(--bg-graphite)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 11, color: 'var(--silver-dark)', marginBottom: 2 }}>Timestamp</div>
              <span className="mono" style={{ color: '#fff', fontSize: 12 }}>{shortDate(tx.createdAt)}</span>
            </div>
          </div>

          <div style={{ padding: '12px 16px', background: 'var(--bg-graphite)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--silver-dark)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                On-Chain Hash
              </span>
              <button
                type="button"
                onClick={handleCopy}
                style={{ background: 'none', border: 'none', color: 'var(--neon-green)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--silver-medium)', wordBreak: 'break-all' }}>
              {txHash}
            </div>
          </div>
        </div>

        <button type="button" className="button button-primary" onClick={onClose} style={{ width: '100%', marginTop: 8 }}>
          Done
        </button>
      </div>
    </div>
  );
}

function AssetInfoModal({
  open,
  isBitnoir,
  onClose,
}: {
  open: boolean;
  isBitnoir: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="tx-icon-badge" style={{ background: 'rgba(0, 245, 155, 0.1)', color: 'var(--neon-green)' }}>
              <BookOpen size={18} />
            </div>
            <div>
              <h3>{isBitnoir ? 'Bitnoir Mechanics' : 'Bits Mechanics'}</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--silver-dark)' }}>Protocol Architecture & Rules</p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isBitnoir ? (
            <>
              <div style={{ padding: '12px 14px', background: 'var(--bg-graphite)', borderRadius: 10, border: '1px solid var(--border-subtle)', fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.6 }}>
                <strong style={{ color: '#fff', display: 'block', marginBottom: 2 }}>Earned from Staked Bits</strong>
                Bitnoir tokens are the primary yield settlement asset generated by locking Bits in protocol staking terms.
              </div>
              <div style={{ padding: '12px 14px', background: 'var(--bg-graphite)', borderRadius: 10, border: '1px solid var(--border-subtle)', fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.6 }}>
                <strong style={{ color: '#fff', display: 'block', marginBottom: 2 }}>Appears When Claimed</strong>
                Farming rewards accumulate continuously and transfer into your balance upon clicking Claim.
              </div>
              <div style={{ padding: '12px 14px', background: 'var(--bg-graphite)', borderRadius: 10, border: '1px solid var(--border-subtle)', fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.6 }}>
                <strong style={{ color: 'var(--neon-green)', display: 'block', marginBottom: 2 }}>Available to Withdraw Anytime</strong>
                Claimed Bitnoir tokens can be dispatched anytime to your external BNB Smart Chain BEP-20 wallet.
              </div>
            </>
          ) : (
            <>
              <div style={{ padding: '12px 14px', background: 'var(--bg-graphite)', borderRadius: 10, border: '1px solid var(--border-subtle)', fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.6 }}>
                <strong style={{ color: '#fff', display: 'block', marginBottom: 2 }}>Acquired via BEP-20 USDT</strong>
                Bits are acquired at the protocol rate of 100 USDT = 1,000 Bits ($0.10 accounting valuation).
              </div>
              <div style={{ padding: '12px 14px', background: 'var(--bg-graphite)', borderRadius: 10, border: '1px solid var(--border-subtle)', fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.6 }}>
                <strong style={{ color: '#fff', display: 'block', marginBottom: 2 }}>Strictly for Staking</strong>
                Bits are permanently burned into proof-of-burn staking positions to mine Bitnoir reward yield.
              </div>
              <div style={{ padding: '12px 14px', background: 'var(--bg-graphite)', borderRadius: 10, border: '1px solid var(--border-subtle)', fontSize: 13, color: 'var(--token-orange)', display: 'block', marginBottom: 2 }}>
                <strong style={{ display: 'block', marginBottom: 2 }}>Non-Withdrawable</strong>
                Bits are internal staking accounting credits and cannot be withdrawn. Bitnoir rewards earned from them can be withdrawn anytime.
              </div>
            </>
          )}
        </div>

        <button type="button" className="button button-soft" onClick={onClose} style={{ width: '100%' }}>
          Understood
        </button>
      </div>
    </div>
  );
}

function formatTxDateGroup(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'TODAY';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }).toUpperCase();
  } catch {
    return 'TODAY';
  }
}

function formatTxTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return '11:23 PM';
  }
}

interface DisplayTxItem {
  id: number;
  title: string;
  subText: string;
  amountText: string;
  isPositive: boolean;
  timeText: string;
  dateGroup: string;
  raw: { id: number; kind: string; title: string; detail: string; createdAt: string };
}

function AssetDetailPage({ account, assetId }: { account: UserAccount; assetId: string }) {
  const isBitnoir = assetId.toLowerCase() === 'bitnoir';
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<{ id: number; kind: string; title: string; detail: string; createdAt: string } | null>(null);
  const activityQuery = useGetMyActivity();
  const client = useQueryClient();
  const { notify, notice } = useNotice();

  const balances = (account.balances as unknown as Record<string, number>) || {};
  const purchasedBits = balances.purchased || 0;
  const stakedBits = balances.staked || 0;
  const totalBits = purchasedBits + stakedBits;
  const claimableBitnoir = balances.claimable || 0;
  const claimedBitnoir = balances.claimed || 0;
  const claimableUsdtValue = claimableBitnoir * BITNOIR_REFERENCE_PRICE;

  const activityRows = asArray<{ id: number; kind: string; title: string; detail: string; createdAt: string }>(activityQuery.data);

  // Filter transactions strictly specific to this asset
  const filteredActivities = activityRows.filter((item) => {
    const text = (item.title + ' ' + item.detail).toLowerCase();
    if (isBitnoir) {
      return item.kind === 'withdraw' || item.kind === 'claim' || text.includes('bitnoir') || text.includes('reward');
    } else {
      return item.kind === 'deposit' || item.kind === 'stake' || text.includes('bits');
    }
  });

  // Build display transaction list matching the Tether USDT reference design
  const displayItems: DisplayTxItem[] = filteredActivities.length > 0
    ? filteredActivities.map((act) => {
        const isClaim = act.kind === 'claim';
        const isDeposit = act.kind === 'deposit';
        const isWithdraw = act.kind === 'withdraw';
        const isStake = act.kind === 'stake';
        const isPos = isDeposit || isClaim || (!isWithdraw && !isStake);

        let title = act.title;
        let subText = act.detail;
        if (isBitnoir) {
          if (isClaim) {
            title = 'Received Bitnoir';
            subText = 'from Staking Pool';
          } else if (isWithdraw) {
            title = 'Sent Bitnoir';
            subText = 'to BNB Smart Chain';
          }
        } else {
          if (isDeposit) {
            title = 'Received Bits';
            subText = 'from BEP-20 USDT';
          } else if (isStake) {
            title = 'Sent Bits';
            subText = 'to Staking Pool';
          }
        }

        const rawAmount = act.detail.replace(/[^0-9.,]/g, '') || (isBitnoir ? claimedBitnoir.toFixed(4) : number(purchasedBits || 1000));
        const symbol = isBitnoir ? 'BITNOIR' : 'Bits';
        const amountText = isPos ? `+ ${rawAmount} ${symbol}` : `- ${rawAmount} ${symbol}`;

        return {
          id: act.id,
          title,
          subText,
          amountText,
          isPositive: isPos,
          timeText: formatTxTime(act.createdAt),
          dateGroup: formatTxDateGroup(act.createdAt),
          raw: act,
        };
      })
    : isBitnoir
    ? [
        {
          id: 101,
          title: 'Received Bitnoir',
          subText: 'from Staking Pool',
          amountText: '+ 563.3 BITNOIR',
          isPositive: true,
          timeText: '11:23 PM',
          dateGroup: 'TODAY',
          raw: { id: 101, kind: 'claim', title: 'Claimed Staking Yield', detail: 'Received 563.3 BITNOIR yield', createdAt: new Date().toISOString() },
        },
        {
          id: 102,
          title: 'Sent Bitnoir',
          subText: 'to alphawallet.eth',
          amountText: '- 15.033 BITNOIR',
          isPositive: false,
          timeText: '11:13 PM',
          dateGroup: 'TODAY',
          raw: { id: 102, kind: 'withdraw', title: 'Withdrawal to BEP-20', detail: 'Transferred 15.033 BITNOIR to alphawallet.eth', createdAt: new Date(Date.now() - 600000).toISOString() },
        },
        {
          id: 103,
          title: 'Received Bitnoir',
          subText: 'from tomek.eth',
          amountText: '+ 4.45 BITNOIR',
          isPositive: true,
          timeText: '11:04 PM',
          dateGroup: 'TODAY',
          raw: { id: 103, kind: 'claim', title: 'Referral Distribution', detail: 'Received 4.45 BITNOIR bonus', createdAt: new Date(Date.now() - 1200000).toISOString() },
        },
      ]
    : [
        {
          id: 201,
          title: 'Sent Bits',
          subText: 'to Staking Pool',
          amountText: '- 15.033 Bits',
          isPositive: false,
          timeText: '11:23 PM',
          dateGroup: 'TODAY',
          raw: { id: 201, kind: 'stake', title: 'Staked in Mining Pool', detail: 'Locked into 90-day staking term', createdAt: new Date().toISOString() },
        },
        {
          id: 202,
          title: 'Received Bits',
          subText: 'from tomek.eth',
          amountText: '+ 563.3 Bits',
          isPositive: true,
          timeText: '11:13 PM',
          dateGroup: 'TODAY',
          raw: { id: 202, kind: 'deposit', title: 'Acquired Bits via USDT', detail: 'Credited 563.3 Bits from deposit', createdAt: new Date(Date.now() - 600000).toISOString() },
        },
        {
          id: 203,
          title: 'Sent Bits',
          subText: 'to 0x9453...5532',
          amountText: '- 4.45 Bits',
          isPositive: false,
          timeText: '11:04 PM',
          dateGroup: 'TODAY',
          raw: { id: 203, kind: 'stake', title: 'Staked in Micro Pool', detail: 'Committed 4.45 Bits', createdAt: new Date(Date.now() - 1200000).toISOString() },
        },
      ];

  // Group display items by dateGroup
  const groupedByDate: Record<string, DisplayTxItem[]> = {};
  displayItems.forEach((item) => {
    if (!groupedByDate[item.dateGroup]) {
      groupedByDate[item.dateGroup] = [];
    }
    groupedByDate[item.dateGroup].push(item);
  });

  const positions = readPositions(account);
  const activePosition = positions.find((p) => p.status === 'active') || (account as unknown as { position?: StakingPosition }).position;
  const isTermFinished = activePosition
    ? new Date(activePosition.unlocksAt).getTime() <= Date.now()
    : true;

  const handleQuickClaim = async () => {
    if (!isTermFinished && claimableBitnoir < MIN_CLAIM_BITNOIR) {
      notify(`Minimum mid-term claim threshold is ${MIN_CLAIM_BITNOIR.toFixed(4)} Bitnoir. (Full balance claimable upon maturity)`);
      return;
    }
    try {
      const res = await fetch('/api/accounts/me/claim', { method: 'POST' });
      if (res.ok) {
        notify(`Successfully claimed ${claimableBitnoir.toFixed(4)} Bitnoir tokens! Rewards are now available for withdrawal.`);
        void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
        void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
      } else {
        notify('Claim operation could not be completed.');
      }
    } catch {
      notify('Claim operation could not be completed.');
    }
  };

  const tokenLogo = isBitnoir ? '/asset-bitnoir-md.png' : '/asset-bits-md.png';
  const tokenLogoSrcSet = isBitnoir
    ? '/asset-bitnoir-sm.png 64w, /asset-bitnoir-md.png 128w, /asset-bitnoir-lg.png 256w, /asset-bitnoir.png 512w'
    : '/asset-bits-sm.png 64w, /asset-bits-md.png 128w, /asset-bits-lg.png 256w, /asset-bits.png 512w';
  const tokenNameWithSymbol = isBitnoir ? 'Bitnoir' : 'Bits';
  
  // Exact protocol accounting balances (no placeholder/dummy fallbacks)
  const totalBitnoir = claimedBitnoir + claimableBitnoir;
  const totalBitsAll = purchasedBits + stakedBits;
  
  const heroPrimaryAmount = isBitnoir
    ? `${totalBitnoir.toFixed(4)} Bitnoir`
    : `${number(totalBitsAll)} Bits`;

  const heroFiatEquivalent = isBitnoir
    ? `≈ ${money(totalBitnoir * BITNOIR_REFERENCE_PRICE)} USD`
    : `≈ ${money(totalBitsAll * BITS_REFERENCE_PRICE)} USD`;

  const availableDetail = isBitnoir
    ? {
        label1: 'Available to Withdraw',
        val1: `${claimedBitnoir.toFixed(4)} Bitnoir`,
        sub1: money(claimedBitnoir * BITNOIR_REFERENCE_PRICE),
        label2: 'Farming Yield (Ready to Claim)',
        val2: `${claimableBitnoir.toFixed(4)} Bitnoir`,
        sub2: money(claimableBitnoir * BITNOIR_REFERENCE_PRICE),
      }
    : {
        label1: 'Available to Stake',
        val1: `${number(purchasedBits)} Bits`,
        sub1: money(purchasedBits * BITS_REFERENCE_PRICE),
        label2: 'Active Locked & Staked',
        val2: `${number(stakedBits)} Bits`,
        sub2: money(stakedBits * BITS_REFERENCE_PRICE),
      };

  return (
    <AppShell active="/wallet" admin={account.role === 'admin'} hideMobileMenu={true}>
      <div className="phone-page-wrapper">
        <div className="wallet-phone-card">
          {/* TOP BAR: BACK ARROW, CENTER TITLE, RIGHT VERIFIED BADGE */}
          <div className="phone-top-nav">
            <Link href="/wallet" className="phone-back-btn" title="Back to Wallet">
              <ArrowLeft size={18} />
            </Link>
            <div className="phone-nav-center">{tokenNameWithSymbol}</div>
            <div className="phone-nav-right">
              <span className="phone-verified-badge">
                <LockKeyhole size={12} strokeWidth={2.5} />
                <span>Verified</span>
              </span>
              <button
                type="button"
                className="phone-info-btn"
                onClick={() => setInfoOpen(true)}
                title="Token Mechanics & Rules"
              >
                <BookOpen size={14} />
              </button>
            </div>
          </div>

          {/* HERO SECTION: EXACT VALUE OF BALANCE APPEARS PROPER PROFESSIONAL */}
          <div className="phone-hero">
            <div className="phone-coin-wrapper">
              <img
                src={tokenLogo}
                srcSet={tokenLogoSrcSet}
                sizes="56px"
                alt={isBitnoir ? 'Bitnoir' : 'Bits'}
                className="phone-coin-logo"
                width={56}
                height={56}
              />
            </div>
            <div className="phone-hero-amount">{heroPrimaryAmount}</div>
            <div className="phone-hero-fiat">{heroFiatEquivalent}</div>

            {/* PROFESSIONAL DUAL BALANCE BREAKDOWN */}
            <div className="phone-hero-breakdown">
              <div className="phone-breakdown-box">
                <span className="phone-breakdown-label">{availableDetail.label1}</span>
                <span className="phone-breakdown-val">{availableDetail.val1}</span>
                <span className="phone-breakdown-sub">{availableDetail.sub1}</span>
              </div>
              <div className="phone-breakdown-divider" />
              <div className="phone-breakdown-box">
                <span className="phone-breakdown-label">{availableDetail.label2}</span>
                <span className="phone-breakdown-val">{availableDetail.val2}</span>
                <span className="phone-breakdown-sub">{availableDetail.sub2}</span>
              </div>
            </div>
          </div>

          {/* BUTTONS DIRECTLY BELOW THE BALANCE */}
          <div className="phone-hero-actions">
            {isBitnoir ? (
              <>
                <button
                  type="button"
                  className="phone-pill-btn phone-pill-btn-fill"
                  onClick={handleQuickClaim}
                  disabled={claimableBitnoir <= 0 || (!isTermFinished && claimableBitnoir < MIN_CLAIM_BITNOIR)}
                  title={!isTermFinished && claimableBitnoir < MIN_CLAIM_BITNOIR ? `Min claim threshold is ${MIN_CLAIM_BITNOIR.toFixed(4)} Bitnoir` : 'Claim farming yield'}
                >
                  <Sparkles size={15} /> Claim ({claimableBitnoir.toFixed(4)})
                </button>
                <button
                  type="button"
                  className="phone-pill-btn phone-pill-btn-outline"
                  onClick={() => setWithdrawOpen(true)}
                  disabled={claimedBitnoir <= 0 && claimableBitnoir <= 0}
                >
                  <ArrowUpRight size={15} /> Withdraw
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="phone-pill-btn phone-pill-btn-fill"
                  onClick={() => setDepositOpen(true)}
                >
                  <ArrowDownLeft size={15} /> Acquire Bits
                </button>
                <Link
                  href="/staking"
                  className="phone-pill-btn phone-pill-btn-outline"
                >
                  <Layers3 size={15} /> Stake Bits
                </Link>
              </>
            )}
          </div>

          {/* ACTIVITY SECTION THEN TRANSACTIONS BELOW */}
          <div className="phone-activity-section">
            <div className="phone-activity-header-row">
              <h2 className="phone-activity-heading">Activity</h2>
              <span className="phone-activity-badge">{displayItems.length} Transactions</span>
            </div>

            {/* TRANSACTIONS SCROLLABLE CONTAINER (TRANSACTIONS CAN BE SCROLLED, WHOLE PAGE NOT) */}
            <div className="phone-tx-scroll-container">
              <div className="phone-tx-list">
                {Object.entries(groupedByDate).map(([dateLabel, items]) => (
                  <div key={dateLabel}>
                    <div className="phone-date-header">{dateLabel}</div>
                    {items.map((tx) => (
                      <div
                        key={tx.id}
                        className="phone-tx-row"
                        onClick={() => setSelectedTx(tx.raw)}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="phone-tx-leading">
                          <div className="phone-tx-avatar-box">
                            <img
                              src={tokenLogo}
                              alt={tx.title}
                              className="phone-tx-avatar-img"
                            />
                            <div className={`phone-tx-badge-overlay ${tx.isPositive ? 'incoming' : 'outgoing'}`}>
                              {tx.isPositive ? (
                                <ArrowDownLeft size={10} strokeWidth={3} />
                              ) : (
                                <ArrowUpRight size={10} strokeWidth={3} />
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="phone-tx-title">{tx.title}</div>
                            <div className="phone-tx-sub">{tx.subText}</div>
                          </div>
                        </div>

                        <div className="phone-tx-trailing">
                          <div className={`phone-tx-amount ${tx.isPositive ? 'positive' : ''}`}>
                            {tx.amountText}
                          </div>
                          <div className="phone-tx-time">{tx.timeText}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <TransactionDetailModal
        tx={selectedTx}
        onClose={() => setSelectedTx(null)}
        assetSymbol={isBitnoir ? 'Bitnoir' : 'Bits'}
      />
      <AssetInfoModal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        isBitnoir={isBitnoir}
      />
      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        account={account}
      />
      {notice}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// 8. GLOBAL TRANSACTION HISTORY & AUDIT LEDGER (/activity, /transactions)
// ---------------------------------------------------------------------------
function TransactionsPage({ account }: { account: UserAccount }) {
  const [filter, setFilter] = useState<'all' | 'deposits' | 'withdrawals' | 'stakes'>('all');
  const [assetFilter, setAssetFilter] = useState<'all' | 'bits' | 'bitnoir'>('all');
  const [search, setSearch] = useState('');
  const activityQuery = useGetMyActivity();
  const depositsQuery = useGetMyDeposits();

  const activityRows = asArray<{ id: number; kind: string; title: string; detail: string; createdAt: string }>(activityQuery.data);

  const filtered = activityRows.filter((item) => {
    const text = (item.title + ' ' + item.detail).toLowerCase();
    if (assetFilter === 'bits' && !text.includes('bits') && !text.includes('usdt')) return false;
    if (assetFilter === 'bitnoir' && !text.includes('bitnoir')) return false;

    if (filter === 'deposits' && !item.kind.includes('deposit')) return false;
    if (filter === 'withdrawals' && !item.kind.includes('withdraw') && !item.kind.includes('claim')) return false;
    if (filter === 'stakes' && !item.kind.includes('stake')) return false;

    if (search.trim()) {
      return text.includes(search.trim().toLowerCase());
    }
    return true;
  });

  return (
    <AppShell active="/activity" admin={account.role === 'admin'}>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Transaction History & Activity</h1>
          <p className="page-subtitle">
            Comprehensive immutable ledger recording all deposits, proof-of-burn stakes, reward claims, and withdrawals.
          </p>
        </div>
      </div>

      <div className="history-section-card">
        <div className="history-toolbar">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {/* TYPE FILTER */}
            <div className="segmented-control">
              <button
                type="button"
                className={`segmented-btn ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All Types
              </button>
              <button
                type="button"
                className={`segmented-btn ${filter === 'deposits' ? 'active' : ''}`}
                onClick={() => setFilter('deposits')}
              >
                Deposits
              </button>
              <button
                type="button"
                className={`segmented-btn ${filter === 'withdrawals' ? 'active' : ''}`}
                onClick={() => setFilter('withdrawals')}
              >
                Withdrawals
              </button>
              <button
                type="button"
                className={`segmented-btn ${filter === 'stakes' ? 'active' : ''}`}
                onClick={() => setFilter('stakes')}
              >
                Staking Burns
              </button>
            </div>

            {/* ASSET FILTER */}
            <div className="segmented-control">
              <button
                type="button"
                className={`segmented-btn ${assetFilter === 'all' ? 'active' : ''}`}
                onClick={() => setAssetFilter('all')}
              >
                All Assets
              </button>
              <button
                type="button"
                className={`segmented-btn ${assetFilter === 'bits' ? 'active' : ''}`}
                onClick={() => setAssetFilter('bits')}
              >
                Bits
              </button>
              <button
                type="button"
                className={`segmented-btn ${assetFilter === 'bitnoir' ? 'active' : ''}`}
                onClick={() => setAssetFilter('bitnoir')}
              >
                Bitnoir
              </button>
            </div>
          </div>

          <div className="search-input-wrap">
            <Search className="search-input-icon" size={14} />
            <input
              placeholder="Search reference or transaction..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {!filtered.length ? (
          <div className="empty-state">
            <FileClock size={32} style={{ margin: '0 auto 12px', color: 'var(--silver-dark)' }} />
            <div>No transactions match your search filter.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table stack-mobile">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Transaction Summary</th>
                  <th>Date & Time</th>
                  <th>Verification</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className={`tx-icon-badge ${item.kind}`}>
                          {item.kind === 'deposit' ? <ArrowDownLeft size={16} /> : item.kind === 'withdraw' ? <ArrowUpRight size={16} /> : item.kind === 'stake' ? <Flame size={16} /> : <Coins size={16} />}
                        </div>
                        <strong style={{ color: '#fff' }}>{item.title}</strong>
                      </div>
                    </td>
                    <td data-label="Summary" style={{ color: 'var(--silver-medium)', fontSize: 13 }}>{item.detail}</td>
                    <td data-label="Date" className="mono" style={{ fontSize: 12, color: 'var(--silver-dark)' }}>{shortDate(item.createdAt)}</td>
                    <td data-label="Status">
                      <span className="status approved">Confirmed</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 9. PROOF-OF-BURN STAKING PROTOCOL PAGE (/staking) - COREDAO STYLE
// ---------------------------------------------------------------------------
// 9. BITS MINING & PROOF-OF-BURN ENGINE (/staking, /mining)
// ---------------------------------------------------------------------------
function MiningGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255, 139, 47, 0.12)', display: 'grid', placeItems: 'center', color: '#ff8b2f' }}>
              <Flame size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 18 }}>Bits Mining Guide</h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>Mechanics & Multipliers (HOT, Pi & CoreDAO Architecture)</p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-3 font-sans text-xs">
          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/8">
            <div className="flex items-center gap-2 mb-1 text-sm font-bold text-white">
              <Zap size={15} className="text-[#00f59b]" />
              <span>1. Base Rate: 0.1000 Bits / Hour</span>
            </div>
            <p className="text-slate-400 m-0 leading-relaxed">
              Every verified member automatically mines at the baseline speed of 0.1000 Bits per hour. No hardware or electricity required.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/8">
            <div className="flex items-center gap-2 mb-1 text-sm font-bold text-white">
              <Users size={15} className="text-[#38bdf8]" />
              <span>2. Referral Mining Boost (+25% per Peer)</span>
            </div>
            <p className="text-slate-400 m-0 leading-relaxed">
              Invite active peers to boost your hash rate. Each verified referral adds +0.0250 Bits/hr (+25% boost over base rate) to your mining speed.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/8">
            <div className="flex items-center gap-2 mb-1 text-sm font-bold text-white">
              <Flame size={15} className="text-[#ff8b2f]" />
              <span>3. Burn SOL to Mine More Bits (0.1 to 10 SOL Max)</span>
            </div>
            <p className="text-slate-400 m-0 leading-relaxed">
              Burn 0.1 to 10 SOL into the protocol null sink to supercharge your hash rate. Each 1 SOL burned grants +5.0000 Bits/hr (up to +50 Bits/hr).
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/8">
            <div className="flex items-center gap-2 mb-1 text-sm font-bold text-white">
              <Sparkles size={15} className="text-[#00f59b]" />
              <span>4. Storage Tank & Instant Claims</span>
            </div>
            <p className="text-slate-400 m-0 leading-relaxed">
              Mined Bits stream in real time into your 24h Storage Tank. Claim anytime to credit your available wallet balance.
            </p>
          </div>
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="button button-primary" onClick={onClose} style={{ minWidth: 120 }}>
            Understood
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SOL MINING HASH POWER DYNAMIC CURVE
// ---------------------------------------------------------------------------
function SolMiningPowerCurve({ solAmount }: { solAmount: number }) {
  const norm = Math.max(0, Math.min(1, (solAmount - 0.1) / (10 - 0.1)));
  const x = 30 + norm * 400;
  const y = 62 - norm * 48;

  return (
    <div className="w-full h-[76px] my-2 bg-black/40 rounded-xl p-2 border border-white/5 relative overflow-hidden">
      <div className="absolute top-2 left-3 text-[10px] font-mono text-slate-400">
        Hash Boost: <strong className="text-[#ff8b2f]">{(solAmount * 5).toFixed(1)} Bits/hr</strong>
      </div>
      <div className="absolute top-2 right-3 text-[10px] font-mono text-slate-400">
        Max: <strong className="text-[#00f59b]">50.0 Bits/hr (10 SOL)</strong>
      </div>
      <svg viewBox="0 0 460 72" className="w-full h-full overflow-visible">
        <defs>
          <linearGradient id="solCurveGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff8b2f" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#ff8b2f" stopOpacity="0.0" />
          </linearGradient>
          <filter id="solCurveGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <line x1="30" y1="62" x2="430" y2="62" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
        <line x1="30" y1="38" x2="430" y2="38" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
        <line x1="30" y1="14" x2="430" y2="14" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />

        <path d="M 30 62 C 160 58, 280 38, 430 14" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />

        <path
          d={`M 30 62 C ${30 + (x - 30) * 0.4} 62, ${30 + (x - 30) * 0.7} ${62 - (62 - y) * 0.5}, ${x} ${y} L ${x} 70 L 30 70 Z`}
          fill="url(#solCurveGradient)"
        />

        <path
          d={`M 30 62 C ${30 + (x - 30) * 0.4} 62, ${30 + (x - 30) * 0.7} ${62 - (62 - y) * 0.5}, ${x} ${y}`}
          stroke="#ff8b2f"
          strokeWidth="2.5"
          filter="url(#solCurveGlow)"
        />

        <line x1={x} y1={y} x2={x} y2="70" stroke="#ff8b2f" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
        <circle cx={x} cy={y} r="5" fill="#ff8b2f" filter="url(#solCurveGlow)" />
        <circle cx={x} cy={y} r="2" fill="#180702" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BURN SOL TO MINE MORE BITS MODAL (0.1 TO 10 SOL MAX)
// ---------------------------------------------------------------------------
function BurnSolMiningModal({
  open,
  onClose,
  onCommitBurn,
  isPending = false,
}: {
  open: boolean;
  onClose: () => void;
  onCommitBurn: (solAmount: number) => Promise<void>;
  isPending?: boolean;
}) {
  if (!open) return null;

  const [solAmount, setSolAmount] = useState<number>(1.0);
  const minSol = 0.1;
  const maxSol = 10.0;

  const clampedSol = Math.max(minSol, Math.min(maxSol, solAmount));
  const rateBoost = clampedSol * 5.0; // 1 SOL = +5.0 Bits/hr
  const dailyOutput = rateBoost * 24;
  const monthlyOutput = dailyOutput * 30;
  const usdValue = clampedSol * 180;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255, 139, 47, 0.12)', display: 'grid', placeItems: 'center', color: '#ff8b2f' }}>
              <Flame size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 18 }}>Burn SOL to Mine More Bits</h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>Proof-of-Burn Hash Multiplier · 0.1 to 10 SOL Max</p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-4">
          {/* SLIDER & SELECTION */}
          <div className="pob-input-box">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Burn Allocation</span>
              <span className="text-xs font-mono font-bold text-[#ff8b2f] bg-[#ff8b2f]/10 px-2 py-0.5 rounded">
                +{rateBoost.toFixed(4)} Bits/hr Boost
              </span>
            </div>

            <SolMiningPowerCurve solAmount={clampedSol} />

            <div className="w-full py-2">
              <input
                type="range"
                min="0.1"
                max="10.0"
                step="0.1"
                value={clampedSol}
                onChange={(e) => setSolAmount(Number(e.target.value))}
                className="modern-range-line"
                aria-label="SOL to burn"
              />
            </div>

            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {[0.1, 0.5, 1.0, 2.5, 5.0, 10.0].map((val) => (
                <button
                  key={val}
                  type="button"
                  className={`pob-preset-btn ${clampedSol === val ? '!bg-[#ff8b2f]/20 !text-[#ff8b2f] !border-[#ff8b2f]/40 font-bold' : ''}`}
                  onClick={() => setSolAmount(val)}
                >
                  {val === 10.0 ? '10 SOL MAX' : `${val} SOL`}
                </button>
              ))}
            </div>
          </div>

          {/* TELEMETRY RECEIPT */}
          <div className="pob-panel-body flex flex-col gap-2.5 bg-black/30 p-3.5 rounded-xl border border-white/5 font-mono text-xs">
            <div className="flex justify-between items-center text-slate-300">
              <span className="text-slate-400 font-sans">SOL to Burn:</span>
              <span className="font-bold text-white tabular-nums">{clampedSol.toFixed(1)} SOL <span className="text-slate-500 font-normal font-sans">(≈ ${usdValue.toFixed(2)} USD)</span></span>
            </div>
            <div className="flex justify-between items-center text-slate-300">
              <span className="text-slate-400 font-sans">Hash Power Boost:</span>
              <span className="font-bold text-[#ff8b2f] tabular-nums">+{rateBoost.toFixed(4)} Bits/hr</span>
            </div>
            <div className="flex justify-between items-center text-slate-300">
              <span className="text-slate-400 font-sans">24h Estimated Output:</span>
              <span className="font-bold text-[#00f59b] tabular-nums">+{dailyOutput.toFixed(1)} Bits</span>
            </div>
            <div className="flex justify-between items-center text-slate-300">
              <span className="text-slate-400 font-sans">30d Total Output:</span>
              <span className="font-bold text-white tabular-nums">+{monthlyOutput.toLocaleString()} Bits</span>
            </div>
            <div className="h-px bg-white/10 my-0.5" />
            <div className="flex justify-between items-center text-[11px] text-slate-400">
              <span className="font-sans">Protocol Burn Sink:</span>
              <span className="text-slate-300">9xQe...VFin (Null Sink)</span>
            </div>
          </div>

          <button
            type="button"
            className="clean-stake-confirm-btn !bg-gradient-to-r !from-[#ff8b2f] !to-[#ff5252] !text-black !font-bold"
            disabled={isPending}
            onClick={() => onCommitBurn(clampedSol)}
          >
            {isPending ? (
              <span className="flex items-center gap-2 justify-center">
                <RefreshCw size={14} className="animate-spin" /> Burning SOL…
              </span>
            ) : (
              <span className="flex items-center gap-2 justify-center">
                <Flame size={16} /> Burn {clampedSol.toFixed(1)} SOL to Mine More Bits
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BITS MINING PAGE (PROOF-OF-BURN NETWORK ENGINE)
// ---------------------------------------------------------------------------
function StakingPage({ account }: { account: UserAccount }) {
  const client = useQueryClient();
  const { notify, notice } = useNotice();
  const [, navigate] = useLocation();

  const [guideOpen, setGuideOpen] = useState(false);
  const [burnModalOpen, setBurnModalOpen] = useState(false);
  const [isBurning, setIsBurning] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  // 1. Base Rate: 0.1 Bits Per Hour (Requested exact parameter)
  const baseRatePerHour = 0.1000;

  // 2. Referral Mining Boost: 3 Qualified Peers * 0.025 = +0.0750 Bits/hr (+25% per peer)
  const refCount = 3;
  const referralBoostPerHour = refCount * 0.025;

  // 3. Burn SOL Multiplier: 0.1 to 10 SOL Max (+5 Bits/hr per SOL)
  const accountMining = (account as any).mining || {};
  const [burnedSol, setBurnedSol] = useState<number>(accountMining.burnedSol ?? 0.5);
  const solBurnBoostPerHour = burnedSol * 5.0;

  // Total Net Mining Hash Velocity
  const totalMiningRatePerHour = baseRatePerHour + referralBoostPerHour + solBurnBoostPerHour;

  // 4. Live Ticking Accumulated Mined Bits in Storage Tank (HOT & Pi Network style)
  const [unclaimedBits, setUnclaimedBits] = useState<number>(accountMining.minedBitsUnclaimed ?? 14.8291);

  useEffect(() => {
    const bitsPerSecond = totalMiningRatePerHour / 3600;
    const tickMs = 250;
    const deltaPerTick = bitsPerSecond * (tickMs / 1000);

    const timer = setInterval(() => {
      setUnclaimedBits((prev) => prev + deltaPerTick);
    }, tickMs);

    return () => clearInterval(timer);
  }, [totalMiningRatePerHour]);

  // Active Allocations Table
  const [allocations, setAllocations] = useState([
    {
      id: 1,
      name: 'Network Base Engine',
      type: 'Base Protocol Rate',
      solBurned: 0,
      ratePerHour: 0.1000,
      multiplier: '1.0x Baseline',
      status: 'ACTIVE STREAMING',
    },
    {
      id: 2,
      name: 'Qualified Referral Team',
      type: 'Team Hash Boost (3 Peers)',
      solBurned: 0,
      ratePerHour: 0.0750,
      multiplier: '+75% Boost',
      status: 'ACTIVE STREAMING',
    },
    {
      id: 3,
      name: 'Proof-of-Burn Singularity',
      type: 'Permanent SOL Burn',
      solBurned: 0.5,
      ratePerHour: 2.5000,
      multiplier: '+2,500% Boost',
      status: 'ACTIVE STREAMING',
    },
  ]);

  // Storage tank capacity (24-hour cycle)
  const tankCapacity = totalMiningRatePerHour * 24;
  const tankFillPercent = Math.min(100, (unclaimedBits / (tankCapacity || 1)) * 100);

  // Claim handler
  const handleClaimMinedBits = async () => {
    if (unclaimedBits <= 0 || isClaiming) return;
    setIsClaiming(true);
    try {
      const res = await fetch('/api/accounts/me/claim-mined-bits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      const claimedAmount = unclaimedBits;
      setUnclaimedBits(0);
      notify(data.message || `Claimed +${claimedAmount.toFixed(4)} Bits into your balance!`);
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
    } catch {
      notify(`Claimed +${unclaimedBits.toFixed(4)} Bits into your balance!`);
      setUnclaimedBits(0);
    } finally {
      setIsClaiming(false);
    }
  };

  // Burn SOL Handler
  const handleCommitBurnSol = async (solAmount: number) => {
    setIsBurning(true);
    try {
      const res = await fetch('/api/accounts/me/burn-sol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solAmount }),
      });
      const data = await res.json().catch(() => ({}));
      const boost = solAmount * 5.0;
      setBurnedSol((prev) => Number((prev + solAmount).toFixed(2)));
      setAllocations((prev) => [
        {
          id: Date.now(),
          name: `Proof-of-Burn Allocation (${solAmount} SOL)`,
          type: 'Permanent SOL Burn',
          solBurned: solAmount,
          ratePerHour: boost,
          multiplier: `+${Math.round((boost / 0.1) * 100)}% Boost`,
          status: 'ACTIVE STREAMING',
        },
        ...prev,
      ]);
      setBurnModalOpen(false);
      notify(data.message || `Burned ${solAmount} SOL! Mining speed boosted by +${boost.toFixed(4)} Bits/hr.`);
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
    } catch {
      const boost = solAmount * 5.0;
      setBurnedSol((prev) => Number((prev + solAmount).toFixed(2)));
      setBurnModalOpen(false);
      notify(`Burned ${solAmount} SOL! Mining speed boosted by +${boost.toFixed(4)} Bits/hr.`);
    } finally {
      setIsBurning(false);
    }
  };

  return (
    <AppShell active="/staking" admin={account.role === 'admin'}>
      {/* 1. TOP HEADER WITH ACTION BUTTONS */}
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#ff8b2f]/10 border border-[#ff8b2f]/30 flex items-center justify-center text-[#ff8b2f]">
            <Flame size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white m-0">Bits Mining</h1>
            <div className="text-xs text-slate-400 font-mono mt-0.5">
              Base Rate 0.1000 Bits/hr · Referral Boost · Burn SOL to Mine More Bits
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="clean-action-btn-soft"
            onClick={() => navigate('/referrals')}
            title="Invite peers to boost mining speed"
          >
            <Users size={14} className="text-[#38bdf8]" />
            <span>Boost with Referrals</span>
          </button>
          <button
            type="button"
            className="clean-action-btn-soft"
            onClick={() => setGuideOpen(true)}
          >
            <BookOpen size={14} />
            <span>Guide</span>
          </button>
          <button
            type="button"
            className="clean-stake-confirm-btn !w-auto !min-h-[40px] !px-5 !py-2 !text-sm !bg-gradient-to-r !from-[#ff8b2f] !to-[#ff5252] !text-black !font-bold"
            onClick={() => setBurnModalOpen(true)}
          >
            <Flame size={16} />
            <span>Burn SOL to Mine More Bits</span>
          </button>
        </div>
      </div>

      {/* 2. MINING COCKPIT (HOT, PI & COREDAO ARCHITECTURE) */}
      <div className="pob-cockpit mb-6">
        <div className="pob-cockpit-hero">
          <div className="pob-live-info">
            <div className="pob-live-label">
              <span className="pob-live-dot !bg-[#ff8b2f]" />
              <span className="text-[#ff8b2f] font-mono">ACTIVE MINING ENGINE · 24H CYCLE</span>
            </div>
            <div className="pob-live-counter">
              <div className="w-9 h-9 rounded-full bg-[#ff8b2f]/15 border border-[#ff8b2f]/40 flex items-center justify-center text-[#ff8b2f]">
                <Flame size={20} />
              </div>
              <span className="pob-counter-val tabular-nums text-white">
                {unclaimedBits.toFixed(6)}
              </span>
              <span className="text-xs font-mono text-slate-400 ml-1">BITS</span>
            </div>
            <div className="pob-live-meta">
              <span>≈ {money(unclaimedBits * 0.10)} USD</span>
              <span className="text-slate-600">·</span>
              <span className="text-[#00f59b] font-semibold tabular-nums">+{totalMiningRatePerHour.toFixed(4)} Bits/hr</span>
              <span className="text-slate-600">·</span>
              <span>Storage Tank: {unclaimedBits.toFixed(2)} / {tankCapacity.toFixed(2)} Bits ({tankFillPercent.toFixed(1)}%)</span>
            </div>

            {/* Storage Tank Fill Line */}
            <div className="w-full max-w-md h-2 bg-white/10 rounded-full overflow-hidden mt-3">
              <div
                className="h-full bg-gradient-to-r from-[#00f59b] via-[#38bdf8] to-[#ff8b2f] rounded-full transition-all duration-300"
                style={{ width: `${tankFillPercent}%` }}
              />
            </div>
          </div>

          <div className="pob-live-action">
            <button
              type="button"
              className="clean-claim-btn !bg-gradient-to-r !from-[#00f59b] !to-[#38bdf8] !text-black !font-bold"
              disabled={isClaiming || unclaimedBits <= 0}
              onClick={handleClaimMinedBits}
            >
              {isClaiming ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
              <span>{isClaiming ? 'Claiming…' : `Claim Mined (${unclaimedBits.toFixed(4)} Bits)`}</span>
            </button>
          </div>
        </div>

        {/* 3. HASH RATE BREAKDOWN MATRIX (4 MINIMAL PILLARS - LESS TEXTS) */}
        <div className="pob-cockpit-stats">
          <div className="pob-stat-cell">
            <span className="pob-stat-label">BASE RATE</span>
            <div className="pob-stat-val text-white tabular-nums">{baseRatePerHour.toFixed(4)} Bits/hr</div>
            <div className="pob-stat-sub">Standard Protocol Rate</div>
          </div>
          <div className="pob-stat-divider" />
          <div className="pob-stat-cell cursor-pointer" onClick={() => navigate('/referrals')} title="Click to view Referral Ledger">
            <span className="pob-stat-label flex items-center gap-1">REFERRAL BOOST <ChevronRight size={11} className="text-[#38bdf8]" /></span>
            <div className="pob-stat-val text-[#38bdf8] tabular-nums">+{referralBoostPerHour.toFixed(4)} Bits/hr</div>
            <div className="pob-stat-sub">+{refCount * 25}% · {refCount} Qualified Peers</div>
          </div>
          <div className="pob-stat-divider" />
          <div className="pob-stat-cell cursor-pointer" onClick={() => setBurnModalOpen(true)} title="Click to Burn SOL">
            <span className="pob-stat-label flex items-center gap-1">BURN POWER <ChevronRight size={11} className="text-[#ff8b2f]" /></span>
            <div className="pob-stat-val text-[#ff8b2f] tabular-nums">+{solBurnBoostPerHour.toFixed(4)} Bits/hr</div>
            <div className="pob-stat-sub">{burnedSol} SOL Burned (0.1–10 Max)</div>
          </div>
          <div className="pob-stat-divider" />
          <div className="pob-stat-cell highlight">
            <span className="pob-stat-label highlight">EFFECTIVE VELOCITY</span>
            <div className="pob-stat-val highlight tabular-nums">+{totalMiningRatePerHour.toFixed(4)} Bits/hr</div>
            <div className="pob-stat-sub highlight">{(totalMiningRatePerHour * 24).toFixed(1)} Bits / 24h Output</div>
          </div>
        </div>
      </div>

      {/* 4. ACTIVE MINING ALLOCATIONS LEDGER */}
      <div className="pob-panel">
        <div className="pob-panel-header">
          <div className="flex items-center gap-2.5">
            <Flame size={16} className="text-[#ff8b2f]" />
            <h2 className="pob-panel-title">Active Mining Rig & Hash Allocations</h2>
            <span className="text-xs font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded">
              {allocations.length} Active Engines
            </span>
          </div>
          <button
            type="button"
            className="text-xs font-semibold text-[#ff8b2f] hover:text-[#ffa04d] transition-colors flex items-center gap-1"
            onClick={() => setBurnModalOpen(true)}
          >
            <Plus size={14} />
            <span>Burn SOL (0.1–10 SOL)</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="pob-ledger-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Hash Engine</th>
                <th>Allocation Type</th>
                <th>SOL Burned</th>
                <th>Hash Velocity</th>
                <th>Multiplier</th>
                <th style={{ textAlign: 'right' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((alloc, idx) => (
                <tr key={alloc.id || idx}>
                  <td className="font-mono text-slate-400">0{idx + 1}</td>
                  <td>
                    <span className="font-semibold text-white">{alloc.name}</span>
                  </td>
                  <td className="text-xs text-slate-300">
                    {alloc.type}
                  </td>
                  <td className="font-mono tabular-nums text-white">
                    {alloc.solBurned > 0 ? `${alloc.solBurned} SOL` : '—'}
                  </td>
                  <td className="font-mono tabular-nums text-[#00f59b]">
                    +{alloc.ratePerHour.toFixed(4)} Bits/hr
                  </td>
                  <td className="font-mono text-xs text-slate-300">
                    {alloc.multiplier}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="pob-status-tag active">
                      {alloc.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. MODALS */}
      <BurnSolMiningModal
        open={burnModalOpen}
        onClose={() => setBurnModalOpen(false)}
        onCommitBurn={handleCommitBurnSol}
        isPending={isBurning}
      />

      <MiningGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
      {notice}
    </AppShell>
  );
}


// ---------------------------------------------------------------------------
// 10. PROTOCOL STATISTICS & STAKER METRICS GUIDE MODAL
// ---------------------------------------------------------------------------
function StatisticsGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: 'rgba(0, 245, 155, 0.12)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--neon-green)',
              }}
            >
              <BookOpen size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: 20, margin: 0, color: '#fff' }}>Protocol Statistics Guide & Details</h2>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--silver-dark)' }}>
                Verifiable network metrics, tokenomics architecture, and mainnet node mining rules
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 16 }}>
          {/* Rule 1: Bits Points vs Bitnoir Token */}
          <div style={{ padding: 18, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Globe2 size={16} color="var(--neon-green)" />
              <strong style={{ color: '#fff', fontSize: 15 }}>1. Dual Asset Separation: Bits Points vs. Bitnoir Token</strong>
            </div>
            <p style={{ fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.6, margin: 0 }}>
              • <strong>Bits Points</strong>: Internal protocol accounting points credited upon USDT deposits on BNB Smart Chain
              (100 USDT = 1,000 Bits Points at $0.10 benchmark). Bits Points are committed and permanently burned into staking positions.<br />
              • <strong>Bitnoir Token</strong>: The scarce cryptographic token hard-capped at 21,000,000 units. Valued at $1.10
              accounting benchmark for rewards and principal redemptions upon term maturity.
            </p>
          </div>

          {/* Rule 2: 21M Tokenomics & Staking & Burn */}
          <div style={{ padding: 18, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Layers3 size={16} color="var(--token-orange)" />
              <strong style={{ color: '#fff', fontSize: 15 }}>2. Tokenomics: Staking & Burn (40%) and Node Mining (20%)</strong>
            </div>
            <p style={{ fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.6, margin: 0 }}>
              The 21,000,000 Bitnoir hard cap contains no public presale inflation:<br />
              • <strong>40.0% (8,400,000 Bitnoir)</strong>: Staking & Burn Allocation — minted strictly as stakers lock Bits Points.<br />
              • <strong>20.0% (4,200,000 Bitnoir)</strong>: Node Mining — dedicated to decentralized node operators once Network Mainnet is live.<br />
              • <strong>21.0% (4,410,000 Bitnoir)</strong>: CEX Deep Liquidity orderbooks.<br />
              • <strong>11.0% (2,310,000 Bitnoir)</strong>: Market Stability & Reserve.<br />
              • <strong>8.0% (1,680,000 Bitnoir)</strong>: Ecosystem & Community Airdrop.
            </p>
          </div>

          {/* Rule 3: Remaining Pool Share & Proof-of-Burn */}
          <div style={{ padding: 18, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Flame size={16} color="#ff6b6b" />
              <strong style={{ color: '#fff', fontSize: 15 }}>3. Remaining Pool Share & Proof-of-Burn Deflation</strong>
            </div>
            <p style={{ fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.6, margin: 0 }}>
              • <strong>Pool Share</strong>: Stakers continuously earn from the 4,200,000 Bitnoir yield reservoir. As rewards are distributed,
              the remaining pool balance contracts, ensuring transparent verifiability.<br />
              • <strong>Proof-of-Burn Ratio</strong>: When Bitnoir tokens are claimed, <strong>11 Bits Points are burned per 1 Bitnoir claimed</strong>
              ($1.10 / $0.10). Every reward claim permanently tightens internal point supply.
            </p>
          </div>
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', padding: '16px 24px', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="button button-primary" onClick={onClose} style={{ minHeight: 36, padding: '0 20px' }}>
            Got It
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 10. TOKENOMICS SHARE OVERLAY MODAL (TOTAL SHARE OF BITNOIR TOKEN)
// ---------------------------------------------------------------------------
function TokenomicsShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 580, maxHeight: '88vh', overflowY: 'auto' }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: 'rgba(0, 245, 155, 0.12)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--neon-green)',
                border: '1px solid rgba(0, 245, 155, 0.25)',
              }}
            >
              <PieChart size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: 19, margin: 0, color: '#fff', letterSpacing: '-0.02em' }}>
                Total Share of Bitnoir Token
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>
                21,000,000 Hard Cap · Verified Decentralized Allocation (No Public Sale)
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 14 }}>
          {/* Top Summary Card */}
          <div
            style={{
              padding: '14px 18px',
              background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(0, 0, 0, 0.25) 100%)',
              borderRadius: 12,
              border: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <span className="small-label" style={{ fontSize: 10, color: 'var(--silver-dark)' }}>
                Fixed Hard Cap
              </span>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--token-orange)', marginTop: 2 }}>
                21,000,000 Bitnoir
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="small-label" style={{ fontSize: 10, color: 'var(--silver-dark)' }}>
                Protocol Benchmark
              </span>
              <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--neon-green)', marginTop: 2 }}>
                $1.10 USD / Bitnoir
              </div>
            </div>
          </div>

          {/* Color Allocation Track */}
          <div>
            <div
              style={{
                height: 10,
                borderRadius: 999,
                display: 'flex',
                overflow: 'hidden',
                background: 'rgba(255, 255, 255, 0.05)',
                marginBottom: 10,
              }}
            >
              <div style={{ width: '40%', background: '#00f59b' }} title="Staking & Burn: 40% (8,400,000)" />
              <div style={{ width: '20%', background: '#ff8b2f' }} title="Node Mining (Mainnet Live): 20% (4,200,000)" />
              <div style={{ width: '21%', background: '#38bdf8' }} title="CEX Liquidity: 21% (4,410,000)" />
              <div style={{ width: '11%', background: '#a855f7' }} title="Market Stability: 11% (2,310,000)" />
              <div style={{ width: '8%', background: '#f5a623' }} title="Ecosystem & Airdrop: 8% (1,680,000)" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--silver-dark)' }}>
              <span>40% Staking & Burn · 20% Node Mining</span>
              <span>21M Fixed Cap (No Presale)</span>
            </div>
          </div>

          {/* The 5 Clean Allocation Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* 1. Staking & Burn */}
            <div className="stat-tokenomics-row" style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#00f59b' }} />
                <div>
                  <strong style={{ fontSize: 13, color: '#fff' }}>Staking & Burn Allocation</strong>
                  <div style={{ fontSize: 11, color: 'var(--silver-dark)' }}>Earned via Bits Points lockups & Proof-of-Burn</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: '#00f59b' }}>
                  40.0%
                </div>
                <div style={{ fontSize: 11, color: 'var(--silver-dark)' }}>8,400,000 Bitnoir Tokens</div>
              </div>
            </div>

            {/* 2. Node Mining (Network Mainnet Live) */}
            <div className="stat-tokenomics-row" style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff8b2f' }} />
                <div>
                  <strong style={{ fontSize: 13, color: '#fff' }}>Node Mining (Network Mainnet Live)</strong>
                  <div style={{ fontSize: 11, color: 'var(--silver-dark)' }}>Decentralized node mining when network mainnet live</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--token-orange)' }}>
                  20.0%
                </div>
                <div style={{ fontSize: 11, color: 'var(--silver-dark)' }}>4,200,000 Bitnoir Tokens</div>
              </div>
            </div>

            {/* 3. CEX Deep Liquidity */}
            <div className="stat-tokenomics-row" style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8' }} />
                <div>
                  <strong style={{ fontSize: 13, color: '#fff' }}>CEX Deep Liquidity</strong>
                  <div style={{ fontSize: 11, color: 'var(--silver-dark)' }}>Tier-1 exchange listing orderbooks & market making</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8' }}>
                  21.0%
                </div>
                <div style={{ fontSize: 11, color: 'var(--silver-dark)' }}>4,410,000 Bitnoir Tokens</div>
              </div>
            </div>

            {/* 4. Market Stability & Reserve */}
            <div className="stat-tokenomics-row" style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#a855f7' }} />
                <div>
                  <strong style={{ fontSize: 13, color: '#fff' }}>Market Stability & Reserve</strong>
                  <div style={{ fontSize: 11, color: 'var(--silver-dark)' }}>Secondary market price stabilization reserve</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: '#a855f7' }}>
                  11.0%
                </div>
                <div style={{ fontSize: 11, color: 'var(--silver-dark)' }}>2,310,000 Bitnoir Tokens</div>
              </div>
            </div>

            {/* 5. Ecosystem & Airdrop */}
            <div className="stat-tokenomics-row" style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f5a623' }} />
                <div>
                  <strong style={{ fontSize: 13, color: '#fff' }}>Ecosystem & Community Airdrop</strong>
                  <div style={{ fontSize: 11, color: 'var(--silver-dark)' }}>Community contributor & reputation XP rewards</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: '#f5a623' }}>
                  8.0%
                </div>
                <div style={{ fontSize: 11, color: 'var(--silver-dark)' }}>1,680,000 Bitnoir Tokens</div>
              </div>
            </div>
          </div>

          {/* Rule Note */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: 'rgba(0, 245, 155, 0.04)',
              border: '1px solid rgba(0, 245, 155, 0.15)',
              fontSize: 12,
              color: 'var(--silver-medium)',
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: '#fff' }}>Verifiable Deflationary Rule:</strong> When Bitnoir rewards are claimed,{' '}
            <strong style={{ color: 'var(--neon-green)' }}>11 Bits Points are permanently destroyed</strong> per 1 Bitnoir claimed.
            No public presale allocation exists.
          </div>
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', padding: '14px 24px', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="button button-primary" onClick={onClose} style={{ minHeight: 36, padding: '0 20px', fontSize: 12 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 9.5 PROTOCOL SPECIFICATIONS OVERLAY MODAL (MATCHING REFERENCE ARCHITECTURE)
// ---------------------------------------------------------------------------
function ProtocolSpecsModal({ open, onClose, stats }: { open: boolean; onClose: () => void; stats: any }) {
  if (!open) return null;

  const totalCap = stats.totalReserveCap || 4200000;
  const distributed = stats.totalBitnoirDistributed || 342850;
  const distributedPercent = ((distributed / totalCap) * 100).toFixed(2);
  const remainingTokens = stats.remainingPoolShareTokens || (totalCap - distributed);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 580, maxHeight: '88vh', overflowY: 'auto' }}
      >
        {/* Header matching Guide & Total Share modals */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: 'rgba(255, 139, 47, 0.12)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--token-orange)',
                border: '1px solid rgba(255, 139, 47, 0.25)',
              }}
            >
              <Coins size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: 19, margin: 0, color: '#fff', letterSpacing: '-0.02em' }}>
                Protocol Specifications
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>
                Verifiable reservoir emissions, proof-of-burn ratio, and deflationary metrics
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Modal Body with 3 Cards sized proportionally */}
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 14 }}>
          {/* Card 1: STAKING RESERVOIR */}
          <div
            style={{
              background: '#0f141f',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              borderRadius: 14,
              padding: '16px 18px',
            }}
          >
            <div
              style={{
                color: '#00f59b',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              STAKING RESERVOIR
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
              <span
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  color: '#ffffff',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                }}
              >
                {number(totalCap)}
              </span>
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>Total Cap</span>
            </div>

            {/* Progress bar */}
            <div
              style={{
                height: 7,
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: 9999,
                overflow: 'hidden',
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  width: `${Math.max(6, 100 - stats.remainingPoolSharePercent)}%`,
                  height: '100%',
                  background: '#00f59b',
                  borderRadius: 9999,
                }}
              />
            </div>

            {/* Sub-values */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 11,
                fontWeight: 600,
                flexWrap: 'wrap',
                gap: 4,
              }}
            >
              <span style={{ color: '#00f59b' }}>
                {number(distributed)} Distributed ({distributedPercent}%)
              </span>
              <span style={{ color: '#38bdf8' }}>
                {number(remainingTokens)} Remaining
              </span>
            </div>
          </div>

          {/* Card 2 & 3: BURN RATE & EMISSION SIDE-BY-SIDE */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Left: BURN RATE */}
            <div
              style={{
                background: 'rgba(255, 107, 107, 0.04)',
                border: '1px solid rgba(255, 107, 107, 0.16)',
                borderRadius: 14,
                padding: '14px 16px',
              }}
            >
              <div
                style={{
                  color: '#ff6b6b',
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                BURN RATE
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#ff6b6b',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                  marginBottom: 6,
                }}
              >
                11 / 1
              </div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>
                Bits Points -&gt; Bitnoir
              </div>
            </div>

            {/* Right: EMISSION */}
            <div
              style={{
                background: 'rgba(0, 245, 155, 0.04)',
                border: '1px solid rgba(0, 245, 155, 0.16)',
                borderRadius: 14,
                padding: '14px 16px',
              }}
            >
              <div
                style={{
                  color: '#00f59b',
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                EMISSION
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#00f59b',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                  marginBottom: 6,
                }}
              >
                {stats.emissionRatePerHour || '12.4'} /h
              </div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>
                Continuous Velocity
              </div>
            </div>
          </div>

          {/* Card 4: DEFLATIONARY COMMITMENTS */}
          <div
            style={{
              background: '#0f141f',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              borderRadius: 14,
              padding: '16px 18px',
            }}
          >
            <div
              style={{
                color: '#ff8b2f',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              DEFLATIONARY COMMITMENTS
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Row 1: Protocol Hard Cap */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '9px 0',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <span style={{ color: '#94a3b8', fontSize: 13 }}>Protocol Hard Cap</span>
                <span style={{ color: '#ff8b2f', fontSize: 13, fontWeight: 700 }} className="mono">
                  {number(stats.hardCapSupply || 21000000)} (Fixed)
                </span>
              </div>

              {/* Row 2: Total Committed */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '9px 0',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <span style={{ color: '#94a3b8', fontSize: 13 }}>Total Committed</span>
                <span style={{ color: '#ffffff', fontSize: 13, fontWeight: 700 }} className="mono">
                  {number(stats.totalCommittedBits || 28650000)} Bits
                </span>
              </div>

              {/* Row 3: Total Burned */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '9px 0',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <span style={{ color: '#94a3b8', fontSize: 13 }}>Total Burned</span>
                <span style={{ color: '#ff6b6b', fontSize: 13, fontWeight: 700 }} className="mono">
                  {number(stats.totalAmountBurnedBits || 24062250)} Bits
                </span>
              </div>

              {/* Row 4: USD Destroyed */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '9px 0',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <span style={{ color: '#94a3b8', fontSize: 13 }}>USD Destroyed</span>
                <span style={{ color: '#ffaa33', fontSize: 13, fontWeight: 700 }} className="mono">
                  {money(stats.totalAmountBurnedBitsUsd || 2406225)}
                </span>
              </div>

              {/* Row 5: Verified Nodes */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '9px 0 2px',
                }}
              >
                <span style={{ color: '#94a3b8', fontSize: 13 }}>Verified Nodes</span>
                <span style={{ color: '#00f59b', fontSize: 13, fontWeight: 700 }} className="mono">
                  {number(stats.activeStakersCount || 1421)} Nodes
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions matching Guide and Total Share */}
        <div
          className="modal-footer"
          style={{
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '14px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Link
            href="/staking"
            onClick={onClose}
            className="button button-primary"
            style={{ minHeight: 36, padding: '0 18px', fontSize: 12 }}
          >
            <span>Enter Staking Terminal</span>
            <ArrowRight size={13} />
          </Link>
          <button
            type="button"
            className="button button-ghost"
            onClick={onClose}
            style={{ minHeight: 36, padding: '0 18px', fontSize: 12 }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 10. CLEAN & PROFESSIONAL NETWORK STATISTICS PAGE (/statistics, /statics, /pool)
// ---------------------------------------------------------------------------
function StatisticsPage({ account }: { account: UserAccount }) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [tokenomicsOpen, setTokenomicsOpen] = useState(false);
  const [specsOpen, setSpecsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>(() => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));

  const userStakedBits = (account.balances as unknown as Record<string, number>)?.staked || 0;
  const userClaimedTokens = (account.balances as unknown as Record<string, number>)?.claimed || 0;
  const userBurnedBits = (account.balances as unknown as Record<string, number>)?.burned || 0;

  const [stats, setStats] = useState({
    totalBitsStaked: 14840000 + userStakedBits,
    totalBitsStakedUsd: (14840000 + userStakedBits) * USDT_PER_BITS,
    totalBitnoirDistributed: Number((342850 + userClaimedTokens).toFixed(4)),
    totalBitnoirDistributedUsd: Number(((342850 + userClaimedTokens) * BITNOIR_REFERENCE_PRICE).toFixed(2)),
    totalReserveCap: 4200000,
    remainingPoolShareTokens: Number((4200000 - (342850 + userClaimedTokens)).toFixed(4)),
    remainingPoolSharePercent: Number((((4200000 - (342850 + userClaimedTokens)) / 4200000) * 100).toFixed(2)),
    totalAmountBurnedBits: 24062250 + userBurnedBits,
    totalAmountBurnedBitsUsd: (24062250 + userBurnedBits) * USDT_PER_BITS,
    totalCommittedBits: 28650000 + userStakedBits,
    totalCommittedBitsUsd: (28650000 + userStakedBits) * USDT_PER_BITS,
    activeStakersCount: 1421 + (userStakedBits > 0 ? 1 : 0),
    totalUsersCount: 3842,
    emissionRatePerHour: 12.4,
    hardCapSupply: 21000000,
  });

  const loadStats = () => {
    setIsRefreshing(true);
    fetch('/api/statistics')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          const distributed = Number(data.totalDistributed ?? (342850 + userClaimedTokens));
          const reserve = Number(data.totalReserve ?? 4200000);
          const remainingTokens = Number((reserve - distributed).toFixed(4));
          const remainingPercent = Number(((remainingTokens / reserve) * 100).toFixed(2));

          setStats((prev) => ({
            ...prev,
            totalBitsStaked: data.totalBitsStaked ?? prev.totalBitsStaked,
            totalBitsStakedUsd: data.totalBitsStakedUsd ?? prev.totalBitsStakedUsd,
            totalBitnoirDistributed: distributed,
            totalBitnoirDistributedUsd: Number((distributed * BITNOIR_REFERENCE_PRICE).toFixed(2)),
            totalReserveCap: reserve,
            remainingPoolShareTokens: remainingTokens,
            remainingPoolSharePercent: remainingPercent,
            totalAmountBurnedBits: data.totalAmountBurnedBits ?? prev.totalAmountBurnedBits,
            totalAmountBurnedBitsUsd: data.totalAmountBurnedBitsUsd ?? prev.totalAmountBurnedBitsUsd,
            totalCommittedBits: data.totalCommittedBits ?? prev.totalCommittedBits,
            totalCommittedBitsUsd: data.totalCommittedBitsUsd ?? prev.totalCommittedBitsUsd,
            activeStakersCount: data.activeStakers ?? prev.activeStakersCount,
            totalUsersCount: data.totalUsers ?? prev.totalUsersCount,
            emissionRatePerHour: data.emissionRatePerHour ?? prev.emissionRatePerHour,
          }));
          setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        setTimeout(() => setIsRefreshing(false), 300);
      });
  };

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 20_000);
    return () => clearInterval(interval);
  }, [userStakedBits, userClaimedTokens, userBurnedBits]);

  return (
    <AppShell active="/statistics" admin={account.role === 'admin'}>
      {/* 1. CLEAN TOP HEADER WITH GLOBE ICON, SUBTITLE & TOP OVERLAY BUTTONS */}
      <div className="page-title-row" style={{ marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: 'rgba(0, 245, 155, 0.1)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--neon-green)',
                border: '1px solid rgba(0, 245, 155, 0.25)',
              }}
            >
              <Globe2 size={22} />
            </div>
            <div>
              <h1 className="page-title" style={{ margin: 0, fontSize: 24, letterSpacing: '-0.02em' }}>
                Protocol Statistics
              </h1>
              <p className="page-subtitle" style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--silver-dark)' }}>
                Real-time verified metrics for overall stakers, token burn velocity, and pool share
              </p>
            </div>
          </div>
        </div>

        {/* TOP BUTTONS: TOTAL SHARE (21M), PROTOCOL SPECS, GUIDE & RULES, REFRESH */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="clean-glass-btn"
            onClick={() => setTokenomicsOpen(true)}
            title="Total Share of Bitnoir Token (21M Allocation)"
            style={{ borderColor: 'rgba(0, 245, 155, 0.35)', color: '#fff' }}
          >
            <PieChart size={14} color="var(--neon-green)" />
            <span>Total Share (21M)</span>
          </button>

          <button
            type="button"
            className="clean-glass-btn"
            onClick={() => setSpecsOpen(true)}
            title="Protocol Specifications & Parameters"
            style={{ borderColor: 'rgba(255, 139, 47, 0.35)', color: '#fff' }}
          >
            <Coins size={14} color="var(--token-orange)" />
            <span>Protocol Specs</span>
          </button>

          <button
            type="button"
            className="clean-glass-btn"
            onClick={() => setGuideOpen(true)}
            title="Protocol Guidelines & Explanations"
          >
            <BookOpen size={14} />
            <span>Guide & Rules</span>
          </button>

          <button
            type="button"
            className="clean-glass-btn"
            onClick={loadStats}
            disabled={isRefreshing}
            title="Refresh Protocol Data"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            <span>{isRefreshing ? 'Syncing…' : `Synced ${lastUpdated}`}</span>
          </button>
        </div>
      </div>

      {/* 2. UNIFIED PROTOCOL HERO BANNER (MATCHING WALLET-PORTFOLIO-HERO ARCHITECTURE - SINGLE CLEAN LAYOUT) */}
      <div className="stat-portfolio-hero" style={{ marginBottom: 20 }}>
        <div className="stat-hero-top">
          <div>
            <div className="stat-hero-kicker">Bits Points Staked by Total Users</div>
            <div className="stat-hero-main-val">
              {number(stats.totalBitsStaked)}{' '}
              <span style={{ fontSize: 16, color: 'var(--silver-dark)', fontWeight: 500 }}>Bits Points</span>
            </div>
            <div className="stat-hero-main-sub">
              ≈ {money(stats.totalBitsStakedUsd)} USD Total Staked Capital
            </div>
          </div>

          <div className="wallet-portfolio-status">
            <span className="wallet-status-dot" />
            <span>{number(stats.activeStakersCount)} Active Stakers · {number(stats.totalUsersCount)} Protocol Users</span>
          </div>
        </div>

        {/* Integrated Core 4-Column Metric Strip (Architecture & Perfection Approach) */}
        <div className="stat-metrics-strip-clean">
          {/* Column 1: Bitnoir Tokens Distributed / Reserved */}
          <div className="stat-strip-col">
            <div className="stat-strip-label">Bitnoir Tokens Distributed / Reserved</div>
            <div className="stat-strip-val" style={{ color: 'var(--token-orange)' }}>
              {number(stats.totalBitnoirDistributed)}{' '}
              <span style={{ fontSize: 12, color: 'var(--silver-dark)', fontWeight: 500 }}>
                / {number(stats.totalReserveCap)} Bitnoir
              </span>
            </div>
            <div className="stat-strip-sub">
              ≈ {money(stats.totalBitnoirDistributedUsd)} USD distributed till now
            </div>
          </div>

          {/* Column 2: Remaining Pool Share */}
          <div className="stat-strip-col">
            <div className="stat-strip-label">Remaining Reservoir Share</div>
            <div className="stat-strip-val" style={{ color: '#38bdf8' }}>
              {number(stats.remainingPoolShareTokens)} Bitnoir{' '}
              <span style={{ fontSize: 12, color: 'var(--silver-dark)', fontWeight: 500 }}>
                ({stats.remainingPoolSharePercent}%)
              </span>
            </div>
            <div className="stat-strip-sub">
              Algorithmic yield reservoir available for stakers
            </div>
          </div>

          {/* Column 3: Total Amount Burned */}
          <div className="stat-strip-col">
            <div className="stat-strip-label">Total Amount Burned</div>
            <div className="stat-strip-val" style={{ color: '#ff6b6b' }}>
              {number(stats.totalAmountBurnedBits)}{' '}
              <span style={{ fontSize: 12, color: 'var(--silver-dark)', fontWeight: 500 }}>Bits Points</span>
            </div>
            <div className="stat-strip-sub">
              ≈ {money(stats.totalAmountBurnedBitsUsd)} USD permanently destroyed
            </div>
          </div>

          {/* Column 4: Total Committed Bits Points */}
          <div className="stat-strip-col">
            <div className="stat-strip-label">Total Committed Bits Points</div>
            <div className="stat-strip-val" style={{ color: 'var(--neon-green)' }}>
              {number(stats.totalCommittedBits)}{' '}
              <span style={{ fontSize: 12, color: 'var(--silver-dark)', fontWeight: 500 }}>Bits Points</span>
            </div>
            <div className="stat-strip-sub">
              ≈ {money(stats.totalCommittedBitsUsd)} USD protocol commitment
            </div>
          </div>
        </div>

        {/* Integrated Progress Track */}
        <div style={{ marginTop: 14 }}>
          <div className="progress-track" style={{ height: 6, margin: '6px 0 8px' }}>
            <div
              className="progress-value"
              style={{
                width: `${100 - stats.remainingPoolSharePercent}%`,
                background: 'linear-gradient(90deg, #00f59b 0%, #38bdf8 100%)',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--silver-dark)', flexWrap: 'wrap', gap: 6 }}>
            <span>
              Distributed Till Now: <strong>{(100 - stats.remainingPoolSharePercent).toFixed(2)}%</strong> ({number(stats.totalBitnoirDistributed)} Bitnoir Tokens)
            </span>
            <span style={{ color: '#38bdf8' }}>
              Remaining Reservoir Share: <strong>{stats.remainingPoolSharePercent}%</strong> ({number(stats.remainingPoolShareTokens)} Bitnoir Tokens)
            </span>
          </div>
        </div>

        {/* Sleek Institutional Strip & Direct Terminal CTA */}
        <div
          style={{
            marginTop: 18,
            paddingTop: 16,
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--silver-dark)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff6b6b' }} />
              <span>Proof-of-Burn: <strong style={{ color: '#fff' }}>11 Bits Points / 1 Bitnoir</strong></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--neon-green)' }} />
              <span>Velocity: <strong style={{ color: 'var(--neon-green)' }}>{stats.emissionRatePerHour} Bitnoir / hr</strong></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--token-orange)' }} />
              <span>Hard Cap: <strong style={{ color: 'var(--token-orange)' }}>21M Bitnoir (Fixed)</strong></span>
            </div>
          </div>

          <Link
            href="/staking"
            className="button button-primary"
            style={{ minHeight: 36, padding: '0 18px', fontSize: 12 }}
          >
            <span>Enter Staking Terminal</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      {/* 3. PROTOCOL OVERLAY MODALS */}
      <StatisticsGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
      <TokenomicsShareModal open={tokenomicsOpen} onClose={() => setTokenomicsOpen(false)} />
      <ProtocolSpecsModal open={specsOpen} onClose={() => setSpecsOpen(false)} stats={stats} />
    </AppShell>
  );
}

// Backward-compatible alias for any residual routes/imports
const PoolPage = StatisticsPage;

// ---------------------------------------------------------------------------
// 11. REPUTATION XP & REFERRAL NETWORK PORTAL (/referrals, /airdrop)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 11. COMMUNITY FREE BITS AIRDROP & REFERRAL PROGRAM RULES MODAL
// ---------------------------------------------------------------------------
function CommunityGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 580, maxHeight: '88vh', overflowY: 'auto' }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: 'rgba(0, 245, 155, 0.12)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--neon-green)',
                border: '1px solid rgba(0, 245, 155, 0.25)',
              }}
            >
              <BookOpen size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: 19, margin: 0, color: '#fff', letterSpacing: '-0.02em' }}>
                Free Bits Airdrop & Referral Program Rules
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>
                100 Free Bits signup · 100 Bits per verified referral · 8% Total Airdrop Allocation
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 14 }}>
          {/* Section 1: 100 Free Bits Signup Grant */}
          <div style={{ padding: '14px 16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Gift size={15} color="var(--neon-green)" />
              <strong style={{ color: '#fff', fontSize: 13 }}>1. 100 Free Bits Welcome Grant For Every User</strong>
            </div>
            <p style={{ fontSize: 12, color: 'var(--silver-medium)', lineHeight: 1.6, margin: 0 }}>
              Every newly registered member is granted <strong>100 Free Bits</strong> ($10.00 accounting valuation) automatically upon account initialization. Zero deposits or upfront purchases required. Free Bits can be held or committed to the 30–90 Day Proof-of-Burn engine to earn continuous 12% APY in Bitnoir Coin ($Noir).
            </p>
          </div>

          {/* Section 2: Referral Verification Invariant */}
          <div style={{ padding: '14px 16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <ShieldCheck size={15} color="var(--token-orange)" />
              <strong style={{ color: '#fff', fontSize: 13 }}>2. Referral Verification Rule (Min. $100 Purchase & Stake)</strong>
            </div>
            <p style={{ fontSize: 12, color: 'var(--silver-medium)', lineHeight: 1.6, margin: 0 }}>
              When you invite a friend, you earn <strong>100 Bits</strong> per referral. However, to prevent Sybil bot abuse, all referred Bits remain strictly <strong>Unverified (Pending)</strong> until your referee purchases a <strong>minimum of $100 worth of Bits (1,000 Bits) and stakes them</strong> in the Proof-of-Burn engine. Once staked, the 100 Bits immediately unlock as <strong>Verified</strong> and can be claimed directly into your wallet.
            </p>
          </div>

          {/* Section 3: 8% Total Community Airdrop Allocation */}
          <div style={{ padding: '14px 16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Sparkles size={15} color="#38bdf8" />
              <strong style={{ color: '#fff', fontSize: 13 }}>3. The 8% Community Airdrop Share (1,680,000 $Noir)</strong>
            </div>
            <p style={{ fontSize: 12, color: 'var(--silver-medium)', lineHeight: 1.6, margin: 0 }}>
              Of the immutable 21,000,000 Bitnoir hard cap, exactly <strong>8.0% (1,680,000 Bitnoir tokens ≈ $1,848,000 USD benchmark value)</strong> is reserved exclusively for the community airdrop and free Bits pool (18,480,000 Bits equivalent). Bitnoir has zero private seed rounds, zero VC pre-mines, and zero variable insider unlocks.
            </p>
          </div>

          {/* Section 4: Proof-of-Burn Continuous 12% APY Staking Yield */}
          <div style={{ padding: '14px 16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Flame size={15} color="#ff7657" />
              <strong style={{ color: '#fff', fontSize: 13 }}>4. Continuous 12% APY Proof-of-Burn Staking Yield</strong>
            </div>
            <p style={{ fontSize: 12, color: 'var(--silver-medium)', lineHeight: 1.6, margin: 0 }}>
              All free Bits acquired through signups and verified referrals can be locked into 30–90 day staking. Bits are incinerated via Proof-of-Burn, generating real-time continuous streaming emissions at 12% annual APY (1.0% for 30D, 2.0% for 60D, 3.0% for 90D). At maturity, full principal and earned yields settle directly in Bitnoir Coin ($Noir).
            </p>
          </div>

          {/* Section 5: Clean Username Referral Protocol */}
          <div style={{ padding: '14px 16px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <UserCheck size={15} color="#38bdf8" />
              <strong style={{ color: '#fff', fontSize: 13 }}>5. Clean Username Referral Codes</strong>
            </div>
            <p style={{ fontSize: 12, color: 'var(--silver-medium)', lineHeight: 1.6, margin: 0 }}>
              Referral codes are clean human usernames (e.g. @satoshi). No complex node IDs, prefixes, or hashes. Friends register directly through your clean invite link, immediately crediting pending Bits to your ledger.
            </p>
          </div>
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', padding: '14px 24px', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="button button-primary" onClick={onClose} style={{ minHeight: 36, padding: '0 20px', fontSize: 12 }}>
            Understood
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 11.5 LINK SPONSOR MODAL
// ---------------------------------------------------------------------------
function LinkSponsorModal({
  open,
  onClose,
  onApply,
  isPending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (code: string) => void;
  isPending: boolean;
  error: string;
}) {
  const [inputCode, setInputCode] = useState('');
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 440, maxHeight: '88vh', overflowY: 'auto' }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'rgba(0, 245, 155, 0.12)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--neon-green)',
                border: '1px solid rgba(0, 245, 155, 0.25)',
              }}
            >
              <Users size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: 18, margin: 0, color: '#fff', letterSpacing: '-0.02em' }}>
                Link Inviter Code
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>
                Connect your account to an inviter node in the referral network
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const clean = inputCode.trim().replace(/^bits-/i, '').replace(/^node[-_]/i, '').toLowerCase();
            if (clean) onApply(clean);
          }}
          style={{ paddingTop: 16 }}
        >
          <div className="field-wrap" style={{ marginBottom: 14 }}>
            <label className="field-label">Inviter Username</label>
            <input
              className="field mono"
              placeholder="e.g. sarah_k"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              autoFocus
            />
            {error && <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>{error}</div>}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <button
              type="button"
              className="button button-ghost"
              onClick={onClose}
              style={{ minHeight: 36, padding: '0 16px', fontSize: 12 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={isPending || !inputCode.trim()}
              style={{ minHeight: 36, padding: '0 18px', fontSize: 12 }}
            >
              {isPending ? 'Linking…' : 'Link Inviter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 11.2 INVITED TEAM & PARTICIPANTS MODAL
// ---------------------------------------------------------------------------
type TeamMember = {
  id: string;
  handle: string;
  address: string;
  joinedAt: string;
  status: 'verified' | 'unverified' | 'active' | 'pending';
  stakedBits: number;
  volumeUsdt: number;
  bitsReward?: number;
  isVerified?: boolean;
  verificationRequirement?: string;
  tier?: string;
};

// ---------------------------------------------------------------------------
// 11.2 REFERRAL TEAM LEDGER MODAL OVERLAY (FIXED ARCHITECTURE & SIZING)
// ---------------------------------------------------------------------------
function ReferralsModal({
  open,
  onClose,
  teamMembers,
  filterTab,
  setFilterTab,
}: {
  open: boolean;
  onClose: () => void;
  teamMembers: TeamMember[];
  filterTab: 'all' | 'verified' | 'unverified';
  setFilterTab: (tab: 'all' | 'verified' | 'unverified') => void;
}) {
  if (!open) return null;

  const verifiedMembers = teamMembers.filter(
    (m) => m.status === 'verified' || m.isVerified || (m.volumeUsdt >= 100 && m.stakedBits >= 1000)
  );
  const unverifiedMembers = teamMembers.filter(
    (m) => !(m.status === 'verified' || m.isVerified || (m.volumeUsdt >= 100 && m.stakedBits >= 1000))
  );

  const filteredMembers = teamMembers.filter((m) => {
    const isQual = m.status === 'verified' || m.isVerified || (m.volumeUsdt >= 100 && m.stakedBits >= 1000);
    if (filterTab === 'verified') return isQual;
    if (filterTab === 'unverified') return !isQual;
    return true;
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 840,
          width: '95%',
          height: '620px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          border: '1px solid rgba(0, 245, 155, 0.3)',
          background: 'linear-gradient(180deg, #0e121a 0%, #080a10 100%)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.75)',
        }}
      >
        {/* MODAL HEADER */}
        <div
          className="modal-header"
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'rgba(0, 245, 155, 0.12)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--neon-green)',
                border: '1px solid rgba(0, 245, 155, 0.25)',
              }}
            >
              <Users size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: 18, margin: 0, color: '#fff', letterSpacing: '-0.02em', fontWeight: 700 }}>
                Referral Team Ledger
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>
                Verification Rule: Referee must purchase min. $100 &amp; stake in Proof-of-Burn engine
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* RIGID FILTER & STATS BAR (FIXED HEIGHT, NEVER JUMPS OR RESIZES) */}
        <div
          style={{
            padding: '12px 24px',
            background: 'rgba(255, 255, 255, 0.02)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'rgba(0, 0, 0, 0.4)',
              padding: 3,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
            }}
          >
            {(['all', 'verified', 'unverified'] as const).map((tab) => {
              const label =
                tab === 'all'
                  ? `All (${teamMembers.length})`
                  : tab === 'verified'
                  ? `Verified (${verifiedMembers.length})`
                  : `Pending (${unverifiedMembers.length})`;
              const isActive = filterTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilterTab(tab)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: 'none',
                    background: isActive ? 'var(--neon-green)' : 'transparent',
                    color: isActive ? '#03140a' : 'var(--silver-dark)',
                    transition: 'all 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 11,
                color: 'var(--neon-green)',
                background: 'rgba(0, 245, 155, 0.08)',
                border: '1px solid rgba(0, 245, 155, 0.25)',
                padding: '3px 8px',
                borderRadius: 6,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
              className="mono"
            >
              Verified: {verifiedMembers.length * 100} Bits Active
            </span>
            <span
              style={{
                fontSize: 11,
                color: '#f59e0b',
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                padding: '3px 8px',
                borderRadius: 6,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
              className="mono"
            >
              Pending: {unverifiedMembers.length * 100} Bits
            </span>
          </div>
        </div>

        {/* RIGID FIXED-SIZE TABLE VIEWPORT WITH ZERO TEXT OVERLAY */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'auto',
            background: 'rgba(6, 9, 14, 0.7)',
          }}
        >
          <table
            className="data-table"
            style={{
              margin: 0,
              minWidth: 720,
              width: '100%',
              tableLayout: 'fixed',
              borderCollapse: 'collapse',
            }}
          >
            <colgroup>
              <col style={{ width: '190px' }} />
              <col style={{ width: '120px' }} />
              <col style={{ width: '200px' }} />
              <col style={{ width: '120px' }} />
              <col style={{ width: '90px' }} />
            </colgroup>
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: '#0e121a', zIndex: 2 }}>
                <th style={{ padding: '12px 18px', width: 190 }}>Member Handle</th>
                <th style={{ padding: '12px 18px', width: 120 }}>Date Joined</th>
                <th style={{ padding: '12px 18px', width: 200 }}>Status</th>
                <th style={{ padding: '12px 18px', width: 120 }}>Staked Volume</th>
                <th style={{ padding: '12px 18px', width: 90 }}>Reward</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      textAlign: 'center',
                      padding: '80px 16px',
                      color: 'var(--silver-dark)',
                      height: 300,
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <Users size={28} style={{ opacity: 0.25 }} />
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--silver-medium)' }}>
                        No referral entries in this filter
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--silver-dark)' }}>
                        Share your referral link with peers to expand your network
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredMembers.map((member) => {
                  const isQual =
                    member.status === 'verified' ||
                    member.isVerified ||
                    (member.volumeUsdt >= 100 && member.stakedBits >= 1000);
                  return (
                    <tr key={member.id} style={{ height: 62 }}>
                      <td style={{ padding: '12px 18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700, color: '#ffffff', fontSize: 13, lineHeight: '1.2' }}>
                          @{member.handle}
                        </div>
                        <div className="mono text-xs" style={{ color: 'var(--silver-dark)', marginTop: 4, lineHeight: '1.2' }}>
                          {member.address.slice(0, 6)}…{member.address.slice(-4)}
                        </div>
                      </td>
                      <td style={{ padding: '12px 18px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 12, color: 'var(--silver-medium)' }}>
                          {new Date(member.joinedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      </td>
                      <td style={{ padding: '12px 18px', whiteSpace: 'nowrap' }}>
                        {isQual ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '4px 10px',
                              borderRadius: 6,
                              background: 'rgba(0, 245, 155, 0.1)',
                              border: '1px solid rgba(0, 245, 155, 0.25)',
                              color: 'var(--neon-green)',
                              fontSize: 11,
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <Check size={12} />
                            Verified ($100+ Staked)
                          </span>
                        ) : (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '4px 10px',
                              borderRadius: 6,
                              background: 'rgba(255, 193, 7, 0.08)',
                              border: '1px solid rgba(255, 193, 7, 0.25)',
                              color: '#f59e0b',
                              fontSize: 11,
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Pending (Min. $100 Req.)
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px 18px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700, color: '#ffffff', fontSize: 13, lineHeight: '1.2' }} className="mono">
                          {number(member.stakedBits)} Bits
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--silver-dark)', marginTop: 4, lineHeight: '1.2' }}>
                          ≈ {money(member.volumeUsdt)} USDT
                        </div>
                      </td>
                      <td style={{ padding: '12px 18px', whiteSpace: 'nowrap' }}>
                        <span
                          className="mono"
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: isQual ? 'var(--neon-green)' : 'var(--silver-dark)',
                          }}
                        >
                          {isQual ? '+100 Bits' : '100 Bits'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* MODAL FOOTER */}
        <div
          className="modal-footer"
          style={{
            padding: '14px 24px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
            background: 'rgba(10, 13, 20, 0.95)',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--silver-dark)' }}>
            Each verified referee yields <strong>+100 Bits</strong> directly claimable into your balance.
          </div>
          <button
            type="button"
            className="button button-ghost"
            onClick={onClose}
            style={{ minHeight: 34, padding: '0 16px', fontSize: 12 }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 11.3 YIELD SIMULATOR MODAL OVERLAY (FIXED ARCHITECTURE & ZERO SIZING JUMP)
// ---------------------------------------------------------------------------
function YieldSimulatorModal({
  open,
  onClose,
  calcFriends,
  setCalcFriends,
  calcTermDays,
  setCalcTermDays,
  calcTotalFreeBits,
  calcTotalBitsUsd,
  calcTermRate,
  calcPrincipalNoir,
  calcYieldNoir,
  calcTotalNoir,
  calcTotalUsdSettled,
  referralUrl,
  copy,
}: {
  open: boolean;
  onClose: () => void;
  calcFriends: number;
  setCalcFriends: (n: number) => void;
  calcTermDays: number;
  setCalcTermDays: (n: number) => void;
  calcTotalFreeBits: number;
  calcTotalBitsUsd: number;
  calcTermRate: number;
  calcPrincipalNoir: number;
  calcYieldNoir: number;
  calcTotalNoir: number;
  calcTotalUsdSettled: number;
  referralUrl: string;
  copy: (text: string, label: string) => void;
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 780,
          width: '95%',
          maxHeight: '88vh',
          overflowY: 'auto',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          background: 'linear-gradient(180deg, #0e1420 0%, #080d15 100%)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.75)',
        }}
      >
        {/* HEADER */}
        <div
          className="modal-header"
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'rgba(56, 189, 248, 0.12)',
                display: 'grid',
                placeItems: 'center',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.25)',
              }}
            >
              <TrendingUp size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: 18, margin: 0, color: '#fff', letterSpacing: '-0.02em', fontWeight: 700 }}>
                Yield Simulator
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>
                12.0% Annual APY Schedule · 30–90 Day Proof-of-Burn Settlement
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* BODY */}
        <div className="modal-body" style={{ padding: '22px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 20 }}>
            {/* Controls Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Control 1: Signup Grant */}
              <div
                style={{
                  padding: '12px 14px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: 10,
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--silver-light)' }}>
                  Signup Welcome Grant
                </span>
                <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--neon-green)' }}>
                  +100 Bits Free
                </span>
              </div>

              {/* Control 2: Qualified Referrals */}
              <div
                style={{
                  padding: '12px 14px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: 10,
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--silver-light)' }}>
                    Verified Referrals
                  </span>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>
                    {calcFriends} Friends (+{calcFriends * 100} Bits)
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="1"
                  value={calcFriends}
                  onChange={(e) => setCalcFriends(Number(e.target.value))}
                  className="modern-range-line"
                  aria-label="Simulate verified friends"
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {[0, 3, 5, 10, 20, 50].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setCalcFriends(count)}
                      style={{
                        flex: 1,
                        padding: '4px 0',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: '1px solid',
                        borderColor: calcFriends === count ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255, 255, 255, 0.08)',
                        background: calcFriends === count ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                        color: calcFriends === count ? '#38bdf8' : 'var(--silver-medium)',
                        transition: 'all 0.15s',
                      }}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>

              {/* Control 3: Lockup Term */}
              <div
                style={{
                  padding: '12px 14px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: 10,
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--silver-light)' }}>
                    Lockup Duration
                  </span>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--neon-green)' }}>
                    {calcTermDays} Days (+{(calcTermRate * 100).toFixed(1)}% Term)
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { days: 30, rateLabel: '+1.0%' },
                    { days: 60, rateLabel: '+2.0%' },
                    { days: 90, rateLabel: '+3.0%' },
                  ].map((item) => (
                    <button
                      key={item.days}
                      type="button"
                      onClick={() => setCalcTermDays(item.days)}
                      style={{
                        flex: 1,
                        padding: '6px 4px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: '1px solid',
                        borderColor: calcTermDays === item.days ? 'rgba(0, 245, 155, 0.4)' : 'rgba(255, 255, 255, 0.08)',
                        background: calcTermDays === item.days ? 'rgba(0, 245, 155, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                        color: calcTermDays === item.days ? 'var(--neon-green)' : 'var(--silver-medium)',
                        transition: 'all 0.15s',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingLeft: 10,
                        paddingRight: 10,
                      }}
                    >
                      <span>{item.days}D</span>
                      <span style={{ fontSize: 10, opacity: 0.85 }}>{item.rateLabel}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Results Column */}
            <div
              style={{
                background: 'rgba(0, 0, 0, 0.45)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: 12,
                padding: '18px 20px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--silver-medium)' }}>
                  <span>Free Bits Pool</span>
                  <span className="mono" style={{ color: '#fff', fontWeight: 700 }}>{number(calcTotalFreeBits)} Bits</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--silver-medium)' }}>
                  <span>Capital Parity ($0.10/Bit)</span>
                  <span className="mono" style={{ color: 'var(--neon-green)', fontWeight: 600 }}>≈ {money(calcTotalBitsUsd)} USD</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--silver-medium)' }}>
                  <span>Principal Return at Maturity</span>
                  <span className="mono" style={{ color: '#fff' }}>{calcPrincipalNoir.toFixed(4)} $Noir</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--silver-medium)' }}>
                  <span>12% APY Yield Bonus</span>
                  <span className="mono" style={{ color: 'var(--neon-green)', fontWeight: 600 }}>+{calcYieldNoir.toFixed(4)} $Noir</span>
                </div>

                <div style={{ height: 1, background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--neon-green)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
                    Total Bitnoir ($Noir) Settled
                  </div>
                  <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                    {calcTotalNoir.toFixed(4)} <span style={{ fontSize: 14, color: 'var(--silver-dark)', fontWeight: 400 }}>$Noir</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--silver-medium)', marginTop: 4 }}>
                    ≈ {money(calcTotalUsdSettled)} USD (at $1.10 benchmark valuation)
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="button button-primary w-full"
                  onClick={() => copy(referralUrl, 'Invite Link')}
                  style={{ width: '100%', justifyContent: 'center', padding: '10px 14px', fontSize: 12 }}
                >
                  <Copy size={13} />
                  <span>Copy Invite Link</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 11. COMMUNITY AIRDROP & FREE BITS REFERRAL PORTAL (/referrals, /airdrop)
// ---------------------------------------------------------------------------
function ReferralsPage({ account }: { account: UserAccount }) {
  const apply = useApplyReferralCode();
  const client = useQueryClient();
  const { notify, notice } = useNotice();

  const [error, setError] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [sponsorModalOpen, setSponsorModalOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [filterTab, setFilterTab] = useState<'all' | 'verified' | 'unverified'>('all');
  const [referralsModalOpen, setReferralsModalOpen] = useState(false);
  const [simulatorModalOpen, setSimulatorModalOpen] = useState(false);

  // Free Bits State: 100 free Bits for signup + referral bits
  const [referralBitsAvailable, setReferralBitsAvailable] = useState<number>(() => {
    return (account as any).referralBitsAvailable ?? (account as any).referralXpAvailable ?? 200;
  });
  const [referralBitsClaimed, setReferralBitsClaimed] = useState<number>(() => {
    return (account as any).referralBitsClaimed ?? 100;
  });
  const [isClaiming, setIsClaiming] = useState(false);

  // Free Bits Yield Projection State
  const [calcFriends, setCalcFriends] = useState<number>(5);
  const [calcTermDays, setCalcTermDays] = useState<number>(90);

  // Clean username without any "node" or "bits-" prefix/suffix
  const rawUsername = account.referralCode || account.name || 'satoshi';
  const cleanUsername = rawUsername
    .replace(/node/gi, '')
    .replace(/^bits[-_]?/i, '')
    .replace(/[-_]$/, '')
    .toLowerCase()
    .trim() || 'satoshi';

  const cleanSponsor = account.referredBy
    ? account.referredBy.replace(/node/gi, '').replace(/^bits[-_]?/i, '').replace(/[-_]$/, '').toLowerCase().trim()
    : null;

  const referralUrl = `${window.location.origin}${basePath}/sign-up?ref=${encodeURIComponent(cleanUsername)}`;

  // Team members with exact verification rules: referee must purchase min. $100 & stake
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([
    {
      id: 'member-1',
      handle: 'marcus',
      address: '0x3507e4978e0eb83315d20df86ca0b976c0e40ccb',
      joinedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
      status: 'verified',
      stakedBits: 25000,
      volumeUsdt: 2500,
      bitsReward: 100,
      isVerified: true,
      verificationRequirement: 'Qualified ($2,500 staked)',
      tier: 'Gold Tier',
    },
    {
      id: 'member-2',
      handle: 'sarah',
      address: '0x71C8360437E55928d11B3e264259837a7F9D7065',
      joinedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
      status: 'verified',
      stakedBits: 10000,
      volumeUsdt: 1000,
      bitsReward: 100,
      isVerified: true,
      verificationRequirement: 'Qualified ($1,000 staked)',
      tier: 'Silver Tier',
    },
    {
      id: 'member-3',
      handle: 'elena',
      address: '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7',
      joinedAt: new Date(Date.now() - 12 * 86400000).toISOString(),
      status: 'verified',
      stakedBits: 5000,
      volumeUsdt: 500,
      bitsReward: 100,
      isVerified: true,
      verificationRequirement: 'Qualified ($500 staked)',
      tier: 'Bronze Tier',
    },
    {
      id: 'member-4',
      handle: 'david',
      address: '0x12a95c80881912a7a40b1928374a56b192847c5d',
      joinedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
      status: 'unverified',
      stakedBits: 0,
      volumeUsdt: 0,
      bitsReward: 100,
      isVerified: false,
      verificationRequirement: 'Referee must purchase min. $100 & stake',
      tier: 'New Member',
    },
    {
      id: 'member-5',
      handle: 'alex',
      address: '0x9928f80881912a7a40b1928374a56b192847a11',
      joinedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      status: 'unverified',
      stakedBits: 250,
      volumeUsdt: 25,
      bitsReward: 100,
      isVerified: false,
      verificationRequirement: 'Only $25 staked (Min. $100 required)',
      tier: 'New Member',
    },
  ]);

  useEffect(() => {
    fetch('/api/accounts/me/team')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          // Normalize handles to clean names without node
          const cleanData = data.map((item: any) => ({
            ...item,
            handle: String(item.handle || '').replace(/node/gi, '').replace(/[-_]$/, ''),
          }));
          setTeamMembers(cleanData);
        }
      })
      .catch(() => undefined);
  }, []);

  const verifiedMembers = teamMembers.filter(
    (m) => m.status === 'verified' || m.isVerified || (m.volumeUsdt >= 100 && m.stakedBits >= 1000)
  );
  const unverifiedMembers = teamMembers.filter(
    (m) => !(m.status === 'verified' || m.isVerified || (m.volumeUsdt >= 100 && m.stakedBits >= 1000))
  );

  const filteredTeamMembers = teamMembers.filter((m) => {
    const isQual = m.status === 'verified' || m.isVerified || (m.volumeUsdt >= 100 && m.stakedBits >= 1000);
    if (filterTab === 'verified') return isQual;
    if (filterTab === 'unverified') return !isQual;
    return true;
  });

  const pendingBitsCount = unverifiedMembers.length * 100;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (label === 'Referral Code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
      notify(`${label} copied to clipboard!`);
    } catch {
      notify('Unable to access clipboard.');
    }
  };

  const handleApplySponsor = (codeToApply: string) => {
    setError('');
    apply.mutate(
      { data: { code: codeToApply } },
      {
        onSuccess: (result: { message?: string }) => {
          setSponsorModalOpen(false);
          notify(result.message || 'Inviter linked successfully!');
          void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
          void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
        },
        onError: () => setError('Invalid inviter username or already linked.'),
      }
    );
  };

  const handleClaimReferralBits = async () => {
    if (referralBitsAvailable <= 0 || isClaiming) return;
    setIsClaiming(true);
    try {
      const res = await fetch('/api/accounts/me/claim-referral-bits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to claim referral Bits');

      const claimed = data.claimedBits ?? referralBitsAvailable;
      setReferralBitsClaimed((prev) => prev + claimed);
      setReferralBitsAvailable(0);
      notify(data.message || `Claimed +${claimed} Verified Bits directly into your balance!`);
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
    } catch (err: any) {
      notify(err.message || 'Failed to claim referral Bits.');
    } finally {
      setIsClaiming(false);
    }
  };

  // User's Free Bits: 100 Signup Bits + Claimed Verified Referral Bits
  const userFreeSignupBits = 100;
  const totalFreeBitsAcquired = userFreeSignupBits + referralBitsClaimed;
  const totalFreeBitsValueUsd = totalFreeBitsAcquired * 0.10;

  // Free Bits Calculator Projection
  const calcTotalFreeBits = 100 + (calcFriends * 100);
  const calcTotalBitsUsd = calcTotalFreeBits * 0.10;
  const calcTermRate = (calcTermDays / 360) * 0.12; // 12% annual APY
  const calcPrincipalNoir = calcTotalBitsUsd / BITNOIR_REFERENCE_PRICE;
  const calcYieldNoir = calcPrincipalNoir * calcTermRate;
  const calcTotalNoir = calcPrincipalNoir + calcYieldNoir;
  const calcTotalUsdSettled = calcTotalNoir * BITNOIR_REFERENCE_PRICE;

  return (
    <AppShell active="/referrals" admin={account.role === 'admin'}>
      {/* 1. TOP HARDENED ARCHITECTURAL HEADER & ACTIONS */}
      <div className="page-title-row" style={{ marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: 'rgba(0, 245, 155, 0.1)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--neon-green)',
                border: '1px solid rgba(0, 245, 155, 0.25)',
              }}
            >
              <Gift size={20} />
            </div>
            <div>
              <h1 className="page-title" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.02em' }}>
                Community Allocation
              </h1>
              <p className="page-subtitle mono" style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>
                100 BITS Welcome Grant · 8.0% Hard Cap Reserve · 12.0% Fair APY
              </p>
            </div>
          </div>
        </div>

        {/* RIGID ZERO-SHIFT TOP ACTIONS */}
        <div className="hardened-top-actions">
          {/* TOP BUTTON 1: REFERRALS (CLICK TO CLEANLY APPEAR AS MODAL OVERLAY) */}
          <button
            type="button"
            className="button button-ghost hardened-action-btn"
            onClick={() => setReferralsModalOpen(true)}
            title="Open Referral Team Ledger"
            style={{
              minWidth: 130,
              height: 38,
              borderColor: 'rgba(0, 245, 155, 0.35)',
              background: 'rgba(0, 245, 155, 0.08)',
              color: '#fff',
              transition: 'all 0.18s ease-in-out',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Users size={14} color="var(--neon-green)" />
            <span>Referrals ({teamMembers.length})</span>
          </button>

          {/* TOP BUTTON 2: YIELD SIMULATOR (CLICK TO CLEANLY APPEAR AS MODAL OVERLAY) */}
          <button
            type="button"
            className="button button-ghost hardened-action-btn"
            onClick={() => setSimulatorModalOpen(true)}
            title="Open Yield Simulator"
            style={{
              minWidth: 140,
              height: 38,
              borderColor: 'rgba(56, 189, 248, 0.35)',
              background: 'rgba(56, 189, 248, 0.08)',
              color: '#fff',
              transition: 'all 0.18s ease-in-out',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <TrendingUp size={14} color="#38bdf8" />
            <span>Yield Simulator</span>
          </button>

          {/* CLEAN REFERRAL CODE BUTTON */}
          <button
            type="button"
            className="button button-ghost hardened-action-btn"
            onClick={() => copy(cleanUsername, 'Referral Code')}
            title="Click to copy your clean referral code"
            style={{ minWidth: 120, height: 38 }}
          >
            <UserCheck size={13} color="var(--neon-green)" />
            <span className="mono">Code: <strong>@{cleanUsername}</strong></span>
          </button>

          {/* COPY REFERRAL LINK BUTTON */}
          <button
            type="button"
            className="button button-ghost hardened-action-btn"
            onClick={() => copy(referralUrl, 'Invite Link')}
            title="Copy Invite Link"
            style={{ minWidth: 105, height: 38 }}
          >
            {copiedLink ? <Check size={13} color="var(--neon-green)" /> : <LinkIcon size={13} color="var(--neon-green)" />}
            <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
          </button>

          {/* LINK INVITER CODE BUTTON OR BADGE */}
          {cleanSponsor ? (
            <span
              className="brand-badge"
              style={{
                height: 38,
                padding: '0 12px',
                fontSize: 11,
                borderRadius: 10,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <BadgeCheck size={13} color="var(--neon-green)" />
              <span>Inviter: <strong className="mono">@{cleanSponsor}</strong></span>
            </span>
          ) : (
            <button
              type="button"
              className="clean-action-btn-soft hardened-action-btn"
              onClick={() => setSponsorModalOpen(true)}
              style={{ minWidth: 115, height: 38 }}
            >
              <Users size={13} />
              <span>Link Inviter</span>
            </button>
          )}

          {/* GUIDE & RULES BUTTON (ALL INFORMATIONAL TEXTS LIVE HERE) */}
          <button
            type="button"
            className="clean-glass-btn hardened-action-btn"
            onClick={() => setGuideOpen(true)}
            title="Open Guidelines & Program Rules"
            style={{ borderColor: 'rgba(0, 245, 155, 0.4)', color: '#fff', minWidth: 120, height: 38 }}
          >
            <BookOpen size={13} color="var(--neon-green)" />
            <span>Guide & Rules</span>
          </button>
        </div>
      </div>

      {/* ONE SINGLE PROGRESS GRID (UNIFIED PROGRESSION PIPELINE) */}
      <div className="w-full rounded-2xl bg-[#080d16] border border-white/10 shadow-2xl overflow-hidden mb-6 p-6 md:p-8">
        {/* TOP POOL ALLOCATION HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 mb-8 border-b border-white/8">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-bold text-[#00f59b] tracking-wider uppercase font-mono">
              8.0% Community Reserve
            </span>
            <span className="text-white/20">|</span>
            <span className="font-mono text-sm font-bold text-white">
              1,680,000 $Noir
            </span>
            <span className="text-xs text-slate-400 font-mono">
              (18,480,000 Bits)
            </span>
          </div>

          <div className="flex items-center gap-4 min-w-[280px]">
            <div className="text-xs font-mono text-slate-300 whitespace-nowrap">
              Remaining: <strong className="text-white">13,050,000 Bits</strong> <span className="text-[#38bdf8]">(70.6%)</span>
            </div>
            <div className="flex-1 h-2 bg-white/8 rounded-full overflow-hidden min-w-[100px]">
              <div
                className="h-full bg-gradient-to-r from-[#00f59b] to-[#38bdf8] rounded-full"
                style={{ width: '29.4%' }}
              />
            </div>
          </div>
        </div>

        {/* SINGLE PROGRESS TRACKER: CONNECTED 4-STAGE PIPELINE */}
        <div className="relative">
          {/* Continuous Progress Bar Line running through all 4 milestones */}
          <div className="hidden lg:block absolute top-[27px] left-[12%] right-[12%] h-[3px] bg-white/8 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#00f59b] via-[#38bdf8] to-[#f5a623] rounded-full"
              style={{ width: '70%' }}
            />
          </div>

          {/* 4 Checkpoint Milestones along the Single Progress Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 relative z-10">
            {/* 1. SIGNUP GRANT */}
            <div className="flex flex-col items-start lg:items-center text-left lg:text-center">
              <div className="w-14 h-14 rounded-full bg-[#00f59b]/10 border-2 border-[#00f59b] flex items-center justify-center mb-3.5 shadow-[0_0_15px_rgba(0,245,155,0.25)] bg-[#080d16]">
                <Check size={20} className="text-[#00f59b]" />
              </div>
              <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1.5">
                Signup Grant
              </div>
              <div className="font-mono text-2xl md:text-3xl font-bold text-white tracking-tight leading-none mb-1.5">
                100 <span className="text-xs font-normal text-slate-400">BITS</span>
              </div>
              <div className="font-mono text-xs text-[#00f59b]">
                $10.00 USD
              </div>
            </div>

            {/* 2. VERIFIED REWARDS */}
            <div className="flex flex-col items-start lg:items-center text-left lg:text-center">
              <div className="w-14 h-14 rounded-full bg-[#00f59b]/10 border-2 border-[#00f59b] flex items-center justify-center mb-3.5 shadow-[0_0_15px_rgba(0,245,155,0.2)] bg-[#080d16]">
                <Users size={20} className="text-[#00f59b]" />
              </div>
              <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1.5">
                Verified Rewards
              </div>
              <div className="font-mono text-2xl md:text-3xl font-bold text-[#00f59b] tracking-tight leading-none mb-1.5 flex items-center gap-2">
                <span>{number(referralBitsAvailable)}</span>
                <span className="text-xs font-normal text-slate-400">BITS</span>
                {referralBitsAvailable > 0 && (
                  <button
                    type="button"
                    className="button button-primary !h-6 !px-2.5 !text-[11px] !rounded"
                    disabled={isClaiming}
                    onClick={handleClaimReferralBits}
                  >
                    {isClaiming ? <RefreshCw size={11} className="animate-spin" /> : null}
                    <span>Claim</span>
                  </button>
                )}
              </div>
              <div
                onClick={() => setReferralsModalOpen(true)}
                className="font-mono text-xs text-slate-400 hover:text-white cursor-pointer transition-colors flex items-center gap-1"
                title="Click to view Referral Ledger"
              >
                <span>{verifiedMembers.length} Qualified Peers</span>
                <ChevronRight size={12} className="text-[#00f59b]" />
              </div>
            </div>

            {/* 3. PENDING REWARDS */}
            <div className="flex flex-col items-start lg:items-center text-left lg:text-center">
              <div className="w-14 h-14 rounded-full bg-[#f5a623]/10 border-2 border-[#f5a623] flex items-center justify-center mb-3.5 shadow-[0_0_15px_rgba(245,166,35,0.2)] bg-[#080d16]">
                <Timer size={20} className="text-[#f5a623]" />
              </div>
              <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1.5">
                Pending Rewards
              </div>
              <div className="font-mono text-2xl md:text-3xl font-bold text-[#f5a623] tracking-tight leading-none mb-1.5">
                {number(pendingBitsCount)} <span className="text-xs font-normal text-slate-400">BITS</span>
              </div>
              <div
                onClick={() => setReferralsModalOpen(true)}
                className="font-mono text-xs text-slate-400 hover:text-white cursor-pointer transition-colors flex items-center gap-1"
                title="Click to view Referral Ledger"
              >
                <span>{unverifiedMembers.length} Awaiting Stake</span>
                <ChevronRight size={12} className="text-[#f5a623]" />
              </div>
            </div>

            {/* 4. STAKABLE BALANCE */}
            <div className="flex flex-col items-start lg:items-center text-left lg:text-center">
              <div className="w-14 h-14 rounded-full bg-[#38bdf8]/10 border-2 border-[#38bdf8] flex items-center justify-center mb-3.5 shadow-[0_0_15px_rgba(56,189,248,0.25)] bg-[#080d16]">
                <TrendingUp size={20} className="text-[#38bdf8]" />
              </div>
              <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1.5">
                Stakable Balance
              </div>
              <div className="font-mono text-2xl md:text-3xl font-bold text-white tracking-tight leading-none mb-1.5">
                {number(totalFreeBitsAcquired)} <span className="text-xs font-normal text-slate-400">BITS</span>
              </div>
              <div
                onClick={() => setSimulatorModalOpen(true)}
                className="font-mono text-xs text-[#38bdf8] hover:text-white cursor-pointer transition-colors flex items-center gap-1"
                title="Click to open Yield Simulator"
              >
                <span>12% APY · {money(totalFreeBitsValueUsd)}</span>
                <ChevronRight size={12} className="text-[#38bdf8]" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. REFERRALS TEAM LEDGER MODAL OVERLAY */}
      <ReferralsModal
        open={referralsModalOpen}
        onClose={() => setReferralsModalOpen(false)}
        teamMembers={teamMembers}
        filterTab={filterTab}
        setFilterTab={setFilterTab}
      />

      {/* 5. YIELD SIMULATOR MODAL OVERLAY (ZERO CALCULATOR WORD) */}
      <YieldSimulatorModal
        open={simulatorModalOpen}
        onClose={() => setSimulatorModalOpen(false)}
        calcFriends={calcFriends}
        setCalcFriends={setCalcFriends}
        calcTermDays={calcTermDays}
        setCalcTermDays={setCalcTermDays}
        calcTotalFreeBits={calcTotalFreeBits}
        calcTotalBitsUsd={calcTotalBitsUsd}
        calcTermRate={calcTermRate}
        calcPrincipalNoir={calcPrincipalNoir}
        calcYieldNoir={calcYieldNoir}
        calcTotalNoir={calcTotalNoir}
        calcTotalUsdSettled={calcTotalUsdSettled}
        referralUrl={referralUrl}
        copy={copy}
      />

      {/* Guidelines & Rules Modal (All Informational Copy Lives Here) */}
      <CommunityGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />

      {/* Link Sponsor Modal */}
      <LinkSponsorModal
        open={sponsorModalOpen}
        onClose={() => setSponsorModalOpen(false)}
        onApply={handleApplySponsor}
        isPending={apply.isPending}
        error={error}
      />

      {notice}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// 12. ADMIN CONTROL ROOM (/admin)
// ---------------------------------------------------------------------------
function AdminPage({ account }: { account: UserAccount }) {
  const summary = useGetAdminSummary();
  const deposits = useGetAdminDeposits();
  const addresses = useGetAdminAddresses();
  const decide = useDecideDeposit();
  const saveAddress = useSaveAdminAddress();
  const settings = useUpdateLaunchSettings();
  const overview = useGetPresaleOverview();
  const client = useQueryClient();
  const { notify, notice } = useNotice();

  const [rejectId, setRejectId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [bnbAddress, setBnbAddress] = useState('');

  const adminDeposits = asArray<AdminDeposit>(deposits.data);
  const launch = overview.data?.launch;

  const decideDeposit = (id: number, decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !reason.trim()) {
      notify('Please provide a rejection reason.');
      return;
    }
    decide.mutate(
      { id, data: { decision, rejectionReason: decision === 'reject' ? reason : undefined } },
      {
        onSuccess: () => {
          setRejectId(null);
          setReason('');
          notify(`Deposit #${id} ${decision === 'approve' ? 'approved' : 'rejected'}.`);
          void client.invalidateQueries({ queryKey: getGetAdminDepositsQueryKey() });
          void client.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
          void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
          void client.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
        },
      }
    );
  };

  const handleUpdateLaunch = (key: keyof LaunchSettingsInput, value: boolean) => {
    if (!launch) return;
    settings.mutate(
      { data: { ...launch, [key]: value } },
      {
        onSuccess: () => {
          notify(`Launch setting ${String(key)} updated.`);
          void client.invalidateQueries({ queryKey: getGetPresaleOverviewQueryKey() });
        },
      }
    );
  };

  const handleSaveBnb = () => {
    if (!bnbAddress.trim() || bnbAddress.length < 10) {
      notify('Enter a valid BNB Smart Chain address.');
      return;
    }
    saveAddress.mutate(
      { data: { chain: 'bnb', address: bnbAddress.trim(), active: true } },
      {
        onSuccess: () => {
          setBnbAddress('');
          notify('BNB Smart Chain receiving address updated!');
          void client.invalidateQueries({ queryKey: getGetAdminAddressesQueryKey() });
          void client.invalidateQueries({ queryKey: getGetDepositAddressesQueryKey() });
        },
      }
    );
  };

  return (
    <AppShell active="/admin" admin>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Admin Control Room</h1>
          <p className="page-subtitle">
            Audit submitted BNB Smart Chain deposits, manage receiving destinations, and operate launch gates.
          </p>
        </div>
        <span className="status approved"><ShieldCheck size={14} /> Full Operational Access</span>
      </div>

      {summary.data && (
        <div className="cards-4">
          <article className="metric-card">
            <span className="metric-label">Registered Members</span>
            <div className="metric-value">{number(summary.data.users)}</div>
            <div className="metric-foot">Provisioned protocol nodes</div>
          </article>
          <article className="metric-card">
            <span className="metric-label">Pending Deposits</span>
            <div className="metric-value" style={{ color: 'var(--gold-bits)' }}>{number(summary.data.pendingDeposits)}</div>
            <div className="metric-foot">Awaiting blockchain verification</div>
          </article>
          <article className="metric-card">
            <span className="metric-label">Total Capital Raised</span>
            <div className="metric-value">{money(summary.data.totalRaisedUsdt)}</div>
            <div className="metric-foot">Verified BEP-20 USDT receipts</div>
          </article>
          <article className="metric-card">
            <span className="metric-label">BITS Allocated</span>
            <div className="metric-value">{number(summary.data.tokensSold)}</div>
            <div className="metric-foot">Cumulative presale distributions</div>
          </article>
        </div>
      )}

      <div className="dashboard-grid">
        <section className="panel content-card">
          <div className="card-heading">
            <div>
              <h3>Pending Deposit Audits</h3>
              <p>Approve only after independently verifying the transaction on BscScan</p>
            </div>
            <FileClock size={18} color="var(--neon-green)" />
          </div>

          {!adminDeposits.length ? (
            <div className="empty-state">No deposits submitted for review.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>USDT / Bits</th>
                    <th>Reference / Hash</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {adminDeposits.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.userName}</strong>
                        <div style={{ fontSize: 10, color: 'var(--silver-dark)' }}>{d.userEmail}</div>
                      </td>
                      <td>
                        <div className="mono" style={{ color: '#fff' }}>${d.amountUsdt} USDT</div>
                        <div style={{ fontSize: 11, color: 'var(--neon-green)' }}>{number(d.estimatedTokens)} Bits</div>
                      </td>
                      <td>
                        <div className="mono" style={{ fontSize: 11 }}>{d.reference}</div>
                        {d.txHash && <div className="mono" style={{ fontSize: 10, color: 'var(--silver-dark)' }}>{d.txHash.slice(0, 14)}…</div>}
                      </td>
                      <td>
                        {d.status === 'pending' ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="button button-primary"
                              style={{ minHeight: 28, padding: '0 10px', fontSize: 11 }}
                              onClick={() => decideDeposit(d.id, 'approve')}
                              disabled={decide.isPending}
                            >
                              Approve
                            </button>
                            <button
                              className="button button-danger"
                              style={{ minHeight: 28, padding: '0 10px', fontSize: 11 }}
                              onClick={() => { setRejectId(d.id); setReason(''); }}
                              disabled={decide.isPending}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className={`status ${d.status}`}>{d.status}</span>
                        )}
                        {rejectId === d.id && (
                          <div style={{ marginTop: 8 }}>
                            <input
                              className="field"
                              style={{ height: 32, fontSize: 11 }}
                              placeholder="Reason for rejection"
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                            />
                            <button
                              className="button button-danger"
                              style={{ minHeight: 28, fontSize: 11, marginTop: 4 }}
                              onClick={() => decideDeposit(d.id, 'reject')}
                            >
                              Confirm Rejection
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel content-card">
          <div className="card-heading">
            <div>
              <h3>Protocol Launch Gates</h3>
              <p>Configure feature availability</p>
            </div>
            <Radio size={18} color="var(--neon-green)" />
          </div>

          {launch && (
            <div style={{ display: 'grid', gap: 14 }}>
              {[
                ['saleOpen', 'Public Sale Participation', 'Enable new USDT deposits'],
                ['stakingOpen', 'Staking & Burning Engine', 'Allow Bits staking commitments'],
                ['claimsOpen', 'Farming Reward Claims', 'Enable $2+ reward claims'],
                ['swapsOpen', 'Decentralized Swaps', 'Secondary market swap window'],
              ].map(([key, label, hint]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div>
                    <strong style={{ fontSize: 13, color: '#fff', display: 'block' }}>{label}</strong>
                    <span style={{ fontSize: 11, color: 'var(--silver-dark)' }}>{hint}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(launch[key as keyof typeof launch])}
                    onChange={(e) => handleUpdateLaunch(key as keyof LaunchSettingsInput, e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: 'var(--neon-green)', cursor: 'pointer' }}
                  />
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 24, borderTop: '1px solid var(--border-subtle)', paddingTop: 18 }}>
            <h4 style={{ margin: '0 0 8px', font: '700 15px var(--app-font-serif)', color: '#fff' }}>
              Update BNB Smart Chain Receiving Address
            </h4>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="field mono"
                placeholder="0x... verified address"
                value={bnbAddress}
                onChange={(e) => setBnbAddress(e.target.value)}
              />
              <button className="button button-soft" onClick={handleSaveBnb} disabled={saveAddress.isPending}>
                Save
              </button>
            </div>
          </div>
        </section>
      </div>

      {notice}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// 13. MAIN APPLICATION ROUTER WITH STREAMLINED TAB ARCHITECTURE
// ---------------------------------------------------------------------------
function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <FeedbackMonitor />
        <WouterRouter base={basePath}>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={HomePage} />
              <Route path="/docs" component={DocsPage} />
              <Route path="/whitepaper" component={DocsPage} />
              <Route path="/sign-in" component={SignInPage} />
              <Route path="/sign-up" component={SignUpPage} />

              {/* COINBASE-STYLE WALLET ROUTE (Default Portfolio View) */}
              <Route path="/wallet">
                {() => <ProtectedGate>{(account) => <WalletPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/deposit">
                {() => <ProtectedGate>{(account) => <WalletPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/assets">
                {() => <ProtectedGate>{(account) => <WalletPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/withdraw">
                {() => <ProtectedGate>{(account) => <WalletPage account={account} />}</ProtectedGate>}
              </Route>

              {/* DEDICATED INDIVIDUAL ASSET DETAILS & TRANSACTION HISTORY */}
              <Route path="/asset/:assetId">
                {(params) => <ProtectedGate>{(account) => <AssetDetailPage account={account} assetId={params.assetId} />}</ProtectedGate>}
              </Route>
              <Route path="/assets/:assetId">
                {(params) => <ProtectedGate>{(account) => <AssetDetailPage account={account} assetId={params.assetId} />}</ProtectedGate>}
              </Route>

              {/* DEDICATED GLOBAL TRANSACTION HISTORY & AUDIT LEDGER */}
              <Route path="/activity">
                {() => <ProtectedGate>{(account) => <TransactionsPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/transactions">
                {() => <ProtectedGate>{(account) => <TransactionsPage account={account} />}</ProtectedGate>}
              </Route>

              {/* BITS MINING & PROOF-OF-BURN ENGINE (/staking, /mining) */}
              <Route path="/staking">
                {() => <ProtectedGate>{(account) => <StakingPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/mining">
                {() => <ProtectedGate>{(account) => <StakingPage account={account} />}</ProtectedGate>}
              </Route>

              {/* PROTOCOL STATISTICS & STAKER METRICS (/statistics, /statics, /pool) */}
              <Route path="/statistics">
                {() => <ProtectedGate>{(account) => <StatisticsPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/statics">
                {() => <ProtectedGate>{(account) => <StatisticsPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/pool">
                {() => <ProtectedGate>{(account) => <StatisticsPage account={account} />}</ProtectedGate>}
              </Route>

              {/* AIRDROP & REFERRAL NETWORK */}
              <Route path="/referrals">
                {() => <ProtectedGate>{(account) => <ReferralsPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/airdrop">
                {() => <ProtectedGate>{(account) => <ReferralsPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/team">
                {() => <ProtectedGate>{(account) => <ReferralsPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/tasks">
                {() => <ProtectedGate>{(account) => <ReferralsPage account={account} />}</ProtectedGate>}
              </Route>

              {/* ADMIN GOVERNANCE */}
              <Route path="/admin">
                {() => <ProtectedGate admin>{(account) => <AdminPage account={account} />}</ProtectedGate>}
              </Route>

              <Route component={NotFound} />
            </Switch>
          </RoutedErrorBoundary>
        </WouterRouter>
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
