import { Router, type IRouter } from "express";
import { db, pageVisitsTable } from "@workspace/db";
import { classifyVisitPath, resolveAccessGeography } from "../lib/accessGeography";

const router: IRouter = Router();

function privacySafeVisitPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.split("?")[0]!.split("#")[0]!.slice(0, 255);
  if (/^\/pre-consulta\/[^/]+$/.test(path)) return "/pre-consulta/:token";
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
