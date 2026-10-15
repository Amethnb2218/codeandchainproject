import dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (see .env.example)`);
  return v;
}
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
    clientId: process.env.BITNOB_CLIENT_ID ?? "",
    clientSecret: process.env.BITNOB_CLIENT_SECRET ?? "",
    webhookSecret: process.env.BITNOB_WEBHOOK_SECRET ?? "",
    baseUrl: "https://api.bitnob.com",
  },
  hasBitnobCredentials(): boolean {
    return Boolean(this.bitnob.clientId && this.bitnob.clientSecret);
  },
};

export function assertBitnobCredentials(): void {
  if (!config.hasBitnobCredentials()) throw new Error("Bitnob credentials not configured");
}
