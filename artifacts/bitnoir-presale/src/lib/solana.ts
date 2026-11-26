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

// Solana Devnet configuration (public RPC only, confirmed commitment)
export const SOLANA_CLUSTER = 'devnet' as const;
export const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com';
export const SOLANA_RPC_ENDPOINT = SOLANA_DEVNET_RPC;
export const SOLANA_COMMITMENT = 'confirmed' as const;

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

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

export function encodeBase58(bytes: Uint8Array): string {
  if (!bytes || bytes.length === 0) return '';
  const digits: number[] = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let output = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    output += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    output += BASE58_ALPHABET[digits[i]];
  }
  return output;
}

export function decodeBase58(input: string): Uint8Array | null {
  const str = (input || '').trim();
  if (!str) return null;
  const bytes: number[] = [0];
  for (let i = 0; i < str.length; i++) {
    const val = BASE58_ALPHABET.indexOf(str[i]);
    if (val < 0) return null;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] *= 58;
    }
    bytes[0] += val;
    let carry = 0;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] += carry;
      carry = bytes[j] >> 8;
      bytes[j] &= 0xff;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

export function normalizeSignatureToBase58(sig: string | Uint8Array): string {
  if (sig instanceof Uint8Array) {
    if (sig.length !== 64) {
      throw new Error('Invalid transaction signature byte length returned by wallet.');
    }
    return encodeBase58(sig);
  }
  const trimmed = String(sig || '').trim();
  if (!trimmed) {
    throw new Error('Wallet did not return a transaction signature.');
  }
  const b58Bytes = decodeBase58(trimmed);
  if (b58Bytes && b58Bytes.length === 64) {
    return trimmed;
  }
  // Handle base64 signatures returned by some Mobile Wallet Adapter implementations
  try {
    const binary = atob(trimmed);
    if (binary.length === 64) {
      const bytes = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return encodeBase58(bytes);
    }
  } catch {
    // Not base64
  }
  throw new Error('Wallet returned an invalid Solana transaction signature format.');
}

export function extractSignatureBytes(result: unknown): Uint8Array | null {
  if (!result) return null;
  if (result instanceof Uint8Array) return result;
  if (Array.isArray(result) && result.every((n) => typeof n === 'number')) {
    return Uint8Array.from(result);
  }
  if (typeof result === 'object' && 'signature' in result) {
    const inner = (result as { signature?: unknown }).signature;
    if (inner instanceof Uint8Array) return inner;
    if (Array.isArray(inner) && inner.every((n) => typeof n === 'number')) {
      return Uint8Array.from(inner);
    }
  }
  return null;
}

export function isUserRejectionError(err: unknown): boolean {
  const anyErr = err as { name?: string; code?: number | string; message?: string } | null;
  const msg = String(anyErr?.message || '');
  const name = String(anyErr?.name || '');
  const code = anyErr?.code;
  return (
    code === 4001 ||
    name === 'WalletWindowClosedError' ||
    /user rejected|rejected the request|user declined|cancelled|canceled|declined/i.test(msg)
  );
}

// Classify Solana Wallet Kit / provider / RPC errors into clear user-facing exceptions
export function classifyWalletError(err: unknown, actionLabel: string): Error | null {
  const anyErr = err as { name?: string; code?: number | string; message?: string } | null;
  const msg = String(anyErr?.message || '');
  const name = String(anyErr?.name || '');
  const code = anyErr?.code;

  if (isUserRejectionError(err)) {
    return new Error(`${actionLabel} cancelled in wallet.`);
  }
  if (code === 4100 || name === 'WalletNotConnectedError' || /unauthorized|not connected/i.test(msg)) {
    return new Error('Wallet authorization required. Unlock your Solana wallet and reconnect.');
  }
  if (code === -32002 || /already pending/i.test(msg)) {
    return new Error('A wallet prompt is already pending. Please approve or reject it in your wallet.');
  }
  if (/insufficient|attempt to debit|no record of a prior credit|0x1\b/i.test(msg)) {
    return new Error('Insufficient Devnet SOL balance in your wallet to cover the amount and network fee.');
  }
  if (
    (name === 'WalletSendTransactionError' && !msg) ||
    /unsupported chain|chain.*not.*supported|invalid chain/i.test(msg)
  ) {
    return new Error('Enable Devnet mode in your Solana wallet (Settings -> Developer Settings -> Devnet) and retry.');
  }
  if (/invalid format|app request invalid/i.test(msg)) {
    return new Error('Wallet rejected the request format. Ensure your wallet is updated and set to Solana Devnet, then retry.');
  }
  if (/signature verification failed|missing signature/i.test(msg)) {
    return new Error('Signature verification failed. Ensure your wallet is on Solana Devnet and retry.');
  }
  if (/blockhash not found|block height exceeded|expired/i.test(msg)) {
    return new Error('Solana Devnet blockhash expired. Please try again.');
  }
  return null;
}

