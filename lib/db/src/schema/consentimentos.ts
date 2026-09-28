import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { doctorsTable } from "./doctors";

export const consentimentosTable = pgTable("consentimentos", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().unique().references(() => doctorsTable.id, { onDelete: "cascade" }),
  tipo: text("tipo").notNull().default("plataforma_docknee"),
  textoVersao: text("texto_versao").notNull().default("1.0"),
  textoHash: text("texto_hash").notNull(),
  aceito: boolean("aceito").notNull().default(true),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("consentimentos_doctor_id_idx").on(t.doctorId),
]);

export type Consentimento = typeof consentimentosTable.$inferSelect;
