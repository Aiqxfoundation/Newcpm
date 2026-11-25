import crypto from 'node:crypto';
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
const SOLANA_PUBLIC_TESTNET_RPC =
  (process.env.SOLANA_RPC_URL || '').trim() || 'https://api.testnet.solana.com';
const VERIFICATION_FEE_LAMPORTS = 20_000_000; // 0.02 SOL

async function verifyTreasuryTransferOnTestnetRpc({
  signature,
  expectedSender,
  minLamports,
}: {
  signature: string;
  expectedSender: string;
  minLamports: number;
}): Promise<{ verifiedLamports: number; slot?: number }> {
  let txResult: any = null;
  let lastRpcError = '';

  for (let attempt = 0; attempt < 10; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const rpcRes = await fetch(SOLANA_PUBLIC_TESTNET_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [
            signature,
            {
              encoding: 'jsonParsed',
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0,
            },
          ],
        }),
      });
      if (!rpcRes.ok) {
        lastRpcError = `Testnet RPC HTTP ${rpcRes.status}`;
      } else {
        const json = await rpcRes.json().catch(() => null);
        if (json?.error) {
          lastRpcError = String(json.error?.message || 'Testnet RPC error');
        } else if (json?.result) {
          txResult = json.result;
          break;
        }
      }
    } catch (err: any) {
      lastRpcError = err?.name === 'AbortError' ? 'Testnet RPC timeout' : String(err?.message || 'RPC fetch failed');
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 1400));
  }

  if (!txResult) {
    throw new HttpRequestError(
      400,
      lastRpcError
        ? `Could not verify transaction on Solana Testnet RPC (${lastRpcError}). Please try again.`
        : 'Transaction was not found on Solana Testnet yet. Confirm it was sent on Testnet and retry.',
    );
  }

  if (txResult.meta?.err) {
    throw new HttpRequestError(400, 'Transaction failed onchain on Solana Testnet.');
  }

  const accountKeysRaw: any[] = Array.isArray(txResult.transaction?.message?.accountKeys)
    ? txResult.transaction.message.accountKeys
    : [];
  const accountKeys = accountKeysRaw.map((k) =>
    typeof k === 'string'
      ? { pubkey: k, signer: false }
      : { pubkey: String(k?.pubkey || ''), signer: Boolean(k?.signer) },
  );

  const senderSigned = accountKeys.some(
    (k) => k.pubkey === expectedSender && k.signer,
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

  let parsedTransferLamports = 0;
  let parsedSenderMatches = false;
  for (const ix of instructions) {
    if (ix?.program === 'system' && ix?.parsed?.type === 'transfer') {
      const info = ix.parsed?.info || {};
      if (info.destination === PROTOCOL_TREASURY_SOLANA) {
        parsedTransferLamports += Number(info.lamports || 0);
        if (info.source === expectedSender) {
          parsedSenderMatches = true;
        }
      }
    }
  }

  if (!senderSigned && !parsedSenderMatches) {
    throw new HttpRequestError(
      403,
      'Transaction signer does not match your connected Solana wallet.',
    );
  }

  const treasuryIdx = accountKeys.findIndex(
    (k) => k.pubkey === PROTOCOL_TREASURY_SOLANA,
  );
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

  const verifiedLamports = Math.max(deltaLamports, parsedTransferLamports);
  if (verifiedLamports < minLamports) {
    throw new HttpRequestError(
      400,
      'Transaction did not transfer the required SOL fee to the protocol treasury on Solana Testnet.',
    );
  }

  return {
    verifiedLamports,
    slot: typeof txResult.slot === 'number' ? txResult.slot : undefined,
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
  const accounts = new Map<string, AccountState>();
  const uidRegistry = new Map<string, string>(); // uid -> wallet address
  const verifiedTxRegistry = new Map<string, { owner: string; kind: 'verify' | 'sol-power' }>();
  const authNonces = new Map<
    string,
    { address: string; nonce: string; message: string; domain: string; expiresAt: number }
  >();
  const authSessions = new Map<string, { address: string; signedAt: number; expiresAt: number }>();
  const seededLegacyDemo = new Set<string>();
  let activeAddress = '';

  const getBearerToken = (req: any): string => {
    const raw = String(req?.headers?.authorization || '').trim();
    if (raw.toLowerCase().startsWith('bearer ')) {
      return raw.slice(7).trim();
    }
    return '';
  };

  const getAuthenticatedAddress = (req: any): string => {
    const token = getBearerToken(req);
    if (!token) return '';
    const session = authSessions.get(token);
    if (!session) return '';
    if (session.expiresAt <= Date.now()) {
      authSessions.delete(token);
      return '';
    }
    return session.address;
  };

  const requireAuthenticatedAccount = (req: any): { address: string; acc: AccountState } => {
    const authedAddress = getAuthenticatedAddress(req);
    if (!authedAddress) {
      throw new HttpRequestError(401, 'Sign in with your Solana wallet signature first.');
    }
    activeAddress = authedAddress;
    let acc = accounts.get(authedAddress);
    if (!acc) {
      acc = createZeroAccount(authedAddress);
      accounts.set(authedAddress, acc);
    }
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

  const seedLegacyBtcsTestDemo = (acc: AccountState, legacyHandle?: string) => {
    if (!acc.id || !acc.uid || legacyHandle !== 'btcs' || seededLegacyDemo.has(acc.id)) return;
    seededLegacyDemo.add(acc.id);

    const testAcc = ensureTestUserAccount();

    // 1. Grant 100 test Bits
    acc.balances.purchased = Number((acc.balances.purchased + 100).toFixed(4));

    // 2. Transfer 25 Bits to test UID 88001001
    const sendAmount = 25;
    acc.balances.purchased = Number((acc.balances.purchased - sendAmount).toFixed(4));
    testAcc.balances.purchased = Number((testAcc.balances.purchased + sendAmount).toFixed(4));
    const sentAt = new Date(Date.now() - 1000 * 60 * 12).toISOString();
    const sentId = Date.now() - 120000;
    testAcc.activities.unshift({
      id: sentId + 1,
      kind: 'receive',
      title: `Received ${sendAmount} Bits from UID ${acc.uid}`,
      detail: `In-app transfer from UID ${acc.uid}.`,
      amount: sendAmount,
      createdAt: sentAt,
    });
    acc.activities.unshift({
      id: sentId,
      kind: 'send',
      title: `Sent ${sendAmount} Bits to UID ${testAcc.uid}`,
      detail: `In-app transfer UID ${acc.uid} → UID ${testAcc.uid}.`,
      amount: sendAmount,
      createdAt: sentAt,
    });

    // 3. Receive 50 Bits from test UID 88001001
    const receiveAmount = 50;
    testAcc.balances.purchased = Number((testAcc.balances.purchased - receiveAmount).toFixed(4));
    acc.balances.purchased = Number((acc.balances.purchased + receiveAmount).toFixed(4));
    const receivedAt = new Date(Date.now() - 1000 * 60 * 3).toISOString();
    const receivedId = Date.now() - 30000;
    testAcc.activities.unshift({
      id: receivedId + 1,
      kind: 'send',
      title: `Sent ${receiveAmount} Bits to UID ${acc.uid}`,
      detail: `In-app transfer UID ${testAcc.uid} → UID ${acc.uid}.`,
      amount: receiveAmount,
      createdAt: receivedAt,
    });
    acc.activities.unshift({
      id: receivedId,
      kind: 'receive',
      title: `Received ${receiveAmount} Bits from UID ${testAcc.uid}`,
      detail: `In-app transfer from UID ${testAcc.uid}.`,
      amount: receiveAmount,
      createdAt: receivedAt,
    });
  };

  const getActiveAccount = (): AccountState => {
    if (!activeAddress) return createZeroAccount('');
    let acc = accounts.get(activeAddress);
    if (!acc) {
      acc = createZeroAccount(activeAddress);
      accounts.set(activeAddress, acc);
    }
    return acc;
  };

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

      // Issue single-use SIWS (Sign-In With Solana) nonce challenge
      if (url === '/api/auth/nonce' && req.method === 'POST') {
        const body = await parseBody(req);
        const addr = String(body.solanaAddress || '').trim();
        const pubBytes = decodeBase58Bytes(addr);
        if (!isValidSolanaBase58(addr) || !pubBytes || pubBytes.length !== 32) {
          return sendJson(res, 400, { error: 'Valid Solana wallet address is required.' });
        }

        const now = Date.now();
        for (const [k, v] of authNonces.entries()) {
          if (v.expiresAt <= now) authNonces.delete(k);
        }

        const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
        const domain = rawHost.replace(/[^a-zA-Z0-9.:_-]/g, '') || 'localhost';
        const nonce = crypto.randomBytes(16).toString('hex');
        const issuedAt = new Date(now).toISOString();
        const message = [
          `${domain} wants you to sign in with your Solana account:`,
          addr,
          '',
          'Sign in to verify wallet ownership on Bitnoir (Solana Testnet).',
          '',
          'Network: Solana Testnet',
          `Nonce: ${nonce}`,
          `Issued At: ${issuedAt}`,
        ].join('\n');

        authNonces.set(nonce, {
          address: addr,
          nonce,
          message,
          domain,
          expiresAt: now + 5 * 60_000,
        });

        return sendJson(res, 200, {
          nonce,
          message,
          domain,
          issuedAt,
        });
      }

      // Verify Ed25519 wallet ownership signature & issue short-lived Bearer session
      if (url === '/api/auth/verify' && req.method === 'POST') {
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

        if (!pending || pending.expiresAt <= Date.now()) {
          return sendJson(res, 401, { error: 'Sign-in challenge expired. Please retry.' });
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
          if (!msgText.includes(pending.nonce) || !msgText.includes(addr) || !msgText.includes(pending.domain)) {
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
        const now = Date.now();
        authSessions.set(token, {
          address: addr,
          signedAt: now,
          expiresAt: now + 24 * 3600_000,
        });

        activeAddress = addr;
        const acc = getActiveAccount();
        recomputeAllReferralBoosts();

        return sendJson(res, 200, {
          success: true,
          token,
          address: addr,
          account: acc,
        });
      }

      if (url === '/api/auth/logout' && req.method === 'POST') {
        const token = getBearerToken(req);
        if (token) authSessions.delete(token);
        activeAddress = '';
        return sendJson(res, 200, { success: true });
      }

      if (url === '/api/accounts/me' && req.method === 'GET') {
        const authed = getAuthenticatedAddress(req);
        if (authed) activeAddress = authed;
        const acc = getActiveAccount();
        recomputeAllReferralBoosts();
        return sendJson(res, 200, acc);
      }

      if (url === '/api/accounts/me/activity' && req.method === 'GET') {
        const authed = getAuthenticatedAddress(req);
        if (authed) activeAddress = authed;
        return sendJson(res, 200, getActiveAccount().activities);
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
        recomputeAllReferralBoosts();
        const inviter = getActiveAccount();
        if (!activeAddress || !isMinerVerified(inviter)) {
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

      // Sync client wallet session (every wallet starts at zero until verified + active)
      if (url === '/api/accounts/me/sync-session' && req.method === 'POST') {
        const body = await parseBody(req);
        if (body.reset || !body.solanaAddress) {
          activeAddress = '';
          return sendJson(res, 200, { success: true, account: createZeroAccount('') });
        }

        const addr = String(body.solanaAddress).trim();
        if (!isValidSolanaBase58(addr)) {
          return sendJson(res, 400, { error: 'Invalid Solana wallet address.' });
        }

        activeAddress = addr;
        const acc = getActiveAccount();

        const candidateTx = typeof body.verifiedTx === 'string' ? body.verifiedTx.trim() : '';
        if (!acc.isVerified && body.isVerified && /^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(candidateTx)) {
          const existing = verifiedTxRegistry.get(candidateTx);
          if (existing && existing.owner === addr && existing.kind === 'verify') {
            acc.isVerified = true;
            acc.verifiedTx = candidateTx;
          } else if (!existing) {
            try {
              await verifyTreasuryTransferOnTestnetRpc({
                signature: candidateTx,
                expectedSender: addr,
                minLamports: VERIFICATION_FEE_LAMPORTS,
              });
              verifiedTxRegistry.set(candidateTx, { owner: addr, kind: 'verify' });
              acc.isVerified = true;
              acc.verifiedTx = candidateTx;
            } catch {
              // Ignore unconfirmed or forged verification tx on passive session sync
            }
          }
        }

        if (acc.isVerified) {
          assignUniqueUidForAccount(acc, body.uid ? String(body.uid) : undefined);
          seedLegacyBtcsTestDemo(acc, body.legacyUsername ? String(body.legacyUsername).toLowerCase() : undefined);
        } else {
          acc.uid = '';
          acc.name = '';
          acc.referralCode = '';
        }

        const rawRef = normalizeUid(body.referredBy);
        if (
          rawRef &&
          !acc.referredBy &&
          rawRef !== acc.uid &&
          rawRef.toLowerCase() !== addr.toLowerCase()
        ) {
          acc.referredBy = rawRef;
        }

        recomputeAllReferralBoosts();

        return sendJson(res, 200, { success: true, account: acc });
      }

      // Start Mining Session (requires signed-in wallet ownership)
      if (url === '/api/accounts/me/start-mining' && req.method === 'POST') {
        const { acc } = requireAuthenticatedAccount(req);
        const isVerifiedNode = isMinerVerified(acc);
        const cycleHours = isVerifiedNode ? 24 : 3;
        acc.mining.sessionStartedAt = new Date().toISOString();
        acc.mining.sessionEndsAt = new Date(Date.now() + cycleHours * 3600000).toISOString();
        recomputeAllReferralBoosts();

        return sendJson(res, 200, {
          success: true,
          cycleHours,
          mining: acc.mining,
        });
      }

      // Wallet Verification with 0.02 SOL Onchain Testnet Transaction -> Verified via Public Testnet RPC
      if (url === '/api/accounts/me/verify-wallet' && req.method === 'POST') {
        const { address: authedAddress, acc } = requireAuthenticatedAccount(req);
        const body = await parseBody(req);
        const signature = String(body.signature || '').trim();
        if (!/^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(signature)) {
          return sendJson(res, 400, { error: 'A valid Solana Testnet transaction signature is required.' });
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
        if (existingTx && existingTx.owner !== authedAddress) {
          return sendJson(res, 409, { error: 'This transaction signature has already been used by another wallet.' });
        }

        await verifyTreasuryTransferOnTestnetRpc({
          signature,
          expectedSender: authedAddress,
          minLamports: VERIFICATION_FEE_LAMPORTS,
        });

        verifiedTxRegistry.set(signature, { owner: authedAddress, kind: 'verify' });
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
          detail: `One-time Solana Testnet verification confirmed via public RPC, UID ${assignedUid} issued.`,
          txHash: signature,
          createdAt: new Date().toISOString(),
        });

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

      // Contribute SOL to Acquire SOL Power (Max 3 SOL / +10 Bits/hr per account) -> Verified via Public Testnet RPC
      if (url === '/api/accounts/me/contribute-sol' && req.method === 'POST') {
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
          return sendJson(res, 400, { error: 'A valid Solana Testnet transaction signature is required.' });
        }
        if (verifiedTxRegistry.has(txSignature)) {
          return sendJson(res, 409, { error: 'This transaction signature has already been credited.' });
        }

        const maxSol = 3.0;
        const maxRatePerHour = 10.0;
        const currentContributed = Math.min(maxSol, acc.mining.burnedSol || 0);
        const remainingQuota = Math.max(0, Number((maxSol - currentContributed).toFixed(3)));

        if (remainingQuota <= 0) {
          return sendJson(res, 400, {
            error: 'Maximum contribution limit of 3 SOL per account reached.',
          });
        }

        const solAmount = Number(Math.max(Math.min(0.1, remainingQuota), Math.min(remainingQuota, rawSol)).toFixed(2));
        const expectedLamports = Math.round(solAmount * 1_000_000_000);

        await verifyTreasuryTransferOnTestnetRpc({
          signature: txSignature,
          expectedSender: authedAddress,
          minLamports: expectedLamports,
        });
        verifiedTxRegistry.set(txSignature, { owner: authedAddress, kind: 'sol-power' });

        const nextContributed = Number(Math.min(maxSol, currentContributed + solAmount).toFixed(3));
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
          detail: `Acquired +${rateBoost} Bits/hr SOL Power (${acc.mining.burnedSol}/3 SOL) on Solana Testnet.`,
          txHash: txSignature,
          createdAt: new Date().toISOString(),
        });

        return sendJson(res, 200, {
          success: true,
          solContributed: solAmount,
          rateBoost,
          mining: acc.mining,
          message: `Acquired +${rateBoost} Bits/hr SOL Power with ${solAmount} SOL.`,
        });
      }

      // Claim accumulated mined Bits into available balance (20% minimum cycle threshold)
      if (url === '/api/accounts/me/claim-mined-bits' && req.method === 'POST') {
        const { acc } = requireAuthenticatedAccount(req);
        const body = await parseBody(req);
        const unclaimed = Number(body.amount);
        if (!Number.isFinite(unclaimed) || unclaimed <= 0) {
          return sendJson(res, 400, {
            error: 'Invalid mined Bits claim amount.',
          });
        }

        const isVerifiedNode = Boolean(acc.isVerified && acc.uid);
        const cycleHours = isVerifiedNode ? 24 : 3;
        const rate = isVerifiedNode
          ? Math.max(0.1, acc.mining.totalMiningRatePerHour || 0.1)
          : 0.01;
        const minThreshold = rate * cycleHours * 0.2;

        if (unclaimed + 1e-9 < minThreshold) {
          return sendJson(res, 400, {
            error: 'Minimum claim threshold (20%) has not been reached yet.',
          });
        }

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
        const { acc } = requireAuthenticatedAccount(req);
        const body = await parseBody(req);
        const asset = String(body.asset || 'bits').toLowerCase();
        const amount = Number(body.amount);
        const rawRecipient = String(body.recipient || '').trim();
        const senderUid = normalizeUid(body.sender || acc.uid || '');

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

        return sendJson(res, 200, {
          success: true,
          balances: acc.balances,
          activity: activityItem,
        });
      }

      // Onchain Withdraw to External Solana Address
      if (url === '/api/wallet/withdraw-onchain' && req.method === 'POST') {
        const { acc } = requireAuthenticatedAccount(req);
        const body = await parseBody(req);
        const asset = String(body.asset || 'bitnoir').toLowerCase();
        const amount = Number(body.amount);
        const destinationAddress = String(body.destinationAddress || '').trim();
        if (asset !== 'bits' && asset !== 'bitnoir') {
          return sendJson(res, 400, { error: 'Unsupported asset selected.' });
        }
        if (!isValidSolanaBase58(destinationAddress)) {
          return sendJson(res, 400, { error: 'Please enter a valid Solana wallet address.' });
        }
        if (!Number.isFinite(amount) || amount <= 0) {
          return sendJson(res, 400, { error: 'Please enter a valid positive amount.' });
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

        const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        const txSig =
          String(body.txSignature || '').trim() ||
          Array.from({ length: 88 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

        const activityItem = {
          id: Date.now(),
          kind: 'withdraw' as const,
          title: `Withdrew ${amount} ${asset === 'bits' ? 'Bits' : 'Bitnoir'} Onchain`,
          detail: `Onchain withdrawal to ${destinationAddress.slice(0, 6)}…${destinationAddress.slice(-6)}.`,
          amount,
          asset,
          txHash: txSig,
          createdAt: new Date().toISOString(),
        };
        acc.activities.unshift(activityItem);

        return sendJson(res, 200, {
          success: true,
          signature: txSig,
          txHash: txSig,
          balances: acc.balances,
          activity: activityItem,
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
