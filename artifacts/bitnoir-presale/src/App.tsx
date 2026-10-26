import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3, BookOpen, Check,
  Coins, Copy, ExternalLink, FileClock, Globe2, Landmark, Layers3, Link as LinkIcon,
  LockKeyhole, LogOut, Plus, Radio, ShieldCheck, Sparkles, Users, Wallet,
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
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

const chainList: Chain[] = ['ethereum', 'bnb', 'polygon', 'arbitrum', 'base', 'solana'];
const chainNames: Record<string, string> = {
  ethereum: 'Ethereum', bnb: 'BNB Chain', polygon: 'Polygon', arbitrum: 'Arbitrum', base: 'Base', solana: 'Solana',
};
const money = (value?: number | null) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value ?? 0);
const number = (value?: number | null) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value ?? 0);
const compact = (value?: number | null) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value ?? 0);
const shortDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recently';

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

function asRecord<T extends object>(value: unknown): Partial<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Partial<T>;
}

function safeIdentity(value: unknown, fallback = 'member') {
  const text = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return text.split(/\s+/)[0] || fallback;
}

function Brand({ light = false }: { light?: boolean }) {
  return <span className="brand" style={light ? { color: '#eff5f1' } : undefined}><span className="brand-mark" aria-hidden="true" />bitnoir</span>;
}

type AuthUser = { id: string; email: string; name: string };
const AuthContext = createContext<{ user: AuthUser | null; signIn: (email: string, password: string) => void; signUp: (username: string, email: string, password: string, referral?: string) => void; signOut: () => void }>({ user: null, signIn: () => undefined, signUp: (_username, _email, _password, _referral) => undefined, signOut: () => undefined });

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try { return JSON.parse(window.sessionStorage.getItem('bitnoir-auth') || 'null') as AuthUser | null; } catch { return null; }
  });
  const save = (next: AuthUser | null) => { setUser(next); if (next) window.sessionStorage.setItem('bitnoir-auth', JSON.stringify(next)); else window.sessionStorage.removeItem('bitnoir-auth'); };
  const makeId = (value: string) => encodeURIComponent(value).replace(/%/g, '').slice(0, 32) || `member-${Date.now()}`;
  const signIn = (email: string) => save({ id: makeId(email), email, name: email.split('@')[0] || 'member' });
  const signUp = (username: string, email: string, _password: string, _referral?: string) => save({ id: makeId(`${username}:${email}`), email, name: username.trim() || email.split('@')[0] || 'member' });
  return <AuthContext.Provider value={{ user, signIn, signUp, signOut: () => save(null) }}>{children}</AuthContext.Provider>;
}

function useAuth() { return useContext(AuthContext); }

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
    timer.current = window.setTimeout(() => setMessage(''), 3500);
  };
  const notice = message ? <div className="notice" role="status" data-testid="status-notice">{message}</div> : null;
  return { notify, notice };
}

function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="skeleton-stack" aria-label="Loading"><div className="loading-line" style={{ width: '42%' }} />{Array.from({ length: rows }, (_, i) => <div className="loading-line" key={i} style={{ width: `${88 - (i % 3) * 15}%` }} />)}</div>;
}

function PageError({ retry }: { retry: () => void }) {
  return <div className="error-state"><p>We couldn't load this view right now.</p><button className="button button-soft" onClick={retry} data-testid="button-retry">Try again</button></div>;
}

function PublicHeader() {
  return <header className="topbar">
    <Link href="/" aria-label="Bitnoir home"><Brand light /></Link>
    <nav className="nav-links" aria-label="Main navigation">
      <a href="#docs">Protocol brief</a><Link href="/docs">Whitepaper</Link><Link href="/sign-in">Member portal</Link>
    </nav>
    <div className="top-actions">
      <Link href="/sign-in" className="button button-ghost">Sign in</Link>
      <Link href="/sign-up" className="button button-primary">Create account <ArrowRight size={14} /></Link>
    </div>
  </header>;
}

function PresaleContent({ overview }: { overview: PresaleOverview }) {
  const batches = asArray<PresaleOverview['batches'][number]>(overview.batches);
  const allocations = asArray<PresaleOverview['allocations'][number]>(overview.allocations);
  const sold = Number(overview.totalTokensSold) || 0;
  const cap = overview.publicSaleSupply || 8_400_000;
  const percentage = Math.min(100, cap ? sold / cap * 100 : 0);
  return <>
    <div className="sale-grid">
      <div className="panel sale-panel">
        <div className="sale-numbers">
          <div><span className="small-label">Raised to date</span><strong data-testid="text-total-raised">{money(overview.totalRaisedUsdt)}</strong></div>
          <div style={{ textAlign: 'right' }}><span className="small-label">Public allocation</span><strong>{compact(cap)} <small style={{ fontSize: 12 }}>BITS</small></strong></div>
        </div>
        <div className="progress-track" aria-label={`${percentage.toFixed(1)} percent allocated`}><div className="progress-value" style={{ width: `${percentage}%` }} /></div>
        <div className="progress-meta"><span>{number(sold)} BITS sold</span><span>{percentage.toFixed(1)}% allocated</span></div>
        <div className="batch-list">
          {batches.map((batch) => <div className="batch-row" key={batch.id} data-testid={`row-batch-${batch.id}`}>
            <span><strong>{batch.name}</strong></span><span className="mono">{money(batch.pricePerToken)} / BITS</span>
            <span className="mono">{compact(batch.tokensSold)} / {compact(batch.tokenSupply)}</span>
            <span className={`batch-tag ${batch.status === 'active' ? 'active' : ''}`}>{batch.status}</span>
          </div>)}
          {!batches.length && <div className="empty-state">Presale batch details will appear here.</div>}
        </div>
      </div>
      <div className="panel allocation-panel" id="allocation">
        <h3>A measured token economy</h3><p>Designed for a durable community and clear distribution.</p>
        {allocations.map((allocation) => <div className="allocation-row" key={allocation.name}>
          <strong>{allocation.name}</strong><strong>{allocation.percent}%</strong>
          <div className="progress-track"><div className="progress-value" style={{ width: `${allocation.percent}%` }} /></div>
        </div>)}
      </div>
    </div>
  </>;
}

