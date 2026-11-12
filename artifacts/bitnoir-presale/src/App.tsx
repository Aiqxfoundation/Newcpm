import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight,
  Coins, Copy, ExternalLink, Flame, Hammer, History, Lock, QrCode, RefreshCw,
  Repeat, ScrollText, Send, ShieldCheck, Sparkles, User, Wallet, X, Zap
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
  PROTOCOL_TREASURY_SOLANA,
  getPhantomSolanaProvider,
  sendSolanaTransactionOnchain,
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
        src="/bitnoir-hd.png"
        alt="Bitnoir logo"
        width={logoPx}
        height={logoPx}
        className="block object-contain flex-shrink-0"
        style={{ width: logoPx, height: logoPx }}
      />
      <div className="flex items-center gap-2">
        <span className="font-serif font-bold tracking-tight text-[#ff8b2f]">Bitnoir</span>
      </div>
    </div>
  );
}

function BitsMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/bits-hd.png"
      alt="Bits"
      className={`inline-block object-contain flex-shrink-0 ${className}`}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
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
  isVerified: boolean;
  verifiedTx?: string;
};

const AuthContext = createContext<{
  user: AuthUser | null;
  ready: boolean;
  connectWallet: (customAddress?: string) => Promise<string>;
  disconnectWallet: () => Promise<void>;
  verifyWalletOnchain: () => Promise<string>;
  setUsernameHandle: (handle: string) => Promise<void>;
}>({
  user: null,
  ready: false,
  connectWallet: async () => '',
  disconnectWallet: async () => undefined,
  verifyWalletOnchain: async () => '',
  setUsernameHandle: async () => undefined,
});

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 1. Check existing saved Solana public address from localStorage
    const saved = localStorage.getItem('bitnoir-solana-address');
    const savedUser = localStorage.getItem('bitnoir-username');

    // Clear legacy mock satoshinode / treasury account
    if (saved === PROTOCOL_TREASURY_SOLANA || savedUser === 'satoshinode') {
      localStorage.removeItem('bitnoir-solana-address');
      localStorage.removeItem('bitnoir-username');
      setUser(null);
      setReady(true);
      return;
    }

    if (saved && saved.length >= 32) {
      const short = shortSolanaAddress(saved);
      const isVer = localStorage.getItem(`bitnoir-verified-${saved}`) === 'true';
      const verTx = localStorage.getItem(`bitnoir-verified-tx-${saved}`) || undefined;
      const uname = isVer ? (savedUser || localStorage.getItem(`bitnoir-username-${saved}`) || '') : '';
      setUser({
        id: saved,
        solanaAddress: saved,
        username: uname,
        name: uname ? `@${uname}` : `@${short}`,
        email: uname ? `${uname}@bitnoir.io` : '',
        isAdmin: false,
        isVerified: isVer,
        verifiedTx: verTx,
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
          const isVer = localStorage.getItem(`bitnoir-verified-${address}`) === 'true';
          const verTx = localStorage.getItem(`bitnoir-verified-tx-${address}`) || undefined;
          const uname = isVer ? (localStorage.getItem(`bitnoir-username-${address}`) || '') : '';
          setUser({
            id: address,
            solanaAddress: address,
            username: uname,
            name: uname ? `@${uname}` : `@${short}`,
            email: '',
            isAdmin: false,
            isVerified: isVer,
            verifiedTx: verTx,
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
    const isVer = localStorage.getItem(`bitnoir-verified-${address}`) === 'true';
    const verTx = localStorage.getItem(`bitnoir-verified-tx-${address}`) || undefined;
    const uname = isVer ? (localStorage.getItem(`bitnoir-username-${address}`) || '') : '';
    const authUser: AuthUser = {
      id: address,
      solanaAddress: address,
      username: uname,
      name: uname ? `@${uname}` : `@${short}`,
      email: '',
      isAdmin: false,
      isVerified: isVer,
      verifiedTx: verTx,
    };
    setUser(authUser);
    return address;
  };

  const verifyWalletOnchain = async (): Promise<string> => {
    if (!user?.solanaAddress) {
      throw new Error('Please connect your Solana wallet first.');
    }

    const result = await sendSolanaTransactionOnchain({
      fromAddress: user.solanaAddress,
      toAddress: PROTOCOL_TREASURY_SOLANA,
      amountSol: 0.02,
      memo: 'Bitnoir One-Time Node Verification (0.02 SOL)',
    });

    const sig = result.signature;
    localStorage.setItem(`bitnoir-verified-${user.solanaAddress}`, 'true');
    localStorage.setItem(`bitnoir-verified-tx-${user.solanaAddress}`, sig);

    await fetch('/api/accounts/me/verify-wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature: sig }),
    }).catch(() => {});

    setUser((prev) => (prev ? { ...prev, isVerified: true, verifiedTx: sig } : null));
    return sig;
  };

  const setUsernameHandle = async (handle: string): Promise<void> => {
    if (!user?.solanaAddress) throw new Error('Wallet not connected.');
    const clean = handle.trim().replace(/^@/, '').toLowerCase();
    if (!clean || clean.length < 3 || clean.length > 20 || !/^[a-z0-9_]+$/.test(clean)) {
      throw new Error('Username must be 3-20 alphanumeric characters or underscore.');
    }

    localStorage.setItem(`bitnoir-username-${user.solanaAddress}`, clean);
    localStorage.setItem('bitnoir-username', clean);

    await fetch('/api/accounts/me/set-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: clean }),
    }).catch(() => {});

    setUser((prev) => (prev ? { ...prev, username: clean, name: `@${clean}` } : null));
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
    <AuthContext.Provider
      value={{
        user,
        ready,
        connectWallet,
        disconnectWallet,
        verifyWalletOnchain,
        setUsernameHandle,
      }}
    >
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
function TopWalletConnect({ onOpenVerify }: { onOpenVerify?: () => void }) {
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
        toast({
          title: 'Phantom Wallet Required',
          description: 'Please install or unlock the Phantom wallet browser extension.',
          variant: 'destructive',
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
        <span>{connecting ? 'Connecting…' : 'Connect'}</span>
      </button>
    );
  }

  const shortAddr = shortSolanaAddress(user.solanaAddress);

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }} ref={dropdownRef}>
      {!user.isVerified && onOpenVerify && (
        <button
          type="button"
          onClick={onOpenVerify}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#00f59b]/15 hover:bg-[#00f59b]/25 border border-[#00f59b]/40 text-[#00f59b] text-[11px] font-bold font-mono transition-all cursor-pointer shadow-sm"
        >
          <Zap size={11} />
          <span>Verify Node</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.12] text-white text-xs font-mono font-medium transition-all cursor-pointer shadow-sm"
      >
        <div className="w-5 h-5 rounded-full bg-[#ab9ff2]/20 border border-[#ab9ff2]/40 flex items-center justify-center text-[#ab9ff2]">
          <PhantomLogo size={12} />
        </div>
        <span className="flex items-center gap-1">
          {user.name || `@${shortAddr}`}
          {user.isVerified && <Check size={11} className="text-[#00f59b]" strokeWidth={3} />}
        </span>
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
            <BitsMark size={32} />
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
        <BitsMark size={42} className="flex-shrink-0" />
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
function MiningPage({ onOpenAssets }: { onOpenAssets?: () => void }) {
  const client = useQueryClient();
  const { user } = useAuth();
  const accountQuery = useGetMyAccount({ query: { queryKey: getGetMyAccountQueryKey() } });

  const [guideOpen, setGuideOpen] = useState(false);
  const [solPowerModalOpen, setSolPowerModalOpen] = useState(false);
  const [claimedOverlayOpen, setClaimedOverlayOpen] = useState(false);
  const [referralModalOpen, setReferralModalOpen] = useState(false);
  const [isContributing, setIsContributing] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  const account = accountQuery.data;

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

  // 24-hour cycle countdown timer
  const cycleTotalSeconds = 24 * 3600;
  const elapsedSeconds = Math.min(cycleTotalSeconds, (unclaimedBits / (totalMiningRatePerHour || 1)) * 3600);
  const remainingSeconds = Math.max(0, cycleTotalSeconds - elapsedSeconds);
  const remH = Math.floor(remainingSeconds / 3600);
  const remM = Math.floor((remainingSeconds % 3600) / 60);
  const remS = Math.floor(remainingSeconds % 60);
  const countdownTimer = `${remH.toString().padStart(2, '0')}:${remM.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;

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

  return (
    <div className="min-h-screen bg-[#07080b] text-[#eff3f8] flex flex-col font-sans">
      {/* TOP CLEAN APP HEADER */}
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
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white m-0">Bits Mining</h1>
            <span className="w-2.5 h-2.5 rounded-full bg-[#00f59b] animate-ping" />
          </div>

          {/* ACTION BUTTONS: MINERS, GUIDE, ASSETS & SOL POWER */}
          <div className="flex items-center gap-2 flex-wrap">
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
              className="clean-action-btn-soft !bg-[#f5a623]/12 !border-[#f5a623]/35 !text-[#f5a623] hover:!bg-[#f5a623]/22 hover:!border-[#f5a623]"
              onClick={onOpenAssets}
              title="Assets · Profile, Wallet Balance, Send, Receive & Swap"
            >
              <Wallet size={14} className="text-[#f5a623]" />
              <span>Assets</span>
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
            </div>

            {/* TOP BUTTONS: MINERS BUTTON ALONG WITH CLAIMED LEDGER POINT BUTTON */}
            <div className="pob-live-action flex flex-col items-end">
              {/* Progress & Countdown Timer above Miners & Ledger */}
              <div className="flex items-center gap-2 mb-1.5 justify-end text-[11px] font-mono select-none">
                <span className="flex items-center gap-1">
                  <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Progress</span>
                  <span className="text-[#00f59b] font-bold tabular-nums">{tankFillPercent.toFixed(1)}%</span>
                </span>
                <span className="text-slate-600">·</span>
                <span className="flex items-center gap-1">
                  <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Timer</span>
                  <span className="text-white font-bold tabular-nums">{countdownTimer}</span>
                </span>
              </div>

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
                ) : is20PercentReached ? null : (
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// CLEAN PREMIUM ASSETS PAGE (LOW TEXT, CLEAN ARCHITECTURE, EXACT FEATURES)
// ---------------------------------------------------------------------------
function AssetsPage({ onBack }: { onBack: () => void }) {
  const client = useQueryClient();
  const { user } = useAuth();
  const accountQuery = useGetMyAccount({ query: { queryKey: getGetMyAccountQueryKey() } });
  const account = accountQuery.data;

  const [activeTab, setActiveTab] = useState<'send' | 'receive' | 'swap'>('send');
  const [activities, setActivities] = useState<any[]>([]);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Send state
  const [sendAsset, setSendAsset] = useState<'bits' | 'bitnoir'>('bits');
  const [sendRecipient, setSendRecipient] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Swap state
  const [swapDirection, setSwapDirection] = useState<'bits-to-noir' | 'noir-to-bits'>('bits-to-noir');
  const [swapAmount, setSwapAmount] = useState('');
  const [isSwapping, setIsSwapping] = useState(false);

  const refreshActivity = () => {
    fetch('/api/accounts/me/activity')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setActivities(data.slice(0, 12));
      })
      .catch(() => {});
  };

  useEffect(() => {
    refreshActivity();
  }, []);

  const displayAddress = user?.solanaAddress || '0x71C8360437E55928d11B3e264259837a7F9D7065';

  // Core assets: Bits and Bitnoir ($NOIR) only
  const bitsPurchased = account?.balances?.purchased ?? 5100;
  const noirClaimed = (account?.balances as any)?.claimed ?? 7.2727;

  const totalUsd = bitsPurchased * 0.10 + noirClaimed * 1.10;

  const handleSend = async () => {
    const amt = Number(sendAmount);
    if (!sendRecipient.trim() || isNaN(amt) || amt <= 0) {
      toast({ title: 'Invalid transfer', description: 'Enter recipient and valid amount.', variant: 'destructive' });
      return;
    }
    const maxAvailable = sendAsset === 'bits' ? bitsPurchased : noirClaimed;
    if (amt > maxAvailable) {
      toast({ title: 'Insufficient balance', description: 'Amount exceeds available balance.', variant: 'destructive' });
      return;
    }

    setIsSending(true);
    try {
      const res = await fetch('/api/wallet/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset: sendAsset, amount: amt, recipient: sendRecipient.trim() }),
      });
      if (!res.ok) throw new Error();
      toast({ title: 'Sent', description: `Transferred ${amt} ${sendAsset.toUpperCase()} to ${sendRecipient.trim()}` });
      setSendAmount('');
      setSendRecipient('');
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      refreshActivity();
    } catch {
      toast({ title: 'Failed', description: 'Could not complete transfer.', variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  };

  const handleSwap = async () => {
    const amt = Number(swapAmount);
    if (isNaN(amt) || amt <= 0) {
      toast({ title: 'Invalid amount', description: 'Enter a valid amount.', variant: 'destructive' });
      return;
    }

    const fromAsset = swapDirection === 'bits-to-noir' ? 'bits' : 'bitnoir';
    const toAsset = swapDirection === 'bits-to-noir' ? 'bitnoir' : 'bits';
    const max = fromAsset === 'bits' ? bitsPurchased : noirClaimed;
    if (amt > max) {
      toast({ title: 'Insufficient balance', description: 'Amount exceeds available balance.', variant: 'destructive' });
      return;
    }

    setIsSwapping(true);
    try {
      const res = await fetch('/api/wallet/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromAsset, toAsset, amount: amt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error();
      toast({ title: 'Swapped', description: `Swapped ${amt} ${fromAsset.toUpperCase()} for ${Number(data.toAmount || 0).toFixed(4)} ${toAsset.toUpperCase()}` });
      setSwapAmount('');
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      refreshActivity();
    } catch {
      toast({ title: 'Failed', description: 'Could not execute swap.', variant: 'destructive' });
    } finally {
      setIsSwapping(false);
    }
  };

  const swapOutput = () => {
    const amt = Number(swapAmount) || 0;
    if (amt <= 0) return '0.0000';
    return swapDirection === 'bits-to-noir' ? (amt / 11).toFixed(4) : (amt * 11).toFixed(2);
  };

  return (
    <div className="min-h-screen bg-[#07080b] text-[#eff3f8] flex flex-col font-sans">
      {/* HEADER */}
      <header className="border-b border-white/[0.08] bg-[#0c121d]/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Brand size="md" />
          <div className="flex items-center gap-3">
            <TopWalletConnect />
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        {/* TOP NAVIGATION & HEADING */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white m-0">Assets</h1>
            <span className="w-2 h-2 rounded-full bg-[#f5a623]" />
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-mono text-slate-300 hover:text-white transition-all cursor-pointer"
              title="Transaction History"
              aria-label="Transaction History"
            >
              <History size={14} className="text-[#00f59b]" />
              <span className="text-xs font-sans">History</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-[11px] font-medium text-slate-300 hover:text-white transition-all cursor-pointer"
          >
            <ChevronLeft size={13} />
            <span>Back to Mining</span>
          </button>
        </div>

        {/* 1. TOTAL BALANCE */}
        <div className="pob-cockpit mb-6 p-5 sm:p-6 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold block mb-1">
              Total Balance
            </span>
            <div className="text-3xl sm:text-4xl font-black font-mono text-white tabular-nums tracking-tight">
              ${totalUsd.toFixed(2)} <span className="text-xs text-slate-400 font-normal">USD</span>
            </div>
          </div>
        </div>

        {/* 2. EXACT TWO CORE ASSETS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {/* BITS */}
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/8 flex items-center justify-between">
            <div>
              <div className="text-xs font-mono uppercase text-slate-400 font-bold mb-1">Bits</div>
              <div className="text-xl sm:text-2xl font-black font-mono text-white tabular-nums">
                {bitsPurchased.toLocaleString()}
              </div>
            </div>
            <span className="text-xs font-mono text-slate-400 font-bold">
              ${(bitsPurchased * 0.1).toFixed(2)}
            </span>
          </div>

          {/* BITNOIR */}
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/8 flex items-center justify-between">
            <div>
              <div className="text-xs font-mono uppercase text-slate-400 font-bold mb-1">Bitnoir</div>
              <div className="text-xl sm:text-2xl font-black font-mono text-white tabular-nums">
                {noirClaimed.toFixed(4)}
              </div>
            </div>
            <span className="text-xs font-mono text-slate-400 font-bold">
              ${(noirClaimed * 1.10).toFixed(2)}
            </span>
          </div>
        </div>

        {/* 3. CLEAN ACTION HUB (SEND · RECEIVE · SWAP) */}
        <div className="pob-cockpit mb-6 p-5 sm:p-6">
          {/* Clean Segmented Tabs */}
          <div className="flex items-center gap-2 mb-5">
            <button
              type="button"
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'send'
                  ? 'bg-[#00f59b]/20 text-[#00f59b] border border-[#00f59b]/40 shadow-sm'
                  : 'bg-white/[0.03] text-slate-400 hover:text-white border border-white/5'
              }`}
              onClick={() => setActiveTab('send')}
            >
              <ArrowUpRight size={14} />
              <span>Send</span>
            </button>
            <button
              type="button"
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'receive'
                  ? 'bg-[#00f59b]/20 text-[#00f59b] border border-[#00f59b]/40 shadow-sm'
                  : 'bg-white/[0.03] text-slate-400 hover:text-white border border-white/5'
              }`}
              onClick={() => setActiveTab('receive')}
            >
              <ArrowDownLeft size={14} />
              <span>Receive</span>
            </button>
            <button
              type="button"
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'swap'
                  ? 'bg-[#00f59b]/20 text-[#00f59b] border border-[#00f59b]/40 shadow-sm'
                  : 'bg-white/[0.03] text-slate-400 hover:text-white border border-white/5'
              }`}
              onClick={() => setActiveTab('swap')}
            >
              <Repeat size={14} />
              <span>Swap</span>
            </button>
          </div>

          {/* TAB: SEND */}
          {activeTab === 'send' && (
            <div className="flex flex-col gap-4 max-w-lg">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSendAsset('bits')}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-bold font-mono transition-all ${
                    sendAsset === 'bits'
                      ? 'bg-[#00f59b]/15 border-[#00f59b] text-[#00f59b]'
                      : 'bg-white/[0.03] border-white/10 text-slate-400'
                  }`}
                >
                  Bits ({bitsPurchased.toLocaleString()})
                </button>
                <button
                  type="button"
                  onClick={() => setSendAsset('bitnoir')}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-bold font-mono transition-all ${
                    sendAsset === 'bitnoir'
                      ? 'bg-[#ff8b2f]/15 border-[#ff8b2f] text-[#ff8b2f]'
                      : 'bg-white/[0.03] border-white/10 text-slate-400'
                  }`}
                >
                  Bitnoir ({noirClaimed.toFixed(2)})
                </button>
              </div>

              <div>
                <input
                  type="text"
                  placeholder="Recipient @username or address"
                  value={sendRecipient}
                  onChange={(e) => setSendRecipient(e.target.value)}
                  className="assets-input-field"
                />
              </div>

              <div className="relative">
                <input
                  type="number"
                  placeholder="0.00"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                  className="assets-input-field font-mono font-bold pr-16"
                />
                <button
                  type="button"
                  onClick={() => setSendAmount(String(sendAsset === 'bits' ? bitsPurchased : noirClaimed))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded bg-white/10 text-[10px] font-mono font-bold text-white hover:bg-white/20"
                >
                  MAX
                </button>
              </div>

              <button
                type="button"
                onClick={handleSend}
                disabled={isSending}
                className="clean-stake-confirm-btn !w-full !min-h-[42px] !text-xs !bg-[#00f59b] !text-[#03150c] !font-bold"
              >
                {isSending ? (
                  <span className="flex items-center gap-2 justify-center">
                    <RefreshCw size={14} className="animate-spin" /> Sending…
                  </span>
                ) : (
                  <span className="flex items-center gap-2 justify-center">
                    <Send size={14} /> Send {sendAsset.toUpperCase()}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* TAB: RECEIVE */}
          {activeTab === 'receive' && (
            <div className="flex flex-col sm:flex-row items-center gap-6 max-w-lg">
              <div className="p-3 bg-white rounded-xl shadow-md flex items-center justify-center">
                <svg width="130" height="130" viewBox="0 0 130 130" fill="none">
                  <rect width="130" height="130" fill="white" />
                  <rect x="10" y="10" width="35" height="35" fill="#07080b" />
                  <rect x="16" y="16" width="23" height="23" fill="white" />
                  <rect x="22" y="22" width="11" height="11" fill="#07080b" />
                  <rect x="85" y="10" width="35" height="35" fill="#07080b" />
                  <rect x="91" y="16" width="23" height="23" fill="white" />
                  <rect x="97" y="22" width="11" height="11" fill="#07080b" />
                  <rect x="10" y="85" width="35" height="35" fill="#07080b" />
                  <rect x="16" y="91" width="23" height="23" fill="white" />
                  <rect x="22" y="97" width="11" height="11" fill="#07080b" />
                  <circle cx="65" cy="65" r="14" fill="#07080b" />
                  <circle cx="65" cy="65" r="10" fill="#00f59b" />
                </svg>
              </div>

              <div className="flex-1 flex flex-col gap-3 w-full">
                <span className="text-xs font-mono text-slate-400 uppercase tracking-wider font-bold">
                  Receiving Address
                </span>
                <div className="p-3 rounded-xl bg-black/40 border border-white/10 font-mono text-xs text-white break-all select-all">
                  {displayAddress}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(displayAddress);
                    setCopiedAddr(true);
                    setTimeout(() => setCopiedAddr(false), 2000);
                    toast({ title: 'Copied', description: 'Address copied to clipboard.' });
                  }}
                  className="clean-action-btn-soft !justify-center !w-full"
                >
                  {copiedAddr ? <Check size={14} className="text-[#00f59b]" /> : <Copy size={14} />}
                  <span>{copiedAddr ? 'Copied' : 'Copy Address'}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB: SWAP */}
          {activeTab === 'swap' && (
            <div className="flex flex-col gap-3 max-w-lg">
              <div className="p-3.5 rounded-xl bg-black/40 border border-white/8 flex items-center justify-between gap-3">
                <input
                  type="number"
                  placeholder="0.00"
                  value={swapAmount}
                  onChange={(e) => setSwapAmount(e.target.value)}
                  className="bg-transparent border-0 font-mono font-black text-xl text-white outline-none flex-1"
                />
                <button
                  type="button"
                  onClick={() => {
                    const max = swapDirection === 'bits-to-noir' ? bitsPurchased : noirClaimed;
                    setSwapAmount(String(max));
                  }}
                  className="px-2 py-0.5 rounded bg-white/10 text-[10px] font-mono text-slate-300 font-bold"
                >
                  MAX
                </button>
                <span className="text-xs font-mono font-bold text-white uppercase">
                  {swapDirection === 'bits-to-noir' ? 'BITS' : 'NOIR'}
                </span>
              </div>

              <div className="flex justify-center -my-1">
                <button
                  type="button"
                  onClick={() => setSwapDirection((d) => (d === 'bits-to-noir' ? 'noir-to-bits' : 'bits-to-noir'))}
                  className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:border-[#00f59b] transition-all"
                >
                  <Repeat size={13} />
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-black/40 border border-white/8 flex items-center justify-between gap-3">
                <div className="font-mono font-black text-xl text-[#00f59b]">
                  {swapOutput()}
                </div>
                <span className="text-xs font-mono font-bold text-white uppercase">
                  {swapDirection === 'bits-to-noir' ? 'NOIR' : 'BITS'}
                </span>
              </div>

              <button
                type="button"
                onClick={handleSwap}
                disabled={isSwapping}
                className="clean-stake-confirm-btn !w-full !min-h-[42px] !text-xs !bg-gradient-to-r !from-[#ff8b2f] !to-[#ff5252] !text-black !font-bold"
              >
                {isSwapping ? (
                  <span className="flex items-center gap-2 justify-center">
                    <RefreshCw size={14} className="animate-spin" /> Swapping…
                  </span>
                ) : (
                  <span className="flex items-center gap-2 justify-center">
                    <Repeat size={14} /> Swap (11:1 Rate)
                  </span>
                )}
              </button>
            </div>
          )}
        </div>

        {/* TRANSACTION HISTORY MODAL (OPENED FROM TOP ICON) */}
        {historyOpen && (
          <div className="modal-backdrop" onClick={() => setHistoryOpen(false)}>
            <div
              className="modal-dialog"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: 460,
                padding: 24,
                background: 'linear-gradient(180deg, #0c121d 0%, #070b12 100%)',
                borderColor: 'rgba(255, 255, 255, 0.12)',
                boxShadow: '0 24px 70px rgba(0, 0, 0, 0.85), 0 0 35px rgba(0, 245, 155, 0.12)',
                borderRadius: 20,
              }}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#00f59b]/10 border border-[#00f59b]/25 flex items-center justify-center text-[#00f59b]">
                    <History size={16} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white m-0">Transaction History</h2>
                    <p className="text-[11px] font-mono text-slate-400 m-0">Settled node operations</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1">
                {activities.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 text-xs font-mono">
                    No transactions recorded yet.
                  </div>
                ) : (
                  activities.map((act) => {
                    const isSend = act.kind === 'send';
                    const isReceive = act.kind === 'receive' || act.kind === 'deposit' || act.kind === 'reward';
                    return (
                      <div
                        key={act.id}
                        className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between text-xs font-mono"
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                              isSend
                                ? 'bg-red-500/15 text-red-400'
                                : isReceive
                                ? 'bg-[#00f59b]/15 text-[#00f59b]'
                                : 'bg-[#38bdf8]/15 text-[#38bdf8]'
                            }`}
                          >
                            {isSend ? (
                              <ArrowUpRight size={13} />
                            ) : isReceive ? (
                              <ArrowDownLeft size={13} />
                            ) : (
                              <Repeat size={13} />
                            )}
                          </div>
                          <div>
                            <div className="text-white font-medium">{act.title}</div>
                            <div className="text-[10px] text-slate-500">
                              {new Date(act.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>

                        <span className="text-[10px] font-mono uppercase tracking-wider text-[#00f59b] bg-[#00f59b]/10 px-2 py-0.5 rounded border border-[#00f59b]/25">
                          {act.status || 'Settled'}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// APPLICATION ROUTER (EXACT CLEAN ROUTES: MINING & ASSETS)
// ---------------------------------------------------------------------------
function App() {
  const [currentView, setCurrentView] = useState<'mining' | 'assets'>('mining');

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <FeedbackMonitor />
        <WouterRouter base={basePath}>
          <Switch>
            <Route path="/assets">
              {() => <AssetsPage onBack={() => setCurrentView('mining')} />}
            </Route>
            <Route path="/mining">
              {() => <MiningPage onOpenAssets={() => setCurrentView('assets')} />}
            </Route>
            <Route path="/">
              {() =>
                currentView === 'assets' ? (
                  <AssetsPage onBack={() => setCurrentView('mining')} />
                ) : (
                  <MiningPage onOpenAssets={() => setCurrentView('assets')} />
                )
              }
            </Route>
            <Route component={() =>
              currentView === 'assets' ? (
                <AssetsPage onBack={() => setCurrentView('mining')} />
              ) : (
                <MiningPage onOpenAssets={() => setCurrentView('assets')} />
              )
            } />
          </Switch>
        </WouterRouter>
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
