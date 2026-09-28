import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_FILE = resolve(
  __dirname,
  "../../attached_assets/seed_rehab_protocols_1783539909862.sql",
);

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL não definida");
  }

  const raw = readFileSync(SQL_FILE, "utf8");
  // Idempotência: cada INSERT ganha ON CONFLICT (code, version) DO NOTHING
  const sql = raw.replace(
    /\}'::jsonb\);/g,
    "}'::jsonb) ON CONFLICT (code, version) DO NOTHING;",
  );

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    const { rows } = await client.query(
      "SELECT code, version, name, is_active FROM rehab_protocols ORDER BY code",
    );
    console.log(`Protocolos no banco: ${rows.length}`);
    for (const r of rows) {
      console.log(`  ${r.code} v${r.version} — ${r.name} (ativo=${r.is_active})`);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Falha no seed:", err);
  process.exit(1);
});
