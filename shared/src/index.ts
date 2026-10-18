// SENTABAKH LITE — shared : schemas, etats, constantes metier
import { z } from "zod";

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
  funded: ["delivery_declared", "payout_pending", "disputed", "failed"], // FLUX A: qr boutique → funded → payout direct (pas de code); FLUX B: funded = FONDS SÉQUESTRÉS → livraison
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

export const STATUS_LABELS: Record<OrderStatus, string> = {
  created: "Créée",
  awaiting_payment: "En attente de paiement",
  payment_confirmed: "Paiement confirmé",
  conversion_pending: "Conversion en cours",
  funded: "Fonds séquestrés — argent bloqué", // Flux B: après paie séquestré
  delivery_declared: "Livraison déclarée",
  delivery_confirmed: "Réception confirmée",
  payout_pending: "Versement en attente",
  payout_processing: "Versement en cours",
  payout_completed: "Versement terminé — ✅ REÇUS / Vérifié = débloqué",
  failed: "Échouée",
  expired: "Expirée",
  disputed: "Litige",
};

// FLUX BOUT EN BOUT — SENTABAKH (validé graphes)
// Règle: seul VENDEUR + ADMIN ont un compte. CLIENT et LIVREUR jamais de compte.
// VENDEUR: Recevoir → Tape 10 000 FCFA → serveur convertit 10 000 FCFA = 15 651 sats (taux Bitnob verrouillé 2min) → Choix VENDEUR:
// - QR CODE (boutique): Client scanne QR (Blink/Phoenix/Binance) → Paye 15 651 sats → 10 000 FCFA REÇUS (fin, pas de code)
// - LIEN WhatsApp (livraison): Cliente ouvre LIEN sans compte → voit 25 000 FCFA = 39 128 sats (QR+Copier+Ouvrir wallet) → paie → FONDS SÉQUESTRÉS → Livreur arrive hors-plateforme → Cliente clique "J'ai bien reçu" → CODE 482917 (6ch, 2min, 3 essais, persisté) → Cliente dicte → Livreur appelle vendeur → Vendeur saisit code → Vérifié = argent débloqué (versement XOF)

export const createOrderSchema = z.object({
  // VENDEUR tape en FCFA (ex: 10 000 FCFA → serveur convertit 15 651 sats, taux verrouillé 2min)
  amountFcfa: z.number().int().positive().min(500).max(10_000_000).optional(),
  amountSats: z.number().int().positive().max(100_000_000).optional(),
  description: z.string().min(3).max(500),
  sellerLabel: z.string().min(2).max(120),
  beneficiary: z.object({
    name: z.string().min(2).max(120),
    phoneHint: z.string().max(30).optional(),
  }),
  demoMode: z.boolean().optional().default(false),
  flow: z.enum(["qr", "link", "delivery"]).optional().default("delivery"), // graphe: QR CODE (boutique) vs LIEN WhatsApp (livraison séquestrée)
}).refine((d) => Boolean(d.amountSats || d.amountFcfa), { message: "amountFcfa ou amountSats requis", path: ["amountFcfa"] });
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const deliveryProofSchema = z.object({
  note: z.string().min(3).max(1000),
});
export const confirmDeliverySchema = z.object({
  confirmed: z.literal(true),
});
export const payoutQuoteSchema = z.object({
  toCurrency: z.enum(["XOF", "NGN", "GHS", "KES", "UGX", "ZAR"]),
  country: z.string().length(2),
  amount: z.string().optional(), // base units string; si absent on utilise solde simule
});
export const beneficiarySchema = z.object({
  destination_type: z.enum(["bank", "mobile_money"]),
  country: z.string().length(2),
  account_name: z.string().min(2).max(120),
  account_number: z.string().min(5).max(30),
  bank_code: z.string().min(1).max(20).optional(),
  network: z.string().optional(),
});

export function satsToBtc(sats: number): string {
  return (sats / 100_000_000).toFixed(8).replace(/\.?0+$/, "");
}
export function btcToSats(btc: string): number {
  return Math.round(parseFloat(btc) * 100_000_000);
}
export function isValidSats(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n <= 100_000_000;
}
export function formatSats(sats: number): string {
  return `${sats.toLocaleString("fr-FR")} sats (${satsToBtc(sats)} BTC)`;
}
export function formatXof(amount: number): string {
  return `${amount.toLocaleString("fr-FR")} XOF`;
}

export const BITNOB_BASE_URL = "https://api.bitnob.com";
export const BITNOB_DOCS = "https://bitnob.dev";
export const SUPPORTED_PAYOUT_COUNTRIES_HINT = ["SN", "NG", "GH", "KE", "UG", "ZA"];
export const DEMO_LABEL = "DÉMONSTRATION — AUCUN FONDS RÉEL";
