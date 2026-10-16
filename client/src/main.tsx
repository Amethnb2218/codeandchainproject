import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link, useParams, useNavigate } from "react-router-dom";
import "./styles.css";
import { api, satsToBtc } from "./lib/api";

const STATUS_LABEL: Record<string, string> = {
  created: "Créée",
  awaiting_payment: "En attente de paiement",
  payment_confirmed: "Paiement confirmé",
  conversion_pending: "Conversion en cours",
  funded: "Financée",
  delivery_declared: "Livraison déclarée",
  delivery_confirmed: "Réception confirmée",
  payout_pending: "Versement en attente",
  payout_processing: "Versement en cours",
  payout_completed: "Versement terminé",
  failed: "Échouée",
  expired: "Expirée",
  disputed: "Litige",
};

function TopBadge() {
  const mode = import.meta.env.VITE_APP_MODE ?? "sandbox";
  const isDemo = mode === "demo";
  const label = isDemo ? "DÉMONSTRATION — AUCUN FONDS RÉEL" : mode === "production" ? "PRODUCTION" : "SANDBOX — Bitnob test (aucun fonds réel sans validation)";
  const bg = isDemo ? "#b45309" : mode === "production" ? "#dc2626" : "#0e7490";
  return <div style={{ background: bg, color: "#fff", textAlign: "center", padding: "7px 12px", fontSize: 12, fontWeight: 800, letterSpacing: 0.4 }}>{label}</div>;
}
function Nav() {
  return (
    <div className="container" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
      <Link to="/" style={{ fontWeight: 900, letterSpacing: 0.5 }}>SENTABAKH LITE</Link>
      <div style={{ display: "flex", gap: 10 }}>
        <Link className="pill" to="/">Commandes</Link>
        <Link className="pill" to="/new">Nouvelle commande</Link>
        <Link className="pill" to="/health">Santé</Link>
      </div>
    </div>
  );
}

function Home() {
  const [orders, setOrders] = React.useState<Array<Record<string, unknown>>>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    try {
      const j = await api<{ data: Array<Record<string, unknown>> }>("/api/orders");
      setOrders(j.data);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);
  return (
    <div className="container grid">
      <div className="card">
        <h2 style={{ margin: "0 0 6px" }}>Commandes</h2>
        <p className="muted small">Flux : paiement Lightning → financement → livraison → versement XOF. Les lignes marquées DEMO sont simulées.</p>
        {err && <p style={{ color: "crimson" }}>{err}</p>}
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Description</th>
              <th>Montant</th>
              <th>Statut</th>
              <th>Mode</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id as string}>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{(o.id as string).slice(0, 10)}…</td>
                <td>{o.description as string}</td>
                <td>{(o.amount_sats as number).toLocaleString("fr-FR")} sats</td>
                <td><span className="badge">{STATUS_LABEL[o.status as string] ?? (o.status as string)}</span></td>
                <td>{(o.demo_mode as number) ? <span className="badge badge-demo">DEMO</span> : <span className="badge">SANDBOX</span>}</td>
                <td><Link className="btn" to={`/orders/${o.id}`}>Ouvrir</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 && <p className="muted">Aucune commande. Créez-en une.</p>}
      </div>
      <div className="card small muted">Astuce démo 3 min : Nouvelle commande → Ouvrir → Générer facture (DEMO) → Confirmer paiement (DEMO) → Déposer preuve → Confirmer réception → Cotation XOF → Init versement → Confirmer versement (DEMO).</div>
    </div>
  );
}

