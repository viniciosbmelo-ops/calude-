/**
 * Admin CRUD for:
 *   - Feature flags (GET/POST/PATCH/DELETE /admin/feature-flags)
 *   - Announcements (GET/POST/PATCH/DELETE /admin/announcements)
 *   - FAQs (GET/POST/PATCH/DELETE /admin/faqs)
 *   - Campaigns (GET/POST/PATCH/DELETE /admin/campaigns)
 *   - Admin alerts (GET /admin/alerts, PATCH /admin/alerts/:id/read)
 *   - Ticket metadata (PATCH /admin/contact-messages/:id/ticket)
 *
 * Public read endpoints (no auth required):
 *   - GET /announcements (active only, no admin metadata)
 *   - GET /faqs (active only, no admin metadata)
 *   - GET /feature-flags/:key (enabled+variant only)
 *
 * All admin endpoints require requireAdmin.
 * Input validated with Zod.
 * Audit records created via featureFlagAuditTable for flags.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  featureFlagsTable,
  featureFlagAuditTable,
  announcementsTable,
  faqsTable,
  campaignsTable,
  adminAlertsTable,
  adminContactMessages,
} from "@workspace/db";
import { eq, and, desc, lte, gte, isNull, or, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

// ── Feature Flags ─────────────────────────────────────────────────────────────

const FeatureFlagBody = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, "Key must be lowercase alphanumeric/underscore"),
  description: z.string().max(500).optional(),
  enabled: z.boolean(),
  variant: z.string().max(50).optional(),
});

const FeatureFlagUpdateBody = FeatureFlagBody.partial().omit({ key: true });

/** GET /admin/feature-flags — list all flags (admin). */
router.get("/admin/feature-flags", requireAdmin, async (_req, res): Promise<void> => {
  const flags = await db
    .select()
    .from(featureFlagsTable)
    .orderBy(featureFlagsTable.key);
  res.json(flags);
});

/** POST /admin/feature-flags — create a new flag. */
router.post("/admin/feature-flags", requireAdmin, async (req, res): Promise<void> => {
  const parsed = FeatureFlagBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const adminId = req.doctorId!;
  const { key, description, enabled, variant } = parsed.data;

  // Check key uniqueness
  const [existing] = await db.select({ id: featureFlagsTable.id })
    .from(featureFlagsTable).where(eq(featureFlagsTable.key, key)).limit(1);
  if (existing) {
    res.status(409).json({ error: `Feature flag "${key}" already exists` });
    return;
  }

  const [flag] = await db.insert(featureFlagsTable).values({
    key,
    description: description ?? null,
    enabled,
    variant: variant ?? null,
    updatedBy: adminId,
  }).returning();

  await db.insert(featureFlagAuditTable).values({
    flagId: flag!.id,
    flagKey: key,
    action: "created",
    changedBy: adminId,
    previousValue: null,
    newValue: JSON.stringify(flag),
  });

  res.status(201).json(flag);
});

