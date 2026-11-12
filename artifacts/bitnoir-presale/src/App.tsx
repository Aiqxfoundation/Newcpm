import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Check, ChevronDown, ChevronRight, Copy, ExternalLink, Flame,
  Hammer, Lock, RefreshCw, ScrollText, ShieldAlert, ShieldCheck, Sparkles, Wallet, X, Zap
} from 'lucide-react';
import {
  getGetMyAccountQueryKey, getGetMyActivityQueryKey, useGetMyAccount,
} from '@workspace/api-client-react';
import type { UserAccount } from '@workspace/api-client-react';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/hooks/use-toast';
import NotFound from '@/pages/not-found';
import {
  fetchSolBalance,
  getSavedMiningPass,
  saveMiningPass,
  isWalletPassVerified,
  mintMiningPass,
  type MiningPassData,
  PROTOCOL_TREASURY_SOLANA,
  getPhantomSolanaProvider,
} from './lib/solana';
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
      if (event.type === 'updated' && event.action.type === 'error') {
        showError(event.query.state.error, 'Unable to load this information. Please try again.');
      }
    });
    const unsubscribeMutations = client.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      if (event.action.type === 'error') {
        showError(event.mutation.state.error, 'Unable to complete that action. Please try again.');
      }
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

// ---------------------------------------------------------------------------
// BRAND & ICONS
// ---------------------------------------------------------------------------
function Brand({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const textSize = size === 'sm' ? 18 : size === 'lg' ? 26 : 22;
  const logoPx = size === 'sm' ? 26 : size === 'lg' ? 38 : 32;

  return (
    <div className="flex items-center gap-2.5 select-none" style={{ fontSize: textSize }}>
      <img
        src="/asset-bitnoir-md.png"
        srcSet="/asset-bitnoir-sm.png 64w, /asset-bitnoir-md.png 128w, /asset-bitnoir-lg.png 256w, /asset-bitnoir.png 512w"
        sizes={`${logoPx}px`}
        alt="Bitnoir logo"
        width={logoPx}
        height={logoPx}
        className="block object-contain flex-shrink-0 drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]"
        style={{ imageRendering: '-webkit-optimize-contrast' }}
      />
      <div className="flex items-center gap-2">
        <span className="font-serif font-bold tracking-tight text-[#ff8b2f]">Bitnoir</span>
        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[#00f59b]/15 text-[#00f59b] border border-[#00f59b]/30 uppercase tracking-wider">
          BITS MINING
        </span>
      </div>
    </div>
  );
}

function BitsMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  const defaultSrc = size <= 28 ? '/asset-bits-sm.png' : size <= 54 ? '/asset-bits-md.png' : '/asset-bits.png';
  return (
    <img
      src={defaultSrc}
      srcSet="/asset-bits-xs.png 32w, /asset-bits-sm.png 64w, /asset-bits-md.png 128w, /asset-bits-lg.png 256w, /asset-bits.png 512w"
      sizes={`${size}px`}
      alt="Bits"
      className={`inline-block object-contain flex-shrink-0 ${className}`}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        imageRendering: '-webkit-optimize-contrast',
      }}
    />
  );
}

function PhantomLogo({ size = 15, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M110.584 64.9123C110.584 94.4699 87.2797 118.431 58.5307 118.431C33.8643 118.431 13.2766 100.864 8.01639 77.0697C6.98595 72.4116 10.6358 68.2127 15.4057 68.2127H26.3776C29.626 68.2127 32.4149 70.4729 33.1091 73.6559C35.9189 86.536 46.8837 96.1158 59.988 96.1158C75.3908 96.1158 87.8778 83.0505 87.8778 66.9341C87.8778 50.8177 75.3908 37.7524 59.988 37.7524C48.0673 37.7524 37.893 45.8647 34.0205 57.068C32.9099 60.2829 29.8315 62.4691 26.4357 62.4691H15.1118C10.4284 62.4691 6.83789 58.3754 7.8202 53.7915C12.8315 30.3952 33.2662 13 57.6596 13C86.8908 13 110.584 36.2415 110.584 64.9123Z"
        fill="currentColor"
      />
      <circle cx="47.5" cy="53.5" r="5.5" fill="#180702" />
      <circle cx="73.5" cy="53.5" r="5.5" fill="#180702" />
    </svg>
  );
}

