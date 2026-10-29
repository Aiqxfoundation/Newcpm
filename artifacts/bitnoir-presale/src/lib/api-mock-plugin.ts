import type { Plugin } from 'vite';

export function bitnoirApiPlugin(): Plugin {
  // Protocol configuration
  const BITNOIR_REFERENCE_PRICE = 50; // $50 protocol accounting valuation
  const USDT_PER_BITS = 0.1; // 100 USDT = 1,000 Bits
  const MIN_CLAIM_USDT = 2; // Minimum $2 claim threshold
  const MIN_CLAIM_BITNOIR = MIN_CLAIM_USDT / BITNOIR_REFERENCE_PRICE; // 0.04 BITS

  let launchSettings = {
    saleOpen: true,
    stakingOpen: true,
    claimsOpen: true,
    swapsOpen: false,
  };

  const depositAddresses: Array<{ id: number; chain: string; address: string; active: boolean }> = [
    { id: 1, chain: 'bnb', address: '0x71C8360437E55928d11B3e264259837a7F9D7065', active: true },
    { id: 2, chain: 'ethereum', address: '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7', active: true },
    { id: 3, chain: 'polygon', address: '0x3507e4978e0eb83315d20df86ca0b976c0e40ccb', active: true },
  ];

  const batches = [
    { id: 1, name: 'Genesis', pricePerToken: 0.10, tokenSupply: 2100000, tokensSold: 2100000, status: 'complete' },
    { id: 2, name: 'Early Adopter', pricePerToken: 0.105, tokenSupply: 2100000, tokensSold: 2100000, status: 'complete' },
    { id: 3, name: 'Growth', pricePerToken: 0.11, tokenSupply: 2100000, tokensSold: 625000, status: 'active' },
    { id: 4, name: 'Final Public', pricePerToken: 0.12, tokenSupply: 2100000, tokensSold: 0, status: 'upcoming' },
  ];

  // User state
  const userAccount = {
    id: 'member-alpha',
    name: 'SatoshiNode',
    email: 'node@bitnoir.io',
    role: 'admin',
    referralCode: 'BITS-SATOSHINODE',
    referredBy: null as string | null,
    xp: 350,
    balances: {
      purchased: 5000,      // 5,000 Bits ($500 value) available for staking
      staked: 10000,        // 10,000 Bits locked in active staking position
      burned: 10000,        // 10,000 Bits burned
      claimable: 0.1600,    // 0.16 Bitnoir tokens ($8.00 at $50 reference price - ready for withdrawal/claim!)
      claimed: 0.0400,      // 0.04 Bitnoir tokens previously claimed ($2.00)
      swapAvailable: 0,
    },
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
  };

  // Staking positions
  let nextPositionId = 2;
  const stakingPositions: Array<{
    id: number;
    stakedBits: number;
    lockupDays: number;
    rewardRate: number;
    accruedReward: number;
    principalReturnTokens: number;
    createdAt: string;
    unlocksAt: string;
    status: 'active' | 'matured' | 'claimed';
  }> = [
    {
      id: 1,
      stakedBits: 10000,
      lockupDays: 60,
      rewardRate: 0.16,
      accruedReward: 0.1600,
      principalReturnTokens: 20.0,
      createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
      unlocksAt: new Date(Date.now() + 46 * 86400000).toISOString(),
      status: 'active' as const,
    },
  ];

  let nextWithdrawalId = 2;
  const withdrawalsList: Array<{
    id: number;
    userId: string;
    asset: 'bitnoir' | 'usdt' | 'bits';
    amount: number;
    amountUsd: number;
    destinationAddress: string;
    chain: string;
    status: 'completed' | 'processing' | 'pending';
    txHash: string;
    createdAt: string;
  }> = [
    {
      id: 1,
      userId: 'member-alpha',
      asset: 'bitnoir',
      amount: 0.0400,
      amountUsd: 2.00,
      destinationAddress: '0x71C8360437E55928d11B3e264259837a7F9D7065',
      chain: 'bnb',
      status: 'completed',
      txHash: '0x3a4f6d89201947eef091a18276f7b1928374a56b192847c5d6e7f8a9b0c1d2e3',
      createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    },
  ];

  const activityList: Array<{ id: number; kind: string; title: string; detail: string; createdAt: string }> = [
    {
      id: 104,
      kind: 'withdraw',
      title: 'Bitnoir Rewards Dispatched',
      detail: '0.0400 Bitnoir ($2.00) sent to 0x71C8...7065 on BNB Smart Chain.',
      createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    },
    {
      id: 103,
      kind: 'stake',
      title: 'Bits Staked & Burned',
      detail: '10,000 Bits burned into 60-day staking term at 16% reward rate.',
      createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    },
    {
      id: 102,
      kind: 'deposit',
      title: 'Deposit Approved',
      detail: '1,000 USDT on BNB Smart Chain credited as 10,000 Bits.',
      createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
    },
    {
      id: 101,
      kind: 'deposit',
      title: 'Deposit Approved',
      detail: '500 USDT on BNB Smart Chain credited as 5,000 Bits.',
      createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    },
  ];

  let nextDepositId = 3;
  const depositsList: Array<{
    id: number;
    userId: string;
    userName: string;
    userEmail: string;
    batchId: number;
    chain: string;
    amountUsdt: number;
    pricePerToken: number;
    estimatedTokens: number;
    status: 'pending' | 'approved' | 'rejected';
    reference: string;
    receiveAddress: string;
    txHash: string | null;
    tokensCredited: number | null;
    rejectionReason: string | null;
    createdAt: string;
  }> = [
    {
      id: 1,
      userId: 'member-alpha',
      userName: 'SatoshiNode',
      userEmail: 'node@bitnoir.io',
      batchId: 3,
      chain: 'bnb',
      amountUsdt: 500,
      pricePerToken: 0.10,
      estimatedTokens: 5000,
      status: 'approved',
      reference: 'BNO-GENESIS-7A',
      receiveAddress: '0x71C8360437E55928d11B3e264259837a7F9D7065',
      txHash: '0x94f1c7d2e93b123456789abcdef0123456789abcdef0123456789abcdef01234',
      tokensCredited: 5000,
      rejectionReason: null,
      createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    },
    {
      id: 2,
      userId: 'member-alpha',
      userName: 'SatoshiNode',
      userEmail: 'node@bitnoir.io',
      batchId: 3,
      chain: 'bnb',
      amountUsdt: 1000,
      pricePerToken: 0.10,
      estimatedTokens: 10000,
      status: 'approved',
      reference: 'BNO-PRESALE-9B',
      receiveAddress: '0x71C8360437E55928d11B3e264259837a7F9D7065',
      txHash: '0x83e2b1c0a82b987654321fedcba0987654321fedcba0987654321fedcba09876',
      tokensCredited: 10000,
      rejectionReason: null,
      createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
    },
  ];

  function parseBody(req: any): Promise<any> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk: any) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  function sendJson(res: any, status: number, data: any) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  const handler = async (req: any, res: any, next: any) => {
    const url = req.url ? req.url.split('?')[0] : '';
    if (!url.startsWith('/api')) {
      return next();
    }

    if (url === '/api/healthz') {
      return sendJson(res, 200, { status: 'healthy', version: '2.0.0', time: new Date().toISOString() });
    }

    if (url === '/api/presale/overview' && req.method === 'GET') {
      const totalRaised = depositsList
        .filter((d) => d.status === 'approved')
        .reduce((sum, d) => sum + d.amountUsdt, 482500);
      const totalSold = batches.reduce((sum, b) => sum + b.tokensSold, 0);

      return sendJson(res, 200, {
        tokenName: 'Bitnoir',
        tokenSymbol: 'BITS',
        totalSupply: 21000000, // 21,000,000 hard cap
        basePrice: 0.1,
        referencePrice: BITNOIR_REFERENCE_PRICE,
        usdtPerBits: USDT_PER_BITS,
        minClaimUsdt: MIN_CLAIM_USDT,
        minClaimBitnoir: MIN_CLAIM_BITNOIR,
        totalRaisedUsdt: totalRaised,
        totalTokensSold: totalSold,
        publicSaleSupply: 8400000,
        allocations: [
          { name: 'Public Sale', percent: 40, tokens: 8400000 },
          { name: 'Staking & Yield Reserve', percent: 20, tokens: 4200000 },
          { name: 'CEX Listing & Liquidity', percent: 21, tokens: 4410000 },
          { name: 'Market Making & Stability', percent: 11, tokens: 2310000 },
          { name: 'Airdrop & Ecosystem Growth', percent: 8, tokens: 1680000 },
        ],
        batches,
        launch: launchSettings,
        supportedChains: ['bnb', 'ethereum', 'polygon', 'arbitrum', 'base', 'solana'],
      });
    }

    if (url === '/api/presale/deposit-addresses' && req.method === 'GET') {
      return sendJson(res, 200, depositAddresses.filter((a) => a.active));
    }

    if (url === '/api/accounts/me' && req.method === 'GET') {
      return sendJson(res, 200, {
        ...userAccount,
        stakingPositions,
      });
    }

    if (url === '/api/accounts/me/activity' && req.method === 'GET') {
      return sendJson(res, 200, activityList);
    }

    if (url === '/api/accounts/me/deposits' && req.method === 'GET') {
      const myDeposits = depositsList.map((d) => ({
        id: d.id,
        chain: d.chain,
        amountUsdt: d.amountUsdt,
        pricePerToken: d.pricePerToken,
        estimatedTokens: d.estimatedTokens,
        status: d.status,
        reference: d.reference,
        receiveAddress: d.receiveAddress,
        txHash: d.txHash,
        tokensCredited: d.tokensCredited,
        rejectionReason: d.rejectionReason,
        createdAt: d.createdAt,
      }));
      return sendJson(res, 200, myDeposits);
    }

    if (url === '/api/accounts/me/referral' && req.method === 'POST') {
      const body = await parseBody(req);
      const code = String(body.code || '').trim().toUpperCase();
      if (!code) {
        return sendJson(res, 400, { error: 'Please enter a referral code.' });
      }
      if (userAccount.referredBy) {
        return sendJson(res, 400, { error: 'A referral code has already been linked to this account.' });
      }
      userAccount.referredBy = code;
      userAccount.xp += 250;
      activityList.unshift({
        id: Date.now(),
        kind: 'referral',
        title: 'Referral Code Linked',
        detail: `Linked to sponsor ${code}. 250 bonus XP credited.`,
        createdAt: new Date().toISOString(),
      });
      return sendJson(res, 200, { applied: true, xpAwarded: 250, message: `Invite code ${code} verified. 250 XP added.` });
    }

    if (url === '/api/accounts/me/stake' && req.method === 'POST') {
      const body = await parseBody(req);
      const amount = Number(body.amountTokens) || 0;
      const days = Number(body.lockupDays) || 30;

      if (amount <= 0 || amount > userAccount.balances.purchased) {
        return sendJson(res, 400, { error: 'Insufficient available Bits balance.' });
      }

      if (days < 30 || days > 90) {
        return sendJson(res, 400, { error: 'Lockup duration must be between 30 and 90 days.' });
      }

      // Explicit reward rate
      const rate = days === 30 ? 0.08 : days === 60 ? 0.16 : days >= 90 ? 0.28 : 0.08 + ((days - 30) / 60) * 0.20;
      
      // Burning mechanism: Staked Bits are permanently burned
      userAccount.balances.purchased -= amount;
      userAccount.balances.staked += amount;
      userAccount.balances.burned = (userAccount.balances.burned || 0) + amount;

      // Principal return calculation at protocol reference price
      const principalUsdtEquivalent = amount * USDT_PER_BITS;
      const principalTokens = principalUsdtEquivalent / BITNOIR_REFERENCE_PRICE;

      const position = {
        id: nextPositionId++,
        stakedBits: amount,
        lockupDays: days,
        rewardRate: Number(rate.toFixed(4)),
        accruedReward: 0,
        principalReturnTokens: Number(principalTokens.toFixed(4)),
        createdAt: new Date().toISOString(),
        unlocksAt: new Date(Date.now() + days * 86400000).toISOString(),
        status: 'active' as const,
      };

      stakingPositions.unshift(position);

      activityList.unshift({
        id: Date.now(),
        kind: 'stake',
        title: 'Bits Staked & Burned',
        detail: `${amount.toLocaleString()} Bits burned permanently into a ${days}-day staking term at ${(rate * 100).toFixed(0)}% reward rate.`,
        createdAt: new Date().toISOString(),
      });

      return sendJson(res, 200, {
        ...userAccount,
        position,
      });
    }

    // Claim farming rewards endpoint
    if (url === '/api/accounts/me/claim' && req.method === 'POST') {
      const claimable = userAccount.balances.claimable;
      const claimableUsdtValue = claimable * BITNOIR_REFERENCE_PRICE;

      if (claimableUsdtValue < MIN_CLAIM_USDT) {
        return sendJson(res, 400, {
          error: `Minimum claim threshold is $${MIN_CLAIM_USDT.toFixed(2)} worth of Bitnoir (${MIN_CLAIM_BITNOIR} BITS). You have $${claimableUsdtValue.toFixed(2)}.`,
        });
      }

      userAccount.balances.claimed += claimable;
      userAccount.balances.claimable = 0;

      activityList.unshift({
        id: Date.now(),
        kind: 'claim',
        title: 'Farming Rewards Claimed',
        detail: `Successfully claimed ${claimable.toFixed(4)} Bitnoir tokens ($${claimableUsdtValue.toFixed(2)} reference value).`,
        createdAt: new Date().toISOString(),
      });

      return sendJson(res, 200, {
        claimedAmount: claimable,
        balances: userAccount.balances,
        message: `Claimed ${claimable.toFixed(4)} Bitnoir tokens.`,
      });
    }

    if (url === '/api/deposits' && req.method === 'POST') {
      const body = await parseBody(req);
      const chain = body.chain || 'bnb';
      const amountUsdt = Number(body.amountUsdt) || 0;

      if (amountUsdt <= 0) {
        return sendJson(res, 400, { error: 'Please enter a valid USDT amount.' });
      }

      // Rule: 100 USDT = 1,000 Bits (1 USDT = 10 Bits)
      const estimatedBits = Math.round(amountUsdt * 10);
      const addr = depositAddresses.find((a) => a.chain === chain)?.address || '0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db';
      const id = nextDepositId++;
      const reference = `BNO-${Math.random().toString(16).substring(2, 10).toUpperCase()}`;

      const newDeposit = {
        id,
        userId: userAccount.id,
        userName: userAccount.name,
        userEmail: userAccount.email,
        batchId: 3,
        chain,
        amountUsdt,
        pricePerToken: 0.1,
        estimatedTokens: estimatedBits,
        status: 'pending' as const,
        reference,
        receiveAddress: addr,
        txHash: body.txHash || null,
        tokensCredited: null,
        rejectionReason: null,
        createdAt: new Date().toISOString(),
      };

      depositsList.unshift(newDeposit);

      activityList.unshift({
        id: Date.now(),
        kind: 'deposit',
        title: 'Deposit Request Submitted',
        detail: `${amountUsdt} USDT on ${chain.toUpperCase()} (Ref: ${reference}) awaiting protocol review.`,
        createdAt: new Date().toISOString(),
      });

      return sendJson(res, 201, newDeposit);
    }

    const txMatch = url.match(/^\/api\/deposits\/(\d+)\/transaction$/);
    if (txMatch && req.method === 'PATCH') {
      const depId = Number(txMatch[1]);
      const body = await parseBody(req);
      const dep = depositsList.find((d) => d.id === depId);
      if (dep) {
        dep.txHash = body.txHash;
        return sendJson(res, 200, dep);
      }
      return sendJson(res, 404, { error: 'Deposit not found' });
    }

    if (url === '/api/withdrawals' && req.method === 'GET') {
      return sendJson(res, 200, withdrawalsList);
    }

    if (url === '/api/withdrawals' && req.method === 'POST') {
      const body = await parseBody(req);
      const asset = body.asset || 'bitnoir';
      const amount = Number(body.amount) || 0;
      const destinationAddress = String(body.destinationAddress || '').trim();
      const chain = body.chain || 'bnb';

      if (!destinationAddress || destinationAddress.length < 10) {
        return sendJson(res, 400, { error: 'Please enter a valid destination address.' });
      }

      if (amount <= 0) {
        return sendJson(res, 400, { error: 'Please enter a valid withdrawal amount.' });
      }

      let amountUsd = 0;
      if (asset === 'bitnoir') {
        amountUsd = amount * BITNOIR_REFERENCE_PRICE;
        if (amountUsd < MIN_CLAIM_USDT) {
          return sendJson(res, 400, {
            error: `Minimum withdrawal value is $${MIN_CLAIM_USDT.toFixed(2)} USD (${MIN_CLAIM_BITNOIR} BITS).`,
          });
        }
        if (amount > (userAccount.balances.claimable + userAccount.balances.claimed)) {
          return sendJson(res, 400, { error: 'Requested amount exceeds withdrawable Bitnoir balance.' });
        }
        // Deduct from claimable first, then claimed
        if (userAccount.balances.claimable >= amount) {
          userAccount.balances.claimable -= amount;
        } else {
          const rem = amount - userAccount.balances.claimable;
          userAccount.balances.claimable = 0;
          userAccount.balances.claimed = Math.max(0, userAccount.balances.claimed - rem);
        }
      } else if (asset === 'bits') {
        amountUsd = amount * 0.10;
        if (amount > userAccount.balances.purchased) {
          return sendJson(res, 400, { error: 'Requested amount exceeds available Bits balance.' });
        }
        userAccount.balances.purchased -= amount;
      } else {
        amountUsd = amount;
      }

      const newTxHash = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
      const newWithdrawal = {
        id: nextWithdrawalId++,
        userId: userAccount.id,
        asset,
        amount,
        amountUsd: Number(amountUsd.toFixed(2)),
        destinationAddress,
        chain,
        status: 'completed' as const,
        txHash: newTxHash,
        createdAt: new Date().toISOString(),
      };

      withdrawalsList.unshift(newWithdrawal);

      activityList.unshift({
        id: Date.now(),
        kind: 'withdraw',
        title: `${asset === 'bitnoir' ? 'Bitnoir' : asset === 'bits' ? 'Bits' : 'USDT'} Withdrawal Processed`,
        detail: `Sent ${amount} ${asset === 'bitnoir' ? 'BITS' : asset === 'bits' ? 'Bits' : 'USDT'} ($${amountUsd.toFixed(2)}) to ${destinationAddress.slice(0, 8)}...${destinationAddress.slice(-6)} on ${chain.toUpperCase()}.`,
        createdAt: new Date().toISOString(),
      });

      return sendJson(res, 201, {
        withdrawal: newWithdrawal,
        balances: userAccount.balances,
        message: 'Withdrawal completed successfully.',
      });
    }

    // Dedicated Mining Pool stats
    if (url === '/api/pool/stats' && req.method === 'GET') {
      const totalReserve = 4200000; // 20% Staking Reserve
      const totalDistributed = 342850;
      const userStaked = userAccount.balances.staked;
      const totalPoolStaked = 1420000;
      const userSharePercent = Number(((userStaked / totalPoolStaked) * 100).toFixed(2));

      return sendJson(res, 200, {
        totalReserve,
        totalDistributed,
        availablePoolBalance: totalReserve - totalDistributed,
        emissionRatePerHour: 12.4,
        activeStakers: 1420,
        totalPoolStaked,
        userStaked,
        userSharePercent,
        referencePrice: BITNOIR_REFERENCE_PRICE,
      });
    }

    if (url === '/api/admin/summary' && req.method === 'GET') {
      const pendingCount = depositsList.filter((d) => d.status === 'pending').length;
      const totalRaised = depositsList
        .filter((d) => d.status === 'approved')
        .reduce((sum, d) => sum + d.amountUsdt, 482500);

      return sendJson(res, 200, {
    users: 0,
    pendingDeposits: pendingCount,
    totalRaisedUsdt: totalRaised,
    tokensSold: 0,
        activeAddresses: depositAddresses.filter((a) => a.active).length,
        saleOpen: launchSettings.saleOpen,
      });
    }

    if (url === '/api/admin/deposits' && req.method === 'GET') {
      return sendJson(res, 200, depositsList);
    }

    const decisionMatch = url.match(/^\/api\/admin\/deposits\/(\d+)\/decision$/);
    if (decisionMatch && req.method === 'POST') {
      const depId = Number(decisionMatch[1]);
      const body = await parseBody(req);
      const dep = depositsList.find((d) => d.id === depId);
      if (!dep) {
        return sendJson(res, 404, { error: 'Deposit not found' });
      }

      if (body.decision === 'approve') {
        dep.status = 'approved';
        dep.tokensCredited = dep.estimatedTokens;
        // Credit Bits to user's purchased balance
        userAccount.balances.purchased += dep.estimatedTokens;
        activityList.unshift({
          id: Date.now(),
          kind: 'deposit',
          title: 'Deposit Approved',
          detail: `${dep.estimatedTokens.toLocaleString()} Bits credited to available balance.`,
          createdAt: new Date().toISOString(),
        });
      } else {
        dep.status = 'rejected';
        dep.rejectionReason = body.rejectionReason || 'Payment could not be verified.';
        activityList.unshift({
          id: Date.now(),
          kind: 'deposit',
          title: 'Deposit Rejected',
          detail: dep.rejectionReason || 'Payment could not be verified.',
          createdAt: new Date().toISOString(),
        });
      }
      return sendJson(res, 200, dep);
    }

    if (url === '/api/admin/addresses' && req.method === 'GET') {
      return sendJson(res, 200, depositAddresses);
    }

    if (url === '/api/admin/addresses' && (req.method === 'PUT' || req.method === 'POST')) {
      const body = await parseBody(req);
      const existing = depositAddresses.find((a) => a.chain === body.chain);
      if (existing) {
        existing.address = body.address;
        existing.active = Boolean(body.active);
        return sendJson(res, 200, existing);
      }
      const newEntry = {
        id: depositAddresses.length + 1,
        chain: body.chain,
        address: body.address,
        active: Boolean(body.active),
      };
      depositAddresses.push(newEntry);
      return sendJson(res, 200, newEntry);
    }

    if (url === '/api/admin/launch' && req.method === 'PUT') {
      const body = await parseBody(req);
      launchSettings = {
        ...launchSettings,
        ...body,
      };
      return sendJson(res, 200, launchSettings);
    }

    return next();
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
