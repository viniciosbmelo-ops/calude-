import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const xrayCacheTable = pgTable("xray_cache", {
  id: serial("id").primaryKey(),
  cacheKey: text("cache_key").notNull().unique(),
  resultJson: text("result_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type XrayCacheEntry = typeof xrayCacheTable.$inferSelect;
