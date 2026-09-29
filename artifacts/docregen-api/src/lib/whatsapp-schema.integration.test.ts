import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/docregen-db";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../../../lib/db/drizzle/0010_add_whatsapp_crm.sql", import.meta.url),
);

describe("WhatsApp CRM schema migration", () => {
  it("applies all required tables and columns to an existing database", async () => {
    const migrationSql = readFileSync(migrationPath, "utf8");
    const schemaName = `whatsapp_crm_migration_test_${process.pid}`;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET LOCAL search_path TO "${schemaName}", public`);
      await client.query(migrationSql);

      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = $1`,
        [schemaName],
      );
      expect(new Set(tables.rows.map((row) => row.table_name))).toEqual(
        new Set([
          "whatsapp_contacts",
          "whatsapp_conversations",
          "whatsapp_messages",
          "whatsapp_webhook_events",
        ]),
      );

      const columns = await client.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = $1
            AND (
              (table_name = 'whatsapp_conversations' AND column_name = 'patient_link_source')
              OR
              (table_name = 'whatsapp_messages' AND column_name = 'client_request_id')
            )`,
        [schemaName],
      );
      expect(columns.rows).toHaveLength(2);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});