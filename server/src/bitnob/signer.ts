// SENTABAKH LITE — Bitnob HMAC signer (Phase A : conforme llms.txt + OpenAPI)
import { createHmac } from "node:crypto";

export type SignParams = {
  clientId: string;
  clientSecret: string;
  timestamp: string; // unix seconds as string
  nonce: string; // 16-byte hex ou UUID
  body: string; // exact body string, "" for GET
};

export function buildSignatureString(clientId: string, timestamp: string, nonce: string, body: string): string {
  return `${clientId}:${timestamp}:${nonce}:${body}`;
}

export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

export function signRequest(params: SignParams): string {
  const msg = buildSignatureString(params.clientId, params.timestamp, params.nonce, params.body);
  return hmacSha256Hex(params.clientSecret, msg);
}

export function nowTimestampSec(): string {
  return Math.floor(Date.now() / 1000).toString();
}

import { randomBytes } from "node:crypto";
export function randomNonceHexSync(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}
export async function randomNonceHex(bytes = 16): Promise<string> {
  return randomNonceHexSync(bytes);
}

export function hmacSha512Hex(secret: string, body: string): string {
  return createHmac("sha512", secret).update(body).digest("hex");
}

export function verifyWebhookSignature(rawBody: string, headerSignature: string, webhookSecret: string): boolean {
  if (!headerSignature || !webhookSecret) return false;
  const expected = hmacSha512Hex(webhookSecret, rawBody);
  // timing-safe compare
  if (expected.length !== headerSignature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ headerSignature.charCodeAt(i);
  return diff === 0;
}