function NewOrder() {
  const nav = useNavigate();
  const [form, setForm] = React.useState({ amountSats: 50000, description: "Commande riz 25kg — Dakar", sellerLabel: "Mareyeus Aliou", beneficiaryName: "Aminata Diallo", beneficiaryPhoneHint: "77XXXXXXX", demoMode: true });
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const j = await api<{ id: string }>("/api/orders", { method: "POST", body: JSON.stringify({ ...form, amountSats: Number(form.amountSats) }) });
      nav(`/orders/${j.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 640 }}>
        <h2>Nouvelle commande</h2>
        <form onSubmit={submit} className="grid">
          <label>Montant (sats, 1 BTC = 100M sats)<input className="input" type="number" value={form.amountSats} onChange={(e) => setForm({ ...form, amountSats: Number(e.target.value) })} min={1000} max={100_000_000} required /></label>
          <label>Description<input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required /></label>
          <label>Vendeur<input className="input" value={form.sellerLabel} onChange={(e) => setForm({ ...form, sellerLabel: e.target.value })} required /></label>
          <label>Bénéficiaire<input className="input" value={form.beneficiaryName} onChange={(e) => setForm({ ...form, beneficiaryName: e.target.value })} required /></label>
          <label>Téléphone (indice)<input className="input" value={form.beneficiaryPhoneHint} onChange={(e) => setForm({ ...form, beneficiaryPhoneHint: e.target.value })} placeholder="77XXXXXXX" /></label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={form.demoMode} onChange={(e) => setForm({ ...form, demoMode: e.target.checked })} /> Mode démonstration (recommandé sans clés Bitnob)</label>
          {err && <p style={{ color: "crimson" }}>{err}</p>}
          <button className="btn btn-primary" disabled={loading}>{loading ? "Création…" : "Créer la commande"}</button>
        </form>
      </div>
    </div>
  );
}

function OrderDetail() {
  const { id } = useParams();
  const [data, setData] = React.useState<Record<string, unknown> | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [proofNote, setProofNote] = React.useState("Colis remis au point relais — photo à l'appui (démo)");
  const [benef, setBenef] = React.useState({ destination_type: "mobile_money" as const, country: "SN", account_name: "Aminata Diallo", account_number: "771234567", network: "WAVE" });
  const [quoteId, setQuoteId] = React.useState<string>("");

  const load = React.useCallback(async () => {
    try {
      const j = await api<Record<string, unknown>>(`/api/orders/${id}`);
      setData(j);
      const pq = (j.payoutQuotes as Array<Record<string, unknown>> | undefined)?.[0];
      if (pq) setQuoteId(pq.id as string);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [id]);
  React.useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  if (err) return <div className="container"><p style={{ color: "crimson" }}>{err}</p><Link to="/">Retour</Link></div>;
  if (!data) return <div className="container">Chargement…</div>;
  const order = data.order as Record<string, unknown>;
  const isDemo = (order.demo_mode as number) === 1;
  const status = order.status as string;
  const invoices = (data.invoices as Array<Record<string, unknown>>) ?? [];
  const proofs = (data.proofs as Array<Record<string, unknown>>) ?? [];
  const pQuotes = (data.payoutQuotes as Array<Record<string, unknown>>) ?? [];
  const payouts = (data.payouts as Array<Record<string, unknown>>) ?? [];
  const transitions = (data.transitions as Array<Record<string, unknown>>) ?? [];
  const lastInvoice = invoices[0];

  const call = async (path: string, body?: unknown) => {
    setErr(null);
    try {
      await api(path, body ? { method: "POST", body: JSON.stringify(body) } : { method: "POST" });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="container grid">
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>{order.description as string}</h2>
          <span className="badge">{STATUS_LABEL[status] ?? status}</span>
        </div>
        <p className="muted small">ID {order.id as string} · {(order.amount_sats as number).toLocaleString("fr-FR")} sats ({satsToBtc(order.amount_sats as number)} BTC) · vendeur {order.seller_label as string} · bénéficiaire {order.beneficiary_name as string}</p>
        {isDemo && <p className="badge badge-demo">DEMONSTRATION — AUCUN FONDS REEL — toutes les étapes ci-dessous sont simulées</p>}
        {!isDemo && <p className="badge">SANDBOX — factures et versements réels en test (si Bitnob configuré)</p>}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>Paiement Lightning</h3>
          {lastInvoice ? (
            <div className="grid">
              <p className="small muted">Réf {(lastInvoice.reference as string).slice(0, 12)}… · statut <b>{lastInvoice.status as string}</b> {String(lastInvoice.status).includes("demo") && <span className="badge badge-demo">DEMO</span>}</p>
              <div style={{ background: "#f8fafc", padding: 10, borderRadius: 10, wordBreak: "break-all", fontFamily: "monospace", fontSize: 11 }}>{lastInvoice.bolt11 as string}</div>
              <p className="small muted">Expire : {new Date(lastInvoice.expires_at as string).toLocaleString("fr-FR")}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={() => call(`/api/orders/${id}/check-payment`)} disabled={!!String(lastInvoice.status).includes("demo")}>Vérifier paiement (réel)</button>
                {isDemo && (
                  <button className="btn btn-demo" onClick={() => call(`/api/orders/${id}/demo/confirm-payment`)} disabled={status !== "awaiting_payment" && status !== "created"}>
                    Simuler paiement confirmé (DEMO)
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={() => call(`/api/orders/${id}/invoice`)}>Générer facture Lightning</button>
          )}
        </div>
        <div className="card">
          <h3>Livraison & réception</h3>
          {status === "funded" && (
            <div className="grid">
              <textarea className="input" value={proofNote} onChange={(e) => setProofNote(e.target.value)} rows={3} />
              <button className="btn btn-primary" onClick={() => call(`/api/orders/${id}/proof`, { note: proofNote })}>Déposer preuve de livraison</button>
            </div>
          )}
          {status === "delivery_declared" && <button className="btn btn-primary" onClick={() => call(`/api/orders/${id}/confirm-delivery`)}>Confirmer réception (bénéficiaire)</button>}
          {proofs.length > 0 && (
            <ul className="small">
              {proofs.map((p) => (
                <li key={p.id as string}>{p.note as string} — {new Date(p.created_at as string).toLocaleString("fr-FR")}</li>
              ))}
            </ul>
          )}
          {status !== "funded" && status !== "delivery_declared" && proofs.length === 0 && <p className="muted small">Disponible après financement.</p>}
        </div>
      </div>

      <div className="card">
        <h3>Versement XOF</h3>
        {status === "delivery_confirmed" && <button className="btn btn-primary" onClick={() => call(`/api/orders/${id}/payout/quote`, { toCurrency: "XOF", country: "SN", fromAsset: "USDT" })}>Demander cotation XOF</button>}
        {pQuotes.length > 0 && (
          <table className="table">
            <thead><tr><th>Cotation</th><th>Statut</th><th>Détail</th></tr></thead>
            <tbody>
              {pQuotes.map((q) => (
                <tr key={q.id as string}>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{(q.id as string).slice(0, 10)}…</td>
                  <td>{q.status as string} {String(q.status).includes("demo") && <span className="badge badge-demo">DEMO</span>}</td>
                  <td className="small">{q.raw_json ? (() => { try { const j = JSON.parse(q.raw_json as string); return j.estimatedXof ? `${j.estimatedXof.toLocaleString("fr-FR")} XOF estimé (frais ~${j.feesDemo?.toLocaleString("fr-FR")} XOF)` : j.label ?? ""; } catch { return String(q.raw_json).slice(0, 80); } })() : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pQuotes.length > 0 && status === "delivery_confirmed" && (
          <div className="grid" style={{ marginTop: 12 }}>
            <div className="grid grid-2">
              <label>Nom bénéficiaire<input className="input" value={benef.account_name} onChange={(e) => setBenef({ ...benef, account_name: e.target.value })} /></label>
              <label>Numéro / compte<input className="input" value={benef.account_number} onChange={(e) => setBenef({ ...benef, account_number: e.target.value })} /></label>
            </div>
            <div className="grid grid-2">
              <label>Type<select value={benef.destination_type} onChange={(e) => setBenef({ ...benef, destination_type: e.target.value as never })}><option value="mobile_money">Mobile money</option><option value="bank">Banque</option></select></label>
              <label>Réseau (Wave/Orange)<input className="input" value={benef.network} onChange={(e) => setBenef({ ...benef, network: e.target.value })} /></label>
            </div>
            <label>Cotation à utiliser<select className="input" value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>{pQuotes.map((q) => <option key={q.id as string} value={q.id as string}>{q.id as string} — {q.status as string}</option>)}</select></label>
            <button className="btn btn-primary" onClick={() => call(`/api/orders/${id}/payout/initialize`, { quoteId, beneficiary: { ...benef, country: "SN" } })}>Initialiser versement</button>
          </div>
        )}
        {payouts.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <h4>Versements</h4>
            <table className="table">
              <thead><tr><th>ID</th><th>Statut</th><th>Réf</th></tr></thead>
              <tbody>{payouts.map((p) => <tr key={p.id as string}><td style={{ fontFamily: "monospace", fontSize: 11 }}>{(p.id as string).slice(0, 10)}…</td><td>{p.status as string} {String(p.status).includes("demo") && <span className="badge badge-demo">DEMO</span>}</td><td style={{ fontFamily: "monospace", fontSize: 11 }}>{p.reference as string}</td></tr>)}</tbody>
            </table>
            {isDemo && (status === "payout_pending" || status === "payout_processing") && <button className="btn btn-demo" onClick={() => call(`/api/orders/${id}/demo/confirm-payout`)} style={{ marginTop: 8 }}>Simuler versement terminé (DEMO)</button>}
            {status === "payout_completed" && <p className="badge badge-ok">Versement marqué terminé {isDemo ? "(DEMO)" : "(réel — confirmé par Bitnob/webhook)"}</p>}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Historique</h3>
        <table className="table">
          <thead><tr><th>Date</th><th>Transition</th><th>Acteur</th></tr></thead>
          <tbody>{transitions.map((t) => <tr key={t.id as string}><td className="small">{new Date(t.created_at as string).toLocaleString("fr-FR")}</td><td className="small">{t.from_status as string} → {t.to_status as string}</td><td className="small">{t.actor as string}</td></tr>)}</tbody>
        </table>
        {transitions.length === 0 && <p className="muted small">Aucune transition.</p>}
      </div>

      {err && <p style={{ color: "crimson" }}>{err}</p>}
      <Link to="/">← Retour aux commandes</Link>
    </div>
  );
}

function Health() {
  const [data, setData] = React.useState<Record<string, unknown> | null>(null);
  React.useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}/api/preflight`).then((r) => r.json()).then(setData).catch(() => setData({ error: "API non joignable" }));
  }, []);
  return (
    <div className="container card">
      <h2>Santé / Preflight</h2>
      <pre style={{ background: "#f1f5f9", padding: 16, borderRadius: 10, overflow: "auto", fontSize: 12 }}>{JSON.stringify(data, null, 2)}</pre>
      <p className="small muted">Lecture seule (GET /api/whoami, /api/balances, etc.) — aucun mouvement de fonds.</p>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <TopBadge />
      <Nav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewOrder />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/health" element={<Health />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
