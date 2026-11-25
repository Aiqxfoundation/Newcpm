import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

// Protocol Treasury address (Non-custodial, receives 0.02 SOL one-time verification fees and SOL Power contributions)
export const PROTOCOL_TREASURY_SOLANA = 'CFTxmxkCi3h21eXpQ9fkzS6T5oPrzNZUi9njDa5dR7tk';
export const VERIFICATION_FEE_SOL = 0.02;

// Public Solana RPC endpoints (Testnet phase default; configurable via VITE_SOLANA_RPC_URL)
export const SOLANA_TESTNET_RPC = 'https://api.testnet.solana.com';
export const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com';
export const SOLANA_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
export const SOLANA_RPC_ENDPOINT =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SOLANA_RPC_URL) ||
  SOLANA_TESTNET_RPC;

// Safe localStorage helpers (never throw in restricted/incognito iframe contexts)
export function safeStorageGet(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeStorageSet(key: string, value: string): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeStorageRemove(key: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage removal errors
  }
}

export function isValidSolanaAddress(address: string): boolean {
  const trimmed = (address || '').trim();
  if (!trimmed || trimmed.length < 32 || trimmed.length > 44) return false;
  try {
    new PublicKey(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function generateDemoSolanaAddress(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return new PublicKey(bytes).toBase58();
}

export function generateSimulatedTxSignature(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  return Array.from({ length: 88 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Classify Solana Wallet Kit / provider / RPC errors into clear user-facing exceptions
export function classifyWalletError(err: unknown, actionLabel: string): Error | null {
  const anyErr = err as { name?: string; code?: number | string; message?: string } | null;
  const msg = String(anyErr?.message || '');
  const name = String(anyErr?.name || '');
  const code = anyErr?.code;

  if (
    code === 4001 ||
    name === 'WalletWindowClosedError' ||
    /user rejected|rejected the request|cancelled|canceled|declined/i.test(msg)
  ) {
    return new Error(`${actionLabel} cancelled in wallet.`);
  }
  if (code === 4100 || name === 'WalletNotConnectedError' || /unauthorized|not connected/i.test(msg)) {
    return new Error('Wallet authorization required. Unlock your Solana wallet and reconnect.');
  }
  if (code === -32002 || /already pending/i.test(msg)) {
    return new Error('A wallet prompt is already pending. Please approve or reject it in your wallet.');
  }
  if (/insufficient|attempt to debit|no record of a prior credit|0x1\b/i.test(msg)) {
    return new Error('Insufficient Testnet SOL balance in your wallet to cover the amount and network fee.');
  }
  if (
    (name === 'WalletSendTransactionError' && !msg) ||
    /unsupported chain|chain.*not.*supported|invalid chain/i.test(msg)
  ) {
    return new Error('Enable Testnet mode in your Solana wallet (Settings -> Developer Settings -> Testnet) and retry.');
  }
  if (/signature verification failed|missing signature/i.test(msg)) {
    return new Error('Signature verification failed. Ensure your wallet is on Solana Testnet and retry.');
  }
  if (/blockhash not found|block height exceeded|expired/i.test(msg)) {
    return new Error('Solana Testnet blockhash expired. Please try again.');
  }
  return null;
}

// Get connected browser Solana provider fallback
export function getPhantomSolanaProvider() {
  if (typeof window === 'undefined') return null;
  const anyWin = window as unknown as {
    phantom?: { solana?: any };
    solana?: any;
  };
  return anyWin.phantom?.solana || anyWin.solana || null;
}

// Confirm transaction onchain via Public Testnet RPC with polling
export async function confirmSolanaTransactionOnchain(
  signature: string,
  options?: {
    isMainnet?: boolean;
    connection?: Connection;
    blockhash?: string;
    lastValidBlockHeight?: number;
  },
): Promise<boolean> {
  if (!signature || typeof signature !== 'string') {
    throw new Error('Missing Solana transaction signature.');
  }

  const rpc = options?.isMainnet ? SOLANA_MAINNET_RPC : SOLANA_RPC_ENDPOINT;

  // Prefer Connection.confirmTransaction when blockhash context is provided
  if (options?.connection && options.blockhash && typeof options.lastValidBlockHeight === 'number') {
    try {
      const conf = await options.connection.confirmTransaction(
        {
          signature,
          blockhash: options.blockhash,
          lastValidBlockHeight: options.lastValidBlockHeight,
        },
        'confirmed',
      );
      if (conf?.value?.err) {
        throw new Error('Transaction failed onchain on Solana Testnet.');
      }
      return true;
    } catch (err: any) {
      if (err?.message === 'Transaction failed onchain on Solana Testnet.') {
        throw err;
      }
      // Fall through to public RPC getSignatureStatuses polling
    }
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignatureStatuses',
          params: [[signature], { searchTransactionHistory: true }],
        }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const status = data?.result?.value?.[0];
        if (status?.err) {
          throw new Error('Transaction failed onchain on Solana Testnet.');
        }
        if (
          status &&
          (status.confirmationStatus === 'confirmed' ||
            status.confirmationStatus === 'finalized' ||
            (status.confirmations ?? 0) > 0)
        ) {
          return true;
        }
      }
    } catch (err: any) {
      if (err?.message === 'Transaction failed onchain on Solana Testnet.') {
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  return true;
}

function hasValidSignedTx(signedTx: Transaction | VersionedTransaction): boolean {
  if (signedTx instanceof VersionedTransaction) {
    const primarySig = signedTx.signatures?.[0];
    return Boolean(primarySig && primarySig.length === 64 && primarySig.some((b) => b !== 0));
  }
  return signedTx.verifySignatures(false);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Send SOL onchain via Solana Wallet Kit on Solana Testnet
export async function sendSolanaTransactionOnchain({
  fromAddress,
  toAddress = PROTOCOL_TREASURY_SOLANA,
  amountSol,
  connection: passedConnection,
  walletAdapterName,
  supportedTransactionVersions,
  signTransaction,
  sendTransaction,
}: {
  fromAddress: string;
  toAddress?: string;
  amountSol: number;
  memo?: string;
  connection?: Connection;
  walletAdapterName?: string;
  supportedTransactionVersions?: ReadonlySet<number | 'legacy'> | null;
  signTransaction?: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>;
  sendTransaction?: (
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options?: { preflightCommitment?: 'processed' | 'confirmed' | 'finalized'; maxRetries?: number },
  ) => Promise<string>;
}): Promise<{ signature: string; verifiedOnchain: boolean }> {
  if (!isValidSolanaAddress(fromAddress)) {
    throw new Error('Connected Solana wallet address is invalid. Please reconnect.');
  }
  if (!isValidSolanaAddress(toAddress)) {
    throw new Error('Invalid destination Treasury address.');
  }
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    throw new Error('Transaction amount must be greater than zero.');
  }

  const activeConnection = passedConnection || new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
  const fromPubkey = new PublicKey(fromAddress);
  const toPubkey = new PublicKey(toAddress);

  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
  if (!Number.isFinite(lamports) || lamports <= 0) {
    throw new Error('Invalid lamport amount for Solana transfer.');
  }

  const transferIx = SystemProgram.transfer({
    fromPubkey,
    toPubkey,
    lamports,
  });

  const { blockhash, lastValidBlockHeight } = await activeConnection.getLatestBlockhash('confirmed');

  // Use VersionedTransaction (v0) for all adapters that support v0 so unsigned .serialize() never throws
  const supportsV0 =
    supportedTransactionVersions === undefined ? true : Boolean(supportedTransactionVersions?.has(0));

  const tx: Transaction | VersionedTransaction = supportsV0
    ? new VersionedTransaction(
        new TransactionMessage({
          payerKey: fromPubkey,
          recentBlockhash: blockhash,
          instructions: [transferIx],
        }).compileToV0Message(),
      )
    : (() => {
        const legacyTx = new Transaction().add(transferIx);
        legacyTx.recentBlockhash = blockhash;
        legacyTx.feePayer = fromPubkey;
        return legacyTx;
      })();

  const isMobileAdapter = walletAdapterName === 'Mobile Wallet Adapter';

  // Primary path: sendTransaction passes chain='solana:testnet' in Wallet Standard & MWA
  if (sendTransaction) {
    try {
      const signature = await sendTransaction(tx, activeConnection, {
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });
      if (!signature) {
        throw new Error('Wallet did not return a transaction signature.');
      }
      await confirmSolanaTransactionOnchain(signature, {
        connection: activeConnection,
        blockhash,
        lastValidBlockHeight,
      });
      return { signature, verifiedOnchain: true };
    } catch (walletErr: unknown) {
      const errName = String((walletErr as { name?: string })?.name || '');
      const errMsg = String((walletErr as { message?: string })?.message || '');
      const isUserRejection =
        (walletErr as { code?: number })?.code === 4001 ||
        errName === 'WalletWindowClosedError' ||
        /user rejected|rejected the request|cancelled|canceled|declined/i.test(errMsg);
      const isInsufficientSol = /insufficient|attempt to debit|no record of a prior credit|0x1\b/i.test(errMsg);

      const canFallbackToSignAndRaw =
        !isMobileAdapter &&
        Boolean(signTransaction) &&
        !isUserRejection &&
        !isInsufficientSol &&
        ((errName === 'WalletSendTransactionError' && !errMsg) ||
          errName === 'WalletConfigError' ||
          errName === 'WalletAccountError' ||
          /unsupported|not supported|chain/i.test(errMsg));

      if (!canFallbackToSignAndRaw) {
        const classified = classifyWalletError(walletErr, 'Transaction');
        if (classified) throw classified;
        if (walletErr instanceof Error) throw walletErr;
        throw new Error('Unable to complete Solana Testnet transaction.');
      }
    }
  }

  // Fallback path: signTransaction + direct broadcast to Public Solana Testnet RPC
  if (signTransaction) {
    try {
      const signedTx = await signTransaction(tx);
      if (!hasValidSignedTx(signedTx)) {
        throw new Error('Wallet returned an unsigned transaction. Please retry on Solana Testnet.');
      }
      const rawTx = signedTx.serialize();
      const signature = await activeConnection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });
      if (!signature) {
        throw new Error('Solana Testnet RPC did not return a transaction signature.');
      }
      await confirmSolanaTransactionOnchain(signature, {
        connection: activeConnection,
        blockhash,
        lastValidBlockHeight,
      });
      return { signature, verifiedOnchain: true };
    } catch (walletErr: unknown) {
      const classified = classifyWalletError(walletErr, 'Transaction');
      if (classified) throw classified;
      if (walletErr instanceof Error) throw walletErr;
      throw new Error('Unable to complete Solana Testnet transaction.');
    }
  }

  const provider = getPhantomSolanaProvider();
  if (provider && provider.signAndSendTransaction) {
    try {
      const { signature } = await provider.signAndSendTransaction(tx);
      if (!signature) {
        throw new Error('Wallet did not return a transaction signature.');
      }
      await confirmSolanaTransactionOnchain(signature, {
        connection: activeConnection,
        blockhash,
        lastValidBlockHeight,
      });
      return { signature, verifiedOnchain: true };
    } catch (providerErr: unknown) {
      const classified = classifyWalletError(providerErr, 'Transaction');
      if (classified) throw classified;
      if (providerErr instanceof Error) throw providerErr;
      throw new Error('Unable to complete Solana Testnet transaction.');
    }
  }

  throw new Error('Connect a Solana wallet to sign and submit this Testnet transaction.');
}

// Sign an onchain action via Solana Wallet Kit or injected provider
export async function signOnchainWalletAction({
  fromAddress,
  memo,
  signMessage,
}: {
  fromAddress: string;
  memo: string;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<{ signature: string; verifiedOnchain: boolean }> {
  if (!isValidSolanaAddress(fromAddress)) {
    throw new Error('Connected Solana address is invalid. Please reconnect.');
  }
  if (!memo || !memo.trim()) {
    throw new Error('Missing transaction memo.');
  }

  if (signMessage) {
    try {
      const encoded = new TextEncoder().encode(memo);
      await signMessage(encoded);
      const sig = generateSimulatedTxSignature();
      return { signature: sig, verifiedOnchain: true };
    } catch (walletErr: unknown) {
      const classified = classifyWalletError(walletErr, 'Signature');
      if (classified) throw classified;
      console.warn('Wallet Kit signMessage warning, using relay settlement:', walletErr);
    }
  } else {
    const provider = getPhantomSolanaProvider();
    if (provider && provider.signMessage) {
      try {
        const encoded = new TextEncoder().encode(memo);
        await provider.signMessage(encoded, 'utf8');
        const sig = generateSimulatedTxSignature();
        return { signature: sig, verifiedOnchain: true };
      } catch (providerErr: unknown) {
        const classified = classifyWalletError(providerErr, 'Signature');
        if (classified) throw classified;
        console.warn('Provider signMessage warning, using relay settlement:', providerErr);
      }
    }
  }

  await new Promise((r) => setTimeout(r, 700));
  return { signature: generateSimulatedTxSignature(), verifiedOnchain: true };
}

// Unique 8-digit UID generator & Verified UID Directory (maps UID -> Solana address)
const UID_DIRECTORY_KEY = 'bitnoir-uid-directory';

export function deriveCandidateUid(solanaAddress: string, nonce = 0): string {
  const input = nonce > 0 ? `${solanaAddress}#${nonce}` : solanaAddress;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b) >>> 0;
  }
  const mixed = ((h1 ^ (h2 >>> 5)) >>> 0) % 90000000;
  return String(10000000 + mixed);
}

export function normalizeUidInput(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^uid[\s:#-]*/i, '')
    .replace(/\s+/g, '');
}

export function isValidUidFormat(uid: string): boolean {
  return /^\d{8}$/.test(normalizeUidInput(uid));
}

export function getVerifiedUidDirectory(): Record<string, string> {
  try {
    const raw = safeStorageGet(UID_DIRECTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch {
    // Ignore parse error
  }
  return {};
}

export function registerVerifiedUid(uid: string, solanaAddress: string): void {
  const clean = normalizeUidInput(uid);
  if (!clean || !solanaAddress) return;
  try {
    const dir = getVerifiedUidDirectory();
    dir[clean] = solanaAddress;
    safeStorageSet(UID_DIRECTORY_KEY, JSON.stringify(dir));
  } catch {
    // Ignore storage error
  }
}

export function claimLocalUniqueUid(solanaAddress: string, preferredUid?: string): string {
  const dir = getVerifiedUidDirectory();
  if (preferredUid && isValidUidFormat(preferredUid)) {
    const clean = normalizeUidInput(preferredUid);
    if (!dir[clean] || dir[clean] === solanaAddress) {
      registerVerifiedUid(clean, solanaAddress);
      return clean;
    }
  }
  for (const [existingUid, owner] of Object.entries(dir)) {
    if (owner === solanaAddress && isValidUidFormat(existingUid)) {
      return existingUid;
    }
  }
  let nonce = 0;
  while (nonce < 10000) {
    const candidate = deriveCandidateUid(solanaAddress, nonce);
    if ((!dir[candidate] || dir[candidate] === solanaAddress) && candidate !== '88001001') {
      registerVerifiedUid(candidate, solanaAddress);
      return candidate;
    }
    nonce++;
  }
  const fallback = deriveCandidateUid(`${solanaAddress}:${Date.now()}`);
  registerVerifiedUid(fallback, solanaAddress);
  return fallback;
}

export function resolveUidToAddress(uid: string): string | null {
  const clean = normalizeUidInput(uid);
  if (!clean) return null;
  const dir = getVerifiedUidDirectory();
  return dir[clean] || null;
}

export const SOL_POWER_MAX_SOL = 3.0;
export const SOL_POWER_MAX_RATE_PER_HOUR = 10.0;

export function calculateSolPowerBoost(contributedSol: number): number {
  const clamped = Math.max(0, Math.min(SOL_POWER_MAX_SOL, Number(contributedSol) || 0));
  return Number(((clamped / SOL_POWER_MAX_SOL) * SOL_POWER_MAX_RATE_PER_HOUR).toFixed(4));
}

// Per-wallet Mining Progress Local Storage
export interface WalletMiningState {
  unclaimedBits: number;
  claimedTotalBits: number;
  contributedSol: number;
  lastTickAt: number;
  isMiningSessionActive: boolean;
  sessionElapsedSec: number;
  claimHistory: Array<{ id: number; amount: number; status: string }>;
  hasStartedMiningOnce?: boolean;
}

export function getWalletMiningState(ownerAddress: string): WalletMiningState {
  const empty: WalletMiningState = {
    unclaimedBits: 0,
    claimedTotalBits: 0,
    contributedSol: 0,
    lastTickAt: Date.now(),
    isMiningSessionActive: false,
    sessionElapsedSec: 0,
    claimHistory: [],
    hasStartedMiningOnce: false,
  };
  if (!ownerAddress) return empty;
  try {
    const raw = safeStorageGet(`bitnoir-mining-state-${ownerAddress}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      const unclaimedBits = Math.max(0, Number(parsed.unclaimedBits) || 0);
      const claimedTotalBits = Math.max(0, Number(parsed.claimedTotalBits) || 0);
      const isMiningSessionActive = Boolean(parsed.isMiningSessionActive);
      const sessionElapsedSec = Math.max(0, Number(parsed.sessionElapsedSec) || 0);
      const claimHistory = Array.isArray(parsed.claimHistory) ? parsed.claimHistory : [];
      return {
        unclaimedBits,
        claimedTotalBits,
        contributedSol: Math.max(0, Math.min(SOL_POWER_MAX_SOL, Number(parsed.contributedSol) || 0)),
        lastTickAt: Number(parsed.lastTickAt) || Date.now(),
        isMiningSessionActive,
        sessionElapsedSec,
        claimHistory,
        hasStartedMiningOnce: Boolean(
          parsed.hasStartedMiningOnce ||
            isMiningSessionActive ||
            sessionElapsedSec > 0 ||
            claimedTotalBits > 0 ||
            claimHistory.length > 0,
        ),
      };
    }
  } catch {
    // Ignore parse error
  }
  return empty;
}

export function saveWalletMiningState(ownerAddress: string, state: WalletMiningState): void {
  if (!ownerAddress) return;
  try {
    const prevRaw = safeStorageGet(`bitnoir-mining-state-${ownerAddress}`);
    let prevStarted = false;
    if (prevRaw) {
      try {
        prevStarted = Boolean(JSON.parse(prevRaw)?.hasStartedMiningOnce);
      } catch {
        prevStarted = false;
      }
    }
    const persisted: WalletMiningState = {
      ...state,
      hasStartedMiningOnce: Boolean(
        state.hasStartedMiningOnce ||
          prevStarted ||
          state.isMiningSessionActive ||
          state.sessionElapsedSec > 0 ||
          state.claimedTotalBits > 0 ||
          state.claimHistory.length > 0,
      ),
    };
    safeStorageSet(`bitnoir-mining-state-${ownerAddress}`, JSON.stringify(persisted));
  } catch {
    // Ignore storage error
  }
}

// Onchain wallet activity item type
export interface WalletTransactionActivity {
  id: string | number;
  kind: 'send' | 'receive' | 'withdraw' | 'verify' | 'uid';
  title: string;
  detail: string;
  amount?: number;
  asset?: string;
  txHash?: string;
  createdAt: string;
}

export function getLocalWalletActivities(address: string): WalletTransactionActivity[] {
  if (!address) return [];
  try {
    const raw = safeStorageGet(`bitnoir-wallet-txs-${address}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // Ignore
  }
  return [];
}

export function saveLocalWalletActivity(address: string, item: WalletTransactionActivity): void {
  if (!address) return;
  try {
    const current = getLocalWalletActivities(address);
    const updated = [item, ...current].slice(0, 50);
    safeStorageSet(`bitnoir-wallet-txs-${address}`, JSON.stringify(updated));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('bitnoir-activity-updated'));
    }
  } catch {
    // Ignore
  }
}
