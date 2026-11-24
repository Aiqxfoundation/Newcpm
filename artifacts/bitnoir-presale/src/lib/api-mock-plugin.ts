import type { Plugin } from 'vite';

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
  const seededLegacyDemo = new Set<string>();
  let activeAddress = '';

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

      if (url === '/api/accounts/me' && req.method === 'GET') {
        const acc = getActiveAccount();
        recomputeAllReferralBoosts();
        return sendJson(res, 200, acc);
      }

      if (url === '/api/accounts/me/activity' && req.method === 'GET') {
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
        if (addr.length < 32 || addr.length > 44) {
          return sendJson(res, 400, { error: 'Invalid Solana wallet address.' });
        }

        activeAddress = addr;
        const acc = getActiveAccount();

        acc.isVerified = Boolean(body.isVerified);
        acc.verifiedTx = body.verifiedTx ? String(body.verifiedTx) : undefined;
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

      // Start Mining Session (3h at 0.01/h for Base users; 24h at 0.1/h + boosts for Verified users)
      if (url === '/api/accounts/me/start-mining' && req.method === 'POST') {
        if (!activeAddress) {
          return sendJson(res, 401, { error: 'Connect a Solana wallet first.' });
        }
        const acc = getActiveAccount();
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

      // Wallet Verification with 0.02 SOL Onchain Transaction -> Immediately assigns unique UID & 24h node
      if (url === '/api/accounts/me/verify-wallet' && req.method === 'POST') {
        if (!activeAddress) {
          return sendJson(res, 401, { error: 'Connect a Solana wallet first.' });
        }
        const body = await parseBody(req);
        const signature = String(body.signature || '').trim();
        if (!signature || signature.length < 32) {
          return sendJson(res, 400, { error: 'A valid onchain verification transaction signature is required.' });
        }

        const acc = getActiveAccount();
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
          detail: `One-time wallet verification confirmed, UID ${assignedUid} issued, and referral link activated.`,
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

      // Contribute SOL to Acquire SOL Power (Max 3 SOL / +10 Bits/hr per account)
      if (url === '/api/accounts/me/contribute-sol' && req.method === 'POST') {
        const acc = getActiveAccount();
        if (!activeAddress || !acc.isVerified || !acc.uid) {
          return sendJson(res, 403, {
            error: 'Verify your wallet to receive your UID before acquiring SOL Power.',
          });
        }
        const body = await parseBody(req);
        const rawSol = Number(body.solAmount);
        if (!Number.isFinite(rawSol) || rawSol <= 0) {
          return sendJson(res, 400, { error: 'Enter a valid SOL contribution amount.' });
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
          detail: `Acquired +${rateBoost} Bits/hr SOL Power (${acc.mining.burnedSol}/3 SOL).`,
          txHash: body.txSignature ? String(body.txSignature) : undefined,
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
        const acc = getActiveAccount();
        if (!activeAddress) {
          return sendJson(res, 401, {
            error: 'Connect your Solana wallet first.',
          });
        }
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

      // In-App Send: UID to UID only (no Solana address, no onchain tx)
      if ((url === '/api/wallet/send-inapp' || url === '/api/wallet/send-onchain') && req.method === 'POST') {
        const acc = getActiveAccount();
        const body = await parseBody(req);
        const asset = String(body.asset || 'bits').toLowerCase();
        const amount = Number(body.amount);
        const rawRecipient = String(body.recipient || '').trim();
        const senderUid = normalizeUid(body.sender || acc.uid || '');

        if (!activeAddress || !acc.isVerified || !isValidUid(senderUid)) {
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
        const acc = getActiveAccount();
        const body = await parseBody(req);
        const asset = String(body.asset || 'bitnoir').toLowerCase();
        const amount = Number(body.amount);
        const destinationAddress = String(body.destinationAddress || '').trim();

        if (!activeAddress) {
          return sendJson(res, 401, { error: 'Connect your Solana wallet first.' });
        }
        if (asset !== 'bits' && asset !== 'bitnoir') {
          return sendJson(res, 400, { error: 'Unsupported asset selected.' });
        }
        if (!destinationAddress || destinationAddress.length < 32 || destinationAddress.length > 44) {
          return sendJson(res, 400, { error: 'Please enter a valid Solana wallet address (32-44 characters).' });
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
          detail: `Onchain withdrawal to external Solana wallet.`,
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
