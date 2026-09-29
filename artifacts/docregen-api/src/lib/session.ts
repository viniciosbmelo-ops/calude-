import { API_PREFIX } from "./api-prefix";
import type { Request, Response, CookieOptions } from "express";

export const SESSION_COOKIE_NAMES = {
  doctor: "docregen_session",
  secretary: "docregen_secretary_session",
  patient: "docregen_patient_session",
} as const;

export type SessionRole = keyof typeof SESSION_COOKIE_NAMES;

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    path: API_PREFIX,
    maxAge: SESSION_TTL_MS,
  };
}

function clearCookieOptions(): CookieOptions {
  const { maxAge: _maxAge, ...options } = cookieOptions();
  return options;
}

export function clearAllSessionCookies(res: Response): void {
  for (const cookieName of Object.values(SESSION_COOKIE_NAMES)) {
    res.clearCookie(cookieName, clearCookieOptions());
  }
}

export function establishSession(
  res: Response,
  role: SessionRole,
  token: string,
): void {
  clearAllSessionCookies(res);
  res.cookie(SESSION_COOKIE_NAMES[role], token, cookieOptions());
}

export function getSessionCookie(
  req: Request,
  role: SessionRole,
): string | null {
  const value = req.cookies?.[SESSION_COOKIE_NAMES[role]];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function hasAnySessionCookie(req: Request): boolean {
  return Object.values(SESSION_COOKIE_NAMES).some((name) => {
    const value = req.cookies?.[name];
    return typeof value === "string" && value.length > 0;
  });
}