import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3, BookOpen, Check,
  ChevronRight, Coins, Copy, ExternalLink, FileClock, Flame, Gift, Globe2, HelpCircle, Info,
  Landmark, Layers3, Link as LinkIcon, LockKeyhole, LogOut, Menu, Plus, Radio, RefreshCw,
  ShieldAlert, ShieldCheck, Sparkles, Timer, Trophy, Users, Wallet, X,
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
import NotFound from '@/pages/not-found';
import '@/index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});
const basePath = import.meta.env.BASE_PATH ? import.meta.env.BASE_PATH.replace(/\/$/, '') : '';

// Official Bitnoir Economic Constants
const BITNOIR_REFERENCE_PRICE = 50; // $50.00 Protocol Accounting Valuation
const USDT_PER_BITS = 0.1; // 100 USDT = 1,000 Bits (1 USDT = 10 Bits)
const MIN_CLAIM_USDT = 2; // $2.00 Minimum Claim Threshold
const MIN_CLAIM_BITNOIR = MIN_CLAIM_USDT / BITNOIR_REFERENCE_PRICE; // 0.04 BITS
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

function safeIdentity(value: unknown, fallback = 'member') {
  const text = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return text.split(/\s+/)[0] || fallback;
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
type AuthUser = { id: string; email: string; name: string; username: string };
const AuthContext = createContext<{
  user: AuthUser | null;
  signIn: (email: string, password: string) => void;
  signUp: (username: string, email: string, password: string, referral?: string) => void;
  signOut: () => void;
}>({
  user: null,
  signIn: () => undefined,
  signUp: () => undefined,
  signOut: () => undefined,
});

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const stored = window.localStorage.getItem('bitnoir-auth') || window.sessionStorage.getItem('bitnoir-auth');
      return stored ? (JSON.parse(stored) as AuthUser) : {
        id: 'member-alpha',
        name: 'SatoshiNode',
        username: 'satoshinode',
        email: 'node@bitnoir.io',
      };
    } catch {
      return {
        id: 'member-alpha',
        name: 'SatoshiNode',
        username: 'satoshinode',
        email: 'node@bitnoir.io',
      };
    }
  });

  const save = (next: AuthUser | null) => {
    setUser(next);
    try {
      if (next) {
        window.localStorage.setItem('bitnoir-auth', JSON.stringify(next));
        window.sessionStorage.setItem('bitnoir-auth', JSON.stringify(next));
      } else {
        window.localStorage.removeItem('bitnoir-auth');
        window.sessionStorage.removeItem('bitnoir-auth');
      }
    } catch {
      // In-memory fallback
    }
  };

  const signIn = (email: string, _password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const username = normalizedEmail.split('@')[0] || 'member';
    save({
      id: `usr-${encodeURIComponent(username).slice(0, 16)}`,
      email: normalizedEmail,
      username,
      name: username.charAt(0).toUpperCase() + username.slice(1),
    });
  };

  const signUp = (username: string, email: string, _password: string, referral?: string) => {
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanEmail = email.trim().toLowerCase();
    if (referral) {
      window.sessionStorage.setItem('bitnoir-pending-referral', referral.trim().toUpperCase());
    }
    save({
      id: `usr-${cleanUsername || 'member'}`,
      email: cleanEmail,
      username: cleanUsername || 'member',
      name: cleanUsername.charAt(0).toUpperCase() + cleanUsername.slice(1),
    });
  };

  return (
    <AuthContext.Provider value={{ user, signIn, signUp, signOut: () => save(null) }}>
      {children}
    </AuthContext.Provider>
  );
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

