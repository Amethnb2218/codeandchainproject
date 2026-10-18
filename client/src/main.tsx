import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link, NavLink, useParams, useNavigate } from "react-router-dom";
import "./styles.css";
import { api, satsToBtc } from "./lib/api";

/* ---------- constants ---------- */
const STATUS_LABEL: Record<string, string> = {
  created: "Créée",
  awaiting_payment: "En attente de paiement",
  payment_confirmed: "Paiement confirmé",
  conversion_pending: "Conversion en cours",
  funded: "Fonds séquestrés — argent bloqué", // Flux B: vendeur voit "Tu peux envoyer le livreur"
  delivery_declared: "Livraison déclarée",
  delivery_confirmed: "Réception confirmée — CODE vérifié = débloqué",
  payout_pending: "Versement en attente",
  payout_processing: "Versement en cours",
  payout_completed: "Versement terminé — ✅ REÇUS / Vérifié = débloqué",
  failed: "Échouée",
  expired: "Expirée",
  disputed: "Litige",
};

const STATUS_TONE: Record<string, string> = {
  created: "badge",
  awaiting_payment: "badge badge-warn",
  payment_confirmed: "badge badge-ok",
  conversion_pending: "badge badge-warn",
  funded: "badge badge-ok",
  delivery_declared: "badge badge-warn",
  delivery_confirmed: "badge badge-ok",
  payout_pending: "badge badge-warn",
  payout_processing: "badge badge-warn",
  payout_completed: "badge badge-ok",
  failed: "badge",
  expired: "badge",
  disputed: "badge",
};