function HomePage() {
  const data = undefined;
  return <div className="site-shell landing">
    <PublicHeader />
    <main>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">A multichain digital asset · BITS</div>
          <h1>Built for the<br /><span>next signal.</span></h1>
          <p>Bitnoir is a multichain abstract layer for Bitcoin-aligned capital: route USDT, acquire BITS, lock position into staking, and earn protocol rewards through a transparent fair launch.</p>
          <div className="hero-actions">
            <Link href="/sign-up" className="button button-primary">Enter the fair launch <ArrowRight size={15} /></Link>
            <Link href="/docs" className="button button-ghost">Read the protocol brief</Link>
          </div>
          <div className="trustline"><span><i className="trust-dot" /> Transparent allocation</span><span>Multichain access</span></div>
        </div>
        <div className="hero-art" aria-label="Bitnoir token orbital illustration">
          <div className="orbital"><div className="orbit-line" /><div className="orbit-line two" /><div className="core-token">B</div><span className="orbit-node node-a">ETH</span><span className="orbit-node node-b">BNB</span><span className="orbit-node node-c">BASE</span><span className="orbit-node node-d">SOL</span></div>
        </div>
      </section>
      <section className="section docs-strip" id="docs"><div className="panel content-card docs-card"><div><div className="eyebrow" style={{ color: '#f7931a' }}>Protocol brief / v1</div><h2>Bitcoin-aligned capital, without a single-chain boundary.</h2><p>Read the Bitnoir vision, distribution model, staking mechanics, referral XP, and operator controls before you participate.</p></div><Link className="button button-ghost" href="/docs">Open whitepaper <ArrowRight size={14} /></Link></div></section>
    </main>
    <footer className="footer"><Link href="/"><Brand light /></Link><span>Participation involves risk. Make decisions with care.</span><span>BITNOIR · BITS · MULTICHAIN ABSTRACT LAYER</span></footer>
  </div>;
}

function AuthCard({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [, setLocation] = useLocation();
  const { signIn, signUp } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referral, setReferral] = useState(() => new URLSearchParams(window.location.search).get('ref') || '');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => { event.preventDefault(); const normalizedEmail = email.trim(); const normalizedUsername = username.trim(); if ((mode === 'sign-up' && !normalizedUsername) || !normalizedEmail || password.length < 8) { setError(mode === 'sign-up' ? 'Enter a username, valid email, and password with at least 8 characters.' : 'Enter a valid email and a password with at least 8 characters.'); return; } try { setError(''); mode === 'sign-in' ? signIn(normalizedEmail, password) : signUp(normalizedUsername, normalizedEmail, password, referral.trim() || undefined); setLocation('/dashboard'); } catch { setError('We could not create this session. Please try again.'); } };
  return <form className="auth-form" onSubmit={submit}>
    <div className="auth-heading"><div className="eyebrow">BITNOIR / {mode === 'sign-up' ? 'ACCESS' : 'RETURN'}</div><h1>{mode === 'sign-up' ? 'Create your protocol account.' : 'Welcome back.'}</h1><p>{mode === 'sign-up' ? 'Username, email, password. Referral is optional.' : 'Sign in to continue to your Bitnoir portal.'}</p></div>
    {mode === 'sign-up' && <><label className="field-label" htmlFor="auth-username">Username</label><input id="auth-username" className="field" value={username} onChange={(event) => setUsername(event.target.value.replace(/\\s/g, ''))} autoComplete="username" maxLength={24} required /></>}
    <label className="field-label" htmlFor="auth-email">Email address</label><input id="auth-email" className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
    <label className="field-label" htmlFor="auth-password">Password</label><input id="auth-password" className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} minLength={8} required />
    {mode === 'sign-up' && <><label className="field-label" htmlFor="auth-referral">Referral code <span className="muted-text">(optional)</span></label><input id="auth-referral" className="field" value={referral} onChange={(event) => setReferral(event.target.value)} placeholder="e.g. BITS-7K4M" /></>}
    {error && <p className="inline-error" role="alert">{error}</p>}<button className="button button-primary auth-submit" type="submit">{mode === 'sign-up' ? 'Create account' : 'Sign in'} <ArrowRight size={15} /></button>
    <p className="auth-switch">{mode === 'sign-up' ? 'Already have access?' : 'New to Bitnoir?'} <Link href={mode === 'sign-up' ? '/sign-in' : '/sign-up'}>{mode === 'sign-up' ? 'Sign in' : 'Create an account'}</Link></p>
  </form>;
}

function SignInPage() { return <div className="auth-stage"><Link href="/" className="auth-brand"><Brand light /></Link><div className="auth-card"><AuthCard mode="sign-in" /></div><div className="auth-caption">No email verification step. Enter the protocol directly.</div></div>; }
function SignUpPage() { return <div className="auth-stage"><Link href="/" className="auth-brand"><Brand light /></Link><div className="auth-card"><AuthCard mode="sign-up" /></div><div className="auth-caption">Username. Email. Password. Optional referral.</div></div>; }

const navMain = [
  { href: '/deposit', label: 'Assets', description: 'Deposit & withdraw', icon: Wallet },
  { href: '/staking', label: 'Staking', description: 'Positions & rewards', icon: Layers3 },
  { href: '/referrals', label: 'Airdrop', description: 'Earned XP', icon: Sparkles },
  { href: '/team', label: 'Team', description: 'Network & referrals', icon: Users },
  { href: '/docs', label: 'Docs', description: 'Protocol guide', icon: BookOpen },
];

function AppShell({ children, active, admin = false }: { children: ReactNode; active: string; admin?: boolean }) {
  const { user, signOut } = useAuth();
  const name = user?.email || 'Bitnoir member';
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  return <div className="app-layout">
    <aside className="sidebar">
      <Link href="/deposit"><Brand light /></Link>
      <div className="side-caption">Member portal</div>
      <nav className="sidebar-nav" aria-label="Member navigation">
        {navMain.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`side-link ${active === href ? 'active' : ''}`} data-testid={`link-nav-${href.slice(1)}`}><Icon size={16} />{label}</Link>)}
      </nav>
      {admin && <><div className="side-caption">Administration</div><nav className="sidebar-nav"><Link href="/admin" className={`side-link ${active === '/admin' ? 'active' : ''}`} data-testid="link-nav-admin"><ShieldCheck size={16} />Control room</Link></nav></>}
      <div className="side-bottom">
        <div className="mini-profile"><span className="avatar">{initials || 'B'}</span><span><span className="profile-name">{name}</span><span className="profile-role">{admin ? 'Administrator' : 'Member'}</span></span></div>
        <button className="side-link" style={{ width: '100%', border: 0, background: 'none', cursor: 'pointer' }} onClick={() => signOut()} data-testid="button-sign-out"><LogOut size={15} />Sign out</button>
      </div>
    </aside>
    <main className="main-area">
      <div className="app-top">
        <span className="breadcrumbs">BITNOIR / {active.replace('/', '').replace('-', ' ')}</span>
        <div className="top-actions"><span className="account-chip">Portal account</span><Link href="/" className="button button-soft">Public site <ExternalLink size={13} /></Link></div>
      </div>
      <div className="page-wrap">{children}</div>
    </main>
  </div>;
}

