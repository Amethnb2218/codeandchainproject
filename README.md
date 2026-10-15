# SENTABAKH LITE — Code & Chain Dakar 2026

> Paiement Bitcoin Lightning → commande commerciale → preuve de livraison → versement en monnaie locale (XOF). Integre Bitnob (Lightning, Trading, Payouts).

**Evenement :** Code & Chain Dakar 2026, 17–18 octobre 2026.  
**Statut au 15 octobre 2026 (veille) :** Phase A — preparation pre-hackathon terminee. Aucune fonctionnalite metier finale n'est presentee comme realisee pendant le hackathon (respect du reglement). Le MVP complet sera construit a partir de zero pendant le hackathon.

## Fonctionnalites (Phase A, pre-hackathon)
- Monorepo `shared` / `server` / `client` operationnel.
- Auth Bitnob HMAC-SHA256 + webhook HMAC-SHA512 + dedup.
- Client Bitnob centralise (lecture sans mouvement de fonds verifiable).
- Schema SQLite + machine a etats + validation Zod + unites sats/BTC.
- Endpoints `GET /health`, `GET /api/preflight`, `GET /api/orders`, `POST /api/webhooks/bitnob`.
- Tests Vitest (transitions, unites, HMAC).
- Frontend Vite React minimal avec badge mode (DEMO/SANDBOX/PRODUCTION) + page preflight.

## Architecture
Voir `docs/ARCHITECTURE.md`. Stack : React TS Vite + Express TS + SQLite WAL + Vitest + Zod. Base Bitnob `https://api.bitnob.com`.

## Prerequis
Node >=20 (teste v24.22.0), npm 12.2.0, Git 2.55.0.

## Installation
```powershell
# reconstruire le PATH si Git non reconnu
$machinePath=[Environment]::GetEnvironmentVariable("Path","Machine"); $userPath=[Environment]::GetEnvironmentVariable("Path","User"); $entries=@($machinePath -split ';')+@($userPath -split ';')+@($env:Path -split ';'); $seen=[System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase); $env:Path=(($entries|ForEach-Object{$e=$_.Trim();if($e -and $seen.Add($e)){$e}})-join ';')

npm install
cp .env.example .env   # puis renseigner BITNOB_CLIENT_ID/SECRET si fournis
```

## Configuration (.env)
Voir `.env.example`. Cles Bitnob uniquement cote `server` (`BITNOB_CLIENT_ID`, `BITNOB_CLIENT_SECRET`, `BITNOB_WEBHOOK_SECRET`). Frontend : `VITE_API_URL`, `VITE_APP_MODE`.

## Commandes
```powershell
npm run preflight --workspace=server   # verifs lecture seule, sans mouvement de fonds
npm run dev                            # client :5173 + server :4000
npm test                               # server + shared
npm run build                          # build shared + server + client
npm run preflight                      # proxy racine -> server
```

## Modes
- `sandbox` : appels reels en test (si credentials valides), jamais de fonds reels.
- `demo` : simulation explicite avec bandeau `DEMONSTRATION — AUCUN FONDS REEL`, donnees marquees simulees.
- `production` : reel (hors hackathon, credentials prod).

## Validation Bitnob
`npm run preflight --workspace=server` teste `GET /api/whoami`, `/api/balances`, `/api/payouts/supported-countries`, `/api/trading/prices` — aucune ecriture, aucun mouvement de fonds.

## Limitations connues (Phase A)
- Pas de credentials Bitnob configures → preflight en mode demo.
- MVP metier (factures, trading, payouts, preuves, dashboard) a construire pendant le hackathon.
- Docs `docs.bitnob.co` parfois indisponible, fallback `bitnob.dev` utilise.

## Securite
- Secrets jamais exposes au frontend, jamais commites.
- Webhook verifie sur raw body.
- `.env`, `*.db`, `uploads/`, `logs/` ignores par Git.

## Deploiement
Prevu en Phase B (Vercel/Render selon acces jour J). Non pretendu deploye avant verification URL.

## Licence
Prive — hackathon Code & Chain Dakar 2026.
