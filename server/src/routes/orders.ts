import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { transitionOrder, nowIso, newId, getOrderFull } from "../db/helpers.js";
import { config } from "../config.js";
import { bitnobRequest } from "../bitnob/client.js";
import { getOrCreateDeliveryCode, verifyDeliveryCode } from "../deliveryCode.js";

const router = Router();

// POST /api/orders — creer commande (FLUX graphe valide)
// VENDEUR tape en FCFA (ex 10 000 FCFA → 15 651 sats), taux Bitnob verrouillé 2min; CHOIX: QR CODE (boutique, fin sans code) vs LIEN WhatsApp (livraison, séquestré + CODE)
router.post("/", async (req, res) => {
  const schema = z.object({
    amountSats: z.number().int().positive().max(100_000_000).optional(),
    amountFcfa: z.number().int().positive().min(500).max(10_000_000).optional(),
    description: z.string().min(3).max(500),
    sellerLabel: z.string().min(2).max(120),
    beneficiaryName: z.string().min(2).max(120),
    beneficiaryPhoneHint: z.string().max(30).optional(),
    demoMode: z.boolean().optional().default(false),
    flow: z.enum(["qr", "link", "delivery"]).optional().default("delivery"),
  }).refine((d) => Boolean(d.amountSats || d.amountFcfa), { message: "amountFcfa ou amountSats requis", path: ["amountFcfa"] });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation", details: parsed.error.flatten() });
  const d = parsed.data;
  let amountSats = d.amountSats ?? 0;
  let amountFcfa: number | null = d.amountFcfa ?? null;
  // Si FCFA fourni, conversion serveur (taux Bitnob verrouillé 2min)
  if (amountFcfa != null && amountSats === 0) {
    const { buildFxQuote } = await import("../fx.js");
    const q = await buildFxQuote(amountFcfa);
    amountSats = q.amountSats;
    // Persister la cotation FCFA→sats (2min, statut pending)
    // q.btcPriceXof est un string entier, q.expiresAt est ISO
  }
  if (!amountSats || amountSats <= 0) return res.status(400).json({ error: "Montant invalide après conversion" });
  // Si amountSats direct sans FCFA, déduire FCFA estimé pour affichage
  if (amountFcfa == null) {
    try {
      const { buildFxQuote, satsToFcfa } = await import("../fx.js");
      const { getBtcPriceXof } = await import("../fx.js");
      const { price } = await getBtcPriceXof();
      amountFcfa = satsToFcfa(amountSats, price);
    } catch { amountFcfa = null; }
  }
  const id = newId("ord");
  const now = nowIso();
  const db = getDb();
  // flow: qr = boutique (10s, pas de code), link = livraison WhatsApp (séquestré + CODE), delivery = ancien
  const flowVal = d.flow ?? "delivery";
  // Compat ancienne DB sans colonne flow
  try {
    db.prepare(
      "INSERT INTO orders (id,status,amount_sats,amount_fcfa,description,seller_label,beneficiary_name,beneficiary_phone_hint,type,flow,demo_mode,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(id, "created", amountSats, amountFcfa, d.description, d.sellerLabel, d.beneficiaryName, d.beneficiaryPhoneHint ?? null, flowVal, flowVal, d.demoMode ? 1 : 0, now, now);
  } catch {
    db.prepare(
      "INSERT INTO orders (id,status,amount_sats,description,seller_label,beneficiary_name,beneficiary_phone_hint,demo_mode,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(id, "created", amountSats, d.description, d.sellerLabel, d.beneficiaryName, d.beneficiaryPhoneHint ?? null, d.demoMode ? 1 : 0, now, now);
  }
  // Persister la cotation FCFA→sats pour audit (si conversion faite)
  if (d.amountFcfa != null) {
    try {
      const { buildFxQuote } = await import("../fx.js");
      const q = await buildFxQuote(d.amountFcfa);
      // Réutiliser la même conversion déjà calculée pour amountSats
      db.prepare("INSERT INTO quotes (id,order_id,amount_fcfa,amount_sats,btc_price_xof,source,expires_at,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(
        newId("qt"), id, d.amountFcfa, amountSats, q.btcPriceXof, q.source, q.expiresAt, "pending", now
      );
    } catch { /* ignore si table absente */ }
  }
  db.prepare(
    "INSERT INTO order_transitions (id,order_id,from_status,to_status,actor,reason,created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(newId("tr"), id, "created", "created", "system", `creation flow=${flowVal} ${amountFcfa ? `${amountFcfa} FCFA` : ""}`.trim(), now);
  transitionOrder(id, "awaiting_payment", "system", "creation");
  const quote = (()=>{ try{ return db.prepare("SELECT * FROM quotes WHERE order_id=? ORDER BY created_at DESC LIMIT 1").get(id) as Record<string,unknown>|undefined; }catch{ return undefined; }})();
  res.status(201).json({ id, status: "awaiting_payment", flow: flowVal, amountFcfa, amountSats, quote });
});

// GET /api/orders — liste
router.get("/", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 100").all();
  res.json({ data: rows });
});

// GET /api/orders/:id — detail complet
router.get("/:id", (req, res) => {
  const full = getOrderFull(req.params.id);
  if (!full) return res.status(404).json({ error: "Commande introuvable" });
  // parse beneficiary_json dans payouts si present
  const payouts = (full.payouts as Array<Record<string, unknown>>).map((p) => {
    try {
      return { ...p, beneficiary: JSON.parse(p.beneficiary_json as string) };
    } catch {
      return p;
    }
  });
  res.json({ ...full, payouts });
});

// POST /api/orders/:id/invoice — creer facture Lightning (reelle si credentials, sinon demo)
router.post("/:id/invoice", async (req, res) => {
  const orderId = req.params.id;
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if ((order.status as string) !== "awaiting_payment" && (order.status as string) !== "created") {
    return res.status(409).json({ error: `Statut incompatible: ${order.status}` });
  }
  // anti double facture: si deja une invoice non expiree
  const existing = db
    .prepare("SELECT * FROM lightning_invoices WHERE order_id=? ORDER BY created_at DESC LIMIT 1")
    .get(orderId) as Record<string, unknown> | undefined;
  if (existing && String(existing.status).startsWith("pending")) {
    return res.status(409).json({ error: "Facture deja en attente", invoice: existing });
  }

  const amountSats = order.amount_sats as number;
  const reference = newId("invref");
  const invoiceId = newId("inv");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // DEMO si commande créée en démo OU si pas de credentials — évite 502 inutile ("Bitnob indisponible") côté client même quand Render a des clés
  const isDemoOrder = (order.demo_mode as number) === 1;
  if (isDemoOrder || !config.hasBitnobCredentials()) {
    const fakeBolt11 = `lnbc${amountSats}n1demo_${reference.slice(0, 8)}_SENTABAKH_DEMO_NO_FUNDS`;
    db.prepare(
      "INSERT INTO lightning_invoices (id,order_id,bolt11,amount_sats,status,reference,expires_at,raw_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(invoiceId, orderId, fakeBolt11, amountSats, "pending_demo", reference, expiresAt, JSON.stringify({ demo: true, label: "DEMONSTRATION — AUCUN FONDS REEL" }), now);
    return res.json({ demo: true, invoice: { id: invoiceId, bolt11: fakeBolt11, reference, status: "pending_demo", expiresAt, amountSats, label: "DEMONSTRATION — AUCUN FONDS RÉEL" } });
  }

  // Reel — Bitnob POST /api/lightning/invoices
  // Spec: customer_id optionnel (UUID), amount (sats), description, expiry (sec), reference (idempotency)
  // Si BITNOB_CUSTOMER_ID absent ou non-UUID, on l'omet — l'API l'accepte comme optionnel.
  const rawCustomerId = (config.bitnob.customerId || process.env.BITNOB_CUSTOMER_ID || "").trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawCustomerId);
  const body: Record<string, unknown> = {
    amount: amountSats,
    description: `SENTABAKH ${orderId} — ${String(order.description).slice(0, 80)}`,
    expiry: 900,
    reference,
  };
  if (isUuid) body.customer_id = rawCustomerId;
  const r = await bitnobRequest<{
    success?: boolean; message?: string;
    data?: { id?: string; payment_hash?: string; request?: string; payRequest?: string; bolt11?: string; amount_sat?: string; status?: string; expires_at?: string; created_at?: string };
  }>("POST", "/api/lightning/invoices", body);
  if (!r.ok) {
    return res.status(502).json({ error: "Bitnob indisponible", detail: r.error, status: r.status });
  }
  // Reponse Bitnob: { success, data: { id, payment_hash, request (BOLT11), amount_sat, status, expires_at } }
  const data = (r.data as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
  const inner = (data ?? (r.data as Record<string, unknown>)) as Record<string, unknown>;
  const bolt11 = (inner.request as string) ?? (inner.payRequest as string) ?? (inner.bolt11 as string) ?? "";
  const bitnobId = (inner.id as string) ?? "";
  const remoteExpiresAt = (inner.expires_at as string) ?? (inner.expiresAt as string) ?? expiresAt;
  // Normaliser expires_at: Bitnob renvoie parfois epoch string, parfois ISO
  let finalExpiresAt = remoteExpiresAt;
  if (/^\d{10}$/.test(String(remoteExpiresAt))) finalExpiresAt = new Date(parseInt(String(remoteExpiresAt),10)*1000).toISOString();
  db.prepare(
    "INSERT INTO lightning_invoices (id,order_id,bitnob_invoice_id,bolt11,amount_sats,status,reference,expires_at,raw_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).run(invoiceId, orderId, bitnobId, bolt11, amountSats, "pending", reference, finalExpiresAt, JSON.stringify(r.data), now);
  res.json({ demo: false, invoice: { id: invoiceId, bolt11, bitnobId, reference, status: "pending", expiresAt: finalExpiresAt, amountSats } });
});

// POST /api/orders/:id/demo/confirm-payment — simuler paiement confirme (DEMO uniquement)
router.post("/:id/demo/confirm-payment", (req, res) => {
  const orderId = req.params.id;
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if ((order.demo_mode as number) !== 1) return res.status(403).json({ error: "Action demo reservee aux commandes demo" });
  const inv = db.prepare("SELECT * FROM lightning_invoices WHERE order_id=? ORDER BY created_at DESC LIMIT 1").get(orderId) as
    | Record<string, unknown>
    | undefined;
  if (!inv) return res.status(404).json({ error: "Aucune facture" });
  db.prepare("UPDATE lightning_invoices SET status=?, paid_at=? WHERE id=?").run("paid_demo", nowIso(), inv.id as string);
  const t1 = transitionOrder(orderId, "payment_confirmed", "demo", "paiement simule");
  if (!t1.ok) return res.status(409).json({ error: t1.error });
  transitionOrder(orderId, "conversion_pending", "demo", "conversion simulee");
  transitionOrder(orderId, "funded", "demo", "financement simule — FONDS SÉQUESTRÉS (Flux B) / REÇUS (Flux A)");
  res.json({ ok: true, status: "funded", label: "DEMONSTRATION — AUCUN FONDS REEL — Flux B: FONDS SÉQUESTRÉS, vendeur: Tu peux envoyer le livreur" });
});

// POST /api/orders/:id/demo/confirm-payout — simuler versement termine (DEMO)
router.post("/:id/demo/confirm-payout", (req, res) => {
  const orderId = req.params.id;
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if ((order.demo_mode as number) !== 1) return res.status(403).json({ error: "Demo uniquement" });
  const status = order.status as string;
  if (!["payout_pending", "payout_processing"].includes(status)) return res.status(409).json({ error: `Statut ${status} incompatible` });
  // marquer payouts en completed_demo
  db.prepare("UPDATE payouts SET status=? WHERE order_id=? AND status IN ('pending','processing','pending_demo','processing_demo')").run(
    "completed_demo",
    orderId
  );
  const t = transitionOrder(orderId, "payout_completed", "demo", "versement simule");
  if (!t.ok) return res.status(409).json({ error: t.error });
  res.json({ ok: true, status: "payout_completed", label: "DEMONSTRATION — AUCUN FONDS REEL" });
});

// POST /api/orders/:id/check-payment — verifier paiement reel via Bitnob
router.post("/:id/check-payment", async (req, res) => {
  const orderId = req.params.id;
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  const inv = db.prepare("SELECT * FROM lightning_invoices WHERE order_id=? ORDER BY created_at DESC LIMIT 1").get(orderId) as
    | Record<string, unknown>
    | undefined;
  if (!inv) return res.status(404).json({ error: "Aucune facture" });
  if ((inv.status as string).includes("demo")) return res.status(400).json({ error: "Facture demo: utiliser /demo/confirm-payment" });
  if (!config.hasBitnobCredentials()) return res.status(503).json({ error: "Bitnob non configure" });
  // Expiration facture
  if (inv.expires_at && new Date(inv.expires_at as string).getTime() < Date.now()) {
    return res.status(410).json({ error: "Facture expiree", expiresAt: inv.expires_at });
  }
  const bitnobId = inv.bitnob_invoice_id as string;
  const r = await bitnobRequest<Record<string, unknown>>("GET", `/api/lightning/invoices/${bitnobId || (inv.reference as string)}`);
  if (!r.ok) return res.status(502).json({ error: "Bitnob", detail: r.error });
  const data = (r.data as Record<string, unknown>)?.data ?? r.data;
  const rawStatus = String((data as Record<string, unknown>)?.status ?? "").toLowerCase();
  const paid = rawStatus === "paid" || rawStatus === "confirmed" || (data as Record<string, unknown>)?.paid === true;
  if (paid) {
    db.prepare("UPDATE lightning_invoices SET status=?, paid_at=?, raw_json=? WHERE id=?").run("paid", nowIso(), JSON.stringify(r.data), inv.id as string);
    const t1 = transitionOrder(orderId, "payment_confirmed", "system", "paiement confirme via Bitnob");
    if (!t1.ok) return res.status(409).json({ error: t1.error });
    transitionOrder(orderId, "conversion_pending", "system", "en attente de conversion BTC->USDT");
    res.json({ paid: true, status: "conversion_pending", note: "Paiement confirme. Conversion BTC->USDT a initier via POST /api/orders/:id/trading/quote puis /trading/execute. Ne passe pas auto a funded sans confirmation trading.", bitnob: data });
  } else {
    // pending/unpaid -> ne rien transitionner, exposer l'etat exact
    res.json({ paid: false, invoiceStatus: rawStatus || "unknown", note: "Paiement non confirme — ne pas relancer en boucle. Verifier a nouveau plus tard.", bitnob: data });
  }
});

// POST /api/orders/:id/trading/quote — cotation BTC->USDT (reel uniquement, bloque en DEMO)
router.post("/:id/trading/quote", async (req, res) => {
  const orderId = req.params.id;
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if ((order.demo_mode as number) === 1) return res.status(403).json({ error: "Trading reel indisponible en mode DEMO — simule via /demo/confirm-payment" });
  if ((order.status as string) !== "conversion_pending") return res.status(409).json({ error: `Cotation trading uniquement en conversion_pending (actuel: ${order.status})` });
  if (!config.hasBitnobCredentials()) return res.status(503).json({ error: "Bitnob non configure" });
  // anti double quote active
  const existing = db.prepare("SELECT * FROM trading_quotes WHERE order_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1").get(orderId) as Record<string, unknown> | undefined;
  if (existing) {
    // verifier expiration
    const exp = existing.expires_at as string | null;
    if (exp && new Date(exp).getTime() > Date.now()) return res.status(409).json({ error: "Cotation trading deja en attente", quote: existing });
    // expiree -> marquer expiree
    db.prepare("UPDATE trading_quotes SET status=? WHERE id=?").run("expired", existing.id as string);
  }
  // montant en BTC : sats -> BTC string
  const sats = order.amount_sats as number;
  const btcStr = (sats / 100_000_000).toFixed(8).replace(/\.?0+$/, "");
  if (!btcStr || parseFloat(btcStr) <= 0) return res.status(400).json({ error: "Montant invalide" });
  const r = await bitnobRequest<Record<string, unknown>>("POST", "/api/trading/quotes", {
    base_currency: "BTC",
    quote_currency: "USDT",
    side: "SELL",
    quantity: btcStr,
  });
  if (!r.ok) return res.status(502).json({ error: "Bitnob trading/quotes", detail: r.error, status: r.status });
  const data = (r.data as Record<string, unknown>)?.data ?? r.data;
  const q = data as Record<string, unknown>;
  const bitnobQuoteId = (q.id as string) ?? (q.quote_id as string) ?? "";
  const price = (q.price as string) ?? null;
  const expiresAt = (q.expires_at as string) ?? (q.expiresAt as string) ?? new Date(Date.now() + 60_000).toISOString();
  const qid = newId("tquote");
  const now = nowIso();
  db.prepare("INSERT INTO trading_quotes (id,order_id,quote_id,base_currency,quote_currency,side,quantity,price,expires_at,status,raw_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
    qid, orderId, bitnobQuoteId, "BTC", "USDT", "SELL", btcStr, price, expiresAt, "pending", JSON.stringify(r.data), now
  );
  res.json({ ok: true, quote: { id: qid, bitnobQuoteId, quantity: btcStr, price, expiresAt, status: "pending" } });
});

// POST /api/orders/:id/trading/execute — executer la conversion via quote (reel uniquement)
router.post("/:id/trading/execute", async (req, res) => {
  const orderId = req.params.id;
  const schema = z.object({ quoteId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation", details: parsed.error.flatten() });
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if ((order.status as string) !== "conversion_pending") return res.status(409).json({ error: `Execution uniquement en conversion_pending (actuel: ${order.status})` });
  if ((order.demo_mode as number) === 1) return res.status(403).json({ error: "Trading reel indisponible en DEMO" });
  if (!config.hasBitnobCredentials()) return res.status(503).json({ error: "Bitnob non configure" });
  const quote = db.prepare("SELECT * FROM trading_quotes WHERE id=? AND order_id=?").get(parsed.data.quoteId, orderId) as Record<string, unknown> | undefined;
  if (!quote) return res.status(404).json({ error: "Cotation trading introuvable" });
  if ((quote.status as string) !== "pending") return res.status(409).json({ error: `Cotation non executable (statut: ${quote.status})` });
  if (quote.expires_at && new Date(quote.expires_at as string).getTime() < Date.now()) {
    db.prepare("UPDATE trading_quotes SET status=? WHERE id=?").run("expired", quote.id as string);
    return res.status(410).json({ error: "Cotation expiree — redemander une cotation" });
  }
  // anti double trading order
  const existingOrder = db.prepare("SELECT * FROM trading_orders WHERE order_id=? AND quote_id=? LIMIT 1").get(orderId, quote.id as string) as Record<string, unknown> | undefined;
  if (existingOrder) return res.status(409).json({ error: "Ordre trading deja cree pour cette cotation", order: existingOrder });
  // solde disponible check (optionnel, non bloquant strict — informatif)
  const bal = await bitnobRequest<Record<string, unknown>>("GET", "/api/balances/BTC");
  if (bal.ok) {
    const balData = (bal.data as Record<string, unknown>)?.data ?? bal.data;
    const avail = String((balData as Record<string, unknown>)?.available_balance ?? (balData as Record<string, unknown>)?.availableBalance ?? "0");
    // avail est en sats string — comparer
    const availSats = parseInt(avail, 10);
    if (!Number.isNaN(availSats) && availSats < (order.amount_sats as number)) {
      return res.status(409).json({ error: `Solde BTC insuffisant`, detail: `disponible ${availSats} sats, requis ${order.amount_sats} sats`, balances: balData });
    }
  }
  const reference = newId("torder");
  const qty = quote.quantity as string;
  const r = await bitnobRequest<Record<string, unknown>>("POST", "/api/trading/orders", {
    base_currency: "BTC",
    quote_currency: "USDT",
    side: "SELL",
    quantity: qty,
    quote_id: quote.quote_id as string,
    reference,
  });
  if (!r.ok) {
    // si 404 quote not found -> marquer expired
    if (r.status === 404) db.prepare("UPDATE trading_quotes SET status=? WHERE id=?").run("expired", quote.id as string);
    return res.status(502).json({ error: "Bitnob trading/orders", detail: r.error, status: r.status });
  }
  const data = (r.data as Record<string, unknown>)?.data ?? r.data;
  const od = data as Record<string, unknown>;
  const bitnobOrderId = (od.id as string) ?? "";
  const statusRaw = String(od.status ?? "pending").toLowerCase();
  const tid = newId("torder");
  const now = nowIso();
  db.prepare("INSERT INTO trading_orders (id,order_id,bitnob_order_id,quote_id,status,reference,raw_json,created_at) VALUES (?,?,?,?,?,?,?,?)").run(
    tid, orderId, bitnobOrderId, quote.id as string, statusRaw, reference, JSON.stringify(r.data), now
  );
  db.prepare("UPDATE trading_quotes SET status=? WHERE id=?").run("executed", quote.id as string);
  // Ne passer a funded QUE si status confirme success/completed/filled — jamais pending
  if (["completed", "filled", "success", "executed"].includes(statusRaw)) {
    const t = transitionOrder(orderId, "funded", "system", "conversion BTC->USDT confirme");
    return res.json({ ok: true, status: t.ok ? "funded" : "conversion_pending", tradingOrder: { id: tid, bitnobOrderId, status: statusRaw, reference }, note: "Conversion confirmee -> funded" });
  }
  // sinon rester conversion_pending, exposer l'etat (a verifier via /trading/status)
  res.json({ ok: true, status: "conversion_pending", tradingOrder: { id: tid, bitnobOrderId, status: statusRaw, reference }, note: "Ordre trading en attente — verifier via GET /api/orders/:id/trading/status, ne pas considerer comme funded." });
});

// GET /api/orders/:id/trading/status — verifier l'etat trading (consulte avant retry, evite double)
router.get("/:id/trading/status", async (req, res) => {
  const orderId = req.params.id;
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  const tOrder = db.prepare("SELECT * FROM trading_orders WHERE order_id=? ORDER BY created_at DESC LIMIT 1").get(orderId) as Record<string, unknown> | undefined;
  const tQuote = db.prepare("SELECT * FROM trading_quotes WHERE order_id=? ORDER BY created_at DESC LIMIT 1").get(orderId) as Record<string, unknown> | undefined;
  if (!tOrder) return res.json({ orderStatus: order.status, quote: tQuote ?? null, order: null, note: "Aucun ordre trading — demander une cotation d'abord." });
  if (!config.hasBitnobCredentials()) return res.json({ orderStatus: order.status, order: tOrder, quote: tQuote, note: "Bitnob non configure — etat local uniquement" });
  if (!tOrder.bitnob_order_id) return res.json({ orderStatus: order.status, order: tOrder, quote: tQuote });
  const r = await bitnobRequest<Record<string, unknown>>("GET", `/api/trading/orders/${tOrder.bitnob_order_id as string}`);
  if (!r.ok) return res.status(502).json({ error: "Bitnob get trading order", detail: r.error, status: r.status });
  const data = (r.data as Record<string, unknown>)?.data ?? r.data;
  const d = data as Record<string, unknown>;
  const statusRaw = String(d.status ?? "unknown").toLowerCase();
  // sync local
  db.prepare("UPDATE trading_orders SET status=?, raw_json=? WHERE id=?").run(statusRaw, JSON.stringify(r.data), tOrder.id as string);
  // transition seulement si completed
  if (["completed","filled","success","executed"].includes(statusRaw) && (order.status as string) === "conversion_pending") {
    transitionOrder(orderId, "funded", "system", "conversion verifiee via status");
    return res.json({ orderStatus: "funded", tradingStatus: statusRaw, order: { ...tOrder, status: statusRaw }, quote: tQuote, bitnob: data });
  }
  res.json({ orderStatus: order.status, tradingStatus: statusRaw, order: { ...tOrder, status: statusRaw }, quote: tQuote, bitnob: data });
});

// POST /api/orders/:id/proof — preuve de livraison (vendeur)
router.post("/:id/proof", (req, res) => {
  const orderId = req.params.id;
  const schema = z.object({ note: z.string().min(3).max(1000), imageUrl: z.string().url().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation", details: parsed.error.flatten() });
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if ((order.status as string) !== "funded") return res.status(409).json({ error: `Preuve uniquement si FONDS SÉQUESTRÉS / financée (actuel: ${order.status})` });
  const id = newId("proof");
  db.prepare("INSERT INTO delivery_proofs (id,order_id,note,image_url,created_by,created_at) VALUES (?,?,?,?,?,?)").run(
    id,
    orderId,
    parsed.data.note,
    parsed.data.imageUrl ?? null,
    "seller",
    nowIso()
  );
  const t = transitionOrder(orderId, "delivery_declared", "seller", "preuve deposee — livreur en route (hors-plateforme)");
  if (!t.ok) return res.status(409).json({ error: t.error });
  res.status(201).json({ id, status: "delivery_declared" });
});

// POST /api/orders/:id/confirm-delivery — confirmation reception (cliente clique "J'ai bien reçu" → déclenche CODE)
router.post("/:id/confirm-delivery", (req, res) => {
  const orderId = req.params.id;
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if ((order.status as string) !== "delivery_declared") return res.status(409).json({ error: `Confirmation uniquement si livree (actuel: ${order.status}) — livreur doit être arrivé` });
  const t = transitionOrder(orderId, "delivery_confirmed", "beneficiary", "reception confirmee — cliente a cliqué J'ai bien reçu");
  if (!t.ok) return res.status(409).json({ error: t.error });
  res.json({ ok: true, status: "delivery_confirmed" });
});

// ── FLUX B — CODE DE REMISE (séquestré) ──
// Règle graphe: seule VENDEUR+ADMIN ont un compte; CLIENT et LIVREUR jamais de compte.
// Séquence: FONDS SÉQUESTRÉS → Livreur arrive hors-plateforme → Cliente clique "J'ai bien reçu" → CODE 482917 (6ch, 2min, 3 essais, persisté) → Cliente dicte → Livreur appelle vendeur → Vendeur saisit code → Vérifié = argent débloqué (versement XOF)

// POST /api/orders/:id/delivery-code — générer/récupérer le CODE (cliente, sans auth, idempotent persisté)
router.post("/:id/delivery-code", (req, res) => {
  const orderId = req.params.id;
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  const st = String(order.status);
  if (!["funded", "delivery_declared", "delivery_confirmed"].includes(st)) {
    return res.status(409).json({ error: `CODE uniquement quand fonds séquestrés / livraison (actuel: ${st})`, hint: "Attendre FONDS SÉQUESTRÉS puis Livreur arrivé" });
  }
  const result = getOrCreateDeliveryCode(orderId);
  if (!result.code) {
    // Code existant sans plain (compat) — hint seule
    return res.json({ codeHint: result.hint, expiresAt: result.expiresAt, attemptsLeft: 3, persisted: true, note: "Code persisté — si refresh, même code (hint masqué)" });
  }
  const display = `${result.code.slice(0, 3)} ${result.code.slice(3)}`;
  res.json({
    code: result.code,
    display,
    hint: result.hint,
    expiresAt: result.expiresAt,
    isNew: result.isNew,
    persisted: true,
    message: `DITES AU LIVREUR : ${display}`,
    ttlMs: 120_000,
    maxAttempts: 3,
    note: result.isNew ? "CODE 6 chiffres — 2min — 3 essais — persisté en base" : "Même CODE — si elle actualise, le même code réapparaît",
  });
});

// GET /api/orders/:id/delivery-code — relire le code actif (cliente refresh → même code, vendeur vérif)
router.get("/:id/delivery-code", (req, res) => {
  const orderId = req.params.id;
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  let row: Record<string, unknown> | undefined;
  try {
    row = db.prepare("SELECT id, code_hint, code_plain, status, expires_at, attempts, created_at, verified_at FROM delivery_codes WHERE order_id=? ORDER BY created_at DESC LIMIT 1").get(orderId) as Record<string, unknown> | undefined;
  } catch { return res.json({ code: null, note: "Aucun code" }); }
  if (!row || row.status !== "active") return res.json({ code: null, status: row?.status ?? "none", note: "Aucun CODE actif — générer via POST /delivery-code après J'ai bien reçu" });
  const exp = new Date(row.expires_at as string).getTime();
  if (exp < Date.now()) return res.json({ code: null, status: "expired", note: "CODE expiré — régénérer" });
  // Retourne plain uniquement si existant (sinon hint)
  const plain = row.code_plain as string | null;
  if (plain && /^\d{6}$/.test(plain)) {
    return res.json({ code: plain, display: `${plain.slice(0, 3)} ${plain.slice(3)}`, hint: row.code_hint, expiresAt: row.expires_at, attempts: row.attempts, maxAttempts: 3, persisted: true, message: `DITES AU LIVREUR : ${plain.slice(0, 3)} ${plain.slice(3)}` });
  }
  return res.json({ codeHint: row.code_hint, hint: row.code_hint, expiresAt: row.expires_at, attempts: row.attempts, persisted: true });
});

// POST /api/orders/:id/delivery-code/verify — Vendeur saisit le code (VENDEUR/ADMIN, 3 essais, 2min)
router.post("/:id/delivery-code/verify", (req, res) => {
  const orderId = req.params.id;
  const schema = z.object({ code: z.string().min(4).max(10) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation", details: parsed.error.flatten() });
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  const st = String(order.status);
  if (!["funded", "delivery_declared", "delivery_confirmed", "disputed"].includes(st)) {
    return res.status(409).json({ error: `Vérification CODE uniquement après FONDS SÉQUESTRÉS (actuel: ${st})` });
  }
  const r = verifyDeliveryCode(orderId, parsed.data.code);
  if (!r.ok) {
    // Déterminer le code erreur HTTP
    const msg = r.error ?? "Code incorrect";
    if (msg.includes("expiré")) return res.status(410).json({ error: msg });
    if (msg.includes("verrouillé") || msg.includes("Trop de tentatives")) return res.status(423).json({ error: msg, hint: "CODE verrouillé — régénération requise (cliente: J'ai bien reçu)" });
    if (msg.includes("Aucun code")) return res.status(404).json({ error: msg });
    // Mauvais code mais essais restants → 401 avec hint
    const row2 = (()=>{ try{ return db.prepare("SELECT attempts FROM delivery_codes WHERE order_id=? AND status='active' ORDER BY created_at DESC LIMIT 1").get(orderId) as Record<string,unknown>|undefined; }catch{ return undefined; }})();
    const left = row2 ? Math.max(0, 3 - (row2.attempts as number)) : 0;
    return res.status(401).json({ error: msg, attemptsLeft: left, maxAttempts: 3 });
  }
  // Succès → transition vers delivery_confirmed si besoin, puis débloque versement
  const cur = String((db.prepare("SELECT status FROM orders WHERE id=?").get(orderId) as Record<string,unknown>|undefined)?.status ?? st);
  if (cur === "delivery_declared") transitionOrder(orderId, "delivery_confirmed", "seller", `CODE vérifié ${r.codeId} — remise vérifiée`);
  else if (cur === "funded") {
    transitionOrder(orderId, "delivery_declared", "seller", "CODE vérifié — livraison implicite");
    transitionOrder(orderId, "delivery_confirmed", "seller", "CODE vérifié — remise vérifiée");
  }
  // Le payout pourra être initié ensuite (delivery_confirmed → payout_pending)
  res.json({ ok: true, verified: true, message: "✅ Vérifié = Argent débloqué — versement XOF disponible (POST /payout/quote → /payout/initialize)", orderStatus: (db.prepare("SELECT status FROM orders WHERE id=?").get(orderId) as Record<string,unknown>)?.status });
});

// POST /api/orders/:id/payout/quote — cotation versement (reelle si Bitnob, sinon demo)
router.post("/:id/payout/quote", async (req, res) => {
  const orderId = req.params.id;
  const schema = z.object({
    toCurrency: z.enum(["XOF", "NGN", "GHS", "KES", "UGX", "ZAR"]).default("XOF"),
    country: z.string().length(2).default("SN"),
    fromAsset: z.enum(["USDT", "BTC"]).default("USDT"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation", details: parsed.error.flatten() });
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if ((order.status as string) !== "delivery_confirmed") return res.status(409).json({ error: `Cotation uniquement apres reception confirmee (actuel: ${order.status})` });
  // anti double quote active
  const existing = db.prepare("SELECT * FROM payout_quotes WHERE order_id=? AND status IN ('pending','pending_demo') ORDER BY created_at DESC LIMIT 1").get(orderId);
  if (existing) return res.status(409).json({ error: "Cotation deja en attente" });

  const qid = newId("pquote");
  const now = nowIso();
  // estimation demo: 1 BTC ~ 60M XOF fictif pour affichage, clairement marque demo
  const demoAmountXof = Math.round((order.amount_sats as number) * 600); // ex: 50000 sats ~ 30M XOF demo
  const isDemo = (order.demo_mode as number) === 1 || !config.hasBitnobCredentials();

  if (isDemo) {
    db.prepare(
      "INSERT INTO payout_quotes (id,order_id,from_asset,to_currency,country,amount_base_units,status,raw_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(qid, orderId, parsed.data.fromAsset, parsed.data.toCurrency, parsed.data.country, String(demoAmountXof), "pending_demo", JSON.stringify({ demo: true, label: "DEMONSTRATION — AUCUN FONDS REEL", estimatedXof: demoAmountXof, feesDemo: Math.round(demoAmountXof * 0.015) }), now);
    return res.json({ demo: true, quote: { id: qid, status: "pending_demo", estimatedXof: demoAmountXof, label: "DEMONSTRATION — AUCUN FONDS REEL" } });
  }

  // Reel: POST /api/payouts/quotes — Bitnob Payouts flow: quote → initialize → finalize
  // Spec: amount = crypto amount en base units (USDT: micro-units 1_000_000 = 1 USDT), from_asset, to_currency, country, source, reference
  const reference = newId("payoutref");
  // Montant: en réel depuis USDT, il faut des micro-units. Si trading BTC->USDT confirmé, on peut estimer.
  // Sinon, on déduit USDT ≈ sats * btcPrice / 1e8 / usdtRate, ou on refuse si on ne peut pas être fiable.
  let amountBaseUnits: string;
  if (parsed.data.fromAsset === "BTC") {
    // BTC → XOF direct: amount en sats string (base units BTC = sats)
    amountBaseUnits = String(order.amount_sats as number);
  } else {
    // USDT → XOF: besoin de micro-units USDT
    const tradingFilled = db.prepare("SELECT * FROM trading_orders WHERE order_id=? AND status IN ('filled','completed','success','executed') ORDER BY created_at DESC LIMIT 1").get(orderId) as Record<string, unknown> | undefined;
    if (tradingFilled) {
      // Trading confirmé → on estime USDT depuis la quote (receive_quantity) ou depuis amount_sats * price
      const qrow = tradingFilled.quote_id ? db.prepare("SELECT * FROM trading_quotes WHERE id=?").get(tradingFilled.quote_id as string) as Record<string, unknown> | undefined : null;
      const rawQ = qrow ? (()=>{ try{return JSON.parse(qrow.raw_json as string);}catch{return null;}})() as Record<string, unknown> | null : null;
      const recv = (rawQ as Record<string, unknown> | null)?.data ? String((((rawQ as Record<string, unknown>).data as Record<string, unknown>)?.exchange as Record<string, unknown> | undefined)?.receive_quantity ?? "") : "";
      if (recv && parseFloat(recv) > 0) {
        // receive_quantity est en USDT major units string → micro-units
        amountBaseUnits = String(Math.round(parseFloat(recv) * 1_000_000));
      } else {
        // Fallback: estimation sats -> BTC -> USDT via prix trading
        const priceStr = String(qrow?.price ?? "");
        const price = parseFloat(priceStr);
        if (price > 0) {
          const btc = (order.amount_sats as number) / 100_000_000;
          const usdt = btc * price;
          amountBaseUnits = String(Math.round(usdt * 1_000_000));
        } else {
          return res.status(409).json({ error: "Trading confirmé mais prix indisponible — impossible de coter payout USDT", hint: "Relire GET /api/orders/:id/trading/status" });
        }
      }
    } else {
      // Pas de trading — on cote depuis le solde USDT estimé via fx.ts (BTC->USDT ~ market)
      // On utilise une estimation prudente: sats → BTC → USDT (prix live), puis micro-units
      try {
        const { getBtcPriceXof } = await import("../fx.js");
        // getBtcPriceXof donne BTC/XOF; pour USDT on approxime USDT/XOF ~ 600
        const btc = (order.amount_sats as number) / 100_000_000;
        // On récupère le prix BTC/USDT live
        const pr = await bitnobRequest<Record<string, unknown>>("GET", "/api/trading/prices");
        let btcUsdt: number | null = null;
        if (pr.ok) {
          const d = (pr.data as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
          const arr = (d?.prices ?? []) as Array<Record<string, unknown>>;
          for (const p of arr) if (String(p.base_currency).toUpperCase()==="BTC" && String(p.quote_currency).toUpperCase()==="USDT") btcUsdt = parseFloat(String(p.price));
        }
        if (btcUsdt && btcUsdt > 5000) {
          amountBaseUnits = String(Math.round(btc * btcUsdt * 1_000_000));
        } else {
          return res.status(409).json({ error: "Montant USDT indisponible — conversion BTC->USDT non confirmée et prix live indisponible", hint: "Exécutez d'abord POST /api/orders/:id/trading/quote → /trading/execute, ou cotez en fromAsset=BTC." });
        }
      } catch {
        return res.status(409).json({ error: "Montant USDT indisponible pour payout", hint: "Trading BTC→USDT requis avant payout USDT, ou utilisez fromAsset=BTC." });
      }
    }
  }
  // Payout quote: amount = crypto base units string, from_asset, to_currency, country, source, reference
  const r = await bitnobRequest<Record<string, unknown>>("POST", "/api/payouts/quotes", {
    from_asset: parsed.data.fromAsset,
    to_currency: parsed.data.toCurrency,
    amount: amountBaseUnits,
    country: parsed.data.country,
    source: "offchain",
    reference,
  });
  if (!r.ok) return res.status(502).json({ error: "Bitnob payout quote", detail: r.error, status: r.status });
  const data = (r.data as Record<string, unknown>)?.data ?? r.data;
  const bitnobQuoteId = (data as Record<string, unknown>)?.id as string ?? (data as Record<string, unknown>)?.quoteId as string ?? reference;
  db.prepare(
    "INSERT INTO payout_quotes (id,order_id,bitnob_quote_id,from_asset,to_currency,country,amount_base_units,status,raw_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).run(qid, orderId, bitnobQuoteId, parsed.data.fromAsset, parsed.data.toCurrency, parsed.data.country, amountBaseUnits, "pending", JSON.stringify(r.data), now);
  res.json({ demo: false, quote: { id: qid, bitnobQuoteId, status: "pending", raw: data } });
});

// GET /api/orders/:id/payout/status — etat payout (consulte avant retry, evite double)
router.get("/:id/payout/status", async (req, res) => {
  const orderId = req.params.id;
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  const pOrder = db.prepare("SELECT * FROM payouts WHERE order_id=? ORDER BY created_at DESC LIMIT 1").get(orderId) as Record<string, unknown> | undefined;
  const pQuote = db.prepare("SELECT * FROM payout_quotes WHERE order_id=? ORDER BY created_at DESC LIMIT 1").get(orderId) as Record<string, unknown> | undefined;
  if (!pOrder) return res.json({ orderStatus: order.status, quote: pQuote ?? null, payout: null, note: "Aucun versement — demander une cotation puis initialize/finalize." });
  if ((pOrder.status as string).includes("demo")) return res.json({ orderStatus: order.status, payout: pOrder, quote: pQuote, demo: true });
  if (!config.hasBitnobCredentials()) return res.json({ orderStatus: order.status, payout: pOrder, quote: pQuote, note: "Bitnob non configure — etat local uniquement" });
  if (!pOrder.bitnob_payout_id) return res.json({ orderStatus: order.status, payout: pOrder, quote: pQuote });
  const r = await bitnobRequest<Record<string, unknown>>("GET", `/api/payouts/${pOrder.bitnob_payout_id as string}`);
  if (!r.ok) return res.status(502).json({ error: "Bitnob get payout", detail: r.error, status: r.status });
  const data = (r.data as Record<string, unknown>)?.data ?? r.data;
  const d = data as Record<string, unknown>;
  const statusRaw = String(d.status ?? "unknown").toLowerCase();
  db.prepare("UPDATE payouts SET status=?, raw_json=? WHERE id=?").run(statusRaw, JSON.stringify(r.data), pOrder.id as string);
  if (statusRaw === "completed" && ["payout_processing","payout_pending"].includes(order.status as string)) {
    transitionOrder(orderId, "payout_completed", "system", "payout verifie via status");
    return res.json({ orderStatus: "payout_completed", payoutStatus: statusRaw, payout: { ...pOrder, status: statusRaw }, quote: pQuote, bitnob: data });
  }
  res.json({ orderStatus: order.status, payoutStatus: statusRaw, payout: { ...pOrder, status: statusRaw }, quote: pQuote, bitnob: data });
});

// POST /api/orders/:id/payout/initialize — init versement (beneficiaire requis)
router.post("/:id/payout/initialize", async (req, res) => {
  const orderId = req.params.id;
  const schema = z.object({
    quoteId: z.string().min(1),
    beneficiary: z.object({
      destination_type: z.enum(["bank", "mobile_money"]),
      country: z.string().length(2),
      account_name: z.string().min(2).max(120),
      account_number: z.string().min(5).max(30),
      bank_code: z.string().optional(),
      network: z.string().optional(),
    }),
    callbackUrl: z.string().url().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation", details: parsed.error.flatten() });
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if ((order.status as string) !== "delivery_confirmed" && (order.status as string) !== "payout_pending") {
    return res.status(409).json({ error: `Init uniquement apres reception (actuel: ${order.status})` });
  }
  const quote = db.prepare("SELECT * FROM payout_quotes WHERE id=? AND order_id=?").get(parsed.data.quoteId, orderId) as
    | Record<string, unknown>
    | undefined;
  if (!quote) return res.status(404).json({ error: "Cotation introuvable pour cette commande" });
  // anti double payout
  const existingPayout = db.prepare("SELECT * FROM payouts WHERE order_id=? AND status IN ('pending','processing','pending_demo','processing_demo') LIMIT 1").get(orderId);
  if (existingPayout) return res.status(409).json({ error: "Versement deja en cours pour cette commande" });

  const isDemo = (quote.status as string) === "pending_demo";
  const payoutId = newId("payout");
  const reference = newId("payoutinit");
  const now = nowIso();

  if (isDemo) {
    db.prepare("INSERT INTO payouts (id,order_id,quote_id,status,reference,beneficiary_json,raw_json,created_at) VALUES (?,?,?,?,?,?,?,?)").run(
      payoutId,
      orderId,
      parsed.data.quoteId,
      "pending_demo",
      reference,
      JSON.stringify(parsed.data.beneficiary),
      JSON.stringify({ demo: true, label: "DEMONSTRATION — AUCUN FONDS REEL" }),
      now
    );
    transitionOrder(orderId, "payout_pending", "demo", "versement demo init");
    transitionOrder(orderId, "payout_processing", "demo", "versement demo processing");
    db.prepare("UPDATE payouts SET status=? WHERE id=?").run("processing_demo", payoutId);
    return res.json({ demo: true, payout: { id: payoutId, status: "processing_demo", reference, label: "DEMONSTRATION — AUCUN FONDS REEL" } });
  }

  if (!config.hasBitnobCredentials()) return res.status(503).json({ error: "Bitnob non configure" });
  const bitnobQuoteId = quote.bitnob_quote_id as string;
  const r = await bitnobRequest<Record<string, unknown>>("POST", `/api/payouts/${bitnobQuoteId}/initialize`, {
    beneficiary: parsed.data.beneficiary,
    reference,
    callback_url: parsed.data.callbackUrl ?? `${config.corsOrigin}/api/webhooks/bitnob`,
  });
  if (!r.ok) return res.status(502).json({ error: "Bitnob initialize", detail: r.error, status: r.status });
  const data = (r.data as Record<string, unknown>)?.data ?? r.data;
  const bitnobPayoutId = (data as Record<string, unknown>)?.id as string ?? "";
  db.prepare("INSERT INTO payouts (id,order_id,bitnob_payout_id,quote_id,status,reference,beneficiary_json,raw_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(
    payoutId,
    orderId,
    bitnobPayoutId,
    parsed.data.quoteId,
    "pending",
    reference,
    JSON.stringify(parsed.data.beneficiary),
    JSON.stringify(r.data),
    now
  );
  transitionOrder(orderId, "payout_pending", "system", "payout init");
  res.json({ demo: false, payout: { id: payoutId, bitnobPayoutId, status: "pending", reference } });
});

// POST /api/orders/:id/payout/finalize — finalize (reel uniquement)
router.post("/:id/payout/finalize", async (req, res) => {
  const orderId = req.params.id;
  const schema = z.object({ quoteId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation", details: parsed.error.flatten() });
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  const quote = db.prepare("SELECT * FROM payout_quotes WHERE id=? AND order_id=?").get(parsed.data.quoteId, orderId) as
    | Record<string, unknown>
    | undefined;
  if (!quote) return res.status(404).json({ error: "Cotation introuvable" });
  if ((quote.status as string).includes("demo")) return res.status(400).json({ error: "Cotation demo: finalisation simulee via /demo/confirm-payout" });
  if (!config.hasBitnobCredentials()) return res.status(503).json({ error: "Bitnob non configure" });
  const bitnobQuoteId = quote.bitnob_quote_id as string;
  const r = await bitnobRequest<Record<string, unknown>>("POST", `/api/payouts/${bitnobQuoteId}/finalize`, {});
  if (!r.ok) return res.status(502).json({ error: "Bitnob finalize", detail: r.error, status: r.status });
  db.prepare("UPDATE payouts SET status=? WHERE quote_id=? AND order_id=?").run("processing", parsed.data.quoteId, orderId);
  transitionOrder(orderId, "payout_processing", "system", "finalize");
  res.json({ ok: true, status: "payout_processing", bitnob: (r.data as Record<string, unknown>)?.data ?? r.data });
});

export default router;
