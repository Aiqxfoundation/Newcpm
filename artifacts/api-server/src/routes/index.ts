import { Router, type IRouter } from "express";
import healthRouter from "./health";
import presaleRouter from "./presale";
import accountRouter from "./account";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(presaleRouter);
router.use(accountRouter);
router.use(adminRouter);

export default router;
