// SENTABAKH LITE — shared : schemas, etats, constantes metier (Phase A : socle, pas de metier final)
import { z } from "zod";

// Etats explicites (extensibles en Phase B pour le MVP complet)
export const ORDER_STATUSES = [
  "created",
  "awaiting_payment",
  "payment_confirmed",
  "conversion_pending",
  "funded",
  "delivery_declared",
  "delivery_confirmed",
  "payout_pending",
  "payout_processing",
  "payout_completed",
  "failed",
  "expired",
  "disputed",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
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

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

// Validation entrees (Zod)
export const createOrderSchema = z.object({
  amountSats: z.number().int().positive().max(100_000_000),
  description: z.string().min(3).max(500),
  sellerLabel: z.string().min(2).max(120),
  beneficiary: z.object({
    name: z.string().min(2).max(120),
    phoneHint: z.string().max(30).optional(),
  }),
  demoMode: z.boolean().optional().default(false),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// Unites
export function satsToBtc(sats: number): string {
  return (sats / 100_000_000).toFixed(8).replace(/\.?0+$/, "");
}
export function btcToSats(btc: string): number {
  return Math.round(parseFloat(btc) * 100_000_000);
}
export function isValidSats(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n <= 100_000_000;
}

// Constantes Bitnob (documentees)
export const BITNOB_BASE_URL = "https://api.bitnob.com";
export const BITNOB_DOCS = "https://bitnob.dev";
export const SUPPORTED_PAYOUT_COUNTRIES_HINT = ["SN", "NG", "GH", "KE", "UG", "ZA"];
