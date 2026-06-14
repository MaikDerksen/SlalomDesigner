import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
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
  // Hinter Reverse-Proxy/Docker: echte Client-IP für Rate-Limiting
  app.set("trust proxy", 1);

  // Sicherheits-Header (CSP erlaubt Inline-Styles, data:/blob:-Bilder der App).
  // WICHTIG: KEIN upgrade-insecure-requests – die App läuft auf dem NAS über
  // http://<nas-ip>:3001 (LAN, kein TLS). Würde der Browser Subressourcen auf
  // https hochstufen, schlügen JS/CSS fehl → Whitescreen. HSTS aus demselben
  // Grund deaktiviert (greift nur über HTTPS, hier unnötig).
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
      strictTransportSecurity: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Moderates JSON-Limit global; große Payloads (Screenshot-DataURLs, Import,
  // Reglement-PDF) bekommen ein höheres Limit gezielt pro Route.
  app.use(express.json({ limit: "1mb" }));
  const bigJson = express.json({ limit: "16mb" });
  app.use(cookieParser());

  // Health-Endpoint für Docker/Compose-Healthchecks (ohne Auth)
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Brute-Force-/DoS-Schutz auf den Auth-Endpunkten
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? "").toLowerCase()}`,
    message: { error: "Zu viele Versuche – bitte später erneut." },
  });
  app.use("/api/auth/login", authLimiter, bigJson);
  app.use("/api/auth/register", authLimiter, bigJson);

  // Routen mit großen Payloads
  app.use("/api/maps", bigJson); // Screenshot-DataURL
  app.use("/api/wiki/pdf", bigJson); // Reglement-PDF
  app.use("/api/import", bigJson); // einmalige localStorage-Migration

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
