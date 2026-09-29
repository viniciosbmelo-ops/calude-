import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import doctorsRouter from "./doctors";
import patientsRouter from "./patients";
import reportsRouter from "./reports";
import patientRouter from "./patient";
import contactRouter from "./contact";
import storageRouter from "./storage";
import notificationsRouter from "./notifications";
import { patientAttachmentsRouter } from "./patient-attachments";
import lgpdRouter from "./lgpd";
import secretariesRouter from "./secretaries";
import statsRouter from "./stats";
import stripeRouter from "./stripe";
import pdfRouter from "./pdf";
import regenRouter from "./regen";
import analyticsRouter from "./analytics";
import preConsultRouter from "./pre-consult";
import patientOrientationsRouter from "./patient-orientations";
import { subscriptionWriteGuard } from "../middlewares/subscriptionWriteGuard";

// DocRegen API: only the features the DocRegen frontend uses (regenerative
// medicine & pain). Surgical, physiotherapy, institutional, admin-console and
// AI-assistant routes live exclusively in DocKnee's api-server.
const router: IRouter = Router();

router.use(subscriptionWriteGuard);
router.use(healthRouter);
router.use(authRouter);
router.use(doctorsRouter);
router.use(patientsRouter);
router.use(reportsRouter);
router.use(patientRouter);
router.use(contactRouter);
router.use(storageRouter);
router.use(notificationsRouter);
router.use(patientAttachmentsRouter);
router.use(lgpdRouter);
router.use(secretariesRouter);
router.use(statsRouter);
router.use(stripeRouter);
router.use(pdfRouter);
router.use(regenRouter);
router.use(analyticsRouter);
router.use(preConsultRouter);
router.use(patientOrientationsRouter);

export default router;
