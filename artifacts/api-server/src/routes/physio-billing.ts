import { Router, type IRouter } from "express";
import { requirePhysio } from "../middlewares/requireAuth";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { getCheckoutRedirectBase } from "../lib/base-url";
import {
  FREE_PATIENT_LIMIT,
  getPhysio,
  hasActiveSubscription,
  isReadOnly,
  listFisioPlans,
  createFisioCheckoutSession,
  refreshPhysioSubscriptionStatus,
} from "../lib/physioBilling";
import { z } from "zod/v4";

const router: IRouter = Router();

/** GET /physio/billing/plans — prices do produto DocKnee Fisio (público, sem auth). */
router.get("/physio/billing/plans", async (_req, res): Promise<void> => {
  res.json({ plans: await listFisioPlans(), freeLimit: FREE_PATIENT_LIMIT });
});

// Demais rotas exigem autenticação de fisioterapeuta.
router.use("/physio/billing", requirePhysio);

/** GET /physio/billing/status — estado do plano para o frontend. */
router.get("/physio/billing/status", async (req, res): Promise<void> => {
  let physio = await getPhysio(req.physioId!);
  if (!physio) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  // Self-heal caso o webhook tenha ficado para trás.
  physio = await refreshPhysioSubscriptionStatus(physio);

  const active = hasActiveSubscription(physio);
  res.json({
    plan: physio.plan,
    subscriptionStatus: physio.subscriptionStatus,
    patientsCreatedTotal: physio.patientsCreatedTotal,
    freeLimit: FREE_PATIENT_LIMIT,
    hasActiveSubscription: active,
    readOnly: isReadOnly(physio),
    canAddPatients: active || (!isReadOnly(physio) && physio.patientsCreatedTotal < FREE_PATIENT_LIMIT),
  });
});

const CheckoutBody = z.object({
  priceId: z.string().min(1).optional(),
  inviteToken: z.string().min(20).optional(),
});

/** POST /physio/billing/checkout — abre sessão de checkout do plano fisio. */
router.post("/physio/billing/checkout", async (req, res): Promise<void> => {
  const parsed = CheckoutBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos" });
    return;
  }
  const physio = await getPhysio(req.physioId!);
  if (!physio) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  try {
    const url = await createFisioCheckoutSession(physio, req, parsed.data);
    if (!url) {
      res.status(400).json({ error: "Plano inválido ou indisponível. Tente novamente." });
      return;
    }
    res.json({ url });
  } catch (err) {
    req.log.error({ err }, "physio/billing/checkout failed");
    res.status(502).json({ error: "Não foi possível iniciar o pagamento. Tente novamente." });
  }
});

/** POST /physio/billing/portal — Stripe Customer Portal para assinantes. */
router.post("/physio/billing/portal", async (req, res): Promise<void> => {
  const physio = await getPhysio(req.physioId!);
  if (!physio) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  if (!physio.stripeCustomerId) {
    res.status(400).json({ error: "Nenhuma assinatura encontrada" });
    return;
  }
  try {
    const stripe = await getUncachableStripeClient();
    const base = getCheckoutRedirectBase(req);
    const session = await stripe.billingPortal.sessions.create({
      customer: physio.stripeCustomerId,
      return_url: `${base}/fisio/planos`,
    });
    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "physio/billing/portal failed");
    res.status(502).json({ error: "Não foi possível abrir o portal de assinatura. Tente novamente." });
  }
});

export default router;
