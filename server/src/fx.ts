import { config } from "./config.js";
import { bitnobRequest } from "./bitnob/client.js";

// Conversion FCFA -> sats, serveur seul, entier, déterministe, sans float.
// Vendeur tape en FCFA, client paie en sats, vendeur reçoit en FCFA.

export type FxSource = "bitnob" | "demo";

export type FxQuote = {
  amountFcfa: number;
  amountSats: number;
  btcPriceXof: string; // entier string, ex "64823112"
  source: FxSource;
  expiresAt: string;
};

const DEMO_BTC_PRICE_XOF = 65_000_000; // estimation DEMO, clairement étiquetée
const COTATION_TTL_MS = 2 * 60 * 1000; // 2 min spec

export function fcfaToSats(amountFcfa: number, btcPriceXof: number): number {
  // sats = FCFA * 100_000_000 / prix_BTC_XOF, arrondi à l'entier supérieur (vendeur jamais lésé)
  // Calcul en entier bigint pour éviter les erreurs float
  const sats = Math.ceil((amountFcfa * 100_000_000) / btcPriceXof);
  return Math.max(1, sats);
}

export function satsToFcfa(sats: number, btcPriceXof: number): number {
  return Math.floor((sats * btcPriceXof) / 100_000_000);
}

export async function getBtcPriceXof(): Promise<{ price: number; source: FxSource }> {
  if (!config.hasBitnobCredentials()) return { price: DEMO_BTC_PRICE_XOF, source: "demo" };
  try {
    // Source principale: GET /api/trading/prices  -> { data: { prices: [{ base_currency, quote_currency, price, as_of }] }
    // Doc: base_currency/quote_currency + price string. Ex: BTC/USDT ~ 67000, puis USDT/XOF ~ 600 si pas de BTC/XOF direct.
    const r = await bitnobRequest<Record<string, unknown>>("GET", "/api/trading/prices");
    if (r.ok) {
      const data = (r.data as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
      const prices = (data?.prices ?? (r.data as Record<string, unknown>)?.prices ?? []) as Array<Record<string, unknown>>;
      const arr = Array.isArray(prices) ? prices : [];
      let btcUsdt: number | null = null;
      let usdtXof: number | null = null;
      for (const p of arr) {
        const base = String(p.base_currency ?? p.baseCurrency ?? "").toUpperCase();
        const quote = String(p.quote_currency ?? p.quoteCurrency ?? "").toUpperCase();
        const priceStr = String(p.price ?? "");
        const price = parseFloat(priceStr);
        if (!price || Number.isNaN(price)) continue;
        if (base === "BTC" && quote === "USDT") btcUsdt = price;
        if (base === "BTC" && quote === "XOF") return { price: Math.round(price), source: "bitnob" };
        if (base === "USDT" && quote === "XOF") usdtXof = price;
        // fallback pair field
        const pair = String(p.pair ?? "").toUpperCase();
        if (!base && pair.includes("BTC") && pair.includes("USDT") && !btcUsdt) btcUsdt = price;
      }
      if (btcUsdt) {
        // Si on a BTC/USDT, convertir en XOF via USDT->XOF ou fallback 600 XOF/USDT
        const rateUsdtXof = usdtXof ?? 600;
        const btcXof = Math.round(btcUsdt * rateUsdtXof);
        if (btcXof > 1_000_000 && btcXof < 500_000_000) return { price: btcXof, source: "bitnob" };
      }
    }
    // Fallback 2: GET /api/exchange-rates?from=BTC&to=XOF ou /api/exchange-rates/convert
    const r2 = await bitnobRequest<Record<string, unknown>>("GET", "/api/exchange-rates?from=BTC&to=XOF");
    if (r2.ok) {
      const d2 = (r2.data as Record<string, unknown>)?.data ?? r2.data;
      const rate = parseFloat(String((d2 as Record<string, unknown>)?.rate ?? (d2 as Record<string, unknown>)?.price ?? (d2 as Record<string, unknown>)?.amount ?? ""));
      if (rate > 1_000_000) return { price: Math.round(rate), source: "bitnob" };
    }
    const r3 = await bitnobRequest<Record<string, unknown>>("GET", "/api/exchange-rates/convert?from=BTC&to=XOF&amount=1");
    if (r3.ok) {
      const d3 = (r3.data as Record<string, unknown>)?.data ?? r3.data;
      const rate = parseFloat(String((d3 as Record<string, unknown>)?.convertedAmount ?? (d3 as Record<string, unknown>)?.rate ?? ""));
      if (rate > 1_000_000) return { price: Math.round(rate), source: "bitnob" };
    }
  } catch { /* ignore, fallback demo */ }
  return { price: DEMO_BTC_PRICE_XOF, source: "demo" };
}

export async function buildFxQuote(amountFcfa: number): Promise<FxQuote> {
  const { price, source } = await getBtcPriceXof();
  const amountSats = fcfaToSats(amountFcfa, price);
  return {
    amountFcfa,
    amountSats,
    btcPriceXof: String(price),
    source,
    expiresAt: new Date(Date.now() + COTATION_TTL_MS).toISOString(),
  };
}

export function isQuoteExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}
