import { describe, it, expect } from "vitest";
import { canTransition, satsToBtc, btcToSats, isValidSats, createOrderSchema } from "sentabakh-shared";
import { buildSignatureString, hmacSha256Hex, hmacSha512Hex, verifyWebhookSignature } from "../src/bitnob/signer.js";

describe("shared — transitions", () => {
  it("autorise created -> awaiting_payment", () => expect(canTransition("created", "awaiting_payment")).toBe(true));
  it("refuse payout_completed -> created", () => expect(canTransition("payout_completed", "created")).toBe(false));
  it("refuse transition directe created -> payout_completed", () => expect(canTransition("created", "payout_completed")).toBe(false));
});

describe("unites BTC/sats", () => {
  it("satsToBtc / btcToSats inverses", () => {
    expect(satsToBtc(100_000_000)).toBe("1");
    expect(btcToSats("1")).toBe(100_000_000);
    expect(btcToSats("0.001")).toBe(100_000);
  });
  it("isValidSats", () => {
    expect(isValidSats(1)).toBe(true);
    expect(isValidSats(0)).toBe(false);
    expect(isValidSats(1.5)).toBe(false);
  });
});

describe("validation Zod", () => {
  it("rejette amountSats negatif", () => {
    const r = createOrderSchema.safeParse({ amountSats: -10, description: "abc", sellerLabel: "Vendeur", beneficiary: { name: "Ali" } });
    expect(r.success).toBe(false);
  });
});

describe("HMAC signer", () => {
  it("buildSignatureString format", () => {
    expect(buildSignatureString("cid", "123", "nonce", "{}")).toBe("cid:123:nonce:{}");
  });
  it("hmacSha256Hex deterministe", () => {
    const a = hmacSha256Hex("secret", "message");
    const b = hmacSha256Hex("secret", "message");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
  it("webhook HMAC-SHA512 + verify", () => {
    const body = '{"type":"payout.success"}';
    const secret = "whsec_test";
    const sig = hmacSha512Hex(secret, body);
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
    expect(verifyWebhookSignature(body, sig + "0", secret)).toBe(false);
    expect(verifyWebhookSignature(body, "bad", secret)).toBe(false);
  });
});
