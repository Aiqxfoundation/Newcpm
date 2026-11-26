import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function decodeBase58Bytes(input: string): Uint8Array | null {
  const str = (input || '').trim();
  if (!str) return null;
  const bytes: number[] = [0];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const value = BASE58_ALPHABET.indexOf(ch);
    if (value < 0) return null;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] *= 58;
    }
    bytes[0] += value;
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

function verifySolanaEd25519Signature({
  address,
  messageBytes,
  signatureBytes,
}: {
  address: string;
  messageBytes: Uint8Array;
  signatureBytes: Uint8Array;
}): boolean {
  try {
    const pubBytes = decodeBase58Bytes(address);
    if (!pubBytes || pubBytes.length !== 32) return false;
    if (!signatureBytes || signatureBytes.length !== 64) return false;
    const keyObj = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pubBytes)]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(messageBytes), keyObj, Buffer.from(signatureBytes));
  } catch {
    return false;
  }
}

interface AccountState {
  id: string;
  name: string;
  uid: string;
  email: string;
  role: string;
  referralCode: string;
  referredBy: string | null;
  isVerified: boolean;
  verifiedTx?: string;
  balances: {
    purchased: number;
    claimed: number;
  };
  mining: {
    baseRatePerHour: number;
    burnedSol: number;
    solBurnBoostPerHour: number;
    referralBoostPerHour: number;
    totalMiningRatePerHour: number;
    minedBitsUnclaimed: number;
    minedBitsTotalClaimed: number;
    sessionStartedAt: string;
    sessionEndsAt: string;
  };
  activities: Array<{
    id: number;
    kind: 'send' | 'receive' | 'withdraw' | 'verify' | 'uid' | 'reward' | 'stake';
    title: string;
    detail: string;
    amount?: number;
    txHash?: string;
    createdAt: string;
  }>;
  createdAt: string;
}

class HttpRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function deriveCandidateUid(solanaAddress: string, nonce = 0): string {
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

function normalizeUid(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/^uid[\s:#-]*/i, '')
    .replace(/\s+/g, '');
}

function isValidUid(uid: string): boolean {
  return /^\d{8}$/.test(uid);
}

function isValidSolanaBase58(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((addr || '').trim());
}

const PROTOCOL_TREASURY_SOLANA = 'CFTxmxkCi3h21eXpQ9fkzS6T5oPrzNZUi9njDa5dR7tk';
const SOLANA_PUBLIC_DEVNET_RPC = 'https://api.devnet.solana.com';
const VERIFICATION_FEE_LAMPORTS = 20_000_000; // 0.02 SOL

async function postDevnetRpc(method: string, params: unknown[], timeoutMs = 7000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const rpcRes = await fetch(SOLANA_PUBLIC_DEVNET_RPC, {
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
    if (!rpcRes.ok) {
      throw new Error(`Devnet RPC HTTP ${rpcRes.status}`);
    }
    const json = await rpcRes.json().catch(() => null);
    if (json?.error) {
      throw new Error(String(json.error?.message || 'Devnet RPC error'));
    }
    return json?.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

interface InspectedTreasuryTransfer {
  sender: string;
  verifiedLamports: number;
  senderSpentLamports: number;
  senderSigned: boolean;
  parsedSenderMatches: boolean;
  blockTime?: number;
  slot?: number;
}

function inspectTreasuryTransferTransaction(
  txResult: any,
  expectedSender?: string,
): InspectedTreasuryTransfer | null {
  if (!txResult || txResult.meta?.err) {
    return null;
  }

  const accountKeysRaw: any[] = Array.isArray(txResult.transaction?.message?.accountKeys)
    ? txResult.transaction.message.accountKeys
    : [];
  const accountKeys = accountKeysRaw.map((k) =>
    typeof k === 'string'
      ? { pubkey: k, signer: false }
      : { pubkey: String(k?.pubkey || ''), signer: Boolean(k?.signer) },
  );

  const instructions: any[] = [
    ...(Array.isArray(txResult.transaction?.message?.instructions)
      ? txResult.transaction.message.instructions
      : []),
    ...(Array.isArray(txResult.meta?.innerInstructions)
      ? txResult.meta.innerInstructions.flatMap((inner: any) =>
          Array.isArray(inner?.instructions) ? inner.instructions : [],
        )
      : []),
  ];

  const transferBySource = new Map<string, number>();
  for (const ix of instructions) {
    if (ix?.program === 'system' && ix?.parsed?.type === 'transfer') {
      const info = ix.parsed?.info || {};
      if (info.destination === PROTOCOL_TREASURY_SOLANA && typeof info.source === 'string') {
        const lamports = Number(info.lamports);
        if (Number.isFinite(lamports) && lamports > 0) {
          const prev = transferBySource.get(info.source) || 0;
          transferBySource.set(info.source, prev + lamports);
        }
      }
    }
  }

  let sender = expectedSender || '';
  if (!sender) {
    for (const [src, lamports] of transferBySource.entries()) {
      if (lamports > 0 && accountKeys.some((k) => k.pubkey === src && k.signer)) {
        sender = src;
        break;
      }
    }
  }

  if (!sender || sender === PROTOCOL_TREASURY_SOLANA) {
    return null;
  }

  const senderSigned = accountKeys.some((k) => k.pubkey === sender && k.signer);
  const parsedTransferLamports = transferBySource.get(sender) || 0;
  const parsedSenderMatches = parsedTransferLamports > 0;

  const treasuryIdx = accountKeys.findIndex((k) => k.pubkey === PROTOCOL_TREASURY_SOLANA);
  const senderIdx = accountKeys.findIndex((k) => k.pubkey === sender);
  const preBalances: number[] = Array.isArray(txResult.meta?.preBalances)
    ? txResult.meta.preBalances
    : [];
  const postBalances: number[] = Array.isArray(txResult.meta?.postBalances)
    ? txResult.meta.postBalances
    : [];

  const deltaLamports =
    treasuryIdx >= 0 &&
    typeof preBalances[treasuryIdx] === 'number' &&
    typeof postBalances[treasuryIdx] === 'number'
      ? postBalances[treasuryIdx] - preBalances[treasuryIdx]
      : 0;

  const senderSpentLamports =
    senderIdx >= 0 &&
    typeof preBalances[senderIdx] === 'number' &&
    typeof postBalances[senderIdx] === 'number'
      ? preBalances[senderIdx] - postBalances[senderIdx]
      : 0;

  const rawMin = Math.min(parsedTransferLamports, deltaLamports);
  const verifiedLamports = Number.isFinite(rawMin) ? Math.max(0, rawMin) : 0;

  return {
    sender,
    verifiedLamports,
    senderSpentLamports,
    senderSigned,
    parsedSenderMatches,
    blockTime: typeof txResult.blockTime === 'number' ? txResult.blockTime : undefined,
    slot: typeof txResult.slot === 'number' ? txResult.slot : undefined,
  };
}

async function verifyTreasuryTransferOnDevnetRpc({
  signature,
  expectedSender,
  minLamports,
}: {
  signature: string;
  expectedSender: string;
  minLamports: number;
}): Promise<{ verifiedLamports: number; slot?: number }> {
  if (expectedSender === PROTOCOL_TREASURY_SOLANA) {
    throw new HttpRequestError(
      400,
      'Protocol Treasury wallet cannot send verification or SOL Power payments to itself. Please use a separate Solana Devnet wallet.',
    );
  }

  let txResult: any = null;
  let lastRpcError = '';

  for (let attempt = 0; attempt < 16; attempt++) {
    try {
      const statusResult = await postDevnetRpc(
        'getSignatureStatuses',
        [[signature], { searchTransactionHistory: true }],
        7000,
      );
      const status = statusResult?.value?.[0];
      if (status?.err) {
        throw new HttpRequestError(400, 'Transaction failed onchain on Solana Devnet.');
      }

      const isConfirmed =
        Boolean(status) &&
        (status.confirmationStatus === 'confirmed' ||
          status.confirmationStatus === 'finalized' ||
          status.confirmations === null ||
          (status.confirmations ?? 0) > 0);

      if (isConfirmed || attempt >= 2) {
        const fetchedTx = await postDevnetRpc(
          'getTransaction',
          [
            signature,
            {
              encoding: 'jsonParsed',
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0,
            },
          ],
          7000,
        );
        if (fetchedTx) {
          txResult = fetchedTx;
          break;
        }
      }
    } catch (err: any) {
      if (err instanceof HttpRequestError) {
        throw err;
      }
      lastRpcError = err?.name === 'AbortError' ? 'Devnet RPC timeout' : String(err?.message || 'RPC fetch failed');
    }
    await new Promise((r) => setTimeout(r, 1400));
  }

  if (!txResult) {
    throw new HttpRequestError(
      400,
      lastRpcError
        ? `Could not verify transaction on Solana Devnet RPC (${lastRpcError}). Please try again.`
        : 'Transaction was not confirmed on Solana Devnet yet. Confirm it was sent on Devnet and retry.',
    );
  }

  if (txResult.meta?.err) {
    throw new HttpRequestError(400, 'Transaction failed onchain on Solana Devnet.');
  }

  const inspected = inspectTreasuryTransferTransaction(txResult, expectedSender);
  if (!inspected || !inspected.senderSigned || !inspected.parsedSenderMatches) {
    throw new HttpRequestError(
      403,
      'Transaction sender/signer does not match your connected Solana wallet.',
    );
  }

  if (
    !Number.isFinite(inspected.verifiedLamports) ||
    !Number.isFinite(inspected.senderSpentLamports) ||
    inspected.verifiedLamports < minLamports ||
    inspected.senderSpentLamports < minLamports
  ) {
    throw new HttpRequestError(
      400,
      'Transaction did not deduct and transfer the exact required SOL amount to the protocol treasury on Solana Devnet.',
    );
  }

  return {
    verifiedLamports: inspected.verifiedLamports,
    slot: inspected.slot,
  };
}

function createZeroAccount(address = ''): AccountState {
  return {
    id: address,
    name: '',
    uid: '',
    email: '',
    role: 'member',
    referralCode: '',
    referredBy: null,
    isVerified: false,
    verifiedTx: undefined,
    balances: {
      purchased: 0,
      claimed: 0,
    },
    mining: {
      baseRatePerHour: 0.01,
      burnedSol: 0,
      solBurnBoostPerHour: 0,
      referralBoostPerHour: 0,
      totalMiningRatePerHour: 0,
      minedBitsUnclaimed: 0,
      minedBitsTotalClaimed: 0,
      sessionStartedAt: '',
      sessionEndsAt: '',
    },
    activities: [],
    createdAt: new Date().toISOString(),
  };
}

export function bitnoirApiPlugin(): Plugin {
  const STATE_FILE = path.join(os.tmpdir(), 'bitnoir-devnet-state.json');
  const accounts = new Map<string, AccountState>();
  const uidRegistry = new Map<string, string>(); // uid -> wallet address
  const verifiedTxRegistry = new Map<string, { owner: string; kind: 'verify' | 'sol-power' }>();
  const pendingTxSignatures = new Set<string>();
  const treasuryTxCache = new Map<string, InspectedTreasuryTransfer | null>();
  const lastReconciledAt = new Map<string, number>();
  const reconcileInFlight = new Map<string, Promise<number>>();
  const authNonces = new Map<
    string,
    { address: string; nonce: string; message: string; domain: string }
  >();
  const SESSIONS_FILE = path.join(os.tmpdir(), 'bitnoir-devnet-auth-sessions.json');
  const loadPersistedState = () => {
    try {
      if (!fs.existsSync(STATE_FILE)) return;
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;

      if (parsed.accounts && typeof parsed.accounts === 'object') {
        for (const [addr, acc] of Object.entries(parsed.accounts)) {
          if (addr && acc && typeof acc === 'object') {
            accounts.set(addr, acc as AccountState);
          }
        }
      }
      if (parsed.uidRegistry && typeof parsed.uidRegistry === 'object') {
        for (const [uid, owner] of Object.entries(parsed.uidRegistry)) {
          if (isValidUid(uid) && typeof owner === 'string' && owner) {
            uidRegistry.set(uid, owner);
          }
        }
      }
      if (parsed.verifiedTxRegistry && typeof parsed.verifiedTxRegistry === 'object') {
        for (const [sig, entry] of Object.entries(parsed.verifiedTxRegistry)) {
          const rec = entry as { owner?: unknown; kind?: unknown } | null;
          if (
            sig &&
            rec &&
            typeof rec.owner === 'string' &&
            (rec.kind === 'verify' || rec.kind === 'sol-power')
          ) {
            verifiedTxRegistry.set(sig, { owner: rec.owner, kind: rec.kind });
          }
        }
      }
    } catch {
      // Ignore corrupt/missing persisted state cache
    }
  };
  loadPersistedState();

  const persistState = () => {
    try {
      const accountsObj: Record<string, AccountState> = {};
      for (const [addr, acc] of accounts.entries()) {
        accountsObj[addr] = acc;
      }
      const uidObj: Record<string, string> = {};
      for (const [uid, owner] of uidRegistry.entries()) {
        uidObj[uid] = owner;
      }
      const txObj: Record<string, { owner: string; kind: 'verify' | 'sol-power' }> = {};
      for (const [sig, entry] of verifiedTxRegistry.entries()) {
        txObj[sig] = entry;
      }
      fs.writeFileSync(
        STATE_FILE,
        JSON.stringify({
          accounts: accountsObj,
          uidRegistry: uidObj,
          verifiedTxRegistry: txObj,
        }),
        'utf8',
      );
    } catch {
      // Ignore temp file write errors
    }
  };

  const loadPersistedSessions = (): Map<string, { address: string; signedAt: number }> => {
    const map = new Map<string, { address: string; signedAt: number }>();
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [token, info] of Object.entries(parsed)) {
            const rec = info as { address?: unknown; signedAt?: unknown } | null;
            if (
              token &&
              rec &&
              typeof rec.address === 'string' &&
              isValidSolanaBase58(rec.address)
            ) {
              map.set(token, {
                address: rec.address,
                signedAt: Number(rec.signedAt) || Date.now(),
              });
            }
          }
        }
      }
    } catch {
      // Ignore corrupt/missing session cache
    }
    return map;
  };
  const authSessions = loadPersistedSessions();
  const persistSessions = () => {
    try {
      const obj: Record<string, { address: string; signedAt: number }> = {};
      for (const [token, val] of authSessions.entries()) {
        obj[token] = val;
      }
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj), 'utf8');
    } catch {
      // Ignore temp file write errors
    }
  };
  const SESSION_COOKIE_NAME = 'bitnoir_session';
  const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

  const parseCookies = (req: any): Record<string, string> => {
    const out: Record<string, string> = {};
    const raw = String(req?.headers?.cookie || '');
    if (!raw) return out;
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx <= 0) continue;
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (!key) continue;
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
    return out;
  };

  const isSecureRequest = (req: any): boolean => {
    const xfProto = String(req?.headers?.['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    return xfProto === 'https' || Boolean(req?.socket?.encrypted);
  };

  const buildSessionCookieHeader = (req: any, token: string, maxAgeSec: number): string => {
    const secure = isSecureRequest(req);
    const attrs = [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      `Max-Age=${maxAgeSec}`,
    ];
    if (secure) {
      attrs.push('Secure', 'SameSite=None', 'Partitioned');
    } else {
      attrs.push('SameSite=Lax');
    }
    return attrs.join('; ');
  };

  const setSessionCookie = (res: any, req: any, token: string) => {
    res.setHeader('Set-Cookie', buildSessionCookieHeader(req, token, SESSION_MAX_AGE_SEC));
  };

  const clearSessionCookie = (res: any, req: any) => {
    res.setHeader('Set-Cookie', buildSessionCookieHeader(req, '', 0));
  };

  const getBearerToken = (req: any): string => {
    const raw = String(req?.headers?.authorization || '').trim();
    if (raw.toLowerCase().startsWith('bearer ')) {
      return raw.slice(7).trim();
    }
    return '';
  };

  const getAuthToken = (req: any): string => {
    const bearer = getBearerToken(req);
    if (bearer) return bearer;
    const cookies = parseCookies(req);
    return String(cookies[SESSION_COOKIE_NAME] || '').trim();
  };

  const assertSameOriginMutation = (req: any) => {
    const secFetchSite = String(req?.headers?.['sec-fetch-site'] || '').trim().toLowerCase();
    if (secFetchSite === 'cross-site' && !getBearerToken(req)) {
      throw new HttpRequestError(403, 'Cross-site mutation rejected.');
    }
    const reqHost = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const rawOrigin = String(req?.headers?.origin || '').trim();
    if (rawOrigin && reqHost) {
      try {
        if (new URL(rawOrigin).host.toLowerCase() !== reqHost) {
          throw new HttpRequestError(403, 'Cross-origin request rejected.');
        }
      } catch (err) {
        if (err instanceof HttpRequestError) throw err;
        throw new HttpRequestError(403, 'Invalid request origin.');
      }
    }
    const rawReferer = String(req?.headers?.referer || '').trim();
    if (!rawOrigin && rawReferer && reqHost) {
      try {
        if (new URL(rawReferer).host.toLowerCase() !== reqHost) {
          throw new HttpRequestError(403, 'Cross-origin referer rejected.');
        }
      } catch (err) {
        if (err instanceof HttpRequestError) throw err;
        throw new HttpRequestError(403, 'Invalid request referer.');
      }
    }
  };

  const getAuthenticatedAddress = (req: any): string => {
    const token = getAuthToken(req);
    if (!token) return '';
    const session = authSessions.get(token);
    if (!session || !isValidSolanaBase58(session.address)) return '';
    return session.address;
  };

  const getOrCreateAccount = (address: string): AccountState => {
    if (!address) return createZeroAccount('');
    let acc = accounts.get(address);
    if (!acc) {
      acc = createZeroAccount(address);
      accounts.set(address, acc);
    }
    return acc;
  };

  const requireAuthenticatedAccount = (req: any): { address: string; acc: AccountState } => {
    const authedAddress = getAuthenticatedAddress(req);
    if (!authedAddress) {
      throw new HttpRequestError(401, 'Sign in with your Solana wallet signature first.');
    }
    const acc = getOrCreateAccount(authedAddress);
    return { address: authedAddress, acc };
  };

  const TEST_USER_ADDRESS = 'TestMiner1111111111111111111111111111111111';
  const TEST_USER_UID = '88001001';

  const assignUniqueUidForAccount = (acc: AccountState, preferredUid?: string): string => {
    if (!acc.id) return '';
    if (acc.uid && isValidUid(acc.uid) && uidRegistry.get(acc.uid) === acc.id) {
      acc.name = `UID ${acc.uid}`;
      acc.referralCode = acc.uid;
      return acc.uid;
    }

    const cleanPreferred = normalizeUid(preferredUid);
    if (
      cleanPreferred &&
      isValidUid(cleanPreferred) &&
      (!uidRegistry.has(cleanPreferred) || uidRegistry.get(cleanPreferred) === acc.id)
    ) {
      uidRegistry.set(cleanPreferred, acc.id);
      acc.uid = cleanPreferred;
      acc.name = `UID ${cleanPreferred}`;
      acc.referralCode = cleanPreferred;
      return cleanPreferred;
    }

    let nonce = 0;
    while (nonce < 10000) {
      const candidate = deriveCandidateUid(acc.id, nonce);
      const owner = uidRegistry.get(candidate);
      if (!owner || owner === acc.id) {
        uidRegistry.set(candidate, acc.id);
        acc.uid = candidate;
        acc.name = `UID ${candidate}`;
        acc.referralCode = candidate;
        return candidate;
      }
      nonce++;
    }

    // Ultra-rare sequential fallback guaranteeing uniqueness
    let seq = 10000001;
    while (uidRegistry.has(String(seq))) {
      seq++;
    }
    const assigned = String(seq);
    uidRegistry.set(assigned, acc.id);
    acc.uid = assigned;
    acc.name = `UID ${assigned}`;
    acc.referralCode = assigned;
    return assigned;
  };

  const ensureTestUserAccount = (): AccountState => {
    let testAcc = accounts.get(TEST_USER_ADDRESS);
    if (!testAcc) {
      testAcc = createZeroAccount(TEST_USER_ADDRESS);
      testAcc.isVerified = true;
      testAcc.verifiedTx = 'test_verified_tx_testminer';
      testAcc.balances.purchased = 500;
      accounts.set(TEST_USER_ADDRESS, testAcc);
      assignUniqueUidForAccount(testAcc, TEST_USER_UID);
    }
    return testAcc;
  };
  ensureTestUserAccount();

  const findVerifiedAccountByUid = (rawUid: string): AccountState | null => {
    const clean = normalizeUid(rawUid);
    if (!isValidUid(clean)) return null;
    const ownerAddress = uidRegistry.get(clean);
    if (!ownerAddress) return null;
    const candidate = accounts.get(ownerAddress);
    if (candidate && candidate.isVerified && candidate.uid === clean) {
      return candidate;
    }
    return null;
  };

  const isMinerVerified = (acc: AccountState): boolean =>
    Boolean(acc.isVerified && acc.uid);

  const isMinerActive = (acc: AccountState): boolean => {
    if (!acc.mining.sessionStartedAt || !acc.mining.sessionEndsAt) return false;
    const endsAt = new Date(acc.mining.sessionEndsAt).getTime();
    return Number.isFinite(endsAt) && endsAt > Date.now();
  };

  // Rule: Unverified wallets (treated as bots/unverified) and inactive miners share 0% power.
  // Only verified AND actively mining direct referrals contribute 10% to their inviter.
  const isMinerEligibleToSharePower = (acc: AccountState): boolean =>
    isMinerVerified(acc) && isMinerActive(acc);

  const getDirectMinersFor = (inviter: AccountState): AccountState[] => {
    if (!inviter.id) return [];
    const inviterKeys = new Set(
      [inviter.uid, inviter.referralCode, inviter.id]
        .map((val) => normalizeUid(val).toLowerCase())
        .filter(Boolean)
    );
    const list: AccountState[] = [];
    for (const candidate of accounts.values()) {
      if (candidate.id === inviter.id) continue;
      const ref = normalizeUid(candidate.referredBy).toLowerCase();
      if (!ref) continue;
      if (inviterKeys.has(ref)) {
        list.push(candidate);
      }
    }
    return list;
  };

  const computeReferralBoostFor = (inviter: AccountState, visited = new Set<string>()): number => {
    if (!isMinerVerified(inviter)) return 0;
    if (visited.has(inviter.id)) return 0;
    visited.add(inviter.id);

    let boost = 0;
    for (const miner of getDirectMinersFor(inviter)) {
      if (!isMinerEligibleToSharePower(miner)) continue;
      const minerRate = Number(
        (
          miner.mining.baseRatePerHour +
          miner.mining.solBurnBoostPerHour +
          computeReferralBoostFor(miner, new Set(visited))
        ).toFixed(4)
      );
      boost += Number((minerRate * 0.1).toFixed(4));
    }
    return Number(boost.toFixed(4));
  };

  const recomputeAllReferralBoosts = () => {
    for (const acc of accounts.values()) {
      const verified = isMinerVerified(acc);
      const active = isMinerActive(acc);
      acc.mining.baseRatePerHour = verified ? 0.1 : 0.01;
      acc.mining.referralBoostPerHour = verified ? computeReferralBoostFor(acc) : 0;
      if (!active) {
        acc.mining.totalMiningRatePerHour = 0;
      } else if (verified) {
        acc.mining.totalMiningRatePerHour = Number(
          (acc.mining.baseRatePerHour + acc.mining.referralBoostPerHour + acc.mining.solBurnBoostPerHour).toFixed(4)
        );
      } else {
        acc.mining.totalMiningRatePerHour = 0.01;
      }
    }
  };

  const reconcileWalletFromDevnetRpc = async (
    acc: AccountState,
    { force = false }: { force?: boolean } = {},
  ): Promise<number> => {
    const addr = acc.id;
    if (
      !addr ||
      !isValidSolanaBase58(addr) ||
      addr === PROTOCOL_TREASURY_SOLANA ||
      addr === TEST_USER_ADDRESS
    ) {
      return 0;
    }

    const existingFlight = reconcileInFlight.get(addr);
    if (existingFlight) {
      return existingFlight;
    }

    const lastAt = lastReconciledAt.get(addr) || 0;
    if (!force && Date.now() - lastAt < 12_000) {
      return 0;
    }

    const task = (async () => {
      let newlyCreditedSol = 0;
      let changed = false;
      try {
        const sigsResult = await postDevnetRpc(
          'getSignaturesForAddress',
          [addr, { limit: 40 }],
          7000,
        );
        const sigEntries: Array<{ signature?: string; err?: unknown }> = Array.isArray(sigsResult)
          ? sigsResult
          : [];
        // Process chronologically (oldest -> newest) so verification applies before SOL Power
        const chronological = sigEntries
          .filter((entry) => Boolean(entry?.signature) && entry.err === null)
          .reverse();

        for (let i = 0; i < chronological.length; i++) {
          const sig = String(chronological[i].signature || '').trim();
          if (!sig) continue;
          if (verifiedTxRegistry.has(sig) || pendingTxSignatures.has(sig)) {
            continue;
          }

          const cacheKey = `${addr}:${sig}`;
          let inspected = treasuryTxCache.get(cacheKey);
          if (inspected === undefined) {
            try {
              const txResult = await postDevnetRpc(
                'getTransaction',
                [
                  sig,
                  {
                    encoding: 'jsonParsed',
                    commitment: 'confirmed',
                    maxSupportedTransactionVersion: 0,
                  },
                ],
                7000,
              );
              inspected = inspectTreasuryTransferTransaction(txResult, addr);
              treasuryTxCache.set(cacheKey, inspected);
            } catch {
              continue;
            }
          }

          if (
            !inspected ||
            inspected.sender !== addr ||
            !inspected.senderSigned ||
            !inspected.parsedSenderMatches ||
            inspected.verifiedLamports <= 0 ||
            inspected.senderSpentLamports < inspected.verifiedLamports
          ) {
            continue;
          }

          const { verifiedLamports, blockTime } = inspected;
          const txIso = blockTime ? new Date(blockTime * 1000).toISOString() : new Date().toISOString();

          // 1. Recover unrecorded 0.02 SOL verification fee (under 0.1 SOL SOL Power minimum)
          if (
            !acc.isVerified &&
            verifiedLamports >= VERIFICATION_FEE_LAMPORTS &&
            verifiedLamports < 100_000_000
          ) {
            verifiedTxRegistry.set(sig, { owner: addr, kind: 'verify' });
            acc.isVerified = true;
            acc.verifiedTx = sig;
            const assignedUid = assignUniqueUidForAccount(acc, acc.uid || undefined);
            if (!acc.mining.sessionStartedAt) {
              acc.mining.sessionStartedAt = new Date().toISOString();
              acc.mining.sessionEndsAt = new Date(Date.now() + 24 * 3600000).toISOString();
            }
            if (!acc.activities.some((a) => a.txHash === sig)) {
              acc.activities.unshift({
                id: Date.now() + i,
                kind: 'uid',
                title: `Verified · UID ${assignedUid} Assigned`,
                detail: `One-time Solana Devnet verification confirmed via public RPC, UID ${assignedUid} issued.`,
                txHash: sig,
                createdAt: txIso,
              });
            }
            changed = true;
            continue;
          }

          // 2. Recover unrecorded SOL Power contribution (>= 0.1 SOL) for verified accounts
          if (verifiedLamports >= 100_000_000 && acc.isVerified && sig !== acc.verifiedTx) {
            const maxSol = 3.0;
            const maxRatePerHour = 10.0;
            const currentContributed = Math.min(maxSol, acc.mining.burnedSol || 0);
            const remainingQuota = Math.max(0, Number((maxSol - currentContributed).toFixed(4)));

            verifiedTxRegistry.set(sig, { owner: addr, kind: 'sol-power' });
            changed = true;

            if (remainingQuota > 0) {
              const rawSol = Number((verifiedLamports / 1_000_000_000).toFixed(4));
              const solAmount = Number(Math.min(remainingQuota, rawSol).toFixed(4));
              if (solAmount > 0) {
                const nextContributed = Number(
                  Math.min(maxSol, currentContributed + solAmount).toFixed(4),
                );
                const prevBoost = Number(((currentContributed / maxSol) * maxRatePerHour).toFixed(4));
                const nextBoost = Number(((nextContributed / maxSol) * maxRatePerHour).toFixed(4));
                const rateBoost = Number((nextBoost - prevBoost).toFixed(4));

                acc.mining.burnedSol = nextContributed;
                acc.mining.solBurnBoostPerHour = nextBoost;
                newlyCreditedSol = Number((newlyCreditedSol + solAmount).toFixed(4));

                if (!acc.activities.some((a) => a.txHash === sig)) {
                  acc.activities.unshift({
                    id: Date.now() + i + 100,
                    kind: 'stake',
                    title: `Acquired SOL Power (${solAmount} SOL)`,
                    detail: `Acquired +${rateBoost} Bits/hr SOL Power (${acc.mining.burnedSol}/3 SOL) on Solana Devnet.`,
                    txHash: sig,
                    createdAt: txIso,
                  });
                }
              }
            }
          }
        }

        lastReconciledAt.set(addr, Date.now());
        if (changed) {
          recomputeAllReferralBoosts();
          persistState();
        }
      } catch {
        // Ignore transient Devnet RPC errors on passive reconciliation
      } finally {
        reconcileInFlight.delete(addr);
      }
      return newlyCreditedSol;
    })();

    reconcileInFlight.set(addr, task);
    return task;
  };

  function parseBody(req: any): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      const MAX_BYTES = 1_048_576; // 1MB
      let body = '';
      let size = 0;

      req.on('data', (chunk: any) => {
        const text = typeof chunk === 'string' ? chunk : chunk?.toString?.('utf8') || '';
        size += text.length;
        if (size > MAX_BYTES) {
          reject(new HttpRequestError(413, 'Request payload too large.'));
          return;
        }
        body += text;
      });
      req.on('error', () => {
        reject(new HttpRequestError(400, 'Failed to read request body.'));
      });
      req.on('end', () => {
        if (!body.trim()) {
          resolve({});
          return;
        }
        try {
          const parsed = JSON.parse(body);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            reject(new HttpRequestError(400, 'Request body must be a JSON object.'));
            return;
          }
          resolve(parsed);
        } catch {
          reject(new HttpRequestError(400, 'Invalid JSON request payload.'));
        }
      });
    });
  }

  function sendJson(res: any, status: number, data: any) {
    if (res.writableEnded) return;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  const handler = async (req: any, res: any, next: any) => {
    const url = req.url ? req.url.split('?')[0] : '';
    if (!url.startsWith('/api')) {
      return next();
    }

    try {
      if (url === '/api/healthz') {
        return sendJson(res, 200, { status: 'healthy', version: '2.0.0', time: new Date().toISOString() });
      }

      // Issue single-use, non-expiring off-chain ownership challenge nonce
      if (url === '/api/auth/nonce' && req.method === 'POST') {
        const body = await parseBody(req);
        const addr = String(body.solanaAddress || '').trim();
        const pubBytes = decodeBase58Bytes(addr);
        if (!isValidSolanaBase58(addr) || !pubBytes || pubBytes.length !== 32) {
          return sendJson(res, 400, { error: 'Valid Solana wallet address is required.' });
        }

        // Bound pending nonce map size without timing out active user prompts
        while (authNonces.size >= 5000) {
          const oldestKey = authNonces.keys().next().value;
          if (!oldestKey) break;
          authNonces.delete(oldestKey);
        }

        let originHost = '';
        const rawOrigin = String(req.headers.origin || '').trim();
        if (rawOrigin) {
          try {
            originHost = new URL(rawOrigin).host;
          } catch {
            originHost = '';
          }
        }
        const rawHost =
          originHost ||
          String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
        const domain = rawHost.replace(/[^a-zA-Z0-9.:_-]/g, '') || 'localhost';
        const nonce = crypto.randomBytes(16).toString('hex');
        const issuedAt = new Date().toISOString();

        // Clean, non-expiring off-chain verification message keeping single-use Nonce
        const message = [
          'Bitnoir — Wallet Ownership Verification',
          '',
          'Verify ownership of your Solana Devnet wallet.',
          `Wallet: ${addr}`,
          `Nonce: ${nonce}`,
        ].join('\n');

        authNonces.set(nonce, {
          address: addr,
          nonce,
          message,
          domain,
        });

        return sendJson(res, 200, {
          nonce,
          message,
          domain,
          issuedAt,
        });
      }

      // Restore persistent HttpOnly wallet session if already signed in for the requested address
      if (url === '/api/auth/session' && req.method === 'GET') {
        const parsedUrl = new URL(req.url || '', 'http://localhost');
        const requestedAddr = String(parsedUrl.searchParams.get('address') || '').trim();
        const authedAddr = getAuthenticatedAddress(req);
        if (!authedAddr || (requestedAddr && authedAddr !== requestedAddr)) {
          return sendJson(res, 200, {
            signedIn: false,
            address: '',
            account: createZeroAccount(''),
          });
        }
        const acc = getOrCreateAccount(authedAddr);
        recomputeAllReferralBoosts();
        persistState();
        void reconcileWalletFromDevnetRpc(acc)
          .then((credited) => {
            if (credited > 0) {
              recomputeAllReferralBoosts();
              persistState();
            }
          })
          .catch(() => undefined);
        return sendJson(res, 200, {
          signedIn: true,
          address: authedAddr,
          account: acc,
        });
      }

      // Verify Ed25519 wallet ownership signature & issue persistent HttpOnly cookie + session
      if (url === '/api/auth/verify' && req.method === 'POST') {
        assertSameOriginMutation(req);
        const body = await parseBody(req);
        const addr = String(body.solanaAddress || '').trim();
        const nonce = String(body.nonce || '').trim();
        const signatureBase64 = String(body.signatureBase64 || '').trim();
        const signedMessageBase64 =
          typeof body.signedMessageBase64 === 'string' ? body.signedMessageBase64.trim() : '';

        if (!isValidSolanaBase58(addr) || !nonce || !signatureBase64) {
          return sendJson(res, 400, { error: 'Wallet address, nonce, and signature are required.' });
        }

        const pending = authNonces.get(nonce);
        // Always consume nonce atomically (single-use anti-replay)
        authNonces.delete(nonce);

        if (!pending) {
          return sendJson(res, 401, { error: 'Sign-in challenge was already used or not found. Please retry.' });
        }
        if (pending.address !== addr) {
          return sendJson(res, 403, { error: 'Signature address mismatch.' });
        }

        let signatureBytes: Uint8Array;
        try {
          const buf = Buffer.from(signatureBase64, 'base64');
          signatureBytes = new Uint8Array(buf);
        } catch {
          return sendJson(res, 400, { error: 'Invalid signature encoding.' });
        }

        let messageBytes: Uint8Array;
        if (signedMessageBase64) {
          const decodedMsg = Buffer.from(signedMessageBase64, 'base64');
          const msgText = decodedMsg.toString('utf8');
          const isExactChallenge = msgText === pending.message;
          const isValidSiwsMessage =
            msgText.includes(`${pending.domain} wants you to sign in with your Solana account:`) &&
            msgText.includes(addr) &&
            msgText.includes(`Nonce: ${pending.nonce}`) &&
            msgText.includes('Chain ID: solana:devnet');

          if (!isExactChallenge && !isValidSiwsMessage) {
            return sendJson(res, 401, { error: 'Signed message does not match issued challenge.' });
          }
          messageBytes = new Uint8Array(decodedMsg);
        } else {
          messageBytes = new TextEncoder().encode(pending.message);
        }

        const isValidSig = verifySolanaEd25519Signature({
          address: addr,
          messageBytes,
          signatureBytes,
        });
        if (!isValidSig) {
          return sendJson(res, 401, { error: 'Wallet ownership signature verification failed.' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        authSessions.set(token, {
          address: addr,
          signedAt: Date.now(),
        });
        persistSessions();
        setSessionCookie(res, req, token);

        const acc = getOrCreateAccount(addr);
        await reconcileWalletFromDevnetRpc(acc);
        recomputeAllReferralBoosts();
        persistState();

        return sendJson(res, 200, {
          success: true,
          token,
          address: addr,
          account: acc,
        });
      }

      if (url === '/api/auth/logout' && req.method === 'POST') {
        assertSameOriginMutation(req);
        const token = getAuthToken(req);
        if (token) {
          authSessions.delete(token);
          persistSessions();
        }
        clearSessionCookie(res, req);
        return sendJson(res, 200, { success: true });
      }

      if (url === '/api/accounts/me' && req.method === 'GET') {
        const authed = getAuthenticatedAddress(req);
        if (!authed) {
          return sendJson(res, 200, createZeroAccount(''));
        }
        const acc = getOrCreateAccount(authed);
        recomputeAllReferralBoosts();
        return sendJson(res, 200, acc);
      }

      if (url === '/api/accounts/me/activity' && req.method === 'GET') {
        const authed = getAuthenticatedAddress(req);
        if (!authed) {
          return sendJson(res, 200, []);
        }
        return sendJson(res, 200, getOrCreateAccount(authed).activities);
      }

      if (url === '/api/accounts/check-uid' && req.method === 'GET') {
        const parsedUrl = new URL(req.url || '', 'http://localhost');
        const raw = parsedUrl.searchParams.get('uid') || '';
        const clean = normalizeUid(raw);
        if (!isValidUid(clean)) {
          return sendJson(res, 200, { exists: false, uid: clean });
        }
        const match = findVerifiedAccountByUid(clean);
        return sendJson(res, 200, {
          exists: Boolean(match),
          uid: clean,
        });
      }

      if (url === '/api/accounts/me/team' && req.method === 'GET') {
        const authed = getAuthenticatedAddress(req);
        if (!authed) {
          return sendJson(res, 200, []);
        }
        recomputeAllReferralBoosts();
        const inviter = getOrCreateAccount(authed);
        if (!isMinerVerified(inviter)) {
          return sendJson(res, 200, []);
        }
        const team = getDirectMinersFor(inviter).map((m) => {
          const verified = isMinerVerified(m);
          const active = isMinerActive(m);
          const eligible = verified && active;
          const miningPower = active
            ? Number((m.mining.baseRatePerHour + m.mining.solBurnBoostPerHour + m.mining.referralBoostPerHour).toFixed(4))
            : 0;
          const providedPower = eligible ? Number((miningPower * 0.1).toFixed(4)) : 0;
          return {
            id: m.id,
            uid: m.uid || '',
            handle: m.uid ? `UID ${m.uid}` : `${m.id.slice(0, 4)}…${m.id.slice(-4)}`,
            isVerified: verified,
            isActive: active,
            isEligible: eligible,
            status: !verified ? 'unverified' : active ? 'active' : 'inactive',
            miningPower,
            providedPower,
          };
        });
        return sendJson(res, 200, team);
      }

      // Sync authenticated wallet session strictly against server & Devnet RPC (no client trust)
      if (url === '/api/accounts/me/sync-session' && req.method === 'POST') {
        assertSameOriginMutation(req);
        const { address: authedAddress, acc } = requireAuthenticatedAccount(req);
        const body = await parseBody(req);

        const rawRef = normalizeUid(body.referredBy);
        if (
          rawRef &&
          !acc.referredBy &&
          rawRef !== acc.uid &&
          rawRef.toLowerCase() !== authedAddress.toLowerCase() &&
          (isValidUid(rawRef) || isValidSolanaBase58(rawRef))
        ) {
          acc.referredBy = rawRef;
        }

        await reconcileWalletFromDevnetRpc(acc);

        if (acc.isVerified) {
          assignUniqueUidForAccount(acc, acc.uid || undefined);
        } else {
          acc.uid = '';
          acc.name = '';
          acc.referralCode = '';
          acc.verifiedTx = undefined;
          acc.mining.burnedSol = 0;
          acc.mining.solBurnBoostPerHour = 0;
        }

        recomputeAllReferralBoosts();
        persistState();

        return sendJson(res, 200, {
          success: true,
          signedIn: true,
          account: acc,
        });
      }

      // Sync SOL Power & verification directly from Solana Devnet Treasury history for authenticated caller
      if (url === '/api/accounts/me/sync-sol-power' && req.method === 'POST') {
        assertSameOriginMutation(req);
        const { acc } = requireAuthenticatedAccount(req);
        const creditedSol = await reconcileWalletFromDevnetRpc(acc, { force: true });
        recomputeAllReferralBoosts();
        persistState();

        return sendJson(res, 200, {
          success: true,
          creditedSol,
          mining: acc.mining,
          account: acc,
        });
      }

      // Start Mining Session (requires signed-in wallet ownership)
      if (url === '/api/accounts/me/start-mining' && req.method === 'POST') {
        assertSameOriginMutation(req);
        const { acc } = requireAuthenticatedAccount(req);
        const isVerifiedNode = isMinerVerified(acc);
        const cycleHours = isVerifiedNode ? 24 : 3;
        acc.mining.sessionStartedAt = new Date().toISOString();
        acc.mining.sessionEndsAt = new Date(Date.now() + cycleHours * 3600000).toISOString();
        recomputeAllReferralBoosts();
        persistState();

        return sendJson(res, 200, {
          success: true,
          cycleHours,
          mining: acc.mining,
        });
      }

      // Wallet Verification with 0.02 SOL Onchain Devnet Transaction -> Verified via Public Devnet RPC
      if (url === '/api/accounts/me/verify-wallet' && req.method === 'POST') {
        assertSameOriginMutation(req);
        const { address: authedAddress, acc } = requireAuthenticatedAccount(req);
        const body = await parseBody(req);
        const signature = String(body.signature || '').trim();
        if (!/^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(signature)) {
          return sendJson(res, 400, { error: 'A valid Solana Devnet transaction signature is required.' });
        }

        if (acc.isVerified && acc.verifiedTx === signature && acc.uid) {
          return sendJson(res, 200, {
            success: true,
            isVerified: true,
            uid: acc.uid,
            name: acc.name,
            referralCode: acc.uid,
            referralUrl: `https://bitnoir.io/?ref=${acc.uid}`,
            signature,
            mining: acc.mining,
            message: `Wallet verified onchain. Your UID is ${acc.uid}.`,
          });
        }

        const existingTx = verifiedTxRegistry.get(signature);
        if (existingTx) {
          return sendJson(res, 409, {
            error:
              existingTx.owner !== authedAddress
                ? 'This transaction signature has already been used by another wallet.'
                : 'This transaction signature has already been processed.',
          });
        }
        if (pendingTxSignatures.has(signature)) {
          return sendJson(res, 409, { error: 'Verification for this transaction is already in progress.' });
        }

        pendingTxSignatures.add(signature);
        try {
          await verifyTreasuryTransferOnDevnetRpc({
            signature,
            expectedSender: authedAddress,
            minLamports: VERIFICATION_FEE_LAMPORTS,
          });
          verifiedTxRegistry.set(signature, { owner: authedAddress, kind: 'verify' });
        } finally {
          pendingTxSignatures.delete(signature);
        }

        acc.isVerified = true;
        acc.verifiedTx = signature;
        const assignedUid = assignUniqueUidForAccount(acc, acc.uid || undefined);

        acc.mining.sessionStartedAt = new Date().toISOString();
        acc.mining.sessionEndsAt = new Date(Date.now() + 24 * 3600000).toISOString();
        recomputeAllReferralBoosts();

        acc.activities.unshift({
          id: Date.now(),
          kind: 'uid',
          title: `Verified · UID ${assignedUid} Assigned`,
          detail: `One-time Solana Devnet verification confirmed via public RPC, UID ${assignedUid} issued.`,
          txHash: signature,
          createdAt: new Date().toISOString(),
        });
        persistState();

        return sendJson(res, 200, {
          success: true,
          isVerified: true,
          uid: assignedUid,
          name: acc.name,
          referralCode: assignedUid,
          referralUrl: `https://bitnoir.io/?ref=${assignedUid}`,
          signature,
          mining: acc.mining,
          message: `Wallet verified onchain. Your UID is ${assignedUid}.`,
        });
      }

      // Contribute SOL to Acquire SOL Power (Max 3 SOL / +10 Bits/hr per account) -> Verified via Public Devnet RPC
      if (url === '/api/accounts/me/contribute-sol' && req.method === 'POST') {
        assertSameOriginMutation(req);
        const { address: authedAddress, acc } = requireAuthenticatedAccount(req);
        if (!acc.isVerified || !acc.uid) {
          return sendJson(res, 403, {
            error: 'Verify your wallet to receive your UID before acquiring SOL Power.',
          });
        }
        const body = await parseBody(req);
        const rawSol = Number(body.solAmount);
        const txSignature = String(body.txSignature || '').trim();
        if (!Number.isFinite(rawSol) || rawSol <= 0) {
          return sendJson(res, 400, { error: 'Enter a valid SOL contribution amount.' });
        }
        if (!/^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(txSignature)) {
          return sendJson(res, 400, { error: 'A valid Solana Devnet transaction signature is required.' });
        }

        const existingContrib = verifiedTxRegistry.get(txSignature);
        if (existingContrib) {
          if (existingContrib.owner === authedAddress && existingContrib.kind === 'sol-power') {
            return sendJson(res, 200, {
              success: true,
              solContributed: Number(rawSol.toFixed(4)),
              rateBoost: 0,
              alreadyCredited: true,
              mining: acc.mining,
              message: 'SOL Power already credited for this Solana Devnet transaction.',
            });
          }
          return sendJson(res, 409, {
            error:
              existingContrib.owner !== authedAddress
                ? 'This transaction signature has already been used by another wallet.'
                : 'This transaction signature has already been processed.',
          });
        }
        if (pendingTxSignatures.has(txSignature)) {
          return sendJson(res, 409, { error: 'Verification for this transaction is already in progress.' });
        }

        const maxSol = 3.0;
        const maxRatePerHour = 10.0;
        const currentContributed = Math.min(maxSol, acc.mining.burnedSol || 0);
        const remainingQuota = Math.max(0, Number((maxSol - currentContributed).toFixed(4)));

        if (remainingQuota <= 0) {
          return sendJson(res, 400, {
            error: 'Maximum contribution limit of 3 SOL per account reached.',
          });
        }

        const minAllowed = Math.min(0.1, remainingQuota);
        if (rawSol + 1e-9 < minAllowed) {
          return sendJson(res, 400, {
            error: `Minimum SOL Power contribution is ${minAllowed} SOL.`,
          });
        }
        if (rawSol - 1e-9 > remainingQuota) {
          return sendJson(res, 400, {
            error: `Requested amount (${rawSol} SOL) exceeds remaining quota (${remainingQuota} SOL).`,
          });
        }

        const solAmount = Number(rawSol.toFixed(4));
        const expectedLamports = Math.round(solAmount * 1_000_000_000);

        pendingTxSignatures.add(txSignature);
        try {
          await verifyTreasuryTransferOnDevnetRpc({
            signature: txSignature,
            expectedSender: authedAddress,
            minLamports: expectedLamports,
          });
          // Re-check in case concurrent Devnet reconciliation already credited this exact tx
          const raceCheck = verifiedTxRegistry.get(txSignature);
          if (raceCheck && raceCheck.owner === authedAddress && raceCheck.kind === 'sol-power') {
            return sendJson(res, 200, {
              success: true,
              solContributed: solAmount,
              rateBoost: 0,
              alreadyCredited: true,
              mining: acc.mining,
              message: 'SOL Power already credited for this Solana Devnet transaction.',
            });
          }
          verifiedTxRegistry.set(txSignature, { owner: authedAddress, kind: 'sol-power' });
        } finally {
          pendingTxSignatures.delete(txSignature);
        }

        const nextContributed = Number(Math.min(maxSol, currentContributed + solAmount).toFixed(4));
        const prevBoost = Number(((currentContributed / maxSol) * maxRatePerHour).toFixed(4));
        const nextBoost = Number(((nextContributed / maxSol) * maxRatePerHour).toFixed(4));
        const rateBoost = Number((nextBoost - prevBoost).toFixed(4));

        acc.mining.burnedSol = nextContributed;
        acc.mining.solBurnBoostPerHour = nextBoost;
        recomputeAllReferralBoosts();

        acc.activities.unshift({
          id: Date.now(),
          kind: 'stake',
          title: `Acquired SOL Power (${solAmount} SOL)`,
          detail: `Acquired +${rateBoost} Bits/hr SOL Power (${acc.mining.burnedSol}/3 SOL) on Solana Devnet.`,
          txHash: txSignature,
          createdAt: new Date().toISOString(),
        });
        persistState();

        return sendJson(res, 200, {
          success: true,
          solContributed: solAmount,
          rateBoost,
          mining: acc.mining,
          message: `Acquired +${rateBoost} Bits/hr SOL Power with ${solAmount} SOL.`,
        });
      }

      // Claim accumulated mined Bits into available balance (20% minimum cycle threshold + server elapsed cap)
      if (url === '/api/accounts/me/claim-mined-bits' && req.method === 'POST') {
        assertSameOriginMutation(req);
        const { acc } = requireAuthenticatedAccount(req);
        const body = await parseBody(req);
        const requestedAmount = Number(body.amount);
        if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
          return sendJson(res, 400, {
            error: 'Invalid mined Bits claim amount.',
          });
        }

        const startedMs = acc.mining.sessionStartedAt ? Date.parse(acc.mining.sessionStartedAt) : NaN;
        if (!Number.isFinite(startedMs) || startedMs <= 0) {
          return sendJson(res, 400, {
            error: 'Start a mining session before claiming mined Bits.',
          });
        }

        const isVerifiedNode = Boolean(acc.isVerified && acc.uid);
        const cycleHours = isVerifiedNode ? 24 : 3;
        const baseCycleMs = cycleHours * 3600 * 1000;
        const maxWindowMs = 24 * 3600 * 1000;
        const elapsedMs = Math.max(0, Math.min(maxWindowMs, Date.now() - startedMs));

        if (elapsedMs + 1000 < baseCycleMs * 0.195) {
          return sendJson(res, 400, {
            error: 'Minimum claim threshold (20%) has not been reached yet.',
          });
        }

        recomputeAllReferralBoosts();
        const serverRate = isVerifiedNode
          ? Math.max(0.1, acc.mining.baseRatePerHour + acc.mining.solBurnBoostPerHour + acc.mining.referralBoostPerHour)
          : 0.01;
        const minThreshold = serverRate * cycleHours * 0.195;
        if (requestedAmount + 1e-9 < minThreshold) {
          return sendJson(res, 400, {
            error: 'Minimum claim threshold (20%) has not been reached yet.',
          });
        }

        const maxCardAllowance = isVerifiedNode ? 10.0 : 0.1;
        const maxClaimable = Number(
          (((elapsedMs / 3600000) * (serverRate + maxCardAllowance)) * 1.02 + 0.001).toFixed(4),
        );
        if (requestedAmount > maxClaimable) {
          return sendJson(res, 400, {
            error: 'Requested claim amount exceeds mined session allowance.',
          });
        }

        const unclaimed = Number(requestedAmount.toFixed(4));
        acc.mining.minedBitsTotalClaimed = Number((acc.mining.minedBitsTotalClaimed + unclaimed).toFixed(4));
        acc.mining.minedBitsUnclaimed = 0;
        acc.mining.sessionStartedAt = new Date().toISOString();
        acc.mining.sessionEndsAt = new Date(Date.now() + cycleHours * 3600000).toISOString();
        acc.balances.purchased = Number((acc.balances.purchased + unclaimed).toFixed(4));
        recomputeAllReferralBoosts();

        acc.activities.unshift({
          id: Date.now(),
          kind: 'reward',
          title: `Claimed +${unclaimed.toFixed(4)} Mined Bits`,
          detail: `Claimed +${unclaimed.toFixed(4)} mined Bits into available balance.`,
          createdAt: new Date().toISOString(),
        });
        persistState();

        return sendJson(res, 200, {
          success: true,
          claimedBits: unclaimed,
          mining: acc.mining,
          balances: acc.balances,
          message: `Claimed ${unclaimed.toFixed(4)} Bits to your balance.`,
        });
      }

      // In-App Send: UID to UID only (requires signed-in wallet + verified UID)
      if ((url === '/api/wallet/send-inapp' || url === '/api/wallet/send-onchain') && req.method === 'POST') {
        assertSameOriginMutation(req);
        const { acc } = requireAuthenticatedAccount(req);
        const body = await parseBody(req);
        const asset = String(body.asset || 'bits').toLowerCase();
        const amount = Number(body.amount);
        const rawRecipient = String(body.recipient || '').trim();
        const senderUid = normalizeUid(acc.uid || '');

        if (!acc.isVerified || !isValidUid(senderUid)) {
          return sendJson(res, 403, {
            error: 'Verify your wallet to receive your UID and send in-app transfers.',
          });
        }
        if (asset !== 'bits' && asset !== 'bitnoir') {
          return sendJson(res, 400, { error: 'Unsupported asset selected.' });
        }
        if (!rawRecipient) {
          return sendJson(res, 400, { error: 'Please enter a recipient UID.' });
        }
        const cleanRecipientUid = normalizeUid(rawRecipient);
        if (!isValidUid(cleanRecipientUid)) {
          return sendJson(res, 400, { error: 'Enter a valid 8-digit recipient UID.' });
        }
        if (cleanRecipientUid === senderUid) {
          return sendJson(res, 400, { error: 'Cannot transfer to your own UID.' });
        }
        if (!Number.isFinite(amount) || amount <= 0) {
          return sendJson(res, 400, { error: 'Please enter a valid positive amount.' });
        }

        const targetAcc = findVerifiedAccountByUid(cleanRecipientUid);
        if (!targetAcc) {
          return sendJson(res, 404, {
            error: `UID ${cleanRecipientUid} does not exist.`,
          });
        }

        if (asset === 'bits') {
          if (amount > acc.balances.purchased) {
            return sendJson(res, 400, { error: 'Insufficient Bits balance.' });
          }
          acc.balances.purchased = Number((acc.balances.purchased - amount).toFixed(4));
        } else {
          if (amount > acc.balances.claimed) {
            return sendJson(res, 400, { error: 'Insufficient Bitnoir balance.' });
          }
          acc.balances.claimed = Number((acc.balances.claimed - amount).toFixed(4));
        }

        const formattedRecipient = `UID ${cleanRecipientUid}`;

        // Credit verified recipient account in-app
        if (asset === 'bits') {
          targetAcc.balances.purchased = Number((targetAcc.balances.purchased + amount).toFixed(4));
        } else {
          targetAcc.balances.claimed = Number((targetAcc.balances.claimed + amount).toFixed(4));
        }
        targetAcc.activities.unshift({
          id: Date.now() + 1,
          kind: 'receive',
          title: `Received ${amount} ${asset === 'bits' ? 'Bits' : 'Bitnoir'} from UID ${senderUid}`,
          detail: `In-app transfer from UID ${senderUid}.`,
          amount,
          createdAt: new Date().toISOString(),
        });

        const activityItem = {
          id: Date.now(),
          kind: 'send' as const,
          title: `Sent ${amount} ${asset === 'bits' ? 'Bits' : 'Bitnoir'} to ${formattedRecipient}`,
          detail: `In-app transfer UID ${senderUid} → ${formattedRecipient}.`,
          amount,
          createdAt: new Date().toISOString(),
        };
        acc.activities.unshift(activityItem);
        persistState();

        return sendJson(res, 200, {
          success: true,
          balances: acc.balances,
          activity: activityItem,
        });
      }

      // Onchain Withdraw to External Solana Address (disabled until withdrawal launch)
      if (url === '/api/wallet/withdraw-onchain' && req.method === 'POST') {
        assertSameOriginMutation(req);
        const { acc } = requireAuthenticatedAccount(req);
        if (!acc.isVerified || !isValidUid(acc.uid)) {
          return sendJson(res, 403, { error: 'Verify your wallet before requesting withdrawals.' });
        }
        return sendJson(res, 403, {
          error: 'On-chain Bits withdrawals are not opened yet.',
        });
      }

      return sendJson(res, 404, { error: 'API endpoint not found.' });
    } catch (err: unknown) {
      if (err instanceof HttpRequestError) {
        return sendJson(res, err.status, { error: err.message });
      }
      console.error('Bitnoir API error:', err);
      return sendJson(res, 500, { error: 'Internal server error. Please try again.' });
    }
  };

  return {
    name: 'bitnoir-api-middleware',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
