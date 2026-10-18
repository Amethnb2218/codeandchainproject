// SENTABAKH LITE — Client Bitnob centralise (Phase A : socle, pas d'appels fonds)
import { config } from "../config.js";
import { signRequest, nowTimestampSec, randomNonceHexSync } from "./signer.js";

export type BitnobResult<T> = { ok: true; data: T; status: number } | { ok: false; error: string; status: number; raw?: string };

const BASE = config.bitnob.baseUrl;

function sanitizeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (k.toLowerCase().includes("signature") || k.toLowerCase().includes("secret")) out[k] = "***";
    else out[k] = v;
  }
  return out;
}

export async function bitnobRequest<T>(method: string, path: string, bodyObj?: unknown): Promise<BitnobResult<T>> {
  if (!config.hasBitnobCredentials()) {
    return { ok: false, error: config.bitnobCredentialHint(), status: 0 };
  }
  // Canonicalisation JSON compacte exigée par Bitnob (pas d'espaces superflus) — on utilise JSON.stringify tel quel
  const body = bodyObj !== undefined ? JSON.stringify(bodyObj) : "";
  const timestamp = nowTimestampSec();
  const nonce = randomNonceHexSync(16);
  const signature = signRequest({
    clientId: config.bitnob.clientId,
    clientSecret: config.bitnob.clientSecret,
    timestamp,
    nonce,
    body,
  });

  const headers: Record<string, string> = {
    "x-auth-client": config.bitnob.clientId,
    "x-auth-timestamp": timestamp,
    "x-auth-nonce": nonce,
    "x-auth-signature": signature,
    "Content-Type": "application/json",
  };

  const url = `${BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body || undefined,
    });
  } catch (e) {
    return { ok: false, error: `fetch error: ${(e as Error).message}`, status: 0 };
  }

  const raw = await res.text();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    return { ok: false, error: "Reponse JSON invalide", status: res.status, raw: raw.slice(0, 2000) };
  }

  if (!res.ok) {
    const detail = (json as { detail?: string; message?: string; error?: { message?: string } })?.detail
      ?? (json as { message?: string })?.message
      ?? (json as { error?: { message?: string } })?.error?.message
      ?? `HTTP ${res.status}`;
    console.error("[bitnob]", method, path, "->", res.status, sanitizeHeaders(headers), detail);
    return { ok: false, error: detail, status: res.status, raw: raw.slice(0, 2000) };
  }
  return { ok: true, data: json as T, status: res.status };
}

// Lecture sans mouvement de fonds (Phase A)
export function whoami() { return bitnobRequest<{ data: unknown }> ("GET", "/api/whoami"); }
export function getBalances() { return bitnobRequest<unknown>("GET", "/api/balances"); }
export function getBalance(currency: string) { return bitnobRequest<unknown>("GET", `/api/balances/${currency}`); }
export function getPayoutSupportedCountries() { return bitnobRequest<unknown>("GET", "/api/payouts/supported-countries"); }
export function getPayoutBanks(countryCode: string) { return bitnobRequest<unknown>("GET", `/api/payouts/banks/${countryCode}`); }
export function getPayoutLimits() { return bitnobRequest<unknown>("GET", "/api/payouts/limits"); }
export function getTradingPrices() { return bitnobRequest<unknown>("GET", "/api/trading/prices"); }
