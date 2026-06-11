import type { Request, Response, NextFunction, Router } from "express";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { pool, tx } from "./db.js";
import { createDefaultClubData } from "./seed.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-nicht-fuer-produktion";
const COOKIE = "ksp_token";
const MAX_AGE_S = 60 * 60 * 24 * 30; // 30 Tage

export interface AuthInfo {
  userId: string;
  clubId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

function setToken(res: Response, info: AuthInfo) {
  const token = jwt.sign(info, JWT_SECRET, { expiresIn: MAX_AGE_S });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_S * 1000,
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "Nicht angemeldet" });
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthInfo & { iat: number };
    req.auth = { userId: payload.userId, clubId: payload.clubId };
    next();
  } catch {
    res.status(401).json({ error: "Sitzung abgelaufen" });
  }
}

async function userResponse(userId: string) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.display_name, u.role, c.name AS club_name, c.invite_code
     FROM users u JOIN clubs c ON c.id = u.club_id WHERE u.id = $1`,
    [userId],
  );
  const u = rows[0];
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    clubName: u.club_name,
    inviteCode: u.invite_code,
  };
}

export function authRouter(): Router {
  const r = express.Router();

  r.post("/register", async (req, res) => {
    const { email, password, displayName, clubName, inviteCode } = req.body ?? {};
    if (!email?.includes("@") || !password || password.length < 6 || !displayName?.trim()) {
      return res.status(400).json({ error: "E-Mail, Name und Passwort (min. 6 Zeichen) erforderlich" });
    }
    if (!clubName?.trim() && !inviteCode?.trim()) {
      return res.status(400).json({ error: "Vereinsname (neu) oder Einladungscode erforderlich" });
    }

    const existing = await pool.query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [email]);
    if (existing.rowCount) return res.status(409).json({ error: "E-Mail ist bereits registriert" });

    const hash = await bcrypt.hash(password, 10);

    try {
      const result = await tx(async (c) => {
        let clubId: string;
        let role = "member";
        if (inviteCode?.trim()) {
          const club = await c.query("SELECT id FROM clubs WHERE invite_code = $1", [inviteCode.trim()]);
          if (!club.rowCount) throw new HttpError(404, "Einladungscode unbekannt");
          clubId = club.rows[0].id;
        } else {
          const club = await c.query(
            "INSERT INTO clubs (name, invite_code) VALUES ($1, $2) RETURNING id",
            [clubName.trim(), randomUUID().slice(0, 8)],
          );
          clubId = club.rows[0].id;
          role = "admin";
          await createDefaultClubData(c, clubId);
        }
        const user = await c.query(
          `INSERT INTO users (club_id, email, password_hash, display_name, role)
           VALUES ($1, lower($2), $3, $4, $5) RETURNING id`,
          [clubId, email, hash, displayName.trim(), role],
        );
        return { userId: user.rows[0].id as string, clubId };
      });
      setToken(res, result);
      res.json(await userResponse(result.userId));
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      throw e;
    }
  });

  r.post("/login", async (req, res) => {
    const { email, password } = req.body ?? {};
    const { rows } = await pool.query(
      "SELECT id, club_id, password_hash FROM users WHERE lower(email) = lower($1)",
      [email ?? ""],
    );
    if (!rows.length || !(await bcrypt.compare(password ?? "", rows[0].password_hash))) {
      return res.status(401).json({ error: "E-Mail oder Passwort falsch" });
    }
    setToken(res, { userId: rows[0].id, clubId: rows[0].club_id });
    res.json(await userResponse(rows[0].id));
  });

  r.post("/logout", (_req, res) => {
    res.clearCookie(COOKIE);
    res.status(204).end();
  });

  r.get("/me", requireAuth, async (req, res) => {
    res.json(await userResponse(req.auth!.userId));
  });

  return r;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
