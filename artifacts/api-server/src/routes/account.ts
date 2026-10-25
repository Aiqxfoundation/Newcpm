import { randomUUID } from "node:crypto";
import { and, eq, sum } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ApplyReferralCodeBody,
  ApplyReferralCodeResponse,
  CreateDepositBody,
  CreateDepositResponse,
  GetMyAccountResponse,
  GetMyActivityResponse,
  GetMyDepositsResponse,
  StakeTokensBody,
  StakeTokensResponse,
  UpdateDepositTransactionBody,
  UpdateDepositTransactionParams,
  UpdateDepositTransactionResponse,
} from "@workspace/api-zod";
import {
  activityTable,
  bitnoirUsersTable,
  db,
  depositAddressesTable,
  depositsTable,
  presaleBatchesTable,
  tokenLedgerTable,
} from "@workspace/db";
import {
  accountDeposits,
  accountForRequest,
  applyReferral,
  asAccount,
  ensureDefaults,
  getLaunchSettings,
  makeDepositReference,
  recentActivity,
  roundedTokens,
} from "../lib/bitnoir";

const router: IRouter = Router();

function toDeposit(row: typeof depositsTable.$inferSelect) {
  return {
    ...row,
    chain: row.chain as
      | "ethereum"
      | "bnb"
      | "polygon"
      | "arbitrum"
      | "base"
      | "solana",
    status: row.status as "pending" | "approved" | "rejected",
    amountUsdt: Number(row.amountUsdt),
    pricePerToken: Number(row.pricePerToken),
    estimatedTokens: Number(row.estimatedTokens),
    tokensCredited:
      row.tokensCredited == null ? null : Number(row.tokensCredited),
  };
}

router.get("/accounts/me", async (req, res): Promise<void> => {
  const user = await accountForRequest(req, res);
  if (!user) return;
  res.json(GetMyAccountResponse.parse(asAccount(user)));
});

router.get("/accounts/me/activity", async (req, res): Promise<void> => {
  const user = await accountForRequest(req, res);
  if (!user) return;
  const rows = await recentActivity(user.id);
  res.json(
    GetMyActivityResponse.parse(
      rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        detail: row.detail,
        createdAt: row.createdAt,
      })),
    ),
  );
});

router.post("/accounts/me/referral", async (req, res): Promise<void> => {
  const user = await accountForRequest(req, res);
  if (!user) return;
  const parsed = ApplyReferralCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await applyReferral(user, parsed.data.code);
  res.json(ApplyReferralCodeResponse.parse(result));
});

router.get("/accounts/me/deposits", async (req, res): Promise<void> => {
  const user = await accountForRequest(req, res);
  if (!user) return;
  const rows = await accountDeposits(user.id);
  res.json(GetMyDepositsResponse.parse(rows.map(toDeposit)));
});

