import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const bitnoirUsersTable = pgTable("bitnoir_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("user"),
  referralCode: text("referral_code").notNull().unique(),
  referredBy: text("referred_by"),
  xp: integer("xp").notNull().default(0),
  purchasedTokens: numeric("purchased_tokens", {
    precision: 28,
    scale: 8,
    mode: "number",
  })
    .notNull()
    .default(0),
  stakedTokens: numeric("staked_tokens", {
    precision: 28,
    scale: 8,
    mode: "number",
  })
    .notNull()
    .default(0),
  claimableTokens: numeric("claimable_tokens", {
    precision: 28,
    scale: 8,
    mode: "number",
  })
    .notNull()
    .default(0),
  swapAvailableTokens: numeric("swap_available_tokens", {
    precision: 28,
    scale: 8,
    mode: "number",
  })
    .notNull()
    .default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
export const insertBitnoirUserSchema = createInsertSchema(
  bitnoirUsersTable,
).omit({ createdAt: true, updatedAt: true });
export type InsertBitnoirUser = z.infer<typeof insertBitnoirUserSchema>;
export type BitnoirUser = typeof bitnoirUsersTable.$inferSelect;

export const presaleBatchesTable = pgTable("bitnoir_presale_batches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().unique(),
  pricePerToken: numeric("price_per_token", {
    precision: 18,
    scale: 8,
    mode: "number",
  })
    .notNull()
    .default(0.1),
  tokenSupply: numeric("token_supply", {
    precision: 28,
    scale: 8,
    mode: "number",
  })
    .notNull()
    .default(2100000),
  tokensSold: numeric("tokens_sold", {
    precision: 28,
    scale: 8,
    mode: "number",
  })
    .notNull()
    .default(0),
  status: text("status").notNull().default("upcoming"),
});
export const insertPresaleBatchSchema = createInsertSchema(
  presaleBatchesTable,
).omit({ id: true });
export type InsertPresaleBatch = z.infer<typeof insertPresaleBatchSchema>;

export const launchSettingsTable = pgTable("bitnoir_launch_settings", {
  id: integer("id").primaryKey().default(1),
  saleOpen: boolean("sale_open").notNull().default(true),
  stakingOpen: boolean("staking_open").notNull().default(false),
  claimsOpen: boolean("claims_open").notNull().default(false),
  swapsOpen: boolean("swaps_open").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const depositAddressesTable = pgTable("bitnoir_deposit_addresses", {
  id: serial("id").primaryKey(),
  chain: text("chain").notNull().unique(),
  address: text("address").notNull(),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
export const insertDepositAddressSchema = createInsertSchema(
  depositAddressesTable,
).omit({ id: true, updatedAt: true });
export type InsertDepositAddress = z.infer<typeof insertDepositAddressSchema>;

export const depositsTable = pgTable("bitnoir_deposits", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => bitnoirUsersTable.id),
  batchId: integer("batch_id")
    .notNull()
    .references(() => presaleBatchesTable.id),
  chain: text("chain").notNull(),
  amountUsdt: numeric("amount_usdt", {
    precision: 18,
    scale: 6,
    mode: "number",
  }).notNull(),
  pricePerToken: numeric("price_per_token", {
    precision: 18,
    scale: 8,
    mode: "number",
  }).notNull(),
  estimatedTokens: numeric("estimated_tokens", {
    precision: 28,
    scale: 8,
    mode: "number",
  }).notNull(),
  status: text("status").notNull().default("pending"),
  reference: text("reference").notNull().unique(),
  receiveAddress: text("receive_address"),
  txHash: text("tx_hash"),
  tokensCredited: numeric("tokens_credited", {
    precision: 28,
    scale: 8,
    mode: "number",
  }),
  rejectionReason: text("rejection_reason"),
  reviewedBy: text("reviewed_by").references(() => bitnoirUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});
export const insertDepositSchema = createInsertSchema(depositsTable).omit({
  id: true,
  status: true,
  tokensCredited: true,
  rejectionReason: true,
  reviewedBy: true,
  createdAt: true,
  reviewedAt: true,
});
export type InsertDeposit = z.infer<typeof insertDepositSchema>;
export type BitnoirDeposit = typeof depositsTable.$inferSelect;

export const activityTable = pgTable("bitnoir_activity", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => bitnoirUsersTable.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const insertActivitySchema = createInsertSchema(activityTable).omit({
  id: true,
  createdAt: true,
});
export type InsertActivity = z.infer<typeof insertActivitySchema>;

export const xpAwardsTable = pgTable("bitnoir_xp_awards", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => bitnoirUsersTable.id),
  source: text("source").notNull().unique(),
  kind: text("kind").notNull(),
  amount: integer("amount").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tokenLedgerTable = pgTable("bitnoir_token_ledger", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => bitnoirUsersTable.id),
  source: text("source").notNull().unique(),
  kind: text("kind").notNull(),
  amountTokens: numeric("amount_tokens", {
    precision: 28,
    scale: 8,
    mode: "number",
  }).notNull(),
  fromBucket: text("from_bucket"),
  toBucket: text("to_bucket").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