/** PATCH /admin/feature-flags/:id — update an existing flag. */
router.patch("/admin/feature-flags/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = FeatureFlagUpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const adminId = req.doctorId!;
  const [existing] = await db.select().from(featureFlagsTable).where(eq(featureFlagsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Feature flag not found" }); return; }

  const updates: Partial<typeof featureFlagsTable.$inferInsert> = {
    ...parsed.data,
    version: (existing.version ?? 0) + 1,
    updatedBy: adminId,
  };

  const [updated] = await db.update(featureFlagsTable).set(updates).where(eq(featureFlagsTable.id, id)).returning();

  await db.insert(featureFlagAuditTable).values({
    flagId: id,
    flagKey: existing.key,
    action: "updated",
    changedBy: adminId,
    previousValue: JSON.stringify(existing),
    newValue: JSON.stringify(updated),
  });

  res.json(updated);
});

/** DELETE /admin/feature-flags/:id — delete a flag. */
router.delete("/admin/feature-flags/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const adminId = req.doctorId!;
  const [existing] = await db.select().from(featureFlagsTable).where(eq(featureFlagsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Feature flag not found" }); return; }

  await db.insert(featureFlagAuditTable).values({
    flagId: id,
    flagKey: existing.key,
    action: "deleted",
    changedBy: adminId,
    previousValue: JSON.stringify(existing),
    newValue: null,
  });

  await db.delete(featureFlagsTable).where(eq(featureFlagsTable.id, id));
  res.json({ success: true });
});

/** GET /feature-flags/:key — public endpoint, returns enabled+variant only. */
router.get("/feature-flags/:key", async (req, res): Promise<void> => {
  const key = String(req.params["key"] ?? "");
  if (!key) { res.status(400).json({ error: "Key required" }); return; }

  const [flag] = await db
    .select({ key: featureFlagsTable.key, enabled: featureFlagsTable.enabled, variant: featureFlagsTable.variant, version: featureFlagsTable.version })
    .from(featureFlagsTable)
    .where(eq(featureFlagsTable.key, key))
    .limit(1);

  if (!flag) {
    // Return disabled by default for unknown flags
    res.json({ key, enabled: false, variant: null, version: 0 });
    return;
  }

  res.json(flag);
});

// ── Announcements ─────────────────────────────────────────────────────────────

const AnnouncementBody = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  type: z.enum(["info", "warning", "success", "error"]).default("info"),
  active: z.boolean().default(true),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

/** GET /admin/announcements — list all (admin). */
router.get("/admin/announcements", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(announcementsTable).orderBy(desc(announcementsTable.createdAt));
  res.json(rows);
});

/** POST /admin/announcements — create. */
router.post("/admin/announcements", requireAdmin, async (req, res): Promise<void> => {
  const parsed = AnnouncementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const adminId = req.doctorId!;
  const { title, body: bodyText, type, active, startsAt, expiresAt } = parsed.data;

  const [row] = await db.insert(announcementsTable).values({
    title,
    body: bodyText,
    type,
    active,
    startsAt: startsAt ? new Date(startsAt) : null,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    createdBy: adminId,
    updatedBy: adminId,
  }).returning();

  res.status(201).json(row);
});

/** PATCH /admin/announcements/:id — update. */
router.patch("/admin/announcements/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = AnnouncementBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const adminId = req.doctorId!;
  const data = parsed.data;
  const updates: Record<string, unknown> = { updatedBy: adminId };
  if (data.title !== undefined) updates.title = data.title;
  if (data.body !== undefined) updates.body = data.body;
  if (data.type !== undefined) updates.type = data.type;
  if (data.active !== undefined) updates.active = data.active;
  if (data.startsAt !== undefined) updates.startsAt = data.startsAt ? new Date(data.startsAt) : null;
  if (data.expiresAt !== undefined) updates.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;

  const [updated] = await db.update(announcementsTable).set(updates).where(eq(announcementsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Announcement not found" }); return; }
  res.json(updated);
});

/** DELETE /admin/announcements/:id — delete. */
router.delete("/admin/announcements/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(announcementsTable).where(eq(announcementsTable.id, id));
  res.json({ success: true });
});

/** GET /announcements — public, returns active announcements (no admin metadata). */
router.get("/announcements", async (_req, res): Promise<void> => {
  const now = new Date();
  const rows = await db
    .select({
      id: announcementsTable.id,
      title: announcementsTable.title,
      body: announcementsTable.body,
      type: announcementsTable.type,
      startsAt: announcementsTable.startsAt,
      expiresAt: announcementsTable.expiresAt,
    })
    .from(announcementsTable)
    .where(and(
      eq(announcementsTable.active, true),
      or(isNull(announcementsTable.startsAt), lte(announcementsTable.startsAt, now)),
      or(isNull(announcementsTable.expiresAt), gte(announcementsTable.expiresAt, now)),
    ))
    .orderBy(desc(announcementsTable.createdAt));
  res.json(rows);
});

// ── FAQs ──────────────────────────────────────────────────────────────────────

const FaqBody = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(10000),
  category: z.string().max(100).optional(),
  sortOrder: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

/** GET /admin/faqs — list all (admin). */
router.get("/admin/faqs", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(faqsTable).orderBy(faqsTable.category, faqsTable.sortOrder);
  res.json(rows);
});

/** POST /admin/faqs — create. */
router.post("/admin/faqs", requireAdmin, async (req, res): Promise<void> => {
  const parsed = FaqBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const adminId = req.doctorId!;
  const { question, answer, category, sortOrder, active } = parsed.data;
  const [row] = await db.insert(faqsTable).values({
    question, answer,
    category: category ?? null,
    sortOrder,
    active,
    createdBy: adminId,
    updatedBy: adminId,
  }).returning();
  res.status(201).json(row);
});

/** PATCH /admin/faqs/:id — update. */
router.patch("/admin/faqs/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = FaqBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const adminId = req.doctorId!;
  const [updated] = await db.update(faqsTable)
    .set({ ...parsed.data, updatedBy: adminId })
    .where(eq(faqsTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "FAQ not found" }); return; }
  res.json(updated);
});

/** DELETE /admin/faqs/:id — delete. */
router.delete("/admin/faqs/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(faqsTable).where(eq(faqsTable.id, id));
  res.json({ success: true });
});

/** GET /faqs — public, active only, no admin metadata. */
router.get("/faqs", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: faqsTable.id,
      question: faqsTable.question,
      answer: faqsTable.answer,
      category: faqsTable.category,
      sortOrder: faqsTable.sortOrder,
    })
    .from(faqsTable)
    .where(eq(faqsTable.active, true))
    .orderBy(faqsTable.category, faqsTable.sortOrder);
  res.json(rows);
});

// ── Campaigns ─────────────────────────────────────────────────────────────────

const CampaignBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  channel: z.enum(["email", "in_app", "social", "other"]).default("in_app"),
  budgetCents: z.number().int().min(0).nullable().optional(),
  utmCampaign: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  status: z.enum(["draft", "active", "paused", "ended"]).default("draft"),
  notes: z.string().max(5000).nullable().optional(),
});

/** GET /admin/campaigns — list all. */
router.get("/admin/campaigns", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(campaignsTable).orderBy(desc(campaignsTable.createdAt));
  res.json(rows);
});

/** POST /admin/campaigns — create. */
router.post("/admin/campaigns", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const adminId = req.doctorId!;
  const { name, description, channel, budgetCents, utmCampaign, startsAt, endsAt, status, notes } = parsed.data;
  const [row] = await db.insert(campaignsTable).values({
    name,
    description: description ?? null,
    channel,
    budgetCents: budgetCents ?? null,
    utmCampaign: utmCampaign ?? null,
    startsAt: startsAt ? new Date(startsAt) : null,
    endsAt: endsAt ? new Date(endsAt) : null,
    status,
    notes: notes ?? null,
    createdBy: adminId,
    updatedBy: adminId,
  }).returning();
  res.status(201).json(row);
});

/** PATCH /admin/campaigns/:id — update. */
router.patch("/admin/campaigns/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = CampaignBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const adminId = req.doctorId!;
  const data = parsed.data;
  const updates: Record<string, unknown> = { ...data, updatedBy: adminId };
  if (data.startsAt !== undefined) updates.startsAt = data.startsAt ? new Date(data.startsAt) : null;
  if (data.endsAt !== undefined) updates.endsAt = data.endsAt ? new Date(data.endsAt) : null;

  const [updated] = await db.update(campaignsTable).set(updates).where(eq(campaignsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json(updated);
});

/** DELETE /admin/campaigns/:id — delete. */
router.delete("/admin/campaigns/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(campaignsTable).where(eq(campaignsTable.id, id));
  res.json({ success: true });
});

// ── Admin Alerts ──────────────────────────────────────────────────────────────

/** GET /admin/alerts — list alerts (unread first, then recent). */
router.get("/admin/alerts", requireAdmin, async (req, res): Promise<void> => {
  const showRead = req.query["showRead"] === "true";
  const rows = await db
    .select()
    .from(adminAlertsTable)
    .where(showRead ? undefined : eq(adminAlertsTable.read, false))
    .orderBy(adminAlertsTable.read, desc(adminAlertsTable.createdAt))
    .limit(200);
  res.json(rows);
});

/** PATCH /admin/alerts/:id/read — mark alert as read. */
router.patch("/admin/alerts/:id/read", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const adminId = req.doctorId!;
  const [updated] = await db
    .update(adminAlertsTable)
    .set({ read: true, readBy: adminId, readAt: new Date() })
    .where(eq(adminAlertsTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Alert not found" }); return; }
  res.json({ success: true });
});

// ── Ticket metadata ───────────────────────────────────────────────────────────

const TicketUpdateBody = z.object({
  ticketStatus: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  ticketPriority: z.enum(["low", "medium", "high", "critical"]).optional(),
  ticketTags: z.string().max(500).optional(),
  assignedTo: z.number().int().positive().optional().nullable(),
});

/** PATCH /admin/contact-messages/:id/ticket — update ticket metadata. */
router.patch("/admin/contact-messages/:id/ticket", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = TicketUpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const updates: Record<string, unknown> = {};
  if (data.ticketStatus !== undefined) {
    updates["ticketStatus"] = data.ticketStatus;
    if (data.ticketStatus === "resolved") updates["resolvedAt"] = new Date();
  }
  if (data.ticketPriority !== undefined) {
    updates["ticketPriority"] = data.ticketPriority;
    // Auto-compute SLA deadline based on priority
    const slaDays: Record<string, number> = { critical: 1, high: 2, medium: 5, low: 14 };
    const slaDayCount = slaDays[data.ticketPriority];
    if (slaDayCount !== undefined) {
      const slaDue = new Date();
      slaDue.setDate(slaDue.getDate() + slaDayCount);
      updates["slaDueAt"] = slaDue;
    }
  }
  if (data.ticketTags !== undefined) updates["ticketTags"] = data.ticketTags;
  if (data.assignedTo !== undefined) updates["assignedTo"] = data.assignedTo;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [updated] = await db
    .update(adminContactMessages)
    .set(updates)
    .where(eq(adminContactMessages.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Message not found" }); return; }

  res.json({
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    respondidaEm: updated.respondidaEm?.toISOString() ?? null,
    firstResponseAt: updated.firstResponseAt?.toISOString() ?? null,
    resolvedAt: updated.resolvedAt?.toISOString() ?? null,
    slaDueAt: updated.slaDueAt?.toISOString() ?? null,
  });
});

export default router;