function ProtectedGate({ children, admin = false }: { children: (account: UserAccount) => ReactNode; admin?: boolean }) {
  const { user } = useAuth();
  const isSignedIn = Boolean(user);
  const accountQuery = useGetMyAccount({ query: { enabled: isSignedIn, queryKey: getGetMyAccountQueryKey() } });
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  if (accountQuery.isLoading) return <div className="app-layout"><div className="sidebar" /><main className="main-area"><Skeleton rows={6} /></main></div>;
  if (accountQuery.isError || !accountQuery.data) return <div className="app-layout"><main className="main-area"><PageError retry={() => void accountQuery.refetch()} /></main></div>;
  if (admin && accountQuery.data.role !== 'admin') return <Redirect to="/deposit" />;
  return <>{children(accountQuery.data)}</>;
}

function ReferralBootstrap() {
  const { user } = useAuth();
  const isSignedIn = Boolean(user);
  const account = useGetMyAccount({
    query: { enabled: isSignedIn, queryKey: getGetMyAccountQueryKey() },
  });
  const apply = useApplyReferralCode();
  const client = useQueryClient();
  const attemptedCode = useRef('');

  useEffect(() => {
    if (!isSignedIn || !account.data) return;
    const code = window.sessionStorage.getItem('bitnoir-pending-referral')?.trim();
    if (!code) return;
    if (account.data.referredBy) {
      window.sessionStorage.removeItem('bitnoir-pending-referral');
      return;
    }
    if (attemptedCode.current === code) return;
    attemptedCode.current = code;
    apply.mutate({ data: { code } }, {
      onSuccess: (result) => {
        if (result.applied) {
          window.sessionStorage.removeItem('bitnoir-pending-referral');
          void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
          void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
        }
      },
    });
  }, [account.data, apply, client, isSignedIn]);

  return null;
}

function Status({ value }: { value: string }) { return <span className={`status ${value}`} data-testid={`status-${value}`}>{value}</span>; }

type ActivityRow = { id: number; kind: string; title: string; detail: string; createdAt: string };

function ActivityList({ rows, loading, error, retry }: { rows?: ActivityRow[] | { rows?: ActivityRow[]; items?: ActivityRow[]; data?: ActivityRow[] }; loading: boolean; error: boolean; retry: () => void }) {
  if (loading) return <Skeleton rows={4} />;
  if (error) return <PageError retry={retry} />;
  const activityRows = Array.isArray(rows) ? rows : Array.isArray(rows?.rows) ? rows.rows : Array.isArray(rows?.items) ? rows.items : Array.isArray(rows?.data) ? rows.data : [];
  if (!activityRows.length) return <div className="empty-state"><Activity size={19} style={{ margin: '0 auto 9px' }} /><div>No account activity yet.</div><p>Approved deposits and account events will show here.</p></div>;
  return <div className="activity-list">{activityRows.map((item) => <div className="activity-item" key={item.id} data-testid={`activity-row-${item.id}`}><span className="activity-icon"><Activity size={15} /></span><span className="activity-copy"><strong>{item.title || 'Account activity'}</strong><span>{item.detail || item.kind || 'Updated'}</span></span><time className="activity-time">{item.createdAt ? shortDate(item.createdAt) : 'Recently'}</time></div>)}</div>;
}

function DashboardPage({ account }: { account: UserAccount }) {
  const activity = useGetMyActivity();
  const overview = useGetPresaleOverview();
  const stake = useStakeTokens();
  const queryClient = useQueryClient();
  const { notify, notice } = useNotice();
  const [stakeAmount, setStakeAmount] = useState('');
  const [stakeOpen, setStakeOpen] = useState(false);
  const launch = overview.data?.launch;
  const balances = { purchased: 0, staked: 0, claimable: 0, swapAvailable: 0, ...asRecord<UserAccount['balances']>(account.balances) };
  const stakeTokens = () => {
    const amountTokens = Number(stakeAmount);
    if (!Number.isFinite(amountTokens) || amountTokens <= 0 || amountTokens > balances.purchased) return;
    stake.mutate({ data: { amountTokens } }, {
      onSuccess: () => { setStakeAmount(''); setStakeOpen(false); notify('Tokens moved to staking balance.'); void queryClient.invalidateQueries({ queryKey: getGetMyAccountQueryKey() }); void queryClient.invalidateQueries({ queryKey: getGetMyActivityQueryKey() }); },
    });
  };
  return <AppShell active="/dashboard" admin={account.role === 'admin'}><div className="page-title-row"><div><h1 className="page-title">Good to have you, {safeIdentity(account.name || account.email)}.</h1><p className="page-subtitle">A live view of your verified position, protocol access, and community reputation.</p></div><Link href="/deposit" className="button button-primary"><Plus size={15} />Start a deposit</Link></div>
    <div className="cards-4">
      <Metric label="Purchased" value={`${number(balances.purchased)} BITS`} foot="Tokens credited after review" icon={<Coins size={15} />} />
      <Metric label="Staked" value={`${number(balances.staked)} BITS`} foot={launch?.stakingOpen ? 'Staking is available' : 'Opens at launch'} icon={<Layers3 size={15} />} />
      <Metric label="Claimable" value={`${number(balances.claimable)} BITS`} foot={launch?.claimsOpen ? 'Claim window is open' : 'Claims are launch-gated'} icon={<BadgeCheck size={15} />} />
      <Metric label="Swap available" value={`${number(balances.swapAvailable)} BITS`} foot={launch?.swapsOpen ? 'Swap window is open' : 'Swaps are launch-gated'} icon={<ArrowUpRight size={15} />} />
    </div>
    <div className="dashboard-grid">
      <section className="panel content-card"><div className="card-heading"><div><h3>Recent activity</h3><p>Your verified account timeline</p></div><Link href="/deposit" className="quiet-link">Manage deposits <ArrowRight size={12} /></Link></div><ActivityList rows={activity.data} loading={activity.isLoading} error={activity.isError} retry={() => void activity.refetch()} /></section>
      <section className="panel content-card"><div className="card-heading"><div><h3>Actions & availability</h3><p>Portal capabilities follow launch settings</p></div><Radio size={16} color="#54a984" /></div>
        <div className="switch-row"><span className="switch-copy"><strong>Stake BITS</strong><span>{launch?.stakingOpen ? 'Available now' : 'Not open yet'}</span></span><button className="button button-soft" disabled={!launch?.stakingOpen || balances.purchased <= 0} onClick={() => setStakeOpen((value) => !value)} data-testid="button-stake">{stakeOpen ? 'Cancel' : 'Stake'}</button></div>
        {stakeOpen && <div style={{ padding: '16px 0' }}><label className="field-label" htmlFor="stake-amount">Amount in BITS</label><div style={{ display: 'flex', gap: 8 }}><input id="stake-amount" className="field" value={stakeAmount} type="number" min="0" max={balances.purchased} onChange={(e) => setStakeAmount(e.target.value)} placeholder="0.00" data-testid="input-stake-amount" /><button className="button button-primary" disabled={stake.isPending || !stakeAmount} onClick={stakeTokens} data-testid="button-confirm-stake">{stake.isPending ? 'Saving…' : 'Confirm'}</button></div><p className="muted-text" style={{ fontSize: 10 }}>This updates your portal balance only. It does not submit an on-chain transaction.</p>{stake.isError && <p className="inline-error">Staking could not be updated. Please try again.</p>}</div>}
        <div className="switch-row"><span className="switch-copy"><strong>Token claims</strong><span>{launch?.claimsOpen ? 'Claim window open' : 'Available when launch opens'}</span></span><button className="button button-soft" disabled={!launch?.claimsOpen} title={launch?.claimsOpen ? 'Claim flow is not provided yet.' : 'Claims are not open'} data-testid="button-claims">{launch?.claimsOpen ? 'View status' : 'Not available'}</button></div>
        <div className="switch-row"><span className="switch-copy"><strong>Token swaps</strong><span>{launch?.swapsOpen ? 'Swap window open' : 'Available when launch opens'}</span></span><button className="button button-soft" disabled={!launch?.swapsOpen} title={launch?.swapsOpen ? 'Swap flow is not provided yet.' : 'Swaps are not open'} data-testid="button-swaps">{launch?.swapsOpen ? 'View status' : 'Not available'}</button></div>
        <div style={{ marginTop: 20 }} className="callout">Deposits are credited only after an administrator verifies your request. No wallet transaction is initiated from this portal.</div>
      </section>
    </div>
    {notice}
  </AppShell>;
}

