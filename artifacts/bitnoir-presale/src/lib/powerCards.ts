import { calculateSolPowerBoost, getWalletMiningState, safeStorageGet, safeStorageSet, saveLocalWalletActivity, saveWalletMiningState } from './solana';

export type PowerCardTier =
  | 'Genesis'
  | 'Core'
  | 'Silver'
  | 'Gold'
  | 'Obsidian'
  | 'Sovereign'
  | 'Abyssal'
  | 'Celestial'
  | 'Mythic';

export const ANT_CARD_ID = 'ant-card';
export const ANT_CARD_IMAGE_URL = '/assets/aistudio/file_00000000913c8208b11a026f99455c53_4fc1128d.png';
export const ANT_CARD_DURATION_MS = 24 * 3600 * 1000;

export const SPIDER_CARD_ID = 'spider-card';
export const SPIDER_CARD_IMAGE_URL = '/assets/aistudio/file_0000000011988208911267b6962fc30b_c0c62f0e.png';
export const SPIDER_CARD_DURATION_MS = 24 * 3600 * 1000;

export const PHOENIX_CARD_ID = 'phoenix-card';
export const PHOENIX_CARD_IMAGE_URL = '/assets/aistudio/IMG-20261114-WA3453_ae170ac8.jpg';
export const PHOENIX_CARD_DURATION_MS = 24 * 3600 * 1000;

export const SIREN_CARD_ID = 'siren-card';
export const SIREN_CARD_IMAGE_URL = '/assets/aistudio/IMG-20261114-WA7074_3d289f1e.jpg';
export const SIREN_CARD_DURATION_MS = 24 * 3600 * 1000;

export const AURA_CARD_ID = 'aura-card';
export const AURA_CARD_IMAGE_URL = '/assets/aistudio/IMG-20261114-WA1106_359ef193.jpg';
export const AURA_CARD_DURATION_MS = 3 * 24 * 3600 * 1000;

export const DRAGON_CARD_ID = 'dragon-card';
export const DRAGON_CARD_IMAGE_URL = '/assets/aistudio/IMG-20261114-WA6645_c8924212.jpg';
export const DRAGON_CARD_DURATION_MS = 7 * 24 * 3600 * 1000;

export interface PowerCardDefinition {
  id: string;
  name: string;
  tier: PowerCardTier;
  boostPerHour: number;
  durationHours: number | null;
  imageUrl: string | null;
  rewardRule: string;
  description: string;
}

export interface ReceivedPowerCard {
  cardId: string;
  unlockedAt: string;
  activatedAt?: string;
  expiresAt?: string;
}

/**
 * Power Cards Reward Catalog.
 */
export const POWER_CARD_CATALOG: PowerCardDefinition[] = [
  {
    id: ANT_CARD_ID,
    name: 'ANT CARD',
    tier: 'Genesis',
    boostPerHour: 0.1,
    durationHours: 24,
    imageUrl: ANT_CARD_IMAGE_URL,
    rewardRule: 'Unlocked when mining starts · 24h upon activation',
    description: 'Genesis power card delivering +0.1000 BITS/hr and a 24-hour claim cycle for 24 hours once activated.',
  },
  {
    id: SPIDER_CARD_ID,
    name: 'SPIDER CARD',
    tier: 'Obsidian',
    boostPerHour: 0.5,
    durationHours: 24,
    imageUrl: SPIDER_CARD_IMAGE_URL,
    rewardRule: 'Unlocked upon wallet verification & UID · 24h upon activation',
    description: 'Verified node power card delivering +0.5000 BITS/hr for 24 hours once activated.',
  },
  {
    id: PHOENIX_CARD_ID,
    name: 'PHOENIX CARD',
    tier: 'Sovereign',
    boostPerHour: 1.0,
    durationHours: 24,
    imageUrl: PHOENIX_CARD_IMAGE_URL,
    rewardRule: 'Unlocked after inviting 3 verified miners · 24h upon activation',
    description: 'Elite referral milestone card delivering +1.0000 BITS/hr for 24 hours once activated.',
  },
  {
    id: SIREN_CARD_ID,
    name: 'SIREN CARD',
    tier: 'Abyssal',
    boostPerHour: 2.0,
    durationHours: 24,
    imageUrl: SIREN_CARD_IMAGE_URL,
    rewardRule: 'Unlocked when Miners Power reaches 0.5/h · 24h upon activation',
    description: 'High-tide referral milestone card delivering +2.0000 BITS/hr for 24 hours once activated.',
  },
  {
    id: AURA_CARD_ID,
    name: 'AURA CARD',
    tier: 'Celestial',
    boostPerHour: 5.0,
    durationHours: 72,
    imageUrl: AURA_CARD_IMAGE_URL,
    rewardRule: 'Unlocked at 10 verified & active miners · 3d upon activation',
    description: 'Celestial vanguard card delivering +5.0000 BITS/hr for 3 days once activated.',
  },
  {
    id: DRAGON_CARD_ID,
    name: 'DRAGON CARD',
    tier: 'Mythic',
    boostPerHour: 10.0,
    durationHours: 168,
    imageUrl: DRAGON_CARD_IMAGE_URL,
    rewardRule: 'Unlocked on purchasing min. 2/h SOL Power · 7d upon activation',
    description: 'Mythic sovereign card delivering +10.0000 BITS/hr for 7 days once activated.',
  },
];

