/**
 * Content management schema: announcements, FAQs, campaigns, admin alerts.
 * Public read endpoints for announcements/FAQs reveal no admin metadata.
 */
import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ─── Announcements ────────────────────────────────────────────────────────────

export const announcementsTable = pgTable(
  "announcements",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** 'info' | 'warning' | 'success' | 'error' */
    type: text("type").notNull().default("info"),
    active: boolean("active").notNull().default(true),
    /** When to start showing (null = immediately). */
    startsAt: timestamp("starts_at", { withTimezone: true }),
    /** When to stop showing (null = indefinite). */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: integer("created_by").notNull(),
    updatedBy: integer("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("announcements_active_idx").on(t.active, t.expiresAt),
  ],
);

export type Announcement = typeof announcementsTable.$inferSelect;

// ─── FAQs ─────────────────────────────────────────────────────────────────────

export const faqsTable = pgTable(
  "faqs",
  {
    id: serial("id").primaryKey(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    /** Category for grouping (e.g. "Assinatura", "Uso"). */
    category: text("category"),
    /** Display order within category (lower = first). */
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdBy: integer("created_by").notNull(),
    updatedBy: integer("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("faqs_active_sort_idx").on(t.active, t.sortOrder),
    index("faqs_category_idx").on(t.category),
  ],
);

export type FAQ = typeof faqsTable.$inferSelect;

// ─── Campaigns (manually entered) ────────────────────────────────────────────

export const campaignsTable = pgTable(
  "campaigns",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    /** 'email' | 'in_app' | 'social' | 'other' */
    channel: text("channel").notNull().default("in_app"),
    /** Budget in BRL cents (for cost tracking). */
    budgetCents: integer("budget_cents"),
    /** Exact utm_campaign value used in acquisition links. */
    utmCampaign: text("utm_campaign"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** 'draft' | 'active' | 'paused' | 'ended' */
    status: text("status").notNull().default("draft"),
    /** Notes — no PII, no patient data. */
    notes: text("notes"),
    createdBy: integer("created_by").notNull(),
    updatedBy: integer("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("campaigns_status_idx").on(t.status),
    index("campaigns_dates_idx").on(t.startsAt, t.endsAt),
    index("campaigns_utm_campaign_idx").on(t.utmCampaign),
  ],
);

export type Campaign = typeof campaignsTable.$inferSelect;

// ─── Admin alerts ─────────────────────────────────────────────────────────────

export const adminAlertsTable = pgTable(
  "admin_alerts",
  {
    id: serial("id").primaryKey(),
    /** 'critical' | 'warning' | 'info' */
    severity: text("severity").notNull().default("info"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    /** Source system (e.g. 'stripe', 'auth', 'system'). */
    source: text("source").notNull().default("system"),
    /** Whether an admin has marked it as read. */
    read: boolean("read").notNull().default(false),
    readBy: integer("read_by"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("admin_alerts_read_idx").on(t.read, t.createdAt),
    index("admin_alerts_severity_idx").on(t.severity),
  ],
);

export type AdminAlert = typeof adminAlertsTable.$inferSelect;