function Metric({ label, value, foot, icon }: { label: string; value: string; foot: string; icon: ReactNode }) {
  return <article className="panel metric-card"><div style={{ display: 'flex', justifyContent: 'space-between', color: '#568e74' }}><span className="metric-label">{label}</span>{icon}</div><div className="metric-value" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</div><div className="metric-foot">{foot}</div></article>;
}

function DepositsPage({ account }: { account: UserAccount }) {
  const deposits = useGetMyDeposits();
  const receiveAddresses = useGetDepositAddresses({
    query: { queryKey: getGetDepositAddressesQueryKey() },
  });
  const overview = useGetPresaleOverview();
  const create = useCreateDeposit();
  const attach = useUpdateDepositTransaction();
  const client = useQueryClient();
  const { notify, notice } = useNotice();
  const [chain, setChain] = useState<Chain>(chainList[0]);
  const [amount, setAmount] = useState('');
  const [hashes, setHashes] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState('');
  const depositRows = asArray<Deposit>(deposits.data);
  const addressRows = asArray<DepositAddress>(receiveAddresses.data);
  const overviewBatches = asArray<PresaleOverview['batches'][number]>(overview.data?.batches);
  const activeBatch = overviewBatches.find((batch) => batch.status === 'active');
  const estimatedTokens = activeBatch && Number(amount) > 0
    ? Number((Number(amount) / activeBatch.pricePerToken).toFixed(2))
    : null;
  const knownAddress = addressRows.find((item) => item.chain === chain && item.active)?.address ?? null;
  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    const amountUsdt = Number(amount);
    if (!Number.isFinite(amountUsdt) || amountUsdt < 0.000001 || Number(amountUsdt.toFixed(6)) !== amountUsdt) { setFormError('Enter a positive USDT amount with no more than 6 decimal places.'); return; }
    setFormError('');
    create.mutate({ data: { chain, amountUsdt } }, { onSuccess: () => { setAmount(''); notify('Deposit request created. It is pending review.'); void client.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() }); void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() }); }, onError: () => setFormError('The deposit request could not be created. Please try again.') });
  };
  const handleHash = (deposit: Deposit) => {
    const txHash = (hashes[deposit.id] ?? '').trim();
    if (txHash.length < 8 || txHash.length > 160) { setFormError('Transaction reference must be 8–160 characters.'); return; }
    attach.mutate({ id: deposit.id, data: { txHash } }, { onSuccess: () => { setHashes((state) => ({ ...state, [deposit.id]: '' })); notify('Transaction reference saved for review.'); void client.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() }); }, onError: () => setFormError('Could not attach this reference. Please retry.') });
  };
  const noAddressAvailable = !knownAddress;
  return <AppShell active="/deposit" admin={account.role === 'admin'}>
    <div className="page-title-row"><div><h1 className="page-title">Assets</h1><p className="page-subtitle">Deposit USDT, review your wallet activity, and withdraw eligible staking rewards.</p></div><div className="top-actions"><Link href="#deposit-form" className="button button-primary"><ArrowDownLeft size={15} /> Deposit USDT</Link><Link href="/withdraw" className="button button-ghost"><ArrowUpRight size={15} /> Withdraw</Link></div></div>
    <div className="deposit-layout">
      <form className="panel deposit-form" id="deposit-form" onSubmit={handleCreate}>
        <div className="deposit-header"><span className="network-icon"><ArrowDownLeft size={17} /></span><div><h3 style={{ font: '600 17px var(--app-font-serif)', margin: 0 }}>Fund your wallet</h3><p className="muted-text" style={{ fontSize: 10, margin: '5px 0 0' }}>Requests are not on-chain payments.</p></div></div>
        <div className="field-wrap"><label className="field-label" htmlFor="deposit-chain">Network</label><select id="deposit-chain" className="field" value={chain} onChange={(e) => setChain(e.target.value as Chain)} data-testid="select-deposit-chain">{chainList.map((item) => <option key={item} value={item}>{chainNames[item]}</option>)}</select></div>
         <div className="field-wrap"><label className="field-label" htmlFor="deposit-amount">Amount in USDT</label><input id="deposit-amount" className="field" type="number" min="0.000001" step="0.000001" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter USDT amount" data-testid="input-deposit-amount" /></div>
        {estimatedTokens !== null && activeBatch && <p className="small-label" data-testid="text-estimated-tokens">Estimated at current batch: {number(estimatedTokens)} BITS @ {money(activeBatch.pricePerToken)} each. Final quote is locked when you create the request.</p>}
        {knownAddress && <div style={{ marginBottom: 18 }}><div className="field-label">Verified receiving address</div><div className="address-box"><span>{knownAddress}</span><button className="address-copy" type="button" aria-label="Copy receiving address" onClick={() => { void navigator.clipboard?.writeText(knownAddress).then(() => notify('Address copied.')).catch(() => notify('Clipboard access is unavailable.')); }} data-testid="button-copy-receive-address"><Copy size={14} /></button></div></div>}
        <div className={`callout ${noAddressAvailable ? 'warning' : ''}`} style={{ marginBottom: 18 }}>
          {noAddressAvailable ? `No verified receiving address is available for ${chainNames[chain]}. Deposit requests are disabled until the portal can confirm an address for this network.` : <>Send USDT only to the verified address shown above. Your request remains pending until reviewed.</>}
        </div>
        {formError && <p className="inline-error" role="alert">{formError}</p>}
        {(overview.isError || receiveAddresses.isError) && <div className="callout error">Network and receiving-address configuration could not be verified. Refresh before creating a request.</div>}
        <button className="button button-primary" type="submit" disabled={create.isPending || noAddressAvailable || overview.isLoading || overview.isError || receiveAddresses.isLoading || receiveAddresses.isError} data-testid="button-create-deposit">{create.isPending ? 'Creating request…' : 'Create deposit request'} <ArrowRight size={14} /></button>
        <div style={{ marginTop: 18 }} className="small-label">Supported: {asArray<Chain>(overview.data?.supportedChains).map((item) => chainNames[item]).join(' · ') || 'Loading networks'}</div>
      </form>
      <section className="panel content-card"><div className="card-heading"><div><h3>Request history</h3><p>Your deposit reference and status</p></div><FileClock size={16} color="#4c9275" /></div>
        {deposits.isLoading ? <Skeleton rows={4} /> : deposits.isError ? <PageError retry={() => void deposits.refetch()} /> : !depositRows.length ? <div className="empty-state"><Landmark size={20} style={{ margin: '0 auto 10px' }} /><div>No deposit requests yet.</div><p>New requests will appear here after submission.</p></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Reference</th><th>Network / amount</th><th>Status</th><th>Created</th><th>Transaction reference</th></tr></thead><tbody>{depositRows.map((deposit) => <tr key={deposit.id} data-testid={`row-deposit-${deposit.id}`}><td className="mono">{deposit.reference}</td><td>{chainNames[deposit.chain]}<br /><span className="muted-text">{number(deposit.amountUsdt)} USDT</span></td><td><Status value={deposit.status} />{deposit.rejectionReason && <div className="inline-error">{deposit.rejectionReason}</div>}</td><td>{shortDate(deposit.createdAt)}</td><td>{deposit.txHash ? <span className="mono">{deposit.txHash}</span> : deposit.status === 'pending' ? <div style={{ display: 'flex', minWidth: 210, gap: 6 }}><input className="field" placeholder="Paste tx hash" value={hashes[deposit.id] ?? ''} onChange={(e) => setHashes((state) => ({ ...state, [deposit.id]: e.target.value }))} data-testid={`input-tx-hash-${deposit.id}`} /><button className="button button-soft" disabled={attach.isPending} onClick={() => handleHash(deposit)} type="button" data-testid={`button-save-tx-${deposit.id}`}>Save</button></div> : '—'}</td></tr>)}</tbody></table></div>}
        {formError && <p className="inline-error">{formError}</p>}
      </section>
    </div>{notice}
  </AppShell>;
}

