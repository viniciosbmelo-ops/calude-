import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import doctorsRouter from "./doctors";
import patientsRouter from "./patients";
import surgeriesRouter from "./surgeries";
import shoulderSurgeriesRouter from "./shoulder-surgeries";
import followupRouter from "./followup";
import reportsRouter from "./reports";
import patientRouter from "./patient";
import mediaRouter from "./media";
import adminRouter from "./admin";
import storageRouter from "./storage";
import agentRouter from "./agent";
import notificationsRouter from "./notifications";
import { waBroadcastRouter } from "./wa-broadcast";
import { patientAttachmentsRouter } from "./patient-attachments";
import lgpdRouter from "./lgpd";
import secretariesRouter from "./secretaries";
import scheduledSurgeriesRouter from "./scheduled-surgeries";
import statsRouter from "./stats";
import stripeRouter from "./stripe";
import pdfRouter from "./pdf";
import servicesRouter from "./services";
import regenRouter from "./regen";
import analyticsRouter from "./analytics";
import adminAnalyticsRouter from "./admin-analytics";
import adminContentRouter from "./admin-content";
import totpRouter from "./totp";
import preConsultRouter from "./pre-consult";
import patientOrientationsRouter from "./patient-orientations";
import adminWhatsappRouter from "./admin-whatsapp";
import decisionSupportRouter from "./decision-support";
import { subscriptionWriteGuard } from "../middlewares/subscriptionWriteGuard";

const router: IRouter = Router();

/**
 * The physiotherapist portal ("painel de fisioterapia") was removed: its
 * login, clinical, documents, agenda, billing and admin endpoints plus the
 * surgeon-side referral invites that only fed it. Answer 404 for every method
 * before the billing guard so no retired path surfaces an auth/billing error.
 * The underlying tables and their data are intentionally preserved.
 */
const RETIRED_PATHS: readonly RegExp[] = [
  /^\/physio(?:-auth)?(?:\/|$)/,
  /^\/admin\/physiotherapists(?:\/|$)/,
  /^\/patients\/[^/]+\/(?:rehab|rehab-invite)\/?$/,
  /^\/care-links(?:\/|$)/,
];

router.use((req, res, next) => {
  if (RETIRED_PATHS.some((pattern) => pattern.test(req.path))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
});
router.use(subscriptionWriteGuard);
router.use(healthRouter);
router.use(authRouter);
router.use(doctorsRouter);
router.use(patientsRouter);
router.use(surgeriesRouter);
router.use(shoulderSurgeriesRouter);
router.use(followupRouter);
router.use(reportsRouter);
router.use(patientRouter);
router.use(mediaRouter);
router.use(adminRouter);
router.use(storageRouter);
router.use(agentRouter);
router.use(notificationsRouter);
router.use(waBroadcastRouter);
router.use(patientAttachmentsRouter);
router.use(lgpdRouter);
router.use(secretariesRouter);
router.use(scheduledSurgeriesRouter);
router.use(statsRouter);
router.use(stripeRouter);
router.use(pdfRouter);
router.use(servicesRouter);
router.use(regenRouter);
router.use(analyticsRouter);
router.use(adminAnalyticsRouter);
router.use(adminContentRouter);
router.use(totpRouter);
router.use(preConsultRouter);
router.use(patientOrientationsRouter);
router.use(adminWhatsappRouter);
router.use(decisionSupportRouter);

export default router;