export function formatPowerCardDurationShort(durationHours: number | null): string {
  const hours = durationHours || 24;
  if (hours >= 24 && hours % 24 === 0 && hours > 24) {
    return `${hours / 24}d`;
  }
  return `${hours}h`;
}

export function formatPowerCardDurationLong(durationHours: number | null): string {
  const hours = durationHours || 24;
  if (hours >= 24 && hours % 24 === 0 && hours > 24) {
    const days = hours / 24;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function storageKeyForWallet(ownerAddress: string): string {
  return `bitnoir-power-cards-v2-${ownerAddress}`;
}

function genesisUnlockKeyForWallet(ownerAddress: string): string {
  return `bitnoir-ant-genesis-v2-${ownerAddress}`;
}

function spiderUnlockKeyForWallet(ownerAddress: string): string {
  return `bitnoir-spider-verified-v1-${ownerAddress}`;
}

function phoenixUnlockKeyForWallet(ownerAddress: string): string {
  return `bitnoir-phoenix-3ref-v1-${ownerAddress}`;
}

function sirenUnlockKeyForWallet(ownerAddress: string): string {
  return `bitnoir-siren-05power-v1-${ownerAddress}`;
}

function auraUnlockKeyForWallet(ownerAddress: string): string {
  return `bitnoir-aura-10active-v1-${ownerAddress}`;
}

function dragonUnlockKeyForWallet(ownerAddress: string): string {
  return `bitnoir-dragon-2solpower-v1-${ownerAddress}`;
}

export function isPowerCardPending(card: ReceivedPowerCard): boolean {
  return !card.activatedAt && !card.expiresAt;
}

export function isPowerCardActive(card: ReceivedPowerCard, nowMs = Date.now()): boolean {
  const def = POWER_CARD_CATALOG.find((c) => c.id === card.cardId);
  if (!def) return false;
  if (!card.activatedAt || !card.expiresAt) return false;
  const exp = Date.parse(card.expiresAt);
  return Number.isFinite(exp) && exp > nowMs;
}

export function isPowerCardAlive(card: ReceivedPowerCard, nowMs = Date.now()): boolean {
  const def = POWER_CARD_CATALOG.find((c) => c.id === card.cardId);
  if (!def) return false;
  if (isPowerCardPending(card)) return true;
  return isPowerCardActive(card, nowMs);
}

export function getWalletPowerCards(ownerAddress: string): ReceivedPowerCard[] {
  if (!ownerAddress) return [];
  try {
    const raw = safeStorageGet(storageKeyForWallet(ownerAddress));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    const validEntries = parsed.filter(
      (item): item is ReceivedPowerCard =>
        Boolean(item && typeof item.cardId === 'string' && typeof item.unlockedAt === 'string'),
    );
    const aliveEntries = validEntries.filter((item) => isPowerCardAlive(item, now));
    if (aliveEntries.length !== validEntries.length) {
      saveWalletPowerCards(ownerAddress, aliveEntries);
    }
    return aliveEntries;
  } catch {
    return [];
  }
}

export function saveWalletPowerCards(ownerAddress: string, cards: ReceivedPowerCard[]): void {
  if (!ownerAddress) return;
  try {
    safeStorageSet(storageKeyForWallet(ownerAddress), JSON.stringify(cards));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('bitnoir-cards-updated'));
    }
  } catch {
    // Ignore storage error
  }
}

export function hasUnlockedGenesisAntCardBefore(ownerAddress: string): boolean {
  if (!ownerAddress) return false;
  return Boolean(safeStorageGet(genesisUnlockKeyForWallet(ownerAddress)));
}

