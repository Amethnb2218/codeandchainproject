import { Router } from "express";
import { config } from "../config.js";
import { getBalances, getPayoutSupportedCountries, getPayoutBanks, getTradingPrices } from "../bitnob/client.js";

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

// GET /api/bitnob/status — resume pour l'UI (sans secrets)
router.get("/status", (_req, res) => {
  res.json({
    configured: config.hasBitnobCredentials(),
    baseUrl: config.bitnob.baseUrl,
    mode: config.appMode,
    note: config.hasBitnobCredentials() ? "Sandbox reel disponible (lecture seule verifiable)" : "Mode DEMO — configurez BITNOB_CLIENT_ID/SECRET pour le sandbox",
  });
});

export default router;
