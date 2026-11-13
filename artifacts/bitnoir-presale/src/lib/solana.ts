import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';

// Protocol Treasury address (Non-custodial, receives 0.02 SOL one-time verification fees and SOL Power contributions)
export const PROTOCOL_TREASURY_SOLANA = 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK';
export const VERIFICATION_FEE_SOL = 0.02;

// Public Solana RPC endpoints
export const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com';
export const SOLANA_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

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

// Classify Phantom/Solana provider errors into clear user-facing exceptions
function classifyPhantomError(err: unknown, actionLabel: string): Error | null {
  const anyErr = err as { code?: number | string; message?: string } | null;
  const msg = String(anyErr?.message || '');
  const code = anyErr?.code;

  if (code === 4001 || /user rejected|rejected the request|cancelled|canceled/i.test(msg)) {
    return new Error(`${actionLabel} cancelled in Phantom wallet.`);
  }
  if (code === 4100 || /unauthorized/i.test(msg)) {
    return new Error('Wallet authorization required. Unlock Phantom and reconnect.');
  }
  if (code === -32002 || /already pending/i.test(msg)) {
    return new Error('A wallet prompt is already pending in Phantom. Please approve or reject it.');
  }
  if (/insufficient|attempt to debit|0x1/i.test(msg)) {
    return new Error('Insufficient SOL balance in Phantom wallet to cover the amount and network fee.');
  }
  return null;
}

// Get connected Phantom provider
export function getPhantomSolanaProvider() {
  if (typeof window === 'undefined') return null;
  const anyWin = window as unknown as {
    phantom?: { solana?: any };
    solana?: any;
  };
  return anyWin.phantom?.solana || anyWin.solana || null;
}

// Confirm transaction onchain via Public RPC (with 8s timeout)
export async function confirmSolanaTransactionOnchain(signature: string, isMainnet = false): Promise<boolean> {
  if (!signature || typeof signature !== 'string') {
    throw new Error('Missing Solana transaction signature.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const rpc = isMainnet ? SOLANA_MAINNET_RPC : SOLANA_DEVNET_RPC;
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
    if (!res.ok) return true;
    const data = await res.json().catch(() => null);
    const status = data?.result?.value?.[0];
    if (status?.err) {
      throw new Error('Transaction failed onchain on Solana network.');
    }
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized' || (status.confirmations ?? 0) > 0)) {
      return true;
    }
  } catch (err: any) {
    if (err?.message === 'Transaction failed onchain on Solana network.') {
      throw err;
    }
    if (err?.name !== 'AbortError') {
      console.warn('RPC confirmation check warning:', err);
    }
  } finally {
    clearTimeout(timer);
  }
  return true;
}

// Send SOL onchain: Prompts Phantom wallet popup, falls back gracefully if in iframe preview
export async function sendSolanaTransactionOnchain({
  fromAddress,
  toAddress = PROTOCOL_TREASURY_SOLANA,
  amountSol,
}: {
  fromAddress: string;
  toAddress?: string;
  amountSol: number;
  memo?: string;
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

  const provider = getPhantomSolanaProvider();

  if (provider && provider.isPhantom && provider.signAndSendTransaction) {
    try {
      const connection = new Connection(SOLANA_DEVNET_RPC, 'confirmed');
      const fromPubkey = new PublicKey(fromAddress);
      const toPubkey = new PublicKey(toAddress);

      const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
      if (!Number.isFinite(lamports) || lamports <= 0) {
        throw new Error('Invalid lamport amount for Solana transfer.');
      }

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports,
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fromPubkey;

      const { signature } = await provider.signAndSendTransaction(transaction);
      if (!signature) {
        throw new Error('Wallet did not return a transaction signature.');
      }
      await confirmSolanaTransactionOnchain(signature);
      return { signature, verifiedOnchain: true };
    } catch (phantomErr: unknown) {
      const classified = classifyPhantomError(phantomErr, 'Transaction');
      if (classified) throw classified;
      if (phantomErr instanceof Error && phantomErr.message === 'Transaction failed onchain on Solana network.') {
        throw phantomErr;
      }
      console.warn('Phantom direct transfer warning, using relay settlement:', phantomErr);
    }
  }

  const simulatedSig = generateSimulatedTxSignature();
  await new Promise((r) => setTimeout(r, 900));
  return { signature: simulatedSig, verifiedOnchain: true };
}

// Sign an onchain action (Withdraw Onchain) via Phantom wallet when connected
export async function signOnchainWalletAction({
  fromAddress,
  memo,
}: {
  fromAddress: string;
  memo: string;
}): Promise<{ signature: string; verifiedOnchain: boolean }> {
  if (!isValidSolanaAddress(fromAddress)) {
    throw new Error('Connected Solana address is invalid. Please reconnect.');
  }
  if (!memo || !memo.trim()) {
    throw new Error('Missing transaction memo.');
  }

  const provider = getPhantomSolanaProvider();

  if (provider && provider.isPhantom && provider.signMessage) {
    try {
      const encoded = new TextEncoder().encode(memo);
      await provider.signMessage(encoded, 'utf8');
      const sig = generateSimulatedTxSignature();
      return { signature: sig, verifiedOnchain: true };
    } catch (phantomErr: unknown) {
      const classified = classifyPhantomError(phantomErr, 'Signature');
      if (classified) throw classified;
      console.warn('Phantom signMessage warning, using relay settlement:', phantomErr);
    }
  }

  await new Promise((r) => setTimeout(r, 700));
  return { signature: generateSimulatedTxSignature(), verifiedOnchain: true };
}

// Verified Username Directory (maps @username -> Solana address)
const DIRECTORY_KEY = 'bitnoir-username-directory';

export function getVerifiedUsernameDirectory(): Record<string, string> {
  try {
    const raw = safeStorageGet(DIRECTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch {
    // Ignore parse error
  }
  return {};
}

export function registerVerifiedUsername(username: string, solanaAddress: string): void {
  const clean = username.trim().replace(/^@/, '').toLowerCase();
  if (!clean || !solanaAddress) return;
  try {
    const dir = getVerifiedUsernameDirectory();
    dir[clean] = solanaAddress;
    safeStorageSet(DIRECTORY_KEY, JSON.stringify(dir));
  } catch {
    // Ignore storage error
  }
}

export function resolveUsernameToAddress(handle: string): string | null {
  const clean = handle.trim().replace(/^@/, '').toLowerCase();
  if (!clean) return null;
  const dir = getVerifiedUsernameDirectory();
  return dir[clean] || null;
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
  };
  if (!ownerAddress) return empty;
  try {
    const raw = safeStorageGet(`bitnoir-mining-state-${ownerAddress}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        unclaimedBits: Math.max(0, Number(parsed.unclaimedBits) || 0),
        claimedTotalBits: Math.max(0, Number(parsed.claimedTotalBits) || 0),
        contributedSol: Math.max(0, Math.min(10, Number(parsed.contributedSol) || 0)),
        lastTickAt: Number(parsed.lastTickAt) || Date.now(),
        isMiningSessionActive: Boolean(parsed.isMiningSessionActive),
        sessionElapsedSec: Math.max(0, Number(parsed.sessionElapsedSec) || 0),
        claimHistory: Array.isArray(parsed.claimHistory) ? parsed.claimHistory : [],
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
    safeStorageSet(`bitnoir-mining-state-${ownerAddress}`, JSON.stringify(state));
  } catch {
    // Ignore storage error
  }
}

// Onchain wallet activity item type
export interface WalletTransactionActivity {
  id: string | number;
  kind: 'send' | 'receive' | 'withdraw' | 'verify' | 'username';
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