function ReferralsPage({ account }: { account: UserAccount }) {
  const apply = useApplyReferralCode();
  const client = useQueryClient();
  const { notify, notice } = useNotice();
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('ref') || window.sessionStorage.getItem('bitnoir-pending-referral') || '');
  const [error, setError] = useState('');
  const referralUrl = `${window.location.origin}${basePath}/sign-up?ref=${encodeURIComponent(account.referralCode)}`;
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); notify('Copied to clipboard.'); }
    catch { notify('Clipboard access is unavailable in this browser.'); }
  };
  const applyCode = (event: FormEvent) => {
    event.preventDefault();
    const value = code.trim();
    if (value.length < 3 || value.length > 32) { setError('Referral codes must be 3–32 characters.'); return; }
    setError('');
    apply.mutate({ data: { code: value } }, { onSuccess: (result) => { setCode(''); notify(result.message); void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() }); void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() }); }, onError: () => setError('This referral code could not be applied. Check the code and try again.') });
  };
  return <AppShell active="/referrals" admin={account.role === 'admin'}>
    <div className="page-title-row"><div><h1 className="page-title">A network that rewards.</h1><p className="page-subtitle">Build a trusted network and earn reputation XP without mixing it with token balances.</p></div></div>
    <div className="dashboard-grid">
      <section className="panel referral-hero"><div className="eyebrow">Your invite link</div><h2 className="display" style={{ fontSize: 34, margin: '16px 0 3px' }}>Good networks<br />start with people.</h2><p style={{ color: '#9caaa3', fontSize: 11 }}>Share your personal link with your community.</p>
        <div className="referral-code" data-testid="text-referral-code">{account.referralCode}</div>
        <div className="referral-actions"><button className="button button-primary" onClick={() => void copy(referralUrl)} data-testid="button-copy-referral"><Copy size={14} />Copy invite link</button><button className="button button-ghost" onClick={() => void copy(account.referralCode)} data-testid="button-copy-code"><LinkIcon size={14} />Copy code</button></div>
      </section>
      <section className="panel content-card"><div className="card-heading"><div><h3>Community XP</h3><p>Earned by showing up early</p></div><Sparkles size={17} color="#4a9274" /></div><div className="metric-value" data-testid="metric-xp">{number(account.xp)} <small style={{ fontSize: 13 }}>XP</small></div><div className="callout" style={{ marginTop: 19 }}>XP reflects community participation. It is not a token balance and does not guarantee an allocation.</div><div className="xp-row"><span>Referral status</span><span className="xp-value">{account.referredBy ? 'Code applied' : 'No code applied'}</span></div></section>
    </div>
    {!account.referredBy && <section className="panel content-card" style={{ marginTop: 16, maxWidth: 700 }}><div className="card-heading"><div><h3>Have an invite code?</h3><p>Apply a referral once to connect your account.</p></div></div><form onSubmit={applyCode}><div className="field-wrap"><label className="field-label" htmlFor="referral-input">Referral code</label><input id="referral-input" className="field" value={code} onChange={(e) => { setCode(e.target.value); }} placeholder="Enter code" data-testid="input-referral-code" /></div>{error && <p className="inline-error">{error}</p>}<button className="button button-primary" disabled={apply.isPending} type="submit" data-testid="button-apply-referral">{apply.isPending ? 'Applying…' : 'Apply referral code'} <ArrowRight size={14} /></button></form></section>}
    <div className="panel content-card" style={{ marginTop: 16 }}><div className="card-heading"><div><h3>Ways to participate</h3><p>Portal status, no promises hidden in the fine print</p></div></div><div className="steps-grid" style={{ marginTop: 0 }}><article className="step-card"><span className="step-num">01 / INVITE</span><h3>Share your link</h3><p>Invite community members using your unique referral code.</p></article><article className="step-card"><span className="step-num">02 / CONNECT</span><h3>Build your circle</h3><p>New accounts may attach a referral code during onboarding.</p></article><article className="step-card"><span className="step-num">03 / EARN</span><h3>Watch your XP</h3><p>Your community score is shown here, separate from purchased BITS.</p></article></div></div>
    {notice}
  </AppShell>;
}

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
  const [addressValues, setAddressValues] = useState<Record<string, string>>({});
  const [activeValues, setActiveValues] = useState<Record<string, boolean>>({});
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const launch = overview.data?.launch;
  const adminDeposits = asArray<AdminDeposit>(deposits.data);
  const adminAddresses = asArray<DepositAddress>(addresses.data);
  const invalidateAdmin = () => {
    void client.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
    void client.invalidateQueries({ queryKey: getGetAdminDepositsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
    void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
    void client.invalidateQueries({ queryKey: getGetPresaleOverviewQueryKey() });
  };
  const decideDeposit = (id: number, decision: 'approve' | 'reject') => {
    const rejectionReason = reason.trim();
    if (decision === 'reject' && !rejectionReason) { setRejectId(id); notify('Add a rejection reason before confirming.'); return; }
    if (decision === 'approve' && !adminDeposits.find((deposit) => deposit.id === id)?.txHash) { notify('Add a transaction reference before approving this deposit.'); return; }
    decide.mutate({ id, data: { decision, ...(decision === 'reject' ? { rejectionReason } : {}) } }, { onSuccess: () => { setRejectId(null); setReason(''); notify(`Deposit ${decision === 'approve' ? 'approved' : 'rejected'}.`); invalidateAdmin(); }, onError: () => notify('Deposit decision could not be saved.') });
  };
  const saveChainAddress = (chain: Chain) => {
    const known = adminAddresses.find((item) => item.chain === chain);
    const address = addressValues[chain] ?? known?.address ?? '';
    if (address.trim().length < 10 || address.trim().length > 180) { notify('Enter a valid receiving address, 10–180 characters.'); return; }
    saveAddress.mutate({ data: { chain, address: address.trim(), active: activeValues[chain] ?? known?.active ?? true } }, { onSuccess: () => { notify(`${chainNames[chain]} address saved.`); void client.invalidateQueries({ queryKey: getGetAdminAddressesQueryKey() }); }, onError: () => notify('Receiving address could not be saved.') });
  };
  const saveLaunch = (value: LaunchSettingsInput) => settings.mutate({ data: value }, { onSuccess: () => { notify('Launch availability updated.'); void client.invalidateQueries({ queryKey: getGetPresaleOverviewQueryKey() }); void client.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() }); }, onError: () => notify('Launch settings could not be saved.') });
  const changeLaunch = (key: keyof LaunchSettingsInput, value: boolean) => {
    if (!launch) return;
    saveLaunch({ ...launch, [key]: value });
  };
  const adminError = summary.isError || deposits.isError || addresses.isError || overview.isError;
  return <AppShell active="/admin" admin><div className="page-title-row"><div><h1 className="page-title">Control room</h1><p className="page-subtitle">Operate the protocol surface: verify capital, manage receiving rails, and gate launch actions.</p></div><span className="status approved"><ShieldCheck size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Admin access</span></div>
    {adminError && <div className="callout error" style={{ marginBottom: 15 }}>Some administrative data could not be loaded. Retry the affected section below.</div>}
    {summary.isLoading ? <div className="panel"><Skeleton rows={4} /></div> : summary.isError ? <div className="panel"><PageError retry={() => void summary.refetch()} /></div> : summary.data && <div className="cards-4">
      <Metric label="Members" value={number(summary.data.users)} foot="Provisioned accounts" icon={<Globe2 size={15} />} />
      <Metric label="Pending deposits" value={number(summary.data.pendingDeposits)} foot="Awaiting review" icon={<FileClock size={15} />} />
      <Metric label="Raised USDT" value={money(summary.data.totalRaisedUsdt)} foot={`${number(summary.data.tokensSold)} BITS recorded`} icon={<Coins size={15} />} />
      <Metric label="Active addresses" value={number(summary.data.activeAddresses)} foot="Receiving destinations" icon={<Wallet size={15} />} />
    </div>}
    <div className="admin-grid">
      <section className="panel content-card"><div className="card-heading"><div><h3>Deposit review</h3><p>Approve only after independently confirming payment.</p></div><FileClock size={16} color="#4c9275" /></div>
        {deposits.isLoading ? <Skeleton rows={5} /> : deposits.isError ? <PageError retry={() => void deposits.refetch()} /> : !adminDeposits.length ? <div className="empty-state">No deposit requests to review.</div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Member</th><th>Request</th><th>Reference</th><th>Status / decision</th></tr></thead><tbody>{adminDeposits.map((deposit) => <tr key={deposit.id} data-testid={`admin-deposit-${deposit.id}`}><td>{deposit.userName}<br /><span className="muted-text">{deposit.userEmail}</span></td><td>{chainNames[deposit.chain]}<br /><span className="muted-text">{number(deposit.amountUsdt)} USDT</span></td><td className="mono">{deposit.txHash || deposit.reference}</td><td><Status value={deposit.status} />{deposit.status === 'pending' && <div className="table-actions" style={{ marginTop: 9 }}><button className="button button-primary" style={{ minHeight: 31, padding: '0 10px' }} onClick={() => decideDeposit(deposit.id, 'approve')} disabled={decide.isPending} data-testid={`button-approve-${deposit.id}`}>Approve</button><button className="button button-danger" style={{ minHeight: 31, padding: '0 10px' }} onClick={() => { setRejectId(deposit.id); setReason(''); }} data-testid={`button-reject-${deposit.id}`}>Reject</button></div>}{rejectId === deposit.id && <div style={{ marginTop: 9, minWidth: 180 }}><input className="field" maxLength={240} placeholder="Reason for rejection" value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`input-rejection-reason-${deposit.id}`} /><button className="button button-danger" style={{ minHeight: 31, padding: '0 10px', marginTop: 5 }} onClick={() => decideDeposit(deposit.id, 'reject')} disabled={decide.isPending} data-testid={`button-confirm-reject-${deposit.id}`}>Confirm rejection</button></div>}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="panel content-card"><div className="card-heading"><div><h3>Launch availability</h3><p>Opening an action enables its portal control.</p></div><Radio size={16} color="#4c9275" /></div>
        {!launch ? overview.isLoading ? <Skeleton rows={4} /> : <PageError retry={() => void overview.refetch()} /> : <>{[
          ['saleOpen', 'Presale sale', 'Allow new presale participation.'],
          ['stakingOpen', 'Staking', 'Allow balance staking requests.'],
          ['claimsOpen', 'Claims', 'Mark token claims as available.'],
          ['swapsOpen', 'Swaps', 'Mark token swaps as available.'],
        ].map(([key, label, hint]) => <div className="switch-row" key={key}><span className="switch-copy"><strong>{label}</strong><span>{hint}</span></span><input className="toggle" type="checkbox" checked={Boolean(launch[key as keyof typeof launch])} disabled={settings.isPending} onChange={(e) => changeLaunch(key as keyof LaunchSettingsInput, e.target.checked)} aria-label={`Toggle ${label}`} data-testid={`toggle-${key}`} /></div>)}
          {settings.isError && <p className="inline-error">Could not save settings. Retry by changing the switch again.</p>}
        </>}
      </section>
    </div>
    <section className="panel content-card" style={{ marginTop: 16 }}><div className="card-heading"><div><h3>Receiving addresses</h3><p>Only addresses configured here can be used for deposit requests.</p></div><LockKeyhole size={16} color="#4c9275" /></div>
      {addresses.isLoading ? <Skeleton rows={5} /> : addresses.isError ? <PageError retry={() => void addresses.refetch()} /> : <div>{chainList.map((chain) => {
const known = adminAddresses.find((item) => item.chain === chain);
        const value = addressValues[chain] ?? known?.address ?? '';
        const active = activeValues[chain] ?? known?.active ?? true;
        return <div className="address-entry" key={chain} data-testid={`address-row-${chain}`}><div><div className="field-label">{chainNames[chain]}</div><div className="small-label">{known ? (active ? 'Active' : 'Inactive') : 'Not configured'}</div></div><div><label className="field-label" htmlFor={`address-${chain}`}>USDT receiving address</label><input id={`address-${chain}`} className="field mono" value={value} onChange={(e) => setAddressValues((state) => ({ ...state, [chain]: e.target.value }))} placeholder="Enter verified address" data-testid={`input-address-${chain}`} /></div><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, whiteSpace: 'nowrap' }}><input type="checkbox" checked={active} onChange={(e) => setActiveValues((state) => ({ ...state, [chain]: e.target.checked }))} data-testid={`toggle-address-${chain}`} /> Active</label><button className="button button-soft" onClick={() => saveChainAddress(chain)} disabled={saveAddress.isPending} data-testid={`button-save-address-${chain}`}>{saveAddress.isPending ? 'Saving…' : known ? 'Update' : 'Save'}</button></div></div>;
      })}</div>}
    </section>{notice}
  </AppShell>;
}

