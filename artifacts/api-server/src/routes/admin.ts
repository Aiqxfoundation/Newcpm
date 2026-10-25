import { count, desc, eq, sql, sum } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  DecideDepositBody,
  DecideDepositParams,
  DecideDepositResponse,
  GetAdminAddressesResponse,
  GetAdminDepositsResponse,
  GetAdminSummaryResponse,
  SaveAdminAddressBody,
  SaveAdminAddressResponse,
  UpdateLaunchSettingsBody,
  UpdateLaunchSettingsResponse,
} from "@workspace/api-zod";
import {
  activityTable,
  bitnoirUsersTable,
  db,
  depositAddressesTable,
  depositsTable,
  launchSettingsTable,
  presaleBatchesTable,
  tokenLedgerTable,
} from "@workspace/db";
import {
  adminForRequest,
  ensureDefaults,
  getLaunchSettings,
  roundedTokens,
} from "../lib/bitnoir";

const router: IRouter = Router();

function toAdminDeposit(
  row: typeof depositsTable.$inferSelect,
  user: typeof bitnoirUsersTable.$inferSelect,
) {
  return {
    id: row.id,
    batchId: row.batchId,
    chain: row.chain as
      | "ethereum"
      | "bnb"
      | "polygon"
      | "arbitrum"
      | "base"
      | "solana",
    amountUsdt: Number(row.amountUsdt),
    pricePerToken: Number(row.pricePerToken),
    estimatedTokens: Number(row.estimatedTokens),
    status: row.status as "pending" | "approved" | "rejected",
    reference: row.reference,
    receiveAddress: row.receiveAddress,
    txHash: row.txHash,
    tokensCredited:
      row.tokensCredited == null ? null : Number(row.tokensCredited),
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
  };
}

router.get("/admin/summary", async (req, res): Promise<void> => {
  const admin = await adminForRequest(req, res);
  if (!admin) return;

  await ensureDefaults();
  const [usersResult, pendingResult, raisedResult, soldResult, addressResult, settings] =
    await Promise.all([
      db.select({ value: count() }).from(bitnoirUsersTable),
      db
        .select({ value: count() })
        .from(depositsTable)
        .where(eq(depositsTable.status, "pending")),
      db
        .select({ value: sum(depositsTable.amountUsdt) })
        .from(depositsTable)
        .where(eq(depositsTable.status, "approved")),
      db
        .select({ value: sum(presaleBatchesTable.tokensSold) })
        .from(presaleBatchesTable),
      db
        .select({ value: count() })
        .from(depositAddressesTable)
        .where(eq(depositAddressesTable.active, true)),
      getLaunchSettings(),
    ]);

  res.json(
    GetAdminSummaryResponse.parse({
      users: Number(usersResult[0]?.value ?? 0),
      pendingDeposits: Number(pendingResult[0]?.value ?? 0),
      totalRaisedUsdt: Number(raisedResult[0]?.value ?? 0),
      tokensSold: Number(soldResult[0]?.value ?? 0),
      activeAddresses: Number(addressResult[0]?.value ?? 0),
      saleOpen: settings.saleOpen,
    }),
  );
});

router.get("/admin/deposits", async (req, res): Promise<void> => {
  const admin = await adminForRequest(req, res);
  if (!admin) return;

  const rows = await db
    .select({ deposit: depositsTable, user: bitnoirUsersTable })
    .from(depositsTable)
    .innerJoin(
      bitnoirUsersTable,
      eq(depositsTable.userId, bitnoirUsersTable.id),
    )
    .orderBy(desc(depositsTable.createdAt))
    .limit(200);

  res.json(
    GetAdminDepositsResponse.parse(
      rows.map(({ deposit, user }) => toAdminDeposit(deposit, user)),
    ),
  );
});

