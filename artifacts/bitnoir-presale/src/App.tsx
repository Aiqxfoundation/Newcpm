import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3, BookOpen, Check,
  ChevronDown, ChevronRight, Coins, Copy, ExternalLink, FileClock, Flame, Globe2, Hammer, HelpCircle, Info,
  Landmark, Layers3, Link as LinkIcon, Lock, LockKeyhole, LogOut, Menu, PieChart, Plus, QrCode, Radio, RefreshCw,
  ScrollText, Search, Send, ShieldAlert, ShieldCheck, Sliders, Sparkles, Timer, TrendingUp, Trophy, Users, Wallet, X, Zap,
} from 'lucide-react';
import {
  getGetAdminAddressesQueryKey, getGetAdminDepositsQueryKey, getGetAdminSummaryQueryKey,
  getGetDepositAddressesQueryKey,
  getGetMyAccountQueryKey, getGetMyActivityQueryKey, getGetMyDepositsQueryKey,
  getGetPresaleOverviewQueryKey, useCreateDeposit,
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
import {
  fetchSolBalance,
  sendSolanaTransactionOnchain,
  getSavedMiningPass,
  saveMiningPass,
  getSavedSolPower,
  addSavedSolPower,
  type MiningPassData,
  PROTOCOL_TREASURY_SOLANA,
} from './lib/solana';
import { WhitepaperView } from '@/pages/Whitepaper';
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
  return (
    <img
      src="/bits-clean.png"
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
        imageRendering: 'auto',
        flexShrink: 0,
      }}
    />
  );
}

// PHANTOM & SOLANA LOGOS
function PhantomLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="128" height="128" rx="28" fill="#AB9FF2" />
      <path d="M103.5 66.5C103.5 88.3152 85.8152 106 64 106C42.1848 106 24.5 88.3152 24.5 66.5C24.5 44.6848 42.1848 27 64 27C85.8152 27 103.5 44.6848 103.5 66.5Z" fill="#2C2D30" />
      <path d="M78.5 73.5C78.5 76.5376 76.0376 79 73 79C69.9624 79 67.5 76.5376 67.5 73.5C67.5 70.4624 69.9624 68 73 68C76.0376 68 78.5 70.4624 78.5 73.5Z" fill="#FFF" />
      <path d="M54.5 73.5C54.5 76.5376 52.0376 79 49 79C45.9624 79 43.5 76.5376 43.5 73.5C43.5 70.4624 45.9624 68 49 68C52.0376 68 54.5 70.4624 54.5 73.5Z" fill="#FFF" />
    </svg>
  );
}

function SolanaLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 397 311" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7zM64.6 3.8C67 1.4 70.3 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8zM332.4 120.8c-2.4-2.4-5.7-3.8-9.2-3.8H5.8c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#solana_grad)" />
      <defs>
        <linearGradient id="solana_grad" x1="396.9" y1="0" x2="0" y2="311.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

interface SolanaProvider {
  isPhantom?: boolean;
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString: () => string } }>;
  disconnect: () => Promise<void>;
  publicKey?: { toString: () => string };
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
}

function getSolanaProvider(): SolanaProvider | null {
  if (typeof window === 'undefined') return null;
  const anyWin = window as unknown as { phantom?: { solana?: SolanaProvider }; solana?: SolanaProvider };
  if (anyWin.phantom?.solana?.isPhantom) return anyWin.phantom.solana;
  if (anyWin.solana?.isPhantom) return anyWin.solana;
  if (anyWin.solana) return anyWin.solana;
  return null;
}

function shortSolanaAddress(addr: string): string {
  if (!addr) return '';
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

// AUTH CONTEXT: Phantom Solana Wallet Public Address Architecture
type AuthUser = {
  id: string; // The Solana base58 public address
  solanaAddress: string;
  name: string; // Formatted handle e.g. @7xKp...3a9B
  username: string; // Short address
  email: string;
  isAdmin?: boolean;
};

const AuthContext = createContext<{
  user: AuthUser | null;
  ready: boolean;
  connectWallet: (customAddress?: string) => Promise<string>;
  disconnectWallet: () => Promise<void>;
  signIn: (address?: string) => Promise<void>;
  signUp: (username?: string, password?: string, referral?: string) => Promise<string>;
  signOut: () => void;
}>({
  user: null,
  ready: false,
  connectWallet: async () => '',
  disconnectWallet: async () => undefined,
  signIn: async () => undefined,
  signUp: async () => '',
  signOut: () => undefined,
});

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 1. Check existing saved Solana public address from localStorage
    const saved = localStorage.getItem('bitnoir-solana-address');
    if (saved && saved.length >= 32) {
      const short = shortSolanaAddress(saved);
      setUser({
        id: saved,
        solanaAddress: saved,
        username: short,
        name: `@${short}`,
        email: '',
        isAdmin: false,
      });
      setReady(true);
      return;
    }

    // 2. Try silent auto-connect if Phantom was already connected and trusted
    const provider = getSolanaProvider();
    if (provider && provider.connect) {
      provider
        .connect({ onlyIfTrusted: true })
        .then((resp) => {
          const address = resp.publicKey.toString();
          localStorage.setItem('bitnoir-solana-address', address);
          const short = shortSolanaAddress(address);
          setUser({
            id: address,
            solanaAddress: address,
            username: short,
            name: `@${short}`,
            email: '',
            isAdmin: false,
          });
        })
        .catch(() => {
          setUser(null);
        })
        .finally(() => {
          setReady(true);
        });
    } else {
      setUser(null);
      setReady(true);
    }
  }, []);

  const connectWallet = async (customAddress?: string): Promise<string> => {
    let address = customAddress?.trim();
    if (!address) {
      const provider = getSolanaProvider();
      if (!provider) {
        throw new Error('PHANTOM_NOT_INSTALLED');
      }
      const resp = await provider.connect();
      if (!resp?.publicKey) {
        throw new Error('Failed to retrieve Solana public address from wallet.');
      }
      address = resp.publicKey.toString();
    }

    if (address.length < 32 || address.length > 44) {
      throw new Error('Please provide a valid Solana public address (32-44 characters).');
    }

    localStorage.setItem('bitnoir-solana-address', address);
    const short = shortSolanaAddress(address);
    const authUser: AuthUser = {
      id: address,
      solanaAddress: address,
      username: short,
      name: `@${short}`,
      email: '',
      isAdmin: false,
    };
    setUser(authUser);
    return address;
  };

  const disconnectWallet = async () => {
    try {
      const provider = getSolanaProvider();
      if (provider && provider.disconnect) {
        await provider.disconnect();
      }
    } catch {
      // Ignore disconnect error
    }
    localStorage.removeItem('bitnoir-solana-address');
    sessionStorage.removeItem('bitnoir-session-token');
    setUser(null);
  };

  const signIn = async (address?: string) => {
    await connectWallet(address);
  };

  const signUp = async (username?: string) => {
    return await connectWallet(username);
  };

  const signOut = () => {
    void disconnectWallet();
  };

  return (
    <AuthContext.Provider value={{ user, ready, connectWallet, disconnectWallet, signIn, signUp, signOut }}>
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

// ---------------------------------------------------------------------------
// PROPER TOP OF WALLET CONNECT SYSTEM
// ---------------------------------------------------------------------------
function TopWalletConnect({ compact = false }: { compact?: boolean }) {
  const { user, connectWallet, disconnectWallet } = useAuth();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [passData, setPassData] = useState<MiningPassData | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.solanaAddress) {
      fetchSolBalance(user.solanaAddress).then(setSolBalance);
      const pass = getSavedMiningPass(user.solanaAddress);
      setPassData(pass);
    } else {
      setSolBalance(null);
      setPassData(null);
    }
  }, [user?.solanaAddress]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const addr = await connectWallet();
      toast({
        title: 'Phantom Connected',
        description: `Connected with @${shortSolanaAddress(addr)}`,
      });
    } catch (err: any) {
      if (err?.message === 'PHANTOM_NOT_INSTALLED') {
        const demoAddr = 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK';
        await connectWallet(demoAddr);
        toast({
          title: 'Demo Wallet Connected',
          description: `Connected as @${shortSolanaAddress(demoAddr)}`,
        });
      } else {
        toast({
          title: 'Connection error',
          description: readableError(err, 'Could not connect wallet.'),
          variant: 'destructive',
        });
      }
    } finally {
      setConnecting(false);
    }
  };

  if (!user || !user.solanaAddress) {
    return (
      <button
        type="button"
        onClick={handleConnect}
        disabled={connecting}
        className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#00f59b]/15 hover:bg-[#00f59b]/25 border border-[#00f59b]/40 text-[#00f59b] text-xs font-bold transition-all cursor-pointer shadow-sm"
      >
        <Wallet size={13} />
        <span>{connecting ? 'Connecting…' : 'Connect Wallet'}</span>
      </button>
    );
  }

  const shortAddr = shortSolanaAddress(user.solanaAddress);
  const usernameDisplay = user.username && !user.username.startsWith('DYw8') && !user.username.includes('...')
    ? user.username.replace(/^@/, '')
    : shortAddr;

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }} ref={dropdownRef}>
      {/* WALLET BUTTON */}
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.12] text-white text-xs font-mono font-medium transition-all cursor-pointer shadow-sm"
      >
        <div className="w-5 h-5 rounded-full bg-[#00f59b]/15 border border-[#00f59b]/30 flex items-center justify-center text-[#00f59b]">
          <Wallet size={11} />
        </div>
        <span>{usernameDisplay}</span>
        <ChevronDown size={12} className={`text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* DROPDOWN POPOVER */}
      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 285,
            background: '#0c121f',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 14,
            padding: 14,
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.75)',
            zIndex: 100,
            textAlign: 'left',
          }}
        >
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Connected Solana Public Key
          </div>
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#00f59b', wordBreak: 'break-all', marginBottom: 12 }}>
            {user.solanaAddress}
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button
              type="button"
              className="button button-soft !min-h-[30px] !text-xs !px-2.5 !py-1 !rounded-md"
              onClick={() => {
                void navigator.clipboard?.writeText(user.solanaAddress);
                toast({ title: 'Copied', description: 'Solana address copied to clipboard.' });
              }}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              <Copy size={12} />
              <span>Copy</span>
            </button>
            <a
              href={`https://solscan.io/account/${user.solanaAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="button button-soft !min-h-[30px] !text-xs !px-2.5 !py-1 !rounded-md"
              style={{ flex: 1, justifyContent: 'center', textDecoration: 'none' }}
            >
              <ExternalLink size={12} />
              <span>Solscan</span>
            </a>
          </div>

          <div style={{ padding: '8px 10px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 8, marginBottom: 12, fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: '#94a3b8' }}>Mining Pass:</span>
              <strong style={{ color: passData ? '#00f59b' : '#ff8b2f' }}>
                {passData ? 'Active (Verified)' : '0.02 SOL Required'}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Network:</span>
              <span style={{ color: '#ffffff' }}>Solana Onchain</span>
            </div>
          </div>

          <Link
            href="/wallet"
            onClick={() => setMenuOpen(false)}
            className="button button-soft !min-h-[34px] !text-xs !w-full !mb-2.5 !border-[#00f59b]/35 !text-[#00f59b] hover:!bg-[#00f59b]/10"
            style={{ width: '100%', justifyContent: 'center', textDecoration: 'none' }}
          >
            <Wallet size={13} />
            <span>Open Wallet & Balances</span>
          </Link>

          <button
            type="button"
            className="button button-soft !min-h-[32px] !text-xs !w-full"
            onClick={() => {
              void disconnectWallet();
              setMenuOpen(false);
            }}
            style={{ color: 'var(--danger)', width: '100%', justifyContent: 'center' }}
          >
            <LogOut size={13} />
            <span>Disconnect Wallet</span>
          </button>
        </div>
      )}
    </div>
  );
}