function shortSolanaAddress(addr: string): string {
  if (!addr) return '';
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// AUTH & WALLET CONTEXT (SOLANA PHANTOM + SEAMLESS MINER IDENTITY)
// ---------------------------------------------------------------------------
type AuthUser = {
  id: string;
  solanaAddress: string;
  name: string;
  username: string;
  email: string;
  isAdmin?: boolean;
};

const AuthContext = createContext<{
  user: AuthUser | null;
  ready: boolean;
  connectWallet: (customAddress?: string) => Promise<string>;
  disconnectWallet: () => Promise<void>;
}>({
  user: null,
  ready: false,
  connectWallet: async () => '',
  disconnectWallet: async () => undefined,
});

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 1. Check existing saved Solana public address from localStorage
    const saved = localStorage.getItem('bitnoir-solana-address');
    const savedUser = localStorage.getItem('bitnoir-username');
    if (saved && saved.length >= 32) {
      const short = shortSolanaAddress(saved);
      const uname = savedUser || short;
      setUser({
        id: saved,
        solanaAddress: saved,
        username: uname,
        name: `@${uname}`,
        email: `${uname}@bitnoir.io`,
        isAdmin: uname === 'satoshi' || uname === 'admin',
      });
      setReady(true);
      return;
    }

    // 2. Try silent auto-connect if Phantom is available
    const provider = getPhantomSolanaProvider();
    if (provider && provider.connect) {
      provider
        .connect({ onlyIfTrusted: true })
        .then((resp: any) => {
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
          // Default to genesis miner node
          const defaultAddress = 'member-alpha';
          setUser({
            id: defaultAddress,
            solanaAddress: PROTOCOL_TREASURY_SOLANA,
            username: 'satoshinode',
            name: '@satoshinode',
            email: 'satoshi@bitnoir.io',
            isAdmin: true,
          });
        })
        .finally(() => {
          setReady(true);
        });
    } else {
      // Demo ready state
      const defaultAddress = 'member-alpha';
      setUser({
        id: defaultAddress,
        solanaAddress: PROTOCOL_TREASURY_SOLANA,
        username: 'satoshinode',
        name: '@satoshinode',
        email: 'satoshi@bitnoir.io',
        isAdmin: true,
      });
      setReady(true);
    }
  }, []);

  const connectWallet = async (customAddress?: string): Promise<string> => {
    let address = customAddress?.trim();
    if (!address) {
      const provider = getPhantomSolanaProvider();
      if (!provider) {
        throw new Error('PHANTOM_NOT_INSTALLED');
      }
      const resp = await provider.connect();
      if (!resp?.publicKey) {
        throw new Error('Failed to retrieve Solana public address from wallet.');
      }
      address = resp.publicKey.toString();
    }

    if (!address || address.length < 32 || address.length > 44) {
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
      const provider = getPhantomSolanaProvider();
      if (provider && provider.disconnect) {
        await provider.disconnect();
      }
    } catch {
      // Ignore
    }
    localStorage.removeItem('bitnoir-solana-address');
    localStorage.removeItem('bitnoir-username');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, ready, connectWallet, disconnectWallet }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  return useContext(AuthContext);
}