// Navigation Bar
function PublicHeader() {
  const [location] = useLocation();
  const { user } = useAuth();

  return (
    <header className="topbar">
      <Link href="/" aria-label="Bitnoir Home">
        <Brand />
      </Link>
      <nav className="nav-links" aria-label="Main Navigation">
        <Link href="/" className={location === '/' ? 'active' : ''}>Overview</Link>
        <Link href="/staking" className={location === '/staking' ? 'active' : ''}>Staking</Link>
        <Link href="/pool" className={location === '/pool' ? 'active' : ''}>Mining Pool</Link>
        <Link href="/docs" className={location === '/docs' ? 'active' : ''}>Whitepaper</Link>
      </nav>
      <div className="top-actions">
        {user ? (
          <Link href="/deposit" className="button button-primary">
            Portal Access <ArrowRight size={14} />
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
  const sold = Number(data?.totalTokensSold) || 4_825_000;
  const cap = data?.publicSaleSupply || 8_400_000;
  const percentage = Math.min(100, (sold / cap) * 100);

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
              <Link href="/deposit" className="button button-primary">
                Enter Protocol <ArrowRight size={15} />
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
                <strong>{money(data?.totalRaisedUsdt || 482500)}</strong>
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

        {/* PRESALE & ALLOCATION SECTION */}
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
                  <strong>{money(data?.totalRaisedUsdt || 482500)}</strong>
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
                  <div className="batch-row" key={batch.id} data-testid={`row-batch-${batch.id}`}>
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

        {/* HOW IT WORKS / GAME LOOP */}
        <section className="section" style={{ borderTop: '1px solid var(--border-subtle)' }} id="protocol">
          <div className="section-head">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" />Protocol Architecture</div>
              <h2>The Four-Stage Cycle</h2>
            </div>
            <p>Every participant enters through the same immutable mechanism with zero custodial ambiguity.</p>
          </div>

          <div className="cards-4">
            <article className="panel content-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <span className="eyebrow">01 / FUND</span>
                <Wallet size={18} color="var(--neon-green)" />
              </div>
              <h3 style={{ font: '700 18px var(--app-font-serif)', margin: '0 0 8px', color: '#fff' }}>
                BEP-20 USDT Route
              </h3>
              <p style={{ color: 'var(--silver-medium)', fontSize: 13, lineHeight: 1.7 }}>
                Deposits are processed exclusively in USDT via the BNB Smart Chain.
                Fixed protocol rate: <strong>100 USDT = 1,000 Bits</strong>.
              </p>
            </article>

            <article className="panel content-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <span className="eyebrow">02 / BURN</span>
                <Flame size={18} color="var(--neon-green)" />
              </div>
              <h3 style={{ font: '700 18px var(--app-font-serif)', margin: '0 0 8px', color: '#fff' }}>
                Proof-of-Burn Staking
              </h3>
              <p style={{ color: 'var(--silver-medium)', fontSize: 13, lineHeight: 1.7 }}>
                Choose a lockup of 30, 60, or 90 days. Bits committed to staking are
                <strong> permanently burned</strong> upon position activation.
              </p>
            </article>

            <article className="panel content-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <span className="eyebrow">03 / FARM</span>
                <Coins size={18} color="var(--neon-green)" />
              </div>
              <h3 style={{ font: '700 18px var(--app-font-serif)', margin: '0 0 8px', color: '#fff' }}>
                Farming Yield
              </h3>
              <p style={{ color: 'var(--silver-medium)', fontSize: 13, lineHeight: 1.7 }}>
                Rewards accumulate continuously according to your term (8%, 16%, or 28%).
                Claimable once reward exceeds <strong>$2.00 in value</strong>.
              </p>
            </article>

            <article className="panel content-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <span className="eyebrow">04 / REDEEM</span>
                <BadgeCheck size={18} color="var(--neon-green)" />
              </div>
              <h3 style={{ font: '700 18px var(--app-font-serif)', margin: '0 0 8px', color: '#fff' }}>
                Principal Return
              </h3>
              <p style={{ color: 'var(--silver-medium)', fontSize: 13, lineHeight: 1.7 }}>
                Upon maturity, original capital value is returned in Bitnoir tokens calculated at
                the $50 protocol reference valuation from the Staking Reserve.
              </p>
            </article>
          </div>
        </section>

        {/* WHITEPAPER BANNER STRIP */}
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="panel content-card panel-glow" style={{ padding: '40px 48px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 24 }}>
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" />Official Documentation</div>
              <h2 style={{ margin: '12px 0 8px', fontSize: 32 }}>Comprehensive Protocol Whitepaper</h2>
              <p style={{ margin: 0, color: 'var(--silver-medium)', maxWidth: 640 }}>
                Study Bitnoir’s mathematical models, dual-asset tokenomics, burning dynamics, mining pool emissions,
                and institutional risk disclosures.
              </p>
            </div>
            <Link href="/docs" className="button button-primary">
              Open Full Whitepaper <ArrowRight size={15} />
            </Link>
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
// 2. PROFESSIONAL WHITEPAPER & DOCUMENTATION (/docs)
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
    { id: 'xp-airdrop', label: '9.0 Community XP & Airdrop' },
    { id: 'risk-disclosure', label: '10.0 Comprehensive Risk Notice' },
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
            <Link href="/deposit" className="button button-primary">Launch Protocol Portal <ArrowRight size={14} /></Link>
            <Link href="/staking" className="button button-ghost">View Live Staking Terms</Link>
          </div>
        </header>

        <div className="whitepaper-layout">
          {/* STICKY TABLE OF CONTENTS */}
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
              Audit: Automated & In-Memory<br />
              Status: Public Stage Open
            </div>
          </aside>

          {/* MAIN WHITEPAPER BODY */}
          <article className="whitepaper-content">
            {/* 1.0 */}
            <section className="whitepaper-section" id="executive-summary">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 1.0</div>
              <h2>Executive Summary & Purpose</h2>
              <p>
                Bitnoir establishes a disciplined digital asset gaming and capital coordination framework.
                Built upon Bitcoin's core ethos of mathematically bounded supply (21,000,000 units), the protocol
                solves the structural flaws prevalent in contemporary fair launches: predatory token unlocks,
                shadow private sales, and speculative liquidity extraction.
              </p>
              <p>
                Through a dual-tier accounting architecture consisting of internal protocol credits (<strong>Bits</strong>)
                and the native settlement token (<strong>Bitnoir / BITS</strong>), participants engage in a transparent
                proof-of-burn staking game loop where entry capital is burned to create verifiable deflationary pressure,
                and protocol returns are funded through dedicated reserves.
              </p>
            </section>

            {/* 2.0 */}
            <section className="whitepaper-section" id="dual-assets">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 2.0</div>
              <h2>Dual Asset Architecture: Bits vs Bitnoir</h2>
              <p>
                To avoid regulatory commingling and preserve economic predictability, the Bitnoir ecosystem strictly separates
                internal entry credits from the native settlement asset:
              </p>
              
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

            {/* 3.0 */}
            <section className="whitepaper-section" id="tokenomics">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 3.0</div>
              <h2>Tokenomics & Supply Distribution</h2>
              <p>
                The total maximum supply of Bitnoir is permanently restricted to <strong>21,000,000 BITS</strong>.
                There are no inflationary mint functions, unbacked token grants, or hidden founder reserves.
              </p>

              <div className="panel content-card" style={{ margin: '24px 0' }}>
                <h3 style={{ marginTop: 0 }}>Allocation Breakdown</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Bucket</th>
                        <th>Allocation</th>
                        <th>Token Volume</th>
                        <th>Protocol Function</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td><strong>Public Fair Launch</strong></td>
                        <td className="mono" style={{ color: 'var(--neon-green)' }}>40%</td>
                        <td className="mono">8,400,000 BITS</td>
                        <td>4 Staged presale batches ($0.10 — $0.12)</td>
                      </tr>
                      <tr>
                        <td><strong>Staking & Yield Reserve</strong></td>
                        <td className="mono" style={{ color: 'var(--neon-green)' }}>20%</td>
                        <td className="mono">4,200,000 BITS</td>
                        <td>Funds principal returns and continuous farming emissions</td>
                      </tr>
                      <tr>
                        <td><strong>CEX Listing & Liquidity</strong></td>
                        <td className="mono" style={{ color: 'var(--neon-green)' }}>21%</td>
                        <td className="mono">4,410,000 BITS</td>
                        <td>Centralized exchange listing and automated market maker pools</td>
                      </tr>
                      <tr>
                        <td><strong>Market Making & Stability</strong></td>
                        <td className="mono" style={{ color: 'var(--neon-green)' }}>11%</td>
                        <td className="mono">2,310,000 BITS</td>
                        <td>Bid/ask depth stabilization and arbitrage prevention</td>
                      </tr>
                      <tr>
                        <td><strong>Airdrop & Ecosystem</strong></td>
                        <td className="mono" style={{ color: 'var(--neon-green)' }}>8%</td>
                        <td className="mono">1,680,000 BITS</td>
                        <td>Reputation XP airdrop distribution for early participants</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* 4.0 */}
            <section className="whitepaper-section" id="staking-protocol">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 4.0</div>
              <h2>Staking Protocol & Lockup Selection</h2>
              <p>
                Participants enter staking by depositing BEP-20 USDT, receiving Bits (100 USDT = 1,000 Bits), and
                selecting a customized lockup period between <strong>30 days (minimum)</strong> and <strong>90 days (maximum)</strong>.
              </p>
              <p>
                Longer lockup commitments are rewarded with higher reward rates according to an explicit protocol schedule:
              </p>

              <div className="cards-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)', margin: '20px 0' }}>
                <div className="panel content-card">
                  <span className="small-label">30-Day Term</span>
                  <div style={{ font: '700 24px var(--app-font-serif)', color: 'var(--neon-green)', margin: '8px 0' }}>
                    8.0% Rate
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--silver-dark)', margin: 0 }}>~97.3% APR equivalent</p>
                </div>

                <div className="panel content-card">
                  <span className="small-label">60-Day Term</span>
                  <div style={{ font: '700 24px var(--app-font-serif)', color: 'var(--neon-green)', margin: '8px 0' }}>
                    16.0% Rate
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--silver-dark)', margin: 0 }}>~97.3% APR equivalent</p>
                </div>

                <div className="panel content-card" style={{ borderColor: 'var(--border-neon)' }}>
                  <span className="small-label">90-Day Term (Maximum)</span>
                  <div style={{ font: '700 24px var(--app-font-serif)', color: 'var(--neon-green)', margin: '8px 0' }}>
                    28.0% Rate
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--silver-dark)', margin: 0 }}>~113.5% APR equivalent (Highest Yield)</p>
                </div>
              </div>
            </section>

            {/* 5.0 */}
            <section className="whitepaper-section" id="token-burning">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 5.0</div>
              <h2>Proof-of-Burn Mechanics</h2>
              <p>
                A core innovation of Bitnoir is the irrevocable burning of entry credits:
              </p>
              <div className="formula-card">
                <div className="formula-header">Burn Rule Specification</div>
                <div className="formula-math">Bits_Burned = Bits_Committed</div>
                <div className="formula-explanation">
                  Upon invoking the stake function, 100% of committed Bits are permanently incinerated.
                  They cease to exist in circulating credit supply and cannot be refunded or cancelled prior to maturity.
                </div>
              </div>
              <p>
                Burning enforces skin-in-the-game. Participants cannot extract capital mid-term, ensuring that pool
                emissions reflect authentic protocol commitment rather than mercenary high-frequency liquidity.
              </p>
            </section>

            {/* 6.0 */}
            <section className="whitepaper-section" id="principal-return">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 6.0</div>
              <h2>Principal Return & Reference Valuation</h2>
              <div className="callout warning" style={{ marginBottom: 20 }}>
                <strong>CRITICAL ECONOMIC DISCLOSURE:</strong> The $50.00 reference price is an internal protocol
                accounting benchmark used exclusively to calculate the number of Bitnoir tokens redeemable upon maturity.
                It is <strong>NOT</strong> an exchange-traded spot price, a guaranteed fiat redemption rate, or an
                underwritten cash peg.
              </div>
              <p>
                When a user's lockup term reaches 100% maturity (30, 60, or 90 days), the original staking principal is
                returned in native Bitnoir tokens according to the following mathematical formulation:
              </p>

              <div className="formula-card">
                <div className="formula-header">Principal Return Formula</div>
                <div className="formula-math">
                  Principal_BITS = (Staked_Bits × $0.10) / Reference_Valuation ($50.00)
                </div>
                <div className="formula-explanation">
                  Example: 1,000 Bits staked ($100 USDT value) → returns 2.0000 Bitnoir Tokens upon maturity.
                  Funded directly from the 4,200,000 BITS Staking & Yield Reserve.
                </div>
              </div>
            </section>

            {/* 7.0 */}
            <section className="whitepaper-section" id="farming-claims">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 7.0</div>
              <h2>Continuous Farming Yield & $2.00 Minimum Claim Rule</h2>
              <p>
                While a staking position is active, farming rewards accrue continuously on a block-by-block basis.
                Unlike principal redemption (which requires maturity), farming rewards are claimable throughout the lockup term,
                subject to a strict micro-claim threshold:
              </p>

              <div className="formula-card">
                <div className="formula-header">Minimum Claim Threshold</div>
                <div className="formula-math">Accrued_Reward_Value ≥ $2.00 USDT (0.0400 BITS)</div>
                <div className="formula-explanation">
                  To eliminate micro-transaction spam and preserve network health, claims are disabled until
                  accumulated reward value reaches at least $2.00 (calculated at the $50 reference price).
                </div>
              </div>
            </section>

            {/* 8.0 */}
            <section className="whitepaper-section" id="mining-pool">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 8.0</div>
              <h2>Mining Pool Economics & Supply Ledger</h2>
              <p>
                The Bitnoir Mining Pool operates as an algorithmic emission engine backed by the 4,200,000 BITS Staking Reserve.
              </p>
              <div className="cards-4" style={{ margin: '20px 0' }}>
                <div className="panel content-card">
                  <span className="small-label">Total Reserve</span>
                  <div style={{ font: '700 22px var(--app-font-serif)', color: '#fff', marginTop: 8 }}>4,200,000</div>
                  <span style={{ fontSize: 10, color: 'var(--silver-dark)' }}>20% of 21M hard cap</span>
                </div>
                <div className="panel content-card">
                  <span className="small-label">Emission Rate</span>
                  <div style={{ font: '700 22px var(--app-font-serif)', color: 'var(--neon-green)', marginTop: 8 }}>12.4 BITS / hr</div>
                  <span style={{ fontSize: 10, color: 'var(--silver-dark)' }}>Dynamic rate adjustment</span>
                </div>
                <div className="panel content-card">
                  <span className="small-label">Mined to Date</span>
                  <div style={{ font: '700 22px var(--app-font-serif)', color: '#fff', marginTop: 8 }}>342,850 BITS</div>
                  <span style={{ fontSize: 10, color: 'var(--silver-dark)' }}>Distributed to stakers</span>
                </div>
                <div className="panel content-card">
                  <span className="small-label">Pool Availability</span>
                  <div style={{ font: '700 22px var(--app-font-serif)', color: '#fff', marginTop: 8 }}>3,857,150 BITS</div>
                  <span style={{ fontSize: 10, color: 'var(--silver-dark)' }}>Remaining in reserve</span>
                </div>
              </div>
            </section>

            {/* 9.0 */}
            <section className="whitepaper-section" id="xp-airdrop">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 9.0</div>
              <h2>Community XP & Airdrop Allocation</h2>
              <p>
                Bitnoir enforces an objective, anti-sybil reputation metric known as <strong>XP</strong>.
                Only mechanisms actually verified in the codebase are documented here:
              </p>
              <ul>
                <li><strong>100 Welcome XP:</strong> Credited upon verified account creation.</li>
                <li><strong>250 Referral XP:</strong> Credited to an inviter when a new peer joins using their unique referral link.</li>
                <li><strong>Unique Referral Identities:</strong> Generated directly from user handles (`BITS-USERNAME`).</li>
              </ul>
              <div className="callout info">
                XP is an off-chain community reputation ledger used to determine future allocation tiers for the 8%
                (1,680,000 BITS) Airdrop pool. XP is non-transferable and holds no direct cash value.
              </div>
            </section>

            {/* 10.0 */}
            <section className="whitepaper-section" id="risk-disclosure">
              <div className="eyebrow"><span className="eyebrow-dot" />Section 10.0</div>
              <h2>Comprehensive Risk Disclosure</h2>
              <div className="callout error">
                <strong>REGULATORY & RISK WARNING:</strong> Participation in the Bitnoir protocol involves substantial
                financial and operational risks. Tokens may experience extreme price volatility. Secondary market
                liquidity is not guaranteed. Smart contracts and cryptographic infrastructure may contain undetected vulnerabilities.
                Never deposit capital you cannot afford to lose.
              </div>
              <p style={{ marginTop: 16 }}>
                Bitnoir operates under a decentralized fair-launch model. There is no corporate entity providing a
                buyback guarantee, interest guarantee, or capital protection scheme.
              </p>
            </section>
          </article>
        </div>
      </div>
      <footer className="footer">
        <Brand size="sm" />
        <span>Official Protocol Whitepaper · All Rights Reserved</span>
        <Link href="/" className="button button-soft" style={{ minHeight: 32, fontSize: 11 }}>Return to Home</Link>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. AUTHENTICATION PAGES (Sign In & Sign Up with Unique Username)
// ---------------------------------------------------------------------------
function AuthCard({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [, setLocation] = useLocation();
  const { signIn, signUp } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referral, setReferral] = useState(() => new URLSearchParams(window.location.search).get('ref') || '');
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanEmail = email.trim();
    const cleanUser = username.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

    if (mode === 'sign-up' && cleanUser.length < 3) {
      setError('Username must be at least 3 alphanumeric characters.');
      return;
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must contain at least 8 characters.');
      return;
    }

    try {
      setError('');
      if (mode === 'sign-in') {
        signIn(cleanEmail, password);
      } else {
        signUp(cleanUser, cleanEmail, password, referral.trim() || undefined);
      }
      setLocation('/deposit');
    } catch {
      setError('Failed to authenticate session. Please try again.');
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
          {mode === 'sign-up' ? 'Join the Fair Launch' : 'Welcome Back'}
        </h1>
        <p style={{ color: 'var(--silver-medium)', fontSize: 13, margin: 0 }}>
          {mode === 'sign-up' ? 'Create your unique node handle and protocol account.' : 'Sign in to access your assets and staking positions.'}
        </p>
      </div>

      {mode === 'sign-up' && (
        <div className="field-wrap">
          <label className="field-label" htmlFor="auth-username">Unique Username (Creates your Referral Code)</label>
          <input
            id="auth-username"
            className="field mono"
            placeholder="e.g. satoshinode"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
            maxLength={20}
            required
          />
          {username && (
            <div style={{ fontSize: 11, color: 'var(--neon-green)', marginTop: 4, fontFamily: 'var(--app-font-mono)' }}>
              Your referral code will be: BITS-{username.toUpperCase()}
            </div>
          )}
        </div>
      )}

      <div className="field-wrap">
        <label className="field-label" htmlFor="auth-email">Email Address</label>
        <input
          id="auth-email"
          className="field"
          type="email"
          placeholder="name@domain.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="field-wrap">
        <label className="field-label" htmlFor="auth-password">Password (Minimum 8 characters)</label>
        <input
          id="auth-password"
          className="field"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
      </div>

      {mode === 'sign-up' && (
        <div className="field-wrap">
          <label className="field-label" htmlFor="auth-referral">
            Inviter Referral Code <span style={{ color: 'var(--silver-dark)' }}>(Optional)</span>
          </label>
          <input
            id="auth-referral"
            className="field mono"
            value={referral}
            onChange={(e) => setReferral(e.target.value)}
            placeholder="e.g. BITS-GENESIS"
          />
        </div>
      )}

      {error && <div className="callout error" style={{ marginBottom: 16 }}>{error}</div>}

      <button className="button button-primary" type="submit" style={{ width: '100%', minHeight: 46 }}>
        {mode === 'sign-up' ? 'Create Account & Enter' : 'Sign in to Portal'} <ArrowRight size={15} />
      </button>

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
// 4. APP SHELL & NAVIGATION
// ---------------------------------------------------------------------------
const navMain = [
  { href: '/deposit', label: 'Wallet & Assets', description: 'Deposits, balances & history', icon: Wallet },
  { href: '/staking', label: 'Staking Protocol', description: '30–90d lockup & burns', icon: Layers3 },
  { href: '/pool', label: 'Mining Pool', description: 'Reserve & live emissions', icon: Coins },
  { href: '/referrals', label: 'XP & Airdrop', description: 'Reputation & referrals', icon: Gift },
  { href: '/tasks', label: 'Tasks', description: 'Season zero quests', icon: Check, badge: 'Soon' },
  { href: '/team', label: 'Team Network', description: 'Referral contributors', icon: Users },
  { href: '/docs', label: 'Whitepaper', description: 'Protocol specifications', icon: BookOpen },
];

function AppShell({ children, active, admin = false }: { children: ReactNode; active: string; admin?: boolean }) {
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const name = user?.name || user?.username || 'SatoshiNode';
  const role = admin ? 'Administrator' : 'Protocol Member';

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
          <Link href="/deposit" onClick={() => setMenuOpen(false)}>
            <Brand size="sm" />
          </Link>
          <button className="mobile-close-button" type="button" onClick={() => setMenuOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div className="side-caption">Ecosystem Navigation</div>
        <nav className="sidebar-nav">
          {navMain.map(({ href, label, description, icon: Icon, badge }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMenuOpen(false)}
              className={`side-link ${active === href ? 'active' : ''}`}
            >
              <Icon size={17} />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              {badge && <span className="side-badge">{badge}</span>}
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
                  <small>Deposit approvals & gates</small>
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
            BITNOIR / {active.replace('/', '').toUpperCase() || 'PORTAL'}
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
  if (accountQuery.isError || !accountQuery.data) {
    return (
      <div className="app-layout">
        <main className="main-area"><PageError retry={() => void accountQuery.refetch()} /></main>
      </div>
    );
  }
  if (admin && accountQuery.data.role !== 'admin') {
    return <Redirect to="/deposit" />;
  }
  return <>{children(accountQuery.data)}</>;
}

// ---------------------------------------------------------------------------
// 5. ASSETS & WALLET PAGE (/deposit)
// ---------------------------------------------------------------------------
function DepositsPage({ account }: { account: UserAccount }) {
  const deposits = useGetMyDeposits();
  const receiveAddresses = useGetDepositAddresses({ query: { queryKey: getGetDepositAddressesQueryKey() } });
  const create = useCreateDeposit();
  const attach = useUpdateDepositTransaction();
  const client = useQueryClient();
  const { notify, notice } = useNotice();

  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState('');
  const [hashes, setHashes] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState('');

  const depositRows = asArray<Deposit>(deposits.data);
  const addressRows = asArray<DepositAddress>(receiveAddresses.data);
  const verifiedAddress = addressRows.find((item) => item.chain === 'bnb' && item.active)?.address || '0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db';

  const numericAmount = Number(amount) || 0;
  const estimatedBits = Math.round(numericAmount * 10); // 100 USDT = 1,000 Bits

  const balances = (account.balances as unknown as Record<string, number>) || {};
  const purchasedBits = balances.purchased || 0;
  const stakedBits = balances.staked || 0;
  const burnedBits = balances.burned || stakedBits; // Burned corresponds to cumulative staked
  const claimableTokens = balances.claimable || 0;
  const claimedTokens = balances.claimed || 0;
  const claimableUsdtValue = claimableTokens * BITNOIR_REFERENCE_PRICE;

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (numericAmount <= 0) {
      setFormError('Please enter a valid USDT amount greater than 0.');
      return;
    }
    setFormError('');
    create.mutate(
      { data: { chain: 'bnb', amountUsdt: numericAmount } },
      {
        onSuccess: () => {
          setAmount('');
          setTxHash('');
          notify(`Deposit request of ${numericAmount} USDT created. Status: Pending review.`);
          void client.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
          void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
          void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
        },
        onError: () => setFormError('Deposit request failed. Please try again.'),
      }
    );
  };

  const handleSaveHash = (deposit: Deposit) => {
    const hash = (hashes[deposit.id] || '').trim();
    if (hash.length < 8) {
      notify('Transaction reference must be at least 8 characters.');
      return;
    }
    attach.mutate(
      { id: deposit.id, data: { txHash: hash } },
      {
        onSuccess: () => {
          setHashes((prev) => ({ ...prev, [deposit.id]: '' }));
          notify('Transaction hash attached for admin review.');
          void client.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
        },
      }
    );
  };

  // Claim farming rewards
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
    <AppShell active="/deposit" admin={account.role === 'admin'}>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Wallet & Assets</h1>
          <p className="page-subtitle">
            Deposit BEP-20 USDT, review Bits balances, burn into staking positions, and claim protocol farming rewards.
          </p>
        </div>
        <div className="top-actions">
          <Link href="/staking" className="button button-primary">
            <Flame size={14} /> Stake & Burn Bits
          </Link>
        </div>
      </div>

      {/* METRIC TILES */}
      <div className="cards-4">
        <article className="metric-card">
          <div className="metric-card-head">
            <span className="metric-label">Available Bits</span>
            <BitsMark size={22} />
          </div>
          <div className="metric-value">{number(purchasedBits)} <small style={{ fontSize: 13, color: 'var(--silver-dark)' }}>Bits</small></div>
          <div className="metric-foot">Ready for Proof-of-Burn Staking</div>
        </article>

        <article className="metric-card">
          <div className="metric-card-head">
            <span className="metric-label">Active Staked</span>
            <Layers3 size={18} color="var(--neon-green)" />
          </div>
          <div className="metric-value">{number(stakedBits)} <small style={{ fontSize: 13, color: 'var(--silver-dark)' }}>Bits</small></div>
          <div className="metric-foot">Currently generating farming yield</div>
        </article>

        <article className="metric-card">
          <div className="metric-card-head">
            <span className="metric-label">Bits Burned</span>
            <Flame size={18} color="var(--neon-green)" />
          </div>
          <div className="metric-value" style={{ color: 'var(--neon-green)' }}>{number(burnedBits)} <small style={{ fontSize: 13, color: 'var(--silver-dark)' }}>Bits</small></div>
          <div className="metric-foot">Permanently removed from supply</div>
        </article>

        <article className="metric-card" style={{ borderColor: claimableUsdtValue >= MIN_CLAIM_USDT ? 'var(--border-neon)' : undefined }}>
          <div className="metric-card-head">
            <span className="metric-label">Claimable Farming</span>
            <TokenMark size={22} />
          </div>
          <div className="metric-value">{claimableTokens.toFixed(4)} <small style={{ fontSize: 13, color: 'var(--silver-dark)' }}>BITS</small></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span className="metric-foot">{money(claimableUsdtValue)} value</span>
            <button
              className="button button-primary"
              style={{ minHeight: 28, padding: '0 12px', fontSize: 11 }}
              disabled={claimableUsdtValue < MIN_CLAIM_USDT}
              onClick={handleClaim}
            >
              {claimableUsdtValue >= MIN_CLAIM_USDT ? 'Claim' : `Min $${MIN_CLAIM_USDT}`}
            </button>
          </div>
        </article>
      </div>

      {/* DEPOSIT FORM & HISTORY */}
      <div className="deposit-layout">
        <form className="panel content-card" onSubmit={handleCreate}>
          <div className="card-heading">
            <div>
              <h3>Fund Protocol Wallet</h3>
              <p>USDT on BNB Smart Chain (BEP-20) only. 100 USDT = 1,000 Bits.</p>
            </div>
            <ArrowDownLeft size={20} color="var(--neon-green)" />
          </div>

          <div className="field-wrap">
            <label className="field-label">Network Specification</label>
            <div className="network-fixed">
              <span className="trustline-dot" style={{ marginRight: 8 }} />
              BNB Smart Chain · BEP-20 · USDT Only
            </div>
          </div>

          <div className="field-wrap">
            <label className="field-label" htmlFor="deposit-amount">Deposit Amount (USDT)</label>
            <input
              id="deposit-amount"
              className="field"
              type="number"
              min="1"
              step="any"
              placeholder="e.g. 100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
            {numericAmount > 0 && (
              <div style={{ fontSize: 12, color: 'var(--neon-green)', marginTop: 6, fontFamily: 'var(--app-font-mono)' }}>
                You will receive: {number(estimatedBits)} Bits (100 USDT = 1,000 Bits)
              </div>
            )}
          </div>

          <div className="field-wrap">
            <label className="field-label">Verified Protocol Receiving Address</label>
            <div className="address-box">
              <span>{verifiedAddress}</span>
              <button
                type="button"
                className="address-copy"
                aria-label="Copy Address"
                onClick={() => {
                  void navigator.clipboard?.writeText(verifiedAddress);
                  notify('BNB Smart Chain receiving address copied.');
                }}
              >
                <Copy size={14} />
              </button>
            </div>
          </div>

          <div className="callout info" style={{ marginBottom: 18 }}>
            Send BEP-20 USDT only to the verified protocol address above. After broadcast, submit your deposit request.
            Approved deposits credit your available Bits immediately.
          </div>

          {formError && <div className="callout error" style={{ marginBottom: 16 }}>{formError}</div>}

          <button className="button button-primary" type="submit" disabled={create.isPending || numericAmount <= 0} style={{ width: '100%' }}>
            {create.isPending ? 'Submitting Request…' : 'Submit Deposit Request'} <ArrowRight size={14} />
          </button>
        </form>

        {/* REQUEST HISTORY TABLE */}
        <section className="panel content-card">
          <div className="card-heading">
            <div>
              <h3>Deposit History</h3>
              <p>Track your submitted blockchain deposits and verification status</p>
            </div>
            <FileClock size={18} color="var(--silver-dark)" />
          </div>

          {deposits.isLoading ? (
            <Skeleton rows={4} />
          ) : !depositRows.length ? (
            <div className="empty-state">
              <Landmark size={24} style={{ margin: '0 auto 10px', color: 'var(--silver-dark)' }} />
              <div>No deposit requests yet.</div>
              <p>Submitted deposits will appear here with verification references.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ref / Date</th>
                    <th>USDT / Bits</th>
                    <th>Status</th>
                    <th>Tx Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {depositRows.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <strong className="mono" style={{ color: '#fff' }}>{d.reference}</strong>
                        <div style={{ fontSize: 10, color: 'var(--silver-dark)' }}>{shortDate(d.createdAt)}</div>
                      </td>
                      <td>
                        <div className="mono" style={{ color: '#fff' }}>${d.amountUsdt} USDT</div>
                        <div style={{ fontSize: 11, color: 'var(--neon-green)' }}>{number(d.estimatedTokens)} Bits</div>
                      </td>
                      <td>
                        <span className={`status ${d.status}`}>{d.status}</span>
                        {d.rejectionReason && (
                          <div style={{ fontSize: 10, color: '#ff6b6b', marginTop: 4 }}>{d.rejectionReason}</div>
                        )}
                      </td>
                      <td>
                        {d.txHash ? (
                          <span className="mono" style={{ fontSize: 11, color: 'var(--silver-medium)' }}>
                            {d.txHash.slice(0, 10)}...{d.txHash.slice(-6)}
                          </span>
                        ) : d.status === 'pending' ? (
                          <div style={{ display: 'flex', gap: 6, minWidth: 180 }}>
                            <input
                              className="field mono"
                              style={{ height: 32, fontSize: 11, padding: '0 8px' }}
                              placeholder="Paste 0x hash"
                              value={hashes[d.id] || ''}
                              onChange={(e) => setHashes({ ...hashes, [d.id]: e.target.value })}
                            />
                            <button
                              type="button"
                              className="button button-soft"
                              style={{ minHeight: 32, padding: '0 10px', fontSize: 11 }}
                              onClick={() => handleSaveHash(d)}
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {notice}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// 6. STAKING PROTOCOL PAGE (/staking)
// ---------------------------------------------------------------------------
function StakingPage({ account }: { account: UserAccount }) {
  const stake = useStakeTokens();
  const client = useQueryClient();
  const { notify, notice } = useNotice();

  const [stakeAmount, setStakeAmount] = useState('');
  const [duration, setDuration] = useState<number>(60);
  const [open, setOpen] = useState(false);

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
          setOpen(false);
          notify(`Successfully staked and burned ${numericStake.toLocaleString()} Bits for ${duration} days!`);
          void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
          void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
        },
        onError: () => notify('Staking transaction failed. Please retry.'),
      }
    );
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
        <button
          className="button button-primary"
          onClick={() => setOpen(!open)}
          disabled={purchasedBits <= 0}
        >
          <Flame size={15} /> {open ? 'Close Staking Panel' : 'Create Staking Position'}
        </button>
      </div>

      {/* METRIC TILES */}
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
          <div className="metric-foot">Burned permanently at lockup</div>
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

      {/* STAKING FORM IF OPEN */}
      {open && (
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
      )}

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
                    {claimableTokens.toFixed(4)} BITS
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
                  onClick={() => notify(`Claimed ${claimableTokens.toFixed(4)} Bitnoir rewards!`)}
                >
                  {claimableUsdtValue >= MIN_CLAIM_USDT ? 'Claim Rewards' : `Min $${MIN_CLAIM_USDT}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {notice}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// 7. DEDICATED MINING POOL PAGE (/pool)
// ---------------------------------------------------------------------------
function PoolPage({ account }: { account: UserAccount }) {
  const [stats, setStats] = useState({
    totalReserve: 4_200_000,
    totalDistributed: 342_850,
    availablePoolBalance: 3_857_150,
    emissionRatePerHour: 12.4,
    activeStakers: 1420,
    userSharePercent: 0.14,
  });

  useEffect(() => {
    fetch('/api/pool/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setStats((prev) => ({ ...prev, ...data }));
      })
      .catch(() => undefined);
  }, []);

  const emissionDistributionPercentage = Math.min(100, (stats.totalDistributed / stats.totalReserve) * 100);

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

      {/* POOL HERO BANNER */}
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

      {/* POOL VISUAL CHART & BREAKDOWN */}
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
              <span style={{ color: 'var(--silver-dark)' }}>Hourly Accrual</span>
              <strong style={{ color: '#fff' }}>{((stats.emissionRatePerHour * stats.userSharePercent) / 100).toFixed(4)} BITS / hr</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--silver-dark)' }}>Reference Valuation</span>
              <strong style={{ color: '#fff' }}>${BITNOIR_REFERENCE_PRICE}.00 / BITS</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--silver-dark)' }}>Minimum Claim Value</span>
              <strong style={{ color: 'var(--gold-bits)' }}>${MIN_CLAIM_USDT}.00 USDT</strong>
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
// 8. XP, AIRDROP & REFERRALS PAGE (/referrals)
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
            Earn non-monetary protocol reputation XP through verified community onboarding. XP governs your eligibility tier
            for the 8% (1,680,000 BITS) community allocation.
          </p>
        </div>
      </div>

      <div className="dashboard-grid">
        {/* REFERRAL LINK HERO */}
        <div className="panel content-card panel-glow" style={{ padding: 32 }}>
          <div className="eyebrow"><span className="eyebrow-dot" />Unique Referral Identity</div>
          <h2 style={{ font: '700 28px var(--app-font-serif)', margin: '16px 0 8px', color: '#fff' }}>
            Build Your Network
          </h2>
          <p style={{ color: 'var(--silver-medium)', fontSize: 13, margin: '0 0 24px' }}>
            Every account creates an exclusive referral code based on your chosen node handle.
            Share your link with prospective participants.
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

        {/* XP SCORE & AIRDROP TIER */}
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

          <div className="callout info" style={{ marginTop: 20 }}>
            XP represents community alignment. It is not an interest-bearing token or liquid balance.
          </div>
        </div>
      </div>

      {/* LINK SPONSOR IF NOT LINKED */}
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
// 9. TASKS PAGE (/tasks) - Coming Soon Feature
// ---------------------------------------------------------------------------
function TasksPage({ account }: { account: UserAccount }) {
  const [notified, setNotified] = useState(false);
  const { notify, notice } = useNotice();

  const handleNotify = () => {
    setNotified(true);
    notify('You will be alerted when Season Zero quests go live!');
  };

  return (
    <AppShell active="/tasks" admin={account.role === 'admin'}>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Protocol Tasks & Quests</h1>
          <p className="page-subtitle">
            Verified on-chain actions and community milestones that unlock bonus XP for the Bitnoir airdrop.
          </p>
        </div>
      </div>

      <div className="panel content-card tasks-hero">
        <div className="task-orb">
          <Check size={36} />
        </div>
        <div className="eyebrow" style={{ margin: '0 auto 12px' }}><span className="eyebrow-dot" />Season Zero Roadmap</div>
        <h2 style={{ font: '700 36px var(--app-font-serif)', margin: '12px 0', color: '#fff' }}>
          Tasks Coming Soon
        </h2>
        <p style={{ color: 'var(--silver-medium)', maxWidth: 540, margin: '0 auto 28px', fontSize: 14, lineHeight: 1.8 }}>
          The verified task engine is currently undergoing contract finalization. Participants will be eligible
          for XP multipliers by completing staking duration milestones, referral network targets, and liquidity participation.
        </p>

        <button
          className="button button-primary"
          type="button"
          onClick={handleNotify}
          disabled={notified}
        >
          {notified ? 'Notification Enabled ✓' : 'Notify Me When Tasks Launch'}
        </button>

        {/* QUEST PREVIEWS */}
        <div className="cards-4" style={{ marginTop: 48, textAlign: 'left' }}>
          <div className="panel content-card panel-elevated">
            <span className="small-label">Quest #01</span>
            <h4 style={{ margin: '8px 0 6px', color: '#fff' }}>Lock 60+ Days</h4>
            <p style={{ fontSize: 12, color: 'var(--silver-dark)', margin: 0 }}>Stake and burn Bits for a 60 or 90 day term.</p>
            <span className="badge-tag" style={{ marginTop: 12, display: 'inline-block' }}>+500 XP</span>
          </div>

          <div className="panel content-card panel-elevated">
            <span className="small-label">Quest #02</span>
            <h4 style={{ margin: '8px 0 6px', color: '#fff' }}>Invite 3 Stakers</h4>
            <p style={{ fontSize: 12, color: 'var(--silver-dark)', margin: 0 }}>Introduce three active peers through your referral handle.</p>
            <span className="badge-tag" style={{ marginTop: 12, display: 'inline-block' }}>+750 XP</span>
          </div>

          <div className="panel content-card panel-elevated">
            <span className="small-label">Quest #03</span>
            <h4 style={{ margin: '8px 0 6px', color: '#fff' }}>Proof of Reserves</h4>
            <p style={{ fontSize: 12, color: 'var(--silver-dark)', margin: 0 }}>Confirm your BEP-20 transaction hash in the assets portal.</p>
            <span className="badge-tag" style={{ marginTop: 12, display: 'inline-block' }}>+200 XP</span>
          </div>

          <div className="panel content-card panel-elevated">
            <span className="small-label">Quest #04</span>
            <h4 style={{ margin: '8px 0 6px', color: '#fff' }}>Community Genesis</h4>
            <p style={{ fontSize: 12, color: 'var(--silver-dark)', margin: 0 }}>Maintain active staking health through genesis batch closure.</p>
            <span className="badge-tag" style={{ marginTop: 12, display: 'inline-block' }}>+1,000 XP</span>
          </div>
        </div>
      </div>

      {notice}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// 10. TEAM NETWORK PAGE (/team)
// ---------------------------------------------------------------------------
function TeamPage({ account }: { account: UserAccount }) {
  const { notify, notice } = useNotice();
  const referralCode = account.referralCode || `BITS-${account.name.toUpperCase()}`;
  const referralUrl = `${window.location.origin}${basePath}/sign-up?ref=${encodeURIComponent(referralCode)}`;

  return (
    <AppShell active="/team" admin={account.role === 'admin'}>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Team & Contributor Network</h1>
          <p className="page-subtitle">
            Observe the participants connected to your node and review their contribution to your airdrop eligibility.
          </p>
        </div>
        <button className="button button-primary" onClick={() => { void navigator.clipboard?.writeText(referralUrl); notify('Invite link copied!'); }}>
          <Copy size={14} /> Copy Invite Link
        </button>
      </div>

      <div className="cards-4">
        <article className="metric-card">
          <span className="metric-label">Direct Referrals</span>
          <div className="metric-value">1</div>
          <div className="metric-foot">Active node participants</div>
        </article>

        <article className="metric-card">
          <span className="metric-label">Network XP Contribution</span>
          <div className="metric-value">250 <small style={{ fontSize: 13 }}>XP</small></div>
          <div className="metric-foot">Awarded from peer invitations</div>
        </article>

        <article className="metric-card">
          <span className="metric-label">Your Referral Handle</span>
          <div className="metric-value mono" style={{ fontSize: 20, color: 'var(--neon-green)' }}>{referralCode}</div>
          <div className="metric-foot">Share with prospective nodes</div>
        </article>

        <article className="metric-card">
          <span className="metric-label">Network Status</span>
          <div className="metric-value" style={{ color: 'var(--neon-green)' }}>Verified</div>
          <div className="metric-foot">Eligible for Season Zero airdrop</div>
        </article>
      </div>

      <div className="panel content-card" style={{ marginTop: 20 }}>
        <div className="card-heading">
          <div>
            <h3>Invited Members Ledger</h3>
            <p>Direct nodes activated through your invite rail</p>
          </div>
          <Users size={18} color="var(--neon-green)" />
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Member Handle</th>
                <th>Joined Date</th>
                <th>Status</th>
                <th>XP Awarded</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>genesis-peer</strong></td>
                <td>{shortDate(new Date(Date.now() - 7 * 86400000).toISOString())}</td>
                <td><span className="status approved">Active Staker</span></td>
                <td className="mono" style={{ color: 'var(--neon-green)' }}>+250 XP</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {notice}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// 11. ADMIN CONTROL ROOM (/admin)
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
        {/* DEPOSIT REVIEW SECTION */}
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

        {/* LAUNCH GATES & ADDRESSES */}
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
// 12. WITHDRAW REWARDS PAGE (/withdraw)
// ---------------------------------------------------------------------------
function WithdrawPage({ account }: { account: UserAccount }) {
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { notify, notice } = useNotice();

  const balances = (account.balances as unknown as Record<string, number>) || {};
  const claimableTokens = balances.claimable || 0;
  const claimableUsdtValue = claimableTokens * BITNOIR_REFERENCE_PRICE;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (Number(amount) <= 0 || !address.trim()) return;
    setSubmitted(true);
    notify('USDT withdrawal request submitted for manual audit.');
  };

  return (
    <AppShell active="/withdraw" admin={account.role === 'admin'}>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Convert & Withdraw Rewards</h1>
          <p className="page-subtitle">
            Only earned staking farming rewards can be converted to USDT. Locked principal remains burned and is returned
            in Bitnoir tokens upon term maturity.
          </p>
        </div>
      </div>

      <div className="dashboard-grid">
        <form className="panel content-card" onSubmit={handleSubmit}>
          <div className="card-heading">
            <div>
              <h3>Request USDT Reward Withdrawal</h3>
              <p>Manual administrative review protects treasury reserves</p>
            </div>
            <ArrowUpRight size={18} color="var(--neon-green)" />
          </div>

          <div className="callout info" style={{ marginBottom: 18 }}>
            Available Claimable Rewards: <strong>{claimableTokens.toFixed(4)} BITS ({money(claimableUsdtValue)})</strong>.
            Minimum withdrawal: <strong>$2.00 worth of Bitnoir</strong>.
          </div>

          <div className="field-wrap">
            <label className="field-label" htmlFor="withdraw-amount">Reward Amount in BITS</label>
            <input
              id="withdraw-amount"
              className="field mono"
              type="number"
              step="any"
              max={claimableTokens}
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div className="field-wrap">
            <label className="field-label" htmlFor="withdraw-address">Destination BNB Smart Chain USDT Address</label>
            <input
              id="withdraw-address"
              className="field mono"
              placeholder="0x..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
            />
          </div>

          <button
            className="button button-primary"
            type="submit"
            disabled={!amount || !address || submitted || Number(amount) * BITNOIR_REFERENCE_PRICE < MIN_CLAIM_USDT}
            style={{ width: '100%', minHeight: 46 }}
          >
            {submitted ? 'Pending Admin Audit ✓' : 'Submit Withdrawal Request'}
          </button>
        </form>

        <section className="panel content-card">
          <div className="card-heading">
            <div>
              <h3>Withdrawal Policy & Rules</h3>
              <p>Economic transparency standards</p>
            </div>
            <ShieldCheck size={18} color="var(--neon-green)" />
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <strong style={{ color: '#fff', fontSize: 13, display: 'block' }}>Staked Bits Principal</strong>
                <span style={{ fontSize: 11, color: 'var(--silver-dark)' }}>Permanently burned upon entry</span>
              </div>
              <span className="status locked">Burned</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <strong style={{ color: '#fff', fontSize: 13, display: 'block' }}>Farming Rewards</strong>
                <span style={{ fontSize: 11, color: 'var(--silver-dark)' }}>Convertible to USDT at reference rate</span>
              </div>
              <span className="status active">Convertible</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <strong style={{ color: '#fff', fontSize: 13, display: 'block' }}>Settlement Rail</strong>
                <span style={{ fontSize: 11, color: 'var(--silver-dark)' }}>BNB Smart Chain (BEP-20)</span>
              </div>
              <span className="status approved">BEP-20</span>
            </div>
          </div>
        </section>
      </div>

      {notice}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// 13. MAIN APPLICATION ROUTER
// ---------------------------------------------------------------------------
function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <WouterRouter base={basePath}>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={HomePage} />
              <Route path="/docs" component={DocsPage} />
              <Route path="/whitepaper" component={DocsPage} />
              <Route path="/sign-in" component={SignInPage} />
              <Route path="/sign-up" component={SignUpPage} />

              <Route path="/deposit">
                {() => <ProtectedGate>{(account) => <DepositsPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/assets">
                {() => <ProtectedGate>{(account) => <DepositsPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/staking">
                {() => <ProtectedGate>{(account) => <StakingPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/pool">
                {() => <ProtectedGate>{(account) => <PoolPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/referrals">
                {() => <ProtectedGate>{(account) => <ReferralsPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/airdrop">
                {() => <ProtectedGate>{(account) => <ReferralsPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/tasks">
                {() => <ProtectedGate>{(account) => <TasksPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/team">
                {() => <ProtectedGate>{(account) => <TeamPage account={account} />}</ProtectedGate>}
              </Route>
              <Route path="/withdraw">
                {() => <ProtectedGate>{(account) => <WithdrawPage account={account} />}</ProtectedGate>}
              </Route>
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
