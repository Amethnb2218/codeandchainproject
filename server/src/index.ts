import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import { config } from "./config.js";
import { getDb } from "./db/index.js";
import { rawBodySaver } from "./middleware/rawBody.js";
import { verifyWebhookSignature } from "./bitnob/signer.js";

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(morgan("dev"));
app.use(express.json({ verify: rawBodySaver as unknown as Parameters<typeof express.json>[0] extends { verify?: infer V } ? V : never }));
app.use(express.urlencoded({ extended: true }));

// Health
app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "sentabakh-lite", mode: config.appMode, time: new Date().toISOString() });
});

// Readiness / preflight info (sans secrets)
app.get("/api/preflight", (_req, res) => {
  const hasCreds = config.hasBitnobCredentials();
  res.json({
    mode: config.appMode,
    bitnob: {
      configured: hasCreds,
      baseUrl: config.bitnob.baseUrl,
      clientIdPresent: Boolean(config.bitnob.clientId),
      webhookSecretPresent: Boolean(config.bitnob.webhookSecret),
    },
    node: process.version,
  });
});

// Placeholder orders (Phase B : impl complete)
app.get("/api/orders", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 50").all();
  res.json({ data: rows });
});

// Webhook Bitnob (Phase A : verification signature, dedup, pas encore de traitement metier final)
app.post("/api/webhooks/bitnob", (req, res) => {
  const raw = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? "");
  const sig = (req.headers["x-bitnob-signature"] as string) ?? "";
  const valid = verifyWebhookSignature(raw, sig, config.bitnob.webhookSecret);
  if (!valid && config.bitnob.webhookSecret) {
    // en sandbox sans secret configure, on log mais on ne reject pas en Phase A
    console.warn("[webhook] signature invalide");
  }
  // dedup basique
  const dedupKey = sig || `no-sig-${Date.now()}-${Math.random()}`;
  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO webhook_events (id,type,dedup_key,signature_valid,raw_body,created_at) VALUES (?,?,?,?,?,?)"
    ).run(
      `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      (req.body as { type?: string })?.type ?? "unknown",
      dedupKey,
      valid ? 1 : 0,
      raw.slice(0, 8000),
      new Date().toISOString()
    );
  } catch (e) {
    // duplicate -> idempotent
    if ((e as Error).message?.includes("UNIQUE")) {
      return res.json({ ok: true, dedup: true });
    }
    console.error("[webhook] db error", e);
  }
  res.json({ ok: true, signatureValid: valid });
});

// 404
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

const port = config.port;
if (process.env.NODE_ENV !== "test") {
  // init db
  getDb();
  app.listen(port, () => console.log(`[sentabakh-lite] server http://localhost:${port} mode=${config.appMode}`));
}

export default app;
