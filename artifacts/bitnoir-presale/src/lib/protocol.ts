import type { UserAccount } from '@workspace/api-client-react';

/**
 * Asset model
 * - USDT: what members deposit (on-chain stablecoin).
 * - Bits: non-transferable internal points. 1 USDT = 10 Bits. Used only to open stakes; burned when staked.
 * - Bitnoir (BNR): the real token. Earned as staking rewards and returned as principal at maturity.
 */
export const BNR_PRICE = 50;
export const BITS_PRICE = 0.1;
export const BITS_PER_USDT = 10;
export const MIN_CLAIM_USD = 2;
export const MIN_CLAIM_BNR = MIN_CLAIM_USD / BNR_PRICE;
export const MAX_SUPPLY = 21_000_000;
export const BNR = 'BNR';

export const TERMS = [
  { days: 30, rate: 0.08 },
  { days: 60, rate: 0.16 },
  { days: 90, rate: 0.28 },
] as const;

export const rateForDays = (days: number) => TERMS.find((t) => t.days === days)?.rate ?? 0.08;

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

export const TIERS = [
  { name: 'Bronze', min: 0 },
  { name: 'Silver', min: 500 },
  { name: 'Gold', min: 1500 },
  { name: 'Diamond', min: 5000 },
] as const;

export function tierFor(xp: number) {
  let index = 0;
  TIERS.forEach((t, i) => { if (xp >= t.min) index = i; });
  const current = TIERS[index];
  const next = TIERS[index + 1];
  const pct = next ? (xp - current.min) / (next.min - current.min) : 1;
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
