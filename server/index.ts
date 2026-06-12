import express from "express";
import cookieParser from "cookie-parser";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "./db";
import { authRouter, requireAuth, HttpError } from "./auth";
import { dataRouter } from "./routes";
import { seedIfEmpty, backfillDocuments } from "./seed";

const PORT = Number(process.env.PORT ?? 3001);

async function main() {
  await migrate();
  await seedIfEmpty();
  await backfillDocuments();

  const app = express();
  app.use(express.json({ limit: "25mb" })); // Screenshot-DataURLs
  app.use(cookieParser());

  // Health-Endpoint für Docker/Compose-Healthchecks (ohne Auth)
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter());
  app.use("/api", requireAuth, dataRouter());

  // Produktions-Modus: gebautes Frontend ausliefern (SPA-Fallback)
  const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
  }

  // Fehlerbehandlung (HttpError → Status, Rest → 500)
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Interner Fehler" });
  });

  app.listen(PORT, () => console.log(`API läuft auf http://localhost:${PORT}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