router.post(
  "/admin/deposits/:id/decision",
  async (req, res): Promise<void> => {
    const admin = await adminForRequest(req, res);
    if (!admin) return;

    const params = DecideDepositParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = DecideDepositBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [deposit] = await tx
        .select()
        .from(depositsTable)
        .where(eq(depositsTable.id, params.data.id))
        .for("update")
        .limit(1);
      if (!deposit) return { kind: "not-found" as const };
      if (deposit.status !== "pending") {
        return { kind: "already-reviewed" as const };
      }

      if (parsed.data.decision === "reject") {
        const reason =
          parsed.data.rejectionReason?.trim() || "Payment could not be verified.";
        const [rejected] = await tx
          .update(depositsTable)
          .set({
            status: "rejected",
            rejectionReason: reason,
            reviewedBy: admin.id,
            reviewedAt: new Date(),
          })
          .where(eq(depositsTable.id, deposit.id))
          .returning();
        await tx.insert(activityTable).values({
          userId: deposit.userId,
          kind: "deposit",
          title: "Deposit request rejected",
          detail: reason,
        });
        return { kind: "updated" as const, deposit: rejected };
      }

      const [batch] = await tx
        .select()
        .from(presaleBatchesTable)
        .where(eq(presaleBatchesTable.id, deposit.batchId))
        .for("update")
        .limit(1);
      if (!batch) return { kind: "batch-missing" as const };
      if (!deposit.txHash) return { kind: "missing-tx" as const };

      const tokens = roundedTokens(Number(deposit.estimatedTokens));
      const remaining = roundedTokens(
        Number(batch.tokenSupply) - Number(batch.tokensSold),
      );
      if (tokens > remaining) return { kind: "batch-full" as const };

      const [user] = await tx
        .select()
        .from(bitnoirUsersTable)
        .where(eq(bitnoirUsersTable.id, deposit.userId))
        .for("update")
        .limit(1);
      if (!user) return { kind: "user-missing" as const };

      const nextSold = roundedTokens(Number(batch.tokensSold) + tokens);
      await tx
        .update(presaleBatchesTable)
        .set({
          tokensSold: nextSold,
          status: nextSold >= Number(batch.tokenSupply) ? "complete" : "active",
        })
        .where(eq(presaleBatchesTable.id, batch.id));

      if (nextSold >= Number(batch.tokenSupply)) {
        const [nextBatch] = await tx
          .select()
          .from(presaleBatchesTable)
          .where(eq(presaleBatchesTable.status, "upcoming"))
          .orderBy(presaleBatchesTable.sortOrder)
          .limit(1)
          .for("update");
        if (nextBatch) {
          await tx
            .update(presaleBatchesTable)
            .set({ status: "active" })
            .where(eq(presaleBatchesTable.id, nextBatch.id));
        }
      }

      const [approved] = await tx
        .update(depositsTable)
        .set({
          status: "approved",
          tokensCredited: tokens,
          rejectionReason: null,
          reviewedBy: admin.id,
          reviewedAt: new Date(),
        })
        .where(eq(depositsTable.id, deposit.id))
        .returning();

      await tx
        .update(bitnoirUsersTable)
        .set({
          purchasedTokens: sql`${bitnoirUsersTable.purchasedTokens} + ${tokens}`,
        })
        .where(eq(bitnoirUsersTable.id, user.id));

      await tx.insert(tokenLedgerTable).values({
        userId: user.id,
        source: `deposit:${deposit.id}`,
        kind: "presale_purchase",
        amountTokens: tokens,
        toBucket: "purchased",
      });
      await tx.insert(activityTable).values({
        userId: user.id,
        kind: "purchase",
        title: "USDT deposit approved",
        detail: `${tokens.toLocaleString()} BITS added to purchased balance.`,
      });

      return { kind: "updated" as const, deposit: approved };
    });

    if (result.kind === "not-found") {
      res.status(404).json({ error: "Deposit request not found." });
      return;
    }
    if (result.kind === "already-reviewed") {
      res.status(409).json({ error: "This deposit has already been reviewed." });
      return;
    }
    if (result.kind === "missing-tx") {
      res.status(400).json({
        error: "Add and verify a transaction hash before approving this deposit.",
      });
      return;
    }
    if (result.kind === "batch-full") {
      res.status(400).json({
        error:
          "This quoted batch no longer has enough tokens. Reject the request or contact the user.",
      });
      return;
    }
    if (result.kind !== "updated") {
      res.status(400).json({ error: "The deposit could not be finalized." });
      return;
    }

    const [user] = await db
      .select()
      .from(bitnoirUsersTable)
      .where(eq(bitnoirUsersTable.id, result.deposit.userId))
      .limit(1);
    if (!user) {
      res.status(400).json({ error: "The account for this deposit was not found." });
      return;
    }
    res.json(
      DecideDepositResponse.parse(toAdminDeposit(result.deposit, user)),
    );
  },
);

router.get("/admin/addresses", async (req, res): Promise<void> => {
  const admin = await adminForRequest(req, res);
  if (!admin) return;
  const addresses = await db
    .select()
    .from(depositAddressesTable)
    .orderBy(depositAddressesTable.chain);
  res.json(GetAdminAddressesResponse.parse(addresses));
});

router.put("/admin/addresses", async (req, res): Promise<void> => {
  const admin = await adminForRequest(req, res);
  if (!admin) return;
  const parsed = SaveAdminAddressBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [address] = await db
    .insert(depositAddressesTable)
    .values(parsed.data)
    .onConflictDoUpdate({
      target: depositAddressesTable.chain,
      set: {
        address: parsed.data.address,
        active: parsed.data.active,
        updatedAt: new Date(),
      },
    })
    .returning();
  res.json(SaveAdminAddressResponse.parse(address));
});

router.put("/admin/launch", async (req, res): Promise<void> => {
  const admin = await adminForRequest(req, res);
  if (!admin) return;
  const parsed = UpdateLaunchSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await ensureDefaults();
  const [settings] = await db
    .insert(launchSettingsTable)
    .values({ id: 1, ...parsed.data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: launchSettingsTable.id,
      set: { ...parsed.data, updatedAt: new Date() },
    })
    .returning();
  res.json(
    UpdateLaunchSettingsResponse.parse({
      saleOpen: settings.saleOpen,
      stakingOpen: settings.stakingOpen,
      claimsOpen: settings.claimsOpen,
      swapsOpen: settings.swapsOpen,
    }),
  );
});

export default router;
