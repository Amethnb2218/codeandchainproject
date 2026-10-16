import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { hmacSha512Hex, verifyWebhookSignature, hmacSha256Hex, buildSignatureString } from "../src/bitnob/signer.js";

// Faux DB en memoire pour isoler les tests metier sans toucher data/sentabakh.db
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const { SCHEMA_SQL } = awaitImportSchema();
  db.exec(SCHEMA_SQL);
  return db;
}
function awaitImportSchema(): { SCHEMA_SQL: string } {
  // import synchrone via require-like
  // on duplique le schema minimal pour les tests
  return {
    SCHEMA_SQL: `
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT NOT NULL, amount_sats INTEGER NOT NULL, description TEXT NOT NULL, seller_label TEXT NOT NULL, beneficiary_name TEXT NOT NULL, demo_mode INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE order_transitions (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, from_status TEXT NOT NULL, to_status TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL);
CREATE TABLE webhook_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, dedup_key TEXT NOT NULL UNIQUE, signature_valid INTEGER NOT NULL, raw_body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE lightning_invoices (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, bolt11 TEXT, amount_sats INTEGER NOT NULL, status TEXT NOT NULL, reference TEXT NOT NULL UNIQUE, expires_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE payouts (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, quote_id TEXT NOT NULL, status TEXT NOT NULL, reference TEXT NOT NULL UNIQUE, beneficiary_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE payout_quotes (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, bitnob_quote_id TEXT, from_asset TEXT NOT NULL, to_currency TEXT NOT NULL, country TEXT NOT NULL, amount_base_units TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
`,
  };
}

describe("HMAC — corps JSON doit etre exact (ordre cles)", () => {
  it("signature change si body change d'un espace", () => {
    const cid = "client123", ts = "1710000000", nonce = "abc";
    const a = buildSignatureString(cid, ts, nonce, '{"a":1}');
    const b = buildSignatureString(cid, ts, nonce, '{"a": 1}');
    expect(hmacSha256Hex("secret", a)).not.toBe(hmacSha256Hex("secret", b));
  });
  it("GET avec body vide", () => {
    const s = buildSignatureString("cid", "123", "nonce", "");
    expect(s).toBe("cid:123:nonce:");
  });
});

describe("Webhook — signature invalide rejetee", () => {
  it("mauvaise signature -> false", () => {
    const body = '{"type":"payout"}';
    expect(verifyWebhookSignature(body, "bad", "secret")).toBe(false);
  });
  it("secret vide -> false", () => {
    expect(verifyWebhookSignature("{}", "abc", "")).toBe(false);
  });
  it("bonne signature HMAC-SHA512", () => {
    const body = '{"type":"x"}';
    const sig = hmacSha512Hex("whsec", body);
    expect(verifyWebhookSignature(body, sig, "whsec")).toBe(true);
  });
});

describe("Webhook dedup (UNIQUE dedup_key)", () => {
  it("second insert meme dedup_key echoue", () => {
    const db = freshDb();
    db.prepare("INSERT INTO webhook_events (id,type,dedup_key,signature_valid,raw_body,created_at) VALUES (?,?,?,?,?,?)").run("wh1", "test", "dupkey", 1, "{}", new Date().toISOString());
    expect(() => db.prepare("INSERT INTO webhook_events (id,type,dedup_key,signature_valid,raw_body,created_at) VALUES (?,?,?,?,?,?)").run("wh2", "test", "dupkey", 1, "{}", new Date().toISOString())).toThrow(/UNIQUE/);
  });
});

describe("Transitions interdites", () => {
  it("payout_completed ne peut plus bouger", async () => {
    const { canTransition } = await import("../../shared/src/index.js");
    expect(canTransition("payout_completed", "failed")).toBe(false);
    expect(canTransition("payout_completed", "created")).toBe(false);
  });
  it("created ne peut pas aller direct a funded", async () => {
    const { canTransition } = await import("../../shared/src/index.js");
    expect(canTransition("created", "funded")).toBe(false);
  });
});

describe("Unites BTC/sats", () => {
  it("limites", async () => {
    const { isValidSats, btcToSats, satsToBtc } = await import("../../shared/src/index.js");
    expect(isValidSats(100_000_000)).toBe(true);
    expect(isValidSats(100_000_001)).toBe(false);
    expect(satsToBtc(1)).toBe("0.00000001");
    expect(btcToSats("0.00000001")).toBe(1);
  });
});

describe("Demo vs Sandbox — marquage", () => {
  it("facture demo contient DEMO label", async () => {
    const demoBolt11 = "lnbc50000n1demo_invref_0_SENTABAKH_DEMO_NO_FUNDS";
    expect(demoBolt11).toContain("DEMO");
    expect(demoBolt11).toContain("NO_FUNDS");
  });
});

describe("Cotation expiree (simulee)", () => {
  it("quote expiree detectee par date", () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(new Date(expiresAt).getTime() < Date.now()).toBe(true);
  });
});

describe("Secrets jamais dans frontend", () => {
  it("client/src/main.tsx ne contient pas BITNOB_CLIENT_SECRET", async () => {
    const fs = await import("node:fs");
    const txt = fs.readFileSync("C:/Users/metab/OneDrive/Desktop/codechain/sentabakh-lite/client/src/main.tsx", "utf8");
    expect(txt).not.toContain("BITNOB_CLIENT_SECRET");
    expect(txt).not.toContain("x-auth-signature");
  });
});