function WithdrawPage({ account }: { account: UserAccount }) {
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { notify, notice } = useNotice();
  const balances = { purchased: 0, staked: 0, claimable: 0, swapAvailable: 0, ...asRecord<UserAccount['balances']>(account.balances) };
  const submit = (event: FormEvent) => { event.preventDefault(); if (Number(amount) <= 0 || !address.trim()) return; setSubmitted(true); notify('Withdrawal request queued for admin review.'); };
  return <AppShell active="/withdraw" admin={account.role === 'admin'}><div className="page-title-row"><div><h1 className="page-title">Convert & withdraw</h1><p className="page-subtitle">Only rewards earned from staked BITS can be converted into USDT and requested for review.</p></div></div><div className="dashboard-grid"><form className="panel content-card" onSubmit={submit}><div className="card-heading"><div><h3>USDT withdrawal request</h3><p>Admin approval protects the reserve and the receiving address.</p></div><ShieldCheck size={16} color="#f7931a" /></div><div className="cards-4" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 22 }}><Metric label="Staked BITS" value={number(balances.staked)} foot="Principal remains locked" icon={<Layers3 size={15} />} /><Metric label="Claimable rewards" value={`${number(balances.claimable)} BITS`} foot="Eligible for conversion" icon={<BadgeCheck size={15} />} /></div><div className="field-wrap"><label className="field-label" htmlFor="withdraw-amount">Reward amount in BITS</label><input id="withdraw-amount" className="field" type="number" min="0" step="0.000001" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div><div className="field-wrap"><label className="field-label" htmlFor="withdraw-address">USDT receiving address</label><input id="withdraw-address" className="field" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Enter your BSC USDT address" /></div><div className="callout">No direct BITS withdrawal. BITS must be staked first; only earned rewards can be converted and withdrawn in USDT.</div><button className="button button-primary" type="submit" disabled={!amount || !address || submitted} style={{ marginTop: 18 }}>{submitted ? 'Awaiting admin approval' : 'Submit withdrawal request'} <ArrowRight size={14} /></button></form><section className="panel content-card"><div className="card-heading"><div><h3>Withdrawal policy</h3><p>Designed for a clear reserve trail.</p></div><FileClock size={16} color="#f7931a" /></div><div className="switch-row"><span className="switch-copy"><strong>Principal</strong><span>Never withdrawable directly</span></span><Status value="locked" /></div><div className="switch-row"><span className="switch-copy"><strong>Staking rewards</strong><span>Convertible to USDT</span></span><Status value="review" /></div><div className="switch-row"><span className="switch-copy"><strong>Settlement</strong><span>Manual admin approval</span></span><Status value="review" /></div></section></div>{notice}</AppShell>;
}