// Navigation Bar for Landing & Docs with Proper Top Of Wallet Connect System
function PublicHeader({ hideSignIn = false }: { hideSignIn?: boolean }) {
  const [location] = useLocation();

  return (
    <header className="topbar" data-page-header>
      <Link href="/" aria-label="Bitnoir Home">
        <Brand />
      </Link>
      <nav className="nav-links" aria-label="Main Navigation">
        <Link href="/" className={location === '/' ? 'active' : ''}>Overview</Link>
        <Link href="/staking" className={location === '/staking' || location === '/mining' ? 'active' : ''}>Bits Mining</Link>
        <Link href="/docs" className={location === '/docs' || location === '/whitepaper' ? 'active' : ''}>Whitepaper</Link>
      </nav>
      <div className="top-actions">
        <TopWalletConnect />
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
          <text x="865" y="114" textAnchor="middle" fill="#00f59b" fontSize="10" fontWeight="bold" fontFamily="monospace">BITNOIR</text>
        </g>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STAKING YIELD CURVE VISUALIZER (30D - 90D APY CURVE)
// ---------------------------------------------------------------------------
function StakingYieldCurve({ duration, rewardRate }: { duration: number; rewardRate: number }) {
  const pct = Math.max(0, Math.min(100, ((duration - 30) / (90 - 30)) * 100));
  const svgWidth = 400;
  const svgHeight = 64;
  const paddingX = 16;
  const paddingY = 12;
  const innerW = svgWidth - paddingX * 2;
  const innerH = svgHeight - paddingY * 2;

  const points = [30, 45, 60, 75, 90].map((d) => {
    const x = paddingX + ((d - 30) / 60) * innerW;
    const r = rewardRateForDays(d);
    const norm = (r - 0.01) / (0.03 - 0.01);
    const y = paddingY + innerH - norm * innerH;
    return { d, r, x, y };
  });

  const pathD = points.reduce((acc, pt, i) => {
    return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
  }, '');

  const areaD = `${pathD} L ${points[points.length - 1].x} ${svgHeight - 4} L ${points[0].x} ${svgHeight - 4} Z`;

  const currentX = paddingX + (pct / 100) * innerW;
  const currentNorm = Math.max(0, Math.min(1, (rewardRate - 0.01) / (0.03 - 0.01)));
  const currentY = paddingY + innerH - currentNorm * innerH;

  return (
    <div className="relative w-full my-2 bg-[#050910] rounded-xl border border-white/5 p-2 overflow-hidden">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full h-14 overflow-visible"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="yieldCurveGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00f59b" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#00f59b" stopOpacity="0.0" />
          </linearGradient>
          <filter id="glowDot" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#00f59b" />
          </filter>
        </defs>

        <path d={areaD} fill="url(#yieldCurveGrad)" />

        <line
          x1={paddingX}
          y1={svgHeight - 4}
          x2={svgWidth - paddingX}
          y2={svgHeight - 4}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="1"
        />

        <path
          d={pathD}
          fill="none"
          stroke="#00f59b"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((pt) => (
          <circle
            key={pt.d}
            cx={pt.x}
            cy={pt.y}
            r="3"
            fill="#0a121e"
            stroke="#00f59b"
            strokeWidth="1.5"
            opacity="0.6"
          />
        ))}

        <line
          x1={currentX}
          y1={paddingY}
          x2={currentX}
          y2={svgHeight - 4}
          stroke="#00f59b"
          strokeWidth="1.5"
          strokeDasharray="2 2"
          opacity="0.8"
        />
        <circle
          cx={currentX}
          cy={currentY}
          r="5.5"
          fill="#00f59b"
          stroke="#04120c"
          strokeWidth="2"
          filter="url(#glowDot)"
        />
      </svg>
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-2 mt-0.5">
        <span>30D (+1.0%)</span>
        <span>60D (+2.0%)</span>
        <span>90D (+3.0%)</span>
      </div>
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
  const [solSim, setSolSim] = useState<number>(1.0);
  const simBoost = solSim * 5.0;
  const simTotalRate = 0.1 + simBoost;
  const simDailyOutput = simTotalRate * 24;

  return (
    <div className="site-shell landing-tier1">
      <div className="landing-matrix-bg" />
      <div className="landing-aurora-glow" />

      <PublicHeader hideSignIn />

      <main>
        {/* 1. HERO SECTION */}
        <section className="hero-tier1">
          <div className="hero-copy-tier1">
            <div className="eyebrow" style={{ borderColor: 'rgba(0, 245, 155, 0.4)', background: 'rgba(0, 245, 155, 0.06)' }}>
              <span className="eyebrow-dot" />
              Solana Native Proof-of-Power · 0.02 SOL Onchain Pass
            </div>
            <h1>
              Decentralized Mining <br />
              <span className="highlight-green">On Solana.</span>
            </h1>
            <p>
              The first Solana Proof-of-Power protocol. Connect your Phantom wallet, mint your unique
              onchain Mining Pass (<strong>0.02 SOL fee</strong>) to verify your account, and stream continuous Bits rewards.
              Boost your hashrate with onchain SOL Power.
            </p>
            <div className="hero-actions">
              <Link href="/staking" className="button button-primary hero-primary-action">
                <Sparkles size={16} />
                <span>Mint Mining Pass (0.02 SOL)</span>
                <ArrowRight size={15} />
              </Link>
              <Link href="/wallet" className="button button-soft">
                <Wallet size={15} />
                <span>Launch Wallet</span>
              </Link>
              <Link href="/docs" className="button button-ghost">
                <BookOpen size={15} />
                <span>Whitepaper v3.5</span>
              </Link>
            </div>
            <div className="trustline">
              <span><i className="trustline-dot" /> 0.02 SOL Unique Mining Pass</span>
              <span><i className="trustline-dot" /> +5.0 Bits/hr per SOL Power</span>
              <span><i className="trustline-dot" /> 21,000,000 Hard Cap ($Noir)</span>
              <span><i className="trustline-dot" /> 100% Onchain Solana RPC</span>
            </div>
          </div>

          <div className="hero-stage-tier1" aria-label="Solana Proof-of-Power Stage">
            <img
              src="/hero-quantum-lattice.jpg"
              alt="Solana Cryptographic Lattice"
              className="hero-stage-bg"
            />
            <div className="hero-stage-overlay" />

            {/* Glowing Concentric Orbital Rings */}
            <svg viewBox="0 0 400 400" className="absolute w-[360px] h-[360px] pointer-events-none opacity-40 animate-spin" style={{ animationDuration: '60s' }}>
              <circle cx="200" cy="200" r="140" stroke="#00f59b" strokeWidth="1" strokeDasharray="4 6" fill="none" />
              <circle cx="200" cy="200" r="170" stroke="rgba(120,87,255,0.4)" strokeWidth="1" strokeDasharray="8 8" fill="none" />
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
                  alt="Bits Mining Unit"
                  width={80}
                  height={80}
                  className="w-[74px] h-[74px] object-contain"
                />
              </div>
            </div>

            <div className="hero-live-badge" style={{ borderColor: 'rgba(120, 87, 255, 0.4)', background: 'rgba(13, 19, 31, 0.85)' }}>
              <SolanaLogo size={14} />
              <span className="w-2 h-2 rounded-full bg-[#00f59b] animate-ping" />
              <span>SOLANA PROOF-OF-POWER LIVE</span>
            </div>
          </div>
        </section>

        {/* 2. LIVE TELEMETRY METRIC RIBBON */}
        <section className="telemetry-ribbon">
          <div className="telemetry-box">
            <div className="telemetry-cell">
              <div className="telemetry-cell-val tabular-nums text-[#00f59b]">0.1000 /hr</div>
              <div className="telemetry-cell-sub">Base Mining Hashrate</div>
            </div>
            <div className="telemetry-cell">
              <div className="telemetry-cell-val text-[#ff8b2f] tabular-nums">0.02 SOL</div>
              <div className="telemetry-cell-sub">Mining Pass Fee (Onchain)</div>
            </div>
            <div className="telemetry-cell">
              <div className="telemetry-cell-val text-[#ab9ff2] tabular-nums">+5.0000 /hr</div>
              <div className="telemetry-cell-sub">SOL Power Hashrate (per SOL)</div>
            </div>
            <div className="telemetry-cell">
              <div className="telemetry-cell-val tabular-nums">21,000,000</div>
              <div className="telemetry-cell-sub">Fixed Supply Cap ($Noir)</div>
            </div>
            <div className="telemetry-cell">
              <div className="telemetry-cell-val text-white">SPL-2022 Claim</div>
              <div className="telemetry-cell-sub">Token Generation Event</div>
            </div>
          </div>
        </section>

        {/* 3. 3-STEP ONCHAIN MINING FLOW */}
        <section className="landing-section">
          <div className="landing-section-head">
            <div className="eyebrow">Proof-of-Power Architecture</div>
            <h2>How Mining Works On Solana</h2>
            <p>
              Fair, transparent, and completely non-custodial. Every miner verifies onchain and begins accumulating Bits.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            {/* STEP 1 */}
            <div
              style={{
                padding: 24,
                borderRadius: 16,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
                border: '1px solid rgba(255,255,255,0.08)',
                position: 'relative',
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(120, 87, 255, 0.15)', display: 'grid', placeItems: 'center', marginBottom: 16, color: '#ab9ff2' }}>
                <PhantomLogo size={22} />
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 4 }}>
                Step 01
              </div>
              <h3 style={{ fontSize: 18, color: '#ffffff', fontWeight: 700, margin: '0 0 10px' }}>
                Connect Phantom Wallet
              </h3>
              <p style={{ fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.6, margin: 0 }}>
                Instant one-click connection with your Solana public address. No emails, no passwords, and strictly zero private keys collected.
              </p>
            </div>

            {/* STEP 2 */}
            <div
              style={{
                padding: 24,
                borderRadius: 16,
                background: 'linear-gradient(180deg, rgba(0,245,155,0.04) 0%, rgba(255,255,255,0.01) 100%)',
                border: '1px solid rgba(0,245,155,0.25)',
                position: 'relative',
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(0, 245, 155, 0.15)', display: 'grid', placeItems: 'center', marginBottom: 16, color: '#00f59b' }}>
                <Sparkles size={22} />
              </div>
              <div style={{ fontSize: 11, color: '#00f59b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 4 }}>
                Step 02 · Required
              </div>
              <h3 style={{ fontSize: 18, color: '#ffffff', fontWeight: 700, margin: '0 0 10px' }}>
                Mint Mining Pass (0.02 SOL)
              </h3>
              <p style={{ fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.6, margin: 0 }}>
                Send 0.02 SOL verification fee to the protocol treasury onchain. Solana public RPC validates the signature and issues your unique, soulbound Pass ID (#BN-SOL-XXXX).
              </p>
            </div>

            {/* STEP 3 */}
            <div
              style={{
                padding: 24,
                borderRadius: 16,
                background: 'linear-gradient(180deg, rgba(255,139,47,0.04) 0%, rgba(255,255,255,0.01) 100%)',
                border: '1px solid rgba(255,139,47,0.25)',
                position: 'relative',
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255, 139, 47, 0.15)', display: 'grid', placeItems: 'center', marginBottom: 16, color: '#ff8b2f' }}>
                <Flame size={22} />
              </div>
              <div style={{ fontSize: 11, color: '#ff8b2f', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 4 }}>
                Step 03
              </div>
              <h3 style={{ fontSize: 18, color: '#ffffff', fontWeight: 700, margin: '0 0 10px' }}>
                Mine Bits & Boost SOL Power
              </h3>
              <p style={{ fontSize: 13, color: 'var(--silver-medium)', lineHeight: 1.6, margin: 0 }}>
                Stream continuous Bits into your 24-hour storage tank. Overclock hashrate by contributing SOL Power onchain (+5.0 Bits/hr per SOL). Claim 1:1 onchain at TGE.
              </p>
            </div>
          </div>
        </section>

        {/* 4. INTERACTIVE SOL POWER SIMULATOR */}
        <section className="landing-section">
          <div className="landing-section-head">
            <div className="eyebrow">Real-Time Hashrate Calculator</div>
            <h2>SOL Power Hashrate Multiplier</h2>
            <p>
              Preview how contributing SOL to the onchain protocol treasury accelerates your Bits mining velocity.
            </p>
          </div>

          <div
            style={{
              maxWidth: 720,
              margin: '0 auto',
              padding: 28,
              borderRadius: 20,
              background: '#0d131f',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Simulate Contributed SOL
              </span>
              <span style={{ fontSize: 16, fontFamily: 'monospace', fontWeight: 800, color: '#ff8b2f', background: 'rgba(255,139,47,0.1)', padding: '4px 10px', borderRadius: 8 }}>
                ◎ {solSim.toFixed(1)} SOL
              </span>
            </div>

            <input
              type="range"
              min="0.1"
              max="5.0"
              step="0.1"
              value={solSim}
              onChange={(e) => setSolSim(Number(e.target.value))}
              className="modern-range-line"
              style={{ width: '100%', marginBottom: 20 }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
              <div style={{ padding: 14, background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Base Engine</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#00f59b', fontFamily: 'monospace' }}>+0.1000 /h</div>
              </div>
              <div style={{ padding: 14, background: 'rgba(255,139,47,0.05)', borderRadius: 12, border: '1px solid rgba(255,139,47,0.2)', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#ff8b2f', marginBottom: 4 }}>SOL Power Boost</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#ff8b2f', fontFamily: 'monospace' }}>+{simBoost.toFixed(4)} /h</div>
              </div>
              <div style={{ padding: 14, background: 'rgba(0,245,155,0.05)', borderRadius: 12, border: '1px solid rgba(0,245,155,0.25)', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#00f59b', marginBottom: 4 }}>Total Net Hashrate</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#ffffff', fontFamily: 'monospace' }}>{simTotalRate.toFixed(4)} /h</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, marginBottom: 20 }}>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>Estimated 24-Hour Yield:</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: '#00f59b', fontFamily: 'monospace' }}>
                +{simDailyOutput.toFixed(2)} Bits / day
              </span>
            </div>

            <Link
              href="/staking"
              className="button button-primary"
              style={{ width: '100%', minHeight: 48, justifyContent: 'center', fontSize: 14, fontWeight: 700 }}
            >
              <Zap size={16} />
              <span>Mint Pass & Acquire SOL Power</span>
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>

        {/* 5. DUAL TOKEN DYNAMICS */}
        <section className="landing-section">
          <div className="landing-section-head">
            <div className="eyebrow">Token Architecture</div>
            <h2>Dual-Token Economic Equilibrium</h2>
            <p>
              Separating daily mining incentives from long-term digital store-of-value scarcity.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
            {/* BITS */}
            <div style={{ padding: 26, background: '#0d131f', borderRadius: 18, border: '1px solid rgba(0,245,155,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <BitsMark size={32} />
                <div>
                  <h3 style={{ margin: 0, fontSize: 20, color: '#ffffff', fontWeight: 800 }}>Bits</h3>
                  <span style={{ fontSize: 12, color: '#00f59b', fontWeight: 600 }}>Utility & Mining Reward Unit</span>
                </div>
              </div>
              <p style={{ fontSize: 13.5, color: '#94a3b8', lineHeight: 1.6, marginBottom: 16 }}>
                Bits are earned continuously through active Proof-of-Power mining. Can be transferred peer-to-peer between miners, converted into Bitnoir, and claimed onchain at Token Generation Event (TGE).
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, fontFamily: 'monospace' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span>Mining Emission:</span>
                  <strong style={{ color: '#00f59b' }}>Base 0.1000 /hr</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span>Transferability:</span>
                  <strong style={{ color: '#ffffff' }}>Instant P2P</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span>Onchain Settlement:</span>
                  <strong style={{ color: '#38bdf8' }}>Solana SPL-2022 Claim</strong>
                </div>
              </div>
            </div>

            {/* BITNOIR */}
            <div style={{ padding: 26, background: '#0d131f', borderRadius: 18, border: '1px solid rgba(245,166,35,0.25)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <img src="/asset-bitnoir.png" alt="Bitnoir" style={{ width: 34, height: 34, objectFit: 'contain' }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: 20, color: '#ffffff', fontWeight: 800 }}>Bitnoir</h3>
                  <span style={{ fontSize: 12, color: '#f5a623', fontWeight: 600 }}>21,000,000 Hard Cap Governance</span>
                </div>
              </div>
              <p style={{ fontSize: 13.5, color: '#94a3b8', lineHeight: 1.6, marginBottom: 16 }}>
                The cryptographic store of value. Strictly capped at 21,000,000 units with zero inflation. Built with deflationary burn-to-convert tokenomics and withdrawable directly to connected Solana wallets.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, fontFamily: 'monospace' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span>Total Maximum Supply:</span>
                  <strong style={{ color: '#f5a623' }}>21,000,000 Fixed</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span>Inflation Rate:</span>
                  <strong style={{ color: '#00f59b' }}>0.00% (Hard Capped)</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span>Withdrawals:</span>
                  <strong style={{ color: '#ab9ff2' }}>Solana Native Wallet</strong>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 6. GATEWAY LAUNCHPAD CTA */}
        <section className="landing-gateway">
          <div className="gateway-card">
            <div className="max-w-xl mx-auto">
              <div className="eyebrow mb-2">Protocol Access</div>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Start Mining Bits on Solana Today
              </h2>
              <p className="text-slate-300 text-sm md:text-base mb-8 leading-relaxed">
                Connect your Phantom wallet, mint your verified onchain Mining Pass for 0.02 SOL, and start accumulating continuous Bits rewards.
              </p>
              <div className="flex items-center justify-center gap-4 flex-wrap">
                <Link href="/staking" className="button button-primary !px-7 !py-3 text-sm">
                  <Sparkles size={16} />
                  <span>Mint Mining Pass (0.02 SOL)</span>
                  <ArrowRight size={16} />
                </Link>
                <Link href="/docs" className="button button-ghost !px-7 !py-3 text-sm">
                  <BookOpen size={16} />
                  <span>Read Whitepaper v3.5</span>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <Brand size="sm" />
        <span>Bitnoir Protocol · Solana Native Proof-of-Power · 21,000,000 Fixed Cap ($Noir)</span>
        <span>Participation involves market and smart-contract risk. Review disclosures carefully.</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. WHITEPAPER & TECHNICAL SPECIFICATIONS (/docs, /whitepaper)
// ---------------------------------------------------------------------------
function DocsPage() {
  return <WhitepaperView PublicHeader={PublicHeader} Brand={Brand} BitsMark={BitsMark} />;
}

// ---------------------------------------------------------------------------
// 3. AUTHENTICATION PAGES
// ---------------------------------------------------------------------------
function AuthCard({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [, setLocation] = useLocation();
  const { user, connectWallet, disconnectWallet } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [manualAddress, setManualAddress] = useState('');

  const handlePhantomConnect = async () => {
    setError('');
    setConnecting(true);
    try {
      const address = await connectWallet();
      toast({
        title: 'Wallet Connected',
        description: `Connected with Phantom: @${shortSolanaAddress(address)}`,
      });
      setLocation('/wallet');
    } catch (err) {
      if (err instanceof Error && err.message === 'PHANTOM_NOT_INSTALLED') {
        setError(
          'Phantom wallet extension not detected in this browser window. Connect with Demo Solana Wallet or paste your Solana public address below.'
        );
        setShowManual(true);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to connect Phantom wallet.');
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleDemoConnect = async (demoAddress = 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK') => {
    setError('');
    setConnecting(true);
    try {
      await connectWallet(demoAddress);
      toast({
        title: 'Demo Wallet Connected',
        description: `Connected as @${shortSolanaAddress(demoAddress)}`,
      });
      setLocation('/wallet');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect demo wallet.');
    } finally {
      setConnecting(false);
    }
  };

  const handleManualSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = manualAddress.trim();
    if (!clean) {
      setError('Please enter your Solana public address.');
      return;
    }

    // Safety check: Reject private keys, mnemonic seed phrases, or hex strings
    if (clean.includes(' ') || clean.length > 50 || clean.startsWith('0x') && clean.length === 66) {
      setError('Security notice: Never enter private keys or seed phrases! Enter only your public Solana address.');
      return;
    }

    // Solana base58 check
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    if (!base58Regex.test(clean)) {
      setError('Invalid Solana address format. A valid Solana public key is 32-44 base58 characters.');
      return;
    }

    setError('');
    setConnecting(true);
    try {
      await connectWallet(clean);
      toast({
        title: 'Solana Wallet Linked',
        description: `Connected as @${shortSolanaAddress(clean)}`,
      });
      setLocation('/wallet');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link Solana address.');
    } finally {
      setConnecting(false);
    }
  };

  // Already authenticated state
  if (user && user.solanaAddress) {
    return (
      <div className="auth-form" style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(171, 159, 242, 0.2), rgba(120, 87, 255, 0.3))',
            border: '2px solid #7857ff',
            margin: '0 auto 16px',
            display: 'grid',
            placeItems: 'center',
            boxShadow: '0 8px 24px rgba(120, 87, 255, 0.25)',
          }}
        >
          <PhantomLogo size={28} />
        </div>

        <div className="eyebrow" style={{ margin: '0 auto 10px' }}>
          <span className="eyebrow-dot" />
          SOLANA WALLET CONNECTED
        </div>

        <h1 style={{ font: '700 24px var(--app-font-serif)', margin: '0 0 8px', color: '#fff' }}>
          Connected to Bitnoir
        </h1>

        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 12,
            marginBottom: 20,
            textAlign: 'left',
          }}
        >
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Connected Public Address
          </div>
          <div style={{ fontSize: 13, fontFamily: 'monospace', color: '#00f59b', fontWeight: 700, wordBreak: 'break-all' }}>
            {user.solanaAddress}
          </div>
        </div>

        <button
          type="button"
          className="button button-primary"
          onClick={() => setLocation('/wallet')}
          style={{ width: '100%', minHeight: 48, marginBottom: 10 }}
        >
          Open Wallet Dashboard <ArrowRight size={16} />
        </button>

        <button
          type="button"
          className="button button-soft"
          onClick={() => void disconnectWallet()}
          style={{ width: '100%', minHeight: 42, color: 'var(--danger)' }}
        >
          Disconnect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="auth-form">
      {/* HEADER */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(171, 159, 242, 0.2), rgba(120, 87, 255, 0.35))',
            border: '2px solid rgba(171, 159, 242, 0.4)',
            margin: '0 auto 16px',
            display: 'grid',
            placeItems: 'center',
            boxShadow: '0 8px 30px rgba(120, 87, 255, 0.3)',
          }}
        >
          <PhantomLogo size={28} />
        </div>

        <div className="eyebrow" style={{ margin: '0 auto 10px' }}>
          <span className="eyebrow-dot" />
          SOLANA NON-CUSTODIAL AUTH
        </div>
        <h1 style={{ font: '700 26px var(--app-font-serif)', margin: '0 0 6px', color: '#fff' }}>
          {mode === 'sign-up' ? 'Connect Phantom to Join' : 'Connect Phantom Wallet'}
        </h1>
        <p style={{ color: 'var(--silver-medium)', fontSize: 13, margin: 0, lineHeight: 1.5 }}>
          One-click login with your Solana public address. No email, passwords, or registration forms required.
        </p>
      </div>

      {error && (
        <div className="callout error" style={{ marginBottom: 18, fontSize: 12.5, lineHeight: 1.45 }}>
          {error}
        </div>
      )}

      {/* PRIMARY PHANTOM CONNECT BUTTON */}
      <button
        type="button"
        onClick={handlePhantomConnect}
        disabled={connecting}
        style={{
          width: '100%',
          minHeight: 52,
          background: 'linear-gradient(135deg, #ab9ff2 0%, #7857ff 100%)',
          color: '#ffffff',
          fontWeight: 700,
          fontSize: 15,
          borderRadius: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          boxShadow: '0 8px 24px rgba(120, 87, 255, 0.35)',
          border: 'none',
          cursor: connecting ? 'wait' : 'pointer',
          marginBottom: 12,
          transition: 'all 0.15s ease',
        }}
      >
        <PhantomLogo size={22} />
        <span>{connecting ? 'Connecting Phantom…' : 'Connect Phantom Wallet'}</span>
        <ArrowRight size={16} />
      </button>

      {/* QUICK DEMO WALLET CONNECT */}
      <button
        type="button"
        onClick={() => handleDemoConnect()}
        disabled={connecting}
        className="button button-soft"
        style={{
          width: '100%',
          minHeight: 44,
          borderRadius: 12,
          fontSize: 13,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          borderColor: 'rgba(255, 255, 255, 0.1)',
          marginBottom: 16,
        }}
      >
        <SolanaLogo size={16} />
        <span>Quick Connect Demo Solana Wallet</span>
      </button>

      {/* MANUAL SOLANA PUBLIC ADDRESS OPTION */}
      {!showManual ? (
        <div style={{ textAlign: 'center', marginTop: 8, marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => setShowManual(true)}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: 12,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Or connect with Solana Public Key manually
          </button>
        </div>
      ) : (
        <form onSubmit={handleManualSubmit} style={{ marginTop: 8, marginBottom: 16 }}>
          <div className="field-wrap">
            <label className="field-label" htmlFor="solana-public-address" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Solana Public Address (Base58)</span>
              <span style={{ color: '#00f59b' }}>Public Only</span>
            </label>
            <input
              id="solana-public-address"
              className="field mono"
              type="text"
              placeholder="e.g. DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK"
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value.trim())}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </div>
          <button
            type="submit"
            className="button button-soft"
            disabled={connecting}
            style={{ width: '100%', minHeight: 42, borderRadius: 10, fontWeight: 600 }}
          >
            Connect Public Address
          </button>
        </form>
      )}

      {/* NON-CUSTODIAL SAFETY GUARANTEE */}
      <div
        style={{
          marginTop: 8,
          padding: '12px 14px',
          background: 'rgba(0, 245, 155, 0.05)',
          border: '1px solid rgba(0, 245, 155, 0.2)',
          borderRadius: 12,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          textAlign: 'left',
        }}
      >
        <ShieldCheck size={18} color="var(--neon-green)" style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 12, color: 'var(--silver-light)', lineHeight: 1.45 }}>
          <strong style={{ color: '#00f59b', display: 'block', marginBottom: 2 }}>Non-Custodial & Secure</strong>
          This app only reads your public address (<code style={{ color: '#00f59b', background: 'transparent', padding: 0 }}>publicKey</code>) to identify your account. Private keys, passwords, and seed phrases are never collected, requested, or stored.
        </div>
      </div>

      <p style={{ textAlign: 'center', marginTop: 18, fontSize: 12.5, color: 'var(--silver-dark)' }}>
        Need a Solana wallet?{' '}
        <a
          href="https://phantom.app"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#ab9ff2', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          Download Phantom <ExternalLink size={11} />
        </a>
      </p>
    </div>
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
  { href: '/staking', label: 'Bits Mining', description: 'Base 0.1/hr, team boost & SOL Power', icon: Flame },
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
  const displayName = user?.solanaAddress ? `@${shortSolanaAddress(user.solanaAddress)}` : (user?.name || user?.username || 'Member');
  const role = user?.solanaAddress ? 'Phantom Solana' : (admin || user?.isAdmin ? 'Administrator' : 'Protocol Member');

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
          <Link href="/staking" onClick={() => setMenuOpen(false)}>
            <Brand size="sm" />
          </Link>
          <button className="mobile-close-button" type="button" onClick={() => setMenuOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div className="side-caption">Ecosystem Navigation</div>
        <nav className="sidebar-nav">
          {navMain.map(({ href, label, description, icon: Icon }) => {
            const isActive = active === href || (href === '/staking' && (active === '/mining' || active === '/deposit'));

            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className={`side-link ${isActive ? 'active' : ''}`}
              >
                {href === '/staking' ? <BitsMark size={18} /> : <Icon size={17} />}
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
            <span
              className="avatar"
              style={{
                background: user?.solanaAddress ? 'linear-gradient(135deg, #ab9ff2, #7857ff)' : undefined,
                display: 'grid',
                placeItems: 'center',
                color: '#ffffff',
              }}
            >
              {user?.solanaAddress ? <PhantomLogo size={14} /> : displayName.slice(0, 2).toUpperCase()}
            </span>
            <div style={{ overflow: 'hidden' }}>
              <span className="profile-name" style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {displayName}
              </span>
              <span className="profile-role" style={{ color: user?.solanaAddress ? '#ab9ff2' : undefined }}>{role}</span>
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
        {/* TOP OF CONNECT WALLET OPTION */}
        <div className="flex items-center justify-end py-2.5 mb-5 border-b border-white/[0.08]">
          <TopWalletConnect />
        </div>

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
  const solanaAddr = user?.solanaAddress || user?.id || '';
  const fallbackAccount: UserAccount = {
    id: solanaAddr || 'local-member',
    name: solanaAddr ? `@${shortSolanaAddress(solanaAddr)}` : (user?.name || user?.username || 'Member'),
    email: '',
    role: user?.isAdmin ? 'admin' : 'user',
    referralCode: solanaAddr ? shortSolanaAddress(solanaAddr) : '',
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
  const effectiveData: UserAccount = {
    ...accountQuery.data,
    id: solanaAddr || accountQuery.data.id,
    name: solanaAddr ? `@${shortSolanaAddress(solanaAddr)}` : accountQuery.data.name,
    role: user?.isAdmin && accountQuery.data.role !== 'admin' ? ('admin' as const) : accountQuery.data.role,
  };
  return <>{children(effectiveData)}</>;
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
        onError: (err: unknown) => setError(readableError(err, 'Failed to submit deposit request.')),
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
function WalletPage({ account, initialAsset }: { account: UserAccount; initialAsset?: string }) {
  const { user } = useAuth();
  const { notice } = useNotice();
  const balances = (account.balances as unknown as Record<string, number>) || {};
  const claimableBitnoir = balances.claimable || 0;
  const claimedBitnoir = balances.claimed || 0;
  const miningData = (account as unknown as { mining?: { minedBitsTotalClaimed?: number; burnedSol?: number; contributedSol?: number } }).mining;
  const initialBits = miningData?.minedBitsTotalClaimed ?? 120.5;
  const contributedSol = miningData?.burnedSol ?? miningData?.contributedSol ?? 0.5;
  const solPowerBoostPerHour = contributedSol * 5.0;

  const [activeTab, setActiveTab] = useState<'tokens' | 'activity'>('tokens');
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<'bits' | 'bitnoir'>('bits');
  const [convertOpen, setConvertOpen] = useState(false);
  const [withdrawSoonOpen, setWithdrawSoonOpen] = useState(false);
  const [bitsBalance, setBitsBalance] = useState(initialBits);
  const [selectedAsset, setSelectedAsset] = useState<'bits' | 'bitnoir' | null>(
    initialAsset?.toLowerCase() === 'bitnoir' ? 'bitnoir' : (initialAsset ? 'bits' : null)
  );
  const [selectedTx, setSelectedTx] = useState<{
    id: number;
    kind: string;
    title: string;
    detail: string;
    createdAt: string;
    amountText?: string;
  } | null>(null);

  // Clean real activity list - LOW TEXT, ZERO FAKE STUFF
  const [transactions, setTransactions] = useState<
    Array<{
      id: number;
      dateGroup: string;
      kind: 'swap' | 'receive' | 'send' | 'burn';
      title: string;
      subtext: string;
      amountPrimary: string;
      amountSecondary: string;
      isPositive: boolean;
      createdAt: string;
      token: 'bits' | 'bitnoir' | 'sol';
    }>
  >([
    {
      id: 101,
      dateGroup: 'Today',
      kind: 'swap',
      title: 'Swap',
      subtext: 'Bits to Bitnoir',
      amountPrimary: '+1.0000 Bitnoir',
      amountSecondary: '-100 Bits',
      isPositive: true,
      createdAt: new Date().toISOString(),
      token: 'bitnoir',
    },
    {
      id: 102,
      dateGroup: 'Today',
      kind: 'receive',
      title: 'Receive',
      subtext: '0x1e3F8...4d0482c',
      amountPrimary: '+25.0000 Bits',
      amountSecondary: '≈ $2.50',
      isPositive: true,
      createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
      token: 'bits',
    },
    {
      id: 103,
      dateGroup: 'Yesterday',
      kind: 'send',
      title: 'Send',
      subtext: '@neo_matrix',
      amountPrimary: '-10.0000 Bits',
      amountSecondary: '≈ -$1.00',
      isPositive: false,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      token: 'bits',
    },
    {
      id: 104,
      dateGroup: 'Earlier',
      kind: 'receive',
      title: 'Mining',
      subtext: 'Base Engine',
      amountPrimary: '+105.5000 Bits',
      amountSecondary: '≈ $10.55',
      isPositive: true,
      createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
      token: 'bits',
    },
  ]);

  const handleBitsSent = (recipient: string, amt: number) => {
    setBitsBalance((prev) => Math.max(0, prev - amt));
    const newTx = {
      id: Date.now(),
      dateGroup: 'Today',
      kind: 'send' as const,
      title: 'Send',
      subtext: recipient,
      amountPrimary: `-${amt.toFixed(4)} Bits`,
      amountSecondary: `≈ -$${(amt * BITS_REFERENCE_PRICE).toFixed(2)}`,
      isPositive: false,
      createdAt: new Date().toISOString(),
      token: 'bits' as const,
    };
    setTransactions((prev) => [newTx, ...prev]);
  };

  const bitsValueUsd = bitsBalance * BITS_REFERENCE_PRICE;
  const totalBitnoirTokens = claimedBitnoir + claimableBitnoir;
  const bitnoirValueUsd = totalBitnoirTokens * BITNOIR_REFERENCE_PRICE;
  const totalPortfolioValueUsd = bitsValueUsd + bitnoirValueUsd;
  const solanaAddr = user?.solanaAddress || (account.id.length >= 32 ? account.id : 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK');
  const userHandle = shortSolanaAddress(solanaAddr);

  return (
    <AppShell active="/wallet" admin={account.role === 'admin'}>
      {/* 1. CLEAN PORTFOLIO VALUATION */}
      <div className="pob-cockpit mb-6">
        <div className="pob-cockpit-hero">
          <div className="pob-live-info">
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-1">
              Total Portfolio Valuation
            </div>
            <div className="text-3xl md:text-4xl font-extrabold text-white font-mono tracking-tight tabular-nums">
              {money(totalPortfolioValueUsd)}
            </div>
          </div>
        </div>
      </div>

      {/* 2. TWO-COLUMN ARCHITECTURAL SYSTEM (ASSETS & ACTIVITY) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        {/* LEFT COLUMN: ASSET HOLDINGS (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-slate-400 flex items-center gap-2 m-0">
              <Coins size={14} className="text-[#00f59b]" />
              <span>Asset Holdings</span>
            </h2>
            <span className="text-xs font-mono text-slate-500">2 Assets</span>
          </div>

          {/* ASSET 1: BITS (CLEAN ARCHITECTURAL ROW) */}
          <div
            className="pob-cockpit !bg-[#0b101a] hover:border-white/20 transition-all cursor-pointer p-4"
            onClick={() => setSelectedAsset('bits')}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <BitsMark size={40} className="drop-shadow-[0_0_12px_rgba(0,245,155,0.3)] flex-shrink-0" />
                <div>
                  <strong className="text-base text-white font-bold">Bits</strong>
                </div>
              </div>

              <div className="flex items-center gap-3 text-right">
                <div>
                  <div className="text-base font-mono font-bold text-white tabular-nums">
                    {bitsBalance.toFixed(4)} <span className="text-xs text-slate-400 font-normal">BITS</span>
                  </div>
                  <div className="text-xs font-mono text-[#00f59b]">
                    ≈ {money(bitsValueUsd)}
                  </div>
                </div>
                <ChevronRight size={14} className="text-slate-500" />
              </div>
            </div>
          </div>

          {/* ASSET 2: BITNOIR (CLEAN ARCHITECTURAL ROW) */}
          <div
            className="pob-cockpit !bg-[#0b101a] hover:border-white/20 transition-all cursor-pointer p-4"
            onClick={() => setSelectedAsset('bitnoir')}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <TokenMark size={40} className="drop-shadow-[0_0_12px_rgba(255,139,47,0.3)] flex-shrink-0" />
                <div>
                  <strong className="text-base text-white font-bold">Bitnoir</strong>
                </div>
              </div>

              <div className="flex items-center gap-3 text-right">
                <div>
                  <div className="text-base font-mono font-bold text-white tabular-nums">
                    {totalBitnoirTokens.toFixed(4)} <span className="text-xs text-slate-400 font-normal">NOIR</span>
                  </div>
                  <div className="text-xs font-mono text-[#38bdf8]">
                    ≈ {money(bitnoirValueUsd)}
                  </div>
                </div>
                <ChevronRight size={14} className="text-slate-500" />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: WALLET ACTIVITY LEDGER (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-slate-400 flex items-center gap-2 m-0">
              <Activity size={14} className="text-[#38bdf8]" />
              <span>Wallet Activity</span>
            </h2>
            <span className="text-xs font-mono text-slate-500">Live Ledger</span>
          </div>

          <div className="pob-cockpit !bg-[#0b101a] p-3 flex flex-col gap-2">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                onClick={() =>
                  setSelectedTx({
                    id: tx.id,
                    kind: tx.kind,
                    title: tx.title,
                    detail: tx.subtext,
                    createdAt: tx.createdAt,
                    amountText: tx.amountPrimary,
                  })
                }
                className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] transition-all cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="relative w-9 h-9 min-w-9">
                    <img
                      src={tx.token === 'bitnoir' ? '/asset-bitnoir-md.png' : '/asset-bits-md.png'}
                      alt={tx.title}
                      className="w-9 h-9 object-contain"
                    />
                    <div
                      className={`absolute -right-1 -bottom-1 w-3.5 h-3.5 rounded-full flex items-center justify-center border border-[#0a0f19] text-white ${
                        tx.isPositive ? 'bg-[#22c55e]' : 'bg-[#ef4444]'
                      }`}
                    >
                      {tx.isPositive ? <ArrowDownLeft size={7} strokeWidth={3} /> : <ArrowUpRight size={7} strokeWidth={3} />}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white leading-tight">{tx.title}</div>
                    <div className="text-[11px] font-mono text-slate-400">{tx.subtext}</div>
                  </div>
                </div>

                <div className="text-right">
                  <div className={`text-xs font-mono font-bold ${tx.isPositive ? 'text-[#00f59b]' : 'text-white'}`}>
                    {tx.amountPrimary}
                  </div>
                  <div className="text-[10px] font-mono text-slate-500">{tx.amountSecondary}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>


      {/* ASSET DETAIL QUICK DRAWER (LOW TEXT, PURE FUNCTION) */}
      {selectedAsset && (
        <div className="modal-backdrop" onClick={() => setSelectedAsset(null)}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 420,
              background: '#0d131f',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 24,
              boxShadow: '0 25px 65px rgba(0, 0, 0, 0.75)',
              padding: '22px 24px',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img
                  src={selectedAsset === 'bitnoir' ? '/asset-bitnoir-md.png' : '/asset-bits-md.png'}
                  alt={selectedAsset}
                  style={{ width: 32, height: 32 }}
                />
                <span style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                  {selectedAsset === 'bitnoir' ? 'Bitnoir' : 'Bits'}
                </span>
              </div>
              <button
                type="button"
                className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer border border-white/[0.08]"
                onClick={() => setSelectedAsset(null)}
              >
                <X size={15} />
              </button>
            </div>

            {/* Large Balance */}
            <div style={{ textAlign: 'center', padding: '12px 0 20px' }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#ffffff', fontFamily: 'monospace' }}>
                {selectedAsset === 'bitnoir' ? `${totalBitnoirTokens.toFixed(4)} Bitnoir` : `${bitsBalance.toFixed(4)} Bits`}
              </div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, fontFamily: 'monospace' }}>
                ≈ {money(selectedAsset === 'bitnoir' ? bitnoirValueUsd : bitsValueUsd)}
              </div>
            </div>

            {/* Quick Actions in Asset Modal */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
              {selectedAsset === 'bits' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAsset(null);
                      setSendOpen(true);
                    }}
                    className="button button-primary"
                    style={{ flex: 1, height: 42 }}
                  >
                    <ArrowUpRight size={16} /> Send
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAsset(null);
                      setReceiveTarget('bits');
                      setReceiveOpen(true);
                    }}
                    className="button button-soft"
                    style={{ flex: 1, height: 42 }}
                  >
                    <ArrowDownLeft size={16} /> Receive
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAsset(null);
                      setConvertOpen(true);
                    }}
                    className="button button-soft"
                    style={{ flex: 1, height: 42 }}
                  >
                    <RefreshCw size={15} /> Swap
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAsset(null);
                      setReceiveTarget('bitnoir');
                      setReceiveOpen(true);
                    }}
                    className="button button-soft"
                    style={{ flex: 1, height: 42 }}
                  >
                    <ArrowDownLeft size={16} /> Receive
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAsset(null);
                      setWithdrawSoonOpen(true);
                    }}
                    className="button button-soft"
                    style={{ flex: 1, height: 42 }}
                  >
                    <ArrowUpRight size={16} /> Withdraw
                  </button>
                </>
              )}
            </div>

            {/* Minimal Network Specs */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Network</span>
                <span style={{ color: '#ffffff', fontWeight: 600 }}>{selectedAsset === 'bitnoir' ? 'BNB Smart Chain' : 'Bitnoir Network'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Standard</span>
                <span style={{ color: '#ffffff', fontWeight: 600 }}>{selectedAsset === 'bitnoir' ? 'BEP-20' : 'Mined Ledger'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Fee</span>
                <span style={{ color: '#00f59b', fontWeight: 600 }}>{selectedAsset === 'bitnoir' ? '0.00004 BNB' : 'Gasless (0 BITS)'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODALS */}
      <SendBitsModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        availableBits={bitsBalance}
        onSent={handleBitsSent}
      />

      <ReceiveAssetModal
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        handle={userHandle}
        isBitnoir={receiveTarget === 'bitnoir'}
        solanaAddress={solanaAddr}
      />

      <ConvertModal
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
      />

      <WithdrawComingSoonModal
        open={withdrawSoonOpen}
        onClose={() => setWithdrawSoonOpen(false)}
        balance={claimedBitnoir}
      />

      <TransactionDetailModal
        tx={selectedTx}
        onClose={() => setSelectedTx(null)}
        assetSymbol={selectedTx?.title.includes('Bitnoir') ? 'Bitnoir' : 'Bits'}
      />

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
  assetSymbol,
}: {
  tx: { id: number; kind: string; title: string; detail: string; createdAt: string; amountText?: string } | null;
  onClose: () => void;
  assetSymbol?: string;
}) {
  const [copiedTx, setCopiedTx] = useState(false);
  const [copiedSender, setCopiedSender] = useState(false);
  if (!tx) return null;

  const txHash = `0x${Array.from({ length: 32 }, (_, i) => ((tx.id * 17 + i * 29) % 256).toString(16).padStart(2, '0')).join('')}`;
  const senderAddress = '0x1e3F8...' + ((tx.id * 31 + 47) % 65536).toString(16).padStart(4, '0') + 'c';

  const copySender = () => {
    void navigator.clipboard.writeText(senderAddress);
    setCopiedSender(true);
    toast({ title: 'Copied', description: 'Address copied to clipboard.' });
    setTimeout(() => setCopiedSender(false), 2000);
  };

  const copyHash = () => {
    void navigator.clipboard.writeText(txHash);
    setCopiedTx(true);
    toast({ title: 'Copied', description: 'Transaction hash copied to clipboard.' });
    setTimeout(() => setCopiedTx(false), 2000);
  };

  const isPositive = tx.kind === 'deposit' || tx.kind === 'p2p_receive' || tx.kind === 'mining_claim' || tx.kind === 'miner_power' || tx.kind === 'claim' || tx.kind === 'receive';
  const isBitnoirToken = assetSymbol === 'Bitnoir' || tx.title.toLowerCase().includes('bitnoir') || tx.detail.toLowerCase().includes('bitnoir');
  const tokenLogo = isBitnoirToken ? '/asset-bitnoir-md.png' : '/asset-bits-md.png';

  // Title in center matching Screenshot_20261111_035540_89da0530.jpg
  const eventHeader = tx.kind === 'p2p_send' || tx.kind === 'withdraw' || tx.kind === 'send'
    ? 'Send'
    : tx.kind === 'swap'
    ? 'Swap'
    : tx.kind === 'mining_claim' || tx.kind === 'miner_power'
    ? 'Mining Engine'
    : 'Receive';

  const rawAmount = tx.amountText || (isPositive ? '+ 25.0000 Bits' : '- 10.0000 Bits');
  const fiatEstimate = isBitnoirToken ? '$25.00' : '$2.50';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog wallet-tx-bottom-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 440,
          background: '#0d131f',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 24,
          boxShadow: '0 25px 65px rgba(0, 0, 0, 0.75)',
          padding: '20px 24px',
        }}
      >
        {/* HEADER: CENTER TITLE & CIRCULAR CLOSE BUTTON */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ width: 32 }} />
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#ffffff' }}>{eventHeader}</h3>
          <button
            type="button"
            className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer border border-white/[0.08]"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* HERO: TOKEN LOGO + LARGE AMOUNT + FIAT (MATCHING SCREENSHOT 3) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <div style={{ position: 'relative', width: 44, height: 44, minWidth: 44 }}>
            <img
              src={tokenLogo}
              alt="Token"
              style={{ width: 44, height: 44, objectFit: 'contain' }}
            />
            <div
              style={{
                position: 'absolute',
                right: -2,
                bottom: -2,
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: isPositive ? '#22c55e' : '#ef4444',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                border: '2px solid #0d131f',
              }}
            >
              {isPositive ? <ArrowDownLeft size={10} strokeWidth={3} /> : <ArrowUpRight size={10} strokeWidth={3} />}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: isPositive ? '#00f59b' : '#ffffff',
                fontFamily: 'monospace',
                lineHeight: 1.2,
              }}
            >
              {rawAmount}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, fontFamily: 'monospace' }}>
              ≈ {fiatEstimate}
            </div>
          </div>
        </div>

        {/* FIELD ROWS (MATCHING SCREENSHOT_20261111_035540_89da0530.JPG) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 0', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
          {/* DATE */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
            <span style={{ color: '#64748b' }}>Date</span>
            <span style={{ color: '#ffffff', fontWeight: 500 }}>
              {new Date(tx.createdAt).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}, {new Date(tx.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
            </span>
          </div>

          {/* SENDER / RECIPIENT */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
            <span style={{ color: '#64748b' }}>{isPositive ? 'Sender' : 'Recipient'}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="font-mono text-xs text-white">{senderAddress}</span>
              <button
                type="button"
                onClick={copySender}
                className="text-slate-400 hover:text-[#00f59b] transition-colors p-1 cursor-pointer"
                title="Copy Address"
              >
                {copiedSender ? <Check size={12} className="text-[#00f59b]" /> : <Copy size={12} />}
              </button>
            </div>
          </div>

          {/* TRANSACTION HASH */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
            <span style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
              Transaction <ExternalLink size={12} className="opacity-60" />
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="font-mono text-xs text-white">
                {txHash.slice(0, 8)}...{txHash.slice(-4)}
              </span>
              <button
                type="button"
                onClick={copyHash}
                className="text-slate-400 hover:text-[#00f59b] transition-colors p-1 cursor-pointer"
                title="Copy Hash"
              >
                {copiedTx ? <Check size={12} className="text-[#00f59b]" /> : <Copy size={12} />}
              </button>
            </div>
          </div>

          {/* NETWORK */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
            <span style={{ color: '#64748b' }}>Network</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 9px',
                borderRadius: 6,
                background: isBitnoirToken ? 'rgba(56, 189, 248, 0.12)' : 'rgba(0, 245, 155, 0.12)',
                color: isBitnoirToken ? '#38bdf8' : '#00f59b',
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: isBitnoirToken ? '#38bdf8' : '#00f59b' }} />
              {isBitnoirToken ? 'BNB Smart Chain' : 'Bitnoir Network'}
            </span>
          </div>

          {/* NETWORK FEE */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: 13 }}>
            <span style={{ color: '#64748b', borderBottom: '1px dotted #64748b' }}>Network fee</span>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#ffffff', fontWeight: 600, fontFamily: 'monospace', fontSize: 12 }}>
                {isBitnoirToken ? '0.00004275 BNB' : '0.0000 Bits (Gasless)'}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                $0.00
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SWAP / CONVERT MODAL
// ---------------------------------------------------------------------------
function ConvertModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="tx-icon-badge" style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#c084fc' }}>
              <RefreshCw size={18} />
            </div>
            <div>
              <h3>Convert Bits to Bitnoir</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--silver-dark)' }}>Protocol Conversion Bridge</p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Conversion rate banner */}
          <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(168, 85, 247, 0.08)', border: '1px solid rgba(168, 85, 247, 0.2)', fontSize: 13, color: '#e9d5ff' }}>
            <strong style={{ color: '#fff', display: 'block', marginBottom: 2 }}>Conversion Rate: 100 Bits = 1 Bitnoir</strong>
            Mined Bits points will convert directly into native Bitnoir tokens.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.07)' }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>You Pay (Mined Points)</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="font-mono text-lg font-bold text-white">100.0000</span>
                <span className="font-bold text-sm text-[#00f59b]">BITS</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', margin: '-4px 0' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#131b2a', border: '1px solid rgba(255, 255, 255, 0.1)', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>
                <RefreshCw size={13} />
              </div>
            </div>

            <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.07)' }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>You Receive (Native Token)</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="font-mono text-lg font-bold text-white">1.0000</span>
                <span className="font-bold text-sm text-[#38bdf8]">BITNOIR</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="button button-soft"
            disabled
            style={{ width: '100%', opacity: 0.6, cursor: 'not-allowed', marginTop: 4 }}
          >
            Conversion Coming Soon at Mainnet TGE
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SEND BITS MODAL (PEER-TO-PEER POINTS TRANSFER)
// ---------------------------------------------------------------------------
function SendBitsModal({
  open,
  onClose,
  availableBits,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  availableBits: number;
  onSent: (recipient: string, amount: number) => void;
}) {
  const [recipient, setRecipient] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const quickRecipients = ['@cyber_alex', '@neo_matrix', '@tomek.eth', '@alice_miner'];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanRecipient = recipient.trim();
    if (!cleanRecipient) {
      setError('Please enter a recipient handle or address.');
      return;
    }
    const amt = parseFloat(amountStr);
    if (isNaN(amt) || amt <= 0) {
      setError('Please enter a valid amount of Bits.');
      return;
    }
    if (amt > availableBits) {
      setError(`Insufficient balance. You have ${availableBits.toFixed(4)} Bits available.`);
      return;
    }

    setIsSending(true);
    setTimeout(() => {
      setIsSending(false);
      const formatted = cleanRecipient.startsWith('@') ? cleanRecipient : `@${cleanRecipient}`;
      onSent(formatted, amt);
      toast({
        title: 'Bits Sent Successfully',
        description: `Transferred ${amt.toFixed(4)} Bits to ${formatted} with 0 gas fee.`,
      });
      onClose();
    }, 600);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="tx-icon-badge" style={{ background: 'rgba(0, 245, 155, 0.1)', color: '#00f59b' }}>
              <Send size={18} />
            </div>
            <div>
              <h3>Send Bits Points</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--silver-dark)' }}>Instant Peer-to-Peer Transfer · 0 Fee</p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8', marginBottom: 6, fontWeight: 700 }}>
              Recipient Handle or Address
            </label>
            <input
              type="text"
              className="input w-full font-mono text-sm"
              placeholder="@username or 0x..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              autoFocus
            />
            {/* Quick Suggestions */}
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {quickRecipients.map((rec) => (
                <button
                  key={rec}
                  type="button"
                  onClick={() => setRecipient(rec)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 6,
                    padding: '2px 8px',
                    fontSize: 11,
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                  }}
                >
                  {rec}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8', fontWeight: 700 }}>
                Amount to Send
              </label>
              <button
                type="button"
                onClick={() => setAmountStr(availableBits.toFixed(4))}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#00f59b',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                MAX: {availableBits.toFixed(4)} Bits
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type="number"
                step="any"
                min="0.0001"
                className="input w-full font-mono text-sm"
                placeholder="0.0000"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
              />
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, fontWeight: 700, color: '#64748b', fontFamily: 'monospace' }}>
                BITS
              </span>
            </div>
          </div>

          {error && (
            <div style={{ fontSize: 12, color: '#f87171', background: 'rgba(239, 68, 68, 0.1)', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              {error}
            </div>
          )}

          <div style={{ padding: '10px 14px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.05)', fontSize: 12, display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
            <span>Network Fee</span>
            <span style={{ color: '#00f59b', fontWeight: 700, fontFamily: 'monospace' }}>0 Bits (Gasless)</span>
          </div>

          <button
            type="submit"
            className="button button-primary"
            disabled={isSending}
            style={{ width: '100%', marginTop: 4, height: 42 }}
          >
            {isSending ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                <span>Transferring Bits...</span>
              </>
            ) : (
              <>
                <Send size={15} />
                <span>Confirm & Send Bits</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RECEIVE BITS / BITNOIR MODAL
// ---------------------------------------------------------------------------
function ReceiveAssetModal({
  open,
  onClose,
  handle,
  isBitnoir,
  solanaAddress,
}: {
  open: boolean;
  onClose: () => void;
  handle: string;
  isBitnoir: boolean;
  solanaAddress?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  const address = isBitnoir
    ? '0x328b991F91a995e8656607Fe795a9956461c28c8'
    : (solanaAddress || 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK');

  const copyText = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: 'Copied', description: isBitnoir ? 'Contract address copied to clipboard.' : 'Solana address copied to clipboard.' });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, textAlign: 'center' }}>
        <div className="modal-header" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="tx-icon-badge" style={{ background: isBitnoir ? 'rgba(56, 189, 248, 0.1)' : 'rgba(120, 87, 255, 0.15)', color: isBitnoir ? '#38bdf8' : '#ab9ff2' }}>
              <ArrowDownLeft size={18} />
            </div>
            <div style={{ textAlign: 'left' }}>
              <h3>{isBitnoir ? 'Receive Bitnoir Token' : 'Receive Solana / Bits'}</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--silver-dark)' }}>
                {isBitnoir ? 'BNB Smart Chain (BEP-20) Token' : 'Connected Phantom Solana Address'}
              </p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          {/* QR CODE DISPLAY */}
          <div
            style={{
              padding: 16,
              background: '#ffffff',
              borderRadius: 16,
              boxShadow: isBitnoir ? '0 8px 32px rgba(56, 189, 248, 0.2)' : '0 8px 32px rgba(120, 87, 255, 0.25)',
              border: isBitnoir ? '3px solid #38bdf8' : '3px solid #7857ff',
              display: 'inline-block',
            }}
          >
            <QrCode size={150} className="text-slate-900" />
          </div>

          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', fontWeight: 700, marginBottom: 4 }}>
              {isBitnoir ? 'Official Contract Address' : 'Connected Phantom Solana Address'}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#ffffff', fontFamily: 'monospace' }}>
              {isBitnoir ? 'Bitnoir (BITNOIR)' : `@${handle}`}
            </div>
          </div>

          {/* Copyable Box */}
          <div
            style={{
              width: '100%',
              padding: '10px 14px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span className="font-mono text-xs text-slate-300 truncate select-all" style={{ maxWidth: 280 }}>
              {address}
            </span>
            <button
              type="button"
              className="button button-soft !min-h-[30px] !px-3 !py-1 !text-xs !rounded-md"
              onClick={() => copyText(address)}
              style={{
                borderColor: copied ? (isBitnoir ? 'rgba(56, 189, 248, 0.4)' : 'rgba(120, 87, 255, 0.4)') : undefined,
                color: copied ? (isBitnoir ? '#38bdf8' : '#ab9ff2') : undefined,
              }}
            >
              {copied ? <Check size={12} strokeWidth={3} /> : <Copy size={12} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, padding: '0 10px' }}>
            {isBitnoir ? (
              <>Bitnoir is deployable on BNB Smart Chain. Transferred or converted tokens are directly settled to this protocol address.</>
            ) : (
              <>Other users can send Bits points directly to your connected Phantom Solana address (<strong className="text-white">@{handle}</strong>) instantly with zero gas fees.</>
            )}
          </div>
        </div>

        <button type="button" className="button button-soft" onClick={onClose} style={{ width: '100%' }}>
          Done
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WITHDRAW COMING SOON MODAL (BITNOIR)
// ---------------------------------------------------------------------------
function WithdrawComingSoonModal({
  open,
  onClose,
  balance,
}: {
  open: boolean;
  onClose: () => void;
  balance: number;
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="tx-icon-badge" style={{ background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8' }}>
              <ArrowUpRight size={18} />
            </div>
            <div>
              <h3>Bitnoir Withdrawals</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--silver-dark)' }}>BNB Smart Chain (BEP-20) Gateway</p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* COMING SOON STATUS BANNER */}
          <div
            style={{
              padding: '16px',
              borderRadius: 14,
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.1) 0%, rgba(0, 245, 155, 0.05) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
            }}
          >
            <Sparkles size={20} className="text-[#38bdf8] flex-shrink-0 mt-0.5" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#ffffff', marginBottom: 4 }}>
                Withdrawal Protocol Coming Soon
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                Bitnoir tokens are the official withdrawable network asset. External withdrawals to personal BEP-20 wallets will be activated upon the deployment of the audited production smart contract.
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                Your Balance
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#ffffff', fontFamily: 'monospace' }}>
                {balance.toFixed(4)} Bitnoir
              </div>
            </div>
            <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                Network
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#38bdf8' }}>
                BNB Smart Chain
              </div>
            </div>
          </div>

          <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.06)', fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
            <strong className="text-white">100% Reserved:</strong> All earned and settled Bitnoir tokens remain safely locked and accounted for in your wallet. When the withdrawal bridge launches, you will be able to dispatch your tokens with standard gas.
          </div>
        </div>

        <button type="button" className="button button-soft" onClick={onClose} style={{ width: '100%' }}>
          Understood
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// REDESIGNED DEDICATED ASSET DETAIL PAGE (/asset/:assetId)
// ---------------------------------------------------------------------------
function AssetDetailPage({ account, assetId }: { account: UserAccount; assetId: string }) {
  return <WalletPage account={account} initialAsset={assetId} />;
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
                          {item.kind === 'deposit' ? (
                            <ArrowDownLeft size={16} />
                          ) : item.kind === 'withdraw' ? (
                            <ArrowUpRight size={16} />
                          ) : item.kind === 'stake' ? (
                            <Flame size={16} />
                          ) : item.title.includes('Bits') || item.detail.includes('Bits') || item.kind === 'reward' ? (
                            <BitsMark size={18} />
                          ) : (
                            <Coins size={16} />
                          )}
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
              <Hammer size={15} className="text-[#38bdf8]" />
              <span>2. Direct Miners Power (10% Mining Power)</span>
            </div>
            <p className="text-slate-400 m-0 leading-relaxed">
              Active direct miners only provide 10% of their mining power to their inviter. Inactive miners do not contribute hash power until their node is activated.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/8">
            <div className="flex items-center gap-2 mb-1 text-sm font-bold text-white">
              <Zap size={15} className="text-[#ff8b2f]" />
              <span>3. SOL Power (Max 10 SOL Contribution)</span>
            </div>
            <p className="text-slate-400 m-0 leading-relaxed">
              Contribute SOL to acquire SOL Power. Each 1 SOL contributed grants +5.0000 Bits/hr of SOL Power to mine more Bits (up to max 10 SOL per account).
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
// SOL MINING POWER DYNAMIC CURVE
// ---------------------------------------------------------------------------
function SolMiningPowerCurve({ solAmount }: { solAmount: number }) {
  const norm = Math.max(0, Math.min(1, (solAmount - 0.1) / (10 - 0.1)));
  const x = 30 + norm * 400;
  const y = 62 - norm * 48;

  return (
    <div className="w-full h-[76px] my-2 bg-black/40 rounded-xl p-2 border border-white/5 relative overflow-hidden">
      <div className="absolute top-2 left-3 text-[10px] font-mono text-slate-400">
        SOL Power: <strong className="text-[#ff8b2f]">{(solAmount * 5).toFixed(1)} Bits/hr</strong>
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
// SOL POWER MODAL: CONTRIBUTE SOL TO ACQUIRE SOL POWER (MAX 10 SOL PER ACCOUNT)
// ---------------------------------------------------------------------------
function SolPowerModal({
  open,
  onClose,
  onCommitContribution,
  currentContributed = 0.5,
  isPending = false,
}: {
  open: boolean;
  onClose: () => void;
  onCommitContribution: (solAmount: number) => Promise<void>;
  currentContributed?: number;
  isPending?: boolean;
}) {
  if (!open) return null;

  const maxAccountSol = 10.0;
  const remainingQuota = Math.max(0, Number((maxAccountSol - currentContributed).toFixed(2)));
  const isCapped = remainingQuota <= 0;

  const defaultSol = Math.min(1.0, Math.max(0.1, remainingQuota > 0 ? remainingQuota : 0.1));
  const [solAmount, setSolAmount] = useState<number>(defaultSol);

  const clampedSol = Math.max(0.1, Math.min(remainingQuota > 0 ? remainingQuota : 0.1, solAmount));
  const rateBoost = clampedSol * 5.0; // 1 SOL = +5.0 Bits/hr
  const dailyOutput = rateBoost * 24;
  const usdValue = clampedSol * 180;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        {/* MODAL HEADER */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255, 139, 47, 0.15)', display: 'grid', placeItems: 'center', color: '#ff8b2f' }}>
              <Zap size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 18, fontWeight: 700 }}>Contribute SOL</h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>
                Acquire SOL Power to mine more Bits · Max 10 SOL per account
              </p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-4">
          {/* ACCOUNT QUOTA PROGRESS - LESS TEXT, EASY UNDERSTANDABLE */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/8 flex items-center justify-between text-xs font-mono">
            <span className="text-slate-400 font-sans">Account Limit:</span>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold tabular-nums">
                {currentContributed.toFixed(1)} / {maxAccountSol.toFixed(1)} SOL
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                isCapped ? 'bg-red-500/20 text-red-400' : 'bg-[#00f59b]/15 text-[#00f59b]'
              }`}>
                {isCapped ? 'MAX REACHED' : `${remainingQuota.toFixed(1)} SOL REMAINING`}
              </span>
            </div>
          </div>

          {/* SLIDER & PRESETS (EXACT DESIGN) */}
          <div className="pob-input-box">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">SOL Power Contribution</span>
              <span className="text-xs font-mono font-bold text-[#ff8b2f] bg-[#ff8b2f]/10 px-2 py-0.5 rounded">
                +{rateBoost.toFixed(4)} Bits/hr
              </span>
            </div>

            <SolMiningPowerCurve solAmount={clampedSol} />

            <div className="w-full py-2">
              <input
                type="range"
                min="0.1"
                max={Math.max(0.1, remainingQuota)}
                step="0.1"
                disabled={isCapped}
                value={clampedSol}
                onChange={(e) => setSolAmount(Number(e.target.value))}
                className="modern-range-line"
                aria-label="SOL to contribute"
              />
            </div>

            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {[0.5, 1.0, 2.0, 5.0].filter((val) => val <= remainingQuota).map((val) => (
                <button
                  key={val}
                  type="button"
                  className={`pob-preset-btn ${clampedSol === val ? '!bg-[#ff8b2f]/20 !text-[#ff8b2f] !border-[#ff8b2f]/40 font-bold' : ''}`}
                  onClick={() => setSolAmount(val)}
                >
                  {val} SOL
                </button>
              ))}
              {remainingQuota > 0 && (
                <button
                  type="button"
                  className={`pob-preset-btn ${clampedSol === remainingQuota ? '!bg-[#ff8b2f]/20 !text-[#ff8b2f] !border-[#ff8b2f]/40 font-bold' : ''}`}
                  onClick={() => setSolAmount(remainingQuota)}
                >
                  MAX ({remainingQuota.toFixed(1)} SOL)
                </button>
              )}
            </div>
          </div>

          {/* CLEAN METRICS - LESS TEXT EASY UNDERSTANDABLE */}
          <div className="pob-panel-body flex flex-col gap-2.5 bg-black/30 p-3.5 rounded-xl border border-white/5 font-mono text-xs">
            <div className="flex justify-between items-center text-slate-300">
              <span className="text-slate-400 font-sans">Contribute:</span>
              <span className="font-bold text-white tabular-nums">{clampedSol.toFixed(1)} SOL <span className="text-slate-500 font-normal font-sans">(≈ ${usdValue.toFixed(2)})</span></span>
            </div>
            <div className="flex justify-between items-center text-slate-300">
              <span className="text-slate-400 font-sans">SOL Power Acquired:</span>
              <span className="font-bold text-[#ff8b2f] tabular-nums">+{rateBoost.toFixed(4)} Bits/hr</span>
            </div>
            <div className="flex justify-between items-center text-slate-300">
              <span className="text-slate-400 font-sans">24h Estimated Output:</span>
              <span className="font-bold text-[#00f59b] tabular-nums">+{dailyOutput.toFixed(1)} Bits</span>
            </div>
          </div>

          {/* ACTION BUTTON */}
          <button
            type="button"
            className="clean-stake-confirm-btn !bg-gradient-to-r !from-[#ff8b2f] !to-[#ff5252] !text-black !font-bold"
            disabled={isPending || isCapped}
            onClick={() => onCommitContribution(clampedSol)}
          >
            {isPending ? (
              <span className="flex items-center gap-2 justify-center">
                <RefreshCw size={14} className="animate-spin" /> Processing…
              </span>
            ) : isCapped ? (
              <span className="flex items-center gap-2 justify-center">
                <Check size={16} /> Max 10 SOL Contributed
              </span>
            ) : (
              <span className="flex items-center gap-2 justify-center">
                <Zap size={16} /> Contribute {clampedSol.toFixed(1)} SOL to Acquire SOL Power
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Backward-compatibility alias
const BurnSolMiningModal = SolPowerModal;

// ---------------------------------------------------------------------------
// CLAIMED POINTS OVERLAY MODAL (PERFECTION ARCHITECTURED OVERLAY)
// ---------------------------------------------------------------------------
function ClaimedPointsOverlayModal({
  open,
  onClose,
  claimedTotalBits,
  claimHistoryList,
}: {
  open: boolean;
  onClose: () => void;
  claimedTotalBits: number;
  claimHistoryList: Array<{ id: number; amount: number; status: string }>;
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 460,
          padding: 24,
          background: 'linear-gradient(180deg, #0c121d 0%, #070b12 100%)',
          borderColor: 'rgba(0, 245, 155, 0.35)',
          boxShadow: '0 24px 70px rgba(0, 0, 0, 0.85), 0 0 35px rgba(0, 245, 155, 0.18)',
          borderRadius: 20,
        }}
      >
        {/* MODAL HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BitsMark size={32} className="drop-shadow-[0_0_12px_rgba(0,245,155,0.4)]" />
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '-0.01em' }}>
                Claimed Points Ledger
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <span className="font-mono text-xs font-bold text-[#00f59b] tabular-nums">
                  {claimedTotalBits.toFixed(4)} BITS
                </span>
                <span className="text-[10px] font-mono text-slate-400">·</span>
                <span className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">
                  {claimHistoryList.length} Settled
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
            style={{ width: 34, height: 34 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* CLEAN STYLE CLAIMED LIST - ZERO OVER-TEXTS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 380, overflowY: 'auto', paddingRight: 2 }}>
          {claimHistoryList.map((item, idx) => (
            <div
              key={item.id || idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="font-mono text-xs text-slate-500 w-5">0{idx + 1}</span>
                <BitsMark size={24} />
                <span className="font-mono font-extrabold text-base text-[#00f59b] tabular-nums">
                  +{item.amount.toFixed(4)} BITS
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 9px',
                    borderRadius: 6,
                    background: 'rgba(0, 245, 155, 0.1)',
                    border: '1px solid rgba(0, 245, 155, 0.25)',
                    color: '#00f59b',
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: 'monospace',
                  }}
                >
                  <Check size={12} strokeWidth={3} />
                  Confirmed
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DIRECT REFERRAL MODAL (10% MINING POWER ARCHITECTURE)
// ---------------------------------------------------------------------------
function DirectReferralModal({
  open,
  onClose,
  referralCode,
  referralBoostPerHour,
  teamList,
}: {
  open: boolean;
  onClose: () => void;
  referralCode: string;
  referralBoostPerHour: number;
  teamList: Array<{
    id: string;
    handle: string;
    status: string;
    isActive: boolean;
    miningPower: number;
    providedPower: number;
  }>;
}) {
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  const code = referralCode || 'satoshi';
  const referralUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/?ref=${code}`
    : `https://bitnoir.io/?ref=${code}`;

  const handleCopy = () => {
    navigator.clipboard?.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const activeCount = teamList.filter((m) => m.isActive).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 520,
          padding: 24,
          background: 'linear-gradient(180deg, #0c121d 0%, #070b12 100%)',
          borderColor: 'rgba(56, 189, 248, 0.35)',
          boxShadow: '0 24px 70px rgba(0, 0, 0, 0.85), 0 0 35px rgba(56, 189, 248, 0.15)',
          borderRadius: 20,
        }}
      >
        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: 'rgba(56, 189, 248, 0.12)',
                display: 'grid',
                placeItems: 'center',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.25)',
              }}
            >
              <Hammer size={18} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '-0.01em' }}>
                Active Miners Network
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <span className="font-mono text-xs font-bold text-[#38bdf8] tabular-nums">
                  +{referralBoostPerHour.toFixed(4)} /h
                </span>
                <span className="text-[10px] font-mono text-slate-400">·</span>
                <span className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">
                  {activeCount} Active Miners
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
            style={{ width: 34, height: 34 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* RULE BANNER - EXACT CORE SPECIFICATION */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            background: 'rgba(56, 189, 248, 0.06)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Sparkles size={16} className="text-[#38bdf8] mt-0.5 flex-shrink-0" />
            <div style={{ fontSize: 12, lineHeight: 1.5, color: '#cbd5e1' }}>
              <strong className="text-white">Active Miners Rule:</strong> Active direct miners only provide{' '}
              <span className="text-[#38bdf8] font-bold">10% of their mining power</span> to their inviter. Inactive
              miners provide 0% until activated.
            </div>
          </div>
        </div>

        {/* COPY REFERRAL LINK BOX */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Your Miner Invite Link
            </span>
            <span className="font-mono text-[11px] text-slate-400">
              Code: <strong className="text-white font-bold">{code}</strong>
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderRadius: 10,
              background: 'rgba(0, 0, 0, 0.45)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              gap: 8,
            }}
          >
            <span
              className="font-mono text-xs text-slate-300 truncate select-all"
              style={{ maxWidth: 360 }}
            >
              {referralUrl}
            </span>
            <button
              type="button"
              className="button button-soft !min-h-[30px] !px-3 !py-1 !text-xs !rounded-md"
              onClick={handleCopy}
              style={{
                borderColor: copied ? 'rgba(0, 245, 155, 0.4)' : undefined,
                color: copied ? '#00f59b' : undefined,
              }}
            >
              {copied ? (
                <>
                  <Check size={12} strokeWidth={3} />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* DIRECT REFERRERS BREAKDOWN LIST */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 250, overflowY: 'auto', paddingRight: 2 }}>
          {teamList.map((member, idx) => (
            <div
              key={member.id || idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 10,
                background: member.isActive ? 'rgba(56, 189, 248, 0.03)' : 'rgba(255, 255, 255, 0.015)',
                border: member.isActive ? '1px solid rgba(56, 189, 248, 0.18)' : '1px solid rgba(255, 255, 255, 0.05)',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="font-mono text-xs text-slate-500 w-5">0{idx + 1}</span>
                <div>
                  <div className="font-semibold text-white text-xs">@{member.handle}</div>
                  <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                    Mining: {member.miningPower.toFixed(4)} /h
                  </div>
                </div>
              </div>

              {/* RIGHT SIDE: REFINED ACTIVE STATUS BADGE WITH GLOWING DOT */}
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 10px',
                    borderRadius: 9999,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    fontFamily: 'var(--app-font-mono, monospace)',
                    background: member.isActive ? 'rgba(0, 245, 155, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                    color: member.isActive ? '#00f59b' : '#64748b',
                    border: member.isActive ? '1px solid rgba(0, 245, 155, 0.28)' : '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow: member.isActive ? '0 0 10px rgba(0, 245, 155, 0.15)' : 'none',
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: member.isActive ? '#00f59b' : '#64748b',
                      boxShadow: member.isActive ? '0 0 6px #00f59b' : 'none',
                    }}
                  />
                  {member.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STOPWATCH-STYLE LIVE MINING POINTS COUNTER (PRECISION ODOMETER TICKER)
// ---------------------------------------------------------------------------
function StopwatchPointsCounter({
  ratePerHour,
  currentBits,
}: {
  ratePerHour: number;
  currentBits: number;
}) {
  const formatted = currentBits.toFixed(7);
  const [intPart, decPart] = formatted.split('.');
  const primaryDec = (decPart || '0000000').slice(0, 4);
  const microDec = (decPart || '0000000').slice(4, 7);

  return (
    <div className="stopwatch-counter-cockpit my-1">
      <div className="flex items-center gap-3.5 select-none">
        {/* Authentic High-Res Bits Logo attached clean, no grid, no enclosing box */}
        <BitsMark size={42} className="drop-shadow-[0_0_16px_rgba(0,245,155,0.4)] flex-shrink-0" />

        {/* Digital Stopwatch Numerical Ticker - PERFECT BASELINE ALIGNMENT, NO SMALL GRID, NO BOXES */}
        <div className="flex items-baseline font-mono select-none">
          <span className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight tabular-nums">
            {intPart}
          </span>
          <span className="text-3xl sm:text-4xl md:text-5xl font-black text-[#00f59b]">.</span>
          <span className="text-3xl sm:text-4xl md:text-5xl font-bold text-[#00f59b] tracking-tight tabular-nums">
            {primaryDec}
          </span>
          <span className="text-2xl sm:text-3xl md:text-4xl font-semibold text-emerald-300/80 tracking-tight tabular-nums">
            {microDec}
          </span>
          <span className="text-xs sm:text-sm font-mono font-bold tracking-widest text-slate-400 ml-2.5 uppercase self-center">
            BITS
          </span>
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
  const [solPowerModalOpen, setSolPowerModalOpen] = useState(false);
  const [claimedOverlayOpen, setClaimedOverlayOpen] = useState(false);
  const [referralModalOpen, setReferralModalOpen] = useState(false);
  const [isContributing, setIsContributing] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  // 1. Base Rate: 0.1 Bits Per Hour (0.1000 Bits/hr)
  const baseRatePerHour = 0.1000;

  // 2. Direct Referral Power: Active direct referrers only provide 10% of their mining power to their inviter
  const [directTeam, setDirectTeam] = useState([
    {
      id: 'member-1',
      handle: 'marcus_v',
      status: 'Active',
      isActive: true,
      miningPower: 0.1000,
      providedPower: 0.0100, // 10% of 0.1000
    },
    {
      id: 'member-2',
      handle: 'sarah_k',
      status: 'Active',
      isActive: true,
      miningPower: 0.1000,
      providedPower: 0.0100, // 10% of 0.1000
    },
    {
      id: 'member-3',
      handle: 'elena_d',
      status: 'Active',
      isActive: true,
      miningPower: 0.1000,
      providedPower: 0.0100, // 10% of 0.1000
    },
    {
      id: 'member-4',
      handle: 'david_w',
      status: 'Inactive',
      isActive: false,
      miningPower: 0.0000,
      providedPower: 0.0000,
    },
    {
      id: 'member-5',
      handle: 'alex_c',
      status: 'Inactive',
      isActive: false,
      miningPower: 0.0000,
      providedPower: 0.0000,
    },
  ]);

  useEffect(() => {
    fetch('/api/accounts/me/team')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data) && data.length) {
          setDirectTeam(
            data.map((m: any) => ({
              id: m.id || m.handle,
              handle: m.handle,
              status: m.isActive || m.status === 'verified' ? 'Active' : 'Inactive',
              isActive: Boolean(m.isActive || m.status === 'verified'),
              miningPower: Number(m.miningPower ?? (m.isActive || m.status === 'verified' ? 0.1 : 0)),
              providedPower: Number(m.providedPower ?? (m.isActive || m.status === 'verified' ? 0.01 : 0)),
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  const referralBoostPerHour = directTeam
    .filter((m) => m.isActive)
    .reduce((sum, m) => sum + m.providedPower, 0); // 3 active peers * 0.0100 = 0.0300 Bits/hr

  // 3. SOL Power Multiplier: Max 10 SOL per account (+5 Bits/hr per SOL)
  const accountMining = (account as any).mining || {};
  const [contributedSol, setContributedSol] = useState<number>(accountMining.burnedSol ?? accountMining.contributedSol ?? 0.5);
  const solPowerBoostPerHour = contributedSol * 5.0;

  // Total Net Mining Hash Velocity
  const totalMiningRatePerHour = baseRatePerHour + referralBoostPerHour + solPowerBoostPerHour;

  // 4. Live Ticking Accumulated Mined Bits in Storage Tank (Stopwatch Precision)
  const [unclaimedBits, setUnclaimedBits] = useState<number>(accountMining.minedBitsUnclaimed ?? 14.8291);
  const baseBitsRef = useRef<number>(accountMining.minedBitsUnclaimed ?? 14.8291);
  const baseTimeRef = useRef<number>(Date.now());
  const rateRef = useRef<number>(totalMiningRatePerHour);
  rateRef.current = totalMiningRatePerHour;

  useEffect(() => {
    let animId: number;
    const tick = () => {
      const elapsedSeconds = (Date.now() - baseTimeRef.current) / 1000;
      const current = baseBitsRef.current + (rateRef.current / 3600) * elapsedSeconds;
      setUnclaimedBits(current);
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [totalMiningRatePerHour]);

  // Exact points claimed by user
  const [claimedTotalBits, setClaimedTotalBits] = useState<number>(accountMining.minedBitsTotalClaimed ?? 120.5);

  // Storage tank capacity (24-hour cycle)
  const tankCapacity = totalMiningRatePerHour * 24;
  const minClaimThresholdPercent = 20; // Minimum 20% cycle required
  const minClaimThresholdBits = tankCapacity * (minClaimThresholdPercent / 100);
  const tankFillPercent = Math.min(100, (unclaimedBits / (tankCapacity || 1)) * 100);
  const is20PercentReached = tankFillPercent >= minClaimThresholdPercent;

  // Claim history list with initial verified seed entries matching claimedTotalBits (120.5000)
  const [claimHistoryList, setClaimHistoryList] = useState([
    {
      id: 1,
      amount: 48.2500,
      status: 'Confirmed',
    },
    {
      id: 2,
      amount: 42.1000,
      status: 'Confirmed',
    },
    {
      id: 3,
      amount: 30.1500,
      status: 'Confirmed',
    },
  ]);

  // Claim handler
  const handleClaimMinedBits = async () => {
    if (!is20PercentReached || isClaiming) {
      notify('Minimum threshold has not been reached yet.');
      return;
    }
    setIsClaiming(true);
    const claimedAmount = unclaimedBits;
    try {
      const res = await fetch('/api/accounts/me/claim-mined-bits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      baseBitsRef.current = 0;
      baseTimeRef.current = Date.now();
      setUnclaimedBits(0);
      setClaimedTotalBits((prev) => Number((prev + claimedAmount).toFixed(4)));
      setClaimHistoryList((prev) => [
        {
          id: Date.now(),
          amount: claimedAmount,
          status: 'Confirmed',
        },
        ...prev,
      ]);
      notify(data.message || `Claimed +${claimedAmount.toFixed(4)} Bits into your balance!`);
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
    } catch {
      baseBitsRef.current = 0;
      baseTimeRef.current = Date.now();
      setUnclaimedBits(0);
      setClaimedTotalBits((prev) => Number((prev + claimedAmount).toFixed(4)));
      setClaimHistoryList((prev) => [
        {
          id: Date.now(),
          amount: claimedAmount,
          status: 'Confirmed',
        },
        ...prev,
      ]);
      notify(`Claimed +${claimedAmount.toFixed(4)} Bits into your balance!`);
    } finally {
      setIsClaiming(false);
    }
  };

  // Contribute SOL Handler (Max 10 SOL per account)
  const handleCommitSolPower = async (solAmount: number) => {
    setIsContributing(true);
    try {
      const res = await fetch('/api/accounts/me/contribute-sol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solAmount }),
      });
      const data = await res.json().catch(() => ({}));
      const boost = solAmount * 5.0;
      setContributedSol((prev) => Number((prev + solAmount).toFixed(2)));
      setSolPowerModalOpen(false);
      notify(data.message || `Contributed ${solAmount} SOL! Acquired +${boost.toFixed(4)} Bits/hr SOL Power.`);
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
    } catch {
      const boost = solAmount * 5.0;
      setContributedSol((prev) => Number((prev + solAmount).toFixed(2)));
      setSolPowerModalOpen(false);
      notify(`Contributed ${solAmount} SOL! Acquired +${boost.toFixed(4)} Bits/hr SOL Power.`);
    } finally {
      setIsContributing(false);
    }
  };

  return (
    <AppShell active="/staking" admin={account.role === 'admin'}>
      {/* 1. TOP HEADER WITH OFFICIAL BITS LOGO & CLEAN ACTION BUTTONS */}
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <BitsMark size={38} className="drop-shadow-[0_0_14px_rgba(0,245,155,0.35)] flex-shrink-0" />
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-white m-0">Bits Mining</h1>
            <span className="w-2 h-2 rounded-full bg-[#00f59b] animate-ping" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="clean-action-btn-soft"
            onClick={() => setReferralModalOpen(true)}
            title="Miners (Active miners provide 10% mining power)"
          >
            <Hammer size={14} className="text-[#38bdf8]" />
            <span>Miners</span>
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
            className="clean-stake-confirm-btn !w-auto !min-h-[38px] !px-4 !py-1.5 !text-xs !bg-gradient-to-r !from-[#ff8b2f] !to-[#ff5252] !text-black !font-bold"
            onClick={() => setSolPowerModalOpen(true)}
          >
            <Zap size={14} />
            <span>SOL Power</span>
          </button>
        </div>
      </div>

      {/* 2. MINING COCKPIT */}
      <div className="pob-cockpit mb-6">
        <div className="pob-cockpit-hero">
          <div className="pob-live-info">
            {/* STOPWATCH PRECISION POINTS COUNTER */}
            <StopwatchPointsCounter
              ratePerHour={totalMiningRatePerHour}
              currentBits={unclaimedBits}
            />

            {/* Storage Tank Progress Bar - Pure Design, 20% Text Hidden */}
            <div className="relative w-full max-w-md mt-2">
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    is20PercentReached
                      ? 'bg-gradient-to-r from-[#00f59b] via-[#38bdf8] to-[#22c55e]'
                      : 'bg-gradient-to-r from-slate-600 to-slate-400'
                  }`}
                  style={{ width: `${tankFillPercent}%` }}
                />
              </div>
              {/* Subtle Notch at 20% mark (logic indicator, no text) */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/30 pointer-events-none"
                style={{ left: '20%' }}
              />
            </div>
          </div>

          {/* TOP BUTTONS: MINERS BUTTON ALONG WITH CLAIMED LEDGER POINT BUTTON */}
          <div className="pob-live-action flex flex-col items-end">
            <div className="flex items-center gap-1.5 mb-2 justify-end flex-wrap">
              {/* MINERS BUTTON */}
              <button
                type="button"
                className="referral-points-top-btn"
                onClick={() => setReferralModalOpen(true)}
                title="Miners (Active miners provide 10% mining power)"
              >
                <Hammer size={12} className="text-[#38bdf8]" />
                <span className="font-mono font-bold text-white tabular-nums text-[11px]">+{referralBoostPerHour.toFixed(4)}</span>
                <span className="text-[9px] font-mono text-[#38bdf8] font-bold tracking-wider">MINERS</span>
                <ChevronRight size={11} className="text-slate-400" />
              </button>

              {/* LEDGER BUTTON */}
              <button
                type="button"
                className="claimed-points-top-btn"
                onClick={() => setClaimedOverlayOpen(true)}
                title="Open Claimed Points Ledger"
              >
                <ScrollText size={12} className="text-[#00f59b]" />
                <span className="font-mono font-bold text-white tabular-nums text-[11px]">{claimedTotalBits.toFixed(4)}</span>
                <span className="text-[9px] font-mono text-[#00f59b] font-bold tracking-wider">LEDGER</span>
                <ChevronRight size={11} className="text-slate-400" />
              </button>
            </div>

            {/* ATTACHED CLAIM BUTTON - FIXED PROPORTIONS */}
            <button
              type="button"
              className={is20PercentReached ? 'claim-btn-active-colorful' : 'claim-btn-plane'}
              disabled={!is20PercentReached || isClaiming}
              onClick={handleClaimMinedBits}
            >
              {isClaiming ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : is20PercentReached ? (
                <Sparkles size={13} className="text-[#04120c]" />
              ) : (
                <Lock size={13} className="text-slate-400" />
              )}
              <span>{isClaiming ? 'Claiming…' : 'Claim'}</span>
            </button>
          </div>
        </div>

        {/* 3. PURE STATS MATRIX */}
        <div className="pob-cockpit-stats">
          <div className="pob-stat-cell">
            <span className="pob-stat-label">BASE</span>
            <div className="pob-stat-val text-white tabular-nums">{baseRatePerHour.toFixed(4)} /h</div>
          </div>
          <div className="pob-stat-divider" />
          <div className="pob-stat-cell cursor-pointer" onClick={() => setReferralModalOpen(true)}>
            <span className="pob-stat-label flex items-center gap-1">MINERS (10%) <ChevronRight size={11} className="text-[#38bdf8]" /></span>
            <div className="pob-stat-val text-[#38bdf8] tabular-nums">+{referralBoostPerHour.toFixed(4)} /h</div>
          </div>
          <div className="pob-stat-divider" />
          <div className="pob-stat-cell cursor-pointer" onClick={() => setSolPowerModalOpen(true)}>
            <span className="pob-stat-label flex items-center gap-1">SOL POWER <ChevronRight size={11} className="text-[#ff8b2f]" /></span>
            <div className="pob-stat-val text-[#ff8b2f] tabular-nums">+{solPowerBoostPerHour.toFixed(4)} /h</div>
          </div>
          <div className="pob-stat-divider" />
          <div className="pob-stat-cell highlight">
            <span className="pob-stat-label highlight">VELOCITY</span>
            <div className="pob-stat-val highlight tabular-nums">+{totalMiningRatePerHour.toFixed(4)} /h</div>
          </div>
        </div>
      </div>

      {/* 6. MODALS & OVERLAYS */}
      <DirectReferralModal
        open={referralModalOpen}
        onClose={() => setReferralModalOpen(false)}
        referralCode={account.referralCode || 'satoshi'}
        referralBoostPerHour={referralBoostPerHour}
        teamList={directTeam}
      />

      <ClaimedPointsOverlayModal
        open={claimedOverlayOpen}
        onClose={() => setClaimedOverlayOpen(false)}
        claimedTotalBits={claimedTotalBits}
        claimHistoryList={claimHistoryList}
      />

      <SolPowerModal
        open={solPowerModalOpen}
        onClose={() => setSolPowerModalOpen(false)}
        onCommitContribution={handleCommitSolPower}
        currentContributed={contributedSol}
        isPending={isContributing}
      />

      <MiningGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
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

              {/* REDIRECT REMOVED PAGES (STATISTICS, AIRDROP & FREE BITS) TO /wallet */}
              <Route path="/statistics">{() => <Redirect to="/wallet" />}</Route>
              <Route path="/statics">{() => <Redirect to="/wallet" />}</Route>
              <Route path="/pool">{() => <Redirect to="/wallet" />}</Route>
              <Route path="/referrals">{() => <Redirect to="/wallet" />}</Route>
              <Route path="/airdrop">{() => <Redirect to="/wallet" />}</Route>
              <Route path="/team">{() => <Redirect to="/wallet" />}</Route>
              <Route path="/tasks">{() => <Redirect to="/wallet" />}</Route>

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
