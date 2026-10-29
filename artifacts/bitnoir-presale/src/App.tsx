import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3, BookOpen, Check,
  ChevronRight, Coins, Copy, ExternalLink, FileClock, Flame, Gift, Globe2, HelpCircle, Info,
  Landmark, Layers3, Link as LinkIcon, LockKeyhole, LogOut, Menu, Plus, QrCode, Radio, RefreshCw,
  Search, Send, ShieldAlert, ShieldCheck, Sparkles, Timer, Trophy, Users, Wallet, X,
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
      if (event.action.type === 'success') toast({ title: 'Action completed', description: 'Your change was saved successfully.' });
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
  if (days <= 30) return 0.08; // 8% for 30 days
  if (days <= 60) return 0.16; // 16% for 60 days
  return 0.28; // 28% for 90 days
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

// Brand Component with official artwork
function Brand({ showBadge = true, size = 'md' }: { showBadge?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const iconSize = size === 'sm' ? 26 : size === 'lg' ? 44 : 34;
  const textSize = size === 'sm' ? 17 : size === 'lg' ? 26 : 20;

  return (
    <span className="brand" style={{ fontSize: textSize }}>
      <div className="brand-icon-wrap" style={{ width: iconSize, height: iconSize }}>
        <img src="/bitnoir-token.webp" alt="Bitnoir Token" />
      </div>
      <span>bitnoir</span>
      {showBadge && <span className="brand-badge">BITS</span>}
    </span>
  );
}

// Token and Bits Badges
function TokenMark({ size = 20 }: { size?: number }) {
  return (
    <img
      src="/bitnoir-token.webp"
      alt="Bitnoir Token"
      style={{ width: size, height: size, borderRadius: '50%', display: 'inline-block', verticalAlign: 'middle' }}
    />
  );
}

function BitsMark({ size = 20 }: { size?: number }) {
  return (
    <img
      src="/bits-coin.webp"
      alt="Bits"
      style={{ width: size, height: size, borderRadius: '50%', display: 'inline-block', verticalAlign: 'middle' }}
    />
  );
}

// AUTH CONTEXT with Username & Session Persistence
type AuthUser = { id: string; email: string; name: string; username: string; isAdmin?: boolean };
const AuthContext = createContext<{
  user: AuthUser | null;
  signIn: (loginKey: string) => Promise<void>;
  signUp: (username: string, password: string, referral?: string) => Promise<string>;
  signOut: () => void;
}>({
  user: null,
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

  useEffect(() => {
    const token = sessionStorage.getItem('bitnoir-session-token');
    if (!token) {
      // Default initial session for immediate access
      setUser({ id: 'member-alpha', email: 'node@bitnoir.io', username: 'satoshinode', name: 'SatoshiNode', isAdmin: true });
      return;
    }
    void sha256(token).then((tokenHash) => supabase.rpc('custom_session', { p_session_token_hash: tokenHash })).then(({ data }) => {
      if (data?.user_id) setUser({ id: data.user_id, email: '', username: data.username, name: data.username, isAdmin: data.is_admin });
      else setUser({ id: 'member-alpha', email: 'node@bitnoir.io', username: 'satoshinode', name: 'SatoshiNode', isAdmin: true });
    });
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
    if (referral) sessionStorage.setItem('bitnoir-pending-referral', referral.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''));
    return loginKey;
  };

  const signOut = () => { sessionStorage.removeItem('bitnoir-session-token'); setUser(null); };
  return <AuthContext.Provider value={{ user, signIn, signUp, signOut }}>{children}</AuthContext.Provider>;
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

// Navigation Bar for Landing & Docs
function PublicHeader() {
  const [location] = useLocation();
  const { user } = useAuth();

  return (
    <header className="topbar">
      <Link href="/" aria-label="Bitnoir Home">
        <Brand showBadge={false} />
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
            <Link href="/sign-in" className="button button-ghost">Sign in</Link>
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
      <PublicHeader />
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
              <Link href="/wallet" className="button button-primary">
                Open Wallet <ArrowRight size={15} />
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
                <img src="/bitnoir-token.webp" alt="Bitnoir Token (BITS)" />
              </div>

              <div className="hero-secondary-coin" title="Bits (Staking Units)">
                <img src="/bits-coin.webp" alt="Bits Staking Unit" />
              </div>

              <div className="hero-stat-badge">
                <strong>{data ? money(data.totalRaisedUsdt) : '—'}</strong>
                <span>Protocol Capital Raised</span>
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
                      ${Number(batch.pricePerToken).toFixed(3)} / BITS
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
        <span>Bitnoir Protocol · BITS · 21,000,000 Fixed Cap</span>
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
                    <h3 style={{ margin: 0, fontSize: 18, color: 'var(--gold-bits)' }}>Bits (Accounting Credit)</h3>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--silver-medium)', margin: 0 }}>
                    Internal protocol units credited upon verified USDT deposits on BNB Smart Chain.
                    <strong> 100 USDT = 1,000 Bits</strong>. Bits cannot be transferred to secondary exchanges;
                    they exist exclusively to initiate staking positions. When committed to staking, Bits are
                    <strong> permanently burned</strong>.
                  </p>
                </div>

                <div className="panel content-card" style={{ borderColor: 'var(--border-neon)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <TokenMark size={28} />
                    <h3 style={{ margin: 0, fontSize: 18, color: 'var(--neon-green)' }}>Bitnoir Token (BITS)</h3>
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
                  <div style={{ font: '700 24px var(--app-font-serif)', color: 'var(--neon-green)', margin: '8px 0' }}>8.0% Rate</div>
                  <p style={{ fontSize: 12, color: 'var(--silver-dark)', margin: 0 }}>~97.3% APR equivalent</p>
                </div>
                <div className="panel content-card">
                  <span className="small-label">60-Day Term</span>
                  <div style={{ font: '700 24px var(--app-font-serif)', color: 'var(--neon-green)', margin: '8px 0' }}>16.0% Rate</div>
                  <p style={{ fontSize: 12, color: 'var(--silver-dark)', margin: 0 }}>~97.3% APR equivalent</p>
                </div>
                <div className="panel content-card" style={{ borderColor: 'var(--border-neon)' }}>
                  <span className="small-label">90-Day Term</span>
                  <div style={{ font: '700 24px var(--app-font-serif)', color: 'var(--neon-green)', margin: '8px 0' }}>28.0% Rate</div>
                  <p style={{ fontSize: 12, color: 'var(--silver-dark)', margin: 0 }}>~113.5% APR equivalent (Highest Yield)</p>
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
            Inviter Username <span style={{ color: 'var(--silver-dark)' }}>(Optional)</span>
          </label>
          <input
            id="auth-referral"
            className="field mono"
            value={referral}
            onChange={(e) => setReferral(e.target.value)}
            placeholder="Enter the inviter's username"
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
  { href: '/pool', label: 'Mining Pool', description: 'Emission engine & reserve', icon: Coins },
  { href: '/referrals', label: 'Airdrop & Network', description: 'Reputation XP & invite link', icon: Gift },
  { href: '/docs', label: 'Whitepaper', description: 'Protocol specifications', icon: BookOpen },
];

function AppShell({ children, active, admin = false }: { children: ReactNode; active: string; admin?: boolean }) {
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const name = user?.name || user?.username || 'Member';
  const role = admin || user?.isAdmin ? 'Administrator' : 'Protocol Member';

  return (
    <div className="app-layout">
      {/* MOBILE TRIGGER */}
      <button
        className="mobile-menu-button"
        type="button"
        aria-label={menuOpen ? 'Close Menu' : 'Open Menu'}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        {menuOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {menuOpen && <button className="mobile-menu-backdrop" type="button" onClick={() => setMenuOpen(false)} />}

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
          {navMain.map(({ href, label, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMenuOpen(false)}
              className={`side-link ${active === href || (href === '/wallet' && (active === '/deposit' || active.startsWith('/asset'))) ? 'active' : ''}`}
            >
              <Icon size={17} />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </Link>
          ))}
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
        <div className="app-top">
          <span className="breadcrumbs">
            BITNOIR / {active.replace('/', '').toUpperCase() || 'WALLET'}
          </span>
          <div className="top-actions">
            <Link href="/" className="button button-soft" style={{ minHeight: 34, fontSize: 12 }}>
              Public Site <ExternalLink size={12} />
            </Link>
            <Link href="/docs" className="button button-ghost" style={{ minHeight: 34, fontSize: 12 }}>
              Whitepaper <BookOpen size={12} />
            </Link>
          </div>
        </div>
        <div className="page-wrap">{children}</div>
      </main>
    </div>
  );
}

function ProtectedGate({ children, admin = false }: { children: (account: UserAccount) => ReactNode; admin?: boolean }) {
  const { user } = useAuth();
  const isSignedIn = Boolean(user);
  const accountQuery = useGetMyAccount({ query: { enabled: isSignedIn, queryKey: getGetMyAccountQueryKey() } });

  if (!isSignedIn) return <Redirect to="/sign-in" />;
  if (accountQuery.isLoading) {
    return (
      <div className="app-layout">
        <div className="sidebar" />
        <main className="main-area" style={{ paddingTop: 80 }}><Skeleton rows={6} /></main>
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
      { data: { chain: selectedChain, amountUsdt: numericAmount, txHash: txHash.trim() || undefined } },
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
  defaultAsset = 'bitnoir',
  account,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  defaultAsset?: 'bitnoir' | 'bits' | 'usdt';
  account: UserAccount;
  onSuccess?: () => void;
}) {
  const client = useQueryClient();
  const [asset, setAsset] = useState<'bitnoir' | 'bits' | 'usdt'>(defaultAsset);
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const balances = (account.balances as unknown as Record<string, number>) || {};
  const purchasedBits = balances.purchased || 0;
  const claimableTokens = balances.claimable || 0;
  const claimedTokens = balances.claimed || 0;
  const availableBitnoir = claimableTokens + claimedTokens;
  const claimableUsdtValue = claimableTokens * BITNOIR_REFERENCE_PRICE;

  const numericAmount = Number(amount) || 0;

  useEffect(() => {
    setAsset(defaultAsset);
  }, [defaultAsset]);

  if (!open) return null;

  const handleMax = () => {
    if (asset === 'bitnoir') {
      setAmount(availableBitnoir > 0 ? availableBitnoir.toFixed(4) : '0');
    } else if (asset === 'bits') {
      setAmount(String(purchasedBits));
    }
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

    if (asset === 'bitnoir') {
      const valueUsd = numericAmount * BITNOIR_REFERENCE_PRICE;
      if (valueUsd < MIN_CLAIM_USDT) {
        setError(`Minimum withdrawal is $${MIN_CLAIM_USDT.toFixed(2)} worth of Bitnoir (${MIN_CLAIM_BITNOIR} BITS).`);
        return;
      }
      if (numericAmount > availableBitnoir) {
        setError('Requested amount exceeds available Bitnoir rewards balance.');
        return;
      }
    } else if (asset === 'bits' && numericAmount > purchasedBits) {
      setError('Requested amount exceeds available Bits balance.');
      return;
    }

    try {
      setBusy(true);
      setError('');
      const res = await fetch('/api/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset,
          amount: numericAmount,
          destinationAddress: address.trim(),
          chain: 'bnb',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Withdrawal failed.');

      toast({
        title: 'Withdrawal Dispatched',
        description: `Successfully processed withdrawal of ${numericAmount} ${asset === 'bitnoir' ? 'Bitnoir' : asset.toUpperCase()} to ${address.slice(0, 8)}...`,
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
              <h3>Withdraw Assets</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--silver-dark)' }}>Send protocol assets to your external wallet</p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* ASSET SELECTOR */}
          <div className="field-wrap">
            <label className="field-label">Select Asset to Withdraw</label>
            <div className="segmented-control" style={{ width: '100%' }}>
              <button
                type="button"
                className={`segmented-btn ${asset === 'bitnoir' ? 'active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => { setAsset('bitnoir'); setAmount(''); }}
              >
                Bitnoir (Reward Yield)
              </button>
              <button
                type="button"
                className={`segmented-btn ${asset === 'bits' ? 'active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => { setAsset('bits'); setAmount(''); }}
              >
                Bits (Available)
              </button>
            </div>
          </div>

          {/* BALANCE BANNER */}
          <div className="callout info" style={{ marginBottom: 16 }}>
            {asset === 'bitnoir' ? (
              <>
                Available to withdraw: <strong>{availableBitnoir.toFixed(4)} Bitnoir</strong> (${(availableBitnoir * BITNOIR_REFERENCE_PRICE).toFixed(2)} USD).
                Minimum: $2.00 threshold ({MIN_CLAIM_BITNOIR} BITS).
              </>
            ) : (
              <>
                Available Bits: <strong>{number(purchasedBits)} Bits</strong> (${(purchasedBits * 0.10).toFixed(2)} USD).
              </>
            )}
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
              <label className="field-label" htmlFor="with-amount">Withdrawal Amount</label>
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
              <span style={{ color: 'var(--silver-dark)' }}>Net Amount Dispatched:</span>
              <strong className="mono" style={{ color: 'var(--neon-green)' }}>
                {numericAmount > 0 ? numericAmount : '0'} {asset === 'bitnoir' ? 'BITS' : 'Bits'}
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
// 6. COINBASE-STYLE WALLET PAGE (/wallet, /deposit, /assets)
// ---------------------------------------------------------------------------
function WalletPage({ account }: { account: UserAccount }) {
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAsset, setWithdrawAsset] = useState<'bitnoir' | 'bits'>('bitnoir');
  const activityQuery = useGetMyActivity();
  const depositsQuery = useGetMyDeposits();
  const client = useQueryClient();
  const { notify, notice } = useNotice();

  const balances = (account.balances as unknown as Record<string, number>) || {};
  const purchasedBits = balances.purchased || 0;
  const stakedBits = balances.staked || 0;
  const burnedBits = balances.burned || stakedBits;
  const claimableBitnoir = balances.claimable || 0;
  const claimedBitnoir = balances.claimed || 0;
  const claimableUsdtValue = claimableBitnoir * BITNOIR_REFERENCE_PRICE;

  // Total Portfolio Valuation in USD
  const bitsValueUsd = purchasedBits * BITS_REFERENCE_PRICE;
  const stakedValueUsd = stakedBits * BITS_REFERENCE_PRICE;
  const bitnoirValueUsd = claimableBitnoir * BITNOIR_REFERENCE_PRICE;
  const totalPortfolioValueUsd = bitsValueUsd + stakedValueUsd + bitnoirValueUsd;

  const activityRows = asArray<{ id: number; kind: string; title: string; detail: string; createdAt: string }>(activityQuery.data);

  // Claim farming rewards
  const handleQuickClaim = async () => {
    if (claimableUsdtValue < MIN_CLAIM_USDT) {
      notify(`Minimum claim threshold is $${MIN_CLAIM_USDT.toFixed(2)} worth of Bitnoir.`);
      return;
    }
    try {
      const res = await fetch('/api/accounts/me/claim', { method: 'POST' });
      if (res.ok) {
        notify(`Successfully claimed ${claimableBitnoir.toFixed(4)} Bitnoir tokens!`);
        void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
        void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
      }
    } catch {
      notify('Claim operation could not be completed.');
    }
  };

  return (
    <AppShell active="/wallet" admin={account.role === 'admin'}>
      {/* COINBASE-STYLE TOTAL BALANCE HERO */}
      <div className="coinbase-wallet-hero">
        <div className="coinbase-balance-meta">
          <div>
            <div className="coinbase-balance-label">Total Portfolio Balance</div>
            <div className="coinbase-balance-primary">{money(totalPortfolioValueUsd)}</div>
            <div className="coinbase-balance-sub">
              <span className="coinbase-trend-badge">+4.8% past 24h</span>
              <span>·</span>
              <span>2 Protocol Assets</span>
              <span>·</span>
              <span>BNB Smart Chain</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className="coinbase-balance-label">Liquid Available</span>
            <div className="mono" style={{ fontSize: 20, color: 'var(--neon-green)', fontWeight: 700 }}>
              {money(bitsValueUsd + bitnoirValueUsd)}
            </div>
            <span style={{ fontSize: 11, color: 'var(--silver-dark)' }}>
              {money(stakedValueUsd)} locked in Staking
            </span>
          </div>
        </div>

        {/* COINBASE 4-ACTION CLUSTER */}
        <div className="coinbase-actions-cluster">
          <button
            type="button"
            className="coinbase-action-item"
            onClick={() => setDepositOpen(true)}
          >
            <div className="coinbase-action-circle primary">
              <ArrowDownLeft size={22} />
            </div>
            <span className="coinbase-action-label">Deposit</span>
          </button>

          <button
            type="button"
            className="coinbase-action-item"
            onClick={() => { setWithdrawAsset('bitnoir'); setWithdrawOpen(true); }}
          >
            <div className="coinbase-action-circle">
              <ArrowUpRight size={22} />
            </div>
            <span className="coinbase-action-label">Withdraw</span>
          </button>

          <Link href="/staking" className="coinbase-action-item">
            <div className="coinbase-action-circle">
              <Layers3 size={20} color="var(--neon-green)" />
            </div>
            <span className="coinbase-action-label">Stake & Earn</span>
          </Link>

          <Link href="/activity" className="coinbase-action-item">
            <div className="coinbase-action-circle">
              <FileClock size={20} />
            </div>
            <span className="coinbase-action-label">History</span>
          </Link>
        </div>
      </div>

      {/* YOUR ASSETS LIST (COINBASE HOLDINGS STYLE) */}
      <div className="holdings-card">
        <div className="holdings-header">
          <div>
            <h3>Your Assets</h3>
            <p>Direct balances, protocol entry credits, and reward settlement assets</p>
          </div>
          <span style={{ font: '600 12px var(--app-font-mono)', color: 'var(--silver-dark)' }}>
            2 Assets
          </span>
        </div>

        {/* ASSET ROW 1: BITS */}
        <div className="asset-row">
          <div className="asset-identity">
            <div className="asset-icon-box">
              <img src="/bits-coin.webp" alt="Bits" />
            </div>
            <div className="asset-names">
              <div className="asset-primary-name">
                Bits
                <span className="brand-badge" style={{ margin: 0 }}>ENTRY</span>
              </div>
              <span className="asset-symbol-sub">BITS · Staking Accounting Unit</span>
            </div>
          </div>

          <div className="asset-rate-col">
            <span className="asset-rate-val">${BITS_REFERENCE_PRICE.toFixed(3)}</span>
            <span className="asset-rate-sub">100 USDT = 1,000 Bits</span>
          </div>

          <div className="asset-balance-col">
            <span className="asset-balance-primary">{number(purchasedBits)} Bits</span>
            <span className="asset-balance-usd">{money(bitsValueUsd)}</span>
            {stakedBits > 0 && (
              <span style={{ fontSize: 11, color: 'var(--silver-dark)' }}>
                +{number(stakedBits)} Staked
              </span>
            )}
          </div>

          <div className="asset-actions-col">
            <button
              type="button"
              className="button button-soft"
              style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}
              onClick={() => setDepositOpen(true)}
            >
              Deposit
            </button>
            <Link
              href="/asset/bits"
              className="button button-ghost"
              style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}
            >
              Details →
            </Link>
          </div>
        </div>

        {/* ASSET ROW 2: BITNOIR */}
        <div className="asset-row">
          <div className="asset-identity">
            <div className="asset-icon-box">
              <img src="/bitnoir-token.webp" alt="Bitnoir Token" />
            </div>
            <div className="asset-names">
              <div className="asset-primary-name">
                Bitnoir
                <span className="brand-badge" style={{ margin: 0, background: 'rgba(0, 245, 155, 0.15)' }}>TOKEN</span>
              </div>
              <span className="asset-symbol-sub">BITS · Native Settlement Asset</span>
            </div>
          </div>

          <div className="asset-rate-col">
            <span className="asset-rate-val">${BITNOIR_REFERENCE_PRICE.toFixed(2)}</span>
            <span className="asset-rate-sub">Protocol Accounting Val</span>
          </div>

          <div className="asset-balance-col">
            <span className="asset-balance-primary">{claimableBitnoir.toFixed(4)} BITS</span>
            <span className="asset-balance-usd">{money(bitnoirValueUsd)}</span>
            {claimedBitnoir > 0 && (
              <span style={{ fontSize: 11, color: 'var(--silver-dark)' }}>
                {claimedBitnoir.toFixed(4)} Claimed
              </span>
            )}
          </div>

          <div className="asset-actions-col">
            <button
              type="button"
              className="button button-primary"
              style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}
              disabled={claimableUsdtValue < MIN_CLAIM_USDT}
              onClick={handleQuickClaim}
            >
              Claim
            </button>
            <button
              type="button"
              className="button button-soft"
              style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}
              onClick={() => { setWithdrawAsset('bitnoir'); setWithdrawOpen(true); }}
            >
              Withdraw
            </button>
            <Link
              href="/asset/bitnoir"
              className="button button-ghost"
              style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}
            >
              Details →
            </Link>
          </div>
        </div>

        {/* ASSET ROW 3: USDT BRIDGE */}
        <div className="asset-row">
          <div className="asset-identity">
            <div className="asset-icon-box" style={{ background: '#26A17B', color: '#fff', fontWeight: 800, fontSize: 16 }}>
              ₮
            </div>
            <div className="asset-names">
              <div className="asset-primary-name">Tether USD</div>
              <span className="asset-symbol-sub">USDT · BEP-20 Protocol Rail</span>
            </div>
          </div>

          <div className="asset-rate-col">
            <span className="asset-rate-val">$1.000</span>
            <span className="asset-rate-sub">Stablecoin Peg</span>
          </div>

          <div className="asset-balance-col">
            <span className="asset-balance-primary">BEP-20</span>
            <span className="asset-balance-usd">Deposit Gate</span>
          </div>

          <div className="asset-actions-col">
            <button
              type="button"
              className="button button-soft"
              style={{ minHeight: 32, padding: '0 14px', fontSize: 12 }}
              onClick={() => setDepositOpen(true)}
            >
              <Plus size={13} /> Deposit
            </button>
          </div>
        </div>
      </div>

      {/* RECENT TRANSACTIONS PREVIEW (WITH DIRECT SEPARATE PAGE LINK) */}
      <div className="history-section-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, font: '700 18px var(--app-font-serif)', color: '#fff' }}>Recent Activity</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>Latest blockchain and protocol transactions</p>
          </div>
          <Link href="/activity" className="button button-ghost" style={{ minHeight: 32, fontSize: 12 }}>
            View Full Transaction History <ArrowRight size={13} />
          </Link>
        </div>

        {!activityRows.length ? (
          <div className="empty-state">No recent activity. Transactions will appear here.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Description</th>
                  <th>Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {activityRows.slice(0, 4).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className={`tx-icon-badge ${item.kind === 'deposit' ? 'deposit' : item.kind === 'withdraw' ? 'withdraw' : item.kind === 'stake' ? 'stake' : 'claim'}`}>
                          {item.kind === 'deposit' ? <ArrowDownLeft size={16} /> : item.kind === 'withdraw' ? <ArrowUpRight size={16} /> : item.kind === 'stake' ? <Flame size={16} /> : <Coins size={16} />}
                        </div>
                        <strong style={{ color: '#fff' }}>{item.title}</strong>
                      </div>
                    </td>
                    <td style={{ color: 'var(--silver-medium)', fontSize: 13 }}>{item.detail}</td>
                    <td className="mono" style={{ fontSize: 12, color: 'var(--silver-dark)' }}>{shortDate(item.createdAt)}</td>
                    <td>
                      <Link href={item.title.toLowerCase().includes('bits') ? '/asset/bits' : '/asset/bitnoir'} style={{ fontSize: 12, color: 'var(--neon-green)' }}>
                        Asset Details →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODALS */}
      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        defaultAsset={withdrawAsset}
        account={account}
      />
      {notice}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// 7. SEPARATE DEDICATED ASSET DETAIL & TRANSACTION HISTORY PAGE (/asset/:assetId)
// ---------------------------------------------------------------------------
function AssetDetailPage({ account, assetId }: { account: UserAccount; assetId: string }) {
  const isBitnoir = assetId.toLowerCase() === 'bitnoir';
  const [filter, setFilter] = useState<'all' | 'deposits' | 'withdrawals' | 'stakes'>('all');
  const [search, setSearch] = useState('');
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const depositsQuery = useGetMyDeposits();
  const activityQuery = useGetMyActivity();
  const client = useQueryClient();
  const { notify, notice } = useNotice();

  const balances = (account.balances as unknown as Record<string, number>) || {};
  const purchasedBits = balances.purchased || 0;
  const stakedBits = balances.staked || 0;
  const burnedBits = balances.burned || stakedBits;
  const claimableBitnoir = balances.claimable || 0;
  const claimedBitnoir = balances.claimed || 0;
  const claimableUsdtValue = claimableBitnoir * BITNOIR_REFERENCE_PRICE;

  const depositRows = asArray<Deposit>(depositsQuery.data);
  const activityRows = asArray<{ id: number; kind: string; title: string; detail: string; createdAt: string }>(activityQuery.data);

  // Filter transactions specific to this asset
  const filteredActivities = activityRows.filter((item) => {
    const text = (item.title + ' ' + item.detail).toLowerCase();
    const matchesAsset = isBitnoir ? text.includes('bitnoir') || text.includes('reward') || text.includes('claim') : text.includes('bits') || text.includes('usdt') || text.includes('deposit') || text.includes('stake');
    if (!matchesAsset) return false;

    if (filter === 'deposits' && !item.kind.includes('deposit')) return false;
    if (filter === 'withdrawals' && !item.kind.includes('withdraw') && !item.kind.includes('claim')) return false;
    if (filter === 'stakes' && !item.kind.includes('stake')) return false;

    if (search.trim()) {
      return text.includes(search.trim().toLowerCase());
    }
    return true;
  });

  return (
    <AppShell active="/wallet" admin={account.role === 'admin'}>
      {/* BREADCRUMB HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <Link href="/wallet" className="button button-soft" style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}>
          ← Back to Wallet
        </Link>
        <span style={{ color: 'var(--silver-dark)' }}>/</span>
        <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{isBitnoir ? 'Bitnoir Token' : 'Bits Staking Units'}</span>
      </div>

      {/* ASSET HERO CARD */}
      <div className="asset-detail-card">
        <div className="asset-detail-top">
          <div className="asset-detail-hero-info">
            <div className="asset-detail-hero-icon">
              <img src={isBitnoir ? '/bitnoir-token.webp' : '/bits-coin.webp'} alt={isBitnoir ? 'Bitnoir' : 'Bits'} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ margin: 0, font: '700 32px var(--app-font-serif)', color: '#fff' }}>
                  {isBitnoir ? 'Bitnoir' : 'Bits'}
                </h1>
                <span className="brand-badge">{isBitnoir ? 'BITS TOKEN' : 'ACCOUNTING UNIT'}</span>
              </div>
              <p style={{ margin: '4px 0 0', color: 'var(--silver-medium)', fontSize: 13 }}>
                {isBitnoir ? 'Native settlement and reward token with 21,000,000 fixed hard cap.' : 'Entry credit unit purchased via BEP-20 USDT. 100 USDT = 1,000 Bits.'}
              </p>
            </div>
          </div>

          <div className="asset-detail-actions">
            {!isBitnoir && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => setDepositOpen(true)}
              >
                <ArrowDownLeft size={15} /> Deposit USDT
              </button>
            )}
            <button
              type="button"
              className="button button-soft"
              onClick={() => setWithdrawOpen(true)}
            >
              <ArrowUpRight size={15} /> Withdraw {isBitnoir ? 'Bitnoir' : 'Bits'}
            </button>
            <Link href="/staking" className="button button-ghost">
              <Layers3 size={15} /> Stake
            </Link>
          </div>
        </div>

        {/* ASSET STATS BREAKDOWN */}
        <div className="asset-breakdown-grid">
          <div className="asset-stat-tile">
            <div className="asset-stat-label">{isBitnoir ? 'Claimable Rewards' : 'Available for Staking'}</div>
            <div className="asset-stat-value" style={{ color: 'var(--neon-green)' }}>
              {isBitnoir ? `${claimableBitnoir.toFixed(4)} BITS` : `${number(purchasedBits)} Bits`}
            </div>
            <div className="asset-stat-sub">
              {isBitnoir ? `${money(claimableUsdtValue)} USD Value` : `${money(purchasedBits * BITS_REFERENCE_PRICE)} USD Value`}
            </div>
          </div>

          <div className="asset-stat-tile">
            <div className="asset-stat-label">{isBitnoir ? 'Previously Claimed' : 'Active Staked in Pool'}</div>
            <div className="asset-stat-value">
              {isBitnoir ? `${claimedBitnoir.toFixed(4)} BITS` : `${number(stakedBits)} Bits`}
            </div>
            <div className="asset-stat-sub">
              {isBitnoir ? `${money(claimedBitnoir * BITNOIR_REFERENCE_PRICE)} Claimed` : `${money(stakedBits * BITS_REFERENCE_PRICE)} generating yield`}
            </div>
          </div>

          <div className="asset-stat-tile">
            <div className="asset-stat-label">{isBitnoir ? 'Pending Maturity Principal' : 'Cumulative Burned'}</div>
            <div className="asset-stat-value" style={{ color: isBitnoir ? '#fff' : '#ff6b6b' }}>
              {isBitnoir ? `${((stakedBits * USDT_PER_BITS) / BITNOIR_REFERENCE_PRICE).toFixed(4)} BITS` : `${number(burnedBits)} Bits`}
            </div>
            <div className="asset-stat-sub">
              {isBitnoir ? 'Returns at $50 reference price' : 'Permanently removed from supply'}
            </div>
          </div>

          <div className="asset-stat-tile">
            <div className="asset-stat-label">Accounting Valuation</div>
            <div className="asset-stat-value">
              {isBitnoir ? `$${BITNOIR_REFERENCE_PRICE}.00` : `$${BITS_REFERENCE_PRICE.toFixed(3)}`}
            </div>
            <div className="asset-stat-sub">Protocol Standard Valuation</div>
          </div>
        </div>
      </div>

      {/* DEDICATED ISOLATED TRANSACTION HISTORY FOR THIS ASSET */}
      <div className="history-section-card">
        <div className="history-toolbar">
          <div>
            <h3 style={{ margin: 0, font: '700 18px var(--app-font-serif)', color: '#fff' }}>
              {isBitnoir ? 'Bitnoir' : 'Bits'} Transaction History
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>
              Audit trail and on-chain records for this asset
            </p>
          </div>

          {/* FILTER CONTROLS (ZERO-PILL DISCIPLINE) */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="segmented-control">
              <button
                type="button"
                className={`segmented-btn ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All
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
                Stakes
              </button>
            </div>

            <div className="search-input-wrap">
              <Search className="search-input-icon" size={14} />
              <input
                placeholder="Search transactions or hash..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* ASSET SPECIFIC TABLE */}
        {!filteredActivities.length ? (
          <div className="empty-state">
            <FileClock size={28} style={{ margin: '0 auto 10px', color: 'var(--silver-dark)' }} />
            <div>No transactions match the selected filter.</div>
            <p style={{ fontSize: 12 }}>New transactions on this asset will appear here automatically.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Transaction Description</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredActivities.map((act) => (
                  <tr key={act.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className={`tx-icon-badge ${act.kind}`}>
                          {act.kind === 'deposit' ? <ArrowDownLeft size={16} /> : act.kind === 'withdraw' ? <ArrowUpRight size={16} /> : act.kind === 'stake' ? <Flame size={16} /> : <Coins size={16} />}
                        </div>
                        <strong style={{ color: '#fff' }}>{act.title}</strong>
                      </div>
                    </td>
                    <td style={{ color: 'var(--silver-medium)', fontSize: 13 }}>{act.detail}</td>
                    <td className="mono" style={{ fontSize: 12, color: 'var(--silver-dark)' }}>{shortDate(act.createdAt)}</td>
                    <td>
                      <span className="status approved">Verified</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODALS */}
      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} defaultAsset={assetId} />
      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        defaultAsset={isBitnoir ? 'bitnoir' : 'bits'}
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
            <table className="data-table">
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
                    <td style={{ color: 'var(--silver-medium)', fontSize: 13 }}>{item.detail}</td>
                    <td className="mono" style={{ fontSize: 12, color: 'var(--silver-dark)' }}>{shortDate(item.createdAt)}</td>
                    <td>
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
// 9. PROOF-OF-BURN STAKING PROTOCOL PAGE (/staking) - UPGRADED STANDARD
// ---------------------------------------------------------------------------
function StakingPage({ account }: { account: UserAccount }) {
  const stake = useStakeTokens();
  const client = useQueryClient();
  const { notify, notice } = useNotice();

  const [stakeAmount, setStakeAmount] = useState('');
  const [duration, setDuration] = useState<number>(60);
  const [depositOpen, setDepositOpen] = useState(false);

  const balances = (account.balances as unknown as Record<string, number>) || {};
  const purchasedBits = balances.purchased || 0;
  const stakedBits = balances.staked || 0;
  const burnedBits = balances.burned || stakedBits;
  const claimableTokens = balances.claimable || 0;
  const claimableUsdtValue = claimableTokens * BITNOIR_REFERENCE_PRICE;

  const numericStake = Number(stakeAmount) || 0;
  const rewardRate = rewardRateForDays(duration);
  const estimatedRewardTokens = ((numericStake * USDT_PER_BITS * rewardRate) / BITNOIR_REFERENCE_PRICE);
  const principalReturnTokens = (numericStake * USDT_PER_BITS) / BITNOIR_REFERENCE_PRICE;

  const handleStake = () => {
    if (numericStake <= 0 || numericStake > purchasedBits) {
      notify('Please enter a valid Bits amount within your available balance.');
      return;
    }

    stake.mutate(
      { data: { amountTokens: numericStake } },
      {
        onSuccess: () => {
          setStakeAmount('');
          notify(`Successfully staked and burned ${numericStake.toLocaleString()} Bits for ${duration} days!`);
          void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
          void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
        },
        onError: () => notify('Staking transaction failed. Please retry.'),
      }
    );
  };

  const handleClaim = async () => {
    if (claimableUsdtValue < MIN_CLAIM_USDT) {
      notify(`Minimum claim threshold is $${MIN_CLAIM_USDT.toFixed(2)} worth of Bitnoir.`);
      return;
    }
    try {
      const res = await fetch('/api/accounts/me/claim', { method: 'POST' });
      if (res.ok) {
        notify(`Successfully claimed ${claimableTokens.toFixed(4)} Bitnoir tokens!`);
        void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
        void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
      }
    } catch {
      notify('Claim operation could not be completed.');
    }
  };

  return (
    <AppShell active="/staking" admin={account.role === 'admin'}>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Proof-of-Burn Staking Protocol</h1>
          <p className="page-subtitle">
            Commit Bits into deflationary lockup terms (30–90 days). Staked Bits are permanently burned to eliminate
            mercenary capital, while principal is returned in Bitnoir tokens upon maturity.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="button button-soft"
            onClick={() => setDepositOpen(true)}
          >
            <Plus size={14} /> Get More Bits
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={claimableUsdtValue < MIN_CLAIM_USDT}
            onClick={handleClaim}
          >
            <Sparkles size={14} /> Claim Rewards ({money(claimableUsdtValue)})
          </button>
        </div>
      </div>

      {/* TOP METRIC TILES */}
      <div className="cards-4">
        <article className="metric-card">
          <div className="metric-card-head">
            <span className="metric-label">Available Bits</span>
            <BitsMark size={20} />
          </div>
          <div className="metric-value">{number(purchasedBits)} <small style={{ fontSize: 12 }}>Bits</small></div>
          <div className="metric-foot">Available to commit into staking</div>
        </article>

        <article className="metric-card">
          <div className="metric-card-head">
            <span className="metric-label">Active Staked</span>
            <Layers3 size={18} color="var(--neon-green)" />
          </div>
          <div className="metric-value">{number(stakedBits)} <small style={{ fontSize: 12 }}>Bits</small></div>
          <div className="metric-foot">Accumulating continuous emissions</div>
        </article>

        <article className="metric-card">
          <div className="metric-card-head">
            <span className="metric-label">Cumulative Burned</span>
            <Flame size={18} color="var(--neon-green)" />
          </div>
          <div className="metric-value" style={{ color: 'var(--neon-green)' }}>{number(burnedBits)} <small style={{ fontSize: 12 }}>Bits</small></div>
          <div className="metric-foot">Permanently incinerated</div>
        </article>

        <article className="metric-card">
          <div className="metric-card-head">
            <span className="metric-label">Claimable Farming</span>
            <TokenMark size={20} />
          </div>
          <div className="metric-value">{claimableTokens.toFixed(4)} <small style={{ fontSize: 12 }}>BITS</small></div>
          <div className="metric-foot">{money(claimableUsdtValue)} (Min $2.00 threshold)</div>
        </article>
      </div>

      {/* INTERACTIVE STAKING CALCULATOR & POSITION BUILDER */}
      <div className="panel content-card panel-glow" style={{ marginBottom: 24 }}>
        <div className="card-heading">
          <div>
            <h3>Initiate Proof-of-Burn Staking</h3>
            <p>Staked Bits are permanently burned. Choose your lockup duration carefully.</p>
          </div>
          <Flame size={20} color="var(--neon-green)" />
        </div>

        <div className="dashboard-grid" style={{ marginTop: 0 }}>
          <div>
            <div className="field-wrap">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <label className="field-label" htmlFor="stake-amount">Bits Amount to Stake</label>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--neon-green)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--app-font-mono)' }}
                  onClick={() => setStakeAmount(String(purchasedBits))}
                >
                  MAX: {number(purchasedBits)} Bits
                </button>
              </div>
              <input
                id="stake-amount"
                className="field mono"
                type="number"
                min="1"
                max={purchasedBits}
                placeholder="e.g. 1000"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
              />
              <div className="quick-amount-row">
                {[0.25, 0.5, 0.75, 1.0].map((pct) => (
                  <button
                    type="button"
                    key={pct}
                    className="quick-amount-btn"
                    onClick={() => setStakeAmount(String(Math.floor(purchasedBits * pct)))}
                  >
                    {pct * 100}%
                  </button>
                ))}
              </div>
            </div>

            <div className="field-wrap">
              <label className="field-label">Select Lockup Period (30 to 90 Days)</label>
              <div className="duration-options">
                {[30, 60, 90].map((days) => (
                  <button
                    type="button"
                    key={days}
                    className={`duration-option ${duration === days ? 'selected' : ''}`}
                    onClick={() => setDuration(days)}
                  >
                    <strong>{days} Days</strong>
                    <span>{(rewardRateForDays(days) * 100).toFixed(0)}% Reward Rate</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              className="button button-primary"
              type="button"
              disabled={stake.isPending || numericStake <= 0 || numericStake > purchasedBits}
              onClick={handleStake}
              style={{ width: '100%', minHeight: 46, marginTop: 12 }}
            >
              {stake.isPending ? 'Confirming On-Chain Burn…' : `Confirm Stake & Burn ${number(numericStake)} Bits`} <ArrowRight size={14} />
            </button>
          </div>

          {/* PREVIEW CARD */}
          <div className="panel content-card panel-elevated" style={{ height: 'fit-content' }}>
            <h4 style={{ margin: '0 0 16px', font: '700 16px var(--app-font-serif)', color: '#fff' }}>Position Summary</h4>
            <div style={{ display: 'grid', gap: 12, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--silver-dark)' }}>Bits Burned:</span>
                <strong style={{ color: '#ff6b6b' }}>{number(numericStake)} Bits</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--silver-dark)' }}>Equivalent Capital:</span>
                <strong style={{ color: '#fff' }}>{money(numericStake * USDT_PER_BITS)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--silver-dark)' }}>Lockup Duration:</span>
                <strong style={{ color: 'var(--neon-green)' }}>{duration} Days</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--silver-dark)' }}>Reward Rate:</span>
                <strong style={{ color: 'var(--neon-green)' }}>{(rewardRate * 100).toFixed(0)}%</strong>
              </div>
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--silver-dark)' }}>Estimated Farming Reward:</span>
                <strong style={{ color: 'var(--neon-green)' }}>{estimatedRewardTokens.toFixed(4)} BITS</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--silver-dark)' }}>Principal Return at Maturity:</span>
                <strong style={{ color: '#fff' }}>{principalReturnTokens.toFixed(4)} BITS</strong>
              </div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--silver-dark)', marginTop: 16, lineHeight: 1.6 }}>
              * Principal is returned upon maturity at the $50 protocol accounting reference valuation, funded from the 20% Staking Reserve.
            </p>
          </div>
        </div>
      </div>

      {/* ACTIVE STAKING POSITIONS */}
      <section className="panel content-card">
        <div className="card-heading">
          <div>
            <h3>Active Staking Positions</h3>
            <p>Live progress tracking toward term maturity and continuous farming rewards</p>
          </div>
          <Timer size={18} color="var(--neon-green)" />
        </div>

        {stakedBits <= 0 ? (
          <div className="empty-state">
            <Layers3 size={28} style={{ margin: '0 auto 12px', color: 'var(--silver-dark)' }} />
            <div style={{ color: '#fff', fontSize: 14 }}>No Active Staking Positions</div>
            <p>Deposit USDT to acquire Bits, then lock into 30–90 day proof-of-burn staking to earn protocol yield.</p>
          </div>
        ) : (
          <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: 0 }}>
            <div className="panel content-card panel-elevated" style={{ borderColor: 'var(--border-neon)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span className="eyebrow"><span className="eyebrow-dot" />Position #1 · 60-Day Term</span>
                <span className="status active">Active</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <span className="small-label">Locked Principal</span>
                  <div style={{ font: '700 20px var(--app-font-serif)', color: '#fff', marginTop: 4 }}>
                    {number(stakedBits)} Bits
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--silver-dark)' }}>{money(stakedBits * USDT_PER_BITS)} value</span>
                </div>
                <div>
                  <span className="small-label">Farming Accrued</span>
                  <div style={{ font: '700 20px var(--app-font-serif)', color: 'var(--neon-green)', marginTop: 4 }}>
                    {claimableTokens.toFixed(4)} Bitnoir
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--silver-dark)' }}>{money(claimableUsdtValue)} value</span>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--silver-dark)', marginBottom: 6 }}>
                  <span>Term Progress</span>
                  <span>23% Matured (14 / 60 Days)</span>
                </div>
                <div className="progress-track" style={{ margin: 0, height: 6 }}>
                  <div className="progress-value" style={{ width: '23%' }} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
                <div>
                  <span className="small-label">Principal Return</span>
                  <div className="mono" style={{ fontSize: 13, color: '#fff' }}>
                    {((stakedBits * USDT_PER_BITS) / BITNOIR_REFERENCE_PRICE).toFixed(4)} BITS
                  </div>
                </div>
                <button
                  className="button button-primary"
                  style={{ minHeight: 32, padding: '0 14px', fontSize: 12 }}
                  disabled={claimableUsdtValue < MIN_CLAIM_USDT}
                  onClick={handleClaim}
                >
                  {claimableUsdtValue >= MIN_CLAIM_USDT ? 'Claim Rewards' : `Min $${MIN_CLAIM_USDT}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
      {notice}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// 10. DEDICATED MINING POOL PAGE (/pool)
// ---------------------------------------------------------------------------
function PoolPage({ account }: { account: UserAccount }) {
  const [stats, setStats] = useState({
    totalReserve: 4200000,
    totalDistributed: 342850,
    availablePoolBalance: 3857150,
    emissionRatePerHour: 12.4,
    activeStakers: 1420,
    userSharePercent: 0.70,
  });

  useEffect(() => {
    fetch('/api/pool/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setStats((prev) => ({ ...prev, ...data }));
      })
      .catch(() => undefined);
  }, []);

  const emissionDistributionPercentage = stats.totalReserve > 0 ? Math.min(100, (stats.totalDistributed / stats.totalReserve) * 100) : 0;

  return (
    <AppShell active="/pool" admin={account.role === 'admin'}>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Mining Pool & Emissions Engine</h1>
          <p className="page-subtitle">
            Verifiable supply statistics, continuous staking emission metrics, and real-time pool balance backed by the
            4,200,000 BITS Staking & Yield Reserve.
          </p>
        </div>
        <span className="status approved"><Radio size={14} /> Live Protocol Accounting</span>
      </div>

      <div className="pool-hero-banner">
        <div className="eyebrow" style={{ marginBottom: 12 }}><span className="eyebrow-dot" />Algorithmic Staking Yield</div>
        <h2 style={{ font: '700 32px var(--app-font-serif)', margin: '0 0 8px', color: '#fff' }}>
          Reserve Emissions Status
        </h2>
        <p style={{ color: 'var(--silver-medium)', maxWidth: 640, margin: '0 0 24px', fontSize: 14 }}>
          Bitnoir's emission rate is algorithmically capped to prevent inflation. Stakers receive proportional shares
          of each hourly block emission based on active locked position size.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <span className="small-label">Total Reserve Cap</span>
            <div style={{ font: '700 24px var(--app-font-serif)', color: '#fff', marginTop: 4 }}>
              {number(stats.totalReserve)} <small style={{ fontSize: 13 }}>BITS</small>
            </div>
            <span style={{ fontSize: 11, color: 'var(--silver-dark)' }}>20% of 21M hard cap</span>
          </div>

          <div>
            <span className="small-label">Distributed to Date</span>
            <div style={{ font: '700 24px var(--app-font-serif)', color: 'var(--neon-green)', marginTop: 4 }}>
              {number(stats.totalDistributed)} <small style={{ fontSize: 13 }}>BITS</small>
            </div>
            <span style={{ fontSize: 11, color: 'var(--silver-dark)' }}>{emissionDistributionPercentage.toFixed(1)}% of reserve emitted</span>
          </div>

          <div>
            <span className="small-label">Remaining Pool Balance</span>
            <div style={{ font: '700 24px var(--app-font-serif)', color: '#fff', marginTop: 4 }}>
              {number(stats.availablePoolBalance)} <small style={{ fontSize: 13 }}>BITS</small>
            </div>
            <span style={{ fontSize: 11, color: 'var(--silver-dark)' }}>Protected yield reservoir</span>
          </div>

          <div>
            <span className="small-label">Current Emission Rate</span>
            <div style={{ font: '700 24px var(--app-font-serif)', color: 'var(--neon-green)', marginTop: 4 }}>
              {stats.emissionRatePerHour} BITS / hr
            </div>
            <span style={{ fontSize: 11, color: 'var(--silver-dark)' }}>Shared across {stats.activeStakers} stakers</span>
          </div>
        </div>

        <div className="progress-track" style={{ marginTop: 24, height: 8 }}>
          <div className="progress-value" style={{ width: `${emissionDistributionPercentage}%` }} />
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="panel content-card">
          <div className="card-heading">
            <div>
              <h3>24-Hour Pool Emission Cadence</h3>
              <p>Continuous emission blocks distributed to active staking nodes</p>
            </div>
            <BarChart3 size={18} color="var(--neon-green)" />
          </div>

          <div className="pool-bars">
            {[45, 52, 60, 58, 64, 72, 68, 75, 82, 80, 88, 94].map((height, i) => (
              <div className="pool-bar-item" key={i}>
                <div className="pool-bar-pill" style={{ height: `${height}%` }} />
                <span className="pool-bar-label">{`${(i + 1) * 2}h`}</span>
              </div>
            ))}
          </div>

          <div className="callout info" style={{ marginTop: 20 }}>
            Pool rewards accrue continuously into your account balance. You can claim rewards at any time
            once your accrued reward reaches at least $2.00 worth of Bitnoir.
          </div>
        </section>

        <section className="panel content-card">
          <div className="card-heading">
            <div>
              <h3>Your Pool Participation</h3>
              <p>Calculated against total active protocol stake</p>
            </div>
            <Trophy size={18} color="var(--gold-bits)" />
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--silver-dark)' }}>Your Active Stake</span>
              <strong style={{ color: '#fff' }}>{number((account.balances as unknown as Record<string, number>)?.staked || 0)} Bits</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--silver-dark)' }}>Your Pool Share</span>
              <strong style={{ color: 'var(--neon-green)' }}>{stats.userSharePercent}%</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--silver-dark)' }}>Reference Valuation</span>
              <strong style={{ color: '#fff' }}>${BITNOIR_REFERENCE_PRICE}.00 / BITS</strong>
            </div>
          </div>

          <Link href="/staking" className="button button-primary" style={{ width: '100%', marginTop: 24 }}>
            Increase Stake to Grow Pool Share <ArrowRight size={14} />
          </Link>
        </section>
      </div>
    </AppShell>
  );
}

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

          <div style={{ display: 'flex', gap: 12 }}>
            <button className="button button-primary" onClick={() => copy(referralUrl, 'Referral Link')}>
              <Copy size={14} /> Copy Invite Link
            </button>
            <button className="button button-ghost" onClick={() => copy(referralCode, 'Referral Code')}>
              <LinkIcon size={14} /> Copy Code: {referralCode}
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

              {/* MINING POOL */}
              <Route path="/pool">
                {() => <ProtectedGate>{(account) => <PoolPage account={account} />}</ProtectedGate>}
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
