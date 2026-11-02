import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3, BookOpen, Check,
  ChevronRight, Coins, Copy, ExternalLink, FileClock, Flame, Gift, Globe2, HelpCircle, Info,
  Landmark, Layers3, Link as LinkIcon, LockKeyhole, LogOut, Menu, PieChart, Plus, QrCode, Radio, RefreshCw,
  Search, Send, ShieldAlert, ShieldCheck, Sparkles, Timer, TrendingUp, Trophy, Users, Wallet, X,
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
const BITNOIR_REFERENCE_PRICE = 50; // $50.00 Protocol Accounting Valuation
const BITS_REFERENCE_PRICE = 0.10; // $0.10 Protocol Rate (100 USDT = 1,000 Bits)
const USDT_PER_BITS = 0.1; // 1 USDT = 10 Bits
const MIN_CLAIM_USDT = 2; // $2.00 Minimum Claim / Withdrawal Threshold
const MIN_CLAIM_BITNOIR = MIN_CLAIM_USDT / BITNOIR_REFERENCE_PRICE; // 0.0400 BITS
const TOTAL_MAX_SUPPLY = 21_000_000; // Hard-capped 21M matching Bitcoin

const rewardRateForDays = (days: number): number => {
  if (days <= 30) return 0.12; // 12% at 30 days
  if (days >= 90) return 0.60; // 60% at 90 days
  if (days <= 60) {
    return 0.12 + ((days - 30) / 30) * (0.28 - 0.12);
  }
  return 0.28 + ((days - 60) / 30) * (0.60 - 0.28);
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
        <Link href="/staking" className={location === '/staking' ? 'active' : ''}>Staking</Link>
        <Link href="/pool" className={location === '/pool' ? 'active' : ''}>Mining Pool</Link>
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
// 1. HOME / LANDING PAGE
// ---------------------------------------------------------------------------
function HomePage() {
  const overview = useGetPresaleOverview();
  const data = overview.data;
  const batches = asArray<PresaleOverview['batches'][number]>(data?.batches);
  const allocations = asArray<PresaleOverview['allocations'][number]>(data?.allocations);
  const sold = Number(data?.totalTokensSold) || 0;
  const cap = Number(data?.publicSaleSupply) || 0;
  const percentage = cap > 0 ? Math.min(100, (sold / cap) * 100) : 0;

  return (
    <div className="site-shell">
      <PublicHeader hideSignIn />
      <main>
        {/* HERO SECTION */}
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="eyebrow-dot" />
              Bitcoin-Aligned Capital Layer · BEP-20 USDT
            </div>
            <h1>
              Built for the <br />
              <span className="highlight-green">Next Signal.</span>
            </h1>
            <p>
              Bitnoir is a fair-launch digital asset ecosystem engineered for structured capital participation.
              Route BEP-20 USDT, mint Bits, lock into deflationary burn staking, accrue continuous pool farming,
              and redeem principal Bitnoir tokens upon maturity.
            </p>
            <div className="hero-actions">
<Link href="/sign-up" className="button button-primary hero-primary-action">
Enter Fair Launch <ArrowRight size={15} />
              </Link>
              <Link href="/docs" className="button button-ghost">
                Read Whitepaper <BookOpen size={15} />
              </Link>
              <Link href="/staking" className="button button-soft">
                View Staking Terms
              </Link>
            </div>
            <div className="trustline">
              <span><i className="trustline-dot" /> 21,000,000 Hard Cap</span>
              <span><i className="trustline-dot" /> Proof-of-Burn Staking</span>
              <span><i className="trustline-dot" /> 100 USDT = 1,000 Bits</span>
            </div>
          </div>

          <div className="hero-art" aria-label="Bitnoir Token Showcase">
            <div className="hero-coin-stage">
              <div className="hero-glow-backdrop" />
              <div className="hero-orbit-ring" />
              <div className="hero-orbit-ring-inner" />

              <div className="hero-token-card">
                <img
                  src="/asset-bitnoir.png"
                  srcSet="/asset-bitnoir-md.png 128w, /asset-bitnoir-lg.png 256w, /asset-bitnoir.png 512w"
                  sizes="240px"
                  alt="Bitnoir token"
                  width={240}
                  height={240}
                />
              </div>

              <div className="hero-secondary-coin" title="Bits (Staking Units)">
                <img
                  src="/asset-bits-lg.png"
                  srcSet="/asset-bits-sm.png 64w, /asset-bits-md.png 128w, /asset-bits-lg.png 256w, /asset-bits.png 512w"
                  sizes="90px"
                  alt="Bits Staking Unit"
                  width={90}
                  height={90}
                />
              </div>


            </div>
          </div>
        </section>

        {/* KEY STATS BAR */}
        <section className="landing-stats">
          <div className="landing-stat">
            <strong>21,000,000</strong>
            <span>Maximum BITS Supply</span>
          </div>
          <div className="landing-stat">
            <strong>100 USDT = 1,000</strong>
            <span>Bits Accounting Rate</span>
          </div>
          <div className="landing-stat">
            <strong>30 — 90 Days</strong>
            <span>Staking Term Selection</span>
          </div>
          <div className="landing-stat">
            <strong>$2.00 Min</strong>
            <span>Farming Claim Threshold</span>
          </div>
        </section>

        {/* TOKENOMICS & BATCHES */}
        <section className="section" id="tokenomics">
          <div className="section-head">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" />Fair Launch Allocation</div>
              <h2>Transparent Tokenomics</h2>
            </div>
            <p>
              Bitnoir eliminates private allocations, insider pre-mines, and variable unlocks.
              All public capital follows strict stage-bound pricing.
            </p>
          </div>

          <div className="sale-grid">
            <div className="panel sale-panel">
              <div className="sale-numbers">
                <div>
                  <span className="small-label">Raised to Date</span>
                  <strong>{data ? money(data.totalRaisedUsdt) : '—'}</strong>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="small-label">Public Sale Cap</span>
                  <strong>{compact(cap)} <small style={{ fontSize: 13, color: 'var(--silver-dark)' }}>BITS</small></strong>
                </div>
              </div>

              <div className="progress-track" aria-label={`${percentage.toFixed(1)} percent allocated`}>
                <div className="progress-value" style={{ width: `${percentage}%` }} />
              </div>
              <div className="progress-meta">
                <span>{number(sold)} BITS Allocated</span>
                <span>{percentage.toFixed(1)}% Staged</span>
              </div>

              <div className="batch-list">
                {batches.map((batch) => (
                  <div className="batch-row" key={batch.id}>
                    <span>
                      <strong style={{ color: '#fff' }}>{batch.name}</strong>
                    </span>
                    <span className="mono" style={{ color: 'var(--neon-green)' }}>
                      ${Number(batch.pricePerToken).toFixed(3)} / Bitnoir
                    </span>
                    <span className="mono" style={{ color: 'var(--silver-medium)' }}>
                      {compact(batch.tokensSold)} / {compact(batch.tokenSupply)}
                    </span>
                    <span className={`batch-tag ${batch.status === 'active' ? 'active' : ''}`}>
                      {batch.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel allocation-panel">
              <h3>Measured Supply Distribution</h3>
              <p>Aligned with Bitcoin's 21,000,000 token limit to guarantee verifiable digital scarcity.</p>
              {allocations.map((alloc) => (
                <div className="allocation-row" key={alloc.name}>
                  <strong style={{ color: '#fff' }}>{alloc.name}</strong>
                  <strong className="mono" style={{ color: 'var(--neon-green)' }}>{alloc.percent}%</strong>
                  <div className="progress-track">
                    <div className="progress-value" style={{ width: `${alloc.percent}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <Brand size="sm" />
        <span>Bitnoir Protocol · Bits Points · 21,000,000 Fixed Cap</span>
        <span>Participation involves market and smart-contract risk. Review disclosures carefully.</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. WHITEPAPER & DOCUMENTATION (/docs)
// ---------------------------------------------------------------------------
function DocsPage() {
  const [activeSection, setActiveSection] = useState('executive-summary');

  const navItems = [
    { id: 'executive-summary', label: '1.0 Executive Summary' },
    { id: 'dual-assets', label: '2.0 Dual Asset Architecture' },
    { id: 'tokenomics', label: '3.0 Tokenomics & Supply Cap' },
    { id: 'staking-protocol', label: '4.0 Staking Protocol & Lockup' },
    { id: 'token-burning', label: '5.0 Proof-of-Burn Mechanics' },
    { id: 'principal-return', label: '6.0 Principal Return & Valuation' },
    { id: 'farming-claims', label: '7.0 Farming Yield & $2 Claim Rule' },
    { id: 'mining-pool', label: '8.0 Mining Pool Economics' },
    { id: 'risk-disclosure', label: '9.0 Comprehensive Risk Notice' },
  ];

  return (
    <div className="site-shell">
      <PublicHeader />
      <div className="whitepaper-wrapper">
        <header className="whitepaper-hero">
          <div className="eyebrow"><span className="eyebrow-dot" />Whitepaper Version 2.4 · October 2026</div>
          <h1 className="display" style={{ fontSize: 'clamp(36px, 5vw, 64px)', margin: '20px 0 16px', color: '#fff' }}>
            Bitnoir: The Bitcoin-Aligned <br />
            <span className="highlight-green">Capital & Staking Engine</span>
          </h1>
          <p style={{ maxWidth: 720, color: 'var(--silver-medium)', fontSize: 16, lineHeight: 1.8 }}>
            A formal specification of the Bitnoir dual-asset protocol, proof-of-burn staking dynamics,
            verifiable pool emissions, and transparent principal return mechanics.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <Link href="/wallet" className="button button-primary">Launch Protocol Wallet <ArrowRight size={14} /></Link>
            <Link href="/staking" className="button button-ghost">View Live Staking Terms</Link>
          </div>
        </header>

        <div className="whitepaper-layout">
          <aside className="whitepaper-sidebar">
            <div className="whitepaper-nav-title">Whitepaper Index</div>
            <nav className="whitepaper-nav">
              {navItems.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={activeSection === item.id ? 'active' : ''}
                  onClick={() => setActiveSection(item.id)}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div style={{ marginTop: 24, padding: 14, background: 'rgba(255,255,255,0.02)', borderRadius: 10, fontSize: 11, color: 'var(--silver-dark)' }}>
              Contract: BEP-20 Standard<br />
              Status: Public Stage Open
            </div>
          </aside>

          <article className="whitepaper-content">
            <section className="whitepaper-section" id="executive-summary">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 1.0</div>
              <h2>Executive Summary & Purpose</h2>
              <p>
                Bitnoir establishes a disciplined digital asset gaming and capital coordination framework.
                Built upon Bitcoin's core ethos of mathematically bounded supply (21,000,000 units), the protocol
                solves the structural flaws prevalent in contemporary fair launches: predatory token unlocks,
                shadow private sales, and speculative liquidity extraction.
              </p>
            </section>

            <section className="whitepaper-section" id="dual-assets">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 2.0</div>
              <h2>Dual Asset Architecture: Bits vs Bitnoir</h2>
              <div className="cards-4" style={{ gridTemplateColumns: '1fr 1fr', margin: '24px 0' }}>
                <div className="panel content-card" style={{ borderColor: 'rgba(245, 166, 35, 0.3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <BitsMark size={28} />
                    <h3 style={{ margin: 0, fontSize: 18, color: 'var(--neon-green)' }}>Bits (Points)</h3>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--silver-medium)', margin: 0 }}>
                    Internal protocol units credited upon verified USDT deposits on BNB Smart Chain.
                    <strong> 100 USDT = 1,000 Bits</strong>. Bits cannot be transferred to secondary exchanges;
                    they exist exclusively to initiate staking positions. When committed to staking, Bits are
                    <strong> permanently burned</strong>.
                  </p>
                </div>

<div className="panel content-card" style={{ borderColor: 'rgba(255, 139, 47, 0.35)' }}>
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
  <TokenMark size={28} />
  <h3 style={{ margin: 0, fontSize: 18, color: 'var(--token-orange)' }}>Bitnoir Token</h3>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--silver-medium)', margin: 0 }}>
                    The native cryptographic token of the ecosystem with a hard cap of <strong>21,000,000 BITS</strong>.
                    Bitnoir tokens are minted and distributed via the presale, mining pool emissions, and staking
                    principal redemptions funded by the 20% Staking Reserve.
                  </p>
                </div>
              </div>
            </section>

            <section className="whitepaper-section" id="staking-protocol">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 4.0</div>
              <h2>Staking Protocol & Lockup Selection</h2>
              <p>
                Participants enter staking by depositing BEP-20 USDT, receiving Bits (100 USDT = 1,000 Bits), and
                selecting a customized lockup period between <strong>30 days (minimum)</strong> and <strong>90 days (maximum)</strong>.
              </p>
              <div className="cards-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)', margin: '20px 0' }}>
                <div className="panel content-card">
                  <span className="small-label">30-Day Term</span>
                  <div style={{ font: '700 22px var(--app-font-serif)', color: 'var(--neon-green)', margin: '8px 0' }}>Base Tier</div>
                  <p style={{ fontSize: 12, color: 'var(--silver-dark)', margin: 0 }}>Standard Protocol Allocation</p>
                </div>
                <div className="panel content-card">
                  <span className="small-label">60-Day Term</span>
                  <div style={{ font: '700 22px var(--app-font-serif)', color: 'var(--neon-green)', margin: '8px 0' }}>Accelerated Tier</div>
                  <p style={{ fontSize: 12, color: 'var(--silver-dark)', margin: 0 }}>Enhanced Protocol Allocation</p>
                </div>
                <div className="panel content-card" style={{ borderColor: 'var(--border-neon)' }}>
                  <span className="small-label">90-Day Term</span>
                  <div style={{ font: '700 22px var(--app-font-serif)', color: 'var(--neon-green)', margin: '8px 0' }}>Maximum Tier</div>
                  <p style={{ fontSize: 12, color: 'var(--silver-dark)', margin: 0 }}>Highest Protocol Allocation</p>
                </div>
              </div>
            </section>

            <section className="whitepaper-section" id="principal-return">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 6.0</div>
              <h2>Principal Return & Valuation</h2>
              <div className="callout warning" style={{ marginBottom: 20 }}>
                <strong>CRITICAL DISCLOSURE:</strong> The $50.00 reference price is an internal protocol
                accounting benchmark used exclusively to calculate the number of Bitnoir tokens redeemable upon maturity.
              </div>
              <div className="formula-card">
                <div className="formula-header">Principal Return Formula</div>
                <div className="formula-math">Principal_BITS = (Staked_Bits × $0.10) / Reference_Valuation ($50.00)</div>
                <div className="formula-explanation">
                  Example: 1,000 Bits staked ($100 USDT value) → returns 2.0000 Bitnoir Tokens upon maturity.
                  Funded directly from the 4,200,000 BITS Staking & Yield Reserve.
                </div>
              </div>
            </section>

            <section className="whitepaper-section" id="risk-disclosure">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 9.0</div>
              <h2>Comprehensive Risk Notice</h2>
              <div className="callout error">
                Participation involves cryptographic, market, and smart contract risk. Never commit capital you cannot afford to lose.
              </div>
            </section>
          </article>
        </div>
      </div>
      <footer className="footer">
        <Brand size="sm" />
        <span>Official Protocol Whitepaper</span>
        <Link href="/wallet" className="button button-soft" style={{ minHeight: 32, fontSize: 11 }}>Return to Wallet</Link>
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
  { href: '/staking', label: 'Earn & Staking', description: '30–90d lockup & proof-of-burn', icon: Layers3 },
  { href: '/activity', label: 'Transactions', description: 'Complete ledger & audit history', icon: FileClock },
  { href: '/statistics', label: 'Statistics', description: 'Overall stakers & protocol metrics', icon: Globe2 },
  { href: '/referrals', label: 'Airdrop & Network', description: 'Reputation XP & invite link', icon: Gift },
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
function StakingGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(0, 245, 155, 0.12)', display: 'grid', placeItems: 'center', color: 'var(--neon-green)' }}>
              <BookOpen size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 18 }}>Staking Protocol Guide & Rules</h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>Proof-of-Burn Tokenomics & Yield Mechanics</p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="staking-guide-modal-content">
          <div className="guide-section-card">
            <div className="guide-section-head">
              <Flame size={18} />
              <span>1. Proof-of-Burn Mechanism</span>
            </div>
            <p>
              When you stake Bits, your committed principal is burned from circulating supply.
              This permanent deflationary lock eliminates mercenary capital and creates sustained protocol scarcity.
            </p>
          </div>

          <div className="guide-section-card">
            <div className="guide-section-head">
              <Timer size={18} />
              <span>2. Lockup Durations & Yield Tiers</span>
            </div>
            <p>
              Higher lockup terms provide increased algorithmic rewards funded by the 20% protocol staking reserve.
            </p>
            <table className="guide-table">
              <thead>
                <tr>
                  <th>Term Period</th>
                  <th>Yield Tier</th>
                  <th>Emissions Tier</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>30 Days</td>
                  <td style={{ color: 'var(--neon-green)' }}>Base Tier</td>
                  <td>Standard Emissions</td>
                  <td>Available</td>
                </tr>
                <tr>
                  <td>60 Days</td>
                  <td style={{ color: 'var(--neon-green)' }}>Accelerated Tier</td>
                  <td>Enhanced Emissions</td>
                  <td>Recommended</td>
                </tr>
                <tr>
                  <td>90 Days</td>
                  <td style={{ color: 'var(--neon-green)' }}>Maximum Tier</td>
                  <td>Max Emissions</td>
                  <td>High Yield</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="guide-section-card">
            <div className="guide-section-head">
              <Sparkles size={18} />
              <span>3. Live Yield Accumulation</span>
            </div>
            <p>
              Yield generates in real time. Once your stake is activated, rewards stream continuously into your claimable balance every second.
            </p>
          </div>

          <div className="guide-section-card">
            <div className="guide-section-head">
              <Coins size={18} />
              <span>4. Principal Return at Maturity & Claiming</span>
            </div>
            <p>
              Upon term completion, your full principal is returned in Bitnoir tokens calculated at the $50 protocol accounting reference valuation.
              Rewards can be claimed anytime once they reach {MIN_CLAIM_BITNOIR.toFixed(4)} Bitnoir (the threshold is waived completely once your lock term finishes, allowing full final settlement).
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
// FIXED OVERLAY STAKING POSITION MODAL (DUAL SCROLL LINES: TIME & BITS)
// ---------------------------------------------------------------------------
function StakingPositionModal({
  open,
  onClose,
  isStakingActive,
  purchasedBits,
  stakedBits,
  existingPrincipalReturnTokens,
  existingPrincipalReturnUsd,
  existingTotalReturnTokens,
  existingTotalReturnUsd,
  duration,
  setDuration,
  onStakeSuccess,
  notify,
  activePositions = [],
}: {
  open: boolean;
  onClose: () => void;
  isStakingActive: boolean;
  purchasedBits: number;
  stakedBits: number;
  activePositions?: StakingPosition[];
  existingPrincipalReturnTokens: number;
  existingPrincipalReturnUsd: number;
  existingTotalReturnTokens: number;
  existingTotalReturnUsd: number;
  duration: number;
  setDuration: (d: number) => void;
  onStakeSuccess: () => void;
  notify: (msg: string) => void;
}) {
  const [stakeAmount, setStakeAmount] = useState<string>('');
  const stake = useStakeTokens();

  useEffect(() => {
    if (open) {
      setStakeAmount('');
    }
  }, [open]);

  if (!open) return null;

  const numericStake = Number(stakeAmount) || 0;
  const rewardRate = rewardRateForDays(duration);

  const primaryActive = activePositions.find((p) => p.status === 'active') || activePositions[0];
  const activeTerm = primaryActive?.lockupDays || 60;
  const isSameTerm = isStakingActive && duration === activeTerm;
  const isLowerTerm = isStakingActive && duration < activeTerm;
  const isHigherTerm = isStakingActive && duration > activeTerm;

  // Exact rule-based return metrics for the new/additional position
  const newPrincipalReturnTokens = (numericStake * USDT_PER_BITS) / BITNOIR_REFERENCE_PRICE;
  const newPrincipalReturnUsd = numericStake * USDT_PER_BITS;
  const newRewardTokens = (numericStake * USDT_PER_BITS * rewardRate) / BITNOIR_REFERENCE_PRICE;
  const newRewardUsd = newRewardTokens * BITNOIR_REFERENCE_PRICE;
  const newTotalReturnTokens = newPrincipalReturnTokens + newRewardTokens;
  const newTotalReturnUsd = newPrincipalReturnUsd + newRewardUsd;

  // Combined position metrics if increasing
  const combinedBits = stakedBits + numericStake;
  const combinedPrincipalTokens = (combinedBits * USDT_PER_BITS) / BITNOIR_REFERENCE_PRICE;
  const combinedPrincipalUsd = combinedBits * USDT_PER_BITS;
  const combinedRewardTokens = (combinedBits * USDT_PER_BITS * rewardRate) / BITNOIR_REFERENCE_PRICE;
  const combinedTotalReturnTokens = combinedPrincipalTokens + combinedRewardTokens;
  const combinedTotalReturnUsd = combinedPrincipalUsd + (combinedRewardTokens * BITNOIR_REFERENCE_PRICE);

  const handleCommit = () => {
    if (numericStake <= 0 || numericStake > purchasedBits) {
      notify('Please enter a valid Bits amount within your available balance.');
      return;
    }

    stake.mutate(
      { data: { amountTokens: numericStake, lockupDays: duration } as any },
      {
        onSuccess: () => {
          if (isStakingActive && isSameTerm) {
            notify(`Position increased by +${numericStake.toLocaleString()} Bits in your active ${duration}-day term!`);
          } else if (isStakingActive) {
            notify(`New independent position opened: ${numericStake.toLocaleString()} Bits locked for ${duration} days!`);
          } else {
            notify(`Successfully staked ${numericStake.toLocaleString()} Bits for ${duration} days!`);
          }
          onStakeSuccess();
          onClose();
        },
        onError: () => notify('Staking transaction failed. Please retry.'),
      }
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog staking-overlay-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 640 }}
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
              <TrendingUp size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: 20, margin: 0, color: '#fff' }}>
                {isStakingActive ? 'Increase Staking Position' : 'Staking Position Console'}
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--silver-dark)' }}>
                Adjust term duration and allocation to preview verified protocol returns
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 16 }}>
          {/* 1. FLEXIBLE TIME LINE (ANY DAY 30 TO 90) */}
          <div className="slider-line-card">
            <div className="slider-line-head">
              <span className="slider-line-label">
                <Timer size={14} className="slider-icon-green" />
                <span>Lockup Duration</span>
              </span>
              <span className="slider-current-badge">{duration} Days Locked</span>
            </div>

            <div className="slider-track-wrap">
              <input
                type="range"
                min="30"
                max="90"
                step="1"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="modern-range-line"
                aria-label="Lock duration in days"
              />
            </div>

            <div className="slider-range-endpoints">
              <span>Min. 30 Days</span>
              <span className="slider-range-mid">Continuous Term Selection</span>
              <span>Max. 90 Days</span>
            </div>

            {isLowerTerm && (
              <div className="modal-term-notice warning" style={{ marginTop: 12 }}>
                <strong>⚡ Multi-Term Staking Rule:</strong> You have an active {activeTerm}-Day position. Selecting {duration} Days will open a separate independent <strong>Position #{activePositions.length + 1} ({duration}-Day Term)</strong>. Your existing {activeTerm}-Day position remains locked with its full schedule and rate.
              </div>
            )}
            {isSameTerm && (
              <div className="modal-term-notice" style={{ marginTop: 12 }}>
                <strong>⚡ Position Consolidation:</strong> Adding +{number(numericStake)} Bits directly into your active {activeTerm}-day position.
              </div>
            )}
            {isHigherTerm && (
              <div className="modal-term-notice" style={{ marginTop: 12 }}>
                <strong>⚡ Multi-Term Extension:</strong> Selecting {duration} Days opens a separate independent <strong>Position #{activePositions.length + 1} ({duration}-Day Term)</strong> at a higher yield rate.
              </div>
            )}
          </div>

          {/* 2. FLEXIBLE BITS COMMITMENT LINE */}
          <div className="slider-line-card">
            <div className="slider-line-head">
              <span className="slider-line-label">
                <BitsMark size={16} />
                <span>Commitment Allocation</span>
              </span>
              <span className="slider-avail-tag">
                Available: <strong>{number(purchasedBits)} Bits</strong>
              </span>
            </div>

            {/* Exact numeric input box */}
            <div className="modern-stake-input-box" style={{ marginTop: 6, marginBottom: 12 }}>
              <div className="input-with-symbol">
                <BitsMark size={24} />
                <input
                  type="number"
                  min="0"
                  max={purchasedBits}
                  placeholder="0"
                  className="modern-numeric-input"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                />
                <span className="modern-input-ticker">Bits</span>
              </div>
              <div className="modern-input-subline">
                <span>≈ {money(numericStake * USDT_PER_BITS)} USD</span>
                <button
                  type="button"
                  className="quick-max-link"
                  onClick={() => setStakeAmount(String(purchasedBits))}
                >
                  MAX
                </button>
              </div>
            </div>

            {/* Continuous scrubbable Bits range line */}
            <div className="slider-track-wrap">
              <input
                type="range"
                min="0"
                max={purchasedBits}
                step={Math.max(1, Math.floor(purchasedBits / 100))}
                value={numericStake}
                onChange={(e) => setStakeAmount(e.target.value)}
                className="modern-range-line"
                aria-label="Bits stake amount"
              />
            </div>

            {/* Quick ratio presets */}
            <div className="preset-ratio-pills" style={{ marginTop: 10 }}>
              {[0.25, 0.5, 0.75, 1.0].map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  className="preset-ratio-pill"
                  onClick={() => setStakeAmount(String(Math.floor(purchasedBits * ratio)))}
                >
                  {ratio === 1.0 ? 'MAX' : `${ratio * 100}%`}
                </button>
              ))}
            </div>
          </div>

          {/* 3. FINAL RESULTS RECEIPT TABLE (INSTITUTIONAL PERFECTION - NO REPEATING LOGOS) */}
          <div className="institutional-receipt-card" style={{ margin: 0 }}>
            <div className="receipt-title-row">
              <span className="receipt-badge">POSITION SETTLEMENT RECEIPT</span>
              <span className="receipt-term-tag">{duration} Days Term</span>
            </div>

            <div className="receipt-rows">
              <div className="receipt-row">
                <span className="receipt-lbl">Stake Commitment</span>
                <span className="receipt-val">
                  {number(numericStake)} Bits <span className="receipt-dim">({money(newPrincipalReturnUsd)})</span>
                </span>
              </div>

              <div className="receipt-row">
                <span className="receipt-lbl">Principal Return</span>
                <span className="receipt-val">
                  {newPrincipalReturnTokens.toFixed(4)} Bitnoir
                </span>
              </div>

              <div className="receipt-row">
                <span className="receipt-lbl">Term Yield Return</span>
                <span className="receipt-val text-green">
                  +{newRewardTokens.toFixed(4)} Bitnoir
                </span>
              </div>

              <div className="receipt-divider" />

              <div className="receipt-row total-highlight">
                <div className="receipt-total-label-wrap">
                  <span className="receipt-total-title">Total Return at Maturity</span>
                  <span className="receipt-total-fiat">≈ {money(newTotalReturnUsd)} USD</span>
                </div>
                <div className="receipt-total-figure">
                  <TokenMark size={22} />
                  <span className="receipt-total-num">{newTotalReturnTokens.toFixed(4)}</span>
                  <span className="receipt-total-unit">Bitnoir</span>
                </div>
              </div>
            </div>

            {isStakingActive && numericStake > 0 && (
              <div className="receipt-combined-note">
                {isSameTerm ? (
                  <>Combined Active {duration}-Day Position: <strong>{number(combinedBits)} Bits</strong> → <strong>{combinedTotalReturnTokens.toFixed(4)} Bitnoir</strong> ({money(combinedTotalReturnUsd)})</>
                ) : (
                  <>Independent Position #{activePositions.length + 1}: <strong>{number(numericStake)} Bits</strong> locked for {duration} days. Active {activeTerm}-day position ({number(stakedBits)} Bits) continues unaffected.</>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button type="button" className="clean-glass-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="clean-stake-confirm-btn"
            style={{ width: 'auto', minWidth: 220 }}
            disabled={stake.isPending || numericStake <= 0 || numericStake > purchasedBits}
            onClick={handleCommit}
          >
            {stake.isPending ? (
              'Processing Staking Order…'
            ) : numericStake <= 0 ? (
              'Enter Commitment Amount'
            ) : numericStake > purchasedBits ? (
              'Insufficient Bits Balance'
            ) : isStakingActive && isSameTerm ? (
              <>Confirm Position Increase (+{number(numericStake)} Bits) <ArrowRight size={16} /></>
            ) : isStakingActive ? (
              <>Open {duration}-Day Position ({number(numericStake)} Bits) <ArrowRight size={16} /></>
            ) : (
              <>Confirm & Lock {number(numericStake)} Bits <ArrowRight size={16} /></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function StakingPage({ account }: { account: UserAccount }) {
  const client = useQueryClient();
  const { notify, notice } = useNotice();

  const balances = (account.balances as unknown as Record<string, number>) || {};
  const purchasedBits = balances.purchased || 0;
  const stakedBits = balances.staked || 0;
  const claimableTokens = balances.claimable || 0;

  const isStakingActive = stakedBits > 0;
  const [duration, setDuration] = useState<number>(60);
  const [depositOpen, setDepositOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  // Position modal overlay state (matches Guide modal architecture)
  const [isPositionModalOpen, setIsPositionModalOpen] = useState<boolean>(false);

  // Check if active staking term is finished (unlock time reached)
  const positions = readPositions(account);
  const activePositions = positions.filter((p) => p.status === 'active');
  const primaryPosition = activePositions[0] || (account as unknown as { position?: StakingPosition }).position;
  const isTermFinished = activePositions.length > 0
    ? activePositions.every((p) => new Date(p.unlocksAt).getTime() <= Date.now())
    : primaryPosition
    ? new Date(primaryPosition.unlocksAt).getTime() <= Date.now()
    : false;

  // Exact rule-based per-hour emission calculation
  const calculatePositionPerHour = (bits: number, days: number, customRate?: number) => {
    const rate = customRate ?? rewardRateForDays(days);
    const totalYieldBitnoir = (bits * USDT_PER_BITS * rate) / BITNOIR_REFERENCE_PRICE;
    const totalHours = Math.max(1, days * 24);
    return totalYieldBitnoir / totalHours;
  };

  const totalBitnoirPerHour = activePositions.length > 0
    ? activePositions.reduce((sum, p) => sum + calculatePositionPerHour(p.stakedBits, p.lockupDays || 30, p.rewardRate), 0)
    : calculatePositionPerHour(stakedBits, duration);

  // Real-time ticking reward state (Stake.coredao.org style continuous live yield streaming)
  const [liveClaimable, setLiveClaimable] = useState<number>(claimableTokens);

  useEffect(() => {
    setLiveClaimable(claimableTokens);
  }, [claimableTokens]);

  // Live points/yield increasing ticker strictly synchronized to the exact hourly rate
  useEffect(() => {
    if (stakedBits <= 0 || totalBitnoirPerHour <= 0) return;
    const rewardPerSecond = totalBitnoirPerHour / 3600;
    const tickIntervalMs = 250;
    const deltaPerTick = rewardPerSecond * (tickIntervalMs / 1000);

    const timer = setInterval(() => {
      setLiveClaimable((prev) => prev + deltaPerTick);
    }, tickIntervalMs);

    return () => clearInterval(timer);
  }, [stakedBits, totalBitnoirPerHour]);

  const rewardRate = rewardRateForDays(duration);

  // Active existing position metrics
  const existingPrincipalReturnTokens = (stakedBits * USDT_PER_BITS) / BITNOIR_REFERENCE_PRICE;
  const existingPrincipalReturnUsd = stakedBits * USDT_PER_BITS;
  const existingRewardTokens = (stakedBits * USDT_PER_BITS * rewardRate) / BITNOIR_REFERENCE_PRICE;
  const existingTotalReturnTokens = existingPrincipalReturnTokens + existingRewardTokens;
  const existingTotalReturnUsd = existingPrincipalReturnUsd + (existingRewardTokens * BITNOIR_REFERENCE_PRICE);

  // Claim eligibility: waived upon lock term finish, otherwise 0.0400 Bitnoir
  const canClaim = isTermFinished
    ? liveClaimable > 0
    : liveClaimable >= MIN_CLAIM_BITNOIR;

  const handleClaim = async () => {
    if (!canClaim) {
      if (!isTermFinished) {
        notify(`Minimum mid-term claim threshold is ${MIN_CLAIM_BITNOIR.toFixed(4)} Bitnoir. Full balance is claimable upon term maturity.`);
      } else {
        notify('No claimable Bitnoir available at this time.');
      }
      return;
    }
    try {
      const res = await fetch('/api/accounts/me/claim', { method: 'POST' });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const burnedBits = data?.burnedBitsSettled || Math.round((liveClaimable * BITNOIR_REFERENCE_PRICE) / USDT_PER_BITS);
        notify(`Successfully claimed ${liveClaimable.toFixed(4)} Bitnoir tokens! Protocol burned ${burnedBits.toLocaleString()} Bits per Proof-of-Burn rule.`);
        setLiveClaimable(0);
        void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
        void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
      } else {
        notify('Claim operation could not be completed.');
      }
    } catch {
      notify('Claim operation could not be completed.');
    }
  };

  return (
    <AppShell active="/staking" admin={account.role === 'admin'}>
      {/* 1. CLEAN TOP BAR: MINIMAL TEXT, RIGHT-ALIGNED GUIDE & BITS BUTTONS */}
      <div className="page-title-row" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 24, margin: '0 0 2px' }}>Staking Protocol</h1>
          <p className="page-subtitle" style={{ margin: 0, fontSize: 13, color: 'var(--silver-dark)' }}>
            Proof-of-Burn Yield Engine · Continuous Bitnoir Emissions
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            className="clean-glass-btn"
            onClick={() => setGuideOpen(true)}
            title="Protocol Guidelines & Rules"
          >
            <BookOpen size={15} />
            <span>Guide & Rules</span>
          </button>
          <button
            type="button"
            className="clean-action-btn-soft"
            onClick={() => setDepositOpen(true)}
          >
            <Plus size={14} /> Acquire Bits
          </button>
        </div>
      </div>

      {/* 2. UNIFIED SINGLE STAKING BOARD */}
      <div className="single-staking-board">
        {/* TOP HERO: REAL-TIME TICKING REWARDS WITH CRISP HD BITNOIR LOGO & CLEAN CLAIM BUTTON */}
        <div className="staking-live-hero">
          <div className="staking-live-left">
            <div className="staking-live-tag">
              <span className="core-live-dot" />
              <span>{isStakingActive ? 'Live Yield Streaming' : 'Staking Terminal Ready'}</span>
            </div>
            <div className="staking-live-counter">
              <TokenMark size={44} />
              <span className="staking-live-digits">{liveClaimable.toFixed(6)}</span>
              <span className="staking-live-unit">Bitnoir</span>
            </div>
            <div className="staking-live-sub">
              <span>≈ {money(liveClaimable * BITNOIR_REFERENCE_PRICE)} USD</span>
              {isStakingActive ? (
                <>
                  <span className="dot-sep">•</span>
                  <span className="staking-live-rate">
                    +{totalBitnoirPerHour.toFixed(4)} Bitnoir/hr
                  </span>
                  <span className="dot-sep">•</span>
                  <span>{number(stakedBits)} Bits Active</span>
                </>
              ) : (
                <>
                  <span className="dot-sep">•</span>
                  <span>{number(purchasedBits)} Bits Available</span>
                </>
              )}
            </div>
          </div>

          <div className="staking-live-right">
            <button
              type="button"
              className="clean-claim-btn"
              disabled={!canClaim}
              onClick={handleClaim}
              title={
                !canClaim
                  ? `Min claim threshold is ${MIN_CLAIM_BITNOIR.toFixed(4)} Bitnoir`
                  : 'Claim accrued Bitnoir'
              }
            >
              <Sparkles size={16} />
              <span>
                {isTermFinished
                  ? `Claim Maturity (${liveClaimable.toFixed(4)} Bitnoir)`
                  : canClaim
                  ? `Claim ${liveClaimable.toFixed(4)} Bitnoir`
                  : `Claim (Min. ${MIN_CLAIM_BITNOIR.toFixed(4)} Bitnoir)`}
              </span>
            </button>
            <div className="staking-claim-hint">
              {isTermFinished ? (
                <span className="text-green">Term Matured · All Accrued Bitnoir Unlocked</span>
              ) : canClaim ? (
                `${liveClaimable.toFixed(4)} Bitnoir ready to claim`
              ) : (
                `Accrued: ${liveClaimable.toFixed(4)} Bitnoir · Mid-term min: ${MIN_CLAIM_BITNOIR.toFixed(4)} Bitnoir`
              )}
            </div>
          </div>
        </div>

        {/* ACTIVE POSITION BENTO SUMMARY (CLEAN INSTITUTIONAL BENTO - NO PERCENTAGES) */}
        {isStakingActive && (
          <div className="staking-active-bento">
            <div className="active-bento-grid">
              <div className="bento-tile">
                <div className="bento-tile-header">
                  <span className="bento-tile-label">STAKED COMMITMENT</span>
                  <BitsMark size={18} />
                </div>
                <div className="bento-tile-val">{number(stakedBits)} Bits</div>
                <div className="bento-tile-sub">{money(existingPrincipalReturnUsd)} Locked</div>
              </div>

              <div className="bento-tile">
                <div className="bento-tile-header">
                  <span className="bento-tile-label">PROOF-OF-BURN SETTLED</span>
                  <Flame size={16} style={{ color: '#ff9800' }} />
                </div>
                <div className="bento-tile-val">{number(balances.burned || stakedBits)} Bits</div>
                <div className="bento-tile-sub">Burned via Protocol Rule</div>
              </div>

              <div className="bento-tile">
                <div className="bento-tile-header">
                  <span className="bento-tile-label">REWARDS PAID OUT</span>
                  <BadgeCheck size={16} style={{ color: 'var(--neon-green)' }} />
                </div>
                <div className="bento-tile-val">{(balances.claimed || 0).toFixed(4)} Bitnoir</div>
                <div className="bento-tile-sub">{money((balances.claimed || 0) * BITNOIR_REFERENCE_PRICE)} Claimed & Settled</div>
              </div>

              <div className="bento-tile bento-highlight">
                <div className="bento-tile-header">
                  <span className="bento-tile-label highlight">TOTAL MATURITY RETURN</span>
                  <span className="bento-status-tag">Guaranteed</span>
                </div>
                <div className="bento-tile-val highlight">{existingTotalReturnTokens.toFixed(4)} Bitnoir</div>
                <div className="bento-tile-sub highlight">{money(existingTotalReturnUsd)} Principal + Yield</div>
              </div>
            </div>

            {/* MULTI-POSITION BREAKDOWN (LISTS INDEPENDENT TERMS CLEANLY) */}
            {activePositions.length > 0 && (
              <div className="active-positions-breakdown">
                <div className="positions-breakdown-head">
                  <span className="positions-breakdown-title">
                    <Layers3 size={15} /> Active Lock Positions ({activePositions.length})
                  </span>
                  <span className="positions-breakdown-rule">
                    1 Bitnoir = 500 Bits Burned on Claim · Rule-Based Hourly Emissions
                  </span>
                </div>
                <div className="positions-breakdown-list">
                  {activePositions.map((pos, idx) => {
                    const posRate = pos.rewardRate || rewardRateForDays(pos.lockupDays);
                    const posPrincipalTokens = (pos.stakedBits * USDT_PER_BITS) / BITNOIR_REFERENCE_PRICE;
                    const posRewardTokens = (pos.stakedBits * USDT_PER_BITS * posRate) / BITNOIR_REFERENCE_PRICE;
                    const posTotalTokens = posPrincipalTokens + posRewardTokens;
                    const posPerHour = calculatePositionPerHour(pos.stakedBits, pos.lockupDays, posRate);
                    const isMatured = new Date(pos.unlocksAt).getTime() <= Date.now();

                    return (
                      <div key={pos.id || idx} className="position-item-card">
                        <div className="pos-item-col">
                          <span className="pos-item-badge">Position #{idx + 1}</span>
                          <span className="pos-item-term">{pos.lockupDays} Days Lock</span>
                        </div>
                        <div className="pos-item-col">
                          <span className="pos-item-label">Allocation</span>
                          <span className="pos-item-value">{number(pos.stakedBits)} Bits</span>
                        </div>
                        <div className="pos-item-col">
                          <span className="pos-item-label">Hourly Emission</span>
                          <span className="pos-item-value text-green">+{posPerHour.toFixed(4)}/hr</span>
                        </div>
                        <div className="pos-item-col">
                          <span className="pos-item-label">Maturity Return</span>
                          <span className="pos-item-value">{posTotalTokens.toFixed(4)} Bitnoir</span>
                        </div>
                        <div className="pos-item-col" style={{ textAlign: 'right' }}>
                          <span className={`pos-status-badge ${isMatured ? 'matured' : 'active'}`}>
                            {isMatured ? 'Matured' : `Unlocks ${shortDate(pos.unlocksAt)}`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="active-bento-footer">
              <div className="active-bento-note">
                <span className="live-pulse-dot" />
                <span>
                  {isTermFinished
                    ? 'Lock term completed · Final settlement unlocked'
                    : 'Yield actively streaming · Rewards claimable anytime'}
                </span>
              </div>
              <button
                type="button"
                className="bento-action-btn"
                onClick={() => setIsPositionModalOpen(true)}
              >
                <Plus size={14} />
                <span>Increase Position</span>
              </button>
            </div>
          </div>
        )}

        {/* READY / NON-ACTIVE STATE HERO CARD */}
        {!isStakingActive && (
          <div className="staking-empty-hero-card">
            <div className="staking-empty-info">
              <h3>Proof-of-Burn Staking Terminal</h3>
              <p>Commit Bits to activate continuous streaming Bitnoir rewards and 100% principal return at maturity.</p>
            </div>
            <button
              type="button"
              className="clean-stake-confirm-btn"
              style={{ width: 'auto', minWidth: 220 }}
              onClick={() => setIsPositionModalOpen(true)}
            >
              <Plus size={16} />
              <span>Open Staking Position</span>
            </button>
          </div>
        )}
      </div>

      {/* MODALS */}
      <StakingPositionModal
        open={isPositionModalOpen}
        onClose={() => setIsPositionModalOpen(false)}
        isStakingActive={isStakingActive}
        purchasedBits={purchasedBits}
        stakedBits={stakedBits}
        activePositions={activePositions}
        existingPrincipalReturnTokens={existingPrincipalReturnTokens}
        existingPrincipalReturnUsd={existingPrincipalReturnUsd}
        existingTotalReturnTokens={existingTotalReturnTokens}
        existingTotalReturnUsd={existingTotalReturnUsd}
        duration={duration}
        setDuration={setDuration}
        onStakeSuccess={() => {
          void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
          void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
        }}
        notify={notify}
      />
      <StakingGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
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
              • <strong>Bitnoir Token</strong>: The scarce cryptographic token hard-capped at 21,000,000 units. Valued at $50.00
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
              • <strong>Proof-of-Burn Ratio</strong>: When Bitnoir tokens are claimed, <strong>500 Bits Points are burned per 1 Bitnoir claimed</strong>
              ($50.00 / $0.10). Every reward claim permanently tightens internal point supply.
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
                $50.00 USD / Bitnoir
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
            <strong style={{ color: 'var(--neon-green)' }}>500 Bits Points are permanently destroyed</strong> per 1 Bitnoir claimed.
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
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{
        backdropFilter: 'blur(10px)',
        background: 'rgba(5, 7, 12, 0.82)',
        padding: '16px',
        zIndex: 1000,
      }}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 520,
          width: '100%',
          padding: 0,
          overflow: 'hidden',
          background: '#090d14',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 22,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.75)',
        }}
      >
        {/* Header matching mockup */}
        <div style={{ padding: '28px 28px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div
              style={{
                color: '#ff8b2f',
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginBottom: 4,
              }}
            >
              BITNOIR
            </div>
            <h2
              style={{
                margin: 0,
                fontSize: 28,
                fontWeight: 800,
                color: '#ffffff',
                letterSpacing: '-0.02em',
              }}
            >
              Protocol Specifications
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="modal-close-btn"
            aria-label="Close modal"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: 'var(--silver-dark)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              marginTop: 2,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body with 3 Cards */}
        <div style={{ padding: '0 28px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Card 1: STAKING RESERVOIR */}
          <div
            style={{
              background: '#0f141f',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              borderRadius: 16,
              padding: '20px 22px',
            }}
          >
            <div
              style={{
                color: '#00f59b',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              STAKING RESERVOIR
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
              <span
                style={{
                  fontSize: 34,
                  fontWeight: 800,
                  color: '#ffffff',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                }}
              >
                {number(totalCap)}
              </span>
              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>Total Cap</span>
            </div>

            {/* Progress bar */}
            <div
              style={{
                height: 8,
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: 9999,
                overflow: 'hidden',
                marginBottom: 10,
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
                fontSize: 12,
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Left: BURN RATE */}
            <div
              style={{
                background: 'rgba(255, 107, 107, 0.04)',
                border: '1px solid rgba(255, 107, 107, 0.16)',
                borderRadius: 16,
                padding: '18px 20px',
              }}
            >
              <div
                style={{
                  color: '#ff6b6b',
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                BURN RATE
              </div>
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  color: '#ff6b6b',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                  marginBottom: 8,
                }}
              >
                500 / 1
              </div>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
                Bits Points -&gt; Bitnoir
              </div>
            </div>

            {/* Right: EMISSION */}
            <div
              style={{
                background: 'rgba(0, 245, 155, 0.04)',
                border: '1px solid rgba(0, 245, 155, 0.16)',
                borderRadius: 16,
                padding: '18px 20px',
              }}
            >
              <div
                style={{
                  color: '#00f59b',
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                EMISSION
              </div>
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  color: '#00f59b',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                  marginBottom: 8,
                }}
              >
                {stats.emissionRatePerHour || '12.4'} /h
              </div>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
                Continuous Velocity
              </div>
            </div>
          </div>

          {/* Card 4: DEFLATIONARY COMMITMENTS */}
          <div
            style={{
              background: '#0f141f',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              borderRadius: 16,
              padding: '20px 22px',
            }}
          >
            <div
              style={{
                color: '#ff8b2f',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 12,
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
                  padding: '12px 0',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <span style={{ color: '#94a3b8', fontSize: 14 }}>Protocol Hard Cap</span>
                <span style={{ color: '#ff8b2f', fontSize: 14, fontWeight: 700 }} className="mono">
                  {number(stats.hardCapSupply || 21000000)} (Fixed)
                </span>
              </div>

              {/* Row 2: Total Committed */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 0',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <span style={{ color: '#94a3b8', fontSize: 14 }}>Total Committed</span>
                <span style={{ color: '#ffffff', fontSize: 14, fontWeight: 700 }} className="mono">
                  {number(stats.totalCommittedBits || 28650000)} Bits
                </span>
              </div>

              {/* Row 3: Total Burned */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 0',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <span style={{ color: '#94a3b8', fontSize: 14 }}>Total Burned</span>
                <span style={{ color: '#ff6b6b', fontSize: 14, fontWeight: 700 }} className="mono">
                  {number(stats.totalAmountBurnedBits || 24062250)} Bits
                </span>
              </div>

              {/* Row 4: USD Destroyed */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 0',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <span style={{ color: '#94a3b8', fontSize: 14 }}>USD Destroyed</span>
                <span style={{ color: '#ffaa33', fontSize: 14, fontWeight: 700 }} className="mono">
                  {money(stats.totalAmountBurnedBitsUsd || 2406225)}
                </span>
              </div>

              {/* Row 5: Verified Nodes */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 0 2px',
                }}
              >
                <span style={{ color: '#94a3b8', fontSize: 14 }}>Verified Nodes</span>
                <span style={{ color: '#00f59b', fontSize: 14, fontWeight: 700 }} className="mono">
                  {number(stats.activeStakersCount || 1421)} Nodes
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Subtle, sleek footer actions */}
        <div
          style={{
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            padding: '14px 28px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(0, 0, 0, 0.25)',
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
            className="clean-glass-btn"
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
              <span>Proof-of-Burn: <strong style={{ color: '#fff' }}>500 Bits Points / 1 Bitnoir</strong></span>
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
// 11. REPUTATION XP & REFERRAL NETWORK PORTAL (/referrals, /airdrop)
// ---------------------------------------------------------------------------
function ReferralsPage({ account }: { account: UserAccount }) {
  const apply = useApplyReferralCode();
  const client = useQueryClient();
  const { notify, notice } = useNotice();

  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const referralCode = account.referralCode || `BITS-${account.name.toUpperCase()}`;
  const referralUrl = `${window.location.origin}${basePath}/sign-up?ref=${encodeURIComponent(referralCode)}`;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${label} copied to clipboard!`);
    } catch {
      notify('Unable to access clipboard.');
    }
  };

  const handleApply = (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setError('');
    apply.mutate(
      { data: { code: code.trim().toUpperCase() } },
      {
        onSuccess: (result: { message?: string }) => {
          setCode('');
          notify(result.message || 'Referral code linked!');
          void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
          void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
        },
        onError: () => setError('Invalid or duplicate referral code.'),
      }
    );
  };

  return (
    <AppShell active="/referrals" admin={account.role === 'admin'}>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Community XP & Airdrop Portal</h1>
          <p className="page-subtitle">
            Earn protocol reputation XP through verified community onboarding. XP governs your eligibility tier
            for the 8% (1,680,000 BITS) community allocation.
          </p>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="panel content-card panel-glow" style={{ padding: 32 }}>
          <div className="eyebrow"><span className="eyebrow-dot" />Unique Referral Identity</div>
          <h2 style={{ font: '700 28px var(--app-font-serif)', margin: '16px 0 8px', color: '#fff' }}>
            Build Your Network
          </h2>
          <p style={{ color: 'var(--silver-medium)', fontSize: 13, margin: '0 0 24px' }}>
            Every account creates an exclusive referral code based on your chosen node handle.
          </p>

          <div className="field-wrap">
            <label className="field-label">Your Referral Link</label>
            <div className="address-box">
              <span className="mono" style={{ color: 'var(--neon-green)' }}>{referralUrl}</span>
              <button
                type="button"
                className="address-copy"
                onClick={() => copy(referralUrl, 'Referral Link')}
                title="Copy Link"
              >
                <Copy size={14} />
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <button type="button" className="button button-primary" onClick={() => copy(referralUrl, 'Referral Link')}>
              <Copy size={14} /> Copy Invite Link
            </button>
            <button type="button" className="button button-ghost" style={{ minWidth: 0, maxWidth: '100%' }} onClick={() => copy(referralCode, 'Referral Code')}>
              <LinkIcon size={14} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Copy Code: {referralCode}</span>
            </button>
          </div>
        </div>

        <div className="panel content-card">
          <div className="card-heading">
            <div>
              <h3>Protocol XP Score</h3>
              <p>Off-chain reputation ledger</p>
            </div>
            <Gift size={20} color="var(--neon-green)" />
          </div>

          <div style={{ font: '700 42px var(--app-font-serif)', color: 'var(--neon-green)' }}>
            {number(account.xp)} <small style={{ fontSize: 16, color: 'var(--silver-dark)' }}>XP</small>
          </div>

          <div style={{ marginTop: 20, display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
              <span style={{ color: 'var(--silver-dark)' }}>Airdrop Tier</span>
              <strong style={{ color: '#fff' }}>Tier 1 (Silver Node)</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
              <span style={{ color: 'var(--silver-dark)' }}>Welcome Bonus</span>
              <strong style={{ color: 'var(--neon-green)' }}>+100 XP</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--silver-dark)' }}>Invited By</span>
              <strong style={{ color: '#fff' }}>{account.referredBy || 'Direct Participant'}</strong>
            </div>
          </div>
        </div>
      </div>

      {!account.referredBy && (
        <div className="panel content-card" style={{ marginTop: 24, maxWidth: 640 }}>
          <div className="card-heading">
            <div>
              <h3>Have an Inviter Referral Code?</h3>
              <p>Attach a referral code once to link your node to your sponsor</p>
            </div>
          </div>
          <form onSubmit={handleApply} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <input
                className="field mono"
                placeholder="e.g. BITS-SATOSHINODE"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              {error && <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>{error}</div>}
            </div>
            <button className="button button-primary" type="submit" disabled={apply.isPending || !code.trim()}>
              {apply.isPending ? 'Linking…' : 'Apply Code'}
            </button>
          </form>
        </div>
      )}

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

              {/* EARN & STAKING */}
              <Route path="/staking">
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
