import { randomBytes } from "node:crypto";
import { clerkClient, getAuth } from "@clerk/express";
import { and, count, desc, eq, isNull, sql, sum } from "drizzle-orm";
import type { Request, Response } from "express";
import {
  activityTable,
  bitnoirUsersTable,
  db,
  depositsTable,
  depositAddressesTable,
  launchSettingsTable,
  presaleBatchesTable,
  xpAwardsTable,
  type BitnoirUser,
} from "@workspace/db";

export const TOTAL_SUPPLY = 21_000_000;
export const PUBLIC_SALE_SUPPLY = 8_400_000;
export const SUPPORTED_CHAINS = [
  "ethereum",
  "bnb",
  "polygon",
  "arbitrum",
  "base",
  "solana",
] as const;

export const TOKEN_ALLOCATIONS = [
  { name: "Public sale", percent: 40 },
  { name: "Airdrop & listing", percent: 8 },
  { name: "Staking", percent: 20 },
  { name: "Market making", percent: 11 },
  { name: "CEX listing", percent: 21 },
] as const;

export const WELCOME_XP = 100;
export const REFERRAL_XP = 250;

const initialBatches = [
  { name: "Genesis", sortOrder: 1, pricePerToken: 0.1, status: "active" },
  { name: "Early", sortOrder: 2, pricePerToken: 0.105, status: "upcoming" },
  { name: "Growth", sortOrder: 3, pricePerToken: 0.11, status: "upcoming" },
  { name: "Final", sortOrder: 4, pricePerToken: 0.12, status: "upcoming" },
] as const;

export async function ensureDefaults(): Promise<void> {
  await db
    .insert(launchSettingsTable)
    .values({
      id: 1,
      saleOpen: true,
      stakingOpen: true,
      claimsOpen: false,
      swapsOpen: false,
    })
    .onConflictDoNothing();

  await db
    .insert(presaleBatchesTable)
    .values(
      initialBatches.map((batch) => ({
        ...batch,
        tokenSupply: PUBLIC_SALE_SUPPLY / initialBatches.length,
        tokensSold: 0,
      })),
    )
    .onConflictDoNothing();
}

export async function getLaunchSettings() {
  await ensureDefaults();
  const [settings] = await db
    .select()
    .from(launchSettingsTable)
    .where(eq(launchSettingsTable.id, 1))
    .limit(1);

  return (
    settings ?? {
      id: 1,
      saleOpen: false,
      stakingOpen: false,
      claimsOpen: false,
      swapsOpen: false,
      updatedAt: new Date(),
    }
  );
}

export async function getActiveBatch() {
  await ensureDefaults();
  const [batch] = await db
    .select()
    .from(presaleBatchesTable)
    .where(eq(presaleBatchesTable.status, "active"))
    .orderBy(presaleBatchesTable.sortOrder)
    .limit(1);
  return batch ?? null;
}

export function asAccount(user: BitnoirUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role === "admin" ? "admin" : "user",
    referralCode: user.referralCode,
    referredBy: user.referredBy,
    xp: user.xp,
    balances: {
      purchased: Number(user.purchasedTokens),
      staked: Number(user.stakedTokens),
      claimable: Number(user.claimableTokens),
      swapAvailable: Number(user.swapAvailableTokens),
    },
    createdAt: user.createdAt.toISOString(),
  };
}

