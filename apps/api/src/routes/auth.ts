import { createHash } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "../models/User.js";
import {
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
  signToken,
} from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";

export const authRouter = Router();

authRouter.post("/register", async (req, res, next) => {
  try {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        name: z.string().optional(),
      })
      .parse(req.body);

    const existing = await User.findOne({ email: body.email.toLowerCase() });
    if (existing) throw new HttpError(409, "Email already registered", "EMAIL_TAKEN");

    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await User.create({
      email: body.email.toLowerCase(),
      passwordHash,
      name: body.name ?? "",
    });

    const authUser = { id: String(user._id), email: user.email };
    const token = signToken(authUser);
    setSessionCookie(res, token);
    res.status(201).json({ user: authUser, token });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
      })
      .parse(req.body);

    const user = await User.findOne({ email: body.email.toLowerCase() });
    if (!user) throw new HttpError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw new HttpError(401, "Invalid email or password", "INVALID_CREDENTIALS");

    const authUser = { id: String(user._id), email: user.email };
    const token = signToken(authUser);
    setSessionCookie(res, token);
    res.json({ user: authUser, token });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

export function hashKitInput(jd: string, companyUrl: string, days: number): string {
  return createHash("sha256")
    .update(`${jd.trim()}|${companyUrl.trim().toLowerCase()}|${days}`)
    .digest("hex");
}
