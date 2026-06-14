import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { Pool } = pg;

// In Produktion ist DATABASE_URL Pflicht (kein committetes Fallback-Passwort);
// im Dev-Modus ist der lokale Container-Default erlaubt.
function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL muss in Produktion gesetzt sein.");
  }
  return "postgres://ksp:ksp@localhost:5433/ksp";
}

export const pool = new Pool({
  connectionString: connectionString(),
  // Eine einzelne pathologische Anfrage darf keine Verbindung dauerhaft halten.
  statement_timeout: 20_000,
  idle_in_transaction_session_timeout: 20_000,
  // Verbindungsaufbau begrenzen, damit der Health-Check bei toter DB schnell
  // mit Fehler antwortet statt zu hängen.
  connectionTimeoutMillis: 5_000,
});

// WICHTIG: Stirbt eine Idle-Verbindung (DB neu gestartet / Netzwerk weg), feuert
// der Pool ein 'error'-Event. Ohne Listener beendet Node den Prozess. Mit Listener
// bleibt die App am Leben, liefert solange 503 und erholt sich, sobald die DB
// wieder da ist – statt in eine Crash-Schleife zu laufen.
pool.on("error", (err) => {
  console.error("Postgres-Pool-Fehler (Idle-Client):", err.message);
});

/** Schneller Liveness-Check der Datenbank (für /api/health). */
export async function dbHealthy(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/** Schema anlegen (idempotent), mit Warte-Schleife bis die DB erreichbar ist. */
export async function migrate(): Promise<void> {
  const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "schema.sql"), "utf-8");
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(schema);
      return;
    } catch (e) {
      if (attempt >= 20) throw e;
      console.log(`Warte auf Datenbank… (${attempt})`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

/** Transaktions-Helfer. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
