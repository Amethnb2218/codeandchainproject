import { createHash, randomInt } from "node:crypto";
import { getDb } from "./db/index.js";
import { newId, nowIso } from "./db/helpers.js";

export const DELIVERY_CODE_TTL_MS = 2 * 60 * 1000; // 2 min (spec)
export const DELIVERY_CODE_MAX_ATTEMPTS = 3;

export function generateDeliveryCode(): string {
  // 6 chiffres, jamais 000000 — lisible à voix haute
  return String(randomInt(100000, 1_000_000));
}

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function codeHint(code: string): string {
  // ex. **4821 — affiché au client, masque les 2 premiers chiffres
  return "**" + code.slice(2);
}

export function createDeliveryCode(orderId: string): { id: string; code: string; hint: string; expiresAt: string } {
  const db = getDb();
  const code = generateDeliveryCode();
  const id = newId("dc");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + DELIVERY_CODE_TTL_MS).toISOString();
  db.prepare("UPDATE delivery_codes SET status='superseded' WHERE order_id=? AND status='active'").run(orderId);
  // code_plain stocké en clair 2min uniquement pour permettre le ré-affichage après refresh (spec graphe: si elle actualise, le même code réapparaît)
  try {
    db.prepare(
      "INSERT INTO delivery_codes (id,order_id,code_hash,code_hint,code_plain,status,expires_at,attempts,created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(id, orderId, hashCode(code), codeHint(code), code, "active", expiresAt, 0, now);
  } catch {
    db.prepare(
      "INSERT INTO delivery_codes (id,order_id,code_hash,code_hint,status,expires_at,attempts,created_at) VALUES (?,?,?,?,?,?,?,?)"
    ).run(id, orderId, hashCode(code), codeHint(code), "active", expiresAt, 0, now);
  }
  return { id, code, hint: codeHint(code), expiresAt };
}

export function getOrCreateDeliveryCode(orderId: string): { id: string; code: string; hint: string; expiresAt: string; isNew: boolean } {
  const db = getDb();
  const now = Date.now();
  const existing = db
    .prepare("SELECT * FROM delivery_codes WHERE order_id=? AND status='active' ORDER BY created_at DESC LIMIT 1")
    .get(orderId) as Record<string, unknown> | undefined;
  if (existing) {
    const exp = new Date(existing.expires_at as string).getTime();
    if (exp > now && (existing.attempts as number) < DELIVERY_CODE_MAX_ATTEMPTS) {
      // Persisté: refresh → même code (spec)
      const plain = existing.code_plain as string | null;
      if (plain && /^\d{6}$/.test(plain)) {
        return { id: existing.id as string, code: plain, hint: existing.code_hint as string, expiresAt: existing.expires_at as string, isNew: false };
      }
      // Si code_plain absent (ancienne DB), on retourne hint seulement — le vendeur devra redemander
      // On ne régénère pas pour respecter "persisté"
      if (!plain) return { id: existing.id as string, code: "", hint: existing.code_hint as string, expiresAt: existing.expires_at as string, isNew: false };
    }
    if (exp <= now) db.prepare("UPDATE delivery_codes SET status='expired' WHERE id=?").run(existing.id as string);
    else if ((existing.attempts as number) >= DELIVERY_CODE_MAX_ATTEMPTS) db.prepare("UPDATE delivery_codes SET status='locked' WHERE id=?").run(existing.id as string);
  }
  const created = createDeliveryCode(orderId);
  return { ...created, isNew: true };
}

export function verifyDeliveryCode(orderId: string, input: string): { ok: boolean; error?: string; codeId?: string } {
  const db = getDb();
  const normalized = input.replace(/\D/g, "").slice(0, 6);
  if (normalized.length !== 6) return { ok: false, error: "Code invalide (6 chiffres attendus)" };
  const row = db
    .prepare("SELECT * FROM delivery_codes WHERE order_id=? AND status='active' ORDER BY created_at DESC LIMIT 1")
    .get(orderId) as Record<string, unknown> | undefined;
  if (!row) return { ok: false, error: "Aucun code actif pour cette commande" };
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    db.prepare("UPDATE delivery_codes SET status='expired' WHERE id=?").run(row.id as string);
    return { ok: false, error: "Code expiré — le client doit régénérer un code" };
  }
  if ((row.attempts as number) >= DELIVERY_CODE_MAX_ATTEMPTS) {
    db.prepare("UPDATE delivery_codes SET status='locked' WHERE id=?").run(row.id as string);
    return { ok: false, error: "Trop de tentatives — code verrouillé, régénération requise" };
  }
  db.prepare("UPDATE delivery_codes SET attempts=attempts+1 WHERE id=?").run(row.id as string);
  if (hashCode(normalized) !== row.code_hash) {
    const left = DELIVERY_CODE_MAX_ATTEMPTS - ((row.attempts as number) + 1);
    return { ok: false, error: `Code incorrect — ${left} tentative(s) restante(s)` };
  }
  db.prepare("UPDATE delivery_codes SET status='verified', verified_at=? WHERE id=?").run(nowIso(), row.id as string);
  return { ok: true, codeId: row.id as string };
}

export function getActiveDeliveryCode(orderId: string): Record<string, unknown> | null {
  const db = getDb();
  const row = db
    .prepare("SELECT id, code_hint, status, expires_at, attempts, created_at, verified_at FROM delivery_codes WHERE order_id=? ORDER BY created_at DESC LIMIT 1")
    .get(orderId) as Record<string, unknown> | undefined;
  return row ?? null;
}
