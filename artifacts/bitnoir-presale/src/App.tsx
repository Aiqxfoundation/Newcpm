import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight,
  Copy, ExternalLink, Flame, Hammer, History, Lock, QrCode, RefreshCw,
  ScrollText, Send, ShieldCheck, Sparkles, User, Wallet, X, Zap
} from 'lucide-react';
import {
  getGetMyAccountQueryKey, getGetMyActivityQueryKey, useGetMyAccount,
} from '@workspace/api-client-react';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/hooks/use-toast';
import {
  generateDemoSolanaAddress,
  getLocalWalletActivities,
  getPhantomSolanaProvider,
  getWalletMiningState,
  isValidSolanaAddress,
  PROTOCOL_TREASURY_SOLANA,
  registerVerifiedUsername,
  safeStorageGet,
  safeStorageRemove,
  safeStorageSet,
  saveLocalWalletActivity,
  saveWalletMiningState,
  sendSolanaTransactionOnchain,
  signOnchainWalletAction,
  VERIFICATION_FEE_SOL,
} from './lib/solana';
import '@/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const msg = error instanceof Error ? error.message : '';
        if (/400|401|403|404|invalid|unauthorized/i.test(msg)) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});
const basePath = import.meta.env.BASE_PATH ? import.meta.env.BASE_PATH.replace(/\/$/, '') : '';

function readableError(error: unknown, fallback: string): string {
  if (!error) return fallback;

  const rawMsg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof error === 'object'
          ? String((error as any).error || (error as any).message || '')
          : '';

  const trimmed = rawMsg.trim();
  if (!trimmed) return fallback;

  const anyErr = typeof error === 'object' ? (error as { name?: string; code?: number | string }) : null;
  if (anyErr?.name === 'AbortError' || /timed?\s*out|aborted/i.test(trimmed)) {
    return 'Request timed out. Please check your connection and try again.';
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(trimmed)) {
    return 'Network connection interrupted. Please check your internet connection and retry.';
  }
  if (anyErr?.code === 4001 || /user rejected|rejected the request|cancelled in phantom/i.test(trimmed)) {
    return 'Wallet request was cancelled.';
  }
  if (anyErr?.code === -32002 || /already pending/i.test(trimmed)) {
    return 'A wallet prompt is already open in Phantom. Please respond to it first.';
  }
  if (anyErr?.code === 4100) {
    return 'Wallet authorization required. Please unlock Phantom and try again.';
  }
  // Never expose raw HTML error pages or stack traces in user-facing alerts
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.length > 220) {
    return fallback;
  }
  return trimmed;
}

async function apiFetchJson<T = any>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: options.signal ?? controller.signal,
    });
    const text = await res.text();
    let data: any = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      const statusFallback =
        res.status === 401
          ? 'Please connect your Solana wallet first.'
          : res.status === 403
            ? 'Verification required for this action.'
            : res.status === 404
              ? 'Requested service was not found.'
              : res.status >= 500
                ? 'Server temporarily unavailable. Please try again.'
                : 'Request could not be completed.';
      throw new Error((data && (data.error || data.message)) || statusFallback);
    }
    return (data ?? {}) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to execCommand below when iframe blocks navigator.clipboard
  }
  try {
    if (typeof document !== 'undefined') {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }
  } catch {
    return false;
  }
  return false;
}

