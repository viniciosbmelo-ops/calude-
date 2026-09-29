import { pgTable, serial, timestamp, text, index } from "drizzle-orm/pg-core";

export const pageVisitsTable = pgTable(
  "page_visits",
  {
    id: serial("id").primaryKey(),
    path: text("path"),
    accessType: text("access_type"),
    countryCode: text("country_code"),
    regionCode: text("region_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Supports the recent-visits-by-geography dashboard query.
    index("page_visits_geo_recent_idx").on(
      t.createdAt.desc(),
      t.accessType,
      t.countryCode,
      t.regionCode,
    ),
  ],
);
