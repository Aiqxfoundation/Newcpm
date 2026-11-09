import type { Plugin } from 'vite';

export function bitnoirApiPlugin(): Plugin {
  // Protocol configuration
  const BITNOIR_REFERENCE_PRICE = 1.1; // $1.10 protocol accounting valuation ($1.1 Per Noir)
  const USDT_PER_BITS = 0.1; // 100 USDT = 1,000 Bits
  const MIN_CLAIM_USDT = 2; // Minimum $2 claim threshold
  const MIN_CLAIM_BITNOIR = MIN_CLAIM_USDT / BITNOIR_REFERENCE_PRICE; // ~1.8182 Bitnoir

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
    { id: 4, chain: 'solana', address: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', active: true },
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
    name: 'satoshi',
    email: 'satoshi@bitnoir.io',
    role: 'admin',
    referralCode: 'satoshi',
    freeSignupBits: 100,      // 100 Free Bits credited for signup ($10 value)
    referralBitsAvailable: 200, // 200 Verified Referral Bits available to claim
    referralBitsClaimed: 100,   // 100 Verified Referral Bits already claimed
    referralBitsPending: 200,   // 200 Unverified Referral Bits awaiting referee $100+ purchase & stake
    balances: {
      purchased: 5100,      // Includes 100 Free Signup Bits + purchased
      freeBits: 100,        // 100 Free Signup Bits
      staked: 10000,        // 10,000 Bits locked in active staking position ($1,000 value)
      burned: 10080,        // 10,000 Bits staked + 80 Bits burned for claimed rewards
      claimable: 10.9091,   // Bitnoir tokens ready for withdrawal/claim
      claimed: 7.2727,      // Bitnoir tokens previously claimed
      swapAvailable: 0,
    },
    mining: {
      baseRatePerHour: 0.1,         // Base Rate: 0.1 Bits Per Hour
      burnedSol: 0.5,               // Current burned SOL
      solBurnBoostPerHour: 2.5,     // 0.5 SOL * 5.0 Bits/hr
      referralBoostPerHour: 0.075,  // 3 Verified Referral peers * 0.025 Bits/hr
      totalMiningRatePerHour: 2.675, // Base 0.1 + Ref 0.075 + Burn 2.5
      minedBitsUnclaimed: 14.8291,  // Accumulated in storage tank ready to claim
      minedBitsTotalClaimed: 120.5,
      sessionStartedAt: new Date(Date.now() - 6 * 3600000).toISOString(),
      sessionEndsAt: new Date(Date.now() + 18 * 3600000).toISOString(),
    },
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
  };

  // Mining allocations list
  const miningAllocations: Array<{
    id: number;
    kind: 'base' | 'referral' | 'sol_burn';
    label: string;
    solBurned?: number;
    ratePerHour: number;
    multiplier: string;
    createdAt: string;
    status: 'active';
  }> = [
    {
      id: 1,
      kind: 'base',
      label: 'Network Base Engine',
      ratePerHour: 0.1,
      multiplier: '1.0x',
      createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
      status: 'active',
    },
    {
      id: 2,
      kind: 'referral',
      label: 'Qualified Referral Team (3 Peers)',
      ratePerHour: 0.075,
      multiplier: '+75% Boost',
      createdAt: new Date(Date.now() - 12 * 86400000).toISOString(),
      status: 'active',
    },
    {
      id: 3,
      kind: 'sol_burn',
      label: 'Proof-of-Burn Power (0.5 SOL)',
      solBurned: 0.5,
      ratePerHour: 2.5,
      multiplier: '+2,500% Boost',
      createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
      status: 'active',
    },
  ];

  // Staking positions
  let nextPositionId = 2;
  const stakingPositions: Array<{
    id: number;
    stakedBits: number;
    lockupDays: number;
    rewardRate: number;
    accruedReward: number;
    claimedReward?: number;
    principalReturnTokens: number;
    createdAt: string;
    unlocksAt: string;
    status: 'active' | 'matured' | 'claimed';
  }> = [
    {
      id: 1,
      stakedBits: 10000,
      lockupDays: 60,
      rewardRate: 0.02,
      accruedReward: 10.9091,
      claimedReward: 7.2727,
      principalReturnTokens: 909.0909,
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
      detail: '10,000 Bits burned into 60-day staking term at 2.0% term yield (12% APY).',
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
        .reduce((sum, d) => sum + d.amountUsdt, 0);
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
          { name: 'Staking & Burn Allocation', percent: 40, tokens: 8400000 },
          { name: 'Node Mining (Network Mainnet Live)', percent: 20, tokens: 4200000 },
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
        miningAllocations,
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

    if (url === '/api/accounts/me/team' && req.method === 'GET') {
      const teamList = [
        {
          id: 'member-1',
          handle: 'marcus_v',
          address: '0x3507e4978e0eb83315d20df86ca0b976c0e40ccb',
          joinedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
          status: 'verified', // Qualified: >= $100 purchased & staked
          stakedBits: 25000,
          volumeUsdt: 2500,
          bitsReward: 100,
          isVerified: true,
          verificationRequirement: 'Qualified ($2,500 staked)',
          tier: 'Gold Tier',
        },
        {
          id: 'member-2',
          handle: 'sarah_k',
          address: '0x71C8360437E55928d11B3e264259837a7F9D7065',
          joinedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
          status: 'verified', // Qualified: >= $100 purchased & staked
          stakedBits: 10000,
          volumeUsdt: 1000,
          bitsReward: 100,
          isVerified: true,
          verificationRequirement: 'Qualified ($1,000 staked)',
          tier: 'Silver Tier',
        },
        {
          id: 'member-3',
          handle: 'elena_d',
          address: '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7',
          joinedAt: new Date(Date.now() - 12 * 86400000).toISOString(),
          status: 'verified', // Qualified: >= $100 purchased & staked
          stakedBits: 5000,
          volumeUsdt: 500,
          bitsReward: 100,
          isVerified: true,
          verificationRequirement: 'Qualified ($500 staked)',
          tier: 'Bronze Tier',
        },
        {
          id: 'member-4',
          handle: 'david_w',
          address: '0x12a95c80881912a7a40b1928374a56b192847c5d',
          joinedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
          status: 'unverified', // Unverified: Ref must purchase min. $100 & stake
          stakedBits: 0,
          volumeUsdt: 0,
          bitsReward: 100,
          isVerified: false,
          verificationRequirement: 'Unverified: Referee must purchase min. $100 (1,000 Bits) & stake',
          tier: 'New Member',
        },
        {
          id: 'member-5',
          handle: 'alex_c',
          address: '0x9928f80881912a7a40b1928374a56b192847a11',
          joinedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
          status: 'unverified', // Unverified: Only $25, needs $100 min
          stakedBits: 250,
          volumeUsdt: 25,
          bitsReward: 100,
          isVerified: false,
          verificationRequirement: 'Unverified: Only $25 staked (Min. $100 required)',
          tier: 'New Member',
        },
      ];
      return sendJson(res, 200, teamList);
    }

    if ((url === '/api/accounts/me/claim-referral-bits' || url === '/api/accounts/me/claim-referral-xp') && req.method === 'POST') {
      const available = userAccount.referralBitsAvailable || 0;
      if (available <= 0) {
        return sendJson(res, 400, { error: 'No verified referral Bits available to claim.' });
      }
      userAccount.referralBitsClaimed = (userAccount.referralBitsClaimed || 0) + available;
      userAccount.referralBitsAvailable = 0;
      userAccount.balances.purchased += available; // Directly credited into user's stakable balance!
      activityList.unshift({
        id: Date.now(),
        kind: 'reward',
        title: 'Verified Referral Bits Claimed',
        detail: `Successfully claimed +${available} Verified Bits into your balance. Ready to stake in Proof-of-Burn!`,
        createdAt: new Date().toISOString(),
      });
      return sendJson(res, 200, {
        success: true,
        claimedBits: available,
        referralBitsAvailable: 0,
        referralBitsClaimed: userAccount.referralBitsClaimed,
        balances: userAccount.balances,
        message: `Claimed +${available} Verified Referral Bits to your available balance!`,
      });
    }

    if (url === '/api/accounts/me/referral' && req.method === 'POST') {
      const body = await parseBody(req);
      const raw = String(body.code || '').trim();
      const code = raw.replace(/^bits-/i, '').toLowerCase();
      if (!code) {
        return sendJson(res, 400, { error: 'Please enter a valid inviter username.' });
      }
      if (userAccount.referredBy) {
        return sendJson(res, 400, { error: 'An inviter has already been linked to this account.' });
      }
      userAccount.referredBy = code;
      activityList.unshift({
        id: Date.now(),
        kind: 'referral',
        title: 'Inviter Linked',
        detail: `Linked to inviter @${code}. Welcome to Bitnoir referral network!`,
        createdAt: new Date().toISOString(),
      });
      return sendJson(res, 200, { applied: true, message: `Inviter @${code} linked successfully!` });
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

      // Exact mathematical yield curve based on 12% fair annual yield (12% per year)
      // 30d = 1.0%, 60d = 2.0%, 90d = 3.0%
      const rate = (days / 360) * 0.12;
      
      // Burning mechanism: Staked Bits are permanently committed to protocol engine
      userAccount.balances.purchased -= amount;
      userAccount.balances.staked += amount;
      userAccount.balances.burned = (userAccount.balances.burned || 0) + amount;

      // Principal return calculation at protocol reference price
      const principalUsdtEquivalent = amount * USDT_PER_BITS;
      const principalTokens = principalUsdtEquivalent / BITNOIR_REFERENCE_PRICE;

      // Check if user has an existing active position with the same term length
      const existingSameTerm = stakingPositions.find((p) => p.status === 'active' && p.lockupDays === days);

      let position;
      if (existingSameTerm) {
        // Increase existing position under same term
        existingSameTerm.stakedBits += amount;
        existingSameTerm.principalReturnTokens = Number(((existingSameTerm.stakedBits * USDT_PER_BITS) / BITNOIR_REFERENCE_PRICE).toFixed(4));
        position = existingSameTerm;

        activityList.unshift({
          id: Date.now(),
          kind: 'stake',
          title: 'Position Increased & Bits Committed',
          detail: `Added ${amount.toLocaleString()} Bits to active ${days}-day position. Combined allocation: ${existingSameTerm.stakedBits.toLocaleString()} Bits.`,
          createdAt: new Date().toISOString(),
        });
      } else {
        // Create independent position (e.g. if 90 days exists and user stakes for 30 days, 30 days runs independently)
        position = {
          id: nextPositionId++,
          stakedBits: amount,
          lockupDays: days,
          rewardRate: Number(rate.toFixed(4)),
          accruedReward: 0,
          claimedReward: 0,
          principalReturnTokens: Number(principalTokens.toFixed(4)),
          createdAt: new Date().toISOString(),
          unlocksAt: new Date(Date.now() + days * 86400000).toISOString(),
          status: 'active' as const,
        };
        stakingPositions.unshift(position);

        activityList.unshift({
          id: Date.now(),
          kind: 'stake',
          title: 'New Staking Position Opened',
          detail: `${amount.toLocaleString()} Bits committed into independent ${days}-day term at ${(rate * 100).toFixed(1)}% yield.`,
          createdAt: new Date().toISOString(),
        });
      }

      return sendJson(res, 200, {
        ...userAccount,
        position,
        stakingPositions,
        miningAllocations,
      });
    }

    // Burn SOL to Mine More Bits endpoint (0.1 to 10 SOL Max)
    if (url === '/api/accounts/me/burn-sol' && req.method === 'POST') {
      const body = await parseBody(req);
      const rawSol = Number(body.solAmount) || 0.1;
      const solAmount = Number(Math.max(0.1, Math.min(10.0, rawSol)).toFixed(2));
      const rateBoost = Number((solAmount * 5.0).toFixed(4)); // 1 SOL = +5 Bits/hr boost

      userAccount.mining.burnedSol = Number((userAccount.mining.burnedSol + solAmount).toFixed(3));
      userAccount.mining.solBurnBoostPerHour = Number((userAccount.mining.solBurnBoostPerHour + rateBoost).toFixed(4));
      userAccount.mining.totalMiningRatePerHour = Number(
        (userAccount.mining.baseRatePerHour + userAccount.mining.referralBoostPerHour + userAccount.mining.solBurnBoostPerHour).toFixed(4)
      );

      const allocation = {
        id: Date.now(),
        kind: 'sol_burn' as const,
        label: `Proof-of-Burn Power (${solAmount} SOL)`,
        solBurned: solAmount,
        ratePerHour: rateBoost,
        multiplier: `+${Math.round((rateBoost / 0.1) * 100)}% Boost`,
        createdAt: new Date().toISOString(),
        status: 'active' as const,
      };
      miningAllocations.unshift(allocation);

      activityList.unshift({
        id: Date.now(),
        kind: 'burn',
        title: `Burned ${solAmount} SOL to Mine More Bits`,
        detail: `Committed ${solAmount} SOL into protocol burn sink. Granted +${rateBoost} Bits/hr hash power boost.`,
        createdAt: new Date().toISOString(),
      });

      return sendJson(res, 200, {
        success: true,
        solBurned: solAmount,
        rateBoost,
        mining: userAccount.mining,
        miningAllocations,
        message: `Burned ${solAmount} SOL! Mining speed boosted by +${rateBoost} Bits/hr.`,
      });
    }

    // Claim accumulated mined Bits into available balance
    if (url === '/api/accounts/me/claim-mined-bits' && req.method === 'POST') {
      const unclaimed = userAccount.mining.minedBitsUnclaimed || 0;
      if (unclaimed <= 0) {
        return sendJson(res, 400, { error: 'No mined Bits accumulated in storage tank.' });
      }

      userAccount.mining.minedBitsTotalClaimed = Number(((userAccount.mining.minedBitsTotalClaimed || 0) + unclaimed).toFixed(4));
      userAccount.mining.minedBitsUnclaimed = 0;
      userAccount.balances.purchased = Number(((userAccount.balances.purchased || 0) + unclaimed).toFixed(4));

      activityList.unshift({
        id: Date.now(),
        kind: 'reward',
        title: 'Mined Bits Claimed',
        detail: `Claimed +${unclaimed.toFixed(4)} mined Bits directly into your available balance.`,
        createdAt: new Date().toISOString(),
      });

      return sendJson(res, 200, {
        success: true,
        claimedBits: unclaimed,
        mining: userAccount.mining,
        balances: userAccount.balances,
        message: `Claimed +${unclaimed.toFixed(4)} Bits to your available balance!`,
      });
    }

    // Claim farming rewards endpoint
    if (url === '/api/accounts/me/claim' && req.method === 'POST') {
      const claimable = userAccount.balances.claimable;

      // Check if user has an active position and whether the lock term has completed
      const activePositionsList = stakingPositions.filter((p) => p.status === 'active');
      const isAnyTermFinished = activePositionsList.some((p) => new Date(p.unlocksAt).getTime() <= Date.now());

      // If lock term is finished, the threshold is waived completely (users can claim less than 0.04 Bitnoir)
      if (!isAnyTermFinished && claimable < MIN_CLAIM_BITNOIR) {
        return sendJson(res, 400, {
          error: `Minimum mid-term claim threshold is ${MIN_CLAIM_BITNOIR.toFixed(4)} Bitnoir. Full balance is claimable once lock term finishes.`,
        });
      }

      if (claimable <= 0) {
        return sendJson(res, 400, {
          error: 'No claimable Bitnoir available at this time.',
        });
      }

      // Proof-of-Burn Settlement: 1 Bitnoir = 11 Bits (1 Bitnoir = $1.10, 1 Bits = $0.10)
      const burnedBitsForReward = Math.round((claimable * BITNOIR_REFERENCE_PRICE) / USDT_PER_BITS);

      userAccount.balances.claimed = (userAccount.balances.claimed || 0) + claimable;
      userAccount.balances.claimable = 0;
      userAccount.balances.burned = (userAccount.balances.burned || 0) + burnedBitsForReward;

      // Record claimed rewards on active positions
      activePositionsList.forEach((pos) => {
        pos.claimedReward = (pos.claimedReward || 0) + (claimable / Math.max(1, activePositionsList.length));
        if (new Date(pos.unlocksAt).getTime() <= Date.now()) {
          pos.status = 'matured';
        }
      });

      activityList.unshift({
        id: Date.now(),
        kind: 'claim',
        title: 'Proof-of-Burn Settlement Claimed',
        detail: `Claimed ${claimable.toFixed(4)} Bitnoir tokens. Protocol burned ${burnedBitsForReward.toLocaleString()} Bits per burn rule.`,
        createdAt: new Date().toISOString(),
      });

      return sendJson(res, 200, {
        claimedAmount: claimable,
        burnedBitsSettled: burnedBitsForReward,
        balances: userAccount.balances,
        stakingPositions,
        message: `Claimed ${claimable.toFixed(4)} Bitnoir tokens. ${burnedBitsForReward.toLocaleString()} Bits burned.`,
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
        if (amount < MIN_CLAIM_BITNOIR) {
          return sendJson(res, 400, {
            error: `Minimum withdrawal is ${MIN_CLAIM_BITNOIR.toFixed(4)} Bitnoir.`,
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

    // Global Protocol Statistics & Network Metrics (/api/statistics, /api/statics, /api/pool/stats)
    if ((url === '/api/statistics' || url === '/api/statics' || url === '/api/pool/stats') && req.method === 'GET') {
      const baselineGlobalBitsStaked = 14850000;
      const baselineGlobalBitnoirClaimed = 18420.5000;
      const baselineGlobalBurnedBits = 24062330;
      const baselineGlobalCommittedBits = 28650000;
      const baselineActiveStakers = 1421;
      const totalUsers = 3842;

      const totalBitsStaked = baselineGlobalBitsStaked + userAccount.balances.staked;
      const totalBitnoirRewardsClaimed = Number((baselineGlobalBitnoirClaimed + (userAccount.balances.claimed || 0)).toFixed(4));
      const totalAmountBurnedBits = baselineGlobalBurnedBits + (userAccount.balances.burned || 0);
      const totalCommittedBits = baselineGlobalCommittedBits + userAccount.balances.staked;

      const totalReserve = 4200000; // 20% Staking & Yield Reserve
      const totalDistributed = Number((342850.2 + (userAccount.balances.claimed || 0)).toFixed(1));
      const availablePoolBalance = Number((totalReserve - totalDistributed).toFixed(1));
      const userStaked = userAccount.balances.staked;
      const userSharePercent = totalBitsStaked > 0 ? Number(((userStaked / totalBitsStaked) * 100).toFixed(4)) : 0;

      return sendJson(res, 200, {
        // Overall Stakers & Users Aggregates
        totalBitsStaked,
        totalBitsStakedUsd: totalBitsStaked * USDT_PER_BITS,
        totalBitnoirRewardsClaimed,
        totalBitnoirRewardsClaimedUsd: Number((totalBitnoirRewardsClaimed * BITNOIR_REFERENCE_PRICE).toFixed(2)),
        totalAmountBurnedBits,
        totalAmountBurnedBitsUsd: totalAmountBurnedBits * USDT_PER_BITS,
        totalCommittedBits,
        totalCommittedBitsUsd: totalCommittedBits * USDT_PER_BITS,
        totalUsers,
        activeStakers: baselineActiveStakers + (userStaked > 0 ? 1 : 0),
        averageStakePerUser: Math.round(totalBitsStaked / (baselineActiveStakers + (userStaked > 0 ? 1 : 0))),

        // Total Share Of Bitnoir Token (21,000,000 Hard Cap)
        hardCapSupply: 21000000,
        stakingBurnTokens: 8400000,
        stakingBurnPercent: 40,
        nodeMiningTokens: 4200000,
        nodeMiningPercent: 20,
        cexLiquidityTokens: 4410000,
        cexLiquidityPercent: 21,
        stabilityTokens: 2310000,
        stabilityPercent: 11,
        airdropTokens: 1680000,
        airdropPercent: 8,

        // Reserve Emissions & Staking Pool Health
        totalReserve,
        totalDistributed,
        availablePoolBalance,
        emissionRatePerHour: 12.4,
        reserveEmittedPercent: Number(((totalDistributed / totalReserve) * 100).toFixed(2)),

        // User's Individual Network Position
        userStaked,
        userClaimed: userAccount.balances.claimed || 0,
        userBurned: userAccount.balances.burned || 0,
        userSharePercent,

        // Protocol Pricing & Constants
        referencePrice: BITNOIR_REFERENCE_PRICE,
        usdtPerBits: USDT_PER_BITS,
        minClaimBitnoir: MIN_CLAIM_BITNOIR,

        // Term Distribution Breakdown
        termBreakdown: [
          { termDays: 30, tier: 'Base Tier', rate: '1.0% (12% APY)', totalBits: 3260000, stakers: 412, sharePercent: 22 },
          { termDays: 60, tier: 'Bi-Monthly Tier', rate: '2.0% (12% APY)', totalBits: 6840000, stakers: 620, sharePercent: 46 },
          { termDays: 90, tier: 'Quarterly Tier', rate: '3.0% (12% APY)', totalBits: 4740000, stakers: 388, sharePercent: 32 },
        ],

        // Recent Global Staker & Burning Ledger
        recentNetworkEvents: [
          { id: 1, type: 'stake', title: 'Bits Committed to Staking', detail: '25,000 Bits locked into 90-Day Term (3.0% yield · 12% APY)', participant: 'Node_8f29', time: '3m ago', bits: 25000 },
          { id: 2, type: 'claim', title: 'Proof-of-Burn Settlement', detail: '0.4200 Bitnoir claimed · 210 Bits burned', participant: 'Node_c14e', time: '9m ago', tokens: 0.42 },
          { id: 3, type: 'stake', title: 'Position Increased', detail: '10,000 Bits added to active 60-Day Term', participant: 'Node_77aa', time: '18m ago', bits: 10000 },
          { id: 4, type: 'burn', title: 'Protocol Proof-of-Burn', detail: '55 Bits permanently burned for emission dispatch', participant: 'System_Burn', time: '31m ago', bits: 55 },
          { id: 5, type: 'stake', title: 'New Staker Joined', detail: '5,000 Bits locked into 30-Day Base Term', participant: 'Node_993c', time: '44m ago', bits: 5000 },
          { id: 6, type: 'claim', title: 'Farming Rewards Dispatched', detail: '2.0000 Bitnoir claimed ($2.20 USD value)', participant: 'Node_b10a', time: '1h ago', tokens: 2.0 },
        ]
      });
    }

    if (url === '/api/admin/summary' && req.method === 'GET') {
      const pendingCount = depositsList.filter((d) => d.status === 'pending').length;
      const totalRaised = depositsList
        .filter((d) => d.status === 'approved')
        .reduce((sum, d) => sum + d.amountUsdt, 0);

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
