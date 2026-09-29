const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

export function createTemporaryAccessExpiration(now = new Date()): Date {
  return new Date(now.getTime() + THIRTY_DAYS_MS);
}

export function hasActiveTemporaryAccess(
  expiresAt: Date | string | null | undefined,
  now = new Date(),
): boolean {
  if (!expiresAt) return false;
  const expiration = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return Number.isFinite(expiration.getTime()) && expiration.getTime() > now.getTime();
}