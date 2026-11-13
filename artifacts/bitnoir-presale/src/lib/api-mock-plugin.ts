import type { Plugin } from 'vite';

interface AccountState {
  id: string;
  name: string;
  username: string;
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
    kind: 'send' | 'receive' | 'withdraw' | 'verify' | 'username' | 'reward' | 'stake';
    title: string;
    detail: string;
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

function createZeroAccount(address = ''): AccountState {
  return {
    id: address,
    name: '',
    username: '',
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
  let activeAddress = '';

  const getActiveAccount = (): AccountState => {
    if (!activeAddress) return createZeroAccount('');
    let acc = accounts.get(activeAddress);
    if (!acc) {
      acc = createZeroAccount(activeAddress);
      accounts.set(activeAddress, acc);
    }
    return acc;
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
        return sendJson(res, 200, getActiveAccount());
      }

      if (url === '/api/accounts/me/activity' && req.method === 'GET') {
        return sendJson(res, 200, getActiveAccount().activities);
      }

      if (url === '/api/accounts/me/team' && req.method === 'GET') {
        return sendJson(res, 200, []);
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
        const uname = acc.isVerified ? String(body.username || '').trim().replace(/^@/, '').toLowerCase() : '';
        acc.username = uname;
        acc.name = uname ? `@${uname}` : '';
        acc.referralCode = uname;

        if (acc.isVerified && uname) {
          acc.mining.baseRatePerHour = 0.1;
          acc.mining.totalMiningRatePerHour = acc.mining.sessionStartedAt
            ? Number((0.1 + acc.mining.referralBoostPerHour + acc.mining.solBurnBoostPerHour).toFixed(4))
            : 0;
        } else {
          acc.mining.baseRatePerHour = 0.01;
          acc.mining.totalMiningRatePerHour = acc.mining.sessionStartedAt ? 0.01 : 0;
        }

        return sendJson(res, 200, { success: true, account: acc });
      }

      // Start Mining Session (3h at 0.01/h for Base users; 24h at 0.1/h + boosts for Verified users)
      if (url === '/api/accounts/me/start-mining' && req.method === 'POST') {
        if (!activeAddress) {
          return sendJson(res, 401, { error: 'Connect a Solana wallet first.' });
        }
        const acc = getActiveAccount();
        const isVerifiedNode = Boolean(acc.isVerified && acc.username);
        const cycleHours = isVerifiedNode ? 24 : 3;
        acc.mining.baseRatePerHour = isVerifiedNode ? 0.1 : 0.01;
        acc.mining.totalMiningRatePerHour = isVerifiedNode
          ? Number((0.1 + acc.mining.referralBoostPerHour + acc.mining.solBurnBoostPerHour).toFixed(4))
          : 0.01;
        acc.mining.sessionStartedAt = new Date().toISOString();
        acc.mining.sessionEndsAt = new Date(Date.now() + cycleHours * 3600000).toISOString();

        return sendJson(res, 200, {
          success: true,
          cycleHours,
          mining: acc.mining,
        });
      }

      // Wallet Verification with 0.02 SOL Onchain Transaction to Treasury Wallet
      if (url === '/api/accounts/me/verify-wallet' && req.method === 'POST') {
        if (!activeAddress) {
          return sendJson(res, 401, { error: 'Connect a Solana wallet first.' });
        }
        const body = await parseBody(req);
        const signature = String(body.signature || '').trim();
        if (!signature || signature.length < 32) {
          return sendJson(res, 400, { error: 'A valid onchain 0.02 SOL transaction signature is required.' });
        }

        const acc = getActiveAccount();
        acc.isVerified = true;
        acc.verifiedTx = signature;

        acc.activities.unshift({
          id: Date.now(),
          kind: 'verify',
          title: 'Wallet Verified Onchain',
          detail: '0.02 SOL one-time verification confirmed onchain.',
          txHash: signature,
          createdAt: new Date().toISOString(),
        });

        return sendJson(res, 200, {
          success: true,
          isVerified: true,
          signature,
          message: 'Wallet verified onchain successfully. You are now eligible to set your @username.',
        });
      }

      // Set Custom Username Handle (Only available after 0.02 SOL onchain verification)
      if (url === '/api/accounts/me/set-username' && req.method === 'POST') {
        if (!activeAddress) {
          return sendJson(res, 401, { error: 'Connect a Solana wallet first.' });
        }
        const acc = getActiveAccount();
        if (!acc.isVerified) {
          return sendJson(res, 403, {
            error: 'Verify your Solana wallet with a one-time 0.02 SOL onchain transaction before setting a username.',
          });
        }
        const body = await parseBody(req);
        const cleanUsername = String(body.username || '').trim().replace(/^@/, '').toLowerCase();

        if (!cleanUsername || cleanUsername.length < 3 || cleanUsername.length > 20 || !/^[a-z0-9_]+$/.test(cleanUsername)) {
          return sendJson(res, 400, { error: 'Username must be 3-20 characters of lowercase letters, numbers, or underscore.' });
        }

        acc.username = cleanUsername;
        acc.name = `@${cleanUsername}`;
        acc.referralCode = cleanUsername;
        acc.mining.baseRatePerHour = 0.1;
        acc.mining.totalMiningRatePerHour = Number(
          (acc.mining.baseRatePerHour + acc.mining.referralBoostPerHour + acc.mining.solBurnBoostPerHour).toFixed(4)
        );
        acc.mining.sessionStartedAt = new Date().toISOString();
        acc.mining.sessionEndsAt = new Date(Date.now() + 24 * 3600000).toISOString();

        acc.activities.unshift({
          id: Date.now(),
          kind: 'username',
          title: `Handle @${cleanUsername} Activated`,
          detail: `Username @${cleanUsername} registered, referral link generated, and Bits mining started.`,
          txHash: acc.verifiedTx,
          createdAt: new Date().toISOString(),
        });

        return sendJson(res, 200, {
          success: true,
          username: cleanUsername,
          name: `@${cleanUsername}`,
          referralCode: cleanUsername,
          referralUrl: `https://bitnoir.io/?ref=${cleanUsername}`,
          mining: acc.mining,
        });
      }

      // Contribute SOL to Acquire SOL Power (Max 10 SOL per account)
      if (url === '/api/accounts/me/contribute-sol' && req.method === 'POST') {
        const acc = getActiveAccount();
        if (!activeAddress || !acc.isVerified || !acc.username) {
          return sendJson(res, 403, {
            error: 'Verify your wallet and set your @username before acquiring SOL Power.',
          });
        }
        const body = await parseBody(req);
        const rawSol = Number(body.solAmount);
        if (!Number.isFinite(rawSol) || rawSol <= 0) {
          return sendJson(res, 400, { error: 'Enter a valid SOL contribution amount.' });
        }

        const currentContributed = acc.mining.burnedSol || 0;
        const remainingQuota = Math.max(0, 10.0 - currentContributed);

        if (remainingQuota <= 0) {
          return sendJson(res, 400, {
            error: 'Maximum contribution limit of 10 SOL per account reached.',
          });
        }

        const solAmount = Number(Math.max(0.1, Math.min(remainingQuota, rawSol)).toFixed(2));
        const rateBoost = Number((solAmount * 5.0).toFixed(4));

        acc.mining.burnedSol = Number((currentContributed + solAmount).toFixed(3));
        acc.mining.solBurnBoostPerHour = Number((acc.mining.solBurnBoostPerHour + rateBoost).toFixed(4));
        acc.mining.totalMiningRatePerHour = Number(
          (acc.mining.baseRatePerHour + acc.mining.referralBoostPerHour + acc.mining.solBurnBoostPerHour).toFixed(4)
        );

        acc.activities.unshift({
          id: Date.now(),
          kind: 'stake',
          title: `Contributed ${solAmount} SOL for SOL Power`,
          detail: `Acquired +${rateBoost} Bits/hr SOL Power (${acc.mining.burnedSol}/10 SOL).`,
          txHash: body.txSignature ? String(body.txSignature) : undefined,
          createdAt: new Date().toISOString(),
        });

        return sendJson(res, 200, {
          success: true,
          solContributed: solAmount,
          rateBoost,
          mining: acc.mining,
          message: `Contributed ${solAmount} SOL! Acquired +${rateBoost} Bits/hr SOL Power.`,
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

        const isVerifiedNode = Boolean(acc.isVerified && acc.username);
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
        acc.mining.sessionStartedAt = '';
        acc.mining.sessionEndsAt = '';
        acc.mining.totalMiningRatePerHour = 0;
        acc.balances.purchased = Number((acc.balances.purchased + unclaimed).toFixed(4));

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
          message: `Claimed +${unclaimed.toFixed(4)} Bits to your available balance!`,
        });
      }

      // In-App Send: Username to Username only (no Solana address, no onchain tx)
      if ((url === '/api/wallet/send-inapp' || url === '/api/wallet/send-onchain') && req.method === 'POST') {
        const acc = getActiveAccount();
        const body = await parseBody(req);
        const asset = String(body.asset || 'bits').toLowerCase();
        const amount = Number(body.amount);
        const rawRecipient = String(body.recipient || '').trim();
        const senderHandle = String(body.sender || acc.username || '').replace(/^@/, '').toLowerCase();

        if (!activeAddress || !acc.isVerified || !senderHandle) {
          return sendJson(res, 403, {
            error: 'Verify your wallet and set your @username to send in-app transfers.',
          });
        }
        if (asset !== 'bits' && asset !== 'bitnoir') {
          return sendJson(res, 400, { error: 'Unsupported asset selected.' });
        }
        if (!rawRecipient) {
          return sendJson(res, 400, { error: 'Please enter a recipient @username.' });
        }
        const cleanRecipientHandle = rawRecipient.replace(/^@/, '').toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(cleanRecipientHandle)) {
          return sendJson(res, 400, { error: 'Enter a valid recipient @username (3-20 lowercase letters, numbers, or underscore).' });
        }
        if (cleanRecipientHandle === senderHandle) {
          return sendJson(res, 400, { error: 'Cannot transfer to your own @username.' });
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

        const formattedRecipient = `@${cleanRecipientHandle}`;

        // Credit recipient account in-app if registered in this node
        for (const target of accounts.values()) {
          if (target.username === cleanRecipientHandle) {
            if (asset === 'bits') {
              target.balances.purchased = Number((target.balances.purchased + amount).toFixed(4));
            } else {
              target.balances.claimed = Number((target.balances.claimed + amount).toFixed(4));
            }
            target.activities.unshift({
              id: Date.now() + 1,
              kind: 'receive',
              title: `Received ${amount} ${asset === 'bits' ? 'Bits' : 'Bitnoir'} from @${senderHandle}`,
              detail: `In-app transfer from @${senderHandle}.`,
              createdAt: new Date().toISOString(),
            });
          }
        }

        const activityItem = {
          id: Date.now(),
          kind: 'send' as const,
          title: `Sent ${amount} ${asset === 'bits' ? 'Bits' : 'Bitnoir'} to ${formattedRecipient}`,
          detail: `In-app transfer @${senderHandle} → ${formattedRecipient}.`,
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
