import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";

function Badge() {
  const mode = import.meta.env.VITE_APP_MODE ?? "sandbox";
  const label = mode === "demo" ? "DEMONSTRATION — AUCUN FONDS REEL" : mode === "production" ? "PRODUCTION" : "SANDBOX";
  const color = mode === "demo" ? "#b45309" : mode === "production" ? "#dc2626" : "#0e7490";
  return <div style={{ background: color, color: "white", textAlign: "center", padding: "6px 12px", fontSize: 12, fontWeight: 700, letterSpacing: 0.5 }}>{label}</div>;
}

function Home() {
  return (
    <div style={{ maxWidth: 720, margin: "32px auto", padding: "0 16px", fontFamily: "system-ui" }}>
      <h1>SENTABAKH LITE</h1>
      <p>Code &amp; Chain Dakar 2026 — Paiement Lightning → commande → livraison → versement XOF.</p>
      <p style={{ background: "#fef3c7", padding: 12, borderRadius: 8, border: "1px solid #fcd34d" }}>
        Phase A (pre-hackathon) : environnement pret, documentation Bitnob analysee, squelette technique operationnel.
        Les fonctionnalites metier finales seront construites pendant le hackathon (17–18 octobre 2026).
      </p>
      <ul>
        <li>
          <Link to="/health">Health / Preflight</Link>
        </li>
      </ul>
      <p style={{ color: "#6b7280", fontSize: 13 }}>
        API: {import.meta.env.VITE_API_URL ?? "http://localhost:4000"} — Mode: {import.meta.env.VITE_APP_MODE ?? "sandbox"}
      </p>
    </div>
  );
}

function Health() {
  const [data, setData] = React.useState<unknown>(null);
  React.useEffect(() => {
    fetch("/api/preflight").then((r) => r.json()).then(setData).catch(() => setData({ error: "API non joignable" }));
  }, []);
  return (
    <div style={{ maxWidth: 720, margin: "32px auto", padding: "0 16px", fontFamily: "monospace", fontSize: 13 }}>
      <Link to="/">← Accueil</Link>
      <h2>Preflight</h2>
      <pre style={{ background: "#f3f4f6", padding: 16, borderRadius: 8, overflow: "auto" }}>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Badge />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/health" element={<Health />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