export function hasUnlockedSpiderCardBefore(ownerAddress: string): boolean {
  if (!ownerAddress) return false;
  return Boolean(safeStorageGet(spiderUnlockKeyForWallet(ownerAddress)));
}

export function hasUnlockedPhoenixCardBefore(ownerAddress: string): boolean {
  if (!ownerAddress) return false;
  return Boolean(safeStorageGet(phoenixUnlockKeyForWallet(ownerAddress)));
}

export function hasUnlockedSirenCardBefore(ownerAddress: string): boolean {
  if (!ownerAddress) return false;
  return Boolean(safeStorageGet(sirenUnlockKeyForWallet(ownerAddress)));
}

export function hasUnlockedAuraCardBefore(ownerAddress: string): boolean {
  if (!ownerAddress) return false;
  return Boolean(safeStorageGet(auraUnlockKeyForWallet(ownerAddress)));
}

export function hasUnlockedDragonCardBefore(ownerAddress: string): boolean {
  if (!ownerAddress) return false;
  return Boolean(safeStorageGet(dragonUnlockKeyForWallet(ownerAddress)));
}

/**
 * Unlocks the Genesis ANT CARD once per wallet when the user starts mining.
 * Starts in a sealed / pending state (NOT auto-activated).
 */
export function unlockGenesisAntCardOnStartMining(ownerAddress: string): ReceivedPowerCard[] {
  if (!ownerAddress) return [];
  if (hasUnlockedGenesisAntCardBefore(ownerAddress)) {
    return getWalletPowerCards(ownerAddress);
  }

  const nowIso = new Date().toISOString();
  safeStorageSet(genesisUnlockKeyForWallet(ownerAddress), nowIso);

  const current = getWalletPowerCards(ownerAddress);
  if (current.some((c) => c.cardId === ANT_CARD_ID)) {
    return current;
  }

  const next: ReceivedPowerCard[] = [
    ...current,
    {
      cardId: ANT_CARD_ID,
      unlockedAt: nowIso,
    },
  ];
  saveWalletPowerCards(ownerAddress, next);
  return next;
}

/**
 * Unlocks the SPIDER CARD once per wallet after completing verification and receiving UID.
 * Starts in a sealed / pending state (NOT auto-activated).
 */
export function unlockSpiderCardOnVerifiedUid(ownerAddress: string): ReceivedPowerCard[] {
  if (!ownerAddress) return [];
  if (hasUnlockedSpiderCardBefore(ownerAddress)) {
    return getWalletPowerCards(ownerAddress);
  }

  const nowIso = new Date().toISOString();
  safeStorageSet(spiderUnlockKeyForWallet(ownerAddress), nowIso);

  const current = getWalletPowerCards(ownerAddress);
  if (current.some((c) => c.cardId === SPIDER_CARD_ID)) {
    return current;
  }

  const next: ReceivedPowerCard[] = [
    ...current,
    {
      cardId: SPIDER_CARD_ID,
      unlockedAt: nowIso,
    },
  ];
  saveWalletPowerCards(ownerAddress, next);
  return next;
}

/**
 * Unlocks the PHOENIX CARD once per wallet when the user successfully invites 3+ verified miners.
 * Starts in a sealed / pending state (NOT auto-activated).
 */
export function unlockPhoenixCardOnThreeVerifiedMiners(
  ownerAddress: string,
  verifiedReferralCount: number,
): ReceivedPowerCard[] {
  if (!ownerAddress || verifiedReferralCount < 3) {
    return ownerAddress ? getWalletPowerCards(ownerAddress) : [];
  }
  if (hasUnlockedPhoenixCardBefore(ownerAddress)) {
    return getWalletPowerCards(ownerAddress);
  }

  const nowIso = new Date().toISOString();
  safeStorageSet(phoenixUnlockKeyForWallet(ownerAddress), nowIso);

  const current = getWalletPowerCards(ownerAddress);
  if (current.some((c) => c.cardId === PHOENIX_CARD_ID)) {
    return current;
  }

  const next: ReceivedPowerCard[] = [
    ...current,
    {
      cardId: PHOENIX_CARD_ID,
      unlockedAt: nowIso,
    },
  ];
  saveWalletPowerCards(ownerAddress, next);
  return next;
}

/**
 * Unlocks the SIREN CARD once per wallet the first time Miners Power reaches 0.5/hr.
 * Starts in a sealed / pending state (NOT auto-activated).
 */
