// Copie minimale des types partages pour eviter import hors rootDir (sync avec shared/src/index.ts)
export type OrderStatus =
  | "created"
  | "awaiting_payment"
  | "payment_confirmed"
  | "conversion_pending"
  | "funded"
  | "delivery_declared"
  | "delivery_confirmed"
  | "payout_pending"
  | "payout_processing"
  | "payout_completed"
  | "failed"
  | "expired"
  | "disputed";
export const STATUS_LABELS: Record<OrderStatus, string> = {
  created: "Créée",
  awaiting_payment: "En attente de paiement",
  payment_confirmed: "Paiement confirmé",
  conversion_pending: "Conversion en cours",
  funded: "Fonds séquestrés — argent bloqué", // Flux B: séquestré → vendeur "Tu peux envoyer le livreur"; Flux A: qr → REÇUS direct
  delivery_declared: "Livraison déclarée",
  delivery_confirmed: "Réception confirmée — CODE vérifié = débloqué",
  payout_pending: "Versement en attente",
  payout_processing: "Versement en cours",
  payout_completed: "Versement terminé — ✅ REÇUS / Vérifié = débloqué",
  failed: "Échouée",
  expired: "Expirée",
  disputed: "Litige",
};
export function satsToBtc(sats: number): string {
  return (sats / 100_000_000).toFixed(8).replace(/\.?0+$/, "");
}