router.post("/deposits", async (req, res): Promise<void> => {
  const user = await accountForRequest(req, res);
  if (!user) return;
  const parsed = CreateDepositBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await ensureDefaults();
  const settings = await getLaunchSettings();
  if (!settings.saleOpen) {
    res.status(400).json({ error: "The public sale is currently closed." });
    return;
  }

  const [address] = await db
    .select()
    .from(depositAddressesTable)
    .where(
      and(
        eq(depositAddressesTable.chain, parsed.data.chain),
        eq(depositAddressesTable.active, true),
      ),
    )
    .limit(1);
  if (!address) {
    res.status(409).json({
      error: `USDT deposits on ${parsed.data.chain} are not configured yet.`,
    });
    return;
  }

  const reservation = await db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(presaleBatchesTable)
      .where(eq(presaleBatchesTable.status, "active"))
      .orderBy(presaleBatchesTable.sortOrder)
      .for("update")
      .limit(1);
    if (!batch) return { kind: "no-batch" as const };

    const estimatedTokens = roundedTokens(
      parsed.data.amountUsdt / Number(batch.pricePerToken),
    );
    const [pending] = await tx
      .select({ total: sum(depositsTable.estimatedTokens) })
      .from(depositsTable)
      .where(
        and(
          eq(depositsTable.batchId, batch.id),
          eq(depositsTable.status, "pending"),
        ),
      );
    const reservedTokens = Number(pending?.total ?? 0);
    const batchCapacity =
      Number(batch.tokensSold) + reservedTokens + estimatedTokens;
    if (batchCapacity > Number(batch.tokenSupply)) {
      return { kind: "batch-full" as const };
    }

    const [deposit] = await tx
      .insert(depositsTable)
      .values({
        userId: user.id,
        batchId: batch.id,
        chain: parsed.data.chain,
        amountUsdt: parsed.data.amountUsdt,
        pricePerToken: Number(batch.pricePerToken),
        estimatedTokens,
        status: "pending",
        reference: makeDepositReference(),
        receiveAddress: address.address,
      })
      .returning();

    await tx.insert(activityTable).values({
      userId: user.id,
      kind: "deposit",
      title: "Deposit request created",
      detail: `${parsed.data.amountUsdt} USDT on ${parsed.data.chain} is awaiting review.`,
    });
    return { kind: "created" as const, deposit };
  });

  if (reservation.kind === "no-batch") {
    res.status(400).json({ error: "No presale batch is currently active." });
    return;
  }
  if (reservation.kind === "batch-full") {
    res.status(409).json({
      error: "The active batch does not have enough unreserved tokens for this amount.",
    });
    return;
  }

  res
    .status(201)
    .json(CreateDepositResponse.parse(toDeposit(reservation.deposit)));
});

router.patch(
  "/deposits/:id/transaction",
  async (req, res): Promise<void> => {
    const user = await accountForRequest(req, res);
    if (!user) return;

    const params = UpdateDepositTransactionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateDepositTransactionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [deposit] = await db
      .update(depositsTable)
      .set({ txHash: parsed.data.txHash })
      .where(
        and(
          eq(depositsTable.id, params.data.id),
          eq(depositsTable.userId, user.id),
          eq(depositsTable.status, "pending"),
        ),
      )
      .returning();
    if (!deposit) {
      res.status(404).json({ error: "Pending deposit request not found." });
      return;
    }

    res.json(
      UpdateDepositTransactionResponse.parse(toDeposit(deposit)),
    );
  },
);

router.post("/accounts/me/stake", async (req, res): Promise<void> => {
  const user = await accountForRequest(req, res);
  if (!user) return;
  const parsed = StakeTokensBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const settings = await getLaunchSettings();
  if (!settings.stakingOpen) {
    res.status(400).json({ error: "Presale staking is currently closed." });
    return;
  }
  const amount = roundedTokens(parsed.data.amountTokens);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Enter a positive BITS amount." });
    return;
  }

  const updated = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(bitnoirUsersTable)
      .where(eq(bitnoirUsersTable.id, user.id))
      .for("update")
      .limit(1);
    if (!current || amount > Number(current.purchasedTokens)) {
      return null;
    }

    const purchased = roundedTokens(Number(current.purchasedTokens) - amount);
    const staked = roundedTokens(Number(current.stakedTokens) + amount);
    const [next] = await tx
      .update(bitnoirUsersTable)
      .set({ purchasedTokens: purchased, stakedTokens: staked })
      .where(eq(bitnoirUsersTable.id, user.id))
      .returning();

    await tx.insert(tokenLedgerTable).values({
      userId: user.id,
      source: `stake:${randomUUID()}`,
      kind: "stake",
      amountTokens: amount,
      fromBucket: "purchased",
      toBucket: "staked",
    });
    await tx.insert(activityTable).values({
      userId: user.id,
      kind: "stake",
      title: "BITS moved to staking",
      detail: `${amount.toLocaleString()} BITS moved from purchased to staked.`,
    });

    return next;
  });

  if (!updated) {
    res.status(400).json({ error: "Insufficient purchased BITS balance." });
    return;
  }

  res.json(StakeTokensResponse.parse(asAccount(updated)));
});

export default router;