export function unlockSirenCardOnMinersPower(
  ownerAddress: string,
  minersPowerPerHour: number,
): ReceivedPowerCard[] {
  if (!ownerAddress || minersPowerPerHour < 0.5) {
    return ownerAddress ? getWalletPowerCards(ownerAddress) : [];
  }
  if (hasUnlockedSirenCardBefore(ownerAddress)) {
    return getWalletPowerCards(ownerAddress);
  }

  const nowIso = new Date().toISOString();
  safeStorageSet(sirenUnlockKeyForWallet(ownerAddress), nowIso);

  const current = getWalletPowerCards(ownerAddress);
  if (current.some((c) => c.cardId === SIREN_CARD_ID)) {
    return current;
  }

  const next: ReceivedPowerCard[] = [
    ...current,
    {
      cardId: SIREN_CARD_ID,
      unlockedAt: nowIso,
    },
  ];
  saveWalletPowerCards(ownerAddress, next);
  return next;
}

/**
 * Unlocks the AURA CARD once per wallet when reaching 10 verified & active miners.
 * Starts in a sealed / pending state (NOT auto-activated).
 */
export function unlockAuraCardOnTenVerifiedActiveMiners(
  ownerAddress: string,
  verifiedActiveCount: number,
): ReceivedPowerCard[] {
  if (!ownerAddress || verifiedActiveCount < 10) {
    return ownerAddress ? getWalletPowerCards(ownerAddress) : [];
  }
  if (hasUnlockedAuraCardBefore(ownerAddress)) {
    return getWalletPowerCards(ownerAddress);
  }

  const nowIso = new Date().toISOString();
  safeStorageSet(auraUnlockKeyForWallet(ownerAddress), nowIso);

  const current = getWalletPowerCards(ownerAddress);
  if (current.some((c) => c.cardId === AURA_CARD_ID)) {
    return current;
  }

  const next: ReceivedPowerCard[] = [
    ...current,
    {
      cardId: AURA_CARD_ID,
      unlockedAt: nowIso,
    },
  ];
  saveWalletPowerCards(ownerAddress, next);
  return next;
}

/**
 * Unlocks the DRAGON CARD once per wallet when purchasing SOL Power of at least 2/hr.
 * Starts in a sealed / pending state (NOT auto-activated).
 */
export function unlockDragonCardOnSolPower(
  ownerAddress: string,
  solPowerPerHour: number,
): ReceivedPowerCard[] {
  if (!ownerAddress || solPowerPerHour < 2.0) {
    return ownerAddress ? getWalletPowerCards(ownerAddress) : [];
  }
  if (hasUnlockedDragonCardBefore(ownerAddress)) {
    return getWalletPowerCards(ownerAddress);
  }

  const nowIso = new Date().toISOString();
  safeStorageSet(dragonUnlockKeyForWallet(ownerAddress), nowIso);

  const current = getWalletPowerCards(ownerAddress);
  if (current.some((c) => c.cardId === DRAGON_CARD_ID)) {
    return current;
  }

  const next: ReceivedPowerCard[] = [
    ...current,
    {
      cardId: DRAGON_CARD_ID,
      unlockedAt: nowIso,
    },
  ];
  saveWalletPowerCards(ownerAddress, next);
  return next;
}

/**
 * Manually activates a pending Power Card for its catalog duration.
 * Ensures only one card is active at a time and snapshots any running mining bits first.
 */
export function activatePowerCard(
  ownerAddress: string,
  cardId: string,
  isVerifiedNode = false,
): ReceivedPowerCard[] {
  if (!ownerAddress) return [];
  const def = POWER_CARD_CATALOG.find((c) => c.id === cardId);
  if (!def) return [];

  const current = getWalletPowerCards(ownerAddress);
  // Prevent activating if another card is currently active
  const now = Date.now();
  if (current.some((c) => c.cardId !== cardId && isPowerCardActive(c, now))) {
    return current;
  }

  const idx = current.findIndex((c) => c.cardId === cardId && isPowerCardPending(c));
  if (idx === -1) return current;

  const durationMs = (def.durationHours || 24) * 3600 * 1000;
  const nowIso = new Date(now).toISOString();
  const expiresIso = new Date(now + durationMs).toISOString();

  // Lock in any accrued mining points at pre-card rate so upgrading does not retroactively inflate prior elapsed time
  const miningState = getWalletMiningState(ownerAddress);
  if (miningState.isMiningSessionActive) {
    const dt = Math.max(0, (now - miningState.lastTickAt) / 1000);
    const preMaxSec = isVerifiedNode ? 24 * 3600 : 3 * 3600;
    const cappedElapsed = Math.min(preMaxSec, miningState.sessionElapsedSec + dt);
    const activeDt = Math.max(0, cappedElapsed - miningState.sessionElapsedSec);
    const preRate = isVerifiedNode ? 0.1 + calculateSolPowerBoost(miningState.contributedSol) : 0.01;
    const lockedBits = miningState.unclaimedBits + (preRate / 3600) * activeDt;
    saveWalletMiningState(ownerAddress, {
      ...miningState,
      unclaimedBits: lockedBits,
      sessionElapsedSec: cappedElapsed,
      lastTickAt: now,
    });
  }

  const next = current.map((c, i) =>
    i === idx
      ? {
          ...c,
          activatedAt: nowIso,
          expiresAt: expiresIso,
        }
      : c,
  );
  saveWalletPowerCards(ownerAddress, next);

  const shortDuration = formatPowerCardDurationShort(def.durationHours);
  const longDuration = formatPowerCardDurationLong(def.durationHours);

  saveLocalWalletActivity(ownerAddress, {
    id: `card-${cardId}-${now}`,
    kind: 'verify',
    title: `${def.name} Activated · ${shortDuration}`,
    detail: `${def.name} activated (+${def.boostPerHour.toFixed(4)} BITS/hr for ${longDuration})`,
    amount: def.boostPerHour,
    asset: 'BITS/h',
    createdAt: nowIso,
  });

  return next;
}