function StakingPage({ account }: { account: UserAccount }) {
  const overview = useGetPresaleOverview();
  const stake = useStakeTokens();
  const client = useQueryClient();
  const { notify, notice } = useNotice();
  const [amount, setAmount] = useState('');
  const [open, setOpen] = useState(false);
  const balances = { purchased: 0, staked: 0, claimable: 0, swapAvailable: 0, ...asRecord<UserAccount['balances']>(account.balances) };
  const launch = overview.data?.launch;
  const submit = () => { const value = Number(amount); if (!Number.isFinite(value) || value <= 0 || value > balances.purchased) return; stake.mutate({ data: { amountTokens: value } }, { onSuccess: () => { setAmount(''); setOpen(false); notify('Staking position created.'); void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() }); void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() }); } }); };
  return <AppShell active="/staking" admin={account.role === 'admin'}><div className="page-title-row"><div><h1 className="page-title">Staking</h1><p className="page-subtitle">Lock BITS to activate your position and earn rewards. Principal is not directly withdrawable.</p></div><button className="button button-primary" onClick={() => setOpen((value) => !value)} disabled={!launch?.stakingOpen || balances.purchased <= 0}><Layers3 size={15} />{open ? 'Close stake form' : 'Open stake'}</button></div><div className="cards-4"><Metric label="Available to stake" value={`${number(balances.purchased)} BITS`} foot="Credited after review" icon={<Coins size={15} />} /><Metric label="Active position" value={`${number(balances.staked)} BITS`} foot="Currently locked" icon={<Layers3 size={15} />} /><Metric label="Claimable rewards" value={`${number(balances.claimable)} BITS`} foot={launch?.claimsOpen ? 'Claim window open' : 'Launch gated'} icon={<BadgeCheck size={15} />} /><Metric label="Lock status" value={balances.staked > 0 ? 'Active' : 'Inactive'} foot="Position health" icon={<ShieldCheck size={15} />} /></div><div className="dashboard-grid"><section className="panel content-card"><div className="card-heading"><div><h3>Create a position</h3><p>Choose how much of your acquired BITS to lock.</p></div><Layers3 size={16} color="#f7931a" /></div>{open ? <div><label className="field-label" htmlFor="staking-amount">Amount in BITS</label><div style={{ display: 'flex', gap: 8, marginTop: 8 }}><input id="staking-amount" className="field" type="number" min="0" max={balances.purchased} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /><button className="button button-primary" onClick={submit} disabled={stake.isPending || !amount}>{stake.isPending ? 'Confirming…' : 'Confirm stake'}</button></div></div> : <div className="empty-state"><Layers3 size={22} style={{ margin: '0 auto 10px' }} /><div>Ready when you are.</div><p>Open the stake form to lock acquired BITS into a reward position.</p></div>}<div className="callout" style={{ marginTop: 20 }}>Staking updates your verified portal position. On-chain execution is gated until the protocol contract is enabled.</div></section><section className="panel content-card"><div className="card-heading"><div><h3>Position rules</h3><p>Know what each balance means.</p></div><FileClock size={16} color="#f7931a" /></div><div className="switch-row"><span className="switch-copy"><strong>Acquired BITS</strong><span>Can be moved into staking</span></span><Status value="available" /></div><div className="switch-row"><span className="switch-copy"><strong>Staked BITS</strong><span>Locked principal</span></span><Status value="locked" /></div><div className="switch-row"><span className="switch-copy"><strong>Rewards</strong><span>Eligible for conversion to USDT</span></span><Status value="claimable" /></div></section></div>{notice}</AppShell>;
}

