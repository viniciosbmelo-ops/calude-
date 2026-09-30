import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env["SESSION_SECRET"]!;
const TOKEN_ISSUER = "docknee-api";
const TOKEN_AUDIENCE = "docknee-web";
const TOKEN_TTL = "12h";

export type AuthTokenPayload =
  | {
      role: "doctor";
      doctorId: number;
      isAdmin: boolean;
      sessionVersion: number;
    }
  | {
      role: "secretary";
      doctorId: number;
      secretaryId: number;
      isAdmin: false;
      sessionVersion: number;
    }
  | {
      role: "service";
      serviceId: number;
      isAdmin: false;
      sessionVersion: number;
    };

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: {
  doctorId: number;
  isAdmin: boolean;
  sessionVersion?: number;
}): string {
  return jwt.sign(
    { ...payload, sessionVersion: payload.sessionVersion ?? 0, role: "doctor" },
    JWT_SECRET,
    {
      algorithm: "HS256",
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      expiresIn: TOKEN_TTL,
    },
  );
}

export function signSecretaryToken(payload: {
  secretaryId: number;
  doctorId: number;
  sessionVersion?: number;
}): string {
  return jwt.sign(
    { ...payload, sessionVersion: payload.sessionVersion ?? 0, role: "secretary", isAdmin: false },
    JWT_SECRET,
    {
      algorithm: "HS256",
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      expiresIn: TOKEN_TTL,
    },
  );
}

export function signServiceToken(payload: {
  serviceId: number;
  sessionVersion?: number;
}): string {
  return jwt.sign(
    { ...payload, sessionVersion: payload.sessionVersion ?? 0, role: "service", isAdmin: false },
    JWT_SECRET,
    {
      algorithm: "HS256",
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      expiresIn: TOKEN_TTL,
    },
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parseSessionVersion(value: unknown): number | null {
  // Tokens issued before session versioning did not carry this claim. Treat
  // them as version zero so the rollout is non-disruptive; the next block or
  // password change increments the DB value and permanently revokes them.
  if (value === undefined) return 0;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return null;
}

function parseTokenPayload(value: unknown): AuthTokenPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const sessionVersion = parseSessionVersion(payload.sessionVersion);
  if (sessionVersion === null) return null;

  if (
    payload.role === "doctor" &&
    isPositiveInteger(payload.doctorId) &&
    typeof payload.isAdmin === "boolean"
  ) {
    return {
      role: "doctor",
      doctorId: payload.doctorId,
      isAdmin: payload.isAdmin,
      sessionVersion,
    };
  }

  if (
    payload.role === "secretary" &&
    isPositiveInteger(payload.doctorId) &&
    isPositiveInteger(payload.secretaryId)
  ) {
    return {
      role: "secretary",
      doctorId: payload.doctorId,
      secretaryId: payload.secretaryId,
      isAdmin: false,
      sessionVersion,
    };
  }

  if (payload.role === "service" && isPositiveInteger(payload.serviceId)) {
    return {
      role: "service",
      serviceId: payload.serviceId,
      isAdmin: false,
      sessionVersion,
    };
  }

  return null;
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    return parseTokenPayload(decoded);
  } catch {
    return null;
  }
}
