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

export default router;
