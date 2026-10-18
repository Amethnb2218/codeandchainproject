import dotenv from "dotenv";
dotenv.config();

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: parseInt(optional("PORT", "4000"), 10),
  databaseUrl: optional("DATABASE_URL", "file:./data/sentabakh.db"),
  jwtSecret: optional("JWT_SECRET", "change-me-32-chars-minimum-for-jwt"),
  appMode: optional("APP_MODE", "sandbox") as "sandbox" | "demo" | "production",
  corsOrigin: optional("CORS_ORIGIN", "http://localhost:5173"),
  bitnob: {
    // Bitnob HMAC: CLIENT_ID (UUID) + CLIENT_SECRET incluant le préfixe prd: (ex: prd:sandbox_...)
    // Probe du 18/10: seul "prd:sandbox_..." signe correctement (200 whoami), "sandbox_..." seul = 401.
    clientId: (process.env.BITNOB_CLIENT_ID ?? "").trim(),
    clientSecret: (process.env.BITNOB_CLIENT_SECRET ?? process.env.BITNOB_API_KEY ?? "").trim(),
    rawApiKey: (process.env.BITNOB_API_KEY ?? "").trim(),
    webhookSecret: process.env.BITNOB_WEBHOOK_SECRET ?? "",
    baseUrl: (process.env.BITNOB_BASE_URL ?? "https://api.bitnob.com").replace(/\/$/, ""),
    customerId: (process.env.BITNOB_CUSTOMER_ID ?? "").trim(),
  },
  hasBitnobCredentials(): boolean {
    // Vrai seulement si on a un CLIENT_ID d'allure UUID + un secret non vide
    const id = this.bitnob.clientId;
    const sec = this.bitnob.clientSecret;
    if (!id || !sec) return false;
    // id doit ressembler à un UUID ou au moins 8 chars; on refuse "prd" seul
    if (id.length < 8) return false;
    if (id === "prd") return false;
    return true;
  },
  bitnobCredentialHint(): string {
    const id = this.bitnob.clientId;
    const sec = this.bitnob.clientSecret;
    if (!id && sec?.startsWith("sandbox_")) return "CLIENT_ID manquant — la valeur sandbox_... est le SECRET, pas l'ID. Récupère le CLIENT_ID (UUID) dans app.bitnob.com > Settings > API Keys et mets BITNOB_CLIENT_ID=<uuid> + BITNOB_CLIENT_SECRET=sandbox_...";
    if (!id && sec) return "BITNOB_CLIENT_ID vide — renseigne l'UUID visible à côté du secret dans le dashboard Bitnob.";
    if (id && !sec) return "BITNOB_CLIENT_SECRET vide.";
    if (id === "prd") return "BITNOB_CLIENT_ID='prd' invalide — mets l'UUID complet.";
    if (id && sec) return "OK — credentials présents (à vérifier via GET /api/whoami).";
    return "Aucun identifiant Bitnob — mode DEMO.";
  },
};

export function assertBitnobCredentials(): void {
  if (!config.hasBitnobCredentials()) throw new Error("Bitnob credentials not configured");
}