// Get connected browser Phantom Solana provider if present
export function getPhantomSolanaProvider() {
  if (typeof window === 'undefined') return null;
  const anyWin = window as unknown as {
    phantom?: { solana?: any };
    solana?: any;
  };
  const candidate = anyWin.phantom?.solana || anyWin.solana || null;
  if (candidate && candidate.isPhantom) {
    return candidate;
  }
  return null;
}

// Get connected Trust Wallet Solana provider across extension and DApp browser variants
export function getTrustSolanaProvider() {
  if (typeof window === 'undefined') return null;
  const anyWin = window as unknown as {
    trustwallet?: { solana?: any };
    trustWallet?: { solana?: any };
    solana?: any;
  };
  const explicitTrust = anyWin.trustwallet?.solana || anyWin.trustWallet?.solana || null;
  if (
    explicitTrust &&
    (explicitTrust.isTrust ||
      explicitTrust.isTrustWallet ||
      typeof explicitTrust.connect === 'function')
  ) {
    return explicitTrust;
  }
  if (anyWin.solana && (anyWin.solana.isTrust || anyWin.solana.isTrustWallet)) {
    return anyWin.solana;
  }
  return null;
}

export function isInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent || '',
  );
}

export function getSafeCurrentAppUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const parsed = new URL(window.location.href);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return '';
  } catch {
    return '';
  }
}

export function getTrustWalletDeepLink(targetUrl?: string): string {
  const raw = targetUrl || getSafeCurrentAppUrl();
  if (!raw) return 'https://trustwallet.com/download';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return 'https://trustwallet.com/download';
    }
    return `https://link.trustwallet.com/open_url?coin_id=501&url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return 'https://trustwallet.com/download';
  }
}

export function getPhantomWalletDeepLink(targetUrl?: string): string {
  const raw = targetUrl || getSafeCurrentAppUrl();
  if (!raw) return 'https://phantom.app/';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return 'https://phantom.app/';
    }
    return `https://phantom.app/ul/browse/${encodeURIComponent(parsed.toString())}?ref=${encodeURIComponent(parsed.origin)}`;
  } catch {
    return 'https://phantom.app/';
  }
}

async function rpcPost<T = any>(rpcUrl: string, method: string, params: unknown[], timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    });
    if (!res.ok) {
      throw new Error(`Solana Devnet RPC HTTP ${res.status}`);
    }
    const json = await res.json();
    if (json?.error) {
      throw new Error(String(json.error?.message || 'Solana Devnet RPC error'));
    }
    return json?.result as T;
  } finally {
    clearTimeout(timer);
  }
}