async function provisionAccount(userId: string): Promise<BitnoirUser> {
  const clerkUser = await clerkClient.users.getUser(userId);
  const primaryEmail = clerkUser.emailAddresses.find(
    (entry) => entry.id === clerkUser.primaryEmailAddressId,
  );

  if (!primaryEmail || primaryEmail.verification?.status !== "verified") {
    throw new Error("Verify your email address before using Bitnoir.");
  }

  const email = primaryEmail.emailAddress.toLowerCase();
  const name =
    clerkUser.fullName?.trim() ||
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
    email.split("@")[0];

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(41257, 21000000)`);

    const [existing] = await tx
      .select()
      .from(bitnoirUsersTable)
      .where(eq(bitnoirUsersTable.id, userId))
      .limit(1);
    if (existing) return existing;

    const [userCount] = await tx
      .select({ value: count() })
      .from(bitnoirUsersTable);
    const isFirstAccount = Number(userCount?.value ?? 0) === 0;
    const referralCode = randomBytes(6).toString("hex").toUpperCase();

    const [created] = await tx
      .insert(bitnoirUsersTable)
      .values({
        id: userId,
        name,
        email,
        role: isFirstAccount ? "admin" : "user",
        referralCode,
        xp: WELCOME_XP,
      })
      .returning();

    await tx.insert(xpAwardsTable).values({
      userId,
      source: `signup:${userId}`,
      kind: "welcome",
      amount: WELCOME_XP,
    });
    await tx.insert(activityTable).values({
      userId,
      kind: "welcome",
      title: "Welcome to Bitnoir",
      detail: `${WELCOME_XP} XP added to your account.`,
    });

    return created;
  });
}

export async function accountForRequest(
  req: Request,
  res: Response,
): Promise<BitnoirUser | null> {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required." });
    return null;
  }

  try {
    return await provisionAccount(userId);
  } catch (error) {
    const requiresVerification =
      error instanceof Error &&
      error.message.startsWith("Verify your email");
    req.log.warn({ err: error }, "Account provisioning failed");
    res.status(requiresVerification ? 403 : 503).json({
      error: requiresVerification
        ? "Verify your email address before using Bitnoir."
        : "Account is temporarily unavailable.",
    });
    return null;
  }
}

export async function adminForRequest(
  req: Request,
  res: Response,
): Promise<BitnoirUser | null> {
  const user = await accountForRequest(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Administrator access required." });
    return null;
  }
  return user;
}

export async function getPublicOverview() {
  await ensureDefaults();
  const [batches, settings, raisedResult, soldResult] = await Promise.all([
    db.select().from(presaleBatchesTable).orderBy(presaleBatchesTable.sortOrder),
    getLaunchSettings(),
    db
      .select({ total: sum(depositsTable.amountUsdt) })
      .from(depositsTable)
      .where(eq(depositsTable.status, "approved")),
    db
      .select({ total: sum(presaleBatchesTable.tokensSold) })
      .from(presaleBatchesTable),
  ]);

  const allocations = TOKEN_ALLOCATIONS.map((entry) => ({
    ...entry,
    tokens: (TOTAL_SUPPLY * entry.percent) / 100,
  }));

  return {
    tokenName: "Bitnoir",
    tokenSymbol: "BITS",
    totalSupply: TOTAL_SUPPLY,
    basePrice: 0.1,
    totalRaisedUsdt: Number(raisedResult[0]?.total ?? 0),
    totalTokensSold: Number(soldResult[0]?.total ?? 0),
    publicSaleSupply: PUBLIC_SALE_SUPPLY,
    allocations,
    batches: batches.map((batch) => ({
      id: batch.id,
      name: batch.name,
      pricePerToken: Number(batch.pricePerToken),
      tokenSupply: Number(batch.tokenSupply),
      tokensSold: Number(batch.tokensSold),
      status: batch.status as "active" | "upcoming" | "complete",
    })),
    launch: {
      saleOpen: settings.saleOpen,
      stakingOpen: settings.stakingOpen,
      claimsOpen: settings.claimsOpen,
      swapsOpen: settings.swapsOpen,
    },
    supportedChains: [...SUPPORTED_CHAINS],
  };
}

export async function recentActivity(userId: string) {
  return db
    .select()
    .from(activityTable)
    .where(eq(activityTable.userId, userId))
    .orderBy(desc(activityTable.createdAt))
    .limit(12);
}

export async function applyReferral(
  user: BitnoirUser,
  referralCode: string,
): Promise<{ applied: boolean; xpAwarded: number; message: string }> {
  const code = referralCode.trim().toUpperCase();
  const [referrer] = await db
    .select()
    .from(bitnoirUsersTable)
    .where(eq(bitnoirUsersTable.referralCode, code))
    .limit(1);

  if (!referrer || referrer.id === user.id) {
    return {
      applied: false,
      xpAwarded: 0,
      message: "That invite code is not valid.",
    };
  }
  if (user.referredBy) {
    return {
      applied: false,
      xpAwarded: 0,
      message: "An invite code has already been applied to this account.",
    };
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(bitnoirUsersTable)
      .set({ referredBy: referrer.id })
      .where(
        and(
          eq(bitnoirUsersTable.id, user.id),
          isNull(bitnoirUsersTable.referredBy),
        ),
      )
      .returning();

    if (!updated) {
      return {
        applied: false,
        xpAwarded: 0,
        message: "An invite code has already been applied to this account.",
      };
    }

    const [award] = await tx
      .insert(xpAwardsTable)
      .values({
        userId: referrer.id,
        source: `referral:${user.id}`,
        kind: "referral",
        amount: REFERRAL_XP,
      })
      .onConflictDoNothing()
      .returning();

    if (award) {
      await tx
        .update(bitnoirUsersTable)
        .set({ xp: sql`${bitnoirUsersTable.xp} + ${REFERRAL_XP}` })
        .where(eq(bitnoirUsersTable.id, referrer.id));
      await tx.insert(activityTable).values({
        userId: referrer.id,
        kind: "referral",
        title: "A friend joined",
        detail: `Your invite earned you ${REFERRAL_XP} XP.`,
      });
    }

    await tx.insert(activityTable).values({
      userId: user.id,
      kind: "referral",
      title: "Invite code applied",
      detail: `Invited by ${referrer.name}.`,
    });

    return {
      applied: true,
      xpAwarded: 0,
      message: "Invite code applied. Your inviter earned XP.",
    };
  });
}

export async function activeDepositAddresses() {
  return db
    .select()
    .from(depositAddressesTable)
    .where(eq(depositAddressesTable.active, true))
    .orderBy(depositAddressesTable.chain);
}

export async function accountDeposits(userId: string) {
  return db
    .select()
    .from(depositsTable)
    .where(eq(depositsTable.userId, userId))
    .orderBy(desc(depositsTable.createdAt));
}

export function makeDepositReference(): string {
  return `BNO-${randomBytes(6).toString("hex").toUpperCase()}`;
}

export function roundedTokens(value: number): number {
  return Number(value.toFixed(8));
}

export async function countUsers() {
  const [result] = await db
    .select({ value: count() })
    .from(bitnoirUsersTable);
  return Number(result?.value ?? 0);
}

export async function totalRaised() {
  const [result] = await db
    .select({ value: sum(depositsTable.amountUsdt) })
    .from(depositsTable)
    .where(eq(depositsTable.status, "approved"));
  return Number(result?.value ?? 0);
}
