/**
 * DocRegen database configuration.
 *
 * DocRegen has its own PostgreSQL database, independent from DocKnee's. The
 * connection string comes ONLY from DOCREGEN_DATABASE_URL: there is
 * deliberately no fallback to DATABASE_URL (DocKnee's database), and the two
 * may not point at the same database, so accounts, patients and clinical data
 * can never mix.
 */
export const DOCREGEN_DATABASE_ENV = "DOCREGEN_DATABASE_URL";

function databaseIdentity(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.searchParams.get("host") ?? parsed.hostname;
    const port = parsed.port || "5432";
    return `${host}:${port}/${decodeURIComponent(parsed.pathname.replace(/^\//, ""))}`.toLowerCase();
  } catch {
    return url.trim();
  }
}

export function resolveDocregenDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env[DOCREGEN_DATABASE_ENV]?.trim();
  if (!url) {
    throw new Error(
      `${DOCREGEN_DATABASE_ENV} must be set. DocRegen uses its own database and never falls back to DATABASE_URL.`,
    );
  }
  const docknee = env["DATABASE_URL"]?.trim();
  if (docknee && databaseIdentity(docknee) === databaseIdentity(url)) {
    throw new Error(
      `${DOCREGEN_DATABASE_ENV} points at the same database as DATABASE_URL (DocKnee). DocRegen requires a separate database.`,
    );
  }
  return url;
}
