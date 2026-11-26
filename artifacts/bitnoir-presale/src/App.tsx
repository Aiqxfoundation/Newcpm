import { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  ConnectionProvider,
  WalletProvider,
  useConnection,
  useWallet,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider, useWalletModal } from '@solana/wallet-adapter-react-ui';
import { WalletAdapterNetwork, type WalletError } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { CoinbaseWalletAdapter } from '@solana/wallet-adapter-coinbase';
import { TrustWalletAdapter } from '@solana/wallet-adapter-trust';
import {
  AlertTriangle, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight,
  Copy, Lock, RefreshCw,
  ScrollText, Send, ShieldCheck, Wallet, X, Zap
} from 'lucide-react';
import {
  getGetMyAccountQueryKey, getGetMyActivityQueryKey, useGetMyAccount,
} from '@workspace/api-client-react';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/hooks/use-toast';
import {
  bytesToBase64,
  calculateSolPowerBoost,
  claimLocalUniqueUid,
  classifyWalletError,
  extractSignatureBytes,
  getLocalWalletActivities,
  getPhantomSolanaProvider,
  getWalletMiningState,
  isUserRejectionError,
  isValidSolanaAddress,
  isValidUidFormat,
  normalizeUidInput,
  PROTOCOL_TREASURY_SOLANA,
  registerVerifiedUid,
  safeStorageGet,
  safeStorageRemove,
  safeStorageSet,
  saveLocalWalletActivity,
  saveWalletMiningState,
  sendSolanaTransactionOnchain,
  SOL_POWER_MAX_RATE_PER_HOUR,
  SOL_POWER_MAX_SOL,
  SOLANA_COMMITMENT,
  SOLANA_RPC_ENDPOINT,
  VERIFICATION_FEE_SOL,
} from './lib/solana';
import {
  activatePowerCard,
  ANT_CARD_ID,
  AURA_CARD_ID,
  DRAGON_CARD_ID,
  formatPowerCardDurationShort,
  getActivePowerCardDef,
  getCardPowerBoostPerHour,
  getPowerCardRemainingMs,
  getWalletPowerCards,
  hasActiveAntCard,
  hasAnyActivePowerCard,
  hasUnlockedAuraCardBefore,
  hasUnlockedDragonCardBefore,
  hasUnlockedGenesisAntCardBefore,
  hasUnlockedPhoenixCardBefore,
  hasUnlockedSirenCardBefore,
  hasUnlockedSpiderCardBefore,
  isPowerCardActive,
  PHOENIX_CARD_ID,
  POWER_CARD_CATALOG,
  SIREN_CARD_ID,
  SPIDER_CARD_ID,
  unlockAuraCardOnTenVerifiedActiveMiners,
  unlockDragonCardOnSolPower,
  unlockGenesisAntCardOnStartMining,
  unlockPhoenixCardOnThreeVerifiedMiners,
  unlockSirenCardOnMinersPower,
  unlockSpiderCardOnVerifiedUid,
  type ReceivedPowerCard,
} from './lib/powerCards';
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

  const classified = classifyWalletError(error, 'Request');
  if (classified?.message) {
    return classified.message;
  }

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
    return 'Request timed out. Please try again.';
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(trimmed)) {
    return 'Network connection lost. Please check your internet and try again.';
  }
  // Never expose raw HTML error pages or stack traces in user-facing alerts
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.length > 220) {
    return fallback;
  }
  return trimmed;
}

// Strictly in-memory session token (never persisted to localStorage/sessionStorage)
let activeAuthBearerToken = '';

function setInMemoryAuthToken(token: string) {
  activeAuthBearerToken = token || '';
}

async function apiFetchJson<T = any>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(options.headers || undefined);
    if (activeAuthBearerToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${activeAuthBearerToken}`);
    }
    const res = await fetch(url, {
      ...options,
      headers,
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
      if (res.status === 401 && activeAuthBearerToken && !url.includes('/api/auth/verify')) {
        activeAuthBearerToken = '';
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('bitnoir-auth-cleared'));
        }
      }
      const statusFallback =
        res.status === 401
          ? 'Please sign in with your Solana wallet signature first.'
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
      className="px-4 py-3 rounded-lg bg-[#1c1c1c] border border-red-500/30 flex items-center justify-between gap-3 text-xs text-zinc-200"
    >
      <div className="flex items-start gap-2 min-w-0">
        <AlertTriangle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
        <span className="leading-relaxed break-words">{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-semibold text-[#f59e0b] hover:text-[#fbbf24] bg-transparent border-0 px-1 py-0.5 flex-shrink-0 cursor-pointer transition-colors"
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
      toast({ description, variant: 'destructive' });
    };
    const unsubscribeQueries = client.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        showError(event.query.state.error, 'Unable to load data. Please try again.');
      }
    });
    const unsubscribeMutations = client.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      if (event.action.type === 'error') {
        showError(event.mutation.state.error, 'Unable to complete this action. Please try again.');
      }
    });
    const onError = (event: ErrorEvent) => showError(event.error || event.message, 'An unexpected error occurred. Please try again.');
    const onRejection = (event: PromiseRejectionEvent) => showError(event.reason, 'An unexpected error occurred. Please try again.');
    const onOffline = () => {
      toast({
        description: 'Connection lost. Check your internet and try again.',
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
const Brand = memo(function Brand({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const textSize = size === 'sm' ? 18 : size === 'lg' ? 26 : 22;

  return (
    <div className="flex items-center select-none" style={{ fontSize: textSize }}>
      <span className="font-sans font-extrabold tracking-tight text-white">
        Bit<span className="text-[#f7931a]">noir</span>
      </span>
    </div>
  );
});

const BITS_LOGO_96 = '/assets/aistudio/bits-logo-96.png';
const BITS_LOGO_144 = '/assets/aistudio/bits-logo-144.png';
const BITS_LOGO_256 = '/assets/aistudio/bits-logo-256.png';
const BITS_LOGO_FULL = '/assets/aistudio/file_0000000071f8820880f6865e316e2a08_5b35eeb9.png';

const BitsMark = memo(function BitsMark({ size = 28, className = '' }: { size?: number; className?: string }) {
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
});

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

const MiningPickaxeIcon = memo(function MiningPickaxeIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={`flex-shrink-0 ${className}`}
      aria-hidden="true"
    >
      <g transform="rotate(45 12 12)">
        {/* Curved double-pointed pickaxe blade */}
        <path d="M -0.6 9.6 Q 12 -0.6 24.6 9.6 Q 12 4.4 -0.6 9.6 Z" />
        {/* Pickaxe socket collar */}
        <rect x="9.5" y="2.9" width="5" height="5.2" rx="0.85" />
        {/* Pickaxe handle separated by crisp gap */}
        <path d="M 10.5 9.1 H 13.5 V 24.3 A 1.5 1.5 0 0 1 10.5 24.3 Z" />
      </g>
    </svg>
  );
});

const BitcoinMark = memo(function BitcoinMark({
  size = 32,
  active = false,
  className = '',
}: {
  size?: number;
  active?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const coinGradId = `btc-coin-${uid}`;
  const rimGradId = `btc-rim-${uid}`;
  const glyphGradId = `btc-glyph-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`inline-block flex-shrink-0 select-none transition-all duration-300 ${
        active
          ? 'drop-shadow-[0_2px_8px_rgba(247,147,26,0.18)]'
          : 'drop-shadow-[0_2px_6px_rgba(0,0,0,0.65)]'
      } ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={coinGradId} x1="10" y1="6" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          {active ? (
            <>
              <stop offset="0%" stopColor="#2b1e0e" />
              <stop offset="55%" stopColor="#23180b" />
              <stop offset="100%" stopColor="#1b1309" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#262626" />
              <stop offset="55%" stopColor="#1a1a1a" />
              <stop offset="100%" stopColor="#121212" />
            </>
          )}
        </linearGradient>
        <linearGradient id={rimGradId} x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          {active ? (
            <>
              <stop offset="0%" stopColor="#f7931a" stopOpacity="0.52" />
              <stop offset="100%" stopColor="#f7931a" stopOpacity="0.28" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.06" />
            </>
          )}
        </linearGradient>
        <linearGradient id={glyphGradId} x1="20" y1="14" x2="44" y2="50" gradientUnits="userSpaceOnUse">
          {active ? (
            <>
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#f7931a" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#a1a1aa" />
              <stop offset="100%" stopColor="#71717a" />
            </>
          )}
        </linearGradient>
      </defs>

      {/* Outer precision coin body */}
      <circle
        cx="32"
        cy="32"
        r="30"
        fill={`url(#${coinGradId})`}
        stroke={`url(#${rimGradId})`}
        strokeWidth="1.6"
      />

      {/* Subtle inner milled coin ring */}
      <circle
        cx="32"
        cy="32"
        r="26.2"
        fill="none"
        stroke={active ? 'rgba(247, 147, 26, 0.18)' : 'rgba(255, 255, 255, 0.06)'}
        strokeWidth="0.9"
      />

      {/* Official Bitcoin emblem geometry */}
      <path
        d="M46.103 27.444c.637-4.258-2.605-6.547-7.038-8.074l1.438-5.768-3.511-.875-1.4 5.616c-.923-.23-1.87-.447-2.813-.662l1.41-5.653-3.509-.875-1.439 5.766c-.764-.174-1.514-.346-2.242-.527l.004-.018-4.842-1.209-.934 3.75s2.605.597 2.55.634c1.422.355 1.679 1.296 1.636 2.042l-1.638 6.571c.098.025.225.061.365.117-.117-.029-.242-.061-.371-.092l-2.296 9.205c-.174.432-.615 1.08-1.609.834.035.051-2.552-.637-2.552-.637l-1.743 4.019 4.569 1.139c.85.213 1.683.436 2.503.646l-1.453 5.834 3.507.875 1.439-5.772c.958.26 1.888.5 2.798.726l-1.434 5.745 3.511.875 1.453-5.823c5.987 1.133 10.489.676 12.384-4.739 1.527-4.36-.076-6.875-3.226-8.515 2.294-.529 4.022-2.038 4.483-5.155zm-8.022 11.249c-1.085 4.36-8.426 2.003-10.806 1.412l1.928-7.729c2.38.594 10.012 1.77 8.878 6.317zm1.086-11.312c-.99 3.966-7.1 1.951-9.082 1.457l1.748-7.01c1.982.494 8.365 1.416 7.334 5.553z"
        fill={`url(#${glyphGradId})`}
      />
    </svg>
  );
});

function shortSolanaAddress(addr: string): string {
  if (!addr) return '';
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// SOLANA WALLET KIT PROVIDER & AUTH CONTEXT (WALLET STANDARD + ADAPTERS)
// ---------------------------------------------------------------------------
function SolanaWalletKitProvider({ children }: { children: ReactNode }) {
  const endpoint = SOLANA_RPC_ENDPOINT;
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network: WalletAdapterNetwork.Testnet }),
      new TrustWalletAdapter(),
      new CoinbaseWalletAdapter(),
    ],
    [],
  );

  const handleWalletError = useCallback((error: WalletError) => {
    const name = String(error?.name || '');
    const msg = String(error?.message || '');
    // Ignore background autoConnect noise and signing/tx errors already surfaced by modal handlers
    if (
      name === 'WalletNotReadyError' ||
      name === 'WalletWindowClosedError' ||
      name === 'WalletSendTransactionError' ||
      name === 'WalletSignTransactionError' ||
      name === 'WalletSignMessageError' ||
      name === 'WalletSignInError' ||
      isUserRejectionError(error) ||
      /not installed|not detected/i.test(msg)
    ) {
      return;
    }
    toast({
      description: readableError(error, 'Unable to connect Solana wallet.'),
      variant: 'destructive',
    });
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: SOLANA_COMMITMENT }}>
      <WalletProvider wallets={wallets} autoConnect onError={handleWalletError}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

type AuthUser = {
  id: string;
  solanaAddress: string;
  name: string;
  uid: string;
  email: string;
  isAdmin?: boolean;
  isVerified: boolean;
  verifiedTx?: string;
};

const AuthContext = createContext<{
  user: AuthUser | null;
  ready: boolean;
  connecting: boolean;
  isSignedIn: boolean;
  signingIn: boolean;
  walletName: string;
  openWalletModal: () => void;
  connectWallet: () => Promise<string>;
  signInWallet: () => Promise<boolean>;
  ensureSignedIn: () => Promise<boolean>;
  disconnectWallet: () => Promise<void>;
  verifyWalletOnchain: () => Promise<{ signature: string; uid: string }>;
}>({
  user: null,
  ready: false,
  connecting: false,
  isSignedIn: false,
  signingIn: false,
  walletName: '',
  openWalletModal: () => undefined,
  connectWallet: async () => '',
  signInWallet: async () => false,
  ensureSignedIn: async () => false,
  disconnectWallet: async () => undefined,
  verifyWalletOnchain: async () => ({ signature: '', uid: '' }),
});

function buildAuthUserFromAddress(address: string, legacyUsername?: string): AuthUser {
  const isVer = safeStorageGet(`bitnoir-verified-${address}`) === 'true';
  const verTx = safeStorageGet(`bitnoir-verified-tx-${address}`) || undefined;
  let uid = '';
  if (isVer) {
    const savedUid = safeStorageGet(`bitnoir-uid-${address}`) || '';
    uid = claimLocalUniqueUid(address, isValidUidFormat(savedUid) ? savedUid : undefined);
    safeStorageSet(`bitnoir-uid-${address}`, uid);
    registerVerifiedUid(uid, address);
    unlockSpiderCardOnVerifiedUid(address);
  }
  void legacyUsername;
  return {
    id: address,
    solanaAddress: address,
    uid,
    name: uid ? `UID ${uid}` : 'Wallet',
    email: uid ? `${uid}@bitnoir.io` : '',
    isAdmin: false,
    isVerified: isVer,
    verifiedTx: verTx,
  };
}

function readSavedAuthUser(): AuthUser | null {
  const walletAdapterName = safeStorageGet('walletName');
  const saved = safeStorageGet('bitnoir-solana-address');
  const legacyUser = safeStorageGet('bitnoir-username');
  if (!walletAdapterName || !saved || saved === PROTOCOL_TREASURY_SOLANA || legacyUser === 'satoshinode') {
    return null;
  }
  if (!isValidSolanaAddress(saved)) return null;
  return buildAuthUserFromAddress(saved, legacyUser || undefined);
}

function AuthProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const {
    publicKey,
    connected,
    connecting,
    wallet,
    connect: adapterConnect,
    disconnect: adapterDisconnect,
    signTransaction,
    sendTransaction,
    signMessage,
    signIn: adapterSignIn,
  } = useWallet();
  const { setVisible } = useWalletModal();

  const [user, setUser] = useState<AuthUser | null>(() => readSavedAuthUser());
  const [ready, setReady] = useState<boolean>(false);
  const [signedInAddress, setSignedInAddress] = useState<string>('');
  const [signingIn, setSigningIn] = useState<boolean>(false);

  const wasConnectedRef = useRef(false);
  const userInitiatedRef = useRef(false);
  const lastSyncedAddrRef = useRef<string>('');
  const signedAddressRef = useRef<string>('');
  const signInPromiseRef = useRef<{ address: string; promise: Promise<boolean> } | null>(null);

  const clearSignedSession = useCallback((notifyBackend = false) => {
    const oldToken = activeAuthBearerToken;
    setInMemoryAuthToken('');
    signedAddressRef.current = '';
    setSignedInAddress('');
    if (notifyBackend && oldToken) {
      void fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${oldToken}` },
      }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const onAuthCleared = () => {
      signedAddressRef.current = '';
      setSignedInAddress('');
    };
    window.addEventListener('bitnoir-auth-cleared', onAuthCleared);
    return () => window.removeEventListener('bitnoir-auth-cleared', onAuthCleared);
  }, []);

  const syncBackendSession = useCallback(async (payload: {
    solanaAddress?: string;
    isVerified?: boolean;
    verifiedTx?: string;
    uid?: string;
    legacyUsername?: string;
    reset?: boolean;
  }) => {
    try {
      const pendingRef = payload.reset ? undefined : safeStorageGet('bitnoir-pending-ref') || undefined;
      const res = await apiFetchJson<{ account?: { uid?: string; isVerified?: boolean } }>(
        '/api/accounts/me/sync-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pendingRef ? { ...payload, referredBy: pendingRef } : payload),
        },
      );
      if (payload.solanaAddress && res?.account?.isVerified && res.account.uid) {
        const syncedUid = normalizeUidInput(res.account.uid);
        if (isValidUidFormat(syncedUid)) {
          safeStorageSet(`bitnoir-uid-${payload.solanaAddress}`, syncedUid);
          registerVerifiedUid(syncedUid, payload.solanaAddress);
          unlockSpiderCardOnVerifiedUid(payload.solanaAddress);
          setUser((prev) =>
            prev && prev.solanaAddress === payload.solanaAddress && prev.uid !== syncedUid
              ? { ...prev, uid: syncedUid, name: `UID ${syncedUid}`, isVerified: true }
              : prev,
          );
        }
      } else if (payload.solanaAddress && res?.account && !res.account.isVerified && payload.isVerified) {
        safeStorageRemove(`bitnoir-verified-${payload.solanaAddress}`);
        safeStorageRemove(`bitnoir-verified-tx-${payload.solanaAddress}`);
        safeStorageRemove(`bitnoir-uid-${payload.solanaAddress}`);
        setUser((prev) =>
          prev && prev.solanaAddress === payload.solanaAddress
            ? {
                ...prev,
                isVerified: false,
                verifiedTx: undefined,
                uid: '',
                name: shortSolanaAddress(payload.solanaAddress),
              }
            : prev,
        );
      }
    } catch (err) {
      console.warn('Session sync warning:', err);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('bitnoir-session-synced'));
    }
  }, []);

  const signInWallet = useCallback(async (): Promise<boolean> => {
    const addr = publicKey?.toBase58() || '';
    if (!connected || !addr || !isValidSolanaAddress(addr)) {
      throw new Error('Please connect your Solana wallet first.');
    }
    if (activeAuthBearerToken && signedAddressRef.current === addr) {
      return true;
    }
    if (signInPromiseRef.current && signInPromiseRef.current.address === addr) {
      return signInPromiseRef.current.promise;
    }

    const run = (async () => {
      setSigningIn(true);
      try {
        const challenge = await apiFetchJson<{
          nonce: string;
          message: string;
          domain: string;
          issuedAt: string;
        }>('/api/auth/nonce', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ solanaAddress: addr }),
        });

        let signatureBytes: Uint8Array | null = null;
        let signedMessageBytes: Uint8Array;

        const messageBytes = new TextEncoder().encode(challenge.message);

        try {
          if (signMessage) {
            const rawSig = await signMessage(messageBytes);
            signatureBytes = extractSignatureBytes(rawSig);
            signedMessageBytes = messageBytes;
          } else {
            const phantomProvider = getPhantomSolanaProvider();
            const canUsePhantomProvider =
              Boolean(phantomProvider) &&
              (!wallet?.adapter?.name || wallet.adapter.name === 'Phantom') &&
              phantomProvider.publicKey?.toBase58?.() === addr &&
              typeof phantomProvider.signMessage === 'function';

            if (canUsePhantomProvider) {
              const rawSig = await phantomProvider.signMessage(messageBytes, 'utf8');
              signatureBytes = extractSignatureBytes(rawSig);
              signedMessageBytes = messageBytes;
            } else if (adapterSignIn) {
              const siwsOut = await adapterSignIn({
                domain: (typeof window !== 'undefined' && window.location.host) || challenge.domain,
                address: addr,
                statement: 'Sign in to verify wallet ownership on Bitnoir (Solana Testnet).',
                uri: typeof window !== 'undefined' ? window.location.origin : undefined,
                version: '1',
                chainId: 'solana:testnet',
                nonce: challenge.nonce,
                issuedAt: challenge.issuedAt,
              });
              signatureBytes = extractSignatureBytes(siwsOut?.signature);
              signedMessageBytes = siwsOut?.signedMessage;
            } else {
              throw new Error(
                'This wallet does not support message signature verification. Please use Phantom or Solflare.',
              );
            }
          }
        } catch (signErr: unknown) {
          const classified = classifyWalletError(signErr, 'Signature');
          if (classified) throw classified;
          if (signErr instanceof Error) throw signErr;
          throw new Error('Unable to sign wallet verification message.');
        }

        if (!signatureBytes || signatureBytes.length !== 64 || !signedMessageBytes?.length) {
          throw new Error('Wallet returned an invalid ownership signature.');
        }

        const verified = await apiFetchJson<{
          success: boolean;
          token: string;
          address: string;
        }>('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            solanaAddress: addr,
            nonce: challenge.nonce,
            signatureBase64: bytesToBase64(signatureBytes),
            signedMessageBase64: bytesToBase64(signedMessageBytes),
          }),
        });

        if (!verified?.token) {
          throw new Error('Wallet signature verification did not return a valid session.');
        }

        setInMemoryAuthToken(verified.token);
        signedAddressRef.current = addr;
        setSignedInAddress(addr);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('bitnoir-session-synced'));
        }
        toast({
          description: 'Wallet ownership verified.',
          variant: 'success',
        });
        return true;
      } finally {
        setSigningIn(false);
        if (signInPromiseRef.current?.address === addr) {
          signInPromiseRef.current = null;
        }
      }
    })();

    signInPromiseRef.current = { address: addr, promise: run };
    return run;
  }, [connected, publicKey, wallet, signMessage, adapterSignIn]);

  const ensureSignedIn = useCallback(async (): Promise<boolean> => {
    const addr = publicKey?.toBase58() || '';
    if (!connected || !addr) {
      throw new Error('Please connect your Solana wallet first.');
    }
    if (activeAuthBearerToken && signedAddressRef.current === addr) {
      return true;
    }
    return signInWallet();
  }, [connected, publicKey, signInWallet]);

  // Capture ?ref=<uid> referral attribution if present
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const refParam = new URLSearchParams(window.location.search).get('ref');
      const cleanRef = normalizeUidInput(refParam || '');
      if (cleanRef && (/^\d{6,12}$/.test(cleanRef) || /^[a-z0-9_]{3,20}$/i.test(cleanRef))) {
        safeStorageSet('bitnoir-pending-ref', cleanRef);
      }
    }
  }, []);

  // Sync real Solana Wallet Kit state into AuthUser & backend session
  useEffect(() => {
    const activeAddress = connected && publicKey ? publicKey.toBase58() : '';

    if (activeAddress && isValidSolanaAddress(activeAddress)) {
      const justJoined = lastSyncedAddrRef.current !== activeAddress;
      if (signedAddressRef.current && signedAddressRef.current !== activeAddress) {
        clearSignedSession(true);
      }
      wasConnectedRef.current = true;
      lastSyncedAddrRef.current = activeAddress;

      safeStorageSet('bitnoir-solana-address', activeAddress);
      const legacyUser = safeStorageGet('bitnoir-username');
      const legacyForWallet = safeStorageGet(`bitnoir-username-${activeAddress}`) || legacyUser || undefined;
      const authUser = buildAuthUserFromAddress(activeAddress, legacyForWallet);

      setUser(authUser);
      void syncBackendSession({
        solanaAddress: activeAddress,
        isVerified: authUser.isVerified,
        verifiedTx: authUser.verifiedTx,
        uid: authUser.uid,
        legacyUsername: legacyForWallet,
      });

      if (justJoined && userInitiatedRef.current) {
        userInitiatedRef.current = false;
        const autoTimer = window.setTimeout(() => {
          if (!activeAuthBearerToken || signedAddressRef.current !== activeAddress) {
            void signInWallet().catch((err) => {
              toast({
                description: readableError(
                  err,
                  'Please sign the message in your wallet to verify ownership.',
                ),
                variant: 'warning',
              });
            });
          }
        }, 250);
        setReady(true);
        return () => window.clearTimeout(autoTimer);
      }
      setReady(true);
      return undefined;
    }

    if (!connecting) {
      const hasSavedWalletAdapter = Boolean(safeStorageGet('walletName'));
      // Clear state if user disconnected or no real Wallet Kit adapter is active
      if (wasConnectedRef.current || !hasSavedWalletAdapter) {
        wasConnectedRef.current = false;
        lastSyncedAddrRef.current = '';
        clearSignedSession(true);
        safeStorageRemove('bitnoir-solana-address');
        safeStorageRemove('bitnoir-username');
        setUser(null);
        void syncBackendSession({ reset: true });
      }
      setReady(true);
    }
    return undefined;
  }, [connected, connecting, publicKey, syncBackendSession, clearSignedSession, signInWallet]);

  const openWalletModal = useCallback(() => {
    userInitiatedRef.current = true;
    setVisible(true);
  }, [setVisible]);

  const connectWallet = useCallback(async (): Promise<string> => {
    if (connected && publicKey) {
      return publicKey.toBase58();
    }
    userInitiatedRef.current = true;
    if (wallet) {
      try {
        await adapterConnect();
        return wallet.adapter.publicKey?.toBase58() || '';
      } catch {
        setVisible(true);
        return '';
      }
    }
    setVisible(true);
    return '';
  }, [connected, publicKey, wallet, adapterConnect, setVisible]);

  const verifyWalletOnchain = async (): Promise<{ signature: string; uid: string }> => {
    if (!user?.solanaAddress || !connected) {
      throw new Error('Please connect your Solana wallet first.');
    }
    if (user.isVerified && user.verifiedTx && user.uid) {
      return { signature: user.verifiedTx, uid: user.uid };
    }

    const signed = await ensureSignedIn();
    if (!signed) {
      throw new Error('Please sign the ownership message in your wallet before verifying.');
    }

    const result = await sendSolanaTransactionOnchain({
      fromAddress: user.solanaAddress,
      toAddress: PROTOCOL_TREASURY_SOLANA,
      amountSol: VERIFICATION_FEE_SOL,
      memo: 'Bitnoir One-Time Node Verification',
      connection,
      walletAdapterName: wallet?.adapter?.name,
      supportedTransactionVersions: wallet?.adapter?.supportedTransactionVersions,
      signTransaction,
      sendTransaction,
    });

    const sig = result.signature;
    const verifyRes = await apiFetchJson<{ uid?: string; signature?: string }>(
      '/api/accounts/me/verify-wallet',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: sig }),
      },
    );

    const assignedUid = claimLocalUniqueUid(
      user.solanaAddress,
      verifyRes?.uid && isValidUidFormat(verifyRes.uid) ? verifyRes.uid : undefined,
    );

    safeStorageSet(`bitnoir-verified-${user.solanaAddress}`, 'true');
    safeStorageSet(`bitnoir-verified-tx-${user.solanaAddress}`, sig);
    safeStorageSet(`bitnoir-uid-${user.solanaAddress}`, assignedUid);
    registerVerifiedUid(assignedUid, user.solanaAddress);
    unlockSpiderCardOnVerifiedUid(user.solanaAddress);

    saveLocalWalletActivity(user.solanaAddress, {
      id: Date.now(),
      kind: 'uid',
      title: `Verified · UID ${assignedUid} Assigned`,
      detail: `One-time wallet verification confirmed, UID ${assignedUid} assigned, and referral link activated.`,
      txHash: sig,
      createdAt: new Date().toISOString(),
    });

    setUser((prev) =>
      prev
        ? {
            ...prev,
            isVerified: true,
            verifiedTx: sig,
            uid: assignedUid,
            name: `UID ${assignedUid}`,
            email: `${assignedUid}@bitnoir.io`,
          }
        : null,
    );

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('bitnoir-session-synced'));
    }

    return { signature: sig, uid: assignedUid };
  };

  const disconnectWallet = useCallback(async () => {
    userInitiatedRef.current = false;
    wasConnectedRef.current = false;
    lastSyncedAddrRef.current = '';
    clearSignedSession(true);
    try {
      await adapterDisconnect();
    } catch {
      // Ignore adapter disconnect errors
    }
    safeStorageRemove('bitnoir-solana-address');
    safeStorageRemove('bitnoir-username');
    safeStorageRemove('walletName');
    setUser(null);
    await syncBackendSession({ reset: true });
  }, [adapterDisconnect, syncBackendSession, clearSignedSession]);

  const isSignedIn = Boolean(
    user?.solanaAddress && signedInAddress === user.solanaAddress && activeAuthBearerToken,
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        ready,
        connecting,
        isSignedIn,
        signingIn,
        walletName: wallet?.adapter?.name || '',
        openWalletModal,
        connectWallet,
        signInWallet,
        ensureSignedIn,
        disconnectWallet,
        verifyWalletOnchain,
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
// CONNECT WALLET TRIGGER (DELEGATES TO SOLANA WALLET KIT MODAL)
// ---------------------------------------------------------------------------
function ConnectWalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { openWalletModal } = useAuth();

  useEffect(() => {
    if (open) {
      openWalletModal();
      onClose();
    }
  }, [open, openWalletModal, onClose]);

  return null;
}

// ---------------------------------------------------------------------------
// ONE-TIME ONCHAIN VERIFICATION & UNIQUE UID ASSIGNMENT MODAL
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
  const { user, isSignedIn, signingIn, signInWallet, verifyWalletOnchain } = useAuth();
  const [verifying, setVerifying] = useState(false);
  const [copiedUid, setCopiedUid] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setModalError(null);
      setCopiedUid(false);
    }
  }, [open]);

  if (!open) return null;

  const isConnected = Boolean(user?.solanaAddress);
  const isVerified = Boolean(user?.isVerified);
  const hasUid = Boolean(user?.uid);
  const isComplete = isConnected && isVerified && hasUid;

  const handleSignInOwnership = async () => {
    setModalError(null);
    try {
      await signInWallet();
    } catch (err) {
      const msg = readableError(err, 'Unable to verify wallet ownership signature.');
      setModalError(msg);
      toast({
        description: msg,
        variant: 'destructive',
      });
    }
  };

  const handleVerifyTx = async () => {
    setModalError(null);
    setVerifying(true);
    try {
      const { uid } = await verifyWalletOnchain();
      toast({
        description: `Wallet verified. Your UID is ${uid}.`,
        variant: 'success',
      });
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
    } catch (err) {
      const msg = readableError(err, 'Unable to complete wallet verification.');
      setModalError(msg);
      toast({
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleCopyUid = async () => {
    if (!user?.uid) return;
    const ok = await copyToClipboard(user.uid);
    if (ok) {
      setCopiedUid(true);
      setTimeout(() => setCopiedUid(false), 1800);
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
          background: '#121212',
          borderColor: isComplete ? 'rgba(16, 185, 129, 0.28)' : 'rgba(255, 255, 255, 0.085)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.88)',
          borderRadius: 18,
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center bg-[#181818] border border-white/[0.08] ${
                isComplete ? 'text-[#34d399]' : 'text-[#f7931a]'
              }`}
            >
              <ShieldCheck size={18} />
            </div>
            <div>
              <h2 className="m-0 text-base font-extrabold text-white leading-snug">
                {isComplete ? 'Verified Account' : 'Upgrade to Verified Node'}
              </h2>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {!isComplete && (
          <>
            <p className="text-xs text-zinc-300 m-0 leading-relaxed mb-4">
              Base mining (<strong className="text-white">0.01/h · 3h</strong>) is already available. Sign a free ownership message, then verify your wallet once (requires a <strong className="text-[#fbbf24]">small one-time onchain fee</strong> to permanently prevent cloning, bots, and farming) to receive your <strong className="text-white">UID</strong> and unlock <strong className="text-[#34d399]">24-hour mining</strong>, <strong className="text-[#fbbf24]">0.1/hr base rate</strong>, and your UID referral link.
            </p>

            {/* 3-STEP PROGRESS: CONNECT -> SIGN OWNERSHIP (FREE) -> VERIFY ON-CHAIN */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4 text-[11px] font-mono">
              <div className={`px-2.5 py-2 rounded-lg border ${isConnected ? 'bg-[#10b981]/15 border-[#10b981]/40 text-[#34d399]' : 'bg-white/5 border-white/15 text-white'}`}>
                1. Connect {isConnected ? '✓' : ''}
              </div>
              <div className={`px-2.5 py-2 rounded-lg border ${isSignedIn ? 'bg-[#10b981]/15 border-[#10b981]/40 text-[#34d399]' : isConnected ? 'bg-[#f7931a]/15 border-[#f7931a]/45 text-[#fbbf24]' : 'bg-white/[0.02] border-white/10 text-zinc-500'}`}>
                2. Sign Ownership {isSignedIn ? '✓' : ''}
              </div>
              <div className={`px-2.5 py-2 rounded-lg border ${isComplete ? 'bg-[#10b981]/15 border-[#10b981]/40 text-[#34d399]' : isConnected && isSignedIn ? 'bg-[#f7931a]/15 border-[#f7931a]/45 text-[#fbbf24]' : 'bg-white/[0.02] border-white/10 text-zinc-500'}`}>
                3. Verify Fee {isComplete ? '✓' : ''}
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
        ) : !isComplete && !isSignedIn ? (
          <div className="flex flex-col gap-4">
            <div className="p-4 rounded-xl bg-[#181818] border border-white/[0.075] flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between font-mono">
                <span className="text-zinc-400 font-sans">Connected Address</span>
                <span className="text-white font-semibold">{shortSolanaAddress(user?.solanaAddress || '')}</span>
              </div>
              <div className="flex items-center justify-between font-mono">
                <span className="text-zinc-400 font-sans">Signature Fee</span>
                <span className="text-[#34d399] font-semibold">Free (Off-chain)</span>
              </div>
              <p className="text-[11px] text-zinc-400 m-0 pt-2 border-t border-white/[0.06] leading-relaxed">
                Approve the signature request in your wallet to cryptographically prove ownership of this public address before sending the Testnet verification transaction.
              </p>
            </div>

            <button
              type="button"
              disabled={signingIn}
              onClick={handleSignInOwnership}
              className="clean-stake-confirm-btn !w-full !min-h-[44px] !text-xs !font-bold"
            >
              {signingIn ? (
                <span className="flex items-center gap-2 justify-center">
                  <RefreshCw size={14} className="animate-spin" /> Waiting for Wallet Signature…
                </span>
              ) : (
                <span className="flex items-center gap-2 justify-center">
                  <Lock size={15} /> Sign In With Wallet (Free)
                </span>
              )}
            </button>
          </div>
        ) : !isComplete ? (
          <div className="flex flex-col gap-4">
            <div className="p-4 rounded-xl bg-[#181818] border border-white/[0.075] flex flex-col gap-2.5 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 font-sans">Ownership</span>
                <span className="text-[#34d399] font-semibold">Signed In ✓</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 font-sans">Network</span>
                <span className="text-[#fbbf24] font-semibold">Solana Testnet</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 font-sans">Verification Fee</span>
                <span className="text-white font-semibold tabular-nums">{VERIFICATION_FEE_SOL} SOL</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 font-sans">Treasury</span>
                <span className="text-zinc-300 tabular-nums" title={PROTOCOL_TREASURY_SOLANA}>{shortSolanaAddress(PROTOCOL_TREASURY_SOLANA)}</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                <span className="text-zinc-400 font-sans">Unlocks</span>
                <span className="text-[#34d399] font-semibold">UID · 24h · 0.1/hr</span>
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
                  <RefreshCw size={14} className="animate-spin" /> Verifying &amp; Assigning UID…
                </span>
              ) : (
                <span className="flex items-center gap-2 justify-center">
                  <ShieldCheck size={15} /> Verify Wallet
                </span>
              )}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="p-4 rounded-xl bg-[#181818] border border-white/[0.075] flex flex-col gap-3 text-xs font-mono">
              <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.06]">
                <span className="text-zinc-400 font-sans">Status</span>
                <span className="inline-flex items-center gap-1.5 text-[#34d399] font-bold">
                  <Check size={13} strokeWidth={3} />
                  Verified
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 font-sans">UID</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyUid()}
                    aria-label="Copy UID"
                    title="Copy UID"
                    className="inline-flex items-center justify-center w-6 h-6 rounded bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-zinc-200 cursor-pointer transition-colors"
                  >
                    {copiedUid ? <Check size={12} className="text-[#34d399]" /> : <Copy size={12} />}
                  </button>
                  <span className="text-[#fbbf24] font-bold tracking-wider">{user?.uid}</span>
                </div>
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
// TOP WALLET CONNECT (SOLANA WALLET KIT + VERIFICATION TRIGGER)
// ---------------------------------------------------------------------------
function TopWalletConnect({
  onOpenVerify,
}: {
  onOpenVerify?: () => void;
  onOpenConnect?: () => void;
}) {
  const { user, connecting, isSignedIn, signingIn, walletName, openWalletModal, signInWallet, disconnectWallet } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
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

  const handleSignInClick = async () => {
    try {
      await signInWallet();
    } catch (err) {
      toast({
        description: readableError(err, 'Unable to verify wallet ownership signature.'),
        variant: 'destructive',
      });
    }
  };

  if (!user || !user.solanaAddress) {
    return (
      <button
        type="button"
        onClick={openWalletModal}
        disabled={connecting}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-transparent hover:bg-[#f59e0b]/10 border border-[#f59e0b]/80 hover:border-[#fbbf24] text-[#f59e0b] hover:text-[#fbbf24] text-xs font-semibold transition-colors duration-150 cursor-pointer"
      >
        <Wallet size={14} />
        <span>{connecting ? 'Connecting…' : 'Connect'}</span>
      </button>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }} ref={dropdownRef}>
      {!isSignedIn && (
        <button
          type="button"
          disabled={signingIn}
          onClick={() => void handleSignInClick()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] bg-[#f7931a]/15 hover:bg-[#f7931a]/25 border border-[#f7931a]/45 text-[#fbbf24] text-[11px] font-semibold transition-colors cursor-pointer"
        >
          {signingIn ? <RefreshCw size={12} className="animate-spin" /> : <Lock size={12} />}
          <span>{signingIn ? 'Signing…' : 'Sign In'}</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[10px] bg-[#181818] hover:bg-[#202020] border border-white/[0.085] text-white text-xs font-mono font-medium transition-colors duration-150 cursor-pointer"
      >
        <div className="w-6 h-6 rounded-lg bg-[#121212] border border-white/[0.08] flex items-center justify-center text-[#f7931a] flex-shrink-0">
          <Wallet size={13} strokeWidth={2.2} />
        </div>
        <span className="truncate max-w-[140px]">
          {user.uid ? `UID ${user.uid}` : shortSolanaAddress(user.solanaAddress)}
        </span>
        <ChevronDown size={12} className={`text-zinc-400 transition-transform flex-shrink-0 ${menuOpen ? 'rotate-180' : ''}`} />
      </button>

      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 290,
            background: '#121212',
            border: '1px solid rgba(255, 255, 255, 0.085)',
            borderRadius: 14,
            padding: 14,
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.88)',
            zIndex: 100,
            textAlign: 'left',
          }}
        >
          {!isSignedIn && (
            <button
              type="button"
              disabled={signingIn}
              onClick={() => {
                setMenuOpen(false);
                void handleSignInClick();
              }}
              style={{
                width: '100%',
                marginBottom: 10,
                padding: '9px 11px',
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                cursor: 'pointer',
                background: 'rgba(247, 147, 26, 0.14)',
                border: '1px solid rgba(247, 147, 26, 0.4)',
                color: '#fbbf24',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <Lock size={14} />
                <span>{signingIn ? 'Signing Ownership…' : 'Sign In With Wallet (Free)'}</span>
              </span>
              <ChevronRight size={13} />
            </button>
          )}

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
                background: (!user.isVerified || !user.uid)
                  ? 'rgba(247, 147, 26, 0.12)'
                  : 'rgba(16, 185, 129, 0.1)',
                border: (!user.isVerified || !user.uid)
                  ? '1px solid rgba(247, 147, 26, 0.35)'
                  : '1px solid rgba(16, 185, 129, 0.3)',
                color: (!user.isVerified || !user.uid) ? '#fbbf24' : '#34d399',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <ShieldCheck size={14} />
                <span>
                  {(!user.isVerified || !user.uid)
                    ? 'Upgrade to 24h · Verify'
                    : 'Verified'}
                </span>
              </span>
              <ChevronRight size={13} />
            </button>
          )}

          <div style={{ padding: '9px 11px', background: '#181818', border: '1px solid rgba(255, 255, 255, 0.065)', borderRadius: 10, marginBottom: 12, fontSize: 11, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa' }}>
              <span>Wallet</span>
              <strong style={{ color: '#fff' }}>{walletName || 'Solana'} · {shortSolanaAddress(user.solanaAddress)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa' }}>
              <span>Ownership</span>
              <strong style={{ color: isSignedIn ? '#34d399' : '#f7931a' }}>
                {isSignedIn ? 'Signed In ✓' : 'Signature Required'}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa' }}>
              <span>Verification</span>
              <strong style={{ color: user.isVerified ? '#34d399' : '#f7931a' }}>
                {user.isVerified ? 'Verified' : 'Unverified'}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa' }}>
              <span>UID</span>
              <strong style={{ color: '#fff' }}>{user.uid ? user.uid : 'Not assigned'}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              className="clean-action-btn-soft !w-full !min-h-[34px] !text-xs"
              onClick={() => {
                setMenuOpen(false);
                openWalletModal();
              }}
            >
              <Wallet size={13} />
              <span>Change Wallet</span>
            </button>
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
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// STANDALONE INDEPENDENT GUIDE PAGE (CLEAN UNIFIED PREMIUM VIEW — NO GRIDS)
// ---------------------------------------------------------------------------
function GuidePage({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  const isConnected = Boolean(user?.solanaAddress);
  const isVerifiedNode = Boolean(user?.solanaAddress && user?.isVerified && user?.uid);

  const sections = [
    {
      index: '01',
      title: 'Base & Verified Mining Rates',
      metric: '0.0100 → 0.1000 /h',
      body: 'Any connected Solana wallet starts at 0.0100 Bits/hr on a 3-hour cycle. Complete one-time wallet verification (requires a small onchain fee to permanently stop cloning, bots, and farming) to receive your UID and unlock 0.1000 Bits/hr and 24-hour continuous mining.',
    },
    {
      index: '02',
      title: 'Direct Miners Power',
      metric: '+10% Share',
      body: 'Verified accounts receive a UID and invite link attached with their UID. Only verified and actively mining direct referrals contribute 10% of their mining rate to your velocity. Unverified wallets (treated as bots) and inactive miners share 0% until verified and actively mining.',
    },
    {
      index: '03',
      title: 'SOL Power Multiplier',
      metric: 'Max +10.00 /h',
      body: 'Verified accounts can contribute SOL flexibly from 0.1 SOL to scale mining velocity, up to a maximum of 3 SOL (+10.0000 Bits/hr) per account.',
    },
    {
      index: '04',
      title: 'Mining Cycles & Claims',
      metric: '20% Unlock',
      body: 'Base wallets mine for 3 hours and verified accounts mine for 24 hours, pausing automatically at 100% until claimed. Once your active cycle reaches 20% progress, you can claim mined Bits directly into your wallet balance anytime.',
    },
  ];

  return (
    <div className="min-h-screen bg-[#070707] text-zinc-100 flex flex-col font-sans">
      <header className="border-b border-white/[0.07] bg-[#070707]/90 backdrop-blur-xl sticky top-0 z-40">
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

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 sm:py-10">
        <div className="flex items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white m-0">
            Guide
          </h1>
          <button
            type="button"
            onClick={onBack}
            className="clean-action-btn-soft !min-h-[34px] !px-3.5 !text-xs whitespace-nowrap shrink-0"
          >
            <ChevronLeft size={14} />
            <span>Back to Mining</span>
          </button>
        </div>

        <div className="pob-cockpit overflow-hidden">
          {/* Theme Header */}
          <div className="px-6 py-5 sm:px-7 sm:py-6 border-b border-white/[0.07] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#181818] border border-white/[0.08] flex items-center justify-center flex-shrink-0 text-[#f7931a]">
                <BookOpen size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-tight m-0 text-balance">
                  Bits Mining &amp; Power Guide
                </h2>
                <p className="text-xs text-zinc-400 m-0 mt-1">
                  Rates, verification rules, direct miners, and SOL multipliers.
                </p>
              </div>
            </div>

            {!isConnected ? (
              <button
                type="button"
                onClick={() => setConnectModalOpen(true)}
                className="clean-stake-confirm-btn !w-full sm:!w-auto !min-h-[38px] !px-4 !text-xs !font-bold flex-shrink-0 whitespace-nowrap"
              >
                <Wallet size={14} />
                <span>Connect Wallet</span>
              </button>
            ) : !isVerifiedNode ? (
              <button
                type="button"
                onClick={() => setVerifyModalOpen(true)}
                className="clean-stake-confirm-btn !w-full sm:!w-auto !min-h-[38px] !px-4 !text-xs !font-bold flex-shrink-0 whitespace-nowrap"
              >
                <ShieldCheck size={14} />
                <span>Verify Wallet</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#fbbf24] whitespace-nowrap shrink-0">
                <Check size={14} strokeWidth={2.5} />
                <span>Verified · 24h Cycle</span>
              </div>
            )}
          </div>

          {/* Rules List */}
          <div className="divide-y divide-white/[0.065]">
            {sections.map((item) => (
              <article
                key={item.index}
                className="px-6 py-5 sm:px-7 sm:py-6 grid grid-cols-1 md:grid-cols-[240px_1fr] gap-3 md:gap-8"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-xs font-mono font-semibold text-[#f7931a] tabular-nums">
                      {item.index}.
                    </span>
                    <h3 className="text-[15px] font-bold text-white m-0 tracking-tight leading-snug">
                      {item.title}
                    </h3>
                  </div>
                  <div className="mt-1.5 pl-6 text-xs font-mono font-semibold text-[#fbbf24] tabular-nums">
                    {item.metric}
                  </div>
                </div>

                <p className="text-[13px] sm:text-sm text-zinc-300 m-0 leading-relaxed max-w-[65ch]">
                  {item.body}
                </p>
              </article>
            ))}
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
  const norm = Math.max(0, Math.min(1, (solAmount - 0.1) / (SOL_POWER_MAX_SOL - 0.1)));
  const x = 30 + norm * 400;
  const y = 62 - norm * 48;

  return (
    <div className="w-full h-[76px] my-2 bg-[#0d0d0d] rounded-xl p-2 border border-white/[0.07] relative overflow-hidden">
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
// SOL POWER MODAL: CONTRIBUTE SOL TO ACQUIRE SOL POWER (MAX 3 SOL / 10 BITS/HR)
// ---------------------------------------------------------------------------
function SolPowerModal({
  open,
  onClose,
  onCommitContribution,
  currentContributed = 0,
  isPending = false,
}: {
  open: boolean;
  onClose: () => void;
  onCommitContribution: (solAmount: number) => Promise<void>;
  currentContributed?: number;
  isPending?: boolean;
}) {
  const maxAccountSol = SOL_POWER_MAX_SOL;
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
  const rateBoost = Number(
    (calculateSolPowerBoost(currentContributed + clampedSol) - calculateSolPowerBoost(currentContributed)).toFixed(4),
  );
  const dailyOutput = rateBoost * 24;

  const handleSubmit = async () => {
    setSubmitError(null);
    if (isCapped || !Number.isFinite(clampedSol) || clampedSol <= 0) {
      setSubmitError('Maximum SOL Power quota reached for this account.');
      return;
    }
    try {
      await onCommitContribution(clampedSol);
    } catch (err) {
      setSubmitError(readableError(err, 'Could not acquire SOL Power.'));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#181818', border: '1px solid rgba(255, 255, 255, 0.08)', display: 'grid', placeItems: 'center', color: '#f7931a' }}>
              <Zap size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 18, fontWeight: 700 }}>Acquire Power</h3>
            </div>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-4">
          <InlineErrorBanner message={submitError} />

          <div className="p-3 rounded-xl bg-[#181818] border border-white/[0.075] flex items-center justify-between text-xs font-mono">
            <span className="text-zinc-400 font-sans">Account Limit:</span>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold tabular-nums">
                {currentContributed.toFixed(1)} / {maxAccountSol.toFixed(1)} SOL
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                isCapped ? 'bg-[#f7931a]/20 text-[#fbbf24]' : 'bg-[#10b981]/15 text-[#34d399]'
              }`}>
                {isCapped ? 'MAX REACHED' : `${remainingQuota.toFixed(1)} SOL REMAINING`}
              </span>
            </div>
          </div>

          {isCapped ? (
            <>
              <div className="p-5 rounded-2xl bg-[#181818] border border-[#f7931a]/25 flex flex-col items-center text-center gap-2.5">
                <div className="w-11 h-11 rounded-full bg-[#121212] border border-[#f7931a]/40 flex items-center justify-center text-[#fbbf24]">
                  <Check size={20} strokeWidth={2.5} />
                </div>
                <h4 className="m-0 text-base font-extrabold text-white tracking-tight">
                  You Have Reached Max Power
                </h4>
              </div>

              <div className="pob-panel-body flex flex-col gap-2.5 bg-[#181818] p-3.5 rounded-xl border border-white/[0.075] font-mono text-xs">
                <div className="flex justify-between items-center text-zinc-300">
                  <span className="text-zinc-400 font-sans">Acquired With SOL:</span>
                  <span className="font-bold text-white tabular-nums">{currentContributed.toFixed(1)} / {maxAccountSol.toFixed(1)} SOL</span>
                </div>
                <div className="flex justify-between items-center text-zinc-300">
                  <span className="text-zinc-400 font-sans">Active SOL Power:</span>
                  <span className="font-bold text-[#fbbf24] tabular-nums">+{calculateSolPowerBoost(currentContributed).toFixed(4)} Bits/hr</span>
                </div>
                <div className="flex justify-between items-center text-zinc-300">
                  <span className="text-zinc-400 font-sans">24h SOL Power Output:</span>
                  <span className="font-bold text-[#34d399] tabular-nums">+{(calculateSolPowerBoost(currentContributed) * 24).toFixed(1)} Bits</span>
                </div>
              </div>

              <button
                type="button"
                className="clean-action-btn-soft !w-full !justify-center !min-h-[42px] !text-xs !font-bold"
                onClick={onClose}
              >
                <span>Done</span>
              </button>
            </>
          ) : (
            <>
              <div className="pob-input-box !bg-[#181818] !border-white/[0.08]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold uppercase text-zinc-400 tracking-wider">SOL Power</span>
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
                    value={clampedSol}
                    onChange={(e) => {
                      setSolAmount(Number(e.target.value));
                      if (submitError) setSubmitError(null);
                    }}
                    className="modern-range-line"
                    aria-label="SOL to acquire power"
                  />
                </div>

                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {[0.2, 0.5, 1.0, 2.0].filter((val) => val < remainingQuota - 0.001).map((val) => (
                    <button
                      key={val}
                      type="button"
                      className={`pob-preset-btn ${Math.abs(clampedSol - val) < 0.001 ? '!bg-[#f7931a]/20 !text-[#fbbf24] !border-[#f7931a]/45 font-bold' : ''}`}
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
                      className={`pob-preset-btn ${Math.abs(clampedSol - remainingQuota) < 0.001 ? '!bg-[#f7931a]/20 !text-[#fbbf24] !border-[#f7931a]/45 font-bold' : ''}`}
                      onClick={() => {
                        setSolAmount(remainingQuota);
                        if (submitError) setSubmitError(null);
                      }}
                    >
                      MAX
                    </button>
                  )}
                </div>
              </div>

              <div className="pob-panel-body flex flex-col gap-2.5 bg-[#181818] p-3.5 rounded-xl border border-white/[0.075] font-mono text-xs">
                <div className="flex justify-between items-center text-zinc-300">
                  <span className="text-zinc-400 font-sans">Network:</span>
                  <span className="font-semibold text-[#fbbf24]">Solana Testnet</span>
                </div>
                <div className="flex justify-between items-center text-zinc-300">
                  <span className="text-zinc-400 font-sans">Treasury:</span>
                  <span className="text-zinc-300 tabular-nums" title={PROTOCOL_TREASURY_SOLANA}>{shortSolanaAddress(PROTOCOL_TREASURY_SOLANA)}</span>
                </div>
                <div className="flex justify-between items-center text-zinc-300">
                  <span className="text-zinc-400 font-sans">Acquire With SOL:</span>
                  <span className="font-bold text-white tabular-nums">{clampedSol.toFixed(1)} SOL</span>
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
                disabled={isPending}
                onClick={() => void handleSubmit()}
              >
                {isPending ? (
                  <span className="flex items-center gap-2 justify-center">
                    <RefreshCw size={14} className="animate-spin" /> Processing…
                  </span>
                ) : (
                  <span className="flex items-center gap-2 justify-center">
                    <Zap size={16} /> Acquire SOL Power
                  </span>
                )}
              </button>
            </>
          )}
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
    <div className="min-h-screen bg-[#070707] text-zinc-100 flex flex-col font-sans">
      {/* HEADER */}
      <header className="border-b border-white/[0.07] bg-[#070707]/90 backdrop-blur-xl sticky top-0 z-40">
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

        {/* SINGLE UNIFIED CLAIMED POINTS LEDGER CARD */}
        <div className="pob-cockpit overflow-hidden">
          {/* Top Claimed Points Summary */}
          <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5 border-b border-white/[0.07]">
            <div className="flex items-center gap-3.5">
              <BitsMark size={40} className="flex-shrink-0" />
              <div className="text-3xl sm:text-4xl font-black font-mono text-[#34d399] tabular-nums tracking-tight">
                {claimedTotalBits.toFixed(4)} <span className="text-xs text-zinc-400 font-normal">BITS</span>
              </div>
            </div>

            <div className="flex items-center gap-6 text-xs font-mono">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-0.5">Claims</div>
                <div className="text-lg font-bold text-white tabular-nums">{claimHistoryList.length}</div>
              </div>
            </div>
          </div>

          {/* Claimed Points Entries Below (No 'Confirmed' Text) */}
          <div className="p-5">
            {!isConnected ? (
              <div className="p-4 rounded-xl bg-[#181818] border border-white/[0.075] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
              <div className="py-8 text-center text-zinc-500 text-xs font-mono">
                No claimed points yet.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {claimHistoryList.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-[#181818] border border-white/[0.07] transition-colors hover:border-white/[0.12]"
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

                    <Check size={14} strokeWidth={2.5} className="text-[#34d399] flex-shrink-0" />
                  </div>
                ))}
              </div>
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

type DirectMinerMember = {
  id: string;
  handle: string;
  isVerified: boolean;
  isActive: boolean;
  isEligible: boolean;
  status: 'active' | 'inactive' | 'unverified';
  miningPower: number;
  providedPower: number;
};

function normalizeDirectMiner(m: any): DirectMinerMember {
  const isVerified = Boolean(m?.isVerified);
  const isActive = Boolean(m?.isActive);
  // Rule: Inactive or unverified miners (treated as bots/unverified) share 0% mining power.
  // Only verified AND actively mining direct referrals contribute 10% power to their inviter.
  const isEligible = isVerified && isActive;
  const miningPower = isActive ? Math.max(0, Number(m?.miningPower ?? (isVerified ? 0.1 : 0.01)) || 0) : 0;
  const providedPower = isEligible
    ? Math.max(0, Number(m?.providedPower ?? Number((miningPower * 0.1).toFixed(4))) || 0)
    : 0;
  const status: 'active' | 'inactive' | 'unverified' = !isVerified
    ? 'unverified'
    : isActive
      ? 'active'
      : 'inactive';
  return {
    id: String(m?.id || m?.handle || ''),
    handle: String(m?.handle || 'unknown'),
    isVerified,
    isActive,
    isEligible,
    status,
    miningPower,
    providedPower,
  };
}

// ---------------------------------------------------------------------------
// STANDALONE POWER CARDS REWARD PAGE (BTC ICON DESTINATION)
// ---------------------------------------------------------------------------
function formatCardCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const hms = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return d > 0 ? `${d}d ${hms}` : hms;
}

function PowerCardsPage({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [guideModalOpen, setGuideModalOpen] = useState(false);
  const [receivedCards, setReceivedCards] = useState<ReceivedPowerCard[]>(() =>
    user?.solanaAddress ? getWalletPowerCards(user.solanaAddress) : [],
  );
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [revealingCardId, setRevealingCardId] = useState<string | null>(null);
  const revealTimeoutRef = useRef<number | null>(null);

  const isConnected = Boolean(user?.solanaAddress);
  const isVerifiedNode = Boolean(user?.solanaAddress && user?.isVerified && user?.uid);

  useEffect(() => {
    let cancelled = false;
    const syncCards = () => {
      if (!user?.solanaAddress) {
        setReceivedCards([]);
        return;
      }
      if (isVerifiedNode && !hasUnlockedSpiderCardBefore(user.solanaAddress)) {
        unlockSpiderCardOnVerifiedUid(user.solanaAddress);
      }
      if (isVerifiedNode && !hasUnlockedDragonCardBefore(user.solanaAddress)) {
        const savedSol = getWalletMiningState(user.solanaAddress).contributedSol;
        const solBoost = calculateSolPowerBoost(savedSol);
        if (solBoost >= 2.0) {
          unlockDragonCardOnSolPower(user.solanaAddress, solBoost);
        }
      }
      const list = getWalletPowerCards(user.solanaAddress);
      setReceivedCards(list);
      setNowMs(Date.now());
    };

    syncCards();

    // Check referral milestones to unlock PHOENIX CARD (3+ verified), SIREN CARD (>=0.5/h), and AURA CARD (10+ verified & active)
    if (
      user?.solanaAddress &&
      (!hasUnlockedPhoenixCardBefore(user.solanaAddress) ||
        (isVerifiedNode &&
          (!hasUnlockedSirenCardBefore(user.solanaAddress) ||
            !hasUnlockedAuraCardBefore(user.solanaAddress))))
    ) {
      const addr = user.solanaAddress;
      apiFetchJson<any[]>('/api/accounts/me/team')
        .then((data) => {
          if (cancelled || !Array.isArray(data)) return;
          const normalized = data.map(normalizeDirectMiner);
          const verifiedCount = normalized.filter((m) => m.isVerified).length;
          const eligibleMiners = normalized.filter((m) => m.isEligible);
          const minersPowerPerHour = isVerifiedNode
            ? eligibleMiners.reduce((sum, m) => sum + m.providedPower, 0)
            : 0;
          let unlockedAny = false;

          if (verifiedCount >= 3 && !hasUnlockedPhoenixCardBefore(addr)) {
            unlockPhoenixCardOnThreeVerifiedMiners(addr, verifiedCount);
            unlockedAny = true;
          }
          if (isVerifiedNode && minersPowerPerHour >= 0.5 && !hasUnlockedSirenCardBefore(addr)) {
            unlockSirenCardOnMinersPower(addr, minersPowerPerHour);
            unlockedAny = true;
          }
          if (isVerifiedNode && eligibleMiners.length >= 10 && !hasUnlockedAuraCardBefore(addr)) {
            unlockAuraCardOnTenVerifiedActiveMiners(addr, eligibleMiners.length);
            unlockedAny = true;
          }
          if (unlockedAny) {
            setReceivedCards(getWalletPowerCards(addr));
          }
        })
        .catch(() => {
          // Ignore silent check errors
        });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('bitnoir-cards-updated', syncCards);
      return () => {
        cancelled = true;
        window.removeEventListener('bitnoir-cards-updated', syncCards);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [user?.solanaAddress, isVerifiedNode]);

  useEffect(() => {
    return () => {
      if (revealTimeoutRef.current !== null) {
        window.clearTimeout(revealTimeoutRef.current);
      }
    };
  }, []);

  const activeCardDef = getActivePowerCardDef(receivedCards);
  const hasAnyActive = hasAnyActivePowerCard(receivedCards);

  // Live 1-second timer to update active 24h countdown & auto-disappear expired cards
  useEffect(() => {
    if (!user?.solanaAddress || !hasAnyActive || !activeCardDef) return undefined;
    const interval = window.setInterval(() => {
      const currentNow = Date.now();
      setNowMs(currentNow);
      const rem = getPowerCardRemainingMs(receivedCards, activeCardDef.id);
      if (rem <= 0 && user.solanaAddress) {
        const refreshed = getWalletPowerCards(user.solanaAddress);
        setReceivedCards(refreshed);
        setRevealingCardId(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [user?.solanaAddress, receivedCards, hasAnyActive, activeCardDef]);

  const catalogById = new Map(POWER_CARD_CATALOG.map((c) => [c.id, c]));
  const visibleEntries = receivedCards
    .map((entry) => ({ entry, def: catalogById.get(entry.cardId) }))
    .filter((item): item is { entry: ReceivedPowerCard; def: NonNullable<typeof item.def> } => Boolean(item.def));

  const hasUnlockedAnyBefore = Boolean(
    user?.solanaAddress &&
      (hasUnlockedGenesisAntCardBefore(user.solanaAddress) ||
        hasUnlockedSpiderCardBefore(user.solanaAddress) ||
        hasUnlockedPhoenixCardBefore(user.solanaAddress) ||
        hasUnlockedSirenCardBefore(user.solanaAddress) ||
        hasUnlockedAuraCardBefore(user.solanaAddress) ||
        hasUnlockedDragonCardBefore(user.solanaAddress)),
  );

  const handleActivateCard = (cardId: string) => {
    if (!user?.solanaAddress) return;
    if (hasAnyActive) return;
    const updated = activatePowerCard(user.solanaAddress, cardId, isVerifiedNode);
    setReceivedCards(updated);
    setNowMs(Date.now());

    // One-time slow branded reveal animation overlay upon activation
    const revealKey = `bitnoir-card-reveal-seen-${cardId}-${user.solanaAddress}`;
    if (!safeStorageGet(revealKey)) {
      safeStorageSet(revealKey, new Date().toISOString());
      setRevealingCardId(cardId);
      if (revealTimeoutRef.current !== null) {
        window.clearTimeout(revealTimeoutRef.current);
      }
      revealTimeoutRef.current = window.setTimeout(() => {
        setRevealingCardId(null);
      }, 4900);
    }
  };

  return (
    <div className="min-h-screen bg-[#070707] text-zinc-100 flex flex-col font-sans">
      {/* HEADER */}
      <header className="border-b border-white/[0.07] bg-[#070707]/90 backdrop-blur-xl sticky top-0 z-40">
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
        <div className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white m-0">
              Power Cards
            </h1>
            <button
              type="button"
              onClick={() => setGuideModalOpen(true)}
              title="Power Cards Guide · Rewards & Rules"
              aria-label="Open Power Cards Guidelines"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#161616] border border-[#f59e0b]/45 text-[#fbbf24] hover:bg-[#1f1b14] hover:border-[#fbbf24]/75 transition-colors cursor-pointer shrink-0"
            >
              <BookOpen size={15} />
            </button>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="clean-action-btn-soft !min-h-[32px] !px-3 !text-[11px] whitespace-nowrap shrink-0"
          >
            <ChevronLeft size={13} />
            <span>Back to Mining</span>
          </button>
        </div>

        {/* DIRECT HARDCODED POWER CARDS VIEW (NO BOXES, NO GRIDS) */}
        {!isConnected ? (
          <div className="w-full max-w-md mx-auto flex flex-col items-center text-center gap-4 py-12">
            <BitcoinMark size={40} active={false} />
            <p className="text-xs font-mono text-zinc-400 m-0">
              Connect your wallet and start mining to unlock your Power Card.
            </p>
            <button
              type="button"
              onClick={() => setConnectModalOpen(true)}
              className="clean-stake-confirm-btn !w-auto !min-h-[36px] !px-5 !text-xs !font-bold"
            >
              <Wallet size={14} />
              <span>Connect Wallet</span>
            </button>
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="w-full max-w-md mx-auto flex flex-col items-center text-center gap-3 py-12">
            <BitcoinMark size={40} active={false} />
            <p className="text-xs font-mono text-zinc-500 m-0">
              {hasUnlockedAnyBefore
                ? 'No active Power Cards.'
                : 'Start mining to unlock your Genesis Power Card.'}
            </p>
          </div>
        ) : (
          <div className="w-full max-w-md mx-auto flex flex-col gap-10">
            {visibleEntries.map(({ entry, def }) => {
              const isThisActive = isPowerCardActive(entry, nowMs);
              const remainingMs = entry.expiresAt ? Math.max(0, Date.parse(entry.expiresAt) - nowMs) : 0;
              const isRevealing = revealingCardId === def.id;
              const blockedByOtherActive = !isThisActive && hasAnyActive && activeCardDef?.id !== def.id;
              const durationLabel = formatPowerCardDurationShort(def.durationHours);
              const isSpider = def.id === SPIDER_CARD_ID;
              const isPhoenix = def.id === PHOENIX_CARD_ID;
              const isSiren = def.id === SIREN_CARD_ID;
              const isAura = def.id === AURA_CARD_ID;
              const isDragon = def.id === DRAGON_CARD_ID;

              return (
                <div key={def.id} className="w-full flex flex-col gap-3">
                  {/* EVERYTHING AT TOP OF CARD: NAME, REWARD, EXPIRY & ACTIVATE BUTTON */}
                  <div className="flex items-center justify-between gap-3 px-0.5">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <BitcoinMark size={18} active={isThisActive} />
                        <span className="text-sm sm:text-base font-extrabold tracking-tight text-white">
                          {def.name}
                        </span>
                      </div>
                      <span className="text-xs font-mono font-bold text-[#fbbf24] tabular-nums">
                        +{def.boostPerHour.toFixed(4)} BITS/hr
                      </span>
                    </div>

                    {isThisActive ? (
                      <div className="text-right font-mono">
                        <div className="text-[10px] uppercase tracking-wider text-[#34d399] font-bold">
                          {durationLabel} Active
                        </div>
                        <div className="text-xs font-bold text-[#fbbf24] tabular-nums">
                          Expires In {formatCardCountdown(remainingMs)}
                        </div>
                      </div>
                    ) : blockedByOtherActive ? (
                      <div className="text-right font-mono">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
                          {durationLabel} · Locked
                        </div>
                        <div className="text-[11px] font-bold text-zinc-400">
                          After {activeCardDef?.name}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="text-right font-mono">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Duration</div>
                          <div className="text-xs font-bold text-zinc-200 tabular-nums">{durationLabel}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleActivateCard(def.id)}
                          className="clean-stake-confirm-btn !w-auto !min-h-[34px] !px-4 !text-xs !font-bold whitespace-nowrap shrink-0"
                        >
                          <Zap size={13} />
                          <span>Activate</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* CARD VISUAL: HIDDEN / SEALED UNTIL ACTIVATED, FULL PICTURE + ONE-TIME OVERLAY UPON ACTIVATION */}
                  {!isThisActive ? (
                    <div className="relative w-full aspect-[16/10] rounded-2xl bg-[#121212] border border-white/[0.075] overflow-hidden flex flex-col items-center justify-center gap-2 select-none">
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          background:
                            'radial-gradient(circle at 50% 45%, rgba(247, 147, 26, 0.06) 0%, rgba(18, 18, 18, 0.96) 72%)',
                        }}
                      />
                      <Lock size={22} className="relative z-10 text-[#f7931a]/65" />
                      <span className="relative z-10 text-[11px] font-mono uppercase tracking-widest text-zinc-400">
                        {blockedByOtherActive ? `Waiting · ${activeCardDef?.name} Active` : `Sealed ${def.tier} Card`}
                      </span>
                    </div>
                  ) : (
                    <div
                      className="relative w-full overflow-hidden rounded-2xl select-none card-asset-protected"
                      onContextMenu={(e) => e.preventDefault()}
                      onDragStart={(e) => e.preventDefault()}
                    >
                      {def.imageUrl && (
                        <img
                          src={def.imageUrl}
                          alt={def.name}
                          referrerPolicy="no-referrer"
                          draggable={false}
                          decoding="async"
                          onContextMenu={(e) => e.preventDefault()}
                          onDragStart={(e) => e.preventDefault()}
                          className={`w-full h-auto block rounded-2xl pointer-events-none select-none ${isRevealing ? 'ant-reveal-card-enter' : ''}`}
                        />
                      )}

                      {/* Protective shield blocking tap-hold, drag, and right-click download while preserving vertical scroll */}
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 z-10 select-none touch-pan-y"
                        onContextMenu={(e) => e.preventDefault()}
                        onDragStart={(e) => e.preventDefault()}
                      />

                      {/* ONE-TIME SLOW BRANDED REVEAL ANIMATION OVERLAY */}
                      {isRevealing && (
                        <div
                          className="pointer-events-none absolute inset-0 z-20 rounded-2xl overflow-hidden flex items-center justify-center ant-reveal-overlay"
                          style={{
                            background:
                              'radial-gradient(circle at center, rgba(247, 147, 26, 0.24) 0%, rgba(9, 9, 11, 0.86) 76%)',
                          }}
                        >
                          <div
                            className="absolute inset-y-0 w-1/3 ant-reveal-sweep"
                            style={{
                              background:
                                'linear-gradient(90deg, transparent 0%, rgba(251, 191, 36, 0.45) 50%, transparent 100%)',
                            }}
                          />
                          <div className="absolute w-32 h-32 rounded-full border-2 border-[#fbbf24]/70 ant-reveal-ring" />
                          <div className="relative z-10 flex flex-col items-center text-center gap-2 px-4 ant-reveal-crest">
                            <div className="flex items-center justify-center">
                              {isDragon ? (
                                <DragonEmblemMark size={28} />
                              ) : isAura ? (
                                <AuraEmblemMark size={28} />
                              ) : isSiren ? (
                                <SirenEmblemMark size={28} />
                              ) : isPhoenix ? (
                                <PhoenixEmblemMark size={28} />
                              ) : isSpider ? (
                                <SpiderEmblemMark size={28} />
                              ) : (
                                <AntEmblemMark size={28} />
                              )}
                            </div>
                            <span className="text-sm sm:text-base font-black tracking-[0.22em] uppercase text-white drop-shadow-[0_2px_12px_rgba(247,147,26,0.6)]">
                              {def.name} ACTIVATED
                            </span>
                            <span className="text-[11px] font-mono font-bold text-[#fbbf24] tracking-wider">
                              +{def.boostPerHour.toFixed(4)} BITS/HR · {durationLabel.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      <ConnectWalletModal open={connectModalOpen} onClose={() => setConnectModalOpen(false)} />
      <VerifyAndUsernameModal
        open={verifyModalOpen}
        onClose={() => setVerifyModalOpen(false)}
        onOpenConnect={() => setConnectModalOpen(true)}
      />

      {guideModalOpen && (
        <div className="modal-backdrop" onClick={() => setGuideModalOpen(false)}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 540,
              padding: 24,
              background: '#121212',
              borderColor: 'rgba(245, 158, 11, 0.28)',
              borderRadius: 18,
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#181818] border border-[#f59e0b]/40 flex items-center justify-center text-[#fbbf24]">
                  <BookOpen size={17} />
                </div>
                <div>
                  <h3 className="m-0 text-base font-bold text-white">Power Cards Guidelines</h3>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setGuideModalOpen(false)}
                aria-label="Close Guidelines"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[72vh] overflow-y-auto pr-1 flex flex-col gap-5">
              {/* ALL CARDS & HOW TO UNLOCK */}
              <div className="flex flex-col gap-2.5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[#fbbf24] font-bold">
                  All Cards &amp; Unlock Requirements
                </div>
                {POWER_CARD_CATALOG.map((card) => {
                  const durationShort = formatPowerCardDurationShort(card.durationHours);
                  const howToUnlock =
                    card.id === ANT_CARD_ID
                      ? 'Start your first mining session with a connected Solana wallet (also grants 24h cycle while active).'
                      : card.id === SPIDER_CARD_ID
                        ? 'Complete one-time 0.02 SOL wallet verification to receive your UID.'
                        : card.id === PHOENIX_CARD_ID
                          ? 'Invite 3 verified miners to join your direct team.'
                          : card.id === SIREN_CARD_ID
                            ? 'Reach 0.5000 BITS/hr Miners Power from active & verified direct miners for the first time.'
                            : card.id === AURA_CARD_ID
                              ? 'Reach 10 verified & actively mining direct miners in your team.'
                              : 'Purchase at least 2.0000 BITS/hr in SOL Power (min. 0.60 SOL).';

                  return (
                    <div
                      key={card.id}
                      className="p-3.5 rounded-xl bg-[#181818] border border-white/[0.075] flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {card.id === DRAGON_CARD_ID ? (
                            <DragonEmblemMark size={18} />
                          ) : card.id === AURA_CARD_ID ? (
                            <AuraEmblemMark size={18} />
                          ) : card.id === SIREN_CARD_ID ? (
                            <SirenEmblemMark size={18} />
                          ) : card.id === PHOENIX_CARD_ID ? (
                            <PhoenixEmblemMark size={18} />
                          ) : card.id === SPIDER_CARD_ID ? (
                            <SpiderEmblemMark size={18} />
                          ) : (
                            <AntEmblemMark size={18} />
                          )}
                          <span className="text-xs font-extrabold tracking-wide text-white">
                            {card.name}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-500 uppercase">
                            {card.tier}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[11px] font-bold shrink-0">
                          <span className="text-[#fbbf24] tabular-nums">
                            +{card.boostPerHour.toFixed(4)} /h
                          </span>
                          <span className="text-zinc-500">·</span>
                          <span className="text-[#34d399] uppercase">{durationShort}</span>
                        </div>
                      </div>
                      <p className="m-0 text-xs text-zinc-300 leading-relaxed">
                        {howToUnlock}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* CORE RULES */}
              <div className="p-4 rounded-xl bg-[#161616] border border-[#f59e0b]/25 flex flex-col gap-2">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[#fbbf24] font-bold">
                  Power Card Rules
                </div>
                <ul className="m-0 pl-4 flex flex-col gap-1.5 text-xs text-zinc-300 leading-relaxed">
                  <li>
                    <strong className="text-white">Sealed Until Activated:</strong> Newly earned cards arrive sealed so you control when to start their boost.
                  </li>
                  <li>
                    <strong className="text-white">1 Active Card at a Time:</strong> Only one Power Card can run simultaneously; other unlocked cards wait until the active timer finishes.
                  </li>
                  <li>
                    <strong className="text-white">One-Time Per Wallet:</strong> Each card unlocks once per Solana wallet when its milestone is reached.
                  </li>
                  <li>
                    <strong className="text-white">Permanent Expiry:</strong> After its duration ends (24h, 3d, or 7d), the card disappears permanently.
                  </li>
                  <li>
                    <strong className="text-white">Fair Bot Filter:</strong> Only verified &amp; actively mining referrals count toward Miners Power (Siren) and active miner milestones (Aura).
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
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
  const [teamList, setTeamList] = useState<DirectMinerMember[]>([]);

  const isConnected = Boolean(user?.solanaAddress);
  const isVerified = Boolean(user?.solanaAddress && user?.isVerified);
  const uid = user?.uid || '';
  const isUnlocked = isConnected && isVerified && Boolean(uid);

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
        const normalized = data.map(normalizeDirectMiner);
        setTeamList(normalized);
        const verifiedCount = normalized.filter((m) => m.isVerified).length;
        if (verifiedCount >= 3) {
          unlockPhoenixCardOnThreeVerifiedMiners(user.solanaAddress, verifiedCount);
        }
        const eligibleMiners = normalized.filter((m) => m.isEligible);
        const minersPower = isUnlocked
          ? eligibleMiners.reduce((sum, m) => sum + m.providedPower, 0)
          : 0;
        if (isUnlocked && minersPower >= 0.5) {
          unlockSirenCardOnMinersPower(user.solanaAddress, minersPower);
        }
        if (isUnlocked && eligibleMiners.length >= 10) {
          unlockAuraCardOnTenVerifiedActiveMiners(user.solanaAddress, eligibleMiners.length);
        }
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
  }, [user?.solanaAddress, isUnlocked]);

  const activeCount = isUnlocked ? teamList.filter((m) => m.isEligible).length : 0;
  const referralBoostPerHour = isUnlocked
    ? teamList.filter((m) => m.isEligible).reduce((sum, m) => sum + m.providedPower, 0)
    : 0;

  const referralUrl = isUnlocked
    ? typeof window !== 'undefined'
      ? `${window.location.origin}/?ref=${uid}`
      : `https://bitnoir.io/?ref=${uid}`
    : '';

  const handleCopy = async () => {
    if (!referralUrl) return;
    const ok = await copyToClipboard(referralUrl);
    if (ok) {
      setCopied(true);
      toast({
        description: 'Referral link copied.',
        variant: 'success',
      });
      setTimeout(() => setCopied(false), 2200);
    } else {
      toast({ description: 'Unable to copy link. Please copy it manually.', variant: 'destructive' });
    }
  };

  return (
    <div className="min-h-screen bg-[#070707] text-zinc-100 flex flex-col font-sans">
      {/* HEADER */}
      <header className="border-b border-white/[0.07] bg-[#070707]/90 backdrop-blur-xl sticky top-0 z-40">
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
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-0.5">Verified Active</div>
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
        <div className="mb-6 p-5 rounded-2xl bg-[#121212] border border-white/[0.075]">
          <div className="flex items-start gap-2.5 text-xs text-zinc-300 mb-4 leading-relaxed">
            <MiningPickaxeIcon size={15} className="text-[#fbbf24] mt-0.5 flex-shrink-0" />
            <div>
              Only verified &amp; active direct miners contribute <strong className="text-[#fbbf24]">10% of their mining power</strong> to your velocity. Inactive or unverified miners (bot protection) share 0% until verified and actively mining.
            </div>
          </div>

          {!isConnected ? (
            <div className="p-4 rounded-xl bg-[#181818] border border-white/[0.075] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
            <div className="p-4 rounded-xl bg-[#181818] border border-[#f7931a]/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-xs text-zinc-200 leading-relaxed">
                <Lock size={15} className="text-[#fbbf24] mt-0.5 flex-shrink-0" />
                <div>
                  <strong className="text-white block">Referral Link Locked</strong>
                  Complete wallet verification (small one-time fee to prevent cloning, bots &amp; farming) to receive your <strong className="text-white">UID</strong> and generate your invite link.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVerifyModalOpen(true)}
                className="clean-stake-confirm-btn !w-full sm:!w-auto !min-h-[36px] !px-4 !text-xs !font-bold flex-shrink-0"
              >
                <ShieldCheck size={14} />
                <span>Verify Wallet</span>
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-bold">
                  Your Miner Invite Link
                </span>
                <span className="font-mono text-xs text-zinc-400">
                  UID: <strong className="text-[#fbbf24]">{uid}</strong>
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#181818] border border-white/[0.075]">
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
        <div className="p-5 rounded-2xl bg-[#121212] border border-white/[0.075]">
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
                    background: member.isEligible ? 'rgba(247, 147, 26, 0.04)' : '#181818',
                    border: member.isEligible ? '1px solid rgba(247, 147, 26, 0.2)' : '1px solid rgba(255, 255, 255, 0.065)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="font-semibold text-white text-xs font-mono">
                        {member.handle}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-400 mt-0.5 tabular-nums">
                        {member.isEligible
                          ? `Mining: ${member.miningPower.toFixed(4)} /h · Sharing +${member.providedPower.toFixed(4)} /h`
                          : !member.isVerified
                            ? '0.0000 /h shared · Unverified (bot filter)'
                            : '0.0000 /h shared · Inactive miner'}
                      </div>
                    </div>
                  </div>

                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider"
                    style={{
                      background: member.isEligible
                        ? 'rgba(16, 185, 129, 0.12)'
                        : !member.isVerified
                          ? 'rgba(239, 68, 68, 0.1)'
                          : 'rgba(255, 255, 255, 0.04)',
                      color: member.isEligible ? '#34d399' : !member.isVerified ? '#f87171' : '#71717a',
                      border: member.isEligible
                        ? '1px solid rgba(16, 185, 129, 0.28)'
                        : !member.isVerified
                          ? '1px solid rgba(239, 68, 68, 0.25)'
                          : '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: member.isEligible ? '#10b981' : !member.isVerified ? '#ef4444' : '#71717a' }}
                    />
                    {member.isEligible ? 'Active · +10%' : !member.isVerified ? 'Unverified · 0%' : 'Inactive · 0%'}
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

// Geometric Gold Ant Emblem matching the Genesis ANT CARD artwork
function AntEmblemMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  const gradId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="12" y1="8" x2="52" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="48%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
      {/* Swept antennae */}
      <path
        d="M27 20C24 13 18 10 11 10C15 13 20 16 23 23L27 20Z"
        fill={`url(#${gradId})`}
      />
      <path
        d="M37 20C40 13 46 10 53 10C49 13 44 16 41 23L37 20Z"
        fill={`url(#${gradId})`}
      />
      {/* Curved mandibles */}
      <path
        d="M22 24C14 25 11 35 16 44C16 37 19 32 24 31L22 24Z"
        fill={`url(#${gradId})`}
      />
      <path
        d="M42 24C50 25 53 35 48 44C48 37 45 32 40 31L42 24Z"
        fill={`url(#${gradId})`}
      />
      {/* Faceted crest head */}
      <path
        d="M32 19L41 26L39 40L32 54L25 40L23 26L32 19Z"
        fill={`url(#${gradId})`}
      />
      <path d="M32 19V54L25 40L23 26L32 19Z" fill="rgba(255,255,255,0.16)" />
    </svg>
  );
}

// Geometric Gold Spider Emblem matching the SPIDER CARD artwork
function SpiderEmblemMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  const gradId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="48%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
      {/* Cephalothorax & Abdomen */}
      <circle cx="32" cy="23" r="4.2" fill={`url(#${gradId})`} />
      <path d="M32 28C37 28 39 36 32 45C25 36 27 28 32 28Z" fill={`url(#${gradId})`} />
      {/* Front mandibles */}
      <path d="M29.5 19L27 14L30.5 17.5Z" fill={`url(#${gradId})`} />
      <path d="M34.5 19L37 14L33.5 17.5Z" fill={`url(#${gradId})`} />
      {/* Left 4 sharp segmented legs */}
      <path d="M28 22L19 16L17 9L21 15L28 21Z" fill={`url(#${gradId})`} />
      <path d="M28 24L15 21L10 29L16 23L28 26Z" fill={`url(#${gradId})`} />
      <path d="M28 27L14 31L12 43L16 33L28 29Z" fill={`url(#${gradId})`} />
      <path d="M29 30L19 41L21 53L22 42L30 32Z" fill={`url(#${gradId})`} />
      {/* Right 4 sharp segmented legs */}
      <path d="M36 22L45 16L47 9L43 15L36 21Z" fill={`url(#${gradId})`} />
      <path d="M36 24L49 21L54 29L48 23L36 26Z" fill={`url(#${gradId})`} />
      <path d="M36 27L50 31L52 43L48 33L36 29Z" fill={`url(#${gradId})`} />
      <path d="M35 30L45 41L43 53L42 42L34 32Z" fill={`url(#${gradId})`} />
    </svg>
  );
}

// Geometric Gold Phoenix Emblem matching the PHOENIX CARD artwork
function PhoenixEmblemMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  const gradId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="12" y1="6" x2="52" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="48%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
      {/* Crown & Head */}
      <path d="M32 6L34.5 11.5L32 14L29.5 11.5L32 6Z" fill={`url(#${gradId})`} />
      <path d="M32 13C34.5 13 35.5 16 34 19L32 23L30 19C28.5 16 29.5 13 32 13Z" fill={`url(#${gradId})`} />
      {/* Chest / Body */}
      <path d="M32 21L36.5 29L34 40L32 45L30 40L27.5 29L32 21Z" fill={`url(#${gradId})`} />
      {/* Left Swept Wings */}
      <path d="M28 28C18 25 11 17 12 8C16 14 21 19 29 24L28 28Z" fill={`url(#${gradId})`} />
      <path d="M27 30C16 29 9 23 8 15C13 20 19 24 28 27L27 30Z" fill={`url(#${gradId})`} />
      <path d="M28 33C19 33 12 29 11 22C16 26 21 28 28 30L28 33Z" fill={`url(#${gradId})`} />
      {/* Right Swept Wings */}
      <path d="M36 28C46 25 53 17 52 8C48 14 43 19 35 24L36 28Z" fill={`url(#${gradId})`} />
      <path d="M37 30C48 29 55 23 56 15C51 20 45 24 36 27L37 30Z" fill={`url(#${gradId})`} />
      <path d="M36 33C45 33 52 29 53 22C48 26 43 28 36 30L36 33Z" fill={`url(#${gradId})`} />
      {/* Flowing Tail Plumes */}
      <path d="M32 43L35 58L32 53L29 58L32 43Z" fill={`url(#${gradId})`} />
      <path d="M29 41L23 55L26 48L21 50L28 39Z" fill={`url(#${gradId})`} />
      <path d="M35 41L41 55L38 48L43 50L36 39Z" fill={`url(#${gradId})`} />
    </svg>
  );
}

// Geometric Gold Siren (Mermaid) Emblem matching the SIREN CARD artwork
function SirenEmblemMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  const gradId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="12" y1="6" x2="52" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="48%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
      {/* Flowing crown hair */}
      <path d="M29 10C22 12 17 19 19 27C21 22 25 18 29 16L29 10Z" fill={`url(#${gradId})`} />
      <path d="M36 10C43 13 46 21 43 28C41 23 38 18 35 16L36 10Z" fill={`url(#${gradId})`} />
      {/* Head & Torso */}
      <circle cx="32" cy="14.5" r="4.2" fill={`url(#${gradId})`} />
      <path d="M28 21C28 19.5 36 19.5 36 21L35 33H29L28 21Z" fill={`url(#${gradId})`} />
      {/* Curved Mermaid Tail */}
      <path
        d="M29 33H35C36 41 42 44 45 48C40 50 35 49 32 45C29 49 23 50 18 47C23 43 28 39 29 33Z"
        fill={`url(#${gradId})`}
      />
      {/* Twin Tail Flukes */}
      <path d="M19 47C13 46 10 51 12 56C16 54 19 52 22 49L19 47Z" fill={`url(#${gradId})`} />
      <path d="M44 48C50 47 53 52 51 57C47 55 44 52 41 49L44 48Z" fill={`url(#${gradId})`} />
    </svg>
  );
}

// Geometric Gold Aura (Pegasus) Emblem matching the AURA CARD artwork
function AuraEmblemMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  const gradId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="48%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
      {/* Raised Pegasus Wings */}
      <path d="M27 28C16 24 10 16 11 8C16 14 22 19 30 24L27 28Z" fill={`url(#${gradId})`} />
      <path d="M26 30C15 29 9 23 8 16C13 21 19 25 28 27L26 30Z" fill={`url(#${gradId})`} />
      <path d="M36 27C46 23 52 15 52 7C47 13 42 18 34 23L36 27Z" fill={`url(#${gradId})`} />
      {/* Rearing Neck, Head & Muzzle */}
      <path d="M32 13L38 11L44 16L41 19L36 18L34 29L27 29L29 17L32 13Z" fill={`url(#${gradId})`} />
      {/* Body & Rearing Forelegs / Hindlegs */}
      <path d="M26 29H36L40 40L32 42L24 39L26 29Z" fill={`url(#${gradId})`} />
      <path d="M37 32L46 27L48 31L39 36Z" fill={`url(#${gradId})`} />
      <path d="M26 39L21 54L25 54L29 41Z" fill={`url(#${gradId})`} />
      <path d="M34 40L39 54L43 54L38 40Z" fill={`url(#${gradId})`} />
      {/* Flowing Tail */}
      <path d="M24 37C17 39 14 45 15 51C18 47 21 43 25 41L24 37Z" fill={`url(#${gradId})`} />
    </svg>
  );
}

// Geometric Gold Dragon Emblem matching the DRAGON CARD artwork
function DragonEmblemMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  const gradId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="8" y1="10" x2="56" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="48%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
      {/* Horned Dragon Head & Neck */}
      <path d="M31 11L35 7L34 14L40 16L37 21L33 20L34 29L28 29L27 17L24 12L31 11Z" fill={`url(#${gradId})`} />
      {/* Spread Left Bat-Wing */}
      <path d="M28 24C19 18 11 19 6 26C10 26 12 29 11 33C15 31 18 33 18 37C22 33 25 32 28 33V24Z" fill={`url(#${gradId})`} />
      {/* Spread Right Bat-Wing */}
      <path d="M36 24C45 18 53 19 58 26C54 26 52 29 53 33C49 31 46 33 46 37C42 33 39 32 36 33V24Z" fill={`url(#${gradId})`} />
      {/* Armored Chest & Tail Spike */}
      <path d="M27 28H37L35 43L32 56L29 43L27 28Z" fill={`url(#${gradId})`} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// STOPWATCH-STYLE LIVE MINING POINTS COUNTER (PRECISION ODOMETER TICKER)
// ---------------------------------------------------------------------------
function StopwatchPointsCounter({
  currentBits,
  isAntActive = false,
}: {
  ratePerHour: number;
  currentBits: number;
  isAntActive?: boolean;
}) {
  const formatted = currentBits.toFixed(7);
  const [intPart, decPart] = formatted.split('.');
  const primaryDec = (decPart || '0000000').slice(0, 4);
  const microDec = (decPart || '0000000').slice(4, 7);

  return (
    <div className={`stopwatch-counter-cockpit my-1 ${isAntActive ? 'ant-counter' : ''}`}>
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
          <span
            className={`text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight tabular-nums ${
              isAntActive ? 'text-[#fde68a]/90' : 'text-[#34d399]/85'
            }`}
          >
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
function computeInitialMiningSnapshot(address: string | undefined, isVerifiedNode: boolean) {
  if (!address) {
    return {
      loadedAddr: '',
      hasStartedMiningOnce: false,
      isMiningSessionActive: false,
      sessionElapsedSec: 0,
      unclaimedBits: 0,
      claimedTotalBits: 0,
      contributedSol: 0,
      claimHistory: [] as Array<{ id: number; amount: number; status: string }>,
      receivedCards: [] as ReceivedPowerCard[],
    };
  }
  const saved = getWalletMiningState(address);
  let alreadyStarted = Boolean(
    saved.hasStartedMiningOnce ||
      saved.isMiningSessionActive ||
      saved.sessionElapsedSec > 0 ||
      saved.claimedTotalBits > 0 ||
      saved.claimHistory.length > 0 ||
      hasUnlockedGenesisAntCardBefore(address),
  );
  if (alreadyStarted && !hasUnlockedGenesisAntCardBefore(address)) {
    unlockGenesisAntCardOnStartMining(address);
  }
  const savedCards = getWalletPowerCards(address);
  const savedCardsBoost = getCardPowerBoostPerHour(savedCards);
  const initHas24h = isVerifiedNode || hasActiveAntCard(savedCards);
  const initCycleSec = initHas24h ? 24 * 3600 : 3 * 3600;
  const initRate =
    (isVerifiedNode ? 0.1 + calculateSolPowerBoost(saved.contributedSol) : 0.01) + savedCardsBoost;

  let unclaimedBits = saved.unclaimedBits;
  let sessionElapsedSec = saved.sessionElapsedSec;
  let isMiningSessionActive = false;

  const oneTimeCompleteKey = 'bitnoir-cycle-complete-test-v3';
  if (!safeStorageGet(oneTimeCompleteKey)) {
    safeStorageSet(oneTimeCompleteKey, address);
    alreadyStarted = true;
    sessionElapsedSec = initCycleSec;
    unclaimedBits = Number((initRate * (initCycleSec / 3600)).toFixed(4));
    isMiningSessionActive = false;
    saveWalletMiningState(address, {
      unclaimedBits,
      claimedTotalBits: saved.claimedTotalBits,
      contributedSol: saved.contributedSol,
      lastTickAt: Date.now(),
      isMiningSessionActive: false,
      sessionElapsedSec,
      claimHistory: saved.claimHistory,
      hasStartedMiningOnce: true,
    });
  } else if (saved.isMiningSessionActive) {
    const elapsedDelta = Math.max(0, (Date.now() - saved.lastTickAt) / 1000);
    const nextElapsed = Math.min(initCycleSec, saved.sessionElapsedSec + elapsedDelta);
    const activeDelta = Math.max(0, nextElapsed - saved.sessionElapsedSec);
    unclaimedBits = saved.unclaimedBits + (initRate / 3600) * activeDelta;
    sessionElapsedSec = nextElapsed;
    isMiningSessionActive = nextElapsed < initCycleSec;
  } else if (alreadyStarted && saved.sessionElapsedSec === 0 && saved.unclaimedBits === 0) {
    unclaimedBits = 0;
    sessionElapsedSec = 0;
    isMiningSessionActive = true;
  }

  return {
    loadedAddr: address,
    hasStartedMiningOnce: alreadyStarted,
    isMiningSessionActive,
    sessionElapsedSec,
    unclaimedBits,
    claimedTotalBits: saved.claimedTotalBits,
    contributedSol: saved.contributedSol,
    claimHistory: saved.claimHistory,
    receivedCards: savedCards,
  };
}

interface FlyingBitsParticle {
  id: number;
  startX: number;
  startY: number;
  midX: number;
  midY: number;
  endX: number;
  endY: number;
  delay: number;
  duration: number;
  size: number;
  spinDeg: number;
}

const FlyingBitsToken = memo(function FlyingBitsToken({ particle }: { particle: FlyingBitsParticle }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    const anim = el.animate(
      [
        {
          transform: `translate3d(${particle.startX}px, ${particle.startY}px, 0) scale(0.55) rotate(0deg)`,
          opacity: 0,
        },
        {
          transform: `translate3d(${particle.startX}px, ${particle.startY - 18}px, 0) scale(1.06) rotate(${Math.round(particle.spinDeg * 0.18)}deg)`,
          opacity: 1,
          offset: 0.14,
        },
        {
          transform: `translate3d(${particle.midX}px, ${particle.midY}px, 0) scale(1.0) rotate(${Math.round(particle.spinDeg * 0.55)}deg)`,
          opacity: 0.98,
          offset: 0.55,
        },
        {
          transform: `translate3d(${particle.endX}px, ${particle.endY}px, 0) scale(0.68) rotate(${particle.spinDeg}deg)`,
          opacity: 0.9,
          offset: 0.9,
        },
        {
          transform: `translate3d(${particle.endX}px, ${particle.endY}px, 0) scale(0.25) rotate(${particle.spinDeg}deg)`,
          opacity: 0,
        },
      ],
      {
        duration: particle.duration,
        delay: particle.delay,
        easing: 'cubic-bezier(0.37, 0, 0.63, 1)',
        fill: 'forwards',
      },
    );
    return () => anim.cancel();
  }, [particle]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        marginLeft: -particle.size / 2,
        marginTop: -particle.size / 2,
        opacity: 0,
        willChange: 'transform, opacity',
        filter: 'drop-shadow(0 0 8px rgba(247, 147, 26, 0.55))',
      }}
    >
      <BitsMark size={particle.size} />
    </div>
  );
});

function MiningPage({
  isVisible = true,
  onOpenAssets,
  onOpenMiners,
  onOpenGuide,
  onOpenLedger,
  onOpenCards,
}: {
  isVisible?: boolean;
  onOpenAssets?: () => void;
  onOpenMiners?: () => void;
  onOpenGuide?: () => void;
  onOpenLedger?: () => void;
  onOpenCards?: () => void;
}) {
  const client = useQueryClient();
  const { connection } = useConnection();
  const { wallet, signTransaction, sendTransaction } = useWallet();
  const { user, openWalletModal, ensureSignedIn } = useAuth();

  const [solPowerModalOpen, setSolPowerModalOpen] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [isContributing, setIsContributing] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [flyingTokens, setFlyingTokens] = useState<FlyingBitsParticle[]>([]);
  const [ledgerPulse, setLedgerPulse] = useState(false);

  const counterAreaRef = useRef<HTMLDivElement>(null);
  const claimBtnRef = useRef<HTMLButtonElement>(null);
  const ledgerBtnRef = useRef<HTMLButtonElement>(null);
  const claimAnimTimersRef = useRef<number[]>([]);
  const pendingStartAfterJoinRef = useRef(false);

  const isConnected = Boolean(user?.solanaAddress);
  const isVerified = Boolean(user?.solanaAddress && user?.isVerified);
  const hasUid = Boolean(user?.uid);
  // Verified node gets 24h cycle, 0.1/h base rate, UID referral link & multipliers; Base connected wallet gets 3h cycle at 0.01/h (or 24h while Genesis ANT CARD is active)
  const isVerifiedNode = isConnected && isVerified && hasUid;

  // Synchronous initial snapshot eliminates any frame-0 flash of Start Mining / 0.0000000
  const [initialSnap] = useState(() =>
    computeInitialMiningSnapshot(user?.solanaAddress, isVerifiedNode),
  );

  // 2. Direct Referral Power (starts at zero — populated only from verified + active referrals)
  const baseRatePerHour = isVerifiedNode ? 0.1000 : isConnected ? 0.0100 : 0.0000;
  const [directTeam, setDirectTeam] = useState<DirectMinerMember[]>([]);

  useEffect(() => {
    const fetchDirectTeam = () => {
      if (!user?.solanaAddress) {
        setDirectTeam([]);
        return;
      }
      apiFetchJson<any[]>('/api/accounts/me/team')
        .then((data) => {
          if (Array.isArray(data)) {
            const normalized = data.map(normalizeDirectMiner);
            setDirectTeam(normalized);
            const verifiedCount = normalized.filter((m) => m.isVerified).length;
            if (verifiedCount >= 3 && user?.solanaAddress) {
              unlockPhoenixCardOnThreeVerifiedMiners(user.solanaAddress, verifiedCount);
            }
            const eligibleMiners = normalized.filter((m) => m.isEligible);
            const minersPower = isVerifiedNode
              ? eligibleMiners.reduce((sum, m) => sum + m.providedPower, 0)
              : 0;
            if (isVerifiedNode && minersPower >= 0.5 && user?.solanaAddress) {
              unlockSirenCardOnMinersPower(user.solanaAddress, minersPower);
            }
            if (isVerifiedNode && eligibleMiners.length >= 10 && user?.solanaAddress) {
              unlockAuraCardOnTenVerifiedActiveMiners(user.solanaAddress, eligibleMiners.length);
            }
          } else {
            setDirectTeam([]);
          }
        })
        .catch((err) => {
          console.warn('Direct team fetch warning:', err);
          setDirectTeam([]);
        });
    };

    fetchDirectTeam();
    if (typeof window !== 'undefined') {
      window.addEventListener('bitnoir-session-synced', fetchDirectTeam);
      return () => window.removeEventListener('bitnoir-session-synced', fetchDirectTeam);
    }
    return undefined;
  }, [user?.solanaAddress, isVerifiedNode]);

  const referralBoostPerHour = isVerifiedNode
    ? directTeam.filter((m) => m.isEligible).reduce((sum, m) => sum + m.providedPower, 0)
    : 0;

  // 3. SOL Power Multiplier: Max 3 SOL per account (up to +10 Bits/hr max)
  const [contributedSol, setContributedSol] = useState<number>(initialSnap.contributedSol);
  const solPowerBoostPerHour = isVerifiedNode ? calculateSolPowerBoost(contributedSol) : 0;
  const hasAcquiredSolPower = isVerifiedNode && contributedSol > 0;

  // 4. Power Cards Reward State (per-wallet; ANT/SPIDER/PHOENIX/SIREN/AURA/DRAGON)
  const [receivedCards, setReceivedCards] = useState<ReceivedPowerCard[]>(initialSnap.receivedCards);
  useEffect(() => {
    const syncCards = () => {
      if (!user?.solanaAddress) {
        setReceivedCards([]);
        return;
      }
      if (isVerifiedNode && !hasUnlockedSpiderCardBefore(user.solanaAddress)) {
        unlockSpiderCardOnVerifiedUid(user.solanaAddress);
      }
      if (isVerifiedNode && !hasUnlockedDragonCardBefore(user.solanaAddress)) {
        const savedSol = getWalletMiningState(user.solanaAddress).contributedSol;
        const solBoost = calculateSolPowerBoost(savedSol);
        if (solBoost >= 2.0) {
          unlockDragonCardOnSolPower(user.solanaAddress, solBoost);
        }
      }
      setReceivedCards(getWalletPowerCards(user.solanaAddress));
    };
    syncCards();
    if (typeof window !== 'undefined') {
      window.addEventListener('bitnoir-cards-updated', syncCards);
      return () => window.removeEventListener('bitnoir-cards-updated', syncCards);
    }
    return undefined;
  }, [user?.solanaAddress, isVerifiedNode]);

  const cardPowerBoostPerHour = getCardPowerBoostPerHour(receivedCards);
  const activeCardDef = getActivePowerCardDef(receivedCards);
  const hasActiveCard = Boolean(activeCardDef);
  const isSpiderCardActive = activeCardDef?.id === SPIDER_CARD_ID;
  const isPhoenixCardActive = activeCardDef?.id === PHOENIX_CARD_ID;
  const isSirenCardActive = activeCardDef?.id === SIREN_CARD_ID;
  const isAuraCardActive = activeCardDef?.id === AURA_CARD_ID;
  const isDragonCardActive = activeCardDef?.id === DRAGON_CARD_ID;
  const hasAntCard = hasActiveAntCard(receivedCards);
  const hasActivatedCards = hasActiveCard;
  const has24hCycle = isVerifiedNode || hasAntCard;
  const cycleHours = has24hCycle ? 24 : 3;
  const cycleTotalSeconds = cycleHours * 3600;

  // Configured hash rate when running
  const configuredRatePerHour = isConnected
    ? baseRatePerHour + referralBoostPerHour + solPowerBoostPerHour + cardPowerBoostPerHour
    : 0;

  // 4. Mining Session State & Live Ticking Counter
  const [hasStartedMiningOnce, setHasStartedMiningOnce] = useState<boolean>(initialSnap.hasStartedMiningOnce);
  const [isMiningSessionActive, setIsMiningSessionActive] = useState<boolean>(initialSnap.isMiningSessionActive);
  const [sessionElapsedSec, setSessionElapsedSec] = useState<number>(initialSnap.sessionElapsedSec);
  const [unclaimedBits, setUnclaimedBits] = useState<number>(initialSnap.unclaimedBits);
  const [claimedTotalBits, setClaimedTotalBits] = useState<number>(initialSnap.claimedTotalBits);
  const [claimHistoryList, setClaimHistoryList] = useState<Array<{ id: number; amount: number; status: string }>>(initialSnap.claimHistory);

  const isLiveMining = isConnected && isMiningSessionActive && sessionElapsedSec < cycleTotalSeconds;
  const totalMiningRatePerHour = isLiveMining ? configuredRatePerHour : 0;

  const baseBitsRef = useRef<number>(initialSnap.unclaimedBits);
  const baseElapsedRef = useRef<number>(initialSnap.sessionElapsedSec);
  const baseTimeRef = useRef<number>(Date.now());
  const rateRef = useRef<number>(configuredRatePerHour);
  rateRef.current = configuredRatePerHour;
  const cycleSecRef = useRef<number>(cycleTotalSeconds);
  cycleSecRef.current = cycleTotalSeconds;
  const loadedAddrRef = useRef<string>(initialSnap.loadedAddr);
  const prevVerifiedRef = useRef<boolean>(isVerifiedNode);

  // Load or reset per-wallet mining state on wallet connect / switch / disconnect
  useEffect(() => {
    if (!user?.solanaAddress) {
      loadedAddrRef.current = '';
      prevVerifiedRef.current = false;
      baseBitsRef.current = 0;
      baseElapsedRef.current = 0;
      baseTimeRef.current = Date.now();
      setHasStartedMiningOnce(false);
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

    const snap = computeInitialMiningSnapshot(user.solanaAddress, isVerifiedNode);
    baseBitsRef.current = snap.unclaimedBits;
    baseElapsedRef.current = snap.sessionElapsedSec;
    baseTimeRef.current = Date.now();
    setHasStartedMiningOnce(snap.hasStartedMiningOnce);
    setUnclaimedBits(snap.unclaimedBits);
    setSessionElapsedSec(snap.sessionElapsedSec);
    setIsMiningSessionActive(snap.isMiningSessionActive);
    setContributedSol(snap.contributedSol);
    setClaimedTotalBits(snap.claimedTotalBits);
    setClaimHistoryList(snap.claimHistory);

    if (snap.hasStartedMiningOnce) {
      saveWalletMiningState(user.solanaAddress, {
        unclaimedBits: snap.unclaimedBits,
        claimedTotalBits: snap.claimedTotalBits,
        contributedSol: snap.contributedSol,
        lastTickAt: Date.now(),
        isMiningSessionActive: snap.isMiningSessionActive,
        sessionElapsedSec: snap.sessionElapsedSec,
        claimHistory: snap.claimHistory,
        hasStartedMiningOnce: true,
      });
    }
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
      setHasStartedMiningOnce(true);
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
        hasStartedMiningOnce: true,
      });
    } else {
      prevVerifiedRef.current = isVerifiedNode;
    }
  }, [isVerifiedNode, user?.solanaAddress]);

  // Watch for active 24h Power Card (ANT or SPIDER) automatic expiration
  useEffect(() => {
    if (!user?.solanaAddress || !activeCardDef) return undefined;
    const interval = window.setInterval(() => {
      if (!user.solanaAddress) return;
      if (getPowerCardRemainingMs(receivedCards, activeCardDef.id) <= 0) {
        if (isMiningSessionActive) {
          const dt = Math.max(0, (Date.now() - baseTimeRef.current) / 1000);
          const lockedBits = baseBitsRef.current + (rateRef.current / 3600) * dt;
          const nextMaxSec = isVerifiedNode ? 24 * 3600 : 3 * 3600;
          const lockedElapsed = Math.min(nextMaxSec, baseElapsedRef.current + dt);
          const stillActive = lockedElapsed < nextMaxSec;
          baseBitsRef.current = lockedBits;
          baseElapsedRef.current = lockedElapsed;
          baseTimeRef.current = Date.now();
          setUnclaimedBits(lockedBits);
          setSessionElapsedSec(lockedElapsed);
          setIsMiningSessionActive(stillActive);
          saveWalletMiningState(user.solanaAddress, {
            unclaimedBits: lockedBits,
            claimedTotalBits,
            contributedSol,
            lastTickAt: Date.now(),
            isMiningSessionActive: stillActive,
            sessionElapsedSec: lockedElapsed,
            claimHistory: claimHistoryList,
          });
        }
        setReceivedCards(getWalletPowerCards(user.solanaAddress));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [user?.solanaAddress, receivedCards, activeCardDef, isMiningSessionActive, isVerifiedNode, claimedTotalBits, contributedSol, claimHistoryList]);

  // Real-time ticker (pauses UI frames while on subpages & caps React paints at ~20fps for lightweight performance)
  useEffect(() => {
    if (!isVisible || !isConnected || !isMiningSessionActive || !user?.solanaAddress) return;
    let animId: number;
    let lastPaintAt = 0;
    const tick = (rafNow = performance.now()) => {
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
          hasStartedMiningOnce: true,
        });
        return;
      }

      if (lastPaintAt === 0 || rafNow - lastPaintAt >= 48) {
        lastPaintAt = rafNow;
        const currentBits = baseBitsRef.current + (rateRef.current / 3600) * dt;
        setSessionElapsedSec(totalElapsed);
        setUnclaimedBits(currentBits);
      }
      animId = requestAnimationFrame(tick);
    };
    tick(performance.now());

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
        hasStartedMiningOnce: true,
      });
    }, 3000);

    return () => {
      cancelAnimationFrame(animId);
      clearInterval(persistInterval);
    };
  }, [isVisible, isConnected, isMiningSessionActive, configuredRatePerHour, cycleTotalSeconds, user?.solanaAddress, claimedTotalBits, contributedSol, claimHistoryList]);

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

  // Start Mining handler (opens Solana Wallet Kit if disconnected, requires SIWS ownership signature, then auto-starts)
  const handleStartMining = async () => {
    if (!isConnected || !user?.solanaAddress) {
      pendingStartAfterJoinRef.current = true;
      openWalletModal();
      return;
    }

    const resetCycle = sessionElapsedSec >= cycleTotalSeconds;
    const startBits = resetCycle ? 0 : unclaimedBits;
    const startElapsed = resetCycle ? 0 : sessionElapsedSec;

    try {
      const signed = await ensureSignedIn();
      if (!signed) return;

      await apiFetchJson('/api/accounts/me/start-mining', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      baseBitsRef.current = startBits;
      baseElapsedRef.current = startElapsed;
      baseTimeRef.current = Date.now();
      setHasStartedMiningOnce(true);
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
        hasStartedMiningOnce: true,
      });

      const nextCards = unlockGenesisAntCardOnStartMining(user.solanaAddress);
      setReceivedCards(nextCards);

      toast({
        description: has24hCycle
          ? `Mining started at ${configuredRatePerHour.toFixed(4)} Bits/hr for 24 hours.`
          : `Mining started at ${configuredRatePerHour.toFixed(4)} Bits/hr for 3 hours.`,
        variant: 'gold',
      });
    } catch (err) {
      toast({
        description: readableError(err, 'Unable to start mining. Please try again.'),
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    if (!pendingStartAfterJoinRef.current || !user?.solanaAddress) return;
    pendingStartAfterJoinRef.current = false;
    const addr = user.solanaAddress;
    void (async () => {
      try {
        const signed = await ensureSignedIn();
        if (!signed) return;

        await apiFetchJson('/api/accounts/me/start-mining', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const saved = getWalletMiningState(addr);
        const startBits = saved.sessionElapsedSec >= cycleTotalSeconds ? 0 : saved.unclaimedBits;
        const startElapsed = saved.sessionElapsedSec >= cycleTotalSeconds ? 0 : saved.sessionElapsedSec;
        baseBitsRef.current = startBits;
        baseElapsedRef.current = startElapsed;
        baseTimeRef.current = Date.now();
        setHasStartedMiningOnce(true);
        setUnclaimedBits(startBits);
        setSessionElapsedSec(startElapsed);
        setIsMiningSessionActive(true);
        saveWalletMiningState(addr, {
          ...saved,
          unclaimedBits: startBits,
          lastTickAt: Date.now(),
          isMiningSessionActive: true,
          sessionElapsedSec: startElapsed,
          hasStartedMiningOnce: true,
        });
        const connectedCards = unlockGenesisAntCardOnStartMining(addr);
        setReceivedCards(connectedCards);
        const connectedHas24h = hasActiveAntCard(connectedCards) || isVerified;
        const startBoost = getCardPowerBoostPerHour(connectedCards);
        const startRate = ((isVerified ? 0.1 : 0.01) + startBoost).toFixed(4);
        toast({
          description: connectedHas24h
            ? `Mining started at ${startRate} Bits/hr for 24 hours.`
            : `Mining started at ${startRate} Bits/hr for 3 hours.`,
          variant: 'gold',
        });
      } catch (err) {
        toast({
          description: readableError(err, 'Unable to start mining. Please try again.'),
          variant: 'destructive',
        });
      }
    })();
  }, [user?.solanaAddress, ensureSignedIn]);

  useEffect(() => {
    return () => {
      claimAnimTimersRef.current.forEach((t) => window.clearTimeout(t));
      claimAnimTimersRef.current = [];
    };
  }, []);

  const triggerClaimToLedgerAnimation = () => {
    claimAnimTimersRef.current.forEach((t) => window.clearTimeout(t));
    claimAnimTimersRef.current = [];

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const ledgerRect = ledgerBtnRef.current?.getBoundingClientRect();
    const claimRect = claimBtnRef.current?.getBoundingClientRect();
    const counterRect = counterAreaRef.current?.getBoundingClientRect();

    if (!prefersReducedMotion && ledgerRect && (claimRect || counterRect)) {
      const endX = ledgerRect.left + ledgerRect.width * 0.42;
      const endY = ledgerRect.top + ledgerRect.height * 0.5;
      const batchBase = Date.now();
      const particles: FlyingBitsParticle[] = Array.from({ length: 12 }, (_, idx) => {
        const useCounterOrigin = counterRect && idx % 2 === 0;
        const originRect = useCounterOrigin ? counterRect : (claimRect || counterRect)!;
        const startX =
          originRect.left +
          originRect.width * (useCounterOrigin ? 0.24 + (idx / 12) * 0.38 : 0.32 + (idx / 12) * 0.34);
        const startY = originRect.top + originRect.height * 0.5 + ((idx % 3) - 1) * 8;
        const arcOffsetX = (idx % 2 === 0 ? -1 : 1) * (28 + (idx % 4) * 16);
        const arcLiftY = 74 + (idx % 4) * 26;
        const midX = (startX + endX) / 2 + arcOffsetX;
        const midY = Math.min(startY, endY) - arcLiftY;
        return {
          id: batchBase + idx,
          startX,
          startY,
          midX,
          midY,
          endX: endX + ((idx % 3) - 1) * 4,
          endY: endY + ((idx % 2 === 0 ? -1 : 1) * 2),
          delay: idx * 95,
          duration: 1650 + (idx % 3) * 180,
          size: idx % 3 === 0 ? 22 : 18,
          spinDeg: (idx % 2 === 0 ? 1 : -1) * (120 + idx * 14),
        };
      });
      setFlyingTokens(particles);

      const pulseStart = window.setTimeout(() => setLedgerPulse(true), 1250);
      const pulseEnd = window.setTimeout(() => setLedgerPulse(false), 2850);
      const clearParticles = window.setTimeout(() => setFlyingTokens([]), 3300);
      claimAnimTimersRef.current.push(pulseStart, pulseEnd, clearParticles);
    } else {
      setLedgerPulse(true);
      const pulseEnd = window.setTimeout(() => setLedgerPulse(false), 750);
      claimAnimTimersRef.current.push(pulseEnd);
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
        description: 'Reach 20% cycle progress before claiming mined Bits.',
        variant: 'warning',
      });
      return;
    }
    setIsClaiming(true);
    const claimedAmount = unclaimedBits;
    try {
      const signed = await ensureSignedIn();
      if (!signed) return;

      await apiFetchJson('/api/accounts/me/claim-mined-bits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: claimedAmount }),
      });
      const nextClaimed = Number((claimedTotalBits + claimedAmount).toFixed(4));
      const nextHistory = [{ id: Date.now(), amount: claimedAmount, status: 'Confirmed' }, ...claimHistoryList];
      baseBitsRef.current = 0;
      baseElapsedRef.current = 0;
      baseTimeRef.current = Date.now();
      setHasStartedMiningOnce(true);
      setUnclaimedBits(0);
      setSessionElapsedSec(0);
      setIsMiningSessionActive(true);
      setClaimedTotalBits(nextClaimed);
      setClaimHistoryList(nextHistory);
      if (user?.solanaAddress) {
        saveWalletMiningState(user.solanaAddress, {
          unclaimedBits: 0,
          claimedTotalBits: nextClaimed,
          contributedSol,
          lastTickAt: Date.now(),
          isMiningSessionActive: true,
          sessionElapsedSec: 0,
          claimHistory: nextHistory,
          hasStartedMiningOnce: true,
        });
      }
      triggerClaimToLedgerAnimation();
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
    } catch (err) {
      toast({
        description: readableError(err, 'Unable to claim mined Bits.'),
        variant: 'destructive',
      });
    } finally {
      setIsClaiming(false);
    }
  };

  // Contribute SOL Handler (Max 3 SOL / +10 Bits/hr per account)
  const handleCommitSolPower = async (solAmount: number) => {
    if (!isVerifiedNode || !user?.solanaAddress) {
      setSolPowerModalOpen(false);
      setVerifyModalOpen(true);
      return;
    }
    if (!Number.isFinite(solAmount) || solAmount <= 0) {
      throw new Error('Enter a valid SOL amount.');
    }
    if (contributedSol >= SOL_POWER_MAX_SOL) {
      setSolPowerModalOpen(false);
      return;
    }
    setIsContributing(true);
    try {
      const signed = await ensureSignedIn();
      if (!signed) {
        throw new Error('Please sign in with your wallet signature before acquiring SOL Power.');
      }

      const tx = await sendSolanaTransactionOnchain({
        fromAddress: user.solanaAddress,
        toAddress: PROTOCOL_TREASURY_SOLANA,
        amountSol: solAmount,
        memo: `Bitnoir SOL Power Boost: ${solAmount} SOL`,
        connection,
        walletAdapterName: wallet?.adapter?.name,
        supportedTransactionVersions: wallet?.adapter?.supportedTransactionVersions,
        signTransaction,
        sendTransaction,
      });
      const contributeRes = await apiFetchJson<{ solContributed?: number }>('/api/accounts/me/contribute-sol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solAmount, txSignature: tx.signature }),
      });
      const verifiedSol = Number(contributeRes?.solContributed || solAmount);
      const nextSol = Math.min(SOL_POWER_MAX_SOL, Number((contributedSol + verifiedSol).toFixed(2)));
      const boost = Number((calculateSolPowerBoost(nextSol) - calculateSolPowerBoost(contributedSol)).toFixed(4));

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
      const totalSolBoost = calculateSolPowerBoost(nextSol);
      if (totalSolBoost >= 2.0) {
        unlockDragonCardOnSolPower(user.solanaAddress, totalSolBoost);
      }
      setSolPowerModalOpen(false);
      toast({
        description: `Added +${boost.toFixed(4)} Bits/hr SOL Power.`,
        variant: 'gold',
      });
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyActivityQueryKey() });
    } catch (err) {
      toast({
        description: readableError(err, 'Unable to acquire SOL Power.'),
        variant: 'destructive',
      });
      throw err;
    } finally {
      setIsContributing(false);
    }
  };

  return (
    <div className={`min-h-screen text-zinc-100 flex flex-col font-sans transition-colors duration-500 ${hasActiveCard ? 'ant-theme-page' : 'bg-[#070707]'}`}>
      {/* TOP CLEAN APP HEADER */}
      <header className="border-b border-white/[0.07] bg-[#070707]/90 backdrop-blur-xl sticky top-0 z-40">
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
        {/* 1. TOP HEADER WITH OFFICIAL BITS LOGO, BTC POWER CARDS ICON & CLEAN ACTION BUTTONS */}
        <div className="flex flex-col gap-2.5 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white m-0">Bits Mining</h1>
              {hasActiveCard && activeCardDef && (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold tracking-[0.16em] uppercase text-[#fbbf24]">
                  {isDragonCardActive ? (
                    <DragonEmblemMark size={15} />
                  ) : isAuraCardActive ? (
                    <AuraEmblemMark size={15} />
                  ) : isSirenCardActive ? (
                    <SirenEmblemMark size={15} />
                  ) : isPhoenixCardActive ? (
                    <PhoenixEmblemMark size={15} />
                  ) : isSpiderCardActive ? (
                    <SpiderEmblemMark size={15} />
                  ) : (
                    <AntEmblemMark size={15} />
                  )}
                  <span>
                    {isDragonCardActive
                      ? 'DRAGON'
                      : isAuraCardActive
                        ? 'AURA'
                        : isSirenCardActive
                          ? 'SIREN'
                          : isPhoenixCardActive
                            ? 'PHOENIX'
                            : isSpiderCardActive
                              ? 'SPIDER'
                              : 'ANT'}
                  </span>
                </span>
              )}
              {isLiveMining && (
                <span className={`w-2 h-2 rounded-full ${hasActiveCard ? 'bg-[#fbbf24]' : 'bg-[#10b981]'}`} title="Mining Live" />
              )}
            </div>

            {/* HARDCODED BTC ICON ON RIGHT SIDE ABOVE SOL POWER BUTTON (NO BOX, NO COUNT) */}
            <button
              type="button"
              onClick={() => {
                if (user?.solanaAddress && isMiningSessionActive) {
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
                }
                onOpenCards?.();
              }}
              title={
                hasActivatedCards
                  ? `Power Cards Activated · +${cardPowerBoostPerHour.toFixed(4)} /h`
                  : 'Power Cards · Open Reward Cards'
              }
              aria-label="Open Power Cards"
              className="inline-flex items-center justify-center p-1 bg-transparent border-0 rounded-full cursor-pointer flex-shrink-0 transition-transform duration-200 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f7931a]/60"
            >
              <BitcoinMark size={32} active={hasActivatedCards} />
            </button>
          </div>

          {/* ACTION BUTTONS: MINERS, GUIDE, ASSETS & SOL POWER */}
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <button
              type="button"
              className="clean-action-btn-soft"
              onClick={onOpenMiners}
              title="Miners (Active miners provide 10% mining power)"
            >
              <MiningPickaxeIcon size={14} className="text-[#fbbf24]" />
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
              className="clean-action-btn-soft !border-[#f59e0b]/80 !text-[#f59e0b] hover:!bg-[#f59e0b]/10 hover:!border-[#fbbf24] hover:!text-[#fbbf24]"
              onClick={onOpenAssets}
              title="Assets · Deposit, Withdraw & Transfer"
            >
              <Wallet size={14} className="text-[#f59e0b]" />
              <span>Assets</span>
            </button>
            <button
              type="button"
              className={
                hasAcquiredSolPower
                  ? 'clean-action-btn-soft !border-[#f59e0b]/80 !text-[#f59e0b] hover:!bg-[#f59e0b]/10 hover:!border-[#fbbf24] hover:!text-[#fbbf24]'
                  : 'clean-action-btn-soft hover:!border-white/25'
              }
              onClick={() => {
                if (!isVerifiedNode) {
                  setVerifyModalOpen(true);
                } else {
                  setSolPowerModalOpen(true);
                }
              }}
            >
              <Zap size={14} className={hasAcquiredSolPower ? 'text-[#f7931a]' : 'text-zinc-300'} />
              <span>SOL Power</span>
            </button>
          </div>
        </div>

        {/* 2. MINING COCKPIT */}
        <div className={`pob-cockpit mb-6 ${hasActiveCard ? 'ant-cockpit' : ''}`}>
          <div className="pob-cockpit-hero">
            {hasActiveCard && (
              <div className="pointer-events-none select-none absolute right-10 top-1/2 -translate-y-1/2 opacity-[0.045]">
                {isDragonCardActive ? (
                  <DragonEmblemMark size={168} />
                ) : isAuraCardActive ? (
                  <AuraEmblemMark size={168} />
                ) : isSirenCardActive ? (
                  <SirenEmblemMark size={168} />
                ) : isPhoenixCardActive ? (
                  <PhoenixEmblemMark size={168} />
                ) : isSpiderCardActive ? (
                  <SpiderEmblemMark size={168} />
                ) : (
                  <AntEmblemMark size={168} />
                )}
              </div>
            )}
            <div ref={counterAreaRef} className="pob-live-info relative z-10">
              {/* STOPWATCH PRECISION POINTS COUNTER */}
              <StopwatchPointsCounter
                ratePerHour={totalMiningRatePerHour}
                currentBits={unclaimedBits}
                isAntActive={hasActiveCard}
              />

              {/* Mining Progress Bar */}
              <div className="w-full max-w-md mt-2">
                <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] font-mono select-none">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Progress</span>
                    <span className={`font-bold tabular-nums ${hasActiveCard ? 'text-[#fbbf24]' : 'text-[#34d399]'}`}>
                      {tankFillPercent.toFixed(1)}%
                    </span>
                  </span>
                  <span className="text-white font-bold tabular-nums">{countdownTimer}</span>
                </div>
                <div className="relative w-full">
                  <div className={`w-full h-2.5 rounded-full overflow-hidden border ${hasActiveCard ? 'bg-[#f7931a]/10 border-[#f7931a]/20' : 'bg-white/[0.08] border-white/[0.05]'}`}>
                    <div
                      className={`h-full rounded-full transition-all duration-300 ease-out ${
                        hasActiveCard
                          ? 'bg-gradient-to-r from-[#d97706] via-[#f7931a] to-[#fbbf24]'
                          : is20PercentReached
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
            </div>

            {/* TOP BUTTONS: MINERS BUTTON ALONG WITH CLAIMED LEDGER POINT BUTTON */}
            <div className="pob-live-action relative z-10 flex flex-col items-end">
              <div className="flex items-center gap-1.5 mb-2 justify-end flex-wrap">
                <button
                  type="button"
                  className="referral-points-top-btn"
                  onClick={onOpenMiners}
                  title="Miners (Active miners provide 10% mining power)"
                >
                  <MiningPickaxeIcon size={12} className="text-[#fbbf24]" />
                  <span className="font-mono font-bold text-white tabular-nums text-[11px]">+{referralBoostPerHour.toFixed(4)}</span>
                  <span className="text-[9px] font-mono text-[#fbbf24] font-bold tracking-wider">MINERS</span>
                  <ChevronRight size={11} className="text-zinc-400" />
                </button>

                <button
                  ref={ledgerBtnRef}
                  type="button"
                  className={`claimed-points-top-btn transition-all duration-500 ${
                    ledgerPulse
                      ? '!border-[#34d399]/75 !bg-[#10b981]/20 shadow-[0_0_20px_rgba(52,211,153,0.45)] scale-[1.05]'
                      : ''
                  }`}
                  onClick={onOpenLedger}
                  title="Open Claimed Points Ledger"
                >
                  <ScrollText size={12} className="text-[#34d399]" />
                  <span className="font-mono font-bold text-white tabular-nums text-[11px]">{claimedTotalBits.toFixed(4)}</span>
                  <span className="text-[9px] font-mono text-[#34d399] font-bold tracking-wider">LEDGER</span>
                  <ChevronRight size={11} className="text-zinc-400" />
                </button>
              </div>

              {(!isConnected || !hasStartedMiningOnce) ? (
                <button
                  key="start-mining-btn"
                  type="button"
                  className="claim-btn-active-colorful"
                  onClick={() => void handleStartMining()}
                >
                  <MiningPickaxeIcon size={14} />
                  <span>Start Mining</span>
                </button>
              ) : (
                <button
                  ref={claimBtnRef}
                  key="claim-mining-btn"
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

      {flyingTokens.length > 0 && (
        <div
          className="fixed inset-0 pointer-events-none z-[140] overflow-hidden"
          aria-hidden="true"
        >
          {flyingTokens.map((particle) => (
            <FlyingBitsToken key={particle.id} particle={particle} />
          ))}
        </div>
      )}

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
// CLEAN PREMIUM ASSETS PAGE (DEPOSIT OFF, WITHDRAW COMING SOON, TRANSFER USERNAME-TO-USERNAME)
// ---------------------------------------------------------------------------
function AssetsPage({
  onBack,
  onOpenWithdraw,
}: {
  onBack: () => void;
  onOpenWithdraw?: () => void;
}) {
  const client = useQueryClient();
  const { user, ensureSignedIn } = useAuth();
  const accountQuery = useGetMyAccount({ query: { queryKey: getGetMyAccountQueryKey() } });
  const account = accountQuery.data;

  const [activities, setActivities] = useState<any[]>([]);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);

  // In-app UID-to-UID Transfer Modal & Receipt Detail state
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);

  // In-app Transfer state
  const [sendRecipient, setSendRecipient] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [recipientLookup, setRecipientLookup] = useState<{
    handle: string;
    status: 'idle' | 'checking' | 'valid' | 'not_found' | 'self';
  }>({ handle: '', status: 'idle' });

  const isConnected = Boolean(user?.solanaAddress);
  const isVerified = Boolean(user?.solanaAddress && user?.isVerified);
  const hasUid = Boolean(user?.uid);
  const canUidTransfer = isConnected && isVerified && hasUid;

  const openTransferModal = () => {
    setSendError(null);
    setTransferModalOpen(true);
  };

  const isTransferReceipt = (item: any): boolean => {
    const kind = String(item?.kind || '').toLowerCase();
    const title = String(item?.title || '');
    if (kind !== 'send' && kind !== 'receive' && kind !== 'withdraw') return false;
    if (/activated|verification|signup|allocation/i.test(title)) return false;
    return true;
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
        if (!isTransferReceipt(item)) return false;
        const key = `${item.title}-${item.txHash || item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setActivities(deduped.slice(0, 20));
    } catch (err) {
      setActivitiesError(readableError(err, 'Could not load transaction history.'));
      setActivities(getLocalWalletActivities(user.solanaAddress).filter(isTransferReceipt).slice(0, 20));
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

  const cleanRecipientInput = sendRecipient.trim();
  const resolvedRecipientUid = cleanRecipientInput
    ? normalizeUidInput(cleanRecipientInput)
    : '';
  const isRecipientUidValid = isValidUidFormat(resolvedRecipientUid);

  useEffect(() => {
    if (!transferModalOpen || !resolvedRecipientUid || !isRecipientUidValid) {
      setRecipientLookup({ handle: resolvedRecipientUid, status: 'idle' });
      return;
    }
    if (resolvedRecipientUid === (user?.uid || '')) {
      setRecipientLookup({ handle: resolvedRecipientUid, status: 'self' });
      return;
    }

    let cancelled = false;
    setRecipientLookup({ handle: resolvedRecipientUid, status: 'checking' });

    const timer = window.setTimeout(async () => {
      try {
        const res = await apiFetchJson<{ exists: boolean; uid: string }>(
          `/api/accounts/check-uid?uid=${encodeURIComponent(resolvedRecipientUid)}`
        );
        if (cancelled) return;
        setRecipientLookup({
          handle: resolvedRecipientUid,
          status: res?.exists ? 'valid' : 'not_found',
        });
      } catch {
        if (cancelled) return;
        setRecipientLookup({ handle: resolvedRecipientUid, status: 'not_found' });
      }
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [transferModalOpen, resolvedRecipientUid, isRecipientUidValid, user?.uid]);

  const handleInAppSend = async () => {
    setSendError(null);
    if (!isConnected || !user?.solanaAddress) {
      setConnectModalOpen(true);
      return;
    }
    if (!canUidTransfer) {
      setTransferModalOpen(false);
      setVerifyModalOpen(true);
      toast({
        description: 'Please verify your wallet before transferring Bits.',
        variant: 'destructive',
      });
      return;
    }

    const amt = Number(sendAmount);
    if (!cleanRecipientInput || !Number.isFinite(amt) || amt <= 0) {
      const msg = 'Enter recipient UID and a valid positive amount.';
      setSendError(msg);
      return;
    }
    if (!isRecipientUidValid) {
      setSendError('Enter a valid 8-digit recipient UID.');
      return;
    }
    if (resolvedRecipientUid === (user.uid || '')) {
      setSendError('Cannot transfer to your own UID.');
      return;
    }

    // Confirm recipient UID actually exists before transferring
    if (recipientLookup.handle !== resolvedRecipientUid || recipientLookup.status !== 'valid') {
      try {
        const check = await apiFetchJson<{ exists: boolean }>(
          `/api/accounts/check-uid?uid=${encodeURIComponent(resolvedRecipientUid)}`
        );
        if (!check?.exists) {
          setRecipientLookup({ handle: resolvedRecipientUid, status: 'not_found' });
          setSendError(`UID ${resolvedRecipientUid} does not exist.`);
          return;
        }
        setRecipientLookup({ handle: resolvedRecipientUid, status: 'valid' });
      } catch {
        setSendError(`UID ${resolvedRecipientUid} does not exist.`);
        return;
      }
    }

    const maxAvailable = bitsPurchased;
    if (amt > maxAvailable) {
      setSendError('Amount exceeds available balance.');
      return;
    }

    setIsSending(true);
    try {
      const signed = await ensureSignedIn();
      if (!signed) {
        setSendError('Please sign in with your wallet signature first.');
        return;
      }

      const targetLabel = `UID ${resolvedRecipientUid}`;
      await apiFetchJson('/api/wallet/send-inapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: 'bits',
          amount: amt,
          recipient: resolvedRecipientUid,
          sender: user.uid,
        }),
      });

      saveLocalWalletActivity(user.solanaAddress, {
        id: Date.now(),
        kind: 'send',
        title: `Sent ${amt} Bits to ${targetLabel}`,
        detail: `In-app transfer UID ${user.uid} → ${targetLabel}`,
        amount: amt,
        asset: 'bits',
        createdAt: new Date().toISOString(),
      });

      toast({
        description: `Transferred ${amt} Bits to ${targetLabel}.`,
        variant: 'success',
      });
      setSendAmount('');
      setSendRecipient('');
      setSendError(null);
      setTransferModalOpen(false);
      void client.invalidateQueries({ queryKey: getGetMyAccountQueryKey() });
      void refreshActivity();
    } catch (err) {
      const msg = readableError(err, 'Unable to complete transfer. Please try again.');
      setSendError(msg);
      toast({ description: msg, variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070707] text-zinc-100 flex flex-col font-sans">
      {/* HEADER */}
      <header className="border-b border-white/[0.07] bg-[#070707]/90 backdrop-blur-xl sticky top-0 z-40">
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
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white m-0">Assets</h1>

          <button
            type="button"
            onClick={onBack}
            className="clean-action-btn-soft !min-h-[32px] !px-3 !text-[11px]"
          >
            <ChevronLeft size={13} />
            <span>Back to Mining</span>
          </button>
        </div>

        {/* 1. BITS BALANCE + 3-COLUMN ACTION BAR (DEPOSIT · WITHDRAW · TRANSFER) */}
        <div className="pob-cockpit mb-6 p-5 sm:p-6 flex flex-col gap-5">
          <div className="flex items-center gap-3.5">
            <BitsMark size={38} className="flex-shrink-0" />
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-bold mb-0.5">
                Bits
              </div>
              <div className="text-3xl sm:text-4xl font-black font-mono text-white tabular-nums tracking-tight">
                {bitsPurchased.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5 w-full">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="h-10 rounded-lg border border-white/[0.14] bg-transparent text-zinc-500 text-xs sm:text-sm font-medium flex items-center justify-center cursor-not-allowed pointer-events-none select-none"
            >
              Deposit
            </button>
            <button
              type="button"
              onClick={() => onOpenWithdraw?.()}
              className="h-10 rounded-lg border border-[#f59e0b]/80 bg-transparent text-[#f59e0b] hover:bg-[#f59e0b]/10 hover:border-[#fbbf24] hover:text-[#fbbf24] transition-colors duration-150 text-xs sm:text-sm font-medium flex items-center justify-center cursor-pointer"
            >
              Withdraw
            </button>
            <button
              type="button"
              onClick={openTransferModal}
              className="h-10 rounded-lg border border-[#f59e0b]/80 bg-transparent text-[#f59e0b] hover:bg-[#f59e0b]/10 hover:border-[#fbbf24] hover:text-[#fbbf24] transition-colors duration-150 text-xs sm:text-sm font-medium flex items-center justify-center cursor-pointer"
            >
              Transfer
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

        {/* 2. TRANSACTION HISTORY */}
        <div className="p-5 sm:p-6 rounded-2xl bg-[#121212] border border-white/[0.075]">
          <div className="flex items-center justify-between pb-3.5 border-b border-white/[0.08]">
            <h2 className="text-sm sm:text-base font-semibold text-zinc-200 m-0">Transaction History</h2>
            <span className="text-[11px] font-mono text-zinc-500 tabular-nums">
              {activities.length} {activities.length === 1 ? 'Record' : 'Records'}
            </span>
          </div>

          <div>
            {activitiesError && (
              <div className="mt-3 mb-2">
                <InlineErrorBanner message={activitiesError} onRetry={() => void refreshActivity()} />
              </div>
            )}
            {activitiesLoading && activities.length === 0 ? (
              <div className="py-10 text-center text-zinc-400 text-xs font-mono flex items-center justify-center gap-2">
                <RefreshCw size={14} className="animate-spin text-[#f7931a]" />
                <span>Loading records…</span>
              </div>
            ) : activities.length === 0 ? (
              <div className="py-10 text-center text-zinc-500 text-xs font-mono">
                No record
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {activities.map((act) => {
                  const isSend = act.kind === 'send';
                  const isWithdraw = act.kind === 'withdraw';
                  const isOutgoing = isSend || isWithdraw;
                  const parsedAmt =
                    typeof act.amount === 'number' && Number.isFinite(act.amount)
                      ? act.amount
                      : (() => {
                          const m = String(act.title || '').match(/(?:Sent|Received|Withdrew)\s+([\d,.]+)/i);
                          return m ? Number(m[1].replace(/,/g, '')) : 0;
                        })();
                  const d = new Date(act.createdAt);
                  const pad2 = (n: number) => String(n).padStart(2, '0');
                  const formattedClockDate = Number.isNaN(d.getTime())
                    ? '--:-- --/--'
                    : `${pad2(d.getHours())}:${pad2(d.getMinutes())} ${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;

                  const rowLabel = isWithdraw ? 'Withdraw' : isSend ? 'Transfer' : 'Received';

                  return (
                    <button
                      key={act.id}
                      type="button"
                      onClick={() => setSelectedReceipt(act)}
                      className="w-full text-left py-4 first:pt-3.5 last:pb-1 hover:bg-white/[0.02] transition-colors cursor-pointer rounded-lg px-1 -mx-1"
                    >
                      <div className="flex items-center justify-between mb-2.5">
                        <span className="text-sm font-medium text-zinc-100">{rowLabel}</span>
                        <ChevronRight size={14} className="text-zinc-500 flex-shrink-0" />
                      </div>

                      <div className="grid grid-cols-3 gap-2 items-end">
                        <div>
                          <div className="text-[11px] text-zinc-500 mb-1">Amount</div>
                          <div className="text-xs sm:text-sm font-semibold font-mono text-white tabular-nums">
                            {isOutgoing ? '-' : '+'}
                            {parsedAmt.toFixed(4)}
                          </div>
                        </div>

                        <div className="text-center">
                          <div className="text-[11px] text-zinc-500 mb-1">Status</div>
                          <div className="text-xs sm:text-sm font-medium text-zinc-200">Completed</div>
                        </div>

                        <div className="text-right">
                          <div className="text-[11px] text-zinc-500 mb-1">Time</div>
                          <div className="text-xs sm:text-sm font-medium font-mono text-zinc-400 tabular-nums">
                            {formattedClockDate}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* MODAL: TRANSACTION RECEIPT DETAILS */}
        {selectedReceipt && (
          <div className="modal-backdrop" onClick={() => setSelectedReceipt(null)}>
            <div
              className="modal-dialog"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: 420,
                padding: 24,
                background: '#121212',
                borderColor: 'rgba(255, 255, 255, 0.085)',
                boxShadow: '0 24px 64px rgba(0, 0, 0, 0.88)',
                borderRadius: 18,
              }}
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-white m-0">
                  {selectedReceipt.kind === 'withdraw' ? 'Withdrawal Receipt' : 'Transfer Receipt'}
                </h2>
                <button type="button" className="modal-close-btn" onClick={() => setSelectedReceipt(null)}>
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-col gap-3 text-xs font-mono mb-5">
                <div className="p-3.5 rounded-xl bg-[#181818] border border-white/[0.07] flex items-center justify-between">
                  <span className="text-zinc-400">Type</span>
                  <span className="text-white font-semibold">
                    {selectedReceipt.kind === 'withdraw'
                      ? 'Onchain Withdrawal'
                      : selectedReceipt.kind === 'send'
                        ? 'Sent Transfer'
                        : 'Received Transfer'}
                  </span>
                </div>
                <div className="p-3.5 rounded-xl bg-[#181818] border border-white/[0.07] flex items-center justify-between">
                  <span className="text-zinc-400">Details</span>
                  <span className="text-white font-semibold truncate ml-3">{selectedReceipt.title}</span>
                </div>
                <div className="p-3.5 rounded-xl bg-[#181818] border border-white/[0.07] flex items-center justify-between">
                  <span className="text-zinc-400">Status</span>
                  <span className="text-[#34d399] font-semibold">Completed</span>
                </div>
                <div className="p-3.5 rounded-xl bg-[#181818] border border-white/[0.07] flex items-center justify-between">
                  <span className="text-zinc-400">Time</span>
                  <span className="text-zinc-300 tabular-nums">
                    {new Date(selectedReceipt.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="clean-stake-confirm-btn !w-full !min-h-[40px] !text-xs !font-bold"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* MODAL: IN-APP TRANSFER (USERNAME-TO-USERNAME BITS) */}
        {transferModalOpen && (
          <div className="modal-backdrop" onClick={() => setTransferModalOpen(false)}>
            <div
              className="modal-dialog"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: 460,
                padding: 24,
                background: '#121212',
                borderColor: 'rgba(255, 255, 255, 0.085)',
                boxShadow: '0 24px 64px rgba(0, 0, 0, 0.88)',
                borderRadius: 18,
              }}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#181818] border border-white/[0.08] flex items-center justify-center text-[#f7931a]">
                    <ArrowUpRight size={18} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white m-0">Transfer</h2>
                    <p className="text-[11px] font-mono text-zinc-400 m-0">UID to UID</p>
                  </div>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => setTransferModalOpen(false)}>
                  <X size={16} />
                </button>
              </div>

              {!canUidTransfer ? (
                <div className="flex flex-col gap-3">
                  <div className="p-4 rounded-xl bg-[#f7931a]/[0.08] border border-[#f7931a]/30 text-xs text-zinc-200 leading-relaxed">
                    <strong className="text-white block mb-1">Verification &amp; UID Required</strong>
                    Verify your wallet once (small one-time fee to prevent cloning, bots &amp; farming) to receive your <strong className="text-white">UID</strong> and send Bits in-app.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTransferModalOpen(false);
                      if (!isConnected) setConnectModalOpen(true);
                      else setVerifyModalOpen(true);
                    }}
                    className="clean-stake-confirm-btn !w-full !min-h-[42px] !text-xs !font-bold"
                  >
                    <ShieldCheck size={15} />
                    <span>{!isConnected ? 'Connect Solana Wallet' : 'Verify Wallet'}</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <InlineErrorBanner message={sendError} />

                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between text-xs font-mono">
                    <span className="text-zinc-400">From UID</span>
                    <span className="text-[#34d399] font-bold flex items-center gap-1">
                      {user?.uid} <Check size={12} strokeWidth={3} />
                    </span>
                  </div>

                  <div>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Recipient UID (e.g. 88001001)"
                      value={sendRecipient}
                      onChange={(e) => {
                        setSendRecipient(e.target.value);
                        if (sendError) setSendError(null);
                      }}
                      className="assets-input-field font-mono text-xs"
                    />
                    {cleanRecipientInput && (
                      <div className="mt-1.5 text-[11px] font-mono">
                        {!isRecipientUidValid ? (
                          <span className="text-zinc-400">Enter a valid 8-digit recipient UID</span>
                        ) : recipientLookup.status === 'self' ? (
                          <span className="text-red-400">Cannot transfer to your own UID</span>
                        ) : recipientLookup.status === 'checking' || recipientLookup.handle !== resolvedRecipientUid ? (
                          <span className="text-zinc-400">Checking UID {resolvedRecipientUid}…</span>
                        ) : recipientLookup.status === 'valid' ? (
                          <span className="text-[#34d399] inline-flex items-center gap-1">
                            <Check size={12} strokeWidth={3} /> UID {resolvedRecipientUid} · Valid ID
                          </span>
                        ) : (
                          <span className="text-red-400">UID {resolvedRecipientUid} · User ID does not exist</span>
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
                        setSendAmount(String(bitsPurchased));
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
                    disabled={
                      isSending ||
                      (Boolean(cleanRecipientInput) &&
                        (recipientLookup.status === 'not_found' ||
                          recipientLookup.status === 'self' ||
                          recipientLookup.status === 'checking'))
                    }
                    className="clean-stake-confirm-btn !w-full !min-h-[42px] !text-xs !font-bold"
                  >
                    {isSending ? (
                      <span className="flex items-center gap-2 justify-center">
                        <RefreshCw size={14} className="animate-spin" /> Transferring…
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 justify-center">
                        <Send size={14} /> Transfer Bits
                      </span>
                    )}
                  </button>
                </div>
              )}
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
// STANDALONE WITHDRAW PAGE (CLEAN MINIMAL TRANSFER-STYLE · NOT OPENED YET)
// ---------------------------------------------------------------------------
function WithdrawPage({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const accountQuery = useGetMyAccount({ query: { queryKey: getGetMyAccountQueryKey() } });
  const account = accountQuery.data;

  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);

  const isConnected = Boolean(user?.solanaAddress);
  const bitsAvailable = isConnected ? (account?.balances?.purchased ?? 0) : 0;

  return (
    <div className="min-h-screen bg-[#070707] text-zinc-100 flex flex-col font-sans">
      {/* HEADER */}
      <header className="border-b border-white/[0.07] bg-[#070707]/90 backdrop-blur-xl sticky top-0 z-40">
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
      <main className="flex-1 w-full max-w-[460px] mx-auto px-4 py-10 flex items-center justify-center">
        <div
          className="w-full rounded-[18px] bg-[#121212] border border-white/[0.085] p-6"
          style={{ boxShadow: '0 24px 64px rgba(0, 0, 0, 0.88)' }}
        >
          {/* Card Header — matches Transfer */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#181818] border border-white/[0.08] flex items-center justify-center text-[#f7931a]">
                <ArrowUpRight size={18} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white m-0">Withdraw</h1>
                <p className="text-[11px] font-mono text-zinc-400 m-0">Coming Soon</p>
              </div>
            </div>
            <button type="button" className="modal-close-btn" onClick={onBack} aria-label="Back to Assets">
              <X size={16} />
            </button>
          </div>

          <div className="flex flex-col gap-3.5">
            <div className="p-4 rounded-xl bg-[#f7931a]/[0.08] border border-[#f7931a]/30 text-xs text-zinc-200 leading-relaxed">
              <strong className="text-white block mb-1">Not Opened Yet</strong>
              On-chain Bits withdrawals are not opened yet and will be available on Solana soon.
            </div>

            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-400">Available Bits</span>
              <span className="text-white font-bold tabular-nums">
                {bitsAvailable.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
            </div>

            <button
              type="button"
              onClick={onBack}
              className="clean-stake-confirm-btn !w-full !min-h-[42px] !text-xs !font-bold"
            >
              Back to Assets
            </button>
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
// APPLICATION ROUTER (EXACT CLEAN ROUTES: MINING, MINERS, GUIDE, LEDGER, CARDS, ASSETS & WITHDRAW)
// ---------------------------------------------------------------------------
function DirectAssetsRoute() {
  const [, setLocation] = useLocation();
  return (
    <AssetsPage
      onBack={() => setLocation('/')}
      onOpenWithdraw={() => setLocation('/withdraw')}
    />
  );
}

function DirectWithdrawRoute() {
  const [, setLocation] = useLocation();
  return <WithdrawPage onBack={() => setLocation('/assets')} />;
}

function App() {
  const [currentView, setCurrentView] = useState<'mining' | 'assets' | 'withdraw' | 'miners' | 'guide' | 'ledger' | 'cards'>('mining');

  return (
    <SolanaWalletKitProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <FeedbackMonitor />
          <ErrorBoundary resetKey={currentView}>
            <WouterRouter base={basePath}>
              <Switch>
                <Route path="/assets" component={DirectAssetsRoute} />
                <Route path="/withdraw" component={DirectWithdrawRoute} />
                <Route path="/miners">
                  {() => <MinersPage onBack={() => setCurrentView('mining')} />}
                </Route>
                <Route path="/guide">
                  {() => <GuidePage onBack={() => setCurrentView('mining')} />}
                </Route>
                <Route path="/ledger">
                  {() => <LedgerPage onBack={() => setCurrentView('mining')} />}
                </Route>
                <Route path="/cards">
                  {() => <PowerCardsPage onBack={() => setCurrentView('mining')} />}
                </Route>
                <Route path="/mining">
                  {() => (
                    <MiningPage
                      onOpenAssets={() => setCurrentView('assets')}
                      onOpenMiners={() => setCurrentView('miners')}
                      onOpenGuide={() => setCurrentView('guide')}
                      onOpenLedger={() => setCurrentView('ledger')}
                      onOpenCards={() => setCurrentView('cards')}
                    />
                  )}
                </Route>
                <Route path="/">
                  {() => (
                    <>
                      <div className={currentView === 'mining' ? 'block' : 'hidden'}>
                        <MiningPage
                          isVisible={currentView === 'mining'}
                          onOpenAssets={() => setCurrentView('assets')}
                          onOpenMiners={() => setCurrentView('miners')}
                          onOpenGuide={() => setCurrentView('guide')}
                          onOpenLedger={() => setCurrentView('ledger')}
                          onOpenCards={() => setCurrentView('cards')}
                        />
                      </div>
                      {currentView === 'assets' && (
                        <AssetsPage
                          onBack={() => setCurrentView('mining')}
                          onOpenWithdraw={() => setCurrentView('withdraw')}
                        />
                      )}
                      {currentView === 'withdraw' && (
                        <WithdrawPage onBack={() => setCurrentView('assets')} />
                      )}
                      {currentView === 'miners' && <MinersPage onBack={() => setCurrentView('mining')} />}
                      {currentView === 'guide' && <GuidePage onBack={() => setCurrentView('mining')} />}
                      {currentView === 'ledger' && <LedgerPage onBack={() => setCurrentView('mining')} />}
                      {currentView === 'cards' && <PowerCardsPage onBack={() => setCurrentView('mining')} />}
                    </>
                  )}
                </Route>
                <Route component={() => (
                  <>
                    <div className={currentView === 'mining' ? 'block' : 'hidden'}>
                      <MiningPage
                        isVisible={currentView === 'mining'}
                        onOpenAssets={() => setCurrentView('assets')}
                        onOpenMiners={() => setCurrentView('miners')}
                        onOpenGuide={() => setCurrentView('guide')}
                        onOpenLedger={() => setCurrentView('ledger')}
                        onOpenCards={() => setCurrentView('cards')}
                      />
                    </div>
                    {currentView === 'assets' && (
                      <AssetsPage
                        onBack={() => setCurrentView('mining')}
                        onOpenWithdraw={() => setCurrentView('withdraw')}
                      />
                    )}
                    {currentView === 'withdraw' && (
                      <WithdrawPage onBack={() => setCurrentView('assets')} />
                    )}
                    {currentView === 'miners' && <MinersPage onBack={() => setCurrentView('mining')} />}
                    {currentView === 'guide' && <GuidePage onBack={() => setCurrentView('mining')} />}
                    {currentView === 'ledger' && <LedgerPage onBack={() => setCurrentView('mining')} />}
                    {currentView === 'cards' && <PowerCardsPage onBack={() => setCurrentView('mining')} />}
                  </>
                )} />
              </Switch>
            </WouterRouter>
          </ErrorBoundary>
        </QueryClientProvider>
      </AuthProvider>
    </SolanaWalletKitProvider>
  );
}

export default App;
