import { defineConfig } from "drizzle-kit";
import path from "path";
import { resolveDocregenDatabaseUrl } from "./src/config";

// DocRegen's own database: DOCREGEN_DATABASE_URL only (no DATABASE_URL fallback).
const url = resolveDocregenDatabaseUrl();

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url,
  },
});
