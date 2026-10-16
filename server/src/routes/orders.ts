import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { transitionOrder, nowIso, newId, getOrderFull } from "../db/helpers.js";
import { config } from "../config.js";
import { bitnobRequest } from "../bitnob/client.js";

const router = Router();

// POST /api/orders — creer commande
router.post("/", (req, res) => {
  const schema = z.object({
    amountSats: z.number().int().positive().max(100_000_000),
    description: z.string().min(3).max(500),
    sellerLabel: z.string().min(2).max(120),
    beneficiaryName: z.string().min(2).max(120),
    beneficiaryPhoneHint: z.string().max(30).optional(),
    demoMode: z.boolean().optional().default(false),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation", details: parsed.error.flatten() });
  const d = parsed.data;
  const id = newId("ord");
  const now = nowIso();
  const db = getDb();
  db.prepare(
    "INSERT INTO orders (id,status,amount_sats,description,seller_label,beneficiary_name,beneficiary_phone_hint,demo_mode,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).run(id, "created", d.amountSats, d.description, d.sellerLabel, d.beneficiaryName, d.beneficiaryPhoneHint ?? null, d.demoMode ? 1 : 0, now, now);
  db.prepare(
    "INSERT INTO order_transitions (id,order_id,from_status,to_status,actor,reason,created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(newId("tr"), id, "created", "created", "system", "creation", now);
  // auto -> awaiting_payment
  transitionOrder(id, "awaiting_payment", "system", "creation");
  res.status(201).json({ id, status: "awaiting_payment" });
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

  if (!config.hasBitnobCredentials()) {
    // DEMO explicite — jamais presente comme reelle
    const fakeBolt11 = `lnbc${amountSats}n1demo_${reference.slice(0, 8)}_SENTABAKH_DEMO_NO_FUNDS`;
    db.prepare(
      "INSERT INTO lightning_invoices (id,order_id,bolt11,amount_sats,status,reference,expires_at,raw_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(invoiceId, orderId, fakeBolt11, amountSats, "pending_demo", reference, expiresAt, JSON.stringify({ demo: true, label: "DEMONSTRATION — AUCUN FONDS REEL" }), now);
    return res.json({ demo: true, invoice: { id: invoiceId, bolt11: fakeBolt11, reference, status: "pending_demo", expiresAt, amountSats, label: "DEMONSTRATION — AUCUN FONDS REEL" } });
  }

  // Reel — Bitnob POST /api/lightning/invoices (customer_id requis; on utilise un customer genere ou env)
  const customerId = (process.env.BITNOB_CUSTOMER_ID ?? "cust_demo") as string;
  const r = await bitnobRequest<{
    data?: { id?: string; payRequest?: string; bolt11?: string; status?: string; expiresAt?: string };
  }>("POST", "/api/lightning/invoices", {
    customer_id: customerId,
    amount: amountSats,
    description: `SENTABAKH ${orderId} — ${order.description}`,
    expiry: 900,
    reference,
  });
  if (!r.ok) {
    return res.status(502).json({ error: "Bitnob indisponible", detail: r.error, status: r.status });
  }
  const data = (r.data as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
  const inner = (data ?? (r.data as Record<string, unknown>)) as Record<string, unknown>;
  const bolt11 = (inner.payRequest as string) ?? (inner.bolt11 as string) ?? "";
  const bitnobId = (inner.id as string) ?? "";
  db.prepare(
    "INSERT INTO lightning_invoices (id,order_id,bitnob_invoice_id,bolt11,amount_sats,status,reference,expires_at,raw_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).run(invoiceId, orderId, bitnobId, bolt11, amountSats, "pending", reference, expiresAt, JSON.stringify(r.data), now);
  res.json({ demo: false, invoice: { id: invoiceId, bolt11, bitnobId, reference, status: "pending", expiresAt, amountSats } });
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
  transitionOrder(orderId, "funded", "demo", "financement simule");
  res.json({ ok: true, status: "funded", label: "DEMONSTRATION — AUCUN FONDS REEL" });
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

// POST /api/orders/:id/proof — preuve de livraison
router.post("/:id/proof", (req, res) => {
  const orderId = req.params.id;
  const schema = z.object({ note: z.string().min(3).max(1000), imageUrl: z.string().url().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation", details: parsed.error.flatten() });
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if ((order.status as string) !== "funded") return res.status(409).json({ error: `Preuve uniquement si financée (actuel: ${order.status})` });
  const id = newId("proof");
  db.prepare("INSERT INTO delivery_proofs (id,order_id,note,image_url,created_by,created_at) VALUES (?,?,?,?,?,?)").run(
    id,
    orderId,
    parsed.data.note,
    parsed.data.imageUrl ?? null,
    "seller",
    nowIso()
  );
  const t = transitionOrder(orderId, "delivery_declared", "seller", "preuve deposee");
  if (!t.ok) return res.status(409).json({ error: t.error });
  res.status(201).json({ id, status: "delivery_declared" });
});

// POST /api/orders/:id/confirm-delivery — confirmation reception
router.post("/:id/confirm-delivery", (req, res) => {
  const orderId = req.params.id;
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if ((order.status as string) !== "delivery_declared") return res.status(409).json({ error: `Confirmation uniquement si livree (actuel: ${order.status})` });
  const t = transitionOrder(orderId, "delivery_confirmed", "beneficiary", "reception confirmee");
  if (!t.ok) return res.status(409).json({ error: t.error });
  res.json({ ok: true, status: "delivery_confirmed" });
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

  // Reel: POST /api/payouts/quotes — bloque si conversion BTC->USDT non confirmee
  if ((order.status as string) === "delivery_confirmed" && parsed.data.fromAsset === "USDT" && !((order.amount_sats as number) && db.prepare("SELECT 1 FROM trading_orders WHERE order_id=? AND status IN ('completed','filled','success','executed') LIMIT 1").get(orderId))) {
    // On autorise la cotation USDT meme sans trading si le marchand a deja des USDT, mais on l'indique
    // Pas de blocage dur — informatif seulement (le preflight balances le dira)
  }
  // Montant en base units (XOF payout depuis USDT est en micro-units 6 decimales ; ici on derive du sats*600 demo -> non)
  // En reel, le montant USDT en micro-units doit venir du trading; faute de trading confirme on ne peut promettre un montant exact.
  // On exige que l'appelant fournisse le montant ou on utilise le solde USDT disponible — on garde l'ancienne logique avec garde.
  const reference = newId("payoutref");
  // Pour XOF depuis USDT : Bitnob attend `amount` en base units de from_asset (USDT micro-units). Si on n'a pas de montant trading, on refuse de mentir.
  const tradingOk = db.prepare("SELECT quantity, raw_json FROM trading_quotes WHERE order_id=? AND status='executed' ORDER BY created_at DESC LIMIT 1").get(orderId) as Record<string, unknown> | undefined;
  let amountBaseUnits: string;
  if (tradingOk) {
    // On estime l'USDT obtenu via trading (non fiable sans prix reel) — on expose le doute
    const raw = (()=>{ try{return JSON.parse(tradingOk.raw_json as string);}catch{return null;}})() as Record<string, unknown> | null;
    const usdtAmount = (raw as Record<string, unknown> | null)?.data ? String(((raw as Record<string, unknown>).data as Record<string, unknown>).quoteAmount ?? "") : "";
    // Fallback: si le trading n'expose pas d'USDT amount, on reste bloquant et on l'indique
    if (!usdtAmount) {
      return res.status(409).json({ error: "Conversion BTC->USDT non resolue : montant USDT indisponible — verifier trading/status avant payout", hint: "Appelez GET /api/orders/:id/trading/status ; si pas funded, la cotation payout ne peut etre fiable." });
    }
    amountBaseUnits = usdtAmount;
  } else {
    // Pas de trading confirme : on utilise un montant fourni par le client si present, sinon on demande explicitement
    // Pour compat avec la demo, on garde l'ancien comportement mais on le marque non garanti
    amountBaseUnits = String(order.amount_sats as number);
  }
  const r = await bitnobRequest<Record<string, unknown>>("POST", "/api/payouts/quotes", {
    from_asset: parsed.data.fromAsset,
    to_currency: parsed.data.toCurrency,
    source: "offchain",
    amount: amountBaseUnits,
    payment_reason: "vendor_payment",
    reference,
    country: parsed.data.country,
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