function TeamPage({ account }: { account: UserAccount }) { const { notify, notice } = useNotice(); const [copied, setCopied] = useState(false); const link = `${window.location.origin}/sign-up?ref=${encodeURIComponent(account.id)}`; const copy = async () => { await navigator.clipboard?.writeText(link); setCopied(true); notify('Team invite link copied.'); }; return <AppShell active="/team" admin={account.role === 'admin'}><div className="page-title-row"><div><h1 className="page-title">Team</h1><p className="page-subtitle">Build your network and see the contribution path behind your future airdrop position.</p></div><button className="button button-primary" onClick={copy}><Copy size={15} />{copied ? 'Copied' : 'Copy invite link'}</button></div><div className="cards-4"><Metric label="Team size" value="0" foot="Direct invites" icon={<Users size={15} />} /><Metric label="Team XP" value="0 XP" foot="Network contribution" icon={<Sparkles size={15} />} /><Metric label="Your code" value={account.id.slice(0, 8).toUpperCase()} foot="Share with your team" icon={<LinkIcon size={15} />} /><Metric label="Status" value="Open" foot="Invite your first member" icon={<BadgeCheck size={15} />} /></div><div className="dashboard-grid"><section className="panel content-card"><div className="card-heading"><div><h3>Your invite rail</h3><p>Every member enters through one attributable referral path.</p></div><Users size={16} color="#f7931a" /></div><div className="address-box" style={{ marginBottom: 16 }}>{link}</div><button className="button button-ghost" onClick={copy}><Copy size={14} /> Copy referral link</button></section><section className="panel content-card"><div className="card-heading"><div><h3>Team rules</h3><p>Clear separation between activity and rewards.</p></div><ShieldCheck size={16} color="#f7931a" /></div><div className="switch-row"><span className="switch-copy"><strong>Direct referrals</strong><span>Count toward your network</span></span><Status value="tracked" /></div><div className="switch-row"><span className="switch-copy"><strong>XP contribution</strong><span>Tracked for airdrop eligibility</span></span><Status value="tracked" /></div></section></div>{notice}</AppShell>; }

function ActivityPage({ account }: { account: UserAccount }) { const activity = useGetMyActivity(); return <AppShell active="/activity" admin={account.role === 'admin'}><div className="page-title-row"><div><h1 className="page-title">Activity</h1><p className="page-subtitle">A complete record of deposits, staking, referrals, and account events.</p></div></div><section className="panel content-card"><div className="card-heading"><div><h3>Account timeline</h3><p>Events are read from the portal ledger.</p></div><Activity size={16} color="#f7931a" /></div><ActivityList rows={activity.data} loading={activity.isLoading} error={activity.isError} retry={() => void activity.refetch()} /></section></AppShell>; }

function DocsPage() { return <div className="site-shell landing docs-page"><PublicHeader /><main className="section"><div className="eyebrow" style={{ color: '#f7931a' }}>BITNOIR / WHITEPAPER INDEX</div><h1 className="display" style={{ marginTop: 20 }}>A Bitcoin-vibe<br />abstract layer.</h1><div className="docs-grid"><article className="panel content-card"><span className="step-num">01 / VISION</span><h3>Multichain abstraction</h3><p>Bitnoir coordinates capital, positions, and rewards across supported networks while keeping the user experience network-aware.</p></article><article className="panel content-card"><span className="step-num">02 / DISTRIBUTION</span><h3>Fair launch event</h3><p>Distribution is visible by batch, price, allocation, and supply. The portal is the source of truth for participation.</p></article><article className="panel content-card"><span className="step-num">03 / STAKING</span><h3>Lock to earn</h3><p>BITS becomes productive only after staking. Earned rewards may later be converted to USDT under the configured policy.</p></article><article className="panel content-card"><span className="step-num">04 / COMMUNITY</span><h3>XP as airdrop position</h3><p>Referral XP is tracked independently for users who have not acquired BITS, preserving a path into future community distribution.</p></article></div></main></div>; }

function PortalRoute({ path, page }: { path: string; page: 'deposit' | 'referrals' | 'staking' | 'withdraw' | 'activity' | 'team' }) {
  return <Route path={path}>{() => <ProtectedGate>{(account) => page === 'deposit' ? <DepositsPage account={account} /> : page === 'referrals' ? <ReferralsPage account={account} /> : page === 'withdraw' ? <WithdrawPage account={account} /> : page === 'activity' ? <ActivityPage account={account} /> : page === 'team' ? <TeamPage account={account} /> : <StakingPage account={account} />}</ProtectedGate>}</Route>;
}

function App() {
  return <AuthProvider><QueryClientProvider client={queryClient}><WouterRouter base={basePath}><ReferralBootstrap /><RoutedErrorBoundary><Switch>
    <Route path="/" component={HomePage} />
    <Route path="/sign-in/*?" component={SignInPage} />
    <Route path="/sign-up/*?" component={SignUpPage} />
    <Route path="/docs" component={DocsPage} />
    <Route path="/dashboard">{() => <ProtectedGate>{() => <Redirect to="/deposit" />}</ProtectedGate>}</Route>
    <PortalRoute path="/deposit" page="deposit" />
    <PortalRoute path="/staking" page="staking" />
    <PortalRoute path="/withdraw" page="withdraw" />
    <PortalRoute path="/referrals" page="referrals" />
    <PortalRoute path="/activity" page="activity" />
    <PortalRoute path="/team" page="team" />
    <Route path="/admin">{() => <ProtectedGate admin>{(account) => <AdminPage account={account} />}</ProtectedGate>}</Route>
    <Route component={NotFound} />
  </Switch></RoutedErrorBoundary></WouterRouter></QueryClientProvider></AuthProvider>;
}

export default App;
