import { Router } from "express";
import { config } from "../config.js";
import { getBalances, getPayoutSupportedCountries, getPayoutBanks, getTradingPrices, bitnobRequest } from "../bitnob/client.js";

const router = Router();

// GET /api/bitnob/balances — lecture seule, jamais de fonds bouges
router.get("/balances", async (_req, res) => {
  if (!config.hasBitnobCredentials()) return res.status(503).json({ error: "Bitnob non configure", demo: true });
  const r = await getBalances();
  if (!r.ok) return res.status(r.status || 502).json({ error: r.error });
  res.json(r.data);
});

router.get("/payout/countries", async (_req, res) => {
  const r = await getPayoutSupportedCountries();
  if (!r.ok) return res.status(r.status || 502).json({ error: r.error });
  res.json(r.data);
});

router.get("/payout/banks/:country", async (req, res) => {
  const r = await getPayoutBanks(req.params.country);
  if (!r.ok) return res.status(r.status || 502).json({ error: r.error });
  res.json(r.data);
});

router.get("/trading/prices", async (_req, res) => {
  const r = await getTradingPrices();
  if (!r.ok) return res.status(r.status || 502).json({ error: r.error });
  res.json(r.data);
});

router.get("/exchange-rates", async (req, res) => {
  const from = String(req.query.from ?? "BTC");
  const to = String(req.query.to ?? "XOF");
  const amount = String(req.query.amount ?? "1");
  const r = await bitnobRequest<unknown>("GET", `/api/exchange-rates/convert?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&amount=${encodeURIComponent(amount)}`);
  if (!r.ok) return res.status(r.status || 502).json({ error: r.error, raw: r.raw });
  res.json(r.data);
});

router.get("/fx", async (_req, res) => {
  const { getBtcPriceXof } = await import("../fx.js");
  const { price, source } = await getBtcPriceXof();
  res.json({ btcPriceXof: price, source, note: source === "demo" ? "Estimation DEMO 65M — configure BITNOB_* pour live" : "Live Bitnob", at: new Date().toISOString() });
});

// GET /api/bitnob/status — resume pour l'UI (sans secrets)
router.get("/status", (_req, res) => {
  res.json({
    configured: config.hasBitnobCredentials(),
    hint: config.bitnobCredentialHint(),
    clientIdPresent: Boolean(config.bitnob.clientId),
    clientIdPreview: config.bitnob.clientId ? `${config.bitnob.clientId.slice(0, 8)}…${config.bitnob.clientId.slice(-4)}` : null,
    clientSecretPresent: Boolean(config.bitnob.clientSecret),
    webhookSecretPresent: Boolean(config.bitnob.webhookSecret),
    baseUrl: config.bitnob.baseUrl,
    mode: config.appMode,
    note: config.hasBitnobCredentials() ? "Sandbox reel disponible (lecture seule verifiable — teste avec whoami)" : config.bitnobCredentialHint(),
  });
});

export default router;
