import { Router, type IRouter } from "express";
import { db, pageVisitsTable } from "@workspace/docregen-db";
import { classifyVisitPath, resolveAccessGeography } from "../lib/accessGeography";
import { redactPath } from "../lib/redaction";

const router: IRouter = Router();

/**
 * Page path as stored in page_visits: SPA base ("/docregen") stripped, query
 * and fragment dropped, public-link tokens replaced (shared redaction).
 */
export function privacySafeVisitPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = redactPath(raw.slice(0, 2048), { stripBase: true })?.slice(0, 255) ?? null;
  return path || null;
}

router.post("/stats/visit", async (req, res): Promise<void> => {
  const path = privacySafeVisitPath(req.body?.path);
  const accessType = classifyVisitPath(path);
  const geography = resolveAccessGeography(req.ip);

  await db.insert(pageVisitsTable).values({
    path,
    accessType,
    countryCode: geography.countryCode,
    regionCode: geography.regionCode,
  });
  res.status(204).end();
});

export { router as statsRouter };
export default router;
