import { Router, type IRouter } from "express";
import {
  GetDepositAddressesResponse,
  GetPresaleOverviewResponse,
} from "@workspace/api-zod";
import {
  activeDepositAddresses,
  getPublicOverview,
} from "../lib/bitnoir";

const router: IRouter = Router();

router.get("/presale/overview", async (_req, res): Promise<void> => {
  const overview = GetPresaleOverviewResponse.parse(await getPublicOverview());
  res.json(overview);
});

router.get("/presale/deposit-addresses", async (_req, res): Promise<void> => {
  const addresses = await activeDepositAddresses();
  res.json(GetDepositAddressesResponse.parse(addresses));
});

router.get("/statistics", async (_req, res): Promise<void> => {
  res.json({
    totalReserve: 4200000,
    totalDistributed: 342850,
    remainingTokens: 3857149,
    remainingPercent: 91.84,
    totalBitsStaked: 14840000,
    totalBitsStakedUsd: 1484000,
    totalAmountBurnedBits: 24062250,
    totalAmountBurnedBitsUsd: 2406225,
    totalCommittedBits: 28650000,
    totalCommittedBitsUsd: 2865000,
    activeStakers: 1421,
    totalUsers: 3842,
    emissionRatePerHour: 12.4,
    hardCapSupply: 21000000,
  });
});

export default router;
