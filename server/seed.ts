import type pg from "pg";
import bcrypt from "bcryptjs";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool, tx } from "./db";
import { DEFAULT_RULES } from "../src/rules";

const REGLEMENT_PDF = join(dirname(fileURLToPath(import.meta.url)), "assets", "reglement-2026.pdf");
const REGLEMENT_NAME = "ADAC-Kartslalom-Reglement-2026.pdf";

let pdfCache: string | null | undefined;
function reglementBase64(): string | null {
  if (pdfCache === undefined) {
    pdfCache = existsSync(REGLEMENT_PDF) ? readFileSync(REGLEMENT_PDF).toString("base64") : null;
  }
  return pdfCache;
}

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
  const pdf = reglementBase64();
  if (pdf) {
    await c.query(
      `INSERT INTO club_documents (club_id, kind, filename, data_base64)
       VALUES ($1, 'reglement', $2, $3) ON CONFLICT DO NOTHING`,
      [clubId, REGLEMENT_NAME, pdf],
    );
  }
}

/** Bestehende Vereine ohne Reglement-PDF mit dem mitgelieferten befüllen. */
export async function backfillDocuments(): Promise<void> {
  const pdf = reglementBase64();
  if (!pdf) return;
  const { rows } = await pool.query(
    `SELECT c.id FROM clubs c
     LEFT JOIN club_documents d ON d.club_id = c.id AND d.kind = 'reglement'
     WHERE d.club_id IS NULL`,
  );
  for (const row of rows) {
    await pool.query(
      "INSERT INTO club_documents (club_id, kind, filename, data_base64) VALUES ($1, 'reglement', $2, $3)",
      [row.id, REGLEMENT_NAME, pdf],
    );
  }
  if (rows.length) console.log(`Wissensdatenbank: Reglement-PDF für ${rows.length} Verein(e) ergänzt`);
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
  // Kein bekanntes Default-Passwort: ohne SEED_PASSWORD wird ein zufälliges
  // erzeugt und EINMALIG ausgegeben (muss bei der Einrichtung notiert werden).
  const provided = process.env.SEED_PASSWORD;
  const password = provided ?? randomBytes(9).toString("base64url");
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
    console.log(`  Login:           ${email}`);
    if (provided) {
      console.log(`  Passwort:        (aus SEED_PASSWORD)`);
    } else {
      console.log(`  Passwort:        ${password}   ← NUR JETZT sichtbar, bitte notieren!`);
    }
    console.log(`  Einladungscode:  ${club.rows[0].invite_code}`);
    console.log("──────────────────────────────────────────────");
  });
}
