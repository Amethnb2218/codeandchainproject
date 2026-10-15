// SENTABAKH LITE — scripts/preflight.ts (Phase A : verifs sans mouvement de fonds)
import { config } from "../src/config.js";
import { whoami, getBalances, getPayoutSupportedCountries, getTradingPrices } from "../src/bitnob/client.js";

async function main() {
  console.log("=== SENTABAKH LITE — PREFLIGHT (sans mouvement de fonds) ===");
  console.log(`Node ${process.version} | mode=${config.appMode} | base=${config.bitnob.baseUrl}`);
  console.log(`Bitnob configured: ${config.hasBitnobCredentials()} (clientIdPresent=${Boolean(config.bitnob.clientId)})`);

  if (!config.hasBitnobCredentials()) {
    console.log("\n[preflight] Aucun identifiant BITNOB_* detecte.");
    console.log("  -> Mode DEMO autorise : le parcours sera simule avec mention visible.");
    console.log("  -> Pour tester en sandbox, renseigner BITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET dans .env");
    console.log("  -> Puis relancer: npm run preflight --workspace=server");
    console.log("\n[preflight] OK (preparation hors ligne reussie).");
    return;
  }

  const checks: Array<{ name: string; fn: () => Promise<{ ok: boolean; status: number; error?: string }> }> = [
    { name: "whoami", fn: async () => { const r = await whoami(); return { ok: r.ok, status: r.status, error: !r.ok ? (r as { error: string }).error : undefined }; } },
    { name: "balances", fn: async () => { const r = await getBalances(); return { ok: r.ok, status: r.status, error: !r.ok ? (r as { error: string }).error : undefined }; } },
    { name: "payout/supported-countries", fn: async () => { const r = await getPayoutSupportedCountries(); return { ok: r.ok, status: r.status, error: !r.ok ? (r as { error: string }).error : undefined }; } },
    { name: "trading/prices", fn: async () => { const r = await getTradingPrices(); return { ok: r.ok, status: r.status, error: !r.ok ? (r as { error: string }).error : undefined }; } },
  ];

  for (const c of checks) {
    try {
      const r = await c.fn();
      const icon = r.ok ? "OK" : "ERR";
      console.log(`  [${icon}] ${c.name} -> status=${r.status}${r.error ? ` error=${r.error.slice(0, 300)}` : ""}`);
    } catch (e) {
      console.log(`  [ERR] ${c.name} -> exception ${(e as Error).message}`);
    }
  }
  console.log("\n[preflight] Termine. Les operations de lecture n'ont deplace aucun fonds.");
}

main().catch((e) => {
  console.error("[preflight] fatal", e);
  process.exit(1);
});
