import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { surgeriesTable } from "./surgeries";

export const surgeryMediaTable = pgTable("surgery_media", {
  id: serial("id").primaryKey(),
  surgeryId: integer("surgery_id").notNull().references(() => surgeriesTable.id, { onDelete: "cascade" }),
  mediaType: text("media_type").notNull(), // "photo" | "video"
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  originalPath: text("original_path").notNull(),
  previewPath: text("preview_path"),
  previewStatus: text("preview_status").notNull().default("pending"), // "pending" | "ready" | "error"
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSurgeryMediaSchema = createInsertSchema(surgeryMediaTable).omit({ id: true, createdAt: true });
export type SurgeryMedia = typeof surgeryMediaTable.$inferSelect;
export type InsertSurgeryMedia = typeof surgeryMediaTable.$inferInsert;
