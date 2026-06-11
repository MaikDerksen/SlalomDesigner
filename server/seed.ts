import type pg from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { pool, tx } from "./db";
import { DEFAULT_RULES } from "../src/rules";

/**
 * Grunddaten für einen neuen Verein: Reglement-Defaults (ADAC 2026) als
 * Regel-Zeilen und eine Standard-Rechteckfläche, damit sofort geplant werden kann.
 */
export async function createDefaultClubData(c: pg.PoolClient, clubId: string): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULT_RULES)) {
    await c.query(
      "INSERT INTO club_rules (club_id, rule_key, value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [clubId, key, value],
    );
  }
  await c.query(
    "INSERT INTO maps (club_id, name, width_m, height_m) VALUES ($1, 'Trainingsplatz', 60, 40)",
    [clubId],
  );
}

/**
 * Erst-Seed: legt beim allerersten Start (leere Datenbank) einen Verein samt
 * Admin-Zugang an. Die im Browser vorhandenen Daten (Maps, Strecken, eigene
 * Hindernisse) werden nach dem ersten Login automatisch über /api/import
 * übernommen – siehe Frontend-Migration.
 */
export async function seedIfEmpty(): Promise<void> {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM clubs");
  if (rows[0].n > 0) return;

  const email = process.env.SEED_EMAIL ?? "admin@kartslalom.local";
  const password = process.env.SEED_PASSWORD ?? "kart2026";
  const clubName = process.env.SEED_CLUB ?? "Mein Verein";

  await tx(async (c) => {
    const club = await c.query(
      "INSERT INTO clubs (name, invite_code) VALUES ($1, $2) RETURNING id, invite_code",
      [clubName, randomUUID().slice(0, 8)],
    );
    const clubId = club.rows[0].id;
    await createDefaultClubData(c, clubId);
    await c.query(
      `INSERT INTO users (club_id, email, password_hash, display_name, role)
       VALUES ($1, lower($2), $3, 'Admin', 'admin')`,
      [clubId, email, await bcrypt.hash(password, 10)],
    );
    console.log("──────────────────────────────────────────────");
    console.log(`Seed: Verein „${clubName}" angelegt`);
    console.log(`  Login:           ${email} / ${password}`);
    console.log(`  Einladungscode:  ${club.rows[0].invite_code}`);
    console.log("──────────────────────────────────────────────");
  });
}