function InlineErrorBanner({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry?: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-between gap-2.5 text-xs text-red-300"
    >
      <div className="flex items-start gap-2 min-w-0">
        <AlertTriangle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
        <span className="leading-relaxed break-words">{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/35 text-red-200 text-[11px] font-mono font-bold flex-shrink-0 cursor-pointer transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}

function FeedbackMonitor() {
  const client = useQueryClient();
  const recentErrorsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const showError = (error: unknown, fallback: string) => {
      const description = readableError(error, fallback);
      // Suppress harmless background aborts or dev HMR websocket noise
      if (/websocket|hmr|resizeobserver/i.test(description)) return;
      const now = Date.now();
      const lastShown = recentErrorsRef.current.get(description) ?? 0;
      if (now - lastShown < 3500) return;
      recentErrorsRef.current.set(description, now);
      toast({ title: 'Action failed', description, variant: 'destructive' });
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
    const onOffline = () => {
      toast({
        title: 'Offline',
        description: 'Internet connection lost. Reconnect to sync mining and wallet actions.',
        variant: 'destructive',
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('offline', onOffline);
    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('offline', onOffline);
    };
  }, [client]);

  return <Toaster />;
}

// ---------------------------------------------------------------------------
// BRAND & ICONS
// ---------------------------------------------------------------------------
const BITNOIR_LOGO_96 = '/assets/aistudio/bitnoir-logo-96.png';
const BITNOIR_LOGO_144 = '/assets/aistudio/bitnoir-logo-144.png';
const BITNOIR_LOGO_256 = '/assets/aistudio/bitnoir-logo-256.png';
const BITNOIR_LOGO_FULL = '/assets/aistudio/file_00000000c9508208b439e1d861b81370_d5533dc6.png';

function BitnoirMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  const defaultSrc = size <= 32 ? BITNOIR_LOGO_96 : BITNOIR_LOGO_144;
  return (
    <img
      src={defaultSrc}
      srcSet={`${BITNOIR_LOGO_96} 96w, ${BITNOIR_LOGO_144} 144w, ${BITNOIR_LOGO_256} 256w, ${BITNOIR_LOGO_FULL} 1254w`}
      sizes={`${size}px`}
      alt="Bitnoir"
      width={size}
      height={size}
      draggable={false}
      style={{ width: size, height: size }}
      className={`inline-block flex-shrink-0 rounded-full object-cover select-none pointer-events-none ${className}`}
    />
  );
}

function Brand({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const textSize = size === 'sm' ? 18 : size === 'lg' ? 26 : 22;
  const logoPx = size === 'sm' ? 26 : size === 'lg' ? 38 : 32;

  return (
    <div className="flex items-center gap-2.5 select-none" style={{ fontSize: textSize }}>
      <BitnoirMark size={logoPx} />
      <div className="flex items-center gap-2">
        <span className="font-sans font-extrabold tracking-tight text-white">
          Bit<span className="text-[#f7931a]">noir</span>
        </span>
      </div>
    </div>
  );
}

const BITS_LOGO_96 = '/assets/aistudio/bits-logo-96.png';
const BITS_LOGO_144 = '/assets/aistudio/bits-logo-144.png';
const BITS_LOGO_256 = '/assets/aistudio/bits-logo-256.png';
const BITS_LOGO_FULL = '/assets/aistudio/file_0000000071f8820880f6865e316e2a08_5b35eeb9.png';

function BitsMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  const defaultSrc = size <= 32 ? BITS_LOGO_96 : BITS_LOGO_144;
  return (
    <img
      src={defaultSrc}
      srcSet={`${BITS_LOGO_96} 96w, ${BITS_LOGO_144} 144w, ${BITS_LOGO_256} 256w, ${BITS_LOGO_FULL} 1254w`}
      sizes={`${size}px`}
      alt="Bits"
      width={size}
      height={size}
      draggable={false}
      style={{ width: size, height: size }}
      className={`inline-block flex-shrink-0 rounded-full object-cover select-none pointer-events-none ${className}`}
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

  const syncBackendSession = async (payload: {
    solanaAddress?: string;
    isVerified?: boolean;
    verifiedTx?: string;
    username?: string;
    reset?: boolean;
  }) => {
    try {
      await apiFetchJson('/api/accounts/me/sync-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn('Session sync warning:', err);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('bitnoir-session-synced'));
    }
  };

  useEffect(() => {
    // 1. Check existing saved Solana public address from localStorage
    const saved = safeStorageGet('bitnoir-solana-address');
    const savedUser = safeStorageGet('bitnoir-username');

    // Clear legacy mock satoshinode / treasury account
    if (saved === PROTOCOL_TREASURY_SOLANA || savedUser === 'satoshinode') {
      safeStorageRemove('bitnoir-solana-address');
      safeStorageRemove('bitnoir-username');
      setUser(null);
      void syncBackendSession({ reset: true });
      setReady(true);
      return;
    }

    if (saved && isValidSolanaAddress(saved)) {
      const isVer = safeStorageGet(`bitnoir-verified-${saved}`) === 'true';
      const verTx = safeStorageGet(`bitnoir-verified-tx-${saved}`) || undefined;
      const uname = isVer ? (safeStorageGet(`bitnoir-username-${saved}`) || savedUser || '') : '';
      if (isVer && uname) {
        registerVerifiedUsername(uname, saved);
      }
      setUser({
        id: saved,
        solanaAddress: saved,
        username: uname,
        name: uname ? `@${uname}` : 'Wallet',
        email: uname ? `${uname}@bitnoir.io` : '',
        isAdmin: false,
        isVerified: isVer,
        verifiedTx: verTx,
      });
      void syncBackendSession({ solanaAddress: saved, isVerified: isVer, verifiedTx: verTx, username: uname });
      setReady(true);
      return;
    }

    // 2. Try silent auto-connect if Phantom is available
    const provider = getPhantomSolanaProvider();
    if (provider && provider.connect) {
      provider
        .connect({ onlyIfTrusted: true })
        .then((resp: any) => {
          const address = resp?.publicKey?.toString?.() || '';
          if (!isValidSolanaAddress(address)) {
            setUser(null);
            void syncBackendSession({ reset: true });
            return;
          }
          safeStorageSet('bitnoir-solana-address', address);
          const isVer = safeStorageGet(`bitnoir-verified-${address}`) === 'true';
          const verTx = safeStorageGet(`bitnoir-verified-tx-${address}`) || undefined;
          const uname = isVer ? (safeStorageGet(`bitnoir-username-${address}`) || '') : '';
          if (isVer && uname) {
            registerVerifiedUsername(uname, address);
          }
          setUser({
            id: address,
            solanaAddress: address,
            username: uname,
            name: uname ? `@${uname}` : 'Wallet',
            email: '',
            isAdmin: false,
            isVerified: isVer,
            verifiedTx: verTx,
          });
          void syncBackendSession({ solanaAddress: address, isVerified: isVer, verifiedTx: verTx, username: uname });
        })
        .catch(() => {
          setUser(null);
          void syncBackendSession({ reset: true });
        })
        .finally(() => {
          setReady(true);
        });
    } else {
      setUser(null);
      void syncBackendSession({ reset: true });
      setReady(true);
    }
  }, []);

  const connectWallet = async (customAddress?: string): Promise<string> => {
    let address: string = customAddress?.trim() || '';
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

    if (!isValidSolanaAddress(address)) {
      throw new Error('Please provide a valid Solana public address (32-44 base58 characters).');
    }

    safeStorageSet('bitnoir-solana-address', address);
    const isVer = safeStorageGet(`bitnoir-verified-${address}`) === 'true';
    const verTx = safeStorageGet(`bitnoir-verified-tx-${address}`) || undefined;
    const uname = isVer ? (safeStorageGet(`bitnoir-username-${address}`) || '') : '';
    if (isVer && uname) {
      safeStorageSet('bitnoir-username', uname);
      registerVerifiedUsername(uname, address);
    } else {
      safeStorageRemove('bitnoir-username');
    }
    const authUser: AuthUser = {
      id: address,
      solanaAddress: address,
      username: uname,
      name: uname ? `@${uname}` : 'Wallet',
      email: '',
      isAdmin: false,
      isVerified: isVer,
      verifiedTx: verTx,
    };
    setUser(authUser);
    await syncBackendSession({ solanaAddress: address, isVerified: isVer, verifiedTx: verTx, username: uname });
    return address;
  };

  const verifyWalletOnchain = async (): Promise<string> => {
    if (!user?.solanaAddress) {
      throw new Error('Please connect your Solana wallet first.');
    }
    if (user.isVerified && user.verifiedTx) {
      return user.verifiedTx;
    }

    const result = await sendSolanaTransactionOnchain({
      fromAddress: user.solanaAddress,
      toAddress: PROTOCOL_TREASURY_SOLANA,
      amountSol: VERIFICATION_FEE_SOL,
      memo: 'Bitnoir One-Time Node Verification (0.02 SOL)',
    });

    const sig = result.signature;
    await apiFetchJson('/api/accounts/me/verify-wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature: sig }),
    });

    safeStorageSet(`bitnoir-verified-${user.solanaAddress}`, 'true');
    safeStorageSet(`bitnoir-verified-tx-${user.solanaAddress}`, sig);

    saveLocalWalletActivity(user.solanaAddress, {
      id: Date.now(),
      kind: 'verify',
      title: '0.02 SOL Wallet Verification Confirmed',
      detail: `Sent ${VERIFICATION_FEE_SOL} SOL to Bitnoir Treasury onchain. Eligible to set @username.`,
      txHash: sig,
      createdAt: new Date().toISOString(),
    });

    setUser((prev) => (prev ? { ...prev, isVerified: true, verifiedTx: sig } : null));
    return sig;
  };

  const setUsernameHandle = async (handle: string): Promise<void> => {
    if (!user?.solanaAddress) throw new Error('Wallet not connected.');
    if (!user.isVerified) {
      throw new Error('Complete the 0.02 SOL onchain wallet verification first.');
    }
    const clean = handle.trim().replace(/^@/, '').toLowerCase();
    if (!clean || clean.length < 3 || clean.length > 20 || !/^[a-z0-9_]+$/.test(clean)) {
      throw new Error('Username must be 3-20 lowercase letters, numbers, or underscore.');
    }

    await apiFetchJson('/api/accounts/me/set-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: clean }),
    });

    safeStorageSet(`bitnoir-username-${user.solanaAddress}`, clean);
    safeStorageSet('bitnoir-username', clean);
    registerVerifiedUsername(clean, user.solanaAddress);

    saveLocalWalletActivity(user.solanaAddress, {
      id: Date.now(),
      kind: 'username',
      title: `Username @${clean} Activated`,
      detail: `Claimed @${clean} ID, generated referral link, and started Bits mining.`,
      txHash: user.verifiedTx,
      createdAt: new Date().toISOString(),
    });

    setUser((prev) => (prev ? { ...prev, username: clean, name: `@${clean}` } : null));
  };

  const disconnectWallet = async () => {
    try {
      const provider = getPhantomSolanaProvider();
      if (provider && provider.disconnect) {
        await provider.disconnect();
      }
    } catch {
      // Ignore provider disconnect errors
    }
    safeStorageRemove('bitnoir-solana-address');
    safeStorageRemove('bitnoir-username');
    setUser(null);
    await syncBackendSession({ reset: true });
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
// CONNECT WALLET MODAL (PHANTOM + PREVIEW ADDRESS FALLBACK)
// ---------------------------------------------------------------------------
function ConnectWalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connectWallet } = useAuth();
  const [customAddr, setCustomAddr] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFormError(null);
    }
  }, [open]);

  if (!open) return null;

  const hasPhantom = Boolean(getPhantomSolanaProvider());

  const handlePhantom = async () => {
    setFormError(null);
    setConnecting(true);
    try {
      await connectWallet();
      toast({
        title: 'Solana Wallet Connected',
        description: 'Wallet connected. Click Start Mining (0.01/h · 3h) or verify with 0.02 SOL for 0.1/h · 24h.',
        variant: 'success',
        icon: <Wallet size={17} />,
      });
      onClose();
    } catch (err: any) {
      if (err?.message === 'PHANTOM_NOT_INSTALLED') {
        const msg = 'Install Phantom or connect using a Solana address below.';
        setFormError(msg);
        toast({
          title: 'Phantom Extension Not Detected',
          description: msg,
          variant: 'destructive',
        });
      } else {
        const msg = readableError(err, 'Could not connect Phantom.');
        setFormError(msg);
        toast({
          title: 'Connection Failed',
          description: msg,
          variant: 'destructive',
        });
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleAddressConnect = async (addrToUse?: string) => {
    setFormError(null);
    const target = (addrToUse || customAddr).trim();
    if (!isValidSolanaAddress(target)) {
      const msg = 'Enter a valid base58 Solana public key (32-44 chars).';
      setFormError(msg);
      toast({
        title: 'Invalid Solana Address',
        description: msg,
        variant: 'destructive',
      });
      return;
    }
    setConnecting(true);
    try {
      await connectWallet(target);
      toast({
        title: 'Solana Wallet Connected',
        description: 'Wallet connected. Click Start Mining (0.01/h · 3h) or activate in wallet tab.',
        variant: 'success',
        icon: <Wallet size={17} />,
      });
      setCustomAddr('');
      onClose();
    } catch (err) {
      const msg = readableError(err, 'Could not connect wallet.');
      setFormError(msg);
      toast({
        title: 'Connection Failed',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 440,
          padding: 24,
          background: 'linear-gradient(180deg, #15171e 0%, #0d0e13 100%)',
          borderColor: 'rgba(247, 147, 26, 0.28)',
          borderRadius: 20,
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#f7931a]/12 border border-[#f7931a]/30 flex items-center justify-center text-[#f7931a]">
              <PhantomLogo size={18} />
            </div>
            <div>
              <h3 className="m-0 text-base font-bold text-white">Connect Solana Wallet</h3>
              <p className="m-0 text-[11px] font-mono text-zinc-400">Step 1 of 3 · Wallet Identity</p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="flex flex-col gap-3">
          <InlineErrorBanner message={formError} />

          {hasPhantom ? (
            <button
              type="button"
              disabled={connecting}
              onClick={handlePhantom}
              className="clean-stake-confirm-btn !w-full !min-h-[44px] !text-xs !font-bold"
            >
              <PhantomLogo size={15} />
              <span>{connecting ? 'Connecting Phantom…' : 'Connect Phantom Wallet'}</span>
            </button>
          ) : (
            <a
              href="https://phantom.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="clean-action-btn-soft !justify-between !px-4 !py-2.5 !w-full"
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-white">
                <PhantomLogo size={15} className="text-[#f7931a]" />
                Phantom Extension Not Detected — Get Phantom
              </span>
              <ExternalLink size={13} className="text-zinc-400" />
            </a>
          )}

          <div className="flex items-center gap-2 my-1">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[10px] font-mono uppercase text-zinc-500">Or Solana Address</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <input
            type="text"
            placeholder="Paste Solana wallet address (base58)"
            value={customAddr}
            onChange={(e) => {
              setCustomAddr(e.target.value);
              if (formError) setFormError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customAddr.trim() && !connecting) {
                void handleAddressConnect();
              }
            }}
            className="assets-input-field font-mono text-xs"
          />

          <div className="flex gap-2">
            <button
              type="button"
              disabled={connecting || !customAddr.trim()}
              onClick={() => void handleAddressConnect()}
              className="clean-stake-confirm-btn !flex-1 !min-h-[40px] !text-xs !bg-none !bg-white/10 hover:!bg-white/15 !border-white/15 !text-white !shadow-none !font-bold"
            >
              Connect Address
            </button>
            <button
              type="button"
              disabled={connecting}
              onClick={() => void handleAddressConnect(generateDemoSolanaAddress())}
              className="clean-action-btn-soft !min-h-[40px] !text-xs !border-[#f7931a]/35 !text-[#fbbf24]"
            >
              <Sparkles size={13} />
              <span>Quick Test Wallet</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ONE-TIME 0.02 SOL ONCHAIN VERIFICATION & USERNAME SETUP MODAL
// ---------------------------------------------------------------------------
function VerifyAndUsernameModal({
  open,
  onClose,
  onOpenConnect,
}: {
  open: boolean;
  onClose: () => void;
  onOpenConnect: () => void;
}) {
  const client = useQueryClient();
  const { user, verifyWalletOnchain, setUsernameHandle } = useAuth();
  const [verifying, setVerifying] = useState(false);
  const [savingHandle, setSavingHandle] = useState(false);
  const [handleInput, setHandleInput] = useState('');
  const [copiedTreasury, setCopiedTreasury] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setModalError(null);
    }
  }, [open]);

  if (!open) return null;

  const isConnected = Boolean(user?.solanaAddress);
  const isVerified = Boolean(user?.isVerified);
  const hasUsername = Boolean(user?.username);
  const isComplete = isConnected && isVerified && hasUsername;

  const cleanPreview = handleInput.trim().replace(/^@/, '').toLowerCase();
  const isHandleValid = cleanPreview.length >= 3 && cleanPreview.length <= 20 && /^[a-z0-9_]+$/.test(cleanPreview);

  const handleVerifyTx = async () => {
    setModalError(null);
    setVerifying(true);
    try {
      const sig = await verifyWalletOnchain();
      toast({
        title: 'Wallet Verified Onchain',
        description: `0.02 SOL confirmed (${sig.slice(0, 8)}...${sig.slice(-6)}). Set your @username to unlock 24h · 0.1/h.`,
        variant: 'success',
        icon: <ShieldCheck size={17} />,
      });
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
    } catch (err) {
      const msg = readableError(err, 'Could not complete 0.02 SOL verification transaction.');
      setModalError(msg);
      toast({
        title: 'Verification Failed',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleClaimUsername = async () => {
    setModalError(null);
    if (!isHandleValid) {
      const msg = 'Use 3-20 lowercase letters, numbers, or underscores.';
      setModalError(msg);
      toast({
        title: 'Invalid Username',
        description: msg,
        variant: 'destructive',
      });
      return;
    }
    setSavingHandle(true);
    try {
      await setUsernameHandle(cleanPreview);
      toast({
        title: `@${cleanPreview} Verified`,
        description: '24-hour mining (0.1000 /h) and your referral link are now active.',
        variant: 'success',
        icon: <ShieldCheck size={17} />,
      });
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
      setHandleInput('');
      onClose();
    } catch (err) {
      const msg = readableError(err, 'Verification required before claiming a username.');
      setModalError(msg);
      toast({
        title: 'Could Not Set Username',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setSavingHandle(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 480,
          padding: 24,
          background: 'linear-gradient(180deg, #15171e 0%, #0d0e13 100%)',
          borderColor: isComplete ? 'rgba(16, 185, 129, 0.3)' : 'rgba(247, 147, 26, 0.3)',
          boxShadow: '0 28px 80px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
          borderRadius: 20,
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                isComplete
                  ? 'bg-[#10b981]/12 border border-[#10b981]/30 text-[#34d399]'
                  : 'bg-[#f7931a]/12 border border-[#f7931a]/30 text-[#f7931a]'
              }`}
            >
              <ShieldCheck size={18} />
            </div>
            <div>
              <h2 className="m-0 text-base font-extrabold text-white leading-snug">
                {isComplete ? 'Verified Account' : 'Upgrade to Verified Node'}
              </h2>
              <p className="m-0 text-[11px] font-mono text-zinc-400">
                {isComplete
                  ? `@${user?.username} · 24h Node Active`
                  : '24-Hour Mining · 0.1/hr Base Rate · Unique ID & Referral Link'}
              </p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {!isComplete && (
          <>
            <p className="text-xs text-zinc-300 m-0 leading-relaxed mb-4">
              Base mining (<strong className="text-white">0.01/h · 3h</strong>) is already available. Verify once with <strong className="text-[#fbbf24]">0.02 SOL</strong> and set your <strong className="text-white">@username</strong> to unlock <strong className="text-[#34d399]">24-hour mining</strong>, <strong className="text-[#fbbf24]">0.1/hr base rate</strong>, and your unique referral link.
            </p>

            {/* 3-STEP PROGRESS PILLS */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4 text-[11px] font-mono">
              <div className={`px-2.5 py-2 rounded-lg border ${isConnected ? 'bg-[#10b981]/15 border-[#10b981]/40 text-[#34d399]' : 'bg-white/5 border-white/15 text-white'}`}>
                1. Connect Wallet {isConnected ? '✓' : ''}
              </div>
              <div className={`px-2.5 py-2 rounded-lg border ${isVerified ? 'bg-[#10b981]/15 border-[#10b981]/40 text-[#34d399]' : isConnected ? 'bg-[#f7931a]/15 border-[#f7931a]/45 text-[#fbbf24]' : 'bg-white/[0.02] border-white/10 text-zinc-500'}`}>
                2. Verify 0.02 SOL {isVerified ? '✓' : ''}
              </div>
              <div className={`px-2.5 py-2 rounded-lg border ${hasUsername ? 'bg-[#10b981]/15 border-[#10b981]/40 text-[#34d399]' : isVerified ? 'bg-[#f7931a]/15 border-[#f7931a]/45 text-[#fbbf24]' : 'bg-white/[0.02] border-white/10 text-zinc-500'}`}>
                3. Set @username → 24h {hasUsername ? '✓' : ''}
              </div>
            </div>
          </>
        )}

        {modalError && (
          <div className="mb-4">
            <InlineErrorBanner message={modalError} />
          </div>
        )}

        {!isConnected ? (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenConnect();
              }}
              className="clean-stake-confirm-btn !w-full !min-h-[44px] !text-xs !font-bold"
            >
              <Wallet size={15} />
              <span>Connect Solana Wallet</span>
            </button>
          </div>
        ) : !isVerified ? (
          <div className="flex flex-col gap-4">
            <div className="p-4 rounded-xl bg-[#0b0c10] border border-white/10 flex flex-col gap-2.5 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 font-sans">Verification Fee (One-Time)</span>
                <strong className="text-[#fbbf24] text-sm">{VERIFICATION_FEE_SOL} SOL</strong>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-400 font-sans">Treasury Wallet</span>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await copyToClipboard(PROTOCOL_TREASURY_SOLANA);
                    if (ok) {
                      setCopiedTreasury(true);
                      setTimeout(() => setCopiedTreasury(false), 1800);
                    } else {
                      toast({ title: 'Copy Failed', description: 'Could not access clipboard.', variant: 'destructive' });
                    }
                  }}
                  className="inline-flex items-center gap-1.5 text-zinc-200 hover:text-[#f7931a] cursor-pointer bg-transparent border-0 p-0"
                >
                  <span>{shortSolanaAddress(PROTOCOL_TREASURY_SOLANA)}</span>
                  {copiedTreasury ? <Check size={12} className="text-[#10b981]" /> : <Copy size={12} />}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 font-sans">Wallet Status</span>
                <span className="text-[#34d399]">Connected</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                <span className="text-zinc-400 font-sans">Unlocks</span>
                <span className="text-[#34d399] font-semibold">24h · 0.1/hr · @username</span>
              </div>
            </div>

            <button
              type="button"
              disabled={verifying}
              onClick={handleVerifyTx}
              className="clean-stake-confirm-btn !w-full !min-h-[44px] !text-xs !font-bold"
            >
              {verifying ? (
                <span className="flex items-center gap-2 justify-center">
                  <RefreshCw size={14} className="animate-spin" /> Confirming 0.02 SOL Onchain…
                </span>
              ) : (
                <span className="flex items-center gap-2 justify-center">
                  <ShieldCheck size={15} /> Verify Wallet (0.02 SOL)
                </span>
              )}
            </button>
          </div>
        ) : !hasUsername ? (
          <div className="flex flex-col gap-4">
            <div className="p-3 rounded-xl bg-[#10b981]/10 border border-[#10b981]/30 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-[#34d399] font-bold">
                <Check size={14} strokeWidth={3} />
                <span>0.02 SOL Verification Confirmed</span>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-bold block mb-1.5">
                Set Your Unique @username ID
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono font-bold text-[#f7931a]">@</span>
                <input
                  type="text"
                  placeholder="your_handle"
                  value={handleInput}
                  onChange={(e) => {
                    setHandleInput(e.target.value.replace(/^@/, '').toLowerCase());
                    if (modalError) setModalError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isHandleValid && !savingHandle) {
                      void handleClaimUsername();
                    }
                  }}
                  className="assets-input-field font-mono font-bold !pl-8"
                  maxLength={20}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                <span>3-20 chars · a-z, 0-9, underscore</span>
                {cleanPreview && (
                  <span className={isHandleValid ? 'text-[#34d399]' : 'text-red-400'}>
                    @{cleanPreview}
                  </span>
                )}
              </div>
            </div>

            {isHandleValid && (
              <div className="p-3 rounded-xl bg-[#0b0c10] border border-white/10 text-[11px] font-mono text-zinc-300">
                Referral Link:{' '}
                <span className="text-[#fbbf24]">
                  {typeof window !== 'undefined' ? window.location.origin : 'https://bitnoir.io'}/?ref={cleanPreview}
                </span>
              </div>
            )}

            <button
              type="button"
              disabled={savingHandle || !isHandleValid}
              onClick={handleClaimUsername}
              className="clean-stake-confirm-btn !w-full !min-h-[44px] !text-xs !font-bold"
            >
              {savingHandle ? (
                <span className="flex items-center gap-2 justify-center">
                  <RefreshCw size={14} className="animate-spin" /> Activating 24h Node…
                </span>
              ) : (
                <span className="flex items-center gap-2 justify-center">
                  <User size={15} /> Set @{cleanPreview || 'username'} → Activate 24h
                </span>
              )}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="p-4 rounded-xl bg-[#0b0c10] border border-white/10 flex flex-col gap-3 text-xs font-mono">
              <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.07]">
                <span className="text-zinc-400 font-sans">Status</span>
                <span className="inline-flex items-center gap-1.5 text-[#34d399] font-bold">
                  <Check size={13} strokeWidth={3} />
                  Verified
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 font-sans">Unique ID</span>
                <span className="text-white font-bold">@{user?.username}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 font-sans">Base Mining Rate</span>
                <span className="text-[#fbbf24] font-bold">0.1000 /h</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 font-sans">Mining Cycle</span>
                <span className="text-white font-bold">24 Hours</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 font-sans">Referral Link</span>
                <span className="text-[#34d399] font-bold">Enabled</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="clean-stake-confirm-btn !w-full !min-h-[40px] !text-xs !bg-none !bg-white/10 hover:!bg-white/15 !border-white/15 !text-white !shadow-none !font-bold"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TOP WALLET CONNECT (PURE PHANTOM + SOL BALANCE + VERIFICATION TRIGGER)
// ---------------------------------------------------------------------------
function TopWalletConnect({
  onOpenVerify,
  onOpenConnect,
}: {
  onOpenVerify?: () => void;
  onOpenConnect?: () => void;
}) {
  const { user, connectWallet, disconnectWallet } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    const provider = getPhantomSolanaProvider();
    if (!provider && onOpenConnect) {
      onOpenConnect();
      return;
    }
    setConnecting(true);
    try {
      await connectWallet();
      toast({
        title: 'Solana Wallet Connected',
        description: 'Wallet connected privately.',
        variant: 'success',
        icon: <Wallet size={17} />,
      });
    } catch (err: any) {
      if (err?.message === 'PHANTOM_NOT_INSTALLED' && onOpenConnect) {
        onOpenConnect();
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
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-b from-[#ffaa2b] to-[#f7931a] hover:from-[#ffb648] hover:to-[#f99d2b] border border-[#ffc86e]/40 text-[#09090b] text-xs font-bold transition-all duration-200 cursor-pointer shadow-[0_4px_16px_rgba(247,147,26,0.28)]"
      >
        <Wallet size={14} />
        <span>{connecting ? 'Connecting…' : 'Connect'}</span>
      </button>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.11] text-white text-xs font-mono font-medium transition-all duration-200 cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
      >
        <div className="w-5 h-5 rounded-full bg-[#f7931a]/15 border border-[#f7931a]/35 flex items-center justify-center text-[#f7931a]">
          <PhantomLogo size={12} />
        </div>
        <span className="flex items-center gap-1">
          {user.username ? `@${user.username}` : 'Wallet'}
          {user.isVerified && <Check size={11} className="text-[#10b981]" strokeWidth={3} />}
        </span>
        <ChevronDown size={12} className={`text-zinc-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
      </button>

      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 290,
            background: 'linear-gradient(180deg, #161820 0%, #0d0e13 100%)',
            border: '1px solid rgba(255, 255, 255, 0.11)',
            borderRadius: 14,
            padding: 14,
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
            zIndex: 100,
            textAlign: 'left',
          }}
        >
          {onOpenVerify && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpenVerify();
              }}
              style={{
                width: '100%',
                marginBottom: 12,
                padding: '9px 11px',
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                cursor: 'pointer',
                background: (!user.isVerified || !user.username)
                  ? 'linear-gradient(135deg, rgba(247, 147, 26, 0.18), rgba(251, 191, 36, 0.08))'
                  : 'rgba(16, 185, 129, 0.1)',
                border: (!user.isVerified || !user.username)
                  ? '1px solid rgba(247, 147, 26, 0.45)'
                  : '1px solid rgba(16, 185, 129, 0.3)',
                color: (!user.isVerified || !user.username) ? '#fbbf24' : '#34d399',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <ShieldCheck size={14} />
                <span>
                  {!user.isVerified
                    ? 'Upgrade to 24h · 0.02 SOL'
                    : !user.username
                      ? 'Set @username · Unlock 24h'
                      : 'Verified Node · Active'}
                </span>
              </span>
              <ChevronRight size={13} />
            </button>
          )}

          <div style={{ padding: '8px 10px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 8, marginBottom: 12, fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa' }}>
              <span>Verification</span>
              <strong style={{ color: user.isVerified ? '#34d399' : '#f7931a' }}>
                {user.isVerified ? 'Verified' : 'Unverified'}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa' }}>
              <span>Username ID</span>
              <strong style={{ color: '#fff' }}>{user.username ? `@${user.username}` : 'Not set'}</strong>
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
// STANDALONE INDEPENDENT GUIDE PAGE
// ---------------------------------------------------------------------------
function GuidePage({ onBack }: { onBack: () => void }) {
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans">
      {/* HEADER */}
      <header className="border-b border-white/[0.08] bg-[#09090b]/85 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Brand size="md" />
          <div className="flex items-center gap-3">
            <TopWalletConnect
              onOpenVerify={() => setVerifyModalOpen(true)}
              onOpenConnect={() => setConnectModalOpen(true)}
            />
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        {/* TOP NAVIGATION & HEADING */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white m-0">Guide</h1>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="clean-action-btn-soft !min-h-[32px] !px-3 !text-[11px]"
          >
            <ChevronLeft size={13} />
            <span>Back to Mining</span>
          </button>
        </div>

        {/* PROTOCOL OVERVIEW COCKPIT */}
        <div className="pob-cockpit mb-6 p-5 sm:p-6 flex items-center gap-4">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: 'rgba(247, 147, 26, 0.14)',
              border: '1px solid rgba(247, 147, 26, 0.28)',
              color: '#f7931a',
            }}
          >
            <Flame size={20} />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-extrabold text-white m-0">Bits Mining Protocol Guide</h2>
            <p className="text-xs font-mono text-zinc-400 m-0 mt-1">
              Proof-of-Power Multipliers &amp; Core Mechanics
            </p>
          </div>
        </div>

        {/* GUIDE RULES GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-5 rounded-2xl bg-[#121318] border border-white/[0.08] shadow-[0_12px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="flex items-center gap-2.5 mb-2.5 text-sm font-bold text-white">
              <div className="w-8 h-8 rounded-lg bg-[#10b981]/15 border border-[#10b981]/30 flex items-center justify-center text-[#10b981] flex-shrink-0">
                <Zap size={16} />
              </div>
              <span>1. Base Rate (0.01/h) &amp; Verified Rate (0.1/h)</span>
            </div>
            <p className="text-xs text-zinc-400 m-0 leading-relaxed">
              Any connected Solana wallet can press Start Mining at 0.0100 Bits/hr on a 3-hour cycle. Complete one-time 0.02 SOL verification and @username setup to upgrade to 0.1000 Bits/hr and 24-hour mining.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-[#121318] border border-white/[0.08] shadow-[0_12px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="flex items-center gap-2.5 mb-2.5 text-sm font-bold text-white">
              <div className="w-8 h-8 rounded-lg bg-[#fbbf24]/15 border border-[#fbbf24]/30 flex items-center justify-center text-[#fbbf24] flex-shrink-0">
                <Hammer size={16} />
              </div>
              <span>2. Direct Miners Power (10% Mining Power)</span>
            </div>
            <p className="text-xs text-zinc-400 m-0 leading-relaxed">
              Verified nodes receive their unique @username referral link. Active direct miners provide 10% of their mining power to their inviter.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-[#121318] border border-white/[0.08] shadow-[0_12px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="flex items-center gap-2.5 mb-2.5 text-sm font-bold text-white">
              <div className="w-8 h-8 rounded-lg bg-[#f7931a]/15 border border-[#f7931a]/30 flex items-center justify-center text-[#f7931a] flex-shrink-0">
                <Zap size={16} />
              </div>
              <span>3. SOL Power (Max 10 SOL Contribution)</span>
            </div>
            <p className="text-xs text-zinc-400 m-0 leading-relaxed">
              Verified nodes can contribute SOL to acquire SOL Power. Each 1 SOL contributed grants +5.0000 Bits/hr of SOL Power (up to max 10 SOL per account).
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-[#121318] border border-white/[0.08] shadow-[0_12px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="flex items-center gap-2.5 mb-2.5 text-sm font-bold text-white">
              <div className="w-8 h-8 rounded-lg bg-[#34d399]/15 border border-[#34d399]/30 flex items-center justify-center text-[#34d399] flex-shrink-0">
                <Sparkles size={16} />
              </div>
              <span>4. 3h / 24h Storage Tank &amp; Claims</span>
            </div>
            <p className="text-xs text-zinc-400 m-0 leading-relaxed">
              Base wallets mine for 3 hours and stop at 100% until claimed. Verified nodes unlock a 24-hour Storage Tank. Once 20% capacity is reached, claim anytime to credit your wallet balance.
            </p>
          </div>
        </div>
      </main>

      <ConnectWalletModal open={connectModalOpen} onClose={() => setConnectModalOpen(false)} />
      <VerifyAndUsernameModal
        open={verifyModalOpen}
        onClose={() => setVerifyModalOpen(false)}
        onOpenConnect={() => setConnectModalOpen(true)}
      />
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
    <div className="w-full h-[76px] my-2 bg-[#09090b] rounded-xl p-2 border border-white/8 relative overflow-hidden">
      <div className="absolute top-2 left-3 text-[10px] font-mono text-zinc-400">
        SOL Power: <strong className="text-[#f7931a]">{(solAmount * 5).toFixed(1)} Bits/hr</strong>
      </div>
      <div className="absolute top-2 right-3 text-[10px] font-mono text-zinc-400">
        Max: <strong className="text-[#34d399]">50.0 Bits/hr (10 SOL)</strong>
      </div>
      <svg viewBox="0 0 460 72" className="w-full h-full overflow-visible">
        <defs>
          <linearGradient id="solCurveGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f7931a" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#f7931a" stopOpacity="0.0" />
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
          stroke="#f7931a"
          strokeWidth="2.5"
          filter="url(#solCurveGlow)"
        />
        <line x1={x} y1={y} x2={x} y2="70" stroke="#f7931a" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
        <circle cx={x} cy={y} r="5" fill="#f7931a" filter="url(#solCurveGlow)" />
        <circle cx={x} cy={y} r="2" fill="#09090b" />
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
  const maxAccountSol = 10.0;
  const remainingQuota = Math.max(0, Number((maxAccountSol - currentContributed).toFixed(2)));
  const isCapped = remainingQuota <= 0;
  const defaultSol = Math.min(1.0, Math.max(0.1, remainingQuota > 0 ? remainingQuota : 0.1));

  const [solAmount, setSolAmount] = useState<number>(defaultSol);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSubmitError(null);
      setSolAmount(Math.min(1.0, Math.max(0.1, remainingQuota > 0 ? remainingQuota : 0.1)));
    }
  }, [open, remainingQuota]);

  if (!open) return null;

  const clampedSol = Math.max(0.1, Math.min(remainingQuota > 0 ? remainingQuota : 0.1, solAmount));
  const rateBoost = clampedSol * 5.0; // 1 SOL = +5.0 Bits/hr
  const dailyOutput = rateBoost * 24;
  const usdValue = clampedSol * 180;

  const handleSubmit = async () => {
    setSubmitError(null);
    if (isCapped || !Number.isFinite(clampedSol) || clampedSol <= 0) {
      setSubmitError('Maximum SOL Power quota reached for this account.');
      return;
    }
    try {
      await onCommitContribution(clampedSol);
    } catch (err) {
      setSubmitError(readableError(err, 'Could not complete SOL contribution.'));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(247, 147, 26, 0.14)', border: '1px solid rgba(247, 147, 26, 0.28)', display: 'grid', placeItems: 'center', color: '#f7931a' }}>
              <Zap size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 18, fontWeight: 700 }}>Contribute SOL</h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--silver-dark)' }}>
                Acquire SOL Power to mine more Bits · Max 10 SOL per account
              </p>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-4">
          <InlineErrorBanner message={submitError} />

          <div className="p-3 rounded-xl bg-white/[0.025] border border-white/8 flex items-center justify-between text-xs font-mono">
            <span className="text-zinc-400 font-sans">Account Limit:</span>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold tabular-nums">
                {currentContributed.toFixed(1)} / {maxAccountSol.toFixed(1)} SOL
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                isCapped ? 'bg-red-500/20 text-red-400' : 'bg-[#10b981]/15 text-[#34d399]'
              }`}>
                {isCapped ? 'MAX REACHED' : `${remainingQuota.toFixed(1)} SOL REMAINING`}
              </span>
            </div>
          </div>

          <div className="pob-input-box !bg-[#0b0c10] !border-white/10">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase text-zinc-400 tracking-wider">SOL Power Contribution</span>
              <span className="text-xs font-mono font-bold text-[#fbbf24] bg-[#f7931a]/12 px-2 py-0.5 rounded">
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
                onChange={(e) => {
                  setSolAmount(Number(e.target.value));
                  if (submitError) setSubmitError(null);
                }}
                className="modern-range-line"
                aria-label="SOL to contribute"
              />
            </div>

            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {[0.5, 1.0, 2.0, 5.0].filter((val) => val <= remainingQuota).map((val) => (
                <button
                  key={val}
                  type="button"
                  className={`pob-preset-btn ${clampedSol === val ? '!bg-[#f7931a]/20 !text-[#fbbf24] !border-[#f7931a]/45 font-bold' : ''}`}
                  onClick={() => {
                    setSolAmount(val);
                    if (submitError) setSubmitError(null);
                  }}
                >
                  {val} SOL
                </button>
              ))}
              {remainingQuota > 0 && (
                <button
                  type="button"
                  className={`pob-preset-btn ${clampedSol === remainingQuota ? '!bg-[#f7931a]/20 !text-[#fbbf24] !border-[#f7931a]/45 font-bold' : ''}`}
                  onClick={() => {
                    setSolAmount(remainingQuota);
                    if (submitError) setSubmitError(null);
                  }}
                >
                  MAX ({remainingQuota.toFixed(1)} SOL)
                </button>
              )}
            </div>
          </div>

          <div className="pob-panel-body flex flex-col gap-2.5 bg-[#0b0c10] p-3.5 rounded-xl border border-white/8 font-mono text-xs">
            <div className="flex justify-between items-center text-zinc-300">
              <span className="text-zinc-400 font-sans">Contribute:</span>
              <span className="font-bold text-white tabular-nums">{clampedSol.toFixed(1)} SOL <span className="text-zinc-500 font-normal font-sans">(≈ ${usdValue.toFixed(2)})</span></span>
            </div>
            <div className="flex justify-between items-center text-zinc-300">
              <span className="text-zinc-400 font-sans">SOL Power Acquired:</span>
              <span className="font-bold text-[#fbbf24] tabular-nums">+{rateBoost.toFixed(4)} Bits/hr</span>
            </div>
            <div className="flex justify-between items-center text-zinc-300">
              <span className="text-zinc-400 font-sans">24h Estimated Output:</span>
              <span className="font-bold text-[#34d399] tabular-nums">+{dailyOutput.toFixed(1)} Bits</span>
            </div>
          </div>

          <button
            type="button"
            className="clean-stake-confirm-btn !font-bold"
            disabled={isPending || isCapped}
            onClick={() => void handleSubmit()}
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
// STANDALONE INDEPENDENT LEDGER PAGE (CLAIMED POINTS LEDGER)
// ---------------------------------------------------------------------------
function LedgerPage({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);

  const isConnected = Boolean(user?.solanaAddress);
  const walletState = user?.solanaAddress ? getWalletMiningState(user.solanaAddress) : null;
  const claimedTotalBits = walletState ? walletState.claimedTotalBits : 0;
  const claimHistoryList = walletState ? walletState.claimHistory : [];

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans">
      {/* HEADER */}
      <header className="border-b border-white/[0.08] bg-[#09090b]/85 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Brand size="md" />
          <div className="flex items-center gap-3">
            <TopWalletConnect
              onOpenVerify={() => setVerifyModalOpen(true)}
              onOpenConnect={() => setConnectModalOpen(true)}
            />
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        {/* TOP NAVIGATION & HEADING */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white m-0">Ledger</h1>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="clean-action-btn-soft !min-h-[32px] !px-3 !text-[11px]"
          >
            <ChevronLeft size={13} />
            <span>Back to Mining</span>
          </button>
        </div>

        {/* 1. CLAIMED POINTS SUMMARY COCKPIT */}
        <div className="pob-cockpit mb-6 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div className="flex items-center gap-3.5">
            <BitsMark size={40} className="flex-shrink-0" />
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-bold mb-1">
                Claimed Points Ledger
              </div>
              <div className="text-3xl sm:text-4xl font-black font-mono text-[#34d399] tabular-nums tracking-tight">
                {claimedTotalBits.toFixed(4)} <span className="text-xs text-zinc-400 font-normal">BITS</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6 text-xs font-mono">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-0.5">Claims</div>
              <div className="text-lg font-bold text-white tabular-nums">{claimHistoryList.length}</div>
            </div>
          </div>
        </div>

        {/* 2. CLAIMED POINTS HISTORY LIST */}
        <div className="p-5 rounded-2xl bg-[#121318] border border-white/[0.08] shadow-[0_12px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white m-0">Claim History</h2>
            <span className="text-[11px] font-mono text-zinc-400 tabular-nums">
              {claimHistoryList.length} {claimHistoryList.length === 1 ? 'Entry' : 'Entries'}
            </span>
          </div>

          {!isConnected ? (
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-zinc-300">
                Connect your wallet to view your claimed points ledger.
              </div>
              <button
                type="button"
                onClick={() => setConnectModalOpen(true)}
                className="clean-stake-confirm-btn !w-full sm:!w-auto !min-h-[36px] !px-4 !text-xs !font-bold flex-shrink-0"
              >
                <Wallet size={14} />
                <span>Connect Wallet</span>
              </button>
            </div>
          ) : claimHistoryList.length === 0 ? (
            <div className="py-10 text-center text-zinc-500 text-xs font-mono">
              No claimed points yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {claimHistoryList.map((item, idx) => (
                <div
                  key={item.id || idx}
                  className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-white/[0.025] border border-white/[0.07] transition-colors hover:border-white/[0.12]"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-zinc-500 w-6 tabular-nums">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <BitsMark size={24} />
                    <span className="font-mono font-extrabold text-sm sm:text-base text-[#34d399] tabular-nums">
                      +{item.amount.toFixed(4)} BITS
                    </span>
                  </div>

                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono font-bold"
                    style={{
                      background: 'rgba(16, 185, 129, 0.12)',
                      border: '1px solid rgba(16, 185, 129, 0.28)',
                      color: '#34d399',
                    }}
                  >
                    <Check size={12} strokeWidth={3} />
                    Confirmed
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <ConnectWalletModal open={connectModalOpen} onClose={() => setConnectModalOpen(false)} />
      <VerifyAndUsernameModal
        open={verifyModalOpen}
        onClose={() => setVerifyModalOpen(false)}
        onOpenConnect={() => setConnectModalOpen(true)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CLEAN INDEPENDENT MINERS PAGE (10% MINING POWER — GATED BY VERIFY + @USERNAME)
// ---------------------------------------------------------------------------
function MinersPage({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamList, setTeamList] = useState<Array<{
    id: string;
    handle: string;
    status: string;
    isActive: boolean;
    miningPower: number;
    providedPower: number;
  }>>([]);

  const isConnected = Boolean(user?.solanaAddress);
  const isVerified = Boolean(user?.solanaAddress && user?.isVerified);
  const username = user?.username || '';
  const isUnlocked = isConnected && isVerified && Boolean(username);

  const loadTeam = async () => {
    if (!user?.solanaAddress) {
      setTeamList([]);
      setTeamError(null);
      return;
    }
    setTeamLoading(true);
    setTeamError(null);
    try {
      const data = await apiFetchJson<any[]>('/api/accounts/me/team');
      if (Array.isArray(data)) {
        setTeamList(
          data.map((m: any) => ({
            id: m.id || m.handle,
            handle: m.handle,
            status: m.isActive || m.status === 'verified' ? 'Active' : 'Inactive',
            isActive: Boolean(m.isActive || m.status === 'verified'),
            miningPower: Number(m.miningPower ?? (m.isActive || m.status === 'verified' ? 0.1 : 0)),
            providedPower: Number(m.providedPower ?? (m.isActive || m.status === 'verified' ? 0.01 : 0)),
          }))
        );
      } else {
        setTeamList([]);
      }
    } catch (err) {
      setTeamError(readableError(err, 'Could not load direct miners.'));
    } finally {
      setTeamLoading(false);
    }
  };

  useEffect(() => {
    void loadTeam();
  }, [user?.solanaAddress]);

  const activeCount = isUnlocked ? teamList.filter((m) => m.isActive).length : 0;
  const referralBoostPerHour = isUnlocked
    ? teamList.filter((m) => m.isActive).reduce((sum, m) => sum + m.providedPower, 0)
    : 0;

  const referralUrl = isUnlocked
    ? typeof window !== 'undefined'
      ? `${window.location.origin}/?ref=${username}`
      : `https://bitnoir.io/?ref=${username}`
    : '';

  const handleCopy = async () => {
    if (!referralUrl) return;
    const ok = await copyToClipboard(referralUrl);
    if (ok) {
      setCopied(true);
      toast({
        title: 'Copied',
        description: 'Referral link copied to clipboard.',
        variant: 'success',
        icon: <Copy size={16} />,
      });
      setTimeout(() => setCopied(false), 2200);
    } else {
      toast({ title: 'Copy Failed', description: 'Clipboard permission unavailable.', variant: 'destructive' });
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans">
      {/* HEADER */}
      <header className="border-b border-white/[0.08] bg-[#09090b]/85 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Brand size="md" />
          <div className="flex items-center gap-3">
            <TopWalletConnect
              onOpenVerify={() => setVerifyModalOpen(true)}
              onOpenConnect={() => setConnectModalOpen(true)}
            />
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        {/* TOP NAVIGATION & HEADING */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white m-0">Miners</h1>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="clean-action-btn-soft !min-h-[32px] !px-3 !text-[11px]"
          >
            <ChevronLeft size={13} />
            <span>Back to Mining</span>
          </button>
        </div>

        {/* 1. MINERS POWER SUMMARY COCKPIT */}
        <div className="pob-cockpit mb-6 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-bold mb-1">
              Miners Power (10%)
            </div>
            <div className="text-3xl sm:text-4xl font-black font-mono text-[#fbbf24] tabular-nums tracking-tight">
              +{referralBoostPerHour.toFixed(4)} <span className="text-xs text-zinc-400 font-normal">/h</span>
            </div>
          </div>

          <div className="flex items-center gap-6 text-xs font-mono">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-0.5">Active</div>
              <div className="text-lg font-bold text-[#34d399] tabular-nums">{activeCount}</div>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-0.5">Total</div>
              <div className="text-lg font-bold text-white tabular-nums">{teamList.length}</div>
            </div>
          </div>
        </div>

        {/* 2. INVITE LINK CARD */}
        <div className="mb-6 p-5 rounded-2xl bg-[#121318] border border-white/[0.08] shadow-[0_12px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]">
          <div className="flex items-start gap-2.5 text-xs text-zinc-300 mb-4 leading-relaxed">
            <Hammer size={15} className="text-[#fbbf24] mt-0.5 flex-shrink-0" />
            <div>
              Active direct miners contribute <strong className="text-[#fbbf24]">10% of their mining power</strong> to your velocity. Inactive miners contribute 0% until activated.
            </div>
          </div>

          {!isConnected ? (
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-zinc-300">
                Connect your wallet to unlock your Miners network and referral link.
              </div>
              <button
                type="button"
                onClick={() => setConnectModalOpen(true)}
                className="clean-stake-confirm-btn !w-full sm:!w-auto !min-h-[36px] !px-4 !text-xs !font-bold flex-shrink-0"
              >
                <Wallet size={14} />
                <span>Connect Wallet</span>
              </button>
            </div>
          ) : !isUnlocked ? (
            <div className="p-4 rounded-xl bg-[#f7931a]/[0.07] border border-[#f7931a]/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-xs text-zinc-200 leading-relaxed">
                <Lock size={15} className="text-[#fbbf24] mt-0.5 flex-shrink-0" />
                <div>
                  <strong className="text-white block">Referral Link Locked</strong>
                  Complete <strong className="text-[#fbbf24]">0.02 SOL</strong> verification and set your <strong className="text-white">@username</strong> to generate your invite link.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVerifyModalOpen(true)}
                className="clean-stake-confirm-btn !w-full sm:!w-auto !min-h-[36px] !px-4 !text-xs !font-bold flex-shrink-0"
              >
                <ShieldCheck size={14} />
                <span>{!isVerified ? 'Verify (0.02 SOL)' : 'Set @username'}</span>
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-bold">
                  Your Miner Invite Link
                </span>
                <span className="font-mono text-xs text-zinc-400">
                  Handle: <strong className="text-[#fbbf24]">@{username}</strong>
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#0b0c10] border border-white/10">
                <span className="font-mono text-xs text-zinc-200 truncate select-all">
                  {referralUrl}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="clean-action-btn-soft !min-h-[32px] !px-3 !text-xs flex-shrink-0"
                  style={{
                    borderColor: copied ? 'rgba(16, 185, 129, 0.45)' : undefined,
                    color: copied ? '#34d399' : undefined,
                  }}
                >
                  {copied ? (
                    <>
                      <Check size={13} strokeWidth={3} />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={13} />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 3. DIRECT MINERS LIST */}
        <div className="p-5 rounded-2xl bg-[#121318] border border-white/[0.08] shadow-[0_12px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white m-0">Direct Miners</h2>
            <span className="text-[11px] font-mono text-zinc-400 tabular-nums">
              {teamList.length} Miners
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            {teamError ? (
              <InlineErrorBanner message={teamError} onRetry={() => void loadTeam()} />
            ) : teamLoading ? (
              <div className="py-10 text-center text-zinc-400 text-xs font-mono flex items-center justify-center gap-2">
                <RefreshCw size={14} className="animate-spin text-[#fbbf24]" />
                <span>Loading direct miners…</span>
              </div>
            ) : teamList.length === 0 ? (
              <div className="py-10 text-center text-zinc-500 text-xs font-mono">
                No direct miners joined yet.
              </div>
            ) : (
              teamList.map((member, idx) => (
                <div
                  key={member.id || idx}
                  className="flex items-center justify-between px-4 py-3 rounded-xl transition-colors"
                  style={{
                    background: member.isActive ? 'rgba(247, 147, 26, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                    border: member.isActive ? '1px solid rgba(247, 147, 26, 0.18)' : '1px solid rgba(255, 255, 255, 0.06)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-zinc-500 w-6 tabular-nums">0{idx + 1}</span>
                    <div>
                      <div className="font-semibold text-white text-xs">@{member.handle}</div>
                      <div className="text-[10px] font-mono text-zinc-400 mt-0.5 tabular-nums">
                        Mining: {member.miningPower.toFixed(4)} /h
                      </div>
                    </div>
                  </div>

                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider"
                    style={{
                      background: member.isActive ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                      color: member.isActive ? '#34d399' : '#71717a',
                      border: member.isActive ? '1px solid rgba(16, 185, 129, 0.28)' : '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: member.isActive ? '#10b981' : '#71717a' }}
                    />
                    {member.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      <ConnectWalletModal open={connectModalOpen} onClose={() => setConnectModalOpen(false)} />
      <VerifyAndUsernameModal
        open={verifyModalOpen}
        onClose={() => setVerifyModalOpen(false)}
        onOpenConnect={() => setConnectModalOpen(true)}
      />
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
        <BitsMark size={44} className="flex-shrink-0" />
        <div className="flex items-baseline font-mono select-none">
          <span className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight tabular-nums">
            {intPart}
          </span>
          <span className="text-3xl sm:text-4xl md:text-5xl font-black text-[#f7931a]">.</span>
          <span className="text-3xl sm:text-4xl md:text-5xl font-bold text-[#fbbf24] tracking-tight tabular-nums">
            {primaryDec}
          </span>
          <span className="text-2xl sm:text-3xl md:text-4xl font-semibold text-[#34d399]/85 tracking-tight tabular-nums">
            {microDec}
          </span>
          <span className="text-xs sm:text-sm font-mono font-bold tracking-widest text-zinc-400 ml-2.5 uppercase self-center">
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
function MiningPage({ onOpenAssets, onOpenMiners, onOpenGuide, onOpenLedger }: { onOpenAssets?: () => void; onOpenMiners?: () => void; onOpenGuide?: () => void; onOpenLedger?: () => void }) {
  const client = useQueryClient();
  const { user, connectWallet } = useAuth();

  const [solPowerModalOpen, setSolPowerModalOpen] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [isContributing, setIsContributing] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  const isConnected = Boolean(user?.solanaAddress);
  const isVerified = Boolean(user?.solanaAddress && user?.isVerified);
  const hasUsername = Boolean(user?.username);
  // Verified node gets 24h cycle, 0.1/h base rate, referral link & multipliers; Base connected wallet gets 3h cycle at 0.01/h
  const isVerifiedNode = isConnected && isVerified && hasUsername;
  const cycleHours = isVerifiedNode ? 24 : 3;
  const cycleTotalSeconds = cycleHours * 3600;

  // 1. Base Rate: 0.01/h for connected Base wallets, 0.1000/h once Verified + @username
  const baseRatePerHour = isVerifiedNode ? 0.1000 : isConnected ? 0.0100 : 0.0000;

  // 2. Direct Referral Power (starts at zero — populated only from real active referrals)
  const [directTeam, setDirectTeam] = useState<Array<{
    id: string;
    handle: string;
    status: string;
    isActive: boolean;
    miningPower: number;
    providedPower: number;
  }>>([]);

  useEffect(() => {
    if (!user?.solanaAddress) {
      setDirectTeam([]);
      return;
    }
    apiFetchJson<any[]>('/api/accounts/me/team')
      .then((data) => {
        if (Array.isArray(data)) {
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
        } else {
          setDirectTeam([]);
        }
      })
      .catch((err) => {
        console.warn('Direct team fetch warning:', err);
        setDirectTeam([]);
      });
  }, [user?.solanaAddress]);

  const referralBoostPerHour = isVerifiedNode
    ? directTeam.filter((m) => m.isActive).reduce((sum, m) => sum + m.providedPower, 0)
    : 0;

  // 3. SOL Power Multiplier: Max 10 SOL per account (+5 Bits/hr per SOL)
  const [contributedSol, setContributedSol] = useState<number>(0);
  const solPowerBoostPerHour = isVerifiedNode ? contributedSol * 5.0 : 0;

  // Configured hash rate when running
  const configuredRatePerHour = isConnected
    ? baseRatePerHour + referralBoostPerHour + solPowerBoostPerHour
    : 0;

  // 4. Mining Session State & Live Ticking Counter
  const [isMiningSessionActive, setIsMiningSessionActive] = useState<boolean>(false);
  const [sessionElapsedSec, setSessionElapsedSec] = useState<number>(0);
  const [unclaimedBits, setUnclaimedBits] = useState<number>(0);
  const [claimedTotalBits, setClaimedTotalBits] = useState<number>(0);
  const [claimHistoryList, setClaimHistoryList] = useState<Array<{ id: number; amount: number; status: string }>>([]);

  const isLiveMining = isConnected && isMiningSessionActive && sessionElapsedSec < cycleTotalSeconds;
  const totalMiningRatePerHour = isLiveMining ? configuredRatePerHour : 0;

  const baseBitsRef = useRef<number>(0);
  const baseElapsedRef = useRef<number>(0);
  const baseTimeRef = useRef<number>(Date.now());
  const rateRef = useRef<number>(configuredRatePerHour);
  rateRef.current = configuredRatePerHour;
  const cycleSecRef = useRef<number>(cycleTotalSeconds);
  cycleSecRef.current = cycleTotalSeconds;
  const loadedAddrRef = useRef<string>('');
  const prevVerifiedRef = useRef<boolean>(false);

  // Load or reset per-wallet mining state on wallet connect / switch / disconnect
  useEffect(() => {
    if (!user?.solanaAddress) {
      loadedAddrRef.current = '';
      prevVerifiedRef.current = false;
      baseBitsRef.current = 0;
      baseElapsedRef.current = 0;
      baseTimeRef.current = Date.now();
      setIsMiningSessionActive(false);
      setSessionElapsedSec(0);
      setUnclaimedBits(0);
      setContributedSol(0);
      setClaimedTotalBits(0);
      setClaimHistoryList([]);
      return;
    }

    if (loadedAddrRef.current === user.solanaAddress) return;
    loadedAddrRef.current = user.solanaAddress;
    prevVerifiedRef.current = isVerifiedNode;

    const saved = getWalletMiningState(user.solanaAddress);
    const initCycleSec = isVerifiedNode ? 24 * 3600 : 3 * 3600;
    const initRate = isVerifiedNode
      ? 0.1 + directTeam.filter((m) => m.isActive).reduce((sum, m) => sum + m.providedPower, 0) + saved.contributedSol * 5.0
      : 0.01;

    if (saved.isMiningSessionActive) {
      const elapsedDelta = Math.max(0, (Date.now() - saved.lastTickAt) / 1000);
      const nextElapsed = Math.min(initCycleSec, saved.sessionElapsedSec + elapsedDelta);
      const activeDelta = Math.max(0, nextElapsed - saved.sessionElapsedSec);
      const resumedBits = saved.unclaimedBits + (initRate / 3600) * activeDelta;
      const stillRunning = nextElapsed < initCycleSec;

      baseBitsRef.current = resumedBits;
      baseElapsedRef.current = nextElapsed;
      baseTimeRef.current = Date.now();
      setUnclaimedBits(resumedBits);
      setSessionElapsedSec(nextElapsed);
      setIsMiningSessionActive(stillRunning);
      if (!stillRunning) {
        saveWalletMiningState(user.solanaAddress, {
          ...saved,
          unclaimedBits: resumedBits,
          sessionElapsedSec: nextElapsed,
          isMiningSessionActive: false,
          lastTickAt: Date.now(),
        });
      }
    } else {
      baseBitsRef.current = saved.unclaimedBits;
      baseElapsedRef.current = saved.sessionElapsedSec;
      baseTimeRef.current = Date.now();
      setUnclaimedBits(saved.unclaimedBits);
      setSessionElapsedSec(saved.sessionElapsedSec);
      setIsMiningSessionActive(false);
    }

    setContributedSol(saved.contributedSol);
    setClaimedTotalBits(saved.claimedTotalBits);
    setClaimHistoryList(saved.claimHistory);
  }, [user?.solanaAddress]);

  // Immediately upgrade & start 24h 0.1/h mining as soon as wallet completes 0.02 SOL verification + @username
  useEffect(() => {
    if (!user?.solanaAddress) return;
    if (!prevVerifiedRef.current && isVerifiedNode) {
      prevVerifiedRef.current = true;
      const dt = isMiningSessionActive ? Math.max(0, (Date.now() - baseTimeRef.current) / 1000) : 0;
      const lockedBits = baseBitsRef.current + (isMiningSessionActive ? (rateRef.current / 3600) * dt : 0);
      const lockedElapsed = Math.min(24 * 3600, baseElapsedRef.current + dt);
      baseBitsRef.current = lockedBits;
      baseElapsedRef.current = lockedElapsed;
      baseTimeRef.current = Date.now();
      setUnclaimedBits(lockedBits);
      setSessionElapsedSec(lockedElapsed);
      setIsMiningSessionActive(true);
      saveWalletMiningState(user.solanaAddress, {
        unclaimedBits: lockedBits,
        claimedTotalBits,
        contributedSol,
        lastTickAt: Date.now(),
        isMiningSessionActive: true,
        sessionElapsedSec: lockedElapsed,
        claimHistory: claimHistoryList,
      });
    } else {
      prevVerifiedRef.current = isVerifiedNode;
    }
  }, [isVerifiedNode, user?.solanaAddress]);

  // Real-time ticker (automatically stops when 3h Base or 24h Verified cycle completes)
  useEffect(() => {
    if (!isConnected || !isMiningSessionActive || !user?.solanaAddress) return;
    let animId: number;
    const tick = () => {
      const dt = Math.max(0, (Date.now() - baseTimeRef.current) / 1000);
      const totalElapsed = baseElapsedRef.current + dt;
      const maxSec = cycleSecRef.current;

      if (totalElapsed >= maxSec) {
        const activeDt = Math.max(0, maxSec - baseElapsedRef.current);
        const finalBits = baseBitsRef.current + (rateRef.current / 3600) * activeDt;
        baseBitsRef.current = finalBits;
        baseElapsedRef.current = maxSec;
        baseTimeRef.current = Date.now();
        setSessionElapsedSec(maxSec);
        setUnclaimedBits(finalBits);
        setIsMiningSessionActive(false);
        saveWalletMiningState(user.solanaAddress, {
          unclaimedBits: finalBits,
          claimedTotalBits,
          contributedSol,
          lastTickAt: Date.now(),
          isMiningSessionActive: false,
          sessionElapsedSec: maxSec,
          claimHistory: claimHistoryList,
        });
        return;
      }

      const currentBits = baseBitsRef.current + (rateRef.current / 3600) * dt;
      setSessionElapsedSec(totalElapsed);
      setUnclaimedBits(currentBits);
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);

    const persistInterval = window.setInterval(() => {
      if (!user?.solanaAddress) return;
      const dt = Math.max(0, (Date.now() - baseTimeRef.current) / 1000);
      const maxSec = cycleSecRef.current;
      const cappedElapsed = Math.min(maxSec, baseElapsedRef.current + dt);
      const activeDt = Math.max(0, cappedElapsed - baseElapsedRef.current);
      const currentBits = baseBitsRef.current + (rateRef.current / 3600) * activeDt;
      saveWalletMiningState(user.solanaAddress, {
        unclaimedBits: currentBits,
        claimedTotalBits,
        contributedSol,
        lastTickAt: Date.now(),
        isMiningSessionActive: cappedElapsed < maxSec,
        sessionElapsedSec: cappedElapsed,
        claimHistory: claimHistoryList,
      });
    }, 2000);

    return () => {
      cancelAnimationFrame(animId);
      clearInterval(persistInterval);
    };
  }, [isConnected, isMiningSessionActive, configuredRatePerHour, cycleTotalSeconds, user?.solanaAddress, claimedTotalBits, contributedSol, claimHistoryList]);

  // Storage tank progress & countdown (3-hour cycle for Base, 24-hour cycle for Verified)
  const minClaimThresholdPercent = 20;
  const tankFillPercent = isConnected
    ? Math.min(100, (sessionElapsedSec / (cycleTotalSeconds || 1)) * 100)
    : 0;
  const is20PercentReached = isConnected && tankFillPercent >= minClaimThresholdPercent && unclaimedBits > 0;

  const remainingSeconds = Math.max(0, cycleTotalSeconds - sessionElapsedSec);
  const remH = Math.floor(remainingSeconds / 3600);
  const remM = Math.floor((remainingSeconds % 3600) / 60);
  const remS = Math.floor(remainingSeconds % 60);
  const countdownTimer = `${remH.toString().padStart(2, '0')}:${remM.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;

  // Start Mining handler (available to any connected Solana wallet at Base 0.01/h 3h, or Verified 0.1/h 24h)
  const handleStartMining = async () => {
    if (!isConnected || !user?.solanaAddress) {
      const provider = getPhantomSolanaProvider();
      if (!provider) {
        setConnectModalOpen(true);
        return;
      }
      try {
        const addr = await connectWallet();
        await apiFetchJson('/api/accounts/me/start-mining', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        baseBitsRef.current = 0;
        baseElapsedRef.current = 0;
        baseTimeRef.current = Date.now();
        setUnclaimedBits(0);
        setSessionElapsedSec(0);
        setIsMiningSessionActive(true);
        saveWalletMiningState(addr, {
          unclaimedBits: 0,
          claimedTotalBits: 0,
          contributedSol: 0,
          lastTickAt: Date.now(),
          isMiningSessionActive: true,
          sessionElapsedSec: 0,
          claimHistory: [],
        });
        toast({
          title: '3h Base Mining Started',
          description: 'Mining at 0.0100 Bits/hr. Stops at 3h cap for claim.',
          variant: 'gold',
          icon: <Hammer size={17} />,
        });
      } catch (err: any) {
        if (err?.message === 'PHANTOM_NOT_INSTALLED') {
          setConnectModalOpen(true);
        } else {
          toast({
            title: 'Could Not Start Mining',
            description: readableError(err, 'Unable to start mining session.'),
            variant: 'destructive',
          });
        }
      }
      return;
    }

    const resetCycle = sessionElapsedSec >= cycleTotalSeconds;
    const startBits = resetCycle ? 0 : unclaimedBits;
    const startElapsed = resetCycle ? 0 : sessionElapsedSec;

    try {
      await apiFetchJson('/api/accounts/me/start-mining', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      baseBitsRef.current = startBits;
      baseElapsedRef.current = startElapsed;
      baseTimeRef.current = Date.now();
      setUnclaimedBits(startBits);
      setSessionElapsedSec(startElapsed);
      setIsMiningSessionActive(true);

      saveWalletMiningState(user.solanaAddress, {
        unclaimedBits: startBits,
        claimedTotalBits,
        contributedSol,
        lastTickAt: Date.now(),
        isMiningSessionActive: true,
        sessionElapsedSec: startElapsed,
        claimHistory: claimHistoryList,
      });

      toast({
        title: isVerifiedNode ? '24h Verified Mining Started' : '3h Base Mining Started',
        description: isVerifiedNode
          ? `Mining live at ${configuredRatePerHour.toFixed(4)} Bits/hr for 24 hours.`
          : 'Mining live at 0.0100 Bits/hr for 3 hours (stops at 3h cap for claim).',
        variant: 'gold',
        icon: <Hammer size={17} />,
      });
    } catch (err) {
      toast({
        title: 'Could Not Start Mining',
        description: readableError(err, 'Unable to start mining session.'),
        variant: 'destructive',
      });
    }
  };

  // Claim handler (works for both 3h Base users and 24h Verified users)
  const handleClaimMinedBits = async () => {
    if (!isConnected) {
      setConnectModalOpen(true);
      return;
    }
    if (!is20PercentReached || isClaiming || !Number.isFinite(unclaimedBits) || unclaimedBits <= 0) {
      toast({
        title: 'Minimum Threshold',
        description: 'Reach 20% storage tank capacity to claim mined Bits.',
        variant: 'warning',
      });
      return;
    }
    setIsClaiming(true);
    const claimedAmount = unclaimedBits;
    try {
      const data = await apiFetchJson<{ message?: string }>('/api/accounts/me/claim-mined-bits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: claimedAmount }),
      });
      const nextClaimed = Number((claimedTotalBits + claimedAmount).toFixed(4));
      const nextHistory = [{ id: Date.now(), amount: claimedAmount, status: 'Confirmed' }, ...claimHistoryList];
      baseBitsRef.current = 0;
      baseElapsedRef.current = 0;
      baseTimeRef.current = Date.now();
      setUnclaimedBits(0);
      setSessionElapsedSec(0);
      setIsMiningSessionActive(false);
      setClaimedTotalBits(nextClaimed);
      setClaimHistoryList(nextHistory);
      if (user?.solanaAddress) {
        saveWalletMiningState(user.solanaAddress, {
          unclaimedBits: 0,
          claimedTotalBits: nextClaimed,
          contributedSol,
          lastTickAt: Date.now(),
          isMiningSessionActive: false,
          sessionElapsedSec: 0,
          claimHistory: nextHistory,
        });
      }
      toast({
        title: 'Mined Bits Claimed',
        description: data.message || `Claimed +${claimedAmount.toFixed(4)} Bits into your balance.`,
        variant: 'success',
        icon: <BitsMark size={22} />,
      });
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
    } catch (err) {
      toast({
        title: 'Claim Failed',
        description: readableError(err, 'Could not claim mined Bits.'),
        variant: 'destructive',
      });
    } finally {
      setIsClaiming(false);
    }
  };

  // Contribute SOL Handler (Max 10 SOL per account)
  const handleCommitSolPower = async (solAmount: number) => {
    if (!isVerifiedNode || !user?.solanaAddress) {
      setSolPowerModalOpen(false);
      setVerifyModalOpen(true);
      return;
    }
    if (!Number.isFinite(solAmount) || solAmount <= 0) {
      throw new Error('Enter a valid SOL amount.');
    }
    setIsContributing(true);
    try {
      const tx = await sendSolanaTransactionOnchain({
        fromAddress: user.solanaAddress,
        toAddress: PROTOCOL_TREASURY_SOLANA,
        amountSol: solAmount,
        memo: `Bitnoir SOL Power Boost: ${solAmount} SOL`,
      });
      const data = await apiFetchJson<{ message?: string }>('/api/accounts/me/contribute-sol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solAmount, txSignature: tx.signature }),
      });
      const boost = solAmount * 5.0;
      const nextSol = Number((contributedSol + solAmount).toFixed(2));

      // Lock in accrued bits and elapsed time before changing rate
      const currentDt = isMiningSessionActive ? Math.max(0, (Date.now() - baseTimeRef.current) / 1000) : 0;
      const currentAccrued = baseBitsRef.current + (isMiningSessionActive ? (rateRef.current / 3600) * currentDt : 0);
      const currentElapsed = Math.min(cycleSecRef.current, baseElapsedRef.current + currentDt);
      baseBitsRef.current = currentAccrued;
      baseElapsedRef.current = currentElapsed;
      baseTimeRef.current = Date.now();
      setSessionElapsedSec(currentElapsed);
      setUnclaimedBits(currentAccrued);

      setContributedSol(nextSol);
      saveWalletMiningState(user.solanaAddress, {
        unclaimedBits: currentAccrued,
        claimedTotalBits,
        contributedSol: nextSol,
        lastTickAt: Date.now(),
        isMiningSessionActive,
        sessionElapsedSec: currentElapsed,
        claimHistory: claimHistoryList,
      });
      setSolPowerModalOpen(false);
      toast({
        title: 'SOL Power Acquired',
        description: data.message || `Contributed ${solAmount} SOL for +${boost.toFixed(4)} Bits/hr SOL Power.`,
        variant: 'gold',
        icon: <Zap size={17} />,
      });
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
    } catch (err) {
      toast({
        title: 'Contribution Failed',
        description: readableError(err, 'Could not contribute SOL for SOL Power.'),
        variant: 'destructive',
      });
      throw err;
    } finally {
      setIsContributing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans">
      {/* TOP CLEAN APP HEADER */}
      <header className="border-b border-white/[0.08] bg-[#09090b]/85 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Brand size="md" />
          <div className="flex items-center gap-3">
            <TopWalletConnect
              onOpenVerify={() => setVerifyModalOpen(true)}
              onOpenConnect={() => setConnectModalOpen(true)}
            />
          </div>
        </div>
      </header>

      {/* MAIN BITS MINING STAGE */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        {/* 1. TOP HEADER WITH OFFICIAL BITS LOGO & CLEAN ACTION BUTTONS */}
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white m-0">Bits Mining</h1>
            {isLiveMining ? (
              <span className="w-2 h-2 rounded-full bg-[#10b981]" title="Mining Live" />
            ) : isConnected && unclaimedBits > 0 ? (
              <span className="px-2.5 py-0.5 rounded-full bg-[#f7931a]/15 border border-[#f7931a]/35 text-[#fbbf24] text-[10px] font-mono font-bold uppercase tracking-wider">
                {isVerifiedNode ? '24h Cap · Claim' : '3h Stopped · Claim'}
              </span>
            ) : null}
          </div>

          {/* ACTION BUTTONS: MINERS, GUIDE, ASSETS & SOL POWER */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="clean-action-btn-soft"
              onClick={onOpenMiners}
              title="Miners (Active miners provide 10% mining power)"
            >
              <Hammer size={14} className="text-[#fbbf24]" />
              <span>Miners</span>
            </button>
            <button
              type="button"
              className="clean-action-btn-soft"
              onClick={onOpenGuide}
            >
              <BookOpen size={14} className="text-zinc-300" />
              <span>Guide</span>
            </button>
            <button
              type="button"
              className="clean-action-btn-soft !bg-[#f7931a]/10 !border-[#f7931a]/35 !text-[#fbbf24] hover:!bg-[#f7931a]/20 hover:!border-[#f7931a]/70"
              onClick={onOpenAssets}
              title="Assets · Onchain Send, Receive & Withdraw"
            >
              <Wallet size={14} className="text-[#f7931a]" />
              <span>Assets</span>
            </button>
            <button
              type="button"
              className="clean-stake-confirm-btn !w-auto !min-h-[38px] !px-4 !py-1.5 !text-xs !font-bold"
              onClick={() => {
                if (!isVerifiedNode) {
                  setVerifyModalOpen(true);
                } else {
                  setSolPowerModalOpen(true);
                }
              }}
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
                <div className="w-full h-2.5 bg-white/[0.08] rounded-full overflow-hidden border border-white/[0.05]">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ease-out ${
                      is20PercentReached
                        ? 'bg-gradient-to-r from-[#10b981] via-[#fbbf24] to-[#f7931a]'
                        : 'bg-gradient-to-r from-zinc-600 to-zinc-400'
                    }`}
                    style={{ width: `${tankFillPercent}%` }}
                  />
                </div>
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white/35 pointer-events-none"
                  style={{ left: '20%' }}
                  title="20% Minimum Claim Unlock Notch"
                />
              </div>
            </div>

            {/* TOP BUTTONS: MINERS BUTTON ALONG WITH CLAIMED LEDGER POINT BUTTON */}
            <div className="pob-live-action flex flex-col items-end">
              <div className="flex items-center gap-2 mb-1.5 justify-end text-[11px] font-mono select-none">
                <span className="flex items-center gap-1">
                  <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Progress</span>
                  <span className="text-[#34d399] font-bold tabular-nums">{tankFillPercent.toFixed(1)}%</span>
                </span>
                <span className="text-zinc-600">·</span>
                <span className="flex items-center gap-1">
                  <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Timer</span>
                  <span className="text-white font-bold tabular-nums">{countdownTimer}</span>
                </span>
              </div>

              <div className="flex items-center gap-1.5 mb-2 justify-end flex-wrap">
                <button
                  type="button"
                  className="referral-points-top-btn"
                  onClick={onOpenMiners}
                  title="Miners (Active miners provide 10% mining power)"
                >
                  <Hammer size={12} className="text-[#fbbf24]" />
                  <span className="font-mono font-bold text-white tabular-nums text-[11px]">+{referralBoostPerHour.toFixed(4)}</span>
                  <span className="text-[9px] font-mono text-[#fbbf24] font-bold tracking-wider">MINERS</span>
                  <ChevronRight size={11} className="text-zinc-400" />
                </button>

                <button
                  type="button"
                  className="claimed-points-top-btn"
                  onClick={onOpenLedger}
                  title="Open Claimed Points Ledger"
                >
                  <ScrollText size={12} className="text-[#34d399]" />
                  <span className="font-mono font-bold text-white tabular-nums text-[11px]">{claimedTotalBits.toFixed(4)}</span>
                  <span className="text-[9px] font-mono text-[#34d399] font-bold tracking-wider">LEDGER</span>
                  <ChevronRight size={11} className="text-zinc-400" />
                </button>
              </div>

              {(!isConnected || (!isMiningSessionActive && unclaimedBits <= 0)) ? (
                <button
                  type="button"
                  className="claim-btn-active-colorful"
                  onClick={() => void handleStartMining()}
                >
                  <Zap size={13} />
                  <span>Start Mining</span>
                </button>
              ) : (
                <button
                  type="button"
                  className={is20PercentReached ? 'claim-btn-active-colorful' : 'claim-btn-plane'}
                  disabled={!is20PercentReached || isClaiming}
                  onClick={handleClaimMinedBits}
                >
                  {isClaiming ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : is20PercentReached ? null : (
                    <Lock size={13} className="text-zinc-400" />
                  )}
                  <span>{isClaiming ? 'Claiming…' : 'Claim'}</span>
                </button>
              )}
            </div>
          </div>

          {/* 3. PURE STATS MATRIX */}
          <div className="pob-cockpit-stats">
            <div className="pob-stat-cell">
              <span className="pob-stat-label">BASE</span>
              <div className="pob-stat-val text-white tabular-nums">{baseRatePerHour.toFixed(4)} /h</div>
            </div>
            <div className="pob-stat-divider" />
            <div className="pob-stat-cell">
              <span className="pob-stat-label">MINERS (10%)</span>
              <div className="pob-stat-val text-[#fbbf24] tabular-nums">+{referralBoostPerHour.toFixed(4)} /h</div>
            </div>
            <div className="pob-stat-divider" />
            <div className="pob-stat-cell">
              <span className="pob-stat-label">SOL POWER</span>
              <div className="pob-stat-val text-[#f7931a] tabular-nums">+{solPowerBoostPerHour.toFixed(4)} /h</div>
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
      <ConnectWalletModal open={connectModalOpen} onClose={() => setConnectModalOpen(false)} />

      <VerifyAndUsernameModal
        open={verifyModalOpen}
        onClose={() => setVerifyModalOpen(false)}
        onOpenConnect={() => setConnectModalOpen(true)}
      />

      <SolPowerModal
        open={solPowerModalOpen}
        onClose={() => setSolPowerModalOpen(false)}
        onCommitContribution={handleCommitSolPower}
        currentContributed={contributedSol}
        isPending={isContributing}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DETERMINISTIC SOLANA QR MATRIX SVG
// ---------------------------------------------------------------------------
function SolanaAddressQr({ address }: { address: string }) {
  const size = 21;
  const cells: Array<{ x: number; y: number }> = [];
  let seed = 0;
  for (let i = 0; i < address.length; i++) {
    seed = (seed * 31 + address.charCodeAt(i)) >>> 0;
  }

  const isFinder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isFinder(r, c)) continue;
      const hash = ((seed ^ (r * 73856093) ^ (c * 19349663)) >>> 0) % 10;
      if (hash < 5) cells.push({ x: c, y: r });
    }
  }

  return (
    <svg width="136" height="136" viewBox={`0 0 ${size + 2} ${size + 2}`} fill="none">
      <rect width={size + 2} height={size + 2} rx="2" fill="white" />
      {/* Finder patterns */}
      {[
        [1, 1],
        [size - 6, 1],
        [1, size - 6],
      ].map(([fx, fy], idx) => (
        <g key={idx}>
          <rect x={fx} y={fy} width="7" height="7" fill="#09090b" />
          <rect x={fx + 1} y={fy + 1} width="5" height="5" fill="white" />
          <rect x={fx + 2} y={fy + 2} width="3" height="3" fill="#09090b" />
        </g>
      ))}
      {cells.map((cell, i) => (
        <rect key={i} x={cell.x + 1} y={cell.y + 1} width="1" height="1" fill="#09090b" />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// CLEAN PREMIUM ASSETS PAGE (NO BOTTOM SEND/RECEIVE/SWAP; ONCHAIN SEND/RECEIVE/WITHDRAW MODALS)
// ---------------------------------------------------------------------------
function AssetsPage({ onBack }: { onBack: () => void }) {
  const client = useQueryClient();
  const { user } = useAuth();
  const accountQuery = useGetMyAccount({ query: { queryKey: getGetMyAccountQueryKey() } });
  const account = accountQuery.data;

  const [activities, setActivities] = useState<any[]>([]);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);

  // In-app Modal states (Send, Receive) & Onchain Withdraw
  const [activeActionModal, setActiveActionModal] = useState<'send' | 'receive' | 'withdraw' | null>(null);

  // In-app Send state
  const [sendAsset, setSendAsset] = useState<'bits' | 'bitnoir'>('bits');
  const [sendRecipient, setSendRecipient] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  // In-app Receive state
  const [copiedHandle, setCopiedHandle] = useState(false);

  // Onchain Withdraw state
  const [withdrawAsset, setWithdrawAsset] = useState<'bitnoir' | 'bits'>('bitnoir');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const isConnected = Boolean(user?.solanaAddress);
  const isVerified = Boolean(user?.solanaAddress && user?.isVerified);
  const hasUsername = Boolean(user?.username);
  const canUsernameTransfer = isConnected && isVerified && hasUsername;

  const openActionModal = (modal: 'send' | 'receive' | 'withdraw') => {
    setSendError(null);
    setWithdrawError(null);
    setActiveActionModal(modal);
  };

  const refreshActivity = async () => {
    if (!user?.solanaAddress) {
      setActivities([]);
      setActivitiesError(null);
      return;
    }
    setActivitiesLoading(true);
    setActivitiesError(null);
    try {
      const data = await apiFetchJson<any[]>('/api/accounts/me/activity');
      const remote = Array.isArray(data) ? data : [];
      const local = getLocalWalletActivities(user.solanaAddress);
      const merged = [...local, ...remote];
      const seen = new Set<string>();
      const deduped = merged.filter((item) => {
        if (
          item.title === 'Received 5,000 Bits Onchain Allocation' ||
          item.title === 'Received 100 Free Signup Bits'
        ) {
          return false;
        }
        const key = `${item.title}-${item.txHash || item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setActivities(deduped.slice(0, 20));
    } catch (err) {
      setActivitiesError(readableError(err, 'Could not load transaction history.'));
      setActivities(getLocalWalletActivities(user.solanaAddress).slice(0, 20));
    } finally {
      setActivitiesLoading(false);
    }
  };

  useEffect(() => {
    void refreshActivity();
    const onSynced = () => {
      void accountQuery.refetch();
      void refreshActivity();
    };
    window.addEventListener('bitnoir-session-synced', onSynced);
    return () => window.removeEventListener('bitnoir-session-synced', onSynced);
  }, [user?.solanaAddress]);

  const bitsPurchased = isConnected ? (account?.balances?.purchased ?? 0) : 0;
  const noirClaimed = isConnected ? ((account?.balances as any)?.claimed ?? 0) : 0;
  const totalUsd = bitsPurchased * 0.10 + noirClaimed * 1.10;

  const cleanRecipientInput = sendRecipient.trim();
  const resolvedRecipientHandle = cleanRecipientInput
    ? cleanRecipientInput.replace(/^@/, '').toLowerCase()
    : '';
  const isRecipientHandleValid = /^[a-z0-9_]{3,20}$/.test(resolvedRecipientHandle);

  const handleInAppSend = async () => {
    setSendError(null);
    if (!isConnected || !user?.solanaAddress) {
      setConnectModalOpen(true);
      return;
    }
    if (!canUsernameTransfer) {
      setActiveActionModal(null);
      setVerifyModalOpen(true);
      toast({
        title: 'Verification & @username Required',
        description: 'Complete 0.02 SOL verification and set your @username for in-app transfers.',
        variant: 'destructive',
      });
      return;
    }

    const amt = Number(sendAmount);
    if (!cleanRecipientInput || !Number.isFinite(amt) || amt <= 0) {
      const msg = 'Enter recipient @username and a valid positive amount.';
      setSendError(msg);
      return;
    }
    if (!isRecipientHandleValid) {
      setSendError('Enter a valid recipient @username (3-20 lowercase letters, numbers, or underscore).');
      return;
    }
    if (resolvedRecipientHandle === (user.username || '').toLowerCase()) {
      setSendError('Cannot transfer to your own @username.');
      return;
    }

    const maxAvailable = sendAsset === 'bits' ? bitsPurchased : noirClaimed;
    if (amt > maxAvailable) {
      setSendError('Amount exceeds available balance.');
      return;
    }

    setIsSending(true);
    try {
      const targetLabel = `@${resolvedRecipientHandle}`;
      await apiFetchJson('/api/wallet/send-inapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: sendAsset,
          amount: amt,
          recipient: targetLabel,
          sender: user.username,
        }),
      });

      saveLocalWalletActivity(user.solanaAddress, {
        id: Date.now(),
        kind: 'send',
        title: `Sent ${amt} ${sendAsset === 'bits' ? 'Bits' : 'Bitnoir'} to ${targetLabel}`,
        detail: `In-app transfer @${user.username} → ${targetLabel}`,
        amount: amt,
        asset: sendAsset,
        createdAt: new Date().toISOString(),
      });

      toast({
        title: 'Sent In-App',
        description: `Transferred ${amt} ${sendAsset === 'bits' ? 'Bits' : 'Bitnoir'} to ${targetLabel}.`,
        variant: 'success',
        icon: <Send size={16} />,
      });
      setSendAmount('');
      setSendRecipient('');
      setSendError(null);
      setActiveActionModal(null);
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void refreshActivity();
    } catch (err) {
      const msg = readableError(err, 'Could not complete transfer.');
      setSendError(msg);
      toast({ title: 'Transfer Failed', description: msg, variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  };

  const handleOnchainWithdraw = async () => {
    setWithdrawError(null);
    if (!isConnected || !user?.solanaAddress) {
      setConnectModalOpen(true);
      return;
    }
    const dest = withdrawAddress.trim();
    const amt = Number(withdrawAmount);
    if (!isValidSolanaAddress(dest)) {
      setWithdrawError('Enter a valid destination Solana address (32-44 base58 characters).');
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setWithdrawError('Enter a valid positive withdrawal amount.');
      return;
    }
    const maxAvailable = withdrawAsset === 'bits' ? bitsPurchased : noirClaimed;
    if (amt > maxAvailable) {
      setWithdrawError('Amount exceeds available balance.');
      return;
    }

    setIsWithdrawing(true);
    try {
      const signed = await signOnchainWalletAction({
        fromAddress: user.solanaAddress,
        memo: `Bitnoir Onchain Withdraw: ${amt} ${withdrawAsset.toUpperCase()} to ${dest}`,
      });

      await apiFetchJson('/api/wallet/withdraw-onchain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: withdrawAsset,
          amount: amt,
          destinationAddress: dest,
          txSignature: signed.signature,
        }),
      });

      saveLocalWalletActivity(user.solanaAddress, {
        id: Date.now(),
        kind: 'withdraw',
        title: `Withdrew ${amt} ${withdrawAsset === 'bits' ? 'Bits' : 'Bitnoir'} Onchain`,
        detail: `Onchain withdrawal to ${shortSolanaAddress(dest)}`,
        amount: amt,
        asset: withdrawAsset,
        txHash: signed.signature,
        createdAt: new Date().toISOString(),
      });

      toast({
        title: 'Withdrawal Confirmed Onchain',
        description: `Withdrew ${amt} ${withdrawAsset === 'bits' ? 'Bits' : 'Bitnoir'} to ${shortSolanaAddress(dest)}.`,
        variant: 'success',
        icon: <ArrowUpRight size={17} />,
      });
      setWithdrawAmount('');
      setWithdrawError(null);
      setActiveActionModal(null);
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void refreshActivity();
    } catch (err) {
      const msg = readableError(err, 'Could not complete onchain withdrawal.');
      setWithdrawError(msg);
      toast({ title: 'Withdrawal Failed', description: msg, variant: 'destructive' });
    } finally {
      setIsWithdrawing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans">
      {/* HEADER */}
      <header className="border-b border-white/[0.08] bg-[#09090b]/85 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Brand size="md" />
          <div className="flex items-center gap-3">
            <TopWalletConnect
              onOpenVerify={() => setVerifyModalOpen(true)}
              onOpenConnect={() => setConnectModalOpen(true)}
            />
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        {/* TOP NAVIGATION & HEADING */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white m-0">Assets</h1>
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="clean-action-btn-soft !min-h-[32px] !px-3 !text-xs"
              title="Transaction History"
              aria-label="Transaction History"
            >
              <History size={14} className="text-[#f7931a]" />
              <span className="text-xs font-sans">History</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="clean-action-btn-soft !min-h-[32px] !px-3 !text-[11px]"
          >
            <ChevronLeft size={13} />
            <span>Back to Mining</span>
          </button>
        </div>

        {/* 1. TOTAL BALANCE + ONCHAIN ACTION BAR (SEND · RECEIVE · WITHDRAW) */}
        <div className="pob-cockpit mb-6 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-bold">
                Total Balance
              </span>
            </div>
            <div className="text-3xl sm:text-4xl font-black font-mono text-white tabular-nums tracking-tight">
              ${totalUsd.toFixed(2)} <span className="text-xs text-zinc-400 font-normal">USD</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={() => openActionModal('send')}
              className="clean-stake-confirm-btn !w-auto !min-h-[40px] !px-4 !text-xs"
            >
              <ArrowUpRight size={15} />
              <span>Send</span>
            </button>
            <button
              type="button"
              onClick={() => openActionModal('receive')}
              className="clean-action-btn-soft !min-h-[40px] !px-4 !text-xs !font-bold !text-white"
            >
              <ArrowDownLeft size={15} className="text-[#34d399]" />
              <span>Receive</span>
            </button>
            <button
              type="button"
              onClick={() => openActionModal('withdraw')}
              className="clean-action-btn-soft !min-h-[40px] !px-4 !text-xs !font-bold !text-white"
            >
              <ExternalLink size={14} className="text-[#f7931a]" />
              <span>Withdraw</span>
            </button>
          </div>
        </div>

        {accountQuery.isError && (
          <div className="mb-4">
            <InlineErrorBanner
              message={readableError(accountQuery.error, 'Could not refresh wallet balances.')}
              onRetry={() => void accountQuery.refetch()}
            />
          </div>
        )}

        {/* VERIFICATION PROMPT IF USERNAME ID NOT YET UNLOCKED */}
        {!canUsernameTransfer && (
          <div className="mb-6 p-4 rounded-xl bg-[#f7931a]/[0.07] border border-[#f7931a]/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 text-xs text-zinc-300">
              <ShieldCheck size={16} className="text-[#fbbf24] mt-0.5 flex-shrink-0" />
              <div>
                <strong className="text-white block">In-App Username Transfers Locked</strong>
                Verify your wallet once (<strong className="text-[#fbbf24]">0.02 SOL</strong>) and set your <strong className="text-white">@username</strong> ID to send and receive Bits in-app between usernames.
              </div>
            </div>
            <button
              type="button"
              onClick={() => (!isConnected ? setConnectModalOpen(true) : setVerifyModalOpen(true))}
              className="clean-stake-confirm-btn !w-full sm:!w-auto !min-h-[36px] !px-4 !text-xs !font-bold flex-shrink-0"
            >
              {!isConnected ? 'Connect Wallet' : !isVerified ? 'Verify (0.02 SOL)' : 'Set @username'}
            </button>
          </div>
        )}

        {/* 2. EXACT TWO CORE ASSETS (CLEAN, NO BOTTOM SEND/RECEIVE/SWAP PANEL) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* BITS */}
          <div className="p-5 rounded-2xl bg-[#121318] border border-white/[0.08] hover:border-[#f7931a]/30 transition-all duration-200 flex items-center justify-between shadow-[0_12px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="flex items-center gap-3.5">
              <BitsMark size={36} />
              <div>
                <div className="text-xs font-mono uppercase text-zinc-400 font-bold mb-0.5">Bits</div>
                <div className="text-xl sm:text-2xl font-black font-mono text-white tabular-nums">
                  {bitsPurchased.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </div>
              </div>
            </div>
            <span className="text-xs font-mono text-zinc-400 font-bold tabular-nums">
              ${(bitsPurchased * 0.1).toFixed(2)}
            </span>
          </div>

          {/* BITNOIR */}
          <div className="p-5 rounded-2xl bg-[#121318] border border-white/[0.08] hover:border-[#f7931a]/30 transition-all duration-200 flex items-center justify-between shadow-[0_12px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="flex items-center gap-3.5">
              <BitnoirMark size={36} />
              <div>
                <div className="text-xs font-mono uppercase text-zinc-400 font-bold mb-0.5">Bitnoir</div>
                <div className="text-xl sm:text-2xl font-black font-mono text-white tabular-nums">
                  {noirClaimed.toFixed(4)}
                </div>
              </div>
            </div>
            <span className="text-xs font-mono text-zinc-400 font-bold tabular-nums">
              ${(noirClaimed * 1.10).toFixed(2)}
            </span>
          </div>
        </div>

        {/* MODAL: IN-APP SEND (USERNAME-TO-USERNAME BITS & BITNOIR) */}
        {activeActionModal === 'send' && (
          <div className="modal-backdrop" onClick={() => setActiveActionModal(null)}>
            <div
              className="modal-dialog"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: 460,
                padding: 24,
                background: 'linear-gradient(180deg, #15171e 0%, #0d0e13 100%)',
                borderColor: 'rgba(247, 147, 26, 0.25)',
                boxShadow: '0 24px 70px rgba(0, 0, 0, 0.88), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
                borderRadius: 20,
              }}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#f7931a]/15 border border-[#f7931a]/35 flex items-center justify-center text-[#f7931a]">
                    <ArrowUpRight size={18} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white m-0">Send</h2>
                    <p className="text-[11px] font-mono text-zinc-400 m-0">In-App Username-to-Username Transfer</p>
                  </div>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => setActiveActionModal(null)}>
                  <X size={16} />
                </button>
              </div>

              {!canUsernameTransfer ? (
                <div className="flex flex-col gap-3">
                  <div className="p-4 rounded-xl bg-[#f7931a]/[0.08] border border-[#f7931a]/30 text-xs text-zinc-200 leading-relaxed">
                    <strong className="text-white block mb-1">Verification &amp; @username ID Required</strong>
                    Verify your wallet once (<strong className="text-[#fbbf24]">0.02 SOL</strong>) and set your <strong className="text-white">@username</strong> to send Bits &amp; Bitnoir in-app.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveActionModal(null);
                      if (!isConnected) setConnectModalOpen(true);
                      else setVerifyModalOpen(true);
                    }}
                    className="clean-stake-confirm-btn !w-full !min-h-[42px] !text-xs !font-bold"
                  >
                    <ShieldCheck size={15} />
                    <span>{!isConnected ? 'Connect Solana Wallet' : !isVerified ? 'Verify Wallet (0.02 SOL)' : 'Set @username'}</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <InlineErrorBanner message={sendError} />

                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between text-xs font-mono">
                    <span className="text-zinc-400">From Node ID</span>
                    <span className="text-[#34d399] font-bold flex items-center gap-1">
                      @{user?.username} <Check size={12} strokeWidth={3} />
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSendAsset('bits');
                        if (sendError) setSendError(null);
                      }}
                      className={`flex-1 px-3 py-2 rounded-lg border text-xs font-bold font-mono transition-all duration-200 cursor-pointer tabular-nums ${
                        sendAsset === 'bits'
                          ? 'bg-[#f7931a]/15 border-[#f7931a] text-[#fbbf24]'
                          : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white'
                      }`}
                    >
                      Bits ({bitsPurchased.toLocaleString(undefined, { maximumFractionDigits: 4 })})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSendAsset('bitnoir');
                        if (sendError) setSendError(null);
                      }}
                      className={`flex-1 px-3 py-2 rounded-lg border text-xs font-bold font-mono transition-all duration-200 cursor-pointer tabular-nums ${
                        sendAsset === 'bitnoir'
                          ? 'bg-[#f7931a]/15 border-[#f7931a] text-[#fbbf24]'
                          : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white'
                      }`}
                    >
                      Bitnoir ({noirClaimed.toFixed(2)})
                    </button>
                  </div>

                  <div>
                    <input
                      type="text"
                      placeholder="Recipient @username"
                      value={sendRecipient}
                      onChange={(e) => {
                        setSendRecipient(e.target.value);
                        if (sendError) setSendError(null);
                      }}
                      className="assets-input-field font-mono text-xs"
                    />
                    {cleanRecipientInput && (
                      <div className="mt-1.5 text-[11px] font-mono">
                        {isRecipientHandleValid ? (
                          <span className="text-[#34d399]">@{resolvedRecipientHandle} · In-App ID</span>
                        ) : (
                          <span className="text-zinc-400">Use 3-20 chars (@username)</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0.00"
                      value={sendAmount}
                      onChange={(e) => {
                        setSendAmount(e.target.value);
                        if (sendError) setSendError(null);
                      }}
                      className="assets-input-field font-mono font-bold pr-16"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setSendAmount(String(sendAsset === 'bits' ? bitsPurchased : noirClaimed));
                        if (sendError) setSendError(null);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded bg-white/10 text-[10px] font-mono font-bold text-white hover:bg-white/20 transition-colors cursor-pointer"
                    >
                      MAX
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleInAppSend}
                    disabled={isSending}
                    className="clean-stake-confirm-btn !w-full !min-h-[42px] !text-xs !font-bold"
                  >
                    {isSending ? (
                      <span className="flex items-center gap-2 justify-center">
                        <RefreshCw size={14} className="animate-spin" /> Sending…
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 justify-center">
                        <Send size={14} /> Send {sendAsset === 'bits' ? 'Bits' : 'Bitnoir'}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MODAL: IN-APP RECEIVE (@USERNAME ONLY — NO SOLANA ADDRESS DISCLOSED) */}
        {activeActionModal === 'receive' && (
          <div className="modal-backdrop" onClick={() => setActiveActionModal(null)}>
            <div
              className="modal-dialog"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: 440,
                padding: 24,
                background: 'linear-gradient(180deg, #15171e 0%, #0d0e13 100%)',
                borderColor: 'rgba(16, 185, 129, 0.25)',
                boxShadow: '0 24px 70px rgba(0, 0, 0, 0.88), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
                borderRadius: 20,
              }}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#10b981]/15 border border-[#10b981]/35 flex items-center justify-center text-[#34d399]">
                    <QrCode size={18} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white m-0">Receive</h2>
                    <p className="text-[11px] font-mono text-zinc-400 m-0">In-App Username Transfer</p>
                  </div>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => setActiveActionModal(null)}>
                  <X size={16} />
                </button>
              </div>

              {!isConnected ? (
                <div className="flex flex-col gap-3">
                  <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 text-xs text-zinc-300">
                    Connect your wallet and verify your @username ID to receive in-app transfers.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveActionModal(null);
                      setConnectModalOpen(true);
                    }}
                    className="clean-stake-confirm-btn !w-full !min-h-[42px] !text-xs !font-bold"
                  >
                    <Wallet size={15} />
                    <span>Connect Solana Wallet</span>
                  </button>
                </div>
              ) : !canUsernameTransfer ? (
                <div className="flex flex-col gap-3">
                  <div className="p-4 rounded-xl bg-[#f7931a]/[0.08] border border-[#f7931a]/30 text-xs text-zinc-200 leading-relaxed">
                    <strong className="text-white block mb-1">Verified @username Required</strong>
                    Verify once (<strong className="text-[#fbbf24]">0.02 SOL</strong>) and set your <strong className="text-white">@username</strong> ID to receive Bits &amp; Bitnoir in-app.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveActionModal(null);
                      setVerifyModalOpen(true);
                    }}
                    className="clean-stake-confirm-btn !w-full !min-h-[42px] !text-xs !font-bold"
                  >
                    <ShieldCheck size={15} />
                    <span>{!isVerified ? 'Verify Wallet (0.02 SOL)' : 'Set @username'}</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="p-3 bg-white rounded-xl shadow-md flex items-center justify-center">
                    <SolanaAddressQr address={`@${user?.username}`} />
                  </div>

                  <div className="w-full p-3.5 rounded-xl bg-[#10b981]/10 border border-[#10b981]/30 flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-mono uppercase text-zinc-400 block">In-App Receive ID</span>
                      <strong className="font-mono text-base text-[#34d399]">@{user?.username}</strong>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await copyToClipboard(`@${user?.username}`);
                        if (ok) {
                          setCopiedHandle(true);
                          setTimeout(() => setCopiedHandle(false), 1800);
                          toast({
                            title: 'Copied',
                            description: `@${user?.username} copied.`,
                            variant: 'success',
                            icon: <Copy size={16} />,
                          });
                        } else {
                          toast({ title: 'Copy Failed', description: 'Clipboard permission unavailable.', variant: 'destructive' });
                        }
                      }}
                      className="clean-action-btn-soft !min-h-[32px] !px-3 !text-xs"
                    >
                      {copiedHandle ? <Check size={13} className="text-[#34d399]" /> : <Copy size={13} />}
                      <span>{copiedHandle ? 'Copied' : 'Copy ID'}</span>
                    </button>
                  </div>

                  <p className="text-[11px] font-mono text-zinc-400 text-center m-0">
                    Share your <strong className="text-white">@{user?.username}</strong> ID to receive instant in-app transfers.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MODAL: ONCHAIN WITHDRAW */}
        {activeActionModal === 'withdraw' && (
          <div className="modal-backdrop" onClick={() => setActiveActionModal(null)}>
            <div
              className="modal-dialog"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: 460,
                padding: 24,
                background: 'linear-gradient(180deg, #15171e 0%, #0d0e13 100%)',
                borderColor: 'rgba(247, 147, 26, 0.3)',
                boxShadow: '0 24px 70px rgba(0, 0, 0, 0.88), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
                borderRadius: 20,
              }}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#f7931a]/15 border border-[#f7931a]/35 flex items-center justify-center text-[#f7931a]">
                    <ExternalLink size={18} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white m-0">Withdraw Onchain</h2>
                    <p className="text-[11px] font-mono text-zinc-400 m-0">Settle directly to external Solana wallet</p>
                  </div>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => setActiveActionModal(null)}>
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-col gap-4">
                <InlineErrorBanner message={withdrawError} />

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setWithdrawAsset('bitnoir');
                      if (withdrawError) setWithdrawError(null);
                    }}
                    className={`flex-1 px-3 py-2 rounded-lg border text-xs font-bold font-mono transition-all duration-200 cursor-pointer tabular-nums ${
                      withdrawAsset === 'bitnoir'
                        ? 'bg-[#f7931a]/15 border-[#f7931a] text-[#fbbf24]'
                        : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white'
                    }`}
                  >
                    Bitnoir ({noirClaimed.toFixed(2)})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWithdrawAsset('bits');
                      if (withdrawError) setWithdrawError(null);
                    }}
                    className={`flex-1 px-3 py-2 rounded-lg border text-xs font-bold font-mono transition-all duration-200 cursor-pointer tabular-nums ${
                      withdrawAsset === 'bits'
                        ? 'bg-[#f7931a]/15 border-[#f7931a] text-[#fbbf24]'
                        : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white'
                    }`}
                  >
                    Bits ({bitsPurchased.toLocaleString(undefined, { maximumFractionDigits: 4 })})
                  </button>
                </div>

                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-bold block mb-1.5">
                    Destination Solana Address
                  </label>
                  <input
                    type="text"
                    placeholder="Solana wallet address (base58)"
                    value={withdrawAddress}
                    onChange={(e) => {
                      setWithdrawAddress(e.target.value);
                      if (withdrawError) setWithdrawError(null);
                    }}
                    className="assets-input-field font-mono text-xs"
                  />
                </div>

                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={withdrawAmount}
                    onChange={(e) => {
                      setWithdrawAmount(e.target.value);
                      if (withdrawError) setWithdrawError(null);
                    }}
                    className="assets-input-field font-mono font-bold pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setWithdrawAmount(String(withdrawAsset === 'bits' ? bitsPurchased : noirClaimed));
                      if (withdrawError) setWithdrawError(null);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded bg-white/10 text-[10px] font-mono font-bold text-white hover:bg-white/20 transition-colors cursor-pointer"
                  >
                    MAX
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleOnchainWithdraw}
                  disabled={isWithdrawing}
                  className="clean-stake-confirm-btn !w-full !min-h-[42px] !text-xs !font-bold"
                >
                  {isWithdrawing ? (
                    <span className="flex items-center gap-2 justify-center">
                      <RefreshCw size={14} className="animate-spin" /> Settling Onchain…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 justify-center">
                      <ExternalLink size={14} /> Confirm Onchain Withdraw
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TRANSACTION HISTORY MODAL (OPENED FROM TOP ICON) */}
        {historyOpen && (
          <div className="modal-backdrop" onClick={() => setHistoryOpen(false)}>
            <div
              className="modal-dialog"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: 480,
                padding: 24,
                background: 'linear-gradient(180deg, #15171e 0%, #0d0e13 100%)',
                borderColor: 'rgba(247, 147, 26, 0.25)',
                boxShadow: '0 24px 70px rgba(0, 0, 0, 0.88), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
                borderRadius: 20,
              }}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#f7931a]/15 border border-[#f7931a]/30 flex items-center justify-center text-[#f7931a]">
                    <History size={16} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white m-0">Transaction History</h2>
                    <p className="text-[11px] font-mono text-zinc-400 m-0">Wallet &amp; transfer activity</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  className="modal-close-btn"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1">
                {activitiesError && (
                  <div className="mb-2">
                    <InlineErrorBanner message={activitiesError} onRetry={() => void refreshActivity()} />
                  </div>
                )}
                {activitiesLoading && activities.length === 0 ? (
                  <div className="py-8 text-center text-zinc-400 text-xs font-mono flex items-center justify-center gap-2">
                    <RefreshCw size={14} className="animate-spin text-[#f7931a]" />
                    <span>Loading transactions…</span>
                  </div>
                ) : activities.length === 0 ? (
                  <div className="py-8 text-center text-zinc-500 text-xs font-mono">
                    No transactions recorded yet.
                  </div>
                ) : (
                  activities.map((act) => {
                    const isSend = act.kind === 'send';
                    const isWithdraw = act.kind === 'withdraw';
                    const isVerify = act.kind === 'verify' || act.kind === 'username';
                    return (
                      <div
                        key={act.id}
                        className="p-3 rounded-xl bg-white/[0.025] border border-white/[0.06] flex items-center justify-between gap-2 text-xs font-mono transition-colors hover:border-white/[0.12]"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              isSend
                                ? 'bg-red-500/15 text-red-400'
                                : isWithdraw
                                ? 'bg-[#f7931a]/15 text-[#fbbf24]'
                                : isVerify
                                ? 'bg-[#f7931a]/15 text-[#fbbf24]'
                                : 'bg-[#10b981]/15 text-[#34d399]'
                            }`}
                          >
                            {isSend ? (
                              <ArrowUpRight size={13} />
                            ) : isWithdraw ? (
                              <ExternalLink size={13} />
                            ) : isVerify ? (
                              <ShieldCheck size={13} />
                            ) : (
                              <ArrowDownLeft size={13} />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-white font-medium truncate">{act.title}</div>
                            <div className="text-[10px] text-zinc-500">
                              {new Date(act.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <ConnectWalletModal open={connectModalOpen} onClose={() => setConnectModalOpen(false)} />
      <VerifyAndUsernameModal
        open={verifyModalOpen}
        onClose={() => setVerifyModalOpen(false)}
        onOpenConnect={() => setConnectModalOpen(true)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// APPLICATION ROUTER (EXACT CLEAN ROUTES: MINING, MINERS, GUIDE, LEDGER & ASSETS)
// ---------------------------------------------------------------------------
function App() {
  const [currentView, setCurrentView] = useState<'mining' | 'assets' | 'miners' | 'guide' | 'ledger'>('mining');

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <FeedbackMonitor />
        <ErrorBoundary resetKey={currentView}>
          <WouterRouter base={basePath}>
            <Switch>
              <Route path="/assets">
                {() => <AssetsPage onBack={() => setCurrentView('mining')} />}
              </Route>
              <Route path="/miners">
                {() => <MinersPage onBack={() => setCurrentView('mining')} />}
              </Route>
              <Route path="/guide">
                {() => <GuidePage onBack={() => setCurrentView('mining')} />}
              </Route>
              <Route path="/ledger">
                {() => <LedgerPage onBack={() => setCurrentView('mining')} />}
              </Route>
              <Route path="/mining">
                {() => (
                  <MiningPage
                    onOpenAssets={() => setCurrentView('assets')}
                    onOpenMiners={() => setCurrentView('miners')}
                    onOpenGuide={() => setCurrentView('guide')}
                    onOpenLedger={() => setCurrentView('ledger')}
                  />
                )}
              </Route>
              <Route path="/">
                {() =>
                  currentView === 'assets' ? (
                    <AssetsPage onBack={() => setCurrentView('mining')} />
                  ) : currentView === 'miners' ? (
                    <MinersPage onBack={() => setCurrentView('mining')} />
                  ) : currentView === 'guide' ? (
                    <GuidePage onBack={() => setCurrentView('mining')} />
                  ) : currentView === 'ledger' ? (
                    <LedgerPage onBack={() => setCurrentView('mining')} />
                  ) : (
                    <MiningPage
                      onOpenAssets={() => setCurrentView('assets')}
                      onOpenMiners={() => setCurrentView('miners')}
                      onOpenGuide={() => setCurrentView('guide')}
                      onOpenLedger={() => setCurrentView('ledger')}
                    />
                  )
                }
              </Route>
              <Route component={() =>
                currentView === 'assets' ? (
                  <AssetsPage onBack={() => setCurrentView('mining')} />
                ) : currentView === 'miners' ? (
                  <MinersPage onBack={() => setCurrentView('mining')} />
                ) : currentView === 'guide' ? (
                  <GuidePage onBack={() => setCurrentView('mining')} />
                ) : currentView === 'ledger' ? (
                  <LedgerPage onBack={() => setCurrentView('mining')} />
                ) : (
                  <MiningPage
                    onOpenAssets={() => setCurrentView('assets')}
                    onOpenMiners={() => setCurrentView('miners')}
                    onOpenGuide={() => setCurrentView('guide')}
                    onOpenLedger={() => setCurrentView('ledger')}
                  />
                )
              } />
            </Switch>
          </WouterRouter>
        </ErrorBoundary>
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