// ---------------------------------------------------------------------------
// TOP WALLET CONNECT (PURE PHANTOM + SOL BALANCE)
// ---------------------------------------------------------------------------
function TopWalletConnect() {
  const { user, connectWallet, disconnectWallet } = useAuth();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.solanaAddress) {
      fetchSolBalance(user.solanaAddress).then(setSolBalance);
    } else {
      setSolBalance(null);
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
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#00f59b]/15 hover:bg-[#00f59b]/25 border border-[#00f59b]/40 text-[#00f59b] text-xs font-bold transition-all cursor-pointer shadow-sm"
      >
        <Wallet size={14} />
        <span>{connecting ? 'Connecting…' : 'Connect Phantom Wallet'}</span>
      </button>
    );
  }

  const shortAddr = shortSolanaAddress(user.solanaAddress);

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.12] text-white text-xs font-mono font-medium transition-all cursor-pointer shadow-sm"
      >
        <div className="w-5 h-5 rounded-full bg-[#ab9ff2]/20 border border-[#ab9ff2]/40 flex items-center justify-center text-[#ab9ff2]">
          <PhantomLogo size={12} />
        </div>
        <span>{user.name || `@${shortAddr}`}</span>
        {solBalance !== null && (
          <span className="text-[11px] text-[#00f59b] font-bold">
            {solBalance.toFixed(2)} SOL
          </span>
        )}
        <ChevronDown size={12} className={`text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
      </button>

      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 290,
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
            Connected Solana Node
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
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
              <span>SOL Balance</span>
              <strong style={{ color: '#fff' }}>{solBalance !== null ? `${solBalance.toFixed(4)} SOL` : 'Loading…'}</strong>
            </div>
          </div>

          <button
            type="button"
            className="button button-danger"
            style={{ width: '100%', minHeight: 32, fontSize: 12 }}
            onClick={() => {
              setMenuOpen(false);
              void disconnectWallet();
            }}
          >
            Disconnect Wallet
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MINING GUIDE MODAL
// ---------------------------------------------------------------------------
function MiningGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255, 139, 47, 0.12)', display: 'grid', placeItems: 'center', color: '#ff8b2f' }}>
              <Flame size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 18 }}>Bits Mining Guide</h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>Proof-of-Power Multipliers & Core Mechanics</p>
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
              Every verified node automatically mines at the baseline speed of 0.1000 Bits per hour. No physical hardware or electricity drain required.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/8">
            <div className="flex items-center gap-2 mb-1 text-sm font-bold text-white">
              <Hammer size={15} className="text-[#38bdf8]" />
              <span>2. Direct Miners Power (10% Mining Power)</span>
            </div>
            <p className="text-slate-400 m-0 leading-relaxed">
              Active direct miners provide 10% of their mining power to their inviter. Inactive miners do not contribute hash power until their node is activated.
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
              <span>4. 24-Hour Storage Tank & Instant Claims</span>
            </div>
            <p className="text-slate-400 m-0 leading-relaxed">
              Mined Bits stream in real time into your 24h Storage Tank. Once the tank reaches 20% capacity, claim anytime to credit your available wallet balance.
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
// SOL POWER MODAL: CONTRIBUTE SOL TO ACQUIRE SOL POWER (MAX 10 SOL)
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

// ---------------------------------------------------------------------------
// CLAIMED POINTS OVERLAY MODAL
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
// DIRECT REFERRAL MODAL (10% MINING POWER)
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
              <strong className="text-white">Active Miners Rule:</strong> Active direct miners provide{' '}
              <span className="text-[#38bdf8] font-bold">10% of their mining power</span> to their inviter. Inactive
              miners provide 0% until activated.
            </div>
          </div>
        </div>

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
                    fontFamily: 'monospace',
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
// SOULBOUND MINING PASS MODAL (IN-MODAL MINTING)
// ---------------------------------------------------------------------------
function MintPassModal({
  open,
  onClose,
  ownerAddress,
  onMintSuccess,
}: {
  open: boolean;
  onClose: () => void;
  ownerAddress: string;
  onMintSuccess: (pass: MiningPassData) => void;
}) {
  const [minting, setMinting] = useState(false);

  if (!open) return null;

  const handleMint = async () => {
    setMinting(true);
    try {
      const pass = await mintMiningPass({ ownerAddress });
      saveMiningPass(pass);
      onMintSuccess(pass);
      toast({
        title: 'Mining Pass Minted!',
        description: `Soulbound Pass ${pass.passId} verified on Solana. 100% mining velocity unlocked!`,
      });
      onClose();
    } catch (err: any) {
      toast({
        title: 'Mint failed',
        description: readableError(err, 'Could not complete pass mint.'),
        variant: 'destructive',
      });
    } finally {
      setMinting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, textAlign: 'center' }}>
        <div className="modal-header" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255, 139, 47, 0.15)', display: 'grid', placeItems: 'center', color: '#ff8b2f' }}>
              <Sparkles size={18} />
            </div>
            <div style={{ textAlign: 'left' }}>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 18, fontWeight: 700 }}>Soulbound Mining Pass</h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>Solana Non-Transferable Node Identity</p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="py-4 flex flex-col items-center gap-4">
          <div className="w-24 h-24 rounded-2xl bg-gradient-to-tr from-[#ff8b2f]/20 via-[#00f59b]/20 to-[#38bdf8]/20 border-2 border-[#00f59b]/40 flex items-center justify-center shadow-[0_0_30px_rgba(0,245,155,0.2)]">
            <BitsMark size={64} className="drop-shadow-[0_0_15px_rgba(0,245,155,0.5)]" />
          </div>

          <div>
            <div className="text-xs uppercase tracking-widest text-[#00f59b] font-mono font-bold mb-1">
              Proof-of-Power Pass
            </div>
            <h4 className="text-xl font-bold text-white m-0">
              0.02 SOL One-Time Verification
            </h4>
            <p className="text-xs text-slate-300 max-w-sm mx-auto mt-2 leading-relaxed">
              Mint your permanent soulbound identifier on Solana. Locks onchain sybil resistance and activates full 24-hour mining tank claims.
            </p>
          </div>

          <div className="w-full p-3 rounded-xl bg-white/[0.03] border border-white/8 text-xs font-mono text-left space-y-1.5">
            <div className="flex justify-between text-slate-400">
              <span>Node Address</span>
              <span className="text-white font-bold">{shortSolanaAddress(ownerAddress)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Network</span>
              <span className="text-white font-bold">Solana Devnet / Mainnet</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Standard Fee</span>
              <span className="text-[#00f59b] font-bold">0.02 SOL</span>
            </div>
          </div>

          <button
            type="button"
            className="clean-stake-confirm-btn !bg-gradient-to-r !from-[#00f59b] !to-[#38bdf8] !text-black !font-bold w-full"
            disabled={minting}
            onClick={handleMint}
          >
            {minting ? (
              <span className="flex items-center justify-center gap-2">
                <RefreshCw size={14} className="animate-spin" /> Minting on Solana…
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Sparkles size={16} /> Mint Soulbound Miner Pass (0.02 SOL)
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STOPWATCH-STYLE LIVE MINING POINTS COUNTER (PRECISION ODOMETER TICKER)
// ---------------------------------------------------------------------------
function StopwatchPointsCounter({
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
        <BitsMark size={42} className="drop-shadow-[0_0_16px_rgba(0,245,155,0.4)] flex-shrink-0" />
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
// THE STANDALONE BITS MINING PAGE
// ---------------------------------------------------------------------------
function MiningPage() {
  const client = useQueryClient();
  const { user } = useAuth();
  const accountQuery = useGetMyAccount({ query: { queryKey: getGetMyAccountQueryKey() } });

  const [guideOpen, setGuideOpen] = useState(false);
  const [solPowerModalOpen, setSolPowerModalOpen] = useState(false);
  const [claimedOverlayOpen, setClaimedOverlayOpen] = useState(false);
  const [referralModalOpen, setReferralModalOpen] = useState(false);
  const [mintPassModalOpen, setMintPassModalOpen] = useState(false);
  const [isContributing, setIsContributing] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  const account = accountQuery.data;
  const currentOwner = user?.solanaAddress || account?.id || 'member-alpha';
  const [isVerified, setIsVerified] = useState(() => isWalletPassVerified(currentOwner));

  useEffect(() => {
    setIsVerified(isWalletPassVerified(currentOwner));
  }, [currentOwner]);

  // 1. Base Rate: 0.1 Bits Per Hour (0.1000 Bits/hr)
  const baseRatePerHour = 0.1000;

  // 2. Direct Referral Power: Active direct referrers provide 10% of their mining power
  const [directTeam, setDirectTeam] = useState([
    { id: 'member-1', handle: 'marcus_v', status: 'Active', isActive: true, miningPower: 0.1000, providedPower: 0.0100 },
    { id: 'member-2', handle: 'sarah_k', status: 'Active', isActive: true, miningPower: 0.1000, providedPower: 0.0100 },
    { id: 'member-3', handle: 'elena_d', status: 'Active', isActive: true, miningPower: 0.1000, providedPower: 0.0100 },
    { id: 'member-4', handle: 'david_w', status: 'Inactive', isActive: false, miningPower: 0.0000, providedPower: 0.0000 },
    { id: 'member-5', handle: 'alex_c', status: 'Inactive', isActive: false, miningPower: 0.0000, providedPower: 0.0000 },
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
  const accountMining = (account as any)?.mining || {};
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
  const tankFillPercent = Math.min(100, (unclaimedBits / (tankCapacity || 1)) * 100);
  const is20PercentReached = tankFillPercent >= minClaimThresholdPercent;

  // Claim history list
  const [claimHistoryList, setClaimHistoryList] = useState([
    { id: 1, amount: 48.2500, status: 'Confirmed' },
    { id: 2, amount: 42.1000, status: 'Confirmed' },
    { id: 3, amount: 30.1500, status: 'Confirmed' },
  ]);

  // Claim handler
  const handleClaimMinedBits = async () => {
    if (!is20PercentReached || isClaiming) {
      toast({ title: 'Minimum threshold', description: 'Reach 20% storage tank capacity to claim.' });
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
        { id: Date.now(), amount: claimedAmount, status: 'Confirmed' },
        ...prev,
      ]);
      toast({
        title: 'Mined Bits Claimed',
        description: data.message || `Claimed +${claimedAmount.toFixed(4)} Bits into your balance!`,
      });
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
    } catch {
      baseBitsRef.current = 0;
      baseTimeRef.current = Date.now();
      setUnclaimedBits(0);
      setClaimedTotalBits((prev) => Number((prev + claimedAmount).toFixed(4)));
      setClaimHistoryList((prev) => [
        { id: Date.now(), amount: claimedAmount, status: 'Confirmed' },
        ...prev,
      ]);
      toast({
        title: 'Mined Bits Claimed',
        description: `Claimed +${claimedAmount.toFixed(4)} Bits into your balance!`,
      });
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
      toast({
        title: 'SOL Power Acquired',
        description: data.message || `Contributed ${solAmount} SOL! Acquired +${boost.toFixed(4)} Bits/hr SOL Power.`,
      });
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
    } catch {
      const boost = solAmount * 5.0;
      setContributedSol((prev) => Number((prev + solAmount).toFixed(2)));
      setSolPowerModalOpen(false);
      toast({
        title: 'SOL Power Acquired',
        description: `Contributed ${solAmount} SOL! Acquired +${boost.toFixed(4)} Bits/hr SOL Power.`,
      });
    } finally {
      setIsContributing(false);
    }
  };

  const savedPass = getSavedMiningPass(currentOwner);

  return (
    <div className="min-h-screen bg-[#07080b] text-[#eff3f8] flex flex-col font-sans">
      {/* TOP CLEAN APP HEADER - NO SIDEBAR, NO UNRELATED MENU OPTIONS */}
      <header className="border-b border-white/[0.08] bg-[#0c121d]/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Brand size="md" />
          <div className="flex items-center gap-3">
            <TopWalletConnect />
          </div>
        </div>
      </header>

      {/* MAIN BITS MINING STAGE */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        {/* 1. TOP HEADER WITH OFFICIAL BITS LOGO & CLEAN ACTION BUTTONS */}
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <div className="flex items-center gap-3">
            <BitsMark size={38} className="drop-shadow-[0_0_14px_rgba(0,245,155,0.35)] flex-shrink-0" />
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white m-0">Bits Mining</h1>
              <span className="w-2.5 h-2.5 rounded-full bg-[#00f59b] animate-ping" />
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

        {/* WALLET VERIFICATION STATUS BANNER */}
        {!isVerified ? (
          <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center flex-shrink-0 text-amber-400 mt-0.5">
                <ShieldAlert size={18} />
              </div>
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Wallet Verification Required</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold uppercase">Unverified</span>
                </div>
                <p className="text-xs text-slate-300 mt-0.5">
                  New miners must verify their Solana wallet with the 0.02 SOL Soulbound Mining Pass to lock onchain proof-of-power.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMintPassModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#ff8b2f] to-[#f5a623] text-black font-mono font-bold text-xs uppercase tracking-wider hover:opacity-95 transition-all flex-shrink-0 cursor-pointer shadow-md"
            >
              <Sparkles size={14} /> Mint Miner Pass
            </button>
          </div>
        ) : (
          <div className="mb-6 px-4 py-3 rounded-2xl bg-[#00f59b]/10 border border-[#00f59b]/25 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-white">
              <ShieldCheck size={18} className="text-[#00f59b] flex-shrink-0" />
              <span>
                <strong className="text-[#00f59b]">Verified Miner:</strong> Soulbound Mining Pass active ({savedPass?.passId || '#BN-SOL-0001'}) — 100% Hashrate velocity unlocked.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMintPassModalOpen(true)}
              className="text-[11px] font-mono text-[#00f59b] hover:underline flex items-center gap-1 flex-shrink-0 cursor-pointer"
            >
              Pass Info <ChevronRight size={12} />
            </button>
          </div>
        )}

        {/* 2. MINING COCKPIT */}
        <div className="pob-cockpit mb-6">
          <div className="pob-cockpit-hero">
            <div className="pob-live-info">
              {/* STOPWATCH PRECISION POINTS COUNTER */}
              <StopwatchPointsCounter
                ratePerHour={totalMiningRatePerHour}
                currentBits={unclaimedBits}
              />

              {/* Storage Tank Progress Bar */}
              <div className="relative w-full max-w-md mt-2">
                <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      is20PercentReached
                        ? 'bg-gradient-to-r from-[#00f59b] via-[#38bdf8] to-[#22c55e]'
                        : 'bg-gradient-to-r from-slate-600 to-slate-400'
                    }`}
                    style={{ width: `${tankFillPercent}%` }}
                  />
                </div>
                {/* Subtle Notch at 20% mark */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white/30 pointer-events-none"
                  style={{ left: '20%' }}
                  title="20% Minimum Claim Unlock Notch"
                />
              </div>
              <div className="flex justify-between max-w-md text-[10px] font-mono text-slate-400 mt-1">
                <span>Storage Tank: {tankFillPercent.toFixed(1)}%</span>
                <span className={is20PercentReached ? 'text-[#00f59b] font-bold' : ''}>
                  {is20PercentReached ? 'Ready to Claim' : '20% to Unlock'}
                </span>
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

              {/* ATTACHED CLAIM BUTTON */}
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
                <span>{isClaiming ? 'Claiming…' : 'Claim Mined Bits'}</span>
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

      </main>

      {/* MODALS */}
      <DirectReferralModal
        open={referralModalOpen}
        onClose={() => setReferralModalOpen(false)}
        referralCode={account?.referralCode || 'satoshi'}
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

      <MintPassModal
        open={mintPassModalOpen}
        onClose={() => setMintPassModalOpen(false)}
        ownerAddress={currentOwner}
        onMintSuccess={() => setIsVerified(true)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// APPLICATION ROUTER (KEEP ONLY BITS MINING PAGE, REMOVE ALL OTHER ROUTES)
// ---------------------------------------------------------------------------
function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <FeedbackMonitor />
        <WouterRouter base={basePath}>
          <Switch>
            <Route path="/" component={MiningPage} />
            <Route path="/mining" component={MiningPage} />
            <Route path="/staking" component={MiningPage} />
            {/* Any legacy route automatically redirects directly to Bits Mining */}
            <Route path="/wallet">{() => <Redirect to="/" />}</Route>
            <Route path="/profile">{() => <Redirect to="/" />}</Route>
            <Route path="/mint">{() => <Redirect to="/" />}</Route>
            <Route path="/whitepaper">{() => <Redirect to="/" />}</Route>
            <Route path="/docs">{() => <Redirect to="/" />}</Route>
            <Route path="/admin">{() => <Redirect to="/" />}</Route>
            <Route component={MiningPage} />
          </Switch>
        </WouterRouter>
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