export function activateAntCard(ownerAddress: string, isVerifiedNode = false): ReceivedPowerCard[] {
  return activatePowerCard(ownerAddress, ANT_CARD_ID, isVerifiedNode);
}

export function hasActiveAntCard(receivedCards: ReceivedPowerCard[]): boolean {
  const now = Date.now();
  return receivedCards.some((c) => c.cardId === ANT_CARD_ID && isPowerCardActive(c, now));
}

export function hasActiveSpiderCard(receivedCards: ReceivedPowerCard[]): boolean {
  const now = Date.now();
  return receivedCards.some((c) => c.cardId === SPIDER_CARD_ID && isPowerCardActive(c, now));
}

export function hasActivePhoenixCard(receivedCards: ReceivedPowerCard[]): boolean {
  const now = Date.now();
  return receivedCards.some((c) => c.cardId === PHOENIX_CARD_ID && isPowerCardActive(c, now));
}

export function hasActiveSirenCard(receivedCards: ReceivedPowerCard[]): boolean {
  const now = Date.now();
  return receivedCards.some((c) => c.cardId === SIREN_CARD_ID && isPowerCardActive(c, now));
}

export function hasActiveAuraCard(receivedCards: ReceivedPowerCard[]): boolean {
  const now = Date.now();
  return receivedCards.some((c) => c.cardId === AURA_CARD_ID && isPowerCardActive(c, now));
}

export function hasActiveDragonCard(receivedCards: ReceivedPowerCard[]): boolean {
  const now = Date.now();
  return receivedCards.some((c) => c.cardId === DRAGON_CARD_ID && isPowerCardActive(c, now));
}

export function hasAnyActivePowerCard(receivedCards: ReceivedPowerCard[]): boolean {
  const now = Date.now();
  return receivedCards.some((c) => isPowerCardActive(c, now));
}

export function getActivePowerCardDef(receivedCards: ReceivedPowerCard[]): PowerCardDefinition | null {
  const now = Date.now();
  const active = receivedCards.find((c) => isPowerCardActive(c, now));
  if (!active) return null;
  return POWER_CARD_CATALOG.find((c) => c.id === active.cardId) || null;
}

export function getCardPowerBoostPerHour(receivedCards: ReceivedPowerCard[]): number {
  const now = Date.now();
  const active = receivedCards.filter((c) => isPowerCardActive(c, now));
  if (!active.length) return 0;
  const ownedIds = new Set(active.map((c) => c.cardId));
  return POWER_CARD_CATALOG.reduce(
    (sum, card) => (ownedIds.has(card.id) ? sum + card.boostPerHour : sum),
    0,
  );
}

export function getPowerCardRemainingMs(receivedCards: ReceivedPowerCard[], cardId: string): number {
  const card = receivedCards.find((c) => c.cardId === cardId && isPowerCardActive(c));
  if (!card || !card.expiresAt) return 0;
  const exp = Date.parse(card.expiresAt);
  if (!Number.isFinite(exp)) return 0;
  return Math.max(0, exp - Date.now());
}

export function getAntCardRemainingMs(receivedCards: ReceivedPowerCard[]): number {
  return getPowerCardRemainingMs(receivedCards, ANT_CARD_ID);
}