function formatDateFR(iso: string) {
  try { return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}

/* ---------- icons ---------- */
function IcoBolt(p:{className?:string}){return <svg className={p.className??"icon"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M13 2L4 13h6l-1 9 10-13h-6l0-6z"/></svg>}
function IcoTruck(p:{className?:string}){return <svg className={p.className??"icon"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-5a1 1 0 0 0-.6-.9l-3-1.5A1 1 0 0 0 17 9h-2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>}
function IcoWallet(p:{className?:string}){return <svg className={p.className??"icon"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 14a2 2 0 0 0 2-2v-0a2 2 0 0 0-2-2h-2"/><path d="M2 10h20"/></svg>}
function IcoCheck(p:{className?:string}){return <svg className={p.className??"icon"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 13l4 4L19 7"/></svg>}
function IcoCopy(p:{className?:string}){return <svg className={p.className??"icon"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>}
function IcoPlus(p:{className?:string}){return <svg className={p.className??"icon"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>}
function IcoSearch(p:{className?:string}){return <svg className={p.className??"icon"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20L16.5 16.5"/></svg>}
function IcoShield(p:{className?:string}){return <svg className={p.className??"icon"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l7 3v5c0 4-2.8 7-7 8-4.2-1-7-4-7-8V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>}
function IcoArrow(p:{className?:string}){return <svg className={p.className??"icon"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>}

/* ---------- wordmark ---------- */
function SymbolMark(){
  return (
    <div className="wordmark-mark" aria-hidden>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
        <path d="M6.5 16.5L12 5l5.5 11.5-5.5 2.2L6.5 16.5z" fill="currentColor" opacity=".96"/>
        <path d="M9.2 14.3l2.8-6 2.8 6-2.8 1.1-2.8-1.1z" fill="var(--paper)" opacity=".95"/>
        <path d="M12 8.2v7.2" stroke="var(--forest)" strokeWidth="1.1" opacity=".35"/>
      </svg>
    </div>
  );
}

/* ---------- Top band ---------- */
function TopBand(){
  const mode = (import.meta.env.VITE_APP_MODE as string | undefined) ?? "sandbox";
  const isDemo = mode === "demo";
  const isProd = mode === "production";
  const cls = isDemo ? "topband topband-demo" : isProd ? "topband topband-prod" : "topband topband-sandbox";
  const label = isDemo ? "DÉMONSTRATION — AUCUN FONDS RÉEL" : isProd ? "PRODUCTION — FONDS RÉELS" : "SANDBOX — Bitnob test · aucun fonds réel sans validation";
  return <div className={cls}><IcoShield /> <span>{label}</span> {!isDemo && !isProd && <span style={{opacity:.9}}>· factures & versements simulés marqués DEMO</span>}</div>;
}

function SiteHeader(){
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link to="/" className="wordmark" aria-label="SENTABAKH LITE — accueil">
          <SymbolMark />
          <div className="wordmark-wordmark">
            <div className="wordmark-title">SENTABAKH LITE</div>
            <div className="wordmark-sub">Lightning → livraison → XOF · Dakar 2026</div>
          </div>
        </Link>
        <nav className="nav" aria-label="Navigation principale">
          <NavLink to="/" end>Commandes</NavLink>
          <NavLink to="/new" className="nav-cta">Recevoir</NavLink>
          <NavLink to="/health">Santé</NavLink>
        </nav>
      </div>
    </header>
  );
}

function Footer(){
  return (
    <footer className="site-footer">
      <span>© 2026 Sentabakh Lite · Code & Chain Dakar — Produit de démonstration. Aucun fonds réel sans clés Bitnob.</span>
      <span className="mono" style={{opacity:.7}}>api.bitnob.com · node:sqlite · HMAC-SHA256/512</span>
    </footer>
  );
}

/* ---------- Home ---------- */
function Home(){
  const [orders, setOrders] = React.useState<Array<Record<string, unknown>>>([]);
  const [q, setQ] = React.useState("");
  const [statusF, setStatusF] = React.useState("all");
  const [modeF, setModeF] = React.useState("all");
  const [err, setErr] = React.useState<string|null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async ()=>{
    setLoading(true); setErr(null);
    try{ const j = await api<{data:Array<Record<string,unknown>>}>("/api/orders"); setOrders(j.data);}catch(e){ setErr((e as Error).message);} finally{ setLoading(false);}
  },[]);
  React.useEffect(()=>{ load();},[load]);

  const filtered = orders.filter(o=>{
    if(statusF!=="all" && o.status!==statusF) return false;
    if(modeF==="demo" && (o.demo_mode as number)!==1) return false;
    if(modeF==="sandbox" && (o.demo_mode as number)===1) return false;
    if(q){
      const hay = `${o.id} ${o.description} ${o.beneficiary_name} ${o.seller_label}`.toLowerCase();
      if(!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const kpiTotal = orders.length;
  const kpiDemo = orders.filter(o=>(o.demo_mode as number)===1).length;
  const kpiPending = orders.filter(o=>String(o.status)==="awaiting_payment").length;
  const kpiDone = orders.filter(o=>String(o.status)==="payout_completed").length;

  return (
    <div className="page">
      <div className="hero">
        <div>
          <div className="eyebrow">Produit fintech · commerce de proximité au Sénégal</div>
          <h1 className="hero-title">Encaissez en Bitcoin Lightning.<br/>Livrez. Versez en XOF.</h1>
          <p className="hero-lead">Sentabakh Lite relie le paiement Lightning, la preuve de livraison et le versement mobile money/bancaire via Bitnob — avec un parcours démo de bout en bout, traçable et réversible, sans mélanger simulation et réel.</p>
          <div className="hero-actions">
            <Link to="/new" className="btn btn-coral"><IcoPlus/> Recevoir</Link>
            <Link to="/health" className="btn btn-ghost"><IcoShield/> Vérifier l’intégration</Link>
          </div>
          <div className="notice" style={{marginTop:12}}>
            <strong style={{color:"var(--forest)"}}>Flux métier :</strong> paiement → financement → livraison → réception → versement. Les opérations DEMO sont orange, marquées <span className="badge badge-demo" style={{verticalAlign:"middle"}}>DEMO</span> et portent <span className="mono">…DEMO_NO_FUNDS</span>.
          </div>
        </div>
        <div className="kpi-grid">
          <div className="kpi"><div className="kpi-lbl">Commandes</div><div className="kpi-val">{kpiTotal}</div><div className="kpi-hint">historique persistant SQLite</div></div>
          <div className="kpi"><div className="kpi-lbl">Versements terminés</div><div className="kpi-val">{kpiDone}</div><div className="kpi-hint">DEMO ou confirmés Bitnob</div></div>
          <div className="kpi"><div className="kpi-lbl">En attente de paiement</div><div className="kpi-val">{kpiPending}</div><div className="kpi-hint">facture à régler</div></div>
          <div className="kpi"><div className="kpi-lbl">Opérations DEMO</div><div className="kpi-val">{kpiDemo}</div><div className="kpi-hint">simulées, traçables</div></div>
          <div className="panel panel-pad" style={{gridColumn:"1 / -1"}}>
            <div className="section-title"><IcoShield/> Garde-fous actifs</div>
            <div style={{fontSize:12, color:"var(--ink-60)", lineHeight:1.6}}>Transitions vérifiées côté serveur · anti double-facture/double-versement (409) · webhook HMAC-SHA512 + déduplication · montants en sats/BTC validés · secrets jamais exposés au frontend.</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-pad">
          <div style={{display:"flex", justifyContent:"space-between", gap:12, flexWrap:"wrap", alignItems:"end"}}>
            <div>
              <div className="section-title">Commandes <span className="mono" style={{fontWeight:500, color:"var(--ink-40)"}}>· {filtered.length} / {orders.length}</span></div>
              <div style={{fontSize:12, color:"var(--ink-60)"}}>Recherchez par référence, description ou bénéficiaire. Filtrez par statut et mode.</div>
            </div>
            <Link to="/new" className="btn btn-primary btn-sm"><IcoPlus/> Créer</Link>
          </div>
          <div className="filters" style={{marginTop:12}}>
            <label className="field" style={{flex:"1 1 260px"}}>
              <span className="field-label" style={{display:"flex", gap:6, alignItems:"center"}}><IcoSearch/> Recherche</span>
              <input className="input" placeholder="Réf, riz, Aminata…" value={q} onChange={e=>setQ(e.target.value)} aria-label="Rechercher une commande"/>
            </label>
            <label className="field"><span className="field-label">Statut</span>
              <select value={statusF} onChange={e=>setStatusF(e.target.value)}>
                <option value="all">Tous</option>
                <option value="awaiting_payment">En attente de paiement</option>
                <option value="funded">Financée</option>
                <option value="delivery_declared">Livraison déclarée</option>
                <option value="delivery_confirmed">Réception confirmée</option>
                <option value="payout_processing">Versement en cours</option>
                <option value="payout_completed">Versement terminé</option>
              </select>
            </label>
            <label className="field"><span className="field-label">Mode</span>
              <select value={modeF} onChange={e=>setModeF(e.target.value)}>
                <option value="all">Tous</option>
                <option value="demo">DEMO uniquement</option>
                <option value="sandbox">SANDBOX uniquement</option>
              </select>
            </label>
          </div>
        </div>

        {loading ? <div className="panel-pad notice">Chargement…</div> : err ? <div className="panel-pad error">{err} — <button className="btn btn-sm" onClick={load}>Réessayer</button></div> : filtered.length===0 ? (
          <div className="panel-pad notice notice-strong" style={{display:"grid", gap:10}}>
            <div style={{fontWeight:700, color:"var(--forest)"}}>{orders.length===0 ? "Aucune commande pour l’instant" : "Aucun résultat"}</div>
            <div style={{fontSize:13, color:"var(--ink-60)"}}>{orders.length===0 ? "Créez votre première commande pour lancer le parcours démo de 3 minutes." : "Essayez une autre recherche ou effacez les filtres."}</div>
            {orders.length===0 && <div><Link to="/new" className="btn btn-coral"><IcoPlus/> Recevoir</Link></div>}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Réf</th><th>Objet</th><th>Bénéficiaire</th><th>Montant</th><th>Statut</th><th>Date</th><th>Mode</th><th></th></tr></thead>
              <tbody>
                {filtered.map(o=>(
                  <tr key={o.id as string}>
                    <td className="thin" style={{maxWidth:140}}><span className="mono truncate" title={o.id as string}>{(o.id as string).slice(0,14)}…</span></td>
                    <td style={{minWidth:180}}><div style={{fontWeight:650, color:"var(--forest)"}}>{o.description as string}</div><div className="mono" style={{fontSize:11, color:"var(--ink-40)"}}>{o.seller_label as string}</div></td>
                    <td>{o.beneficiary_name as string}<div className="mono" style={{fontSize:11, color:"var(--ink-40)"}}>{(o.beneficiary_phone_hint as string)??"—"}</div></td>
                    <td className="amount">{(o.amount_sats as number).toLocaleString("fr-FR")} <span style={{fontWeight:500, color:"var(--ink-40)"}}>sats</span><div className="mono" style={{fontSize:11, color:"var(--ink-40)"}}>{satsToBtc(o.amount_sats as number)} BTC</div></td>
                    <td><span className={STATUS_TONE[o.status as string] ?? "badge"}><span className="dot"/>{STATUS_LABEL[o.status as string] ?? (o.status as string)}</span></td>
                    <td className="thin" style={{whiteSpace:"nowrap"}}>{formatDateFR(o.created_at as string)}</td>
                    <td>{(o.demo_mode as number) ? <span className="badge badge-demo">DEMO</span> : <span className="badge">SANDBOX</span>}</td>
                    <td><Link className="btn btn-sm" to={`/orders/${o.id}`}>Ouvrir <IcoArrow/></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- New order ---------- */
function NewOrder(){
  const nav = useNavigate();
  const [amountFcfa, setAmountFcfa] = React.useState(10000);
  const [result, setResult] = React.useState<null | {id:string; amountFcfa:number; payUrl:string; invoice?:{bolt11:string}}>(null);
  const [err, setErr] = React.useState<string|null>(null);
  const [loading, setLoading] = React.useState(false);
  const [fixedCopied, setFixedCopied] = React.useState(false);
  const [copied, setCopied] = React.useState<string|null>(null);

  const estSats = Math.max(1, Math.ceil((Number(amountFcfa)||0) * 100_000_000 / 65_000_000));
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const fixedLink = `${origin}/pay/aliou`;

  const recevoir = async (e?:React.FormEvent)=>{
    if(e) e.preventDefault();
    if(!amountFcfa || amountFcfa<500){ setErr("Minimum 500 FCFA"); return; }
    if(amountFcfa>10_000_000){ setErr("Maximum 10 000 000 FCFA"); return; }
    setErr(null); setLoading(true);
    try{
      // Toujours flow link (supporte QR physique + lien distance), séquestre + CODE géré côté détail si livraison
      const j = await api<{id:string}>(`/api/orders`, { method:"POST", body: JSON.stringify({
        amountFcfa: Number(amountFcfa),
        description: "Paiement",
        sellerLabel: "Vendeur",
        beneficiaryName: "Vendeur",
        demoMode: true,
        flow: "link",
      })});
      let inv: {bolt11:string} | undefined;
      try{ const r = await api<{demo?:boolean; invoice:{bolt11:string}}>(`/api/orders/${j.id}/invoice`, {method:"POST"}); inv = r.invoice; }catch(ex){ setErr(`Commande créée (${j.id}) mais facture: ${(ex as Error).message}`); }
      const payUrl = `${origin}/orders/${j.id}`;
      setResult({id: j.id, amountFcfa: Number(amountFcfa), payUrl, invoice: inv});
      if(inv?.bolt11) setCopied(null);
    }catch(ex){ setErr((ex as Error).message);} finally{ setLoading(false);}
  };

  // Même facture Lightning pour QR ET lien — pas de choix, les deux d'un coup
  const bolt11 = result?.invoice?.bolt11 ?? "";
  // QR fiable sans dépendance externe bloquée: on utilise qrserver + fallback texte copiable
  const qrSrc = bolt11 ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(bolt11)}` : null;

  const copy = async (t:string, k:string)=>{
    try{ await navigator.clipboard.writeText(t); if(k==="fixed"){ setFixedCopied(true); setTimeout(()=>setFixedCopied(false),1500);} else { setCopied(k); setTimeout(()=>setCopied(null),1500);} }catch{ void 0; }
  };

  return (
    <div className="page" style={{maxWidth:980}}>
      <div className="crumbs" style={{marginBottom:12}}><Link to="/">← Commandes</Link><span aria-hidden>·</span><span>Recevoir</span></div>

      <div className="panel panel-pad" style={{background:"var(--forest)", color:"var(--ivory)", borderColor:"rgba(245,241,232,.12)", marginBottom:14}}>
        <div style={{display:"flex", justifyContent:"space-between", gap:16, flexWrap:"wrap", alignItems:"center"}}>
          <div>
            <div className="eyebrow" style={{color:"var(--sage)"}}>Vendeur — encaissement instantané</div>
            <div style={{fontWeight:700, fontSize:18, marginTop:4}}>Ton lien fixe — à mettre sur Insta / bio / story</div>
            <div style={{fontSize:12, opacity:.8, marginTop:4}}>Un seul lien · le client tape le montant lui-même · se renouvelle auto (nouvelle facture à chaque paiement)</div>
          </div>
          <div style={{display:"flex", gap:8, alignItems:"center", background:"rgba(255,255,255,.08)", padding:"8px 10px", borderRadius:10, border:"1px solid rgba(255,255,255,.15)"}}>
            <span className="mono" style={{fontSize:12, maxWidth:240, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{fixedLink}</span>
            <button className="btn btn-sm" style={{background:"var(--ivory)", color:"var(--forest)"}} onClick={()=>copy(fixedLink,"fixed")}>{fixedCopied ? "Copié ✓" : "Copier lien"}</button>
          </div>
        </div>
      </div>

      <div className="new-grid" style={{display:"grid", gridTemplateColumns: result ? "1fr 1fr" : "1.15fr .85fr", gap:18}}>
        <form onSubmit={recevoir} className="panel panel-pad" style={{display:"grid", gap:14, alignContent:"start"}}>
          <div>
            <div className="eyebrow">En 1 geste</div>
            <h1 className="brand" style={{margin:"6px 0 6px", fontSize:26, color:"var(--forest)", letterSpacing:"-0.03em"}}>Recevoir</h1>
            <p style={{margin:0, color:"var(--ink-60)", fontSize:13}}>Tape le montant en <strong>FCFA</strong> → <strong>Recevoir</strong>. Tu obtiens <strong>automatiquement QR + lien</strong> (même facture Lightning) : QR pour le client en face, lien pour le client à distance.</p>
          </div>

          <label className="field">
            <span className="field-label" style={{fontSize:14, fontWeight:700}}>Montant (FCFA) *</span>
            <input className="input" type="number" value={amountFcfa} onChange={e=>setAmountFcfa(Number(e.target.value))} min={500} max={10_000_000} required autoFocus inputMode="numeric" style={{fontSize:22, fontWeight:700, height:52, letterSpacing:"-0.02em"}} placeholder="10 000"/>
            <span className="field-hint" style={{fontSize:12}}><strong>{Number(amountFcfa).toLocaleString("fr-FR")} FCFA</strong> ≈ {estSats.toLocaleString("fr-FR")} sats · taux Bitnob verrouillé 2 min (serveur)</span>
            <span style={{display:"flex", gap:6, marginTop:8, flexWrap:"wrap"}}>
              {[5000,10000,25000,50000].map(v=> <button key={v} type="button" className="btn btn-sm" style={{background: amountFcfa===v ? "var(--forest)":undefined, color: amountFcfa===v ? "var(--ivory)":undefined}} onClick={()=>setAmountFcfa(v)}>{v.toLocaleString("fr-FR")} FCFA</button>)}
            </span>
          </label>

          {err && <div className="error">{err}</div>}

          <button className="btn btn-coral" disabled={loading} style={{justifyContent:"center", height:50, fontSize:16, fontWeight:800}}>
            {loading ? "Génération…" : "Recevoir — QR + Lien"} <IcoArrow/>
          </button>

          <div style={{fontSize:11, color:"var(--ink-40)"}}>Même facture Lightning pour QR et lien · pas de choix à faire · VENDEUR seul (CLIENT/LIVREUR sans compte)</div>
        </form>

        <div style={{display:"grid", gap:12, alignContent:"start"}}>
          {!result ? (
            <div className="panel panel-pad" style={{borderStyle:"dashed"}}>
              <div className="eyebrow">Aperçu instantané</div>
              <div style={{fontWeight:700, color:"var(--forest)", marginTop:6}}>Tape un montant puis <em>Recevoir</em></div>
              <div style={{marginTop:10, display:"grid", placeItems:"center", border:"1px dashed var(--line)", borderRadius:12, padding:22, background:"#FFFDF7"}}>
                <div style={{width:160, height:160, border:"2px dashed var(--line)", borderRadius:12, display:"grid", placeItems:"center", color:"var(--ink-40)", fontSize:12}}>QR apparaîtra ici</div>
                <div className="mono" style={{marginTop:10, fontSize:11, color:"var(--ink-40)"}}>lien apparaîtra ici</div>
              </div>
              <div className="notice" style={{marginTop:10, fontSize:12}}>Après clic : QR Lightning scannable + lien <span className="mono">/orders/…</span> copiable (WhatsApp / Insta). Client paie → tu vois <strong>REÇU</strong> en temps réel.</div>
            </div>
          ) : (
            <>
              <div className="panel panel-pad" style={{borderColor:"var(--ok)", background:"#EAF6EC"}}>
                <div className="section-title" style={{color:"var(--ok)"}}><IcoCheck/> Prêt à encaisser — {result.amountFcfa.toLocaleString("fr-FR")} FCFA</div>
                <div className="section-rule"/>
                <div style={{display:"grid", gap:10}}>
                  <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12}}>
                    <div style={{display:"grid", placeItems:"center", background:"#fff", borderRadius:12, padding:10, border:"1px solid var(--line)"}}>
                      {qrSrc ? <img src={qrSrc} alt="QR Lightning" width={220} height={220} style={{borderRadius:8}} onError={(e)=>{ (e.target as HTMLImageElement).style.display="none"; }}/> : null}
                      {!qrSrc && <div className="mono" style={{fontSize:11, wordBreak:"break-all", padding:8, textAlign:"center"}}>{bolt11 ? bolt11.slice(0,48)+"…" : "Facture en génération…"}</div>}
                      <div className="mono" style={{marginTop:6, fontSize:11, wordBreak:"break-all", background:"#FFF1E6", padding:"6px 8px", borderRadius:8, width:"100%", textAlign:"center"}}>{bolt11 ? bolt11.slice(0,36)+"…"+bolt11.slice(-8) : "—"}</div>
                      <button type="button" className="btn btn-sm" style={{marginTop:6}} onClick={()=>copy(bolt11,"bolt11")}>{copied==="bolt11" ? "Copié ✓" : <><IcoCopy/> Copier code</>}</button>
                      <div style={{fontSize:11, color:"var(--forest)", fontWeight:700, marginTop:6}}>QR — pour paiement physique (scan en boutique)</div>
                    </div>
                    <div style={{display:"grid", gap:8, alignContent:"start"}}>
                      <label className="field"><span className="field-label" style={{fontWeight:700, color:"var(--forest)"}}>Lien — pour paiement à distance</span>
                        <input className="input mono" value={result.payUrl} readOnly style={{fontSize:12}}/>
                        <div style={{display:"flex", gap:6, marginTop:6}}>
                          <button type="button" className="btn btn-sm" style={{flex:1, justifyContent:"center"}} onClick={()=>copy(result.payUrl,"payUrl")}>{copied==="payUrl" ? "Copié ✓" : <><IcoCopy/> Copier lien</>}</button>
                          <a className="btn btn-sm" style={{flex:1, justifyContent:"center"}} href={result.payUrl} target="_blank" rel="noreferrer">Ouvrir</a>
                        </div>
                        <span className="field-hint">WhatsApp / Insta / SMS — même facture que le QR, le client paie à distance</span>
                      </label>
                      <div className="notice" style={{fontSize:11}}>Même facture Lightning pour QR et lien. Client en face → scan QR. Client loin → ouvre le lien.</div>
                      <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
                        <button type="button" className="btn btn-sm" onClick={()=>nav(`/orders/${result.id}`)}>Voir la commande →</button>
                        <button type="button" className="btn btn-sm" onClick={()=>{ setResult(null); setAmountFcfa(10000); }}>Nouveau montant</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="panel panel-pad">
                <div className="section-title">Lien fixe Insta — comment ça marche</div>
                <div style={{fontSize:12, color:"var(--ink-60)", lineHeight:1.7}}>
                  Ton <span className="mono">{fixedLink}</span> est un lien vitrine. Le client choisit son montant et paie → ça crée une commande auto. Tu n’as rien à retaper. Il se renouvelle à chaque paiement (nouvelle facture, pas de réutilisation).
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <style>{`@media(max-width:900px){.new-grid{grid-template-columns:1fr!important}}`}</style>
    </div>
  );
}

/* ---------- Stepper ---------- */
type Step = {key:string; label:string; sub:string};
const STEPS: Step[] = [
  {key:"pay", label:"Paiement", sub:"Lightning"},
  {key:"fund", label:"Financement", sub:"BTC → USDT"},
  {key:"deliver", label:"Livraison", sub:"Preuve"},
  {key:"receive", label:"Réception", sub:"Confirmation"},
  {key:"payout", label:"Versement", sub:"XOF"},
];
function stepState(status:string, idx:number){
  const rank:Record<string,number>={ created:0, awaiting_payment:0, payment_confirmed:1, conversion_pending:1, funded:2, delivery_declared:3, delivery_confirmed:4, payout_pending:4, payout_processing:4, payout_completed:5, failed: -1, expired:-1, disputed:-1 };
  const r = rank[status] ?? 0;
  const thresholds = [0,1,2,3,4]; // step idx done when r > threshold
  const done = r > thresholds[idx] || (status==="payout_completed" && idx<=4);
  const active = r===thresholds[idx] && status!=="payout_completed" && r!==-1;
  // funded means pay+fund done
  if(status==="funded" && idx<2) return {done:true, active:false};
  if(status==="funded" && idx===2) return {done:false, active:true};
  if(status==="payment_confirmed" && idx===0) return {done:true, active:false};
  if(status==="payment_confirmed" && idx===1) return {done:false, active:true};
  return {done, active};
}

/* ---------- Order detail (PRIORITÉ) ---------- */
function OrderDetail(){
  const {id} = useParams();
  const [data, setData] = React.useState<Record<string,unknown>|null>(null);
  const [err, setErr] = React.useState<string|null>(null);
  const [proofNote, setProofNote] = React.useState("Colis remis au point relais — photo à l'appui (démo)");
  const [benef, setBenef] = React.useState({ destination_type:"mobile_money" as const, country:"SN", account_name:"Aminata Diallo", account_number:"771234567", network:"WAVE" });
  const [quoteId, setQuoteId] = React.useState("");
  const [copied, setCopied] = React.useState<string|null>(null);
  const [showTech, setShowTech] = React.useState(false);

  const load = React.useCallback(async ()=>{
    try{
      const j = await api<Record<string,unknown>>(`/api/orders/${id}`);
      setData(j);
      const pq = (j.payoutQuotes as Array<Record<string,unknown>>|undefined)?.[0];
      if(pq) setQuoteId(pq.id as string);
    }catch(e){ setErr((e as Error).message); }
  },[id]);

  React.useEffect(()=>{ load(); const t=setInterval(load, 4000); return ()=>clearInterval(t);},[load]);

  const copy = async (text:string, key:string)=>{
    try{ await navigator.clipboard.writeText(text); setCopied(key); setTimeout(()=>setCopied(null), 1600);}catch{ /* clipboard indisponible */ void 0; }
  };

  if(err) return <div className="page"><div className="error">{err}</div><Link to="/" className="btn" style={{marginTop:12}}>← Retour</Link></div>;
  if(!data) return <div className="page"><div className="notice">Chargement…</div></div>;
  const order = data.order as Record<string,unknown>;
  const isDemo = (order.demo_mode as number)===1;
  const status = order.status as string;
  const invoices = (data.invoices as Array<Record<string,unknown>>) ?? [];
  const proofs = (data.proofs as Array<Record<string,unknown>>) ?? [];
  const pQuotes = (data.payoutQuotes as Array<Record<string,unknown>>) ?? [];
  const payouts = (data.payouts as Array<Record<string,unknown>>) ?? [];
  const transitions = (data.transitions as Array<Record<string,unknown>>) ?? [];
  const lastInvoice = invoices[0];
  const isTerminal = ["payout_completed","failed","expired"].includes(status);

  const call = async (path:string, body?:unknown)=>{
    setErr(null);
    try{ await api(path, body?{method:"POST", body:JSON.stringify(body)}:{method:"POST"}); await load();}
    catch(e){ setErr((e as Error).message); }
  };

  // primary action panel content
  let primary: {kicker:string; title:string; desc:string; actions: React.ReactNode} | null = null;
  if(!lastInvoice){
    primary = { kicker:"Étape 1 · Paiement", title:"Générer la facture Lightning", desc: isDemo ? "Facture de démonstration — chaîne DEMO_NO_FUNDS, statut pending_demo. Aucun fonds déplacé." : "Facture réelle via Bitnob (POST /api/lightning/invoices). Nécessite BITNOB_CLIENT_ID/SECRET.", actions: <button className="btn btn-coral" onClick={()=>call(`/api/orders/${id}/invoice`)}><IcoBolt/> Générer facture Lightning</button> };
  } else if(status==="awaiting_payment" || status==="created"){
    primary = { kicker:"Étape 1 · Paiement en attente", title: isDemo ? "Confirmer le paiement (DEMO)" : "Vérifier le paiement réel", desc: isDemo ? "Simule l’arrivée du paiement Lightning et finance la commande (paid_demo → funded). Action réservée aux commandes demo." : "Interroge Bitnob (GET /api/lightning/invoices/:id). Reste en attente si non payé.", actions: (
      <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
        <button className="btn" disabled={!!String(lastInvoice.status).includes("demo")} onClick={()=>call(`/api/orders/${id}/check-payment`)}><IcoShield/> Vérifier paiement (réel)</button>
        {isDemo && <button className="btn btn-coral" onClick={()=>call(`/api/orders/${id}/demo/confirm-payment`)} disabled={status!=="awaiting_payment" && status!=="created"}><IcoCheck/> Simuler paiement confirmé (DEMO)</button>}
      </div>
    )};
  } else if(status==="funded"){
    const flow = String((order as Record<string,unknown>).flow ?? (order as Record<string,unknown>).type ?? "delivery");
    const isQr = flow === "qr";
    primary = { kicker: isQr ? "Flux A · Boutique — ✅ REÇUS" : "Flux B · FONDS SÉQUESTRÉS — argent bloqué", title: isQr ? "10 000 FCFA REÇUS — Fin (pas de code)" : "Fonds séquestrés — Tu peux envoyer le livreur", desc: isQr ? "Flux A boutique (10 s) : paiement sur place validé. Passez direct au versement XOF (sans CODE). Transition funded → payout_pending." : "Flux B livraison : argent bloqué côté serveur. Livreur hors-plateforme en route. La cliente cliquera J'ai bien reçu → CODE 6 chiffres (2min/3 essais, persisté).", actions: (
      <div style={{display:"grid", gap:10}}>
        {isQr && <div className="notice notice-strong" style={{borderColor:"var(--ok)", background:"#EAF6EC"}}>✅ Fin Flux A — pas de CODE. Le payout XOF peut être lancé ci-dessous (bouton « Passer au versement »).</div>}
        {!isQr && <div className="notice" style={{borderColor:"#f97316", background:"#FFF1E6", color:"#7c2d12"}}><strong>FONDS SÉQUESTRÉS</strong> — argent bloqué. Le vendeur voit : « Tu peux envoyer le livreur ».</div>}
        {isQr ? <button className="btn btn-coral" onClick={async()=>{ setErr(null); try{ await api(`/api/orders/${id}/payout/quote`, {method:"POST", body: JSON.stringify({toCurrency:"XOF", country:"SN", fromAsset:"USDT"})}); await load(); }catch(e){ setErr((e as Error).message);} }}><IcoWallet/> Passer au versement XOF (Flux A)</button> : <><textarea className="input" value={proofNote} onChange={e=>setProofNote(e.target.value)} rows={3} aria-label="Note de preuve (Flux B)"/><button className="btn btn-coral" onClick={()=>call(`/api/orders/${id}/proof`, {note: proofNote})}><IcoTruck/> Déposer preuve — livreur en route (hors-plateforme)</button></>}
      </div>
    )};
  } else if(status==="delivery_declared"){
    primary = { kicker:"Étape 4 · Livreur arrivé → J'ai bien reçu → CODE", title:"Livreur hors-plateforme arrivé — cliente clique J'ai bien reçu", desc:"Flux B: la cliente (sans compte) clique sur son lien → génère CODE 6 chiffres (2min/3 essais, persisté). Puis vendeur saisit le CODE (Mes Ventes) → Vérifié = débloqué.", actions: (
      <div style={{display:"grid", gap:10}}>
        <button className="btn btn-coral" onClick={()=>call(`/api/orders/${id}/confirm-delivery`)}><IcoCheck/> Confirmer réception</button>
        <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
          <button className="btn" onClick={async()=>{ setErr(null); try{ const j=await api<{code:string;display:string;message:string;expiresAt:string}>(`/api/orders/${id}/delivery-code`, {method:"POST"}); setErr(`${j.message} — expire ${new Date(j.expiresAt).toLocaleTimeString("fr-FR")} · 3 essais`); await load(); }catch(e){ setErr((e as Error).message);} }}><IcoShield/> Générer CODE (J'ai bien reçu)</button>
          <button className="btn" onClick={async()=>{ setErr(null); try{ const j=await api<{code:string;display:string;message:string}>(`/api/orders/${id}/delivery-code`); if(j.code) setErr(`${j.message} (persisté — même code au refresh)`); else setErr(j.message ?? "Aucun CODE"); }catch(e){ setErr((e as Error).message);} }}>Relire CODE (refresh → même code)</button>
        </div>
        <div style={{display:"flex", gap:8, alignItems:"end", flexWrap:"wrap"}}>
          <label className="field" style={{flex:"1 1 160px"}}><span className="field-label">CODE 6 chiffres — Vendeur saisit</span><input className="input mono" id="verify-code-input" placeholder="482917" maxLength={6} style={{letterSpacing:".18em", fontWeight:700}}/></label>
          <button className="btn btn-coral" onClick={async()=>{ const el=document.getElementById("verify-code-input") as HTMLInputElement|null; const code=el?.value ?? ""; setErr(null); try{ const j=await api<{message:string}>(`/api/orders/${id}/delivery-code/verify`, {method:"POST", body: JSON.stringify({code})}); setErr(j.message); await load(); }catch(e){ setErr((e as Error).message);} }}><IcoCheck/> Vérifier CODE</button>
        </div>
      </div>
    ) };
  } else if(status==="delivery_confirmed"){
    const hasQuote = pQuotes.length>0;
    primary = { kicker:"Étape 5 · Versement — ✅ Vérifié = Argent débloqué", title: hasQuote ? "Initialiser le versement XOF (débloqué)" : "Demander une cotation XOF", desc: hasQuote ? "CODE vérifié → argent débloqué. Choisissez la cotation et le bénéficiaire (mobile money / banque). Anti double-versement (409)." : "CODE vérifié → versement disponible. Cotation estimée DEMO (sats × 600 ≈ XOF) ou réelle via Bitnob.", actions: hasQuote ? (
      <div style={{display:"grid", gap:10}}>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}}>
          <label className="field"><span className="field-label">Nom bénéficiaire</span><input className="input" value={benef.account_name} onChange={e=>setBenef({...benef, account_name:e.target.value})}/></label>
          <label className="field"><span className="field-label">Numéro / compte</span><input className="input" value={benef.account_number} onChange={e=>setBenef({...benef, account_number:e.target.value})}/></label>
        </div>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}}>
          <label className="field"><span className="field-label">Type</span><select value={benef.destination_type} onChange={e=>setBenef({...benef, destination_type:e.target.value as never})}><option value="mobile_money">Mobile money</option><option value="bank">Banque</option></select></label>
          <label className="field"><span className="field-label">Réseau</span><input className="input" value={benef.network} onChange={e=>setBenef({...benef, network:e.target.value})} placeholder="WAVE, Orange…"/></label>
        </div>
        <label className="field"><span className="field-label">Cotation à utiliser</span>
          <select className="input mono" value={quoteId} onChange={e=>setQuoteId(e.target.value)}>{pQuotes.map(q=> <option key={q.id as string} value={q.id as string}>{q.id as string} — {q.status as string}</option>)}</select>
        </label>
        <button className="btn btn-coral" onClick={()=>call(`/api/orders/${id}/payout/initialize`, {quoteId, beneficiary:{...benef, country:"SN"}})}><IcoWallet/> Initialiser versement</button>
      </div>
    ) : <button className="btn btn-coral" onClick={()=>call(`/api/orders/${id}/payout/quote`, {toCurrency:"XOF", country:"SN", fromAsset:"USDT"})}><IcoWallet/> Demander cotation XOF</button> };
  } else if(status==="payout_pending" || status==="payout_processing"){
    primary = { kicker:"Étape 5 · Versement en cours", title: status==="payout_pending" ? "Versement en attente" : "Versement en cours d’exécution", desc: isDemo ? "En DEMO, confirmez la finalisation pour passer à payout_completed (anti double-versement conservé)." : "En réel, l’état est mis à jour par Bitnob/webhook (HMAC-SHA512). Ne répétez pas la demande si incertain.", actions: isDemo ? <button className="btn btn-coral" onClick={()=>call(`/api/orders/${id}/demo/confirm-payout`)}><IcoCheck/> Simuler versement terminé (DEMO)</button> : <span className="notice">En attente de confirmation externe.</span> };
  } else if(isTerminal){
    primary = null;
  }

  const estimatedFor = (q:Record<string,unknown>)=>{
    try{ const j=JSON.parse(q.raw_json as string); if(j.estimatedXof) return `${j.estimatedXof.toLocaleString("fr-FR")} XOF estimé · frais ~${j.feesDemo?.toLocaleString("fr-FR")} XOF`; if(j.label) return j.label; return ""; }catch{ return String(q.raw_json??"").slice(0,80); }
  };

  return (
    <div className="page">
      <div className="crumbs"><Link to="/">← Commandes</Link><span aria-hidden>·</span><span className="mono">{order.id as string}</span></div>

      <div className="detail-grid" style={{marginTop:12}}>
        <div className="detail-main">
          <div className="panel panel-pad order-head">
            <div className="order-title-row">
              <h1 className="order-title">{order.description as string}</h1>
              <span className={STATUS_TONE[status] ?? "badge"}><span className="dot"/>{STATUS_LABEL[status] ?? status}</span>
              {isDemo ? <span className="badge badge-demo">DEMO — AUCUN FONDS RÉEL</span> : <span className="badge">SANDBOX — test réel</span>}
            </div>
            <div className="meta-row">
              <span className="ref mono" title={order.id as string}>Réf { (order.id as string).slice(0,16) }…</span>
              <span><strong>{(order.amount_sats as number).toLocaleString("fr-FR")} sats</strong> <span className="mono" style={{color:"var(--ink-40)"}}>· {satsToBtc(order.amount_sats as number)} BTC</span></span>
              <span>· vendeur <strong>{order.seller_label as string}</strong></span>
              <span>· bénéficiaire <strong>{order.beneficiary_name as string}</strong></span>
              <button className="btn btn-sm" onClick={()=>copy(order.id as string, "ref")}><IcoCopy/> {copied==="ref" ? "Copié" : "Copier réf"}</button>
            </div>
            {isDemo && <div className="notice" style={{borderColor:"#FFC9A8", background:"#FFF1E6", color:"#7c2d12"}}><strong>DÉMONSTRATION — AUCUN FONDS RÉEL</strong> — factures, cotations et versements de cette commande sont simulés, marqués DEMO en base et dans les logs.</div>}
            <div className="stepper" role="list" aria-label="Progression">
              {STEPS.map((s, i)=>{
                const st = stepState(status, i);
                return (
                  <div key={s.key} className={`step ${st.done ? "done" : ""} ${st.active ? "active" : ""}`} role="listitem" aria-current={st.active ? "step" : undefined}>
                    <div className="step-dot">{st.done ? <IcoCheck/> : st.active ? <span style={{width:8,height:8,borderRadius:8,background:"#fff",display:"block"}}/> : <span style={{width:6,height:6,borderRadius:6,background:"var(--ink-40)",display:"block"}}/>}</div>
                    <div className="step-lbl">{s.label}</div>
                    <div className="step-sub">{s.sub}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {primary && (
            <div className="action-panel">
              <div className="action-kicker">{primary.kicker}</div>
              <div className="action-title">{primary.title}</div>
              <div className="action-desc">{primary.desc}</div>
              {primary.actions}
              {err && <div className="error" style={{marginTop:10}}>{err}</div>}
            </div>
          )}
          {!primary && err && <div className="error">{err}</div>}
          {isTerminal && status==="payout_completed" && (
            <div className="panel panel-pad" style={{borderColor:"var(--sage)", background:"#EAF6EC"}}>
              <div className="section-title" style={{color:"var(--ok)"}}><IcoCheck/> Parcours terminé</div>
              <div style={{fontSize:13, color:"var(--ink-60)"}}>Versement marqué terminé {isDemo ? "(DEMO — simulation)" : "(confirmé Bitnob/webhook)"} — historique complet ci-contre.</div>
            </div>
          )}

          <div className="panel panel-pad">
            <div className="section-title"><IcoBolt/> Paiement Lightning</div>
            <div className="section-rule"/>
            {lastInvoice ? (
              <div style={{display:"grid", gap:12}}>
                <div style={{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center"}}>
                  <span className="mono" style={{fontSize:11, color:"var(--ink-40)"}}>Réf {(lastInvoice.reference as string).slice(0,12)}…</span>
                  <span className="badge mono" style={{fontSize:11}}>{lastInvoice.status as string}</span>
                  {String(lastInvoice.status).includes("demo") && <span className="badge badge-demo">DEMO</span>}
                  <span className="mono" style={{fontSize:11, color:"var(--ink-40)"}}>Expire : {formatDateFR(lastInvoice.expires_at as string)}</span>
                  <button className="btn btn-sm" onClick={()=>copy(lastInvoice.reference as string, "invref")}> {copied==="invref" ? "Copié" : <><IcoCopy/> Copier</>}</button>
                </div>
                <div className="invoice-box">
                  <div style={{display:"flex", justifyContent:"space-between", gap:8, alignItems:"center"}}>
                    <span className="mono" style={{fontSize:11, letterSpacing:".08em", opacity:.8}}>BOLT11 — tronqué visuellement, copiable intégralement</span>
                    <button className="btn btn-sm" style={{background:"rgba(255,255,255,.12)", color:"var(--ivory)", borderColor:"rgba(245,241,232,.18)"}} onClick={()=>copy(lastInvoice.bolt11 as string, "bolt11")}>{copied==="bolt11" ? "Copié !" : <><IcoCopy/> Copier</>}</button>
                  </div>
                  <div className="mono" style={{background:"rgba(0,0,0,.18)", padding:"10px 11px", borderRadius:10, border:"1px solid rgba(245,241,232,.12)"}}>
                    <span className="truncate" title={lastInvoice.bolt11 as string}>{lastInvoice.bolt11 as string}</span>
                  </div>
                  <div style={{display:"grid", gap:6}}>
                    <div className="kv"><span className="kv-k">Montant</span><span className="kv-v mono">{(order.amount_sats as number).toLocaleString("fr-FR")} sats · {satsToBtc(order.amount_sats as number)} BTC</span></div>
                    <div className="kv"><span className="kv-k">Statut</span><span className="kv-v">{String(lastInvoice.status).includes("demo") ? "En attente — simulation" : "En attente — vérifiable via Bitnob"}</span></div>
                  </div>
                </div>
                {status==="awaiting_payment" && (
                  <div className="notice">Astuce : en DEMO, le bouton <strong>Simuler paiement confirmé</strong> est dans le panneau d’action principal ci-dessus.</div>
                )}
              </div>
            ) : (
              <div className="notice">Aucune facture pour l’instant. L’action principale ci-dessus permet de la générer.</div>
            )}
          </div>

          <div className="panel panel-pad">
            <div className="section-title"><IcoTruck/> Livraison & réception</div>
            <div className="section-rule"/>
            {proofs.length>0 && (
              <ul style={{margin:0, paddingLeft:18, display:"grid", gap:8}}>
                {proofs.map(p=> <li key={p.id as string} style={{fontSize:13}}><strong>{p.note as string}</strong> <span className="mono" style={{fontSize:11, color:"var(--ink-40)"}}>· {formatDateFR(p.created_at as string)} · par {p.created_by as string}</span></li>)}
              </ul>
            )}
            {proofs.length===0 && status!=="funded" && status!=="delivery_declared" && <div className="notice">Disponible après financement. La preuve débloque la réception.</div>}
            {status==="funded" && proofs.length===0 && <div className="notice">Déposez la preuve via le panneau d’action principal — elle apparaîtra ici.</div>}
            {status==="delivery_declared" && <div className="notice">En attente de confirmation du bénéficiaire (bouton dans le panneau d’action).</div>}
            {status==="delivery_confirmed" && <div className="notice notice-strong">Réception confirmée — la cotation XOF peut être demandée.</div>}
          </div>

          <div className="panel panel-pad">
            <div className="section-title"><IcoWallet/> Versement XOF</div>
            <div className="section-rule"/>
            {pQuotes.length===0 && <div className="notice">Aucune cotation. Elle sera demandée après réception confirmée.</div>}
            {pQuotes.length>0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Cotation</th><th>Statut</th><th>Détail</th><th></th></tr></thead>
                  <tbody>
                    {pQuotes.map(q=>(
                      <tr key={q.id as string}>
                        <td className="mono thin">{(q.id as string).slice(0,14)}…</td>
                        <td><span className="badge mono" style={{fontSize:11}}>{q.status as string}</span> {String(q.status).includes("demo") && <span className="badge badge-demo">DEMO</span>}</td>
                        <td style={{fontSize:12, color:"var(--ink-60)"}}>{estimatedFor(q)}</td>
                        <td><button className="btn btn-sm" onClick={()=>copy(q.id as string, q.id as string)}>{copied===(q.id as string) ? "Copié" : <><IcoCopy/> Copier</>}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {payouts.length>0 && (
              <div style={{marginTop:12}}>
                <div className="section-title" style={{fontSize:13}}>Versements</div>
                <div className="table-wrap" style={{marginTop:8}}>
                  <table className="table">
                    <thead><tr><th>ID</th><th>Statut</th><th>Réf</th><th>Bénéficiaire</th></tr></thead>
                    <tbody>
                      {payouts.map(p=>{
                        const b = (p.beneficiary ?? {}) as Record<string,string>;
                        return (
                          <tr key={p.id as string}>
                            <td className="mono thin">{(p.id as string).slice(0,12)}…</td>
                            <td><span className="badge mono" style={{fontSize:11}}>{p.status as string}</span> {String(p.status).includes("demo") && <span className="badge badge-demo">DEMO</span>}</td>
                            <td className="mono thin">{p.reference as string}</td>
                            <td style={{fontSize:12}}>{b.account_name ?? "—"} <span className="mono" style={{fontSize:11, color:"var(--ink-40)"}}>{b.account_number ?? ""} {b.network ? `· ${b.network}` : ""}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {status==="payout_completed" && <div className="notice notice-strong" style={{marginTop:10, borderColor:"var(--sage)", background:"#EAF6EC"}}><strong>Versement marqué terminé {isDemo ? "(DEMO)" : "(réel)"}.</strong> Montants estimés clairement identifiés comme tels — non présentés comme exécutés avant confirmation.</div>}
          </div>
        </div>

        <div className="detail-side">
          <div className="panel panel-pad">
            <div className="section-title">Historique</div>
            <div className="section-rule"/>
            <div className="timeline">
              {transitions.map(t=>{
                const isDemoActor = String(t.actor)==="demo";
                return (
                  <div key={t.id as string} className={`tl-item ${isDemoActor ? "done" : ""}`}>
                    <div className="tl-date mono">{formatDateFR(t.created_at as string)}</div>
                    <div className="tl-title">{STATUS_LABEL[t.from_status as string] ?? t.from_status} → {STATUS_LABEL[t.to_status as string] ?? t.to_status} {isDemoActor && <span className="badge badge-demo" style={{marginLeft:6}}>DEMO</span>}</div>
                    <div className="tl-meta">Acteur : <span className="mono">{t.actor as string}</span> {t.reason ? `· ${t.reason as string}` : ""}</div>
                  </div>
                );
              })}
              {transitions.length===0 && <div className="notice">Aucune transition.</div>}
            </div>
          </div>

          <div className="panel panel-pad">
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <div className="section-title">Détails techniques</div>
              <button className="btn btn-sm" onClick={()=>setShowTech(v=>!v)}>{showTech ? "Masquer" : "Afficher"}</button>
            </div>
            <div className="section-rule"/>
            <div style={{display:"grid", gap:8, fontSize:12}}>
              <div className="kv" style={{gridTemplateColumns:"1fr"}}><span className="kv-k">Order ID</span><span className="mono thin" style={{color:"var(--ink)", wordBreak:"break-all"}}>{order.id as string}</span></div>
              <div className="kv" style={{gridTemplateColumns:"1fr 1fr"}}><span className="kv-k">Créée</span><span className="mono">{formatDateFR(order.created_at as string)}</span></div>
              <div className="kv" style={{gridTemplateColumns:"1fr 1fr"}}><span className="kv-k">Mise à jour</span><span className="mono">{formatDateFR(order.updated_at as string)}</span></div>
              <div className="kv" style={{gridTemplateColumns:"1fr 1fr"}}><span className="kv-k">Statut brut</span><span className="mono">{status}</span></div>
            </div>
            {showTech && (
              <div style={{marginTop:12, display:"grid", gap:10}}>
                {invoices.length>0 && <details open><summary className="field-label">Factures ({invoices.length})</summary><pre className="json" style={{marginTop:8, maxHeight:220}}>{JSON.stringify(invoices, null, 2)}</pre></details>}
                {pQuotes.length>0 && <details><summary className="field-label">Cotations ({pQuotes.length})</summary><pre className="json" style={{marginTop:8, maxHeight:220}}>{JSON.stringify(pQuotes, null, 2)}</pre></details>}
                {payouts.length>0 && <details><summary className="field-label">Payouts ({payouts.length})</summary><pre className="json" style={{marginTop:8, maxHeight:220}}>{JSON.stringify(payouts, null, 2)}</pre></details>}
                <details><summary className="field-label">Transitions brutes</summary><pre className="json" style={{marginTop:8, maxHeight:260}}>{JSON.stringify(transitions, null, 2)}</pre></details>
              </div>
            )}
          </div>

          <div className="panel panel-pad" style={{background:"rgba(185,216,189,.18)", borderColor:"var(--sage)"}}>
            <div className="section-title"><IcoShield/> Sécurité & traçabilité</div>
            <div style={{fontSize:12, color:"var(--ink-60)", lineHeight:1.6, marginTop:6}}>
              Backend seul autorisé à faire les transitions. Webhook HMAC-SHA512 sur corps brut + déduplication. Montants validés en <span className="mono">sats</span>. Aucun secret dans le frontend.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Pay (lien fixe vendeur — client) ---------- */
function PayPage(){
  const {slug} = useParams();
  const [amount, setAmount] = React.useState(10000);
  const [err, setErr] = React.useState<string|null>(null);
  const [loading, setLoading] = React.useState(false);
  const [invoice, setInvoice] = React.useState<{bolt11:string; payUrl?:string} | null>(null);
  const [orderId, setOrderId] = React.useState<string|null>(null);
  const [phase, setPhase] = React.useState<"input"|"invoice"|"paid">("input");
  const displaySlug = slug ?? "vendeur";
  const nice = displaySlug.charAt(0).toUpperCase()+displaySlug.slice(1);
  const estSats = Math.max(1, Math.ceil((Number(amount)||0) * 100_000_000 / 65_000_000));
  const qrSrc = invoice?.bolt11 ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(invoice.bolt11)}` : null;

  const payer = async (e:React.FormEvent)=>{
    e.preventDefault();
    if(!amount || amount<500){ setErr("Minimum 500 FCFA"); return; }
    if(amount>10_000_000){ setErr("Maximum 10 000 000 FCFA"); return; }
    setErr(null); setLoading(true);
    try{
      const j = await api<{id:string}>(`/api/orders`, {method:"POST", body: JSON.stringify({amountFcfa: Number(amount), description: `Paiement ${nice}`, sellerLabel: nice, beneficiaryName: nice, demoMode:true, flow:"qr"})});
      const r = await api<{invoice:{bolt11:string}}>(`/api/orders/${j.id}/invoice`, {method:"POST"});
      setOrderId(j.id); setInvoice(r.invoice); setPhase("invoice");
    }catch(ex){ setErr((ex as Error).message); } finally{ setLoading(false); }
  };

  // Poll: si payé → phase paid (DEMO: on peut simuler via bouton)
  React.useEffect(()=>{
    if(phase!=="invoice" || !orderId) return;
    const t = setInterval(async()=>{
      try{ const j = await api<Record<string,unknown>>(`/api/orders/${orderId}`); if(String((j.order as Record<string,unknown>).status)!=="awaiting_payment") setPhase("paid"); }catch{ void 0; }
    }, 2500);
    return ()=>clearInterval(t);
  },[phase, orderId]);

  return (
    <div className="page" style={{maxWidth:520, margin:"0 auto"}}>
      <div className="panel panel-pad" style={{textAlign:"center", background:"var(--forest)", color:"var(--ivory)", borderColor:"rgba(255,255,255,.12)"}}>
        <div style={{width:56, height:56, borderRadius:14, background:"var(--ivory)", color:"var(--forest)", display:"grid", placeItems:"center", margin:"0 auto"}}><IcoWallet/></div>
        <div style={{fontWeight:800, fontSize:20, marginTop:10}}>Payer {nice}</div>
        <div style={{opacity:.85, fontSize:12, marginTop:4}}>Sentabakh Lite · Lightning ⚡ · sans compte · 2 min</div>
      </div>

      {phase==="input" && (
        <form onSubmit={payer} className="panel panel-pad" style={{marginTop:14, display:"grid", gap:14}}>
          <div style={{textAlign:"center"}}>
            <div className="eyebrow">Client — choisis ton montant</div>
            <div style={{fontWeight:700, color:"var(--forest)", marginTop:4}}>Combien tu veux payer ?</div>
          </div>
          <label className="field">
            <span className="field-label" style={{fontWeight:700}}>Montant (FCFA)</span>
            <input type="number" className="input" value={amount} onChange={e=>setAmount(Number(e.target.value))} min={500} max={10_000_000} required autoFocus inputMode="numeric" style={{fontSize:24, fontWeight:800, height:54, textAlign:"center"}} placeholder="10 000"/>
            <span className="field-hint" style={{textAlign:"center", display:"block"}}>{Number(amount).toLocaleString("fr-FR")} FCFA ≈ {estSats.toLocaleString("fr-FR")} sats</span>
            <span style={{display:"flex", gap:6, justifyContent:"center", marginTop:8, flexWrap:"wrap"}}>
              {[1000,5000,10000,25000].map(v=> <button key={v} type="button" className="btn btn-sm" style={{background: amount===v ? "var(--forest)":undefined, color: amount===v?"var(--ivory)":undefined}} onClick={()=>setAmount(v)}>{v.toLocaleString("fr-FR")}</button>)}
            </span>
          </label>
          {err && <div className="error">{err}</div>}
          <button className="btn btn-coral" disabled={loading} style={{justifyContent:"center", height:50, fontSize:16, fontWeight:800}}>{loading?"Génération…":"Payer ⚡"} <IcoArrow/></button>
          <div style={{fontSize:11, color:"var(--ink-40)", textAlign:"center"}}>Facture Lightning instantanée · taux serveur verrouillé 2 min · pas de données perso requises</div>
        </form>
      )}

      {phase==="invoice" && invoice && (
        <div className="panel panel-pad" style={{marginTop:14, display:"grid", gap:12}}>
          <div style={{textAlign:"center"}}>
            <div className="badge" style={{background:"var(--ok)", color:"#fff"}}>⚡ Facture prête — {Number(amount).toLocaleString("fr-FR")} FCFA</div>
            <div style={{fontSize:11, color:"var(--ink-60)", marginTop:6}}>Scan QR ou copie le code Bolt11</div>
          </div>
          <div style={{display:"grid", placeItems:"center", background:"#fff", border:"1px solid var(--line)", borderRadius:12, padding:12}}>
            {qrSrc ? <img src={qrSrc} alt="QR Lightning" width={220} height={220} style={{borderRadius:8}}/> : <div className="mono" style={{fontSize:11, wordBreak:"break-all"}}>{invoice.bolt11}</div>}
          </div>
          <div className="mono" style={{fontSize:11, wordBreak:"break-all", background:"#FFF1E6", padding:8, borderRadius:8, border:"1px solid #FFC9A8"}}>{invoice.bolt11}</div>
          <div style={{display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap"}}>
            <button className="btn" onClick={async()=>{ try{ await navigator.clipboard.writeText(invoice.bolt11);}catch{ void 0; }}}><IcoCopy/> Copier code</button>
            {orderId && <button className="btn" onClick={async()=>{ try{ await api(`/api/orders/${orderId}/demo/confirm-payment`, {method:"POST"}); setPhase("paid"); }catch(ex){ setErr((ex as Error).message); }}}>Simuler paiement (DEMO)</button>}
          </div>
          <div className="notice" style={{fontSize:12, textAlign:"center"}}>Après paiement, le vendeur voit <strong>REÇU</strong> instantanément. Lien se renouvelle tout seul à chaque paiement (nouvelle facture).</div>
          <button className="btn btn-sm" style={{justifyContent:"center"}} onClick={()=>{ setPhase("input"); setInvoice(null); setOrderId(null); }}>← Nouveau paiement</button>
          {err && <div className="error">{err}</div>}
        </div>
      )}

      {phase==="paid" && (
        <div className="panel panel-pad" style={{marginTop:14, textAlign:"center", background:"#EAF6EC", borderColor:"var(--ok)"}}>
          <div style={{fontWeight:800, color:"var(--ok)", fontSize:18}}>✅ Paiement reçu !</div>
          <div style={{fontSize:13, color:"var(--ink-60)", marginTop:6}}>{Number(amount).toLocaleString("fr-FR")} FCFA · Merci — ton paiement est confirmé.</div>
          <button className="btn btn-coral" style={{marginTop:12, justifyContent:"center"}} onClick={()=>{ setPhase("input"); setInvoice(null); setOrderId(null); }}>Payer à nouveau</button>
        </div>
      )}
    </div>
  );
}

/* ---------- Health ---------- */
function Health(){
  const [data, setData] = React.useState<Record<string,unknown>|null>(null);
  const [err, setErr] = React.useState<string|null>(null);
  React.useEffect(()=>{
    fetch(`${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}/api/preflight`).then(r=>r.json()).then(setData).catch(()=> setErr("API non joignable"));
  },[]);
  const bitnob = (data as Record<string,unknown> | null)?.bitnob as Record<string,unknown> | undefined;
  const configured = Boolean(bitnob?.configured);
  return (
    <div className="page">
      <div className="eyebrow">Intégration & diagnostics</div>
      <h1 className="brand" style={{fontSize:26, color:"var(--forest)", margin:"6px 0 10px"}}>Santé / Preflight</h1>
      <p style={{color:"var(--ink-60)", maxWidth:60*12, fontSize:13}}>Lecture seule — aucun mouvement de fonds. Vérifie la connectivité et la présence des secrets côté serveur (jamais exposés au frontend).</p>

      <div className="health-grid" style={{marginTop:14}}>
        <div className={`health-card ${configured ? "health-ok" : "health-warn"}`}>
          <div className="section-title"><IcoShield/> Bitnob</div>
          <div style={{fontSize:13, color:"var(--ink-60)", marginTop:6}}>{configured ? "Configuré — appels réels possibles en sandbox" : "Non configuré — parcours en mode DEMO (simulé)"}</div>
          <div style={{display:"grid", gap:6, marginTop:12, fontSize:12}}>
            <div className="kv"><span className="kv-k">Base URL</span><span className="kv-v mono">{String((bitnob as Record<string,unknown>)?.baseUrl ?? "https://api.bitnob.com")}</span></div>
            <div className="kv"><span className="kv-k">Client ID présent</span><span className="kv-v">{String(bitnob?.clientIdPresent ?? "—")}</span></div>
            <div className="kv"><span className="kv-k">Webhook secret présent</span><span className="kv-v">{String(bitnob?.webhookSecretPresent ?? "—")}</span></div>
          </div>
          {!configured && <div className="notice" style={{marginTop:12}}>Renseignez <span className="mono">BITNOB_CLIENT_ID / SECRET / WEBHOOK_SECRET</span> dans <span className="mono">.env</span> (serveur) puis relancez <span className="mono">npm run preflight --workspace=server</span>.</div>}
        </div>
        <div className="health-card">
          <div className="section-title">Backend</div>
          <div style={{fontSize:13, color:"var(--ink-60)", marginTop:6}}>SQLite <span className="mono">node:sqlite</span> · Express · Zod · Vitest · HMAC</div>
          <div style={{marginTop:10, display:"flex", gap:8, flexWrap:"wrap"}}>
            <span className="badge mono">mode: {String((data as Record<string,unknown>)?.mode ?? "—")}</span>
            <span className="badge mono">node: {String((data as Record<string,unknown>)?.node ?? "—")}</span>
          </div>
          <div className="notice" style={{marginTop:12, fontSize:12}}>Endpoints vérifiés en lecture : <span className="mono">GET /health, /api/preflight, /api/orders, /api/bitnob/status</span> — 0 fonds déplacé.</div>
        </div>
      </div>

      <div className="panel panel-pad" style={{marginTop:14}}>
        <div className="section-title">Réponse brute <span className="mono" style={{fontWeight:500, color:"var(--ink-40)"}}>/api/preflight</span></div>
        <div className="section-rule"/>
        {err ? <div className="error">{err}</div> : <pre className="json">{JSON.stringify(data, null, 2)}</pre>}
        <div style={{fontSize:12, color:"var(--ink-60)", marginTop:8}}>Ne révèle aucune variable secrète. Les montants estimés restent identifiés comme tels.</div>
      </div>
    </div>
  );
}

function App(){
  return (
    <BrowserRouter>
      <TopBand/>
      <SiteHeader/>
      <Routes>
        <Route path="/" element={<Home/>}/>
        <Route path="/new" element={<NewOrder/>}/>
        <Route path="/pay" element={<PayPage/>}/>
        <Route path="/pay/:slug" element={<PayPage/>}/>
        <Route path="/orders/:id" element={<OrderDetail/>}/>
        <Route path="/health" element={<Health/>}/>
      </Routes>
      <Footer/>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(<App/>);
