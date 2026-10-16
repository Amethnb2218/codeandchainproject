import { randomUUID } from "node:crypto";
import { getDb } from "./index.js";
import type { OrderStatus } from "../types.js";

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  created: ["awaiting_payment", "expired", "failed"],
  awaiting_payment: ["payment_confirmed", "expired", "failed"],
  payment_confirmed: ["conversion_pending", "failed"],
  conversion_pending: ["funded", "failed"],
  funded: ["delivery_declared", "disputed", "failed"],
  delivery_declared: ["delivery_confirmed", "disputed", "failed"],
  delivery_confirmed: ["payout_pending", "disputed", "failed"],
  payout_pending: ["payout_processing", "failed", "disputed"],
  payout_processing: ["payout_completed", "failed", "disputed"],
  payout_completed: [],
  failed: [],
  expired: [],
  disputed: ["payout_pending", "failed"],
};
function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export function nowIso(): string {
  return new Date().toISOString();
}
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}_${Date.now().toString(36)}`;
}

export function transitionOrder(
  orderId: string,
  to: OrderStatus,
  actor: string,
  reason?: string
): { ok: true; from: OrderStatus; to: OrderStatus } | { ok: false; error: string } {
  const db = getDb();
  const row = db.prepare("SELECT status FROM orders WHERE id=?").get(orderId) as { status: OrderStatus } | undefined;
  if (!row) return { ok: false, error: "Commande introuvable" };
  const from = row.status;
  if (from === to) return { ok: true, from, to };
  if (!canTransition(from, to)) return { ok: false, error: `Transition interdite: ${from} → ${to}` };
  db.prepare("UPDATE orders SET status=?, updated_at=? WHERE id=?").run(to, nowIso(), orderId);
  db.prepare(
    "INSERT INTO order_transitions (id,order_id,from_status,to_status,actor,reason,created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(newId("tr"), orderId, from, to, actor, reason ?? null, nowIso());
  return { ok: true, from, to };
}

export function getOrderFull(orderId: string): Record<string, unknown> | null {
  const db = getDb();
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) return null;
  const invoices = db.prepare("SELECT * FROM lightning_invoices WHERE order_id=? ORDER BY created_at DESC").all(orderId);
  const quotes = db.prepare("SELECT * FROM trading_quotes WHERE order_id=? ORDER BY created_at DESC").all(orderId);
  const tOrders = db.prepare("SELECT * FROM trading_orders WHERE order_id=? ORDER BY created_at DESC").all(orderId);
  const pQuotes = db.prepare("SELECT * FROM payout_quotes WHERE order_id=? ORDER BY created_at DESC").all(orderId);
  const payouts = db.prepare("SELECT * FROM payouts WHERE order_id=? ORDER BY created_at DESC").all(orderId);
  const proofs = db.prepare("SELECT * FROM delivery_proofs WHERE order_id=? ORDER BY created_at ASC").all(orderId);
  const transitions = db.prepare("SELECT * FROM order_transitions WHERE order_id=? ORDER BY created_at ASC").all(orderId);
  return { order, invoices, tradingQuotes: quotes, tradingOrders: tOrders, payoutQuotes: pQuotes, payouts, proofs, transitions };
}
