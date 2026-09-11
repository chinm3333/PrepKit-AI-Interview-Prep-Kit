import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { HttpError } from "./error.js";

export interface AuthUser {
  id: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const COOKIE = "trao_session";

export function signToken(user: AuthUser): string {
  const secret = process.env.JWT_SECRET || "dev-secret";
  const days = Number(process.env.SESSION_DAYS || 7);
  return jwt.sign(user, secret, { expiresIn: `${days}d` });
}

export function setSessionCookie(res: Response, token: string) {
  const days = Number(process.env.SESSION_DAYS || 7);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: days * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE);
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const token = bearer || req.cookies?.[COOKIE];
    if (!token) throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
    const secret = process.env.JWT_SECRET || "dev-secret";
    const payload = jwt.verify(token, secret) as AuthUser;
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired session", "UNAUTHORIZED"));
  }
}
