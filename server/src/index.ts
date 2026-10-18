import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import { config } from "./config.js";
import { getDb } from "./db/index.js";
import { rawBodySaver } from "./middleware/rawBody.js";
import { verifyWebhookSignature } from "./bitnob/signer.js";
import ordersRouter from "./routes/orders.js";
import bitnobRouter from "./routes/bitnob.js";

dotenv.config();

const app = express();
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: config.corsOrigin }));
app.use(morgan("dev"));
app.use(express.json({ verify: rawBodySaver as unknown as Parameters<typeof express.json>[0] extends { verify?: infer V } ? V : never }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "sentabakh-lite", mode: config.appMode, time: new Date().toISOString() });
});

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

app.use("/api/orders", ordersRouter);
app.use("/api/bitnob", bitnobRouter);

// Webhook Bitnob — HMAC-SHA512 sur raw body + dedup + reconciliation
app.post("/api/webhooks/bitnob", async (req, res) => {
  const raw = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? "");
  const sig = (req.headers["x-bitnob-signature"] as string) ?? "";
  const valid = verifyWebhookSignature(raw, sig, config.bitnob.webhookSecret);
  if (!valid && config.bitnob.webhookSecret) {
    console.warn("[webhook] signature invalide — rejet");
    return res.status(401).json({ error: "Signature webhook invalide" });
  }
  if (!valid && !config.bitnob.webhookSecret) {
    console.warn("[webhook] sans secret configure — accepte en mode demo (log warning)");
  }
  const dedupKey = sig ? `sig_${sig.slice(0, 32)}` : `no-sig_${(req.body as { id?: string })?.id ?? Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO webhook_events (id,type,dedup_key,signature_valid,raw_body,created_at) VALUES (?,?,?,?,?,?)"
    ).run(
      `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      (req.body as { type?: string })?.type ?? (req.body as { event?: string })?.event ?? "unknown",
      dedupKey,
      valid ? 1 : 0,
      raw.slice(0, 8000),
      new Date().toISOString()
    );
  } catch (e) {
    if ((e as Error).message?.includes("UNIQUE")) {
      return res.json({ ok: true, dedup: true, note: "Evenement deja traite" });
    }
    console.error("[webhook] db error", e);
    return res.status(500).json({ error: "Erreur persistance webhook" });
  }

  // Reconciliation : Lightning payé (Bitnob) → funded ; payout success → completed
  const body = req.body as Record<string, unknown>;
  const eventType = (body.type as string) ?? (body.event as string) ?? "";
  // Lightning : invoice paid / transaction received
  if (eventType.includes("lightning") || eventType.includes("invoice") || (body as Record<string,unknown>).payment_hash || (body as Record<string,unknown>).bolt11) {
    try {
      const db2 = getDb();
      const ref = (body.reference as string) ?? (body.invoiceReference as string) ?? "";
      const bId = (body.id as string) ?? (body.invoiceId as string) ?? "";
      if (ref || bId) {
        const inv = db2.prepare("SELECT * FROM lightning_invoices WHERE reference=? OR bitnob_invoice_id=? LIMIT 1").get(ref, bId) as Record<string,unknown>|undefined;
        if (inv && String(inv.status).startsWith("pending")) {
          db2.prepare("UPDATE lightning_invoices SET status=?, paid_at=?, raw_json=? WHERE id=?").run("paid", new Date().toISOString(), JSON.stringify(body), inv.id as string);
          const ord = db2.prepare("SELECT status, flow, type FROM orders WHERE id=?").get(inv.order_id as string) as Record<string,unknown>|undefined;
          if (ord) {
            const { transitionOrder: tr } = await import("./db/helpers.js");
            const cur = String(ord.status);
            if (cur === "awaiting_payment" || cur === "created") {
              tr(inv.order_id as string, "payment_confirmed" as never, "webhook", "lightning paid");
              // En sandbox, si pas de trading configuré (DEMO ou test), passer direct à funded pour démo jury
              // Sinon le vendeur fera trading/quote → execute → funded ; on laisse conversion_pending
              const hasTrading = (()=>{ try{ return db2.prepare("SELECT 1 FROM trading_quotes LIMIT 1").get(); }catch{return null;}})();
              // Ne force pas funded si réel — attendre trading
              if (!config.hasBitnobCredentials()) tr(inv.order_id as string, "funded" as never, "webhook", "funded demo sans trading");
              else tr(inv.order_id as string, "conversion_pending" as never, "webhook", "en attente conversion BTC->USDT");
            }
          }
        }
      }
    } catch (e) { console.error("[webhook] lightning reconcile", e); }
  }
  if (eventType.includes("payout") && eventType.includes("success")) {
    const ref = (body.reference as string) ?? (body.payoutReference as string) ?? "";
    const quoteId = (body.quoteId as string) ?? (body.quote_id as string) ?? "";
    if (ref || quoteId) {
      const db = getDb();
      const payout = db
        .prepare("SELECT * FROM payouts WHERE reference=? OR quote_id=? OR bitnob_payout_id=? LIMIT 1")
        .get(ref, quoteId, quoteId) as Record<string, unknown> | undefined;
      if (payout && !String(payout.status).includes("completed")) {
        db.prepare("UPDATE payouts SET status=?, raw_json=? WHERE id=?").run("completed", JSON.stringify(body), payout.id as string);
        // tenter transition si order associe
        const orderId = payout.order_id as string;
        const order = db.prepare("SELECT status FROM orders WHERE id=?").get(orderId) as { status: string } | undefined;
        if (order && ["payout_processing", "payout_pending"].includes(order.status)) {
          const { transitionOrder: tr2 } = await import("./db/helpers.js");
          tr2(orderId, "payout_completed" as never, "webhook", eventType);
        }
      }
    }
  }

  res.json({ ok: true, signatureValid: valid });
});

// Servir le frontend compile en production (client/dist) depuis le backend
// — pas d'exposition de .env, *.db, uploads
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(thisDir, "..", "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: "1h", dotfiles: "ignore" }));
  // SPA fallback : toute route non /api et non /health sert index.html
  app.get(/^\/(?!api\/|health).*/, (_req, res) => {
    const idx = path.join(clientDist, "index.html");
    if (fs.existsSync(idx)) return res.sendFile(idx);
    return res.status(404).json({ error: "Not found" });
  });
}
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

const port = config.port;
if (process.env.NODE_ENV !== "test") {
  getDb();
  app.listen(port, () => console.log(`[sentabakh-lite] server http://localhost:${port} mode=${config.appMode}${fs.existsSync(clientDist) ? " + static client/dist" : " (no client/dist — run npm run build)"}`));
}

export default app;