// Confirm transaction onchain via Public Devnet RPC with strict status, block-height expiry & getTransaction verification
export async function confirmSolanaTransactionOnchain(
  signature: string,
  options?: {
    connection?: Connection;
    blockhash?: string;
    lastValidBlockHeight?: number;
  },
): Promise<boolean> {
  const base58Sig = normalizeSignatureToBase58(signature);
  const rpc = SOLANA_DEVNET_RPC;
  const activeConnection = options?.connection || new Connection(rpc, SOLANA_COMMITMENT);

  let lastRpcError = '';
  const maxAttempts = 24;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const statusResult = await rpcPost<{
        value?: Array<{
          slot: number;
          confirmations: number | null;
          err: unknown;
          confirmationStatus?: 'processed' | 'confirmed' | 'finalized';
        } | null>;
      }>(rpc, 'getSignatureStatuses', [[base58Sig], { searchTransactionHistory: true }], 7000);

      const status = statusResult?.value?.[0];
      if (status?.err) {
        throw new Error('Transaction failed onchain on Solana Devnet.');
      }

      const isConfirmed =
        Boolean(status) &&
        (status!.confirmationStatus === 'confirmed' ||
          status!.confirmationStatus === 'finalized' ||
          status!.confirmations === null ||
          (status!.confirmations ?? 0) > 0);

      if (isConfirmed) {
        // Double-verify via getTransaction to ensure transaction exists and meta.err is null
        const txDetails = await rpcPost<{ meta?: { err?: unknown } } | null>(
          rpc,
          'getTransaction',
          [
            base58Sig,
            {
              encoding: 'jsonParsed',
              commitment: SOLANA_COMMITMENT,
              maxSupportedTransactionVersion: 0,
            },
          ],
          7000,
        ).catch(() => null);

        if (txDetails) {
          if (txDetails.meta?.err) {
            throw new Error('Transaction failed onchain on Solana Devnet.');
          }
          return true;
        }
        // If status is confirmed/finalized and getTransaction is still indexing on this node, retry briefly
        if (attempt >= 3 && (status!.confirmationStatus === 'confirmed' || status!.confirmationStatus === 'finalized')) {
          return true;
        }
      }

      // Check block-height expiration when blockhash context is known and tx is still unseen
      if (!status && typeof options?.lastValidBlockHeight === 'number' && attempt > 0 && attempt % 4 === 0) {
        const currentHeight = await activeConnection.getBlockHeight(SOLANA_COMMITMENT).catch(() => 0);
        if (currentHeight > options.lastValidBlockHeight) {
          throw new Error('Solana Devnet blockhash expired before confirmation. Please retry.');
        }
      }
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (
        msg === 'Transaction failed onchain on Solana Devnet.' ||
        msg.includes('blockhash expired')
      ) {
        throw err;
      }
      lastRpcError = msg || 'RPC polling error';
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  throw new Error(
    lastRpcError
      ? `Unable to confirm transaction on Solana Devnet RPC (${lastRpcError}).`
      : 'Transaction timed out before Devnet confirmation. Please verify in your wallet and retry.',
  );
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

export async function fetchSolanaDevnetBalanceSol(
  address: string,
  passedConnection?: Connection,
): Promise<number | null> {
  if (!isValidSolanaAddress(address)) return null;
  try {
    const activeConnection = passedConnection || new Connection(SOLANA_DEVNET_RPC, SOLANA_COMMITMENT);
    const lamports = await activeConnection.getBalance(new PublicKey(address), SOLANA_COMMITMENT);
    return Number((lamports / LAMPORTS_PER_SOL).toFixed(6));
  } catch {
    return null;
  }
}

// Send SOL onchain via Solana Wallet Adapter on Solana Devnet
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
  if (fromAddress.trim() === toAddress.trim()) {
    throw new Error(
      'Sender wallet cannot be the same as the Protocol Treasury address. Switch to a different Solana Devnet wallet to pay.',
    );
  }
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    throw new Error('Transaction amount must be greater than zero.');
  }

  const activeConnection = passedConnection || new Connection(SOLANA_DEVNET_RPC, SOLANA_COMMITMENT);
  const fromPubkey = new PublicKey(fromAddress);
  const toPubkey = new PublicKey(toAddress);

  const normalizedSol = Number(amountSol.toFixed(6));
  const lamports = Math.round(normalizedSol * LAMPORTS_PER_SOL);
  if (!Number.isFinite(lamports) || lamports <= 0) {
    throw new Error('Invalid lamport amount for Solana transfer.');
  }

  // Check exact Devnet SOL balance before prompting wallet approval (fail fast on insufficient balance)
  const balanceLamports = await activeConnection.getBalance(fromPubkey, SOLANA_COMMITMENT).catch(() => null);
  if (typeof balanceLamports === 'number') {
    const minRequiredLamports = lamports + 10_000; // transfer + network fee buffer
    if (balanceLamports < minRequiredLamports) {
      const availSol = (balanceLamports / LAMPORTS_PER_SOL).toFixed(4);
      const reqSol = (minRequiredLamports / LAMPORTS_PER_SOL).toFixed(4);
      throw new Error(
        `Insufficient Devnet SOL balance (${availSol} SOL available, ${reqSol} SOL required including network fee).`,
      );
    }
  }

  const transferIx = SystemProgram.transfer({
    fromPubkey,
    toPubkey,
    lamports,
  });

  const buildLegacyTx = (bh: string): Transaction => {
    const legacyTx = new Transaction();
    legacyTx.add(transferIx);
    legacyTx.recentBlockhash = bh;
    legacyTx.feePayer = fromPubkey;
    return legacyTx;
  };

  const buildVersionedTx = (bh: string): VersionedTransaction =>
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: fromPubkey,
        recentBlockhash: bh,
        instructions: [transferIx],
      }).compileToV0Message(),
    );

  const { blockhash, lastValidBlockHeight } = await activeConnection.getLatestBlockhash(SOLANA_COMMITMENT);

  const isMobileAdapter = walletAdapterName === 'Mobile Wallet Adapter';
  const supportsV0 =
    supportedTransactionVersions === undefined ? true : Boolean(supportedTransactionVersions?.has(0));

  // Mobile Wallet Adapter calls .serialize() without flags, so it needs VersionedTransaction (v0).
  // Standard browser/Phantom wallets support Legacy Transaction cleanly without v0/options format friction.
  const primaryTx: Transaction | VersionedTransaction = isMobileAdapter && supportsV0
    ? buildVersionedTx(blockhash)
    : buildLegacyTx(blockhash);

  // Primary path: wallet adapter sendTransaction
  if (sendTransaction) {
    try {
      const rawSignature = await sendTransaction(primaryTx, activeConnection, {
        preflightCommitment: SOLANA_COMMITMENT,
      });
      const signature = normalizeSignatureToBase58(rawSignature);
      await confirmSolanaTransactionOnchain(signature, {
        connection: activeConnection,
        blockhash,
        lastValidBlockHeight,
      });
      return { signature, verifiedOnchain: true };
    } catch (walletErr: unknown) {
      const errMsg = String((walletErr as { message?: string })?.message || '');
      const isInsufficientSol = /insufficient|attempt to debit|no record of a prior credit|0x1\b/i.test(errMsg);

      if (isUserRejectionError(walletErr) || isInsufficientSol) {
        const classified = classifyWalletError(walletErr, 'Transaction');
        if (classified) throw classified;
        if (walletErr instanceof Error) throw walletErr;
        throw new Error('Transaction cancelled in wallet.');
      }

      // If sendTransaction failed (e.g. Wallet Standard chain mismatch when Devnet isn't toggled,
      // or format rejection), fall back to signTransaction + direct Devnet RPC broadcast below.
      if (!signTransaction || isMobileAdapter) {
        const classified = classifyWalletError(walletErr, 'Transaction');
        if (classified) throw classified;
        if (walletErr instanceof Error) throw walletErr;
        throw new Error('Unable to complete Solana Devnet transaction.');
      }
    }
  }

  // Fallback path: signTransaction + direct broadcast to Public Solana Devnet RPC
  if (signTransaction) {
    const fresh = await activeConnection.getLatestBlockhash(SOLANA_COMMITMENT);
    const trySignAndSend = async (txToSign: Transaction | VersionedTransaction) => {
      const signedTx = await signTransaction(txToSign);
      if (!hasValidSignedTx(signedTx)) {
        throw new Error('Wallet returned an unsigned transaction. Please retry on Solana Devnet.');
      }
      const rawTx = signedTx.serialize();
      const rawSignature = await activeConnection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: SOLANA_COMMITMENT,
        maxRetries: 3,
      });
      const signature = normalizeSignatureToBase58(rawSignature);
      await confirmSolanaTransactionOnchain(signature, {
        connection: activeConnection,
        blockhash: fresh.blockhash,
        lastValidBlockHeight: fresh.lastValidBlockHeight,
      });
      return { signature, verifiedOnchain: true };
    };

    try {
      return await trySignAndSend(buildLegacyTx(fresh.blockhash));
    } catch (signErr: unknown) {
      const errMsg = String((signErr as { message?: string })?.message || '');
      const isInsufficientSol = /insufficient|attempt to debit|no record of a prior credit|0x1\b/i.test(errMsg);
      if (isUserRejectionError(signErr) || isInsufficientSol) {
        const classified = classifyWalletError(signErr, 'Transaction');
        if (classified) throw classified;
        if (signErr instanceof Error) throw signErr;
        throw new Error('Transaction cancelled in wallet.');
      }
      if (supportsV0 && /invalid format|versioned|serialize|legacy/i.test(errMsg)) {
        try {
          return await trySignAndSend(buildVersionedTx(fresh.blockhash));
        } catch (v0Err: unknown) {
          const classified = classifyWalletError(v0Err, 'Transaction');
          if (classified) throw classified;
          if (v0Err instanceof Error) throw v0Err;
          throw new Error('Unable to complete Solana Devnet transaction.');
        }
      }
      const classified = classifyWalletError(signErr, 'Transaction');
      if (classified) throw classified;
      if (signErr instanceof Error) throw signErr;
      throw new Error('Unable to complete Solana Devnet transaction.');
    }
  }

  // Direct provider fallback when Phantom or Trust is the active matching wallet
  const phantomProvider = getPhantomSolanaProvider();
  const trustProvider = getTrustSolanaProvider();
  const provider =
    phantomProvider &&
    (!walletAdapterName || walletAdapterName === 'Phantom') &&
    phantomProvider.publicKey?.toBase58?.() === fromAddress
      ? phantomProvider
      : trustProvider &&
          (!walletAdapterName ||
            walletAdapterName === 'Trust' ||
            walletAdapterName === 'Trust Wallet') &&
          trustProvider.publicKey?.toBase58?.() === fromAddress
        ? trustProvider
        : null;

  if (provider) {
    try {
      const fresh = await activeConnection.getLatestBlockhash(SOLANA_COMMITMENT);
      const legacyTx = buildLegacyTx(fresh.blockhash);
      let rawSignature: string;
      if (typeof provider.signTransaction === 'function') {
        const signedTx = await provider.signTransaction(legacyTx);
        if (!hasValidSignedTx(signedTx)) {
          throw new Error('Wallet returned an unsigned transaction.');
        }
        rawSignature = await activeConnection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: false,
          preflightCommitment: SOLANA_COMMITMENT,
          maxRetries: 3,
        });
      } else if (typeof provider.signAndSendTransaction === 'function') {
        const res = await provider.signAndSendTransaction(legacyTx);
        rawSignature = res?.signature ?? res;
      } else {
        throw new Error('Wallet signing method is unavailable.');
      }
      const signature = normalizeSignatureToBase58(rawSignature);
      await confirmSolanaTransactionOnchain(signature, {
        connection: activeConnection,
        blockhash: fresh.blockhash,
        lastValidBlockHeight: fresh.lastValidBlockHeight,
      });
      return { signature, verifiedOnchain: true };
    } catch (providerErr: unknown) {
      const classified = classifyWalletError(providerErr, 'Transaction');
      if (classified) throw classified;
      if (providerErr instanceof Error) throw providerErr;
      throw new Error('Unable to complete Solana Devnet transaction.');
    }
  }

  throw new Error('Connect a Solana wallet to sign and submit this Devnet transaction.');
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
