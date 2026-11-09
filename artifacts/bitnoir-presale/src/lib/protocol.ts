import type { UserAccount } from '@workspace/api-client-react';

/**
 * Asset model
 * - USDT: what members deposit (on-chain stablecoin).
 * - Bits: non-transferable internal points. 1 USDT = 10 Bits. Used only to open stakes; burned when staked.
 * - Bitnoir: the real token. Earned as staking rewards and returned as principal at maturity.
 */
export const BITNOIR_PRICE = 1.1; // $1.10 per Noir
export const BNR_PRICE = BITNOIR_PRICE;
export const BITS_PRICE = 0.1;
export const BITS_PER_USDT = 10;
export const MIN_CLAIM_USD = 2;
export const MIN_CLAIM_BITNOIR = MIN_CLAIM_USD / BITNOIR_PRICE;
export const MIN_CLAIM_BNR = MIN_CLAIM_BITNOIR;
export const MAX_SUPPLY = 21_000_000;
export const BITNOIR = 'Bitnoir';
export const BNR = 'Bitnoir';

export const ANNUAL_FAIR_YIELD = 0.12; // 12% Annual Fair Yield (12% per year)

export const TERMS = [
  { days: 30, rate: 0.01 }, // 1.0% for 30 days (12% APY)
  { days: 60, rate: 0.02 }, // 2.0% for 60 days (12% APY)
  { days: 90, rate: 0.03 }, // 3.0% for 90 days (12% APY)
] as const;

export const rateForDays = (days: number) => (days / 360) * ANNUAL_FAIR_YIELD;

export const CHAIN_NAMES: Record<string, string> = {
  bnb: 'BNB Smart Chain',
  ethereum: 'Ethereum',
  polygon: 'Polygon',
  arbitrum: 'Arbitrum',
  base: 'Base',
  solana: 'Solana',
};

export const CHAIN_STANDARD: Record<string, string> = {
  bnb: 'BEP-20',
  ethereum: 'ERC-20',
  polygon: 'PoS',
  arbitrum: 'Arbitrum',
  base: 'Base',
  solana: 'SPL',
};

export type StakingPosition = {
  id: number;
  stakedBits: number;
  lockupDays: number;
  rewardRate: number;
  accruedReward: number;
  principalReturnTokens: number;
  createdAt: string;
  unlocksAt: string;
  status: 'active' | 'matured' | 'claimed';
};

export type ActivityItem = { id: number; kind: string; title: string; detail: string; createdAt: string };

export type Balances = {
  bitsAvailable: number;
  bitsStaked: number;
  bitsBurned: number;
  bnrPending: number;
  bnrWallet: number;
};

export type Account = UserAccount & { stakingPositions?: StakingPosition[] };

export function readBalances(account: UserAccount): Balances {
  const b = (account.balances ?? {}) as unknown as Record<string, number | undefined>;
  return {
    bitsAvailable: b.purchased ?? 0,
    bitsStaked: b.staked ?? 0,
    bitsBurned: b.burned ?? b.staked ?? 0,
    bnrPending: b.claimable ?? 0,
    bnrWallet: b.claimed ?? 0,
  };
}

export function readPositions(account: UserAccount): StakingPosition[] {
  const list = (account as Account).stakingPositions;
  return Array.isArray(list) ? list : [];
}

export const bitsToUsd = (bits: number) => bits * BITS_PRICE;
export const bnrToUsd = (bnr: number) => bnr * BNR_PRICE;
export const bitsToBnr = (bits: number) => bitsToUsd(bits) / BNR_PRICE;

export const BITS_PER_NOIR = 11; // 11 Bits = 1 $Noir ($0.10 * 11 = $1.10)
export const HASH_PER_BIT_GH = 10; // 10 GH/s per Bit (100 Bits = 1,000 GH/s = 1 TH/s)
export const EPOCH_90D_DAYS = 90;
export const EPOCH_90D_RATE = 0.03; // 3.0% yield over 90 days (12% annual APY)

export function formatHashrate(ghs: number): string {
  if (ghs >= 1_000_000) return `${(ghs / 1_000_000).toFixed(2)} PH/s`;
  if (ghs >= 1_000) return `${(ghs / 1_000).toFixed(2)} TH/s`;
  return `${ghs.toFixed(1)} GH/s`;
}

export function calculateMiningConversion(minedBits: number, days = 90) {
  const rate = rateForDays(days);
  const principalUsd = bitsToUsd(minedBits);
  const principalNoir = principalUsd / BNR_PRICE; // Bits / 11
  const yieldNoir = principalNoir * rate; // 3.0% for 90d
  const totalNoir = principalNoir + yieldNoir;
  const totalUsd = totalNoir * BNR_PRICE;
  const effectiveRatio = minedBits > 0 ? (minedBits / totalNoir).toFixed(2) : '10.68';
  return {
    days,
    rate,
    ratePercent: (rate * 100).toFixed(1),
    principalNoir,
    yieldNoir,
    totalNoir,
    totalUsd,
    effectiveRatio, // e.g. "10.68 Bits per Noir" with 90-day yield
  };
}

export function stakeQuote(bits: number, days: number) {
  const rate = rateForDays(days);
  const principal = bitsToBnr(bits);
  const reward = principal * rate;
  return { rate, principal, reward, total: principal + reward };
}

export function positionProgress(p: StakingPosition) {
  const start = new Date(p.createdAt).getTime();
  const end = new Date(p.unlocksAt).getTime();
  const now = Date.now();
  const pct = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1;
  const daysLeft = Math.max(0, Math.ceil((end - now) / 86_400_000));
  return { pct, daysLeft, daysDone: p.lockupDays - daysLeft };
}

export const FREE_SIGNUP_BITS = 100; // 100 Free Bits for every signup
export const REFERRAL_REWARD_BITS = 100; // 100 Bits per verified referral
export const REFERRAL_MIN_QUALIFY_USD = 100; // Min $100 purchase & stake required to verify
export const REFERRAL_MIN_QUALIFY_BITS = REFERRAL_MIN_QUALIFY_USD * BITS_PER_USDT; // 1,000 Bits
export const AIRDROP_SHARE_PERCENT = 8; // 8% of 21,000,000 fixed supply
export const AIRDROP_SHARE_TOKENS = 1_680_000; // 1,680,000 Bitnoir Tokens
export const AIRDROP_SHARE_BITS = 18_480_000; // 18,480,000 Community Grant Bits Pool ($1,848,000 USD / $0.10)

export const BITS_TIERS = [
  { name: 'Bronze Member', min: 0 },
  { name: 'Silver Member', min: 500 },
  { name: 'Gold Ambassador', min: 2500 },
  { name: 'Diamond Node', min: 10000 },
] as const;

export function tierFor(bits: number) {
  let index = 0;
  BITS_TIERS.forEach((t, i) => { if (bits >= t.min) index = i; });
  const current = BITS_TIERS[index];
  const next = BITS_TIERS[index + 1];
  const pct = next ? (bits - current.min) / (next.min - current.min) : 1;
  return { current, next, pct };
}

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
export const usd = (v?: number | null) => usdFmt.format(v ?? 0);
export const num = (v?: number | null, max = 2) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: max }).format(v ?? 0);
export const bnr = (v?: number | null) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(v ?? 0);
export const compact = (v?: number | null) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v ?? 0);
export const date = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
export const dateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const shortAddr = (a?: string | null) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? '');

export function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['rows', 'items', 'data', 'results']) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
}

export function readableError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

export const basePath = import.meta.env.BASE_PATH ? String(import.meta.env.BASE_PATH).replace(/\/$/, '') : '';
